import { useEffect, useRef, useState } from "react";
import { AuthClientError, listAuthSessions, revokeAuthSession, type AuthSessionInfo } from "@/api/auth-client.js";
import {
  completeLoginDeviceSelfRevoke, isLoginDevicesOwnerCurrent, isLoginDevicesOwnerRetired,
  isLoginDevicesOwnerTargetCurrent,
  type LoginDevicesOwner,
} from "./login-devices-owner.js";

export function useLoginDevices(
  owner: LoginDevicesOwner | null,
  onSelfRevoked?: (owner: LoginDevicesOwner) => void,
) {
  const [state, setState] = useState({
    owner, rows: [] as AuthSessionInfo[], cursor: null as string | null,
    loading: false, error: null as string | null, unavailable: false,
    mutationError: null as string | null, pending: null as string | null,
    cleanupRequired: false,
  });
  const [confirmation, setConfirmation] = useState<AuthSessionInfo | null>(null);
  const work = useRef<{
    owner: LoginDevicesOwner; active: boolean; listId: number; list?: AbortController;
    mutation?: { controller: AbortController; self: boolean };
    selfAcknowledged?: boolean;
  } | null>(null);

  useEffect(() => {
    setConfirmation(null);
    setState({ owner, rows: [], cursor: null, loading: false, error: null,
      unavailable: false, mutationError: null, pending: null, cleanupRequired: false });
    if (!owner || (owner.authType === "basic" && !owner.token)) return;
    const captured = { owner, active: true, listId: 0 } as NonNullable<typeof work.current>;
    work.current = captured;
    void load(null, captured);
    return () => {
      captured.active = false;
      captured.list?.abort();
      // Keep only same-target self acknowledgements across credential retirement.
      // Close/profile switch while still current, URL edits and deletion cancel.
      if (!captured.mutation?.self || isLoginDevicesOwnerCurrent(owner) ||
          !isLoginDevicesOwnerTargetCurrent(owner)) {
        captured.mutation?.controller.abort();
      }
      if (work.current === captured) work.current = null;
    };
  }, [owner]);

  async function load(cursor: string | null, captured = work.current) {
    if (!captured?.active || !isLoginDevicesOwnerCurrent(captured.owner) || captured.mutation || captured.selfAcknowledged) return;
    captured.list?.abort();
    const controller = new AbortController();
    captured.list = controller;
    const id = ++captured.listId;
    const current = () => captured.active && captured.listId === id &&
      isLoginDevicesOwnerCurrent(captured.owner);
    setState((previous) => ({ ...previous, loading: true, error: null,
      mutationError: null, ...(cursor === null ? { rows: [], cursor: null } : {}) }));
    try {
      const page = await listAuthSessions(captured.owner.serverUrl, captured.owner.token, cursor, controller.signal);
      if (!current()) return;
      if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error("Server returned a repeated cursor. Refresh the list.");
      setState((previous) => {
        const rows = new Map((cursor === null ? [] : previous.rows).map((row) => [row.id, row]));
        for (const row of page.sessions) rows.set(row.id, row);
        return { ...previous, rows: [...rows.values()], cursor: page.nextCursor, unavailable: false };
      });
    } catch (error) {
      if (!current() || controller.signal.aborted) return;
      setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : "Login devices request failed",
        unavailable: error instanceof AuthClientError && error.code === "DEVICE_SESSIONS_UNAVAILABLE" }));
    } finally {
      if (current()) setState((previous) => ({ ...previous, loading: false }));
    }
  }

  async function revoke() {
    const captured = work.current;
    const row = confirmation;
    if (!captured?.active || !row || captured.mutation || captured.selfAcknowledged || !isLoginDevicesOwnerCurrent(captured.owner)) return;
    const controller = new AbortController();
    captured.mutation = { controller, self: row.current };
    captured.list?.abort();
    ++captured.listId;
    setState((previous) => ({ ...previous, pending: row.id, mutationError: null, loading: false }));
    const current = () => captured.active && isLoginDevicesOwnerCurrent(captured.owner);
    try {
      await revokeAuthSession(captured.owner.serverUrl, captured.owner.token, row.id, controller.signal);
      if (controller.signal.aborted) return;
      if (row.current) {
        captured.selfAcknowledged = true;
        // ACK invalidates this credential's dialog draft even if WS retirement or
        // a replacement login already retired the section. It grants no cleanup
        // authority over the replacement runtime or persisted credential.
        onSelfRevoked?.(captured.owner);
        if (captured.active || isLoginDevicesOwnerRetired(captured.owner)) {
          completeLoginDeviceSelfRevoke(captured.owner);
        }
      }
      if (controller.signal.aborted ||
          (!captured.active && !isLoginDevicesOwnerRetired(captured.owner))) return;
      if (!current()) return;
      setState((previous) => ({ ...previous, rows: previous.rows.filter((item) => item.id !== row.id) }));
      setConfirmation(null);
    } catch (error) {
      if (!current() || controller.signal.aborted) return;
      setState((previous) => ({ ...previous, cleanupRequired: Boolean(captured.selfAcknowledged),
        mutationError: error instanceof Error ? error.message : "Login devices request failed" }));
      setConfirmation(null);
    } finally {
      captured.mutation = undefined;
      if (current()) setState((previous) => ({ ...previous, pending: null }));
    }
  }

  function retryCleanup() {
    const captured = work.current;
    if (!captured?.active || !captured.selfAcknowledged || !isLoginDevicesOwnerCurrent(captured.owner)) return;
    try {
      completeLoginDeviceSelfRevoke(captured.owner);
    } catch (error) {
      if (captured.active && isLoginDevicesOwnerCurrent(captured.owner)) {
        setState((previous) => ({ ...previous, mutationError: error instanceof Error ? error.message : "Unable to remove the revoked login locally" }));
      }
    }
  }

  // Rendering never exposes the previous owner's rows while effects retire it.
  const visible = state.owner === owner ? state : {
    ...state, rows: [], cursor: null, loading: Boolean(owner), error: null,
    unavailable: false, pending: null, mutationError: null, cleanupRequired: false,
  };
  return { ...visible, confirmation: state.owner === owner ? confirmation : null,
    confirm: setConfirmation, revoke, retryCleanup, refresh: () => load(null), more: () => load(visible.cursor) };
}
