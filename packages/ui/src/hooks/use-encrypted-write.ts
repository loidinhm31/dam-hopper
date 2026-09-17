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
import {
  captureConnection,
  getConnectionSnapshot,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
} from "@/api/connections.js";
import type { WsTransport } from "@/api/ws-transport.js";
import {
  opaqueRegisterAndLogin,
  type OpaqueSessionResult,
} from "@/lib/opaque-session.js";
import { encryptFile, encryptText } from "@/lib/crypto.js";
import { toEncryptKey, useEncryptMode } from "@/contexts/EncryptContext.js";
import {
  isProjectTargetError,
  normalizeProjectTarget,
  type ConnectionRef,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import { useEditorStore } from "@/stores/editor.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";
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
    target: ProjectTargetInput,
    dir: string,
    file: File,
    passphrase: string,
    onProgress?: (pct: number) => void,
    explicitOwner?: ConnectionRef,
  ) => Promise<EncryptedUploadResult>;

  /** Save encrypted text content to the given path. */
  saveText: (
    target: ProjectTargetInput,
    path: string,
    text: string,
    passphrase: string,
    explicitOwner?: ConnectionRef,
  ) => Promise<EncryptedUploadResult>;

  status: EncryptedWriteStatus;
  error: string | null;
  resetError: () => void;
}

/**
 * Build a collision-free OPAQUE identifier scoped to this project and handshake.
 */
function buildCollisionFreeIdentifier(project: string): string {
  const sanitized = project.replace(/[^a-z0-9]/gi, "-").slice(0, 20);
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `enc-${sanitized}-${randomSuffix}`;
}
function isTargetUnavailableError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : undefined;
  return isProjectTargetError(
    code,
    error instanceof Error ? error.message : undefined,
  );
}

