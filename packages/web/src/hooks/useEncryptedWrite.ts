/**
 * useEncryptedWrite — React hook for encrypted file uploads and text saves.
 *
 * Orchestrates:
 * 1. OPAQUE register + login (zero-knowledge key exchange)
 * 2. AES-256-GCM encryption via Web Crypto API (crypto.ts)
 * 3. Encrypted binary upload via fs:put_* WS protocol
 * 4. Encrypted text save via fs:put_save WS protocol
 *
 * The passphrase is never transmitted. The AES key is derived from the OPAQUE
 * session_key and used only during the active session.
 *
 * The hook is stateless between saves — it re-uses the same OPAQUE session
 * (stored in the context) until the project changes or the context is reset.
 *
 * Usage:
 *   const { uploadFile, saveText, status, error } = useEncryptedWrite(project);
 */
import { useCallback, useRef, useState } from "react";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { opaqueRegisterAndLogin, type OpaqueSessionResult } from "@/lib/opaque-session.js";
import { encryptFile, encryptText } from "@/lib/crypto.js";
import { useEncryptMode } from "@/contexts/EncryptContext.js";

export type EncryptedWriteStatus =
  | "idle"
  | "authenticating"
  | "encrypting"
  | "uploading"
  | "done"
  | "error";

export interface EncryptedUploadResult {
  ok: boolean;
  newMtime?: number;
  error?: string;
}

export interface UseEncryptedWriteReturn {
  /** Upload an encrypted File to the given directory. */
  uploadFile: (
    project: string,
    dir: string,
    file: File,
    passphrase: string,
    onProgress?: (pct: number) => void,
  ) => Promise<EncryptedUploadResult>;

  /** Save encrypted text content to the given path. */
  saveText: (
    project: string,
    path: string,
    text: string,
    passphrase: string,
  ) => Promise<EncryptedUploadResult>;

  status: EncryptedWriteStatus;
  error: string | null;
  resetError: () => void;
}

/**
 * Build a deterministic OPAQUE identifier scoped to this project.
 * Deterministic per project name — the in-memory ephemeral server model
 * re-registers each session, so no per-page-load uniqueness is needed.
 */
function buildIdentifier(project: string): string {
  return `enc-${project.replace(/[^a-z0-9]/gi, "-").slice(0, 32)}`;
}

export function useEncryptedWrite(): UseEncryptedWriteReturn {
  const [status, setStatus] = useState<EncryptedWriteStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Session cache lives in EncryptContext so disable-Lock evicts it atomically
  const { getSession, setSession, clearSession, clearPassphrase } = useEncryptMode();

  // In-flight dedup: if an OPAQUE handshake is already running for this project, join it
  const sessionInflightRef = useRef<Map<string, Promise<OpaqueSessionResult>>>(new Map());

  const getOrCreateSession = useCallback(
    async (project: string, passphrase: string): Promise<OpaqueSessionResult> => {
      const cached = getSession(project);
      if (cached) return cached;

      const inflight = sessionInflightRef.current.get(project);
      if (inflight) return inflight;

      setStatus("authenticating");
      const transport = getTransport() as WsTransport;
      const identifier = buildIdentifier(project);

      const promise = opaqueRegisterAndLogin(transport, identifier, passphrase)
        .then((session) => {
          setSession(project, session);
          clearPassphrase(project); // passphrase no longer needed — AES key cached in session
          return session;
        })
        .finally(() => {
          sessionInflightRef.current.delete(project);
        });

      sessionInflightRef.current.set(project, promise);
      return promise;
    },
    [getSession, setSession, clearPassphrase],
  );

  const uploadFile = useCallback(
    async (
      project: string,
      dir: string,
      file: File,
      passphrase: string,
      onProgress?: (pct: number) => void,
    ): Promise<EncryptedUploadResult> => {
      setError(null);
      try {
        const session = await getOrCreateSession(project, passphrase);

        setStatus("encrypting");
        // encryptFile zeroes the exportKey — we must clone for each call
        const { blob } = await encryptFile(file, new Uint8Array(session.aesKey));

        setStatus("uploading");
        const transport = getTransport() as WsTransport;
        const uploadId = crypto.randomUUID();

        // fsPutFile expects a File, but we have a Blob — wrap it
        const encFile = new File([blob], file.name, { type: "application/octet-stream" });

        const result = await transport.fsPutFile(
          project,
          dir,
          encFile,
          session.sessionId,
          uploadId,
          onProgress,
        );

        setStatus(result.ok ? "done" : "error");
        if (!result.ok) {
          const msg = result.error ?? "Encrypted upload failed";
          setError(msg);
          return { ok: false, error: msg };
        }

        return { ok: true, newMtime: result.newMtime };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Encrypted upload failed";
        setStatus("error");
        setError(msg);
        clearSession(project);
        return { ok: false, error: msg };
      }
    },
    [getOrCreateSession, clearSession],
  );

  const saveText = useCallback(
    async (
      project: string,
      path: string,
      text: string,
      passphrase: string,
    ): Promise<EncryptedUploadResult> => {
      setError(null);
      try {
        const session = await getOrCreateSession(project, passphrase);

        setStatus("encrypting");
        // encryptText zeroes the exportKey — clone for each call
        const { blob } = await encryptText(text, path, new Uint8Array(session.aesKey));

        setStatus("uploading");
        const transport = getTransport() as WsTransport;

        const result = await transport.fsPutSave(project, path, blob, session.sessionId);

        setStatus(result.ok ? "done" : "error");
        if (!result.ok) {
          const msg = result.error ?? "Encrypted save failed";
          setError(msg);
          return { ok: false, error: msg };
        }

        return { ok: true, newMtime: result.newMtime };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Encrypted save failed";
        setStatus("error");
        setError(msg);
        clearSession(project);
        return { ok: false, error: msg };
      }
    },
    [getOrCreateSession, clearSession],
  );

  const resetError = useCallback(() => {
    setError(null);
    setStatus("idle");
  }, []);

  return { uploadFile, saveText, status, error, resetError };
}
