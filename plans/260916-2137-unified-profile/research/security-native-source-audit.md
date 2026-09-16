# Security and native source audit

Date: 2026-09-16. Read-only audit; no runtime verification or application changes.

## Observed

- `server/src/fs/media_session.rs:9–12,78–101`: fixed hostname/path media cookie; duplicate selected-cookie values fail closed. `api/media_session.rs:12–30`: revocation selects/clears the fixed cookie.
- `api/fs_image.rs:53–120`, `api/fs_video.rs:50–130`: fixed cookie and `session-cookie-v1`. `fs/media_ticket.rs`: actor/session binding, no namespace. `api/media_stream_response.rs`: fixed-cookie selection and configured-origin fallback.
- `server/src/api/browser_debug.rs:28–46,76–118`: raw-ID is_alive checks separated from asynchronous artifact creation and later raw-ID write. `pty/manager.rs:1733+` has write admission; separate is_alive cannot provide atomic incarnation protection.
- Native `ssh_forward/manager.rs`: active_scope singleton, raw runtime map, open_client epoch transition, global stop during activation, scope validation and global cleanup. `commands.rs` exposes activate-scope; model/permission surface follows singleton contract.
- `ssh_forward/mod.rs` gates manager/commands behind Windows. Linux does not execute this implementation.
- Parent inspected `packages/ui/vitest.browser.config.ts:18–60,143–177`: existing browser media fixture is fixed-cookie/v1; must migrate its explicit protocol branches too.

## Required gates

1. Required media-v2-only issue/revoke/stream paths; ticket chooses trusted namespace; actor+namespace authorization; raw-header duplicate detection; concurrent same-host ports and same-origin profiles; invalid UUID/wrong actor/expired ticket negatives.
2. User validated breaking cutover: delete v1 compatibility, require new status protocol marker and namespace/incarnation fields. Old requests are negative tests; blocked-cookie behavior still requires real browser evidence.
3. Artifact creation requires matching expected incarnation, captures/returns it and stores it. Missing field fails validation before persistence. Atomic write admission rejects replacement terminal without changing its input bytes/revision.
4. Native scope maps and admission refactor together. Scoped teardown preserves peers; real epoch/shutdown tears down all. Keep global quotas, local-port exclusivity, main-window/platform guards and exact command permission allowlist.

## Scout suggestion corrected

The scout proposed idempotent openClient/reconcile within an epoch. Source and preplan instead make openClient a real epoch transition. Plan retains that transition; host calls once per lifetime. Only openScope-current and known-scope reconciliation are idempotent within the epoch.

## Questions resolved

- Cookie selection: stored v2 ticket namespace only; fixed legacy cookies ignored, never authorization fallback.
- Old artifact client: unsupported; omitted incarnation rejected. Auth status marker 2 is the new client’s pre-WS protocol admission requirement.
- Explicit Disconnect/Logout/Remove/endpoint replacement closes own native scope; transient backend socket outage does not. Unavailable storage pauses deletion reconciliation.

Web release may proceed after its own common/browser/security gates; Windows/native remains blocked until real native qualification.

## Unresolved questions

Execution prerequisites only: which Windows runner/device and disposable SSH endpoints will supply S13, and which browser environment supplies actual blocked-cookie/capture qualification. Not tested or claimed available in this audit.