export function useEncryptedWrite(): UseEncryptedWriteReturn {
  const [status, setStatus] = useState<EncryptedWriteStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const operationRevisionRef = useRef(0);

  // Session cache lives in EncryptContext so disable-Lock evicts it atomically
  const {
    getSession,
    setSession,
    clearSession,
    clearPassphrase,
    isEncryptEnabled,
  } = useEncryptMode();

  // In-flight dedup: if an OPAQUE handshake is already running for this owner+project, join it
  const sessionInflightRef = useRef<Map<string, Promise<OpaqueSessionResult>>>(
    new Map(),
  );

  function resolveOwnerAndTransport(
    targetRef: ProjectTargetRef,
    explicitOwner?: ConnectionRef,
  ): { owner?: ConnectionRef; transport: WsTransport } {
    let owner: ConnectionRef | undefined = explicitOwner;
    if (!owner && targetRef.profileId) {
      try {
        owner = captureConnection(targetRef.profileId);
      } catch {
        const snap = getConnectionSnapshot(targetRef.profileId);
        owner = snap?.owner;
      }
    }
    const transport = (
      owner ? getConnectionsTransport(owner) : getTransport()
    ) as WsTransport;
    return { owner, transport };
  }

  const getOrCreateSession = useCallback(
    async (
      transport: WsTransport,
      owner: ConnectionRef | undefined,
      targetRef: ProjectTargetRef,
      passphrase: string,
      expectedRevision: number,
    ): Promise<OpaqueSessionResult> => {
      const project = targetRef.project;
      const cached = getSession(project, owner);
      if (cached) return cached;

      const key = toEncryptKey(targetRef, owner);
      const inflight = sessionInflightRef.current.get(key);
      if (inflight) return inflight;

      setStatus("authenticating");
      const identifier = buildCollisionFreeIdentifier(project);

      const promise = opaqueRegisterAndLogin(transport, identifier, passphrase)
        .then((session) => {
          // Freshness checks: operation cancelled, connection changed, or lock disabled
          if (
            operationRevisionRef.current !== expectedRevision ||
            (owner && !isCurrentConnection(owner)) ||
            !isEncryptEnabled(project, owner)
          ) {
            if (session.aesKey && session.aesKey.buffer) {
              try {
                new Uint8Array(session.aesKey.buffer).fill(0);
              } catch {
                // Ignore buffer zero error
              }
            }
            throw new Error(
              "Encrypted write cancelled or connection changed during authentication",
            );
          }
          setSession(project, session, owner);
          clearPassphrase(project, owner);
          return session;
        })
        .finally(() => {
          sessionInflightRef.current.delete(key);
        });

      sessionInflightRef.current.set(key, promise);
      return promise;
    },
    [getSession, setSession, clearPassphrase, isEncryptEnabled],
  );

  const uploadFile = useCallback(
    async (
      target: ProjectTargetInput,
      dir: string,
      file: File,
      passphrase: string,
      onProgress?: (pct: number) => void,
      explicitOwner?: ConnectionRef,
    ): Promise<EncryptedUploadResult> => {
      const targetRef = normalizeProjectTarget(target);
      const project = targetRef.project;
      setError(null);
      const { owner, transport } = resolveOwnerAndTransport(
        targetRef,
        explicitOwner,
      );
      const revision = ++operationRevisionRef.current;

      try {
        const session = await getOrCreateSession(
          transport,
          owner,
          targetRef,
          passphrase,
          revision,
        );

        if (
          operationRevisionRef.current !== revision ||
          (owner && !isCurrentConnection(owner)) ||
          !isEncryptEnabled(project, owner)
        ) {
          throw new Error("Encrypted upload cancelled or connection changed");
        }

        setStatus("encrypting");
        const { blob } = await encryptFile(
          file,
          new Uint8Array(session.aesKey),
        );

        if (
          operationRevisionRef.current !== revision ||
          (owner && !isCurrentConnection(owner)) ||
          !isEncryptEnabled(project, owner)
        ) {
          throw new Error("Encrypted upload cancelled or connection changed");
        }

        setStatus("uploading");
        const uploadId = crypto.randomUUID();
        const encFile = new File([blob], file.name, {
          type: "application/octet-stream",
        });

        const result = await transport.fsPutFile(
          targetRef,
          dir,
          encFile,
          session.sessionId,
          uploadId,
          onProgress,
        );

        setStatus(result.ok ? "done" : "error");
        if (!result.ok) {
          const msg = result.error ?? "Encrypted upload failed";
          if (isTargetUnavailableError(result) || isProjectTargetError(msg)) {
            markProjectTargetUnavailable(targetRef);
            useEditorStore.getState().markTargetUnavailable(targetRef);
          }
          setError(msg);
          return { ok: false, error: msg };
        }

        return { ok: true, newMtime: result.newMtime };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Encrypted upload failed";
        if (isTargetUnavailableError(e) || isProjectTargetError(msg)) {
          markProjectTargetUnavailable(targetRef);
          useEditorStore.getState().markTargetUnavailable(targetRef);
        }
        setStatus("error");
        setError(msg);
        clearSession(project, owner);
        return { ok: false, error: msg };
      }
    },
    [getOrCreateSession, clearSession, isEncryptEnabled],
  );

  const saveText = useCallback(
    async (
      target: ProjectTargetInput,
      path: string,
      text: string,
      passphrase: string,
      explicitOwner?: ConnectionRef,
    ): Promise<EncryptedUploadResult> => {
      const targetRef = normalizeProjectTarget(target);
      const project = targetRef.project;
      setError(null);
      const { owner, transport } = resolveOwnerAndTransport(
        targetRef,
        explicitOwner,
      );
      const revision = ++operationRevisionRef.current;

      try {
        const session = await getOrCreateSession(
          transport,
          owner,
          targetRef,
          passphrase,
          revision,
        );

        if (
          operationRevisionRef.current !== revision ||
          (owner && !isCurrentConnection(owner)) ||
          !isEncryptEnabled(project, owner)
        ) {
          throw new Error("Encrypted save cancelled or connection changed");
        }

        setStatus("encrypting");
        const { blob } = await encryptText(
          text,
          path,
          new Uint8Array(session.aesKey),
        );

        if (
          operationRevisionRef.current !== revision ||
          (owner && !isCurrentConnection(owner)) ||
          !isEncryptEnabled(project, owner)
        ) {
          throw new Error("Encrypted save cancelled or connection changed");
        }

        setStatus("uploading");
        const result = await transport.fsPutSave(
          targetRef,
          path,
          blob,
          session.sessionId,
        );

        setStatus(result.ok ? "done" : "error");
        if (!result.ok) {
          const msg = result.error ?? "Encrypted save failed";
          if (isTargetUnavailableError(result) || isProjectTargetError(msg)) {
            markProjectTargetUnavailable(targetRef);
            useEditorStore.getState().markTargetUnavailable(targetRef);
          }
          setError(msg);
          return { ok: false, error: msg };
        }

        return { ok: true, newMtime: result.newMtime };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Encrypted save failed";
        if (isTargetUnavailableError(e) || isProjectTargetError(msg)) {
          markProjectTargetUnavailable(targetRef);
          useEditorStore.getState().markTargetUnavailable(targetRef);
        }
        setStatus("error");
        setError(msg);
        clearSession(project, owner);
        return { ok: false, error: msg };
      }
    },
    [getOrCreateSession, clearSession, isEncryptEnabled],
  );

  const resetError = useCallback(() => {
    setError(null);
    setStatus("idle");
  }, []);

  return { uploadFile, saveText, status, error, resetError };
}
