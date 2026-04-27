/**
 * crypto.ts — Client-side AES-256-GCM encryption for encrypted file writes.
 *
 * Uses only the Web Crypto API (crypto.subtle) — no npm crypto libraries.
 *
 * Envelope: iv(12) || ciphertext+tag
 * Plaintext: metadata_json + 0x00 + content_bytes
 *
 * exportKey is used directly as AES-256-GCM key — derived by OPAQUE login
 * (HKDF-expanded from OPAQUE session_key). No PBKDF2. No salt.
 *
 * SECURITY: exportKey Uint8Array is zeroed immediately after AES key import.
 * Do NOT reuse the same exportKey Uint8Array across multiple calls.
 * Clone it first: new Uint8Array(exportKey) if you need to reuse.
 */

const IV_LEN = 12; // AES-GCM nonce: 96 bits
const TAG_LEN = 16; // AES-GCM auth tag: 128 bits

/**
 * Metadata embedded in the plaintext envelope before the 0x00 separator.
 * Server deserializes this as serde_json::Value.
 */
export interface EncryptedBlobMetadata {
  /** Original filename */
  name: string;
  /** Original file size in bytes (unencrypted) */
  size: number;
  /** MIME type guess */
  type: string;
}

export interface TextBlobMetadata {
  /** Logical path within the project (e.g. "src/main.rs") */
  path: string;
  /** Byte length of the UTF-8 encoded text */
  size: number;
}

export interface EncryptResult {
  /** Encrypted blob: iv(12) || ciphertext+tag — ready for WS binary frame */
  blob: Blob;
  /** Metadata that was embedded in the plaintext envelope */
  metadata: EncryptedBlobMetadata | TextBlobMetadata;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Import a 32-byte export_key as a non-extractable AES-256-GCM CryptoKey,
 * then zero the source buffer.
 */
async function importAesKey(exportKeyBytes: Uint8Array): Promise<CryptoKey> {
  if (exportKeyBytes.length !== 32) {
    throw new Error(`exportKey must be 32 bytes, got ${exportKeyBytes.length}`);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    exportKeyBytes.buffer.slice(
      exportKeyBytes.byteOffset,
      exportKeyBytes.byteOffset + exportKeyBytes.byteLength,
    ),
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );

  // Zero the source buffer immediately after import
  exportKeyBytes.fill(0);

  return key;
}

/** Generate a cryptographically random 12-byte IV. */
function randomIv(): Uint8Array {
  const iv = new Uint8Array(IV_LEN);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Encrypt plaintext bytes with AES-256-GCM.
 * Returns iv(12) || ciphertext+tag as a single Uint8Array.
 */
async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = randomIv();
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const ciphertext = new Uint8Array(ciphertextBuf);

  // Assemble envelope: iv || ciphertext+tag
  const envelope = new Uint8Array(IV_LEN + ciphertext.byteLength);
  envelope.set(iv, 0);
  envelope.set(ciphertext, IV_LEN);
  return envelope;
}

/**
 * Build the plaintext envelope: metadata_json + 0x00 + content_bytes.
 */
function buildPlaintext(
  metadata: EncryptedBlobMetadata | TextBlobMetadata,
  content: Uint8Array,
): Uint8Array {
  const metaJson = JSON.stringify(metadata);
  const metaBytes = new TextEncoder().encode(metaJson);

  // plaintext = meta + NUL + content
  const plaintext = new Uint8Array(
    metaBytes.byteLength + 1 + content.byteLength,
  );
  plaintext.set(metaBytes, 0);
  plaintext[metaBytes.byteLength] = 0x00;
  plaintext.set(content, metaBytes.byteLength + 1);
  return plaintext;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a File for encrypted binary upload via fs:put_*.
 *
 * The entire file is loaded into memory. Client-side limit: 100 MB.
 * exportKey (32 bytes) is zeroed after AES key import — do not reuse it.
 *
 * @param file       The File to encrypt (from <input type="file"> or drag-drop)
 * @param exportKey  32-byte OPAQUE export_key (will be zeroed after use)
 * @returns          Encrypted blob + metadata
 */
export async function encryptFile(
  file: File,
  exportKey: Uint8Array,
): Promise<EncryptResult> {
  if (file.size > 100 * 1024 * 1024) {
    throw new Error(
      `File too large: ${file.size} bytes (limit: 100 MB). Use normal upload for large files.`,
    );
  }

  const metadata: EncryptedBlobMetadata = {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };

  // Read file bytes
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // Import key (zeros exportKey)
  const key = await importAesKey(exportKey);

  // Build plaintext envelope
  const plaintext = buildPlaintext(metadata, fileBytes);

  // Zero file bytes now that they're in the plaintext envelope
  fileBytes.fill(0);

  // Encrypt
  const envelope = await encryptBytes(key, plaintext);

  return {
    blob: new Blob([envelope], { type: "application/octet-stream" }),
    metadata,
  };
}

/**
 * Encrypt UTF-8 text for encrypted editor save via fs:put_save.
 *
 * exportKey (32 bytes) is zeroed after AES key import — do not reuse it.
 *
 * @param text       The text content to encrypt (UTF-8 string)
 * @param path       Logical path relative to project root (e.g. "src/main.rs")
 * @param exportKey  32-byte OPAQUE export_key (will be zeroed after use)
 * @returns          Encrypted blob + metadata
 */
export async function encryptText(
  text: string,
  path: string,
  exportKey: Uint8Array,
): Promise<EncryptResult> {
  const contentBytes = new TextEncoder().encode(text);

  if (contentBytes.byteLength > 100 * 1024 * 1024) {
    throw new Error(
      `Content too large: ${contentBytes.byteLength} bytes (limit: 100 MB).`,
    );
  }

  const metadata: TextBlobMetadata = {
    path,
    size: contentBytes.byteLength,
  };

  // Import key (zeros exportKey)
  const key = await importAesKey(exportKey);

  // Build plaintext envelope
  const plaintext = buildPlaintext(metadata, contentBytes);

  // Encrypt
  const envelope = await encryptBytes(key, plaintext);

  return {
    blob: new Blob([envelope], { type: "application/octet-stream" }),
    metadata,
  };
}

/**
 * Decrypt a blob for testing/verification (not used in production flow).
 * Production decrypt happens server-side.
 *
 * @param envelope   iv(12) || ciphertext+tag
 * @param exportKey  32-byte key (will be zeroed after use)
 */
export async function decryptBlob(
  envelope: Uint8Array,
  exportKey: Uint8Array,
): Promise<{ metadata: unknown; content: Uint8Array }> {
  if (envelope.byteLength < IV_LEN + TAG_LEN) {
    throw new Error("Encrypted blob too short");
  }

  const iv = envelope.slice(0, IV_LEN);
  const ciphertext = envelope.slice(IV_LEN);

  const key = await importAesKey(exportKey);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  const plain = new Uint8Array(plainBuf);

  // Find 0x00 separator
  const sepIdx = plain.indexOf(0x00);
  if (sepIdx === -1) {
    throw new Error("Plaintext missing metadata separator (0x00)");
  }

  const metaJson = new TextDecoder().decode(plain.slice(0, sepIdx));
  const metadata = JSON.parse(metaJson) as unknown;
  const content = plain.slice(sepIdx + 1);

  return { metadata, content };
}
