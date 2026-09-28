# Brainstorm review — agent status, OMP first

Date: 2026-09-28. Status: reviewed for planning; implementation not started.

## Verdict

Keep the report's direction: agent-neutral semantic state, OMP first adapter, server-owned state, badges/notifications only. Do not port Herdr's terminal runtime or screen parser now. The report was a feasibility artifact, not an executable implementation contract.

User decisions during planning:
- Install the guarded adapter once per OMP profile; ordinary `omp` launches then work inside dam-hopper.
- Notifications are per browser client; no cross-device exactly-once guarantee or closed-browser delivery.
- Linux first; portable protocol and preserved Windows compilation, not an untested Windows runtime claim.
- Status runtime belongs inside `dam-hopper-server`. Bundle extension source in that binary; extension executes inside OMP after explicit installation. No Herdr or separate daemon.

## Findings and corrections

1. **Keep identity boundaries.** `server/src/pty/activity.rs:23-43`, `server/src/pty/session.rs:94-129`, `packages/ui/src/api/ownership.ts` already distinguish public terminal ID from incarnation and owning profile. Add agent/run identity; do not key new state by bare terminal ID.
2. **Do not persist injected capabilities.** `RespawnOpts.env` exists (`server/src/pty/session.rs:72-87`). Initial spawn and respawn separately apply environments (`manager.rs:1465-1470,4188-4193`). Inject freshly minted private reporter credentials into `CommandBuilder` only, after user environment merging; cover both paths and restore through create. No credentials in metadata, user env templates or persistence.
3. **PTY exit alone is insufficient.** OMP can exit inside a still-live shell. Its reporting connection must own a revocable lease. Disconnect/timeout means unknown/unavailable, never successful completion.
4. **Use explicit settled-turn evidence.** Herdr's done projection is not task success. Current OMP `AgentEndEvent` has `messages` and optional `willContinue` (`.../coding-agent/src/extensibility/shared-events.ts:194-204`); installed runtime emits this after maintenance decisions (`.../session/agent-session.ts:4558-4563`). Do not infer completion from idle snapshots or a socket close.
5. **Prefer current OMP retry events over copied error regex.** Current OMP types export `AutoRetryStartEvent/AutoRetryEndEvent` (`.../extensions/types.ts:879-888`). The report's 250 ms/2.5 s values accurately describe the previously inspected Herdr extension; they are not a requirement to duplicate heuristic provider-error matching.
6. **Blocker accounting must be keyed.** Approval events contain `sessionId`, `toolCallId`, `toolName`; resolution includes `approved` (`.../extensions/types.ts:978-994`). Ask execution start/end carry `toolCallId` (`:852-877`). Use sets keyed by session plus category plus tool call, not increment/decrement counters vulnerable to duplicate events.
7. **Shutdown is best effort.** OMP runner bounds shutdown handlers at two seconds and teardown is fire-and-forget (`.../extensions/runner.ts:119-137`). Use socket closure and bounded heartbeat lease in addition to explicit release.
8. **Compatibility is not a historical minimum claim.** `omp --help` observed 18.3.5. Use it as the initial qualification target; do not claim every older/newer OMP version compatible. Version output alone does not prove deployed event behavior.
9. **Installer needs active-profile awareness.** OMP native discovery uses active profile agent directory and honors `PI_CODING_AGENT_DIR`; named profiles use `~/.omp/profiles/<name>/agent/extensions`. Explicit `-e` also works with `--no-extensions` (OMP extension-loading documentation). Do not reproduce an older resolver using only `PI_CONFIG_DIR`.
10. **Do not add this to the release-manager command.** `server/src/bin/dam-hopper.rs:1-29` is Linux release administration with privilege checks. Put local integration install/status/uninstall subcommands on `dam-hopper-server`, dispatching before database/config/server startup.
11. **Existing notification ownership needs a focused correction.** `browser-notification-service.ts:84-98` keys rate limiting and browser tags by raw session ID/source. Generalizing this shared path must qualify profile/incarnation so equal terminal IDs on different servers cannot suppress each other. Preserve legacy Codex OSC9 functionality.
12. **No rendered server-side terminal today.** `server/src/pty/buffer.rs:1-6` stores raw bytes. Codex screen support later is a separate adapter/rendering project, not part of initial delivery.

## Workflow provenance

Loaded native planning skill and `/cmd-plan__hard` template from `~/.omp/agent/`. This tool session exposes no slash-command dispatch API; hard-planning workflow is followed inline, not falsely reported as a dispatched slash command. Two bounded research slices reviewed OMP lifecycle and frontend ownership; parent owns design and all plan files. No implementation delegation.

## Evidence boundary

Previous report's upstream classifier/extension smoke is retained as historical evidence; not rerun. This planning session inspected source and ran `omp --help`; no app behavior was changed or validated. Final document checks will validate plan frontmatter, phase links, scope and scenario coverage only.

## Unresolved questions

No unresolved product decisions. Exact OMP fields confirmed before phase creation: `AgentEndEvent.willContinue` and retry start/end in `coding-agent/src/extensibility/shared-events.ts:194-204,244-269`; `StopReason` in `ai/src/types.ts:928`; nested shell `OMPCODE=1` in `utils/src/procmgr.ts:31-40`; app-root bridge host in `packages/ui/src/embed/dam-hopper-app.tsx:342-355`. Full live OMP event/reload behavior remains an implementation qualification gate, not a planning-time success claim.
