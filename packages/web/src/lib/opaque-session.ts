import { opaqueRegisterStart, opaqueLoginStart } from "./opaque-client.js";
import type { WsTransport } from "@/api/ws-transport.js";

// Decode a base64 string to Uint8Array (browser-native, no deps).
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Derive a 32-byte AES-256-GCM key from the OPAQUE sessionKey via HKDF-SHA256.
 *
 * Matches the server's derivation:
 *   Hkdf::<Sha256>::new(None, session_key).expand(b"dam-hopper-aes-256-gcm-v1", &mut key)
 *
 * Rust `hkdf::new(None, …)` uses HashLen (32) zero bytes as the salt for SHA-256.
 */
async function deriveAesKey(sessionKeyB64: string): Promise<Uint8Array> {
  const ikm = base64ToBytes(sessionKeyB64);
  const salt = new Uint8Array(32); // 32 zero bytes = Rust `None` default for SHA-256
  const info = new TextEncoder().encode("dam-hopper-aes-256-gcm-v1");

  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    256,
  );
  ikm.fill(0); // zero IKM from memory
  return new Uint8Array(bits);
}

/**
 * Perform OPAQUE register-then-login to derive a shared 32-byte AES key.
 *
 * Registers each session fresh (in-memory ephemeral on server, no persistence).
 * Returns the 32-byte AES-256-GCM key that matches the server's derived key.
 *
 * @param transport   Live WsTransport instance.
 * @param identifier  Alphanumeric session identifier (e.g. project-scoped string).
 * @param password    User passphrase — never transmitted over the wire.
 */
export async function opaqueRegisterAndLogin(
  transport: WsTransport,
  identifier: string,
  password: string,
): Promise<Uint8Array> {
  // ── 1. Registration round-trip ──────────────────────────────────────────────
  const reg = await opaqueRegisterStart(password);

  const regResponseData = await transport.authRegisterStart(identifier, reg.requestBytes);
  const regUpload = reg.finishRegistration(regResponseData);
  // overwrite=true: re-register each session (in-memory ephemeral server store).
  await transport.authRegisterFinish(identifier, regUpload, true);

  // ── 2. Login round-trip ─────────────────────────────────────────────────────
  const login = await opaqueLoginStart(password);

  const { session_id, data: loginResponseData } = await transport.authLoginStart(
    identifier,
    login.requestBytes,
  );

  const finished = login.finishLogin(loginResponseData);
  if (!finished) {
    throw new Error("OPAQUE login failed — passphrase mismatch or server error");
  }

  await transport.authLoginFinish(session_id, finished.finalizationBytes);

  // ── 3. Key derivation ───────────────────────────────────────────────────────
  // sessionKey is the shared OPAQUE key (same on both sides); exportKey is client-only.
  const aesKey = await deriveAesKey(finished.sessionKey);
  return aesKey;
}
