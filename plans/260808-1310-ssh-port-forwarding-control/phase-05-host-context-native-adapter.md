# Phase 05: Browser-Safe Host Context and Ordered Native Adapter

## Context links

- [Plan](./plan.md)
- [Phase 02 contracts](./phase-02-native-contracts-persistence.md)
- [Phase 04 manager/IPC](./phase-04-native-manager-tauri-ipc.md)
- [Native codebase delta](./research/researcher-04-native-codebase-delta.md)
- [Native Browser Debug adapter pattern](../../apps/native/src/native-browser-debug-host.ts)
- [Shared host context pattern](../../packages/ui/src/contexts/BrowserDebugHostContext.tsx)
- [Server profile state](../../packages/ui/src/api/server-config.ts)

## Overview

- **Priority:** P1
- **Status:** Complete (100%)
- **Effort:** 10h
- **Description:** Add browser-safe host/context types, a 12-command desktop Tauri adapter, Rust-issued client context, caller-monotonic decimal activation tokens, authoritative hint reconciliation, profile-deletion purge, and browser/mobile zero-call behavior.

## Key Insights

- `apps/native/src/native-ssh-forward-host.ts` is the only SSH-forwarding frontend module allowed to import Tauri APIs; it is not the only Tauri adapter in the application.
- Adapter operation epochs discard late results, while Rust client epoch/activation ordering prevents late native side effects. Neither layer substitutes for the other.
- JavaScript must strict-parse canonical decimal counters to `BigInt` before compare/increment; JSON payloads remain strings. Lexicographic string comparison is prohibited.
- Same-document localStorage changes need explicit typed notifications, including deleted profile ID and whether the complete current profile list was read successfully.
- Webview unload unlistens only. Deactivation belongs to profile intent; app/window close belongs to Rust shutdown.

## Requirements

### Shared host and scalar contract

- Mirror all Phase 02 DTOs and the full Phase 03 error table exactly. `WireCounter` stays branded string; one strict helper validates canonical decimal and converts to/from `BigInt` only for local ordering.
- Define these host methods: `openClient`, `activateScope`, `snapshot`, profile create/update/delete, start/stop/restart, `listKeys`, `approveHost`, `purgeScope`, `subscribe`, `dispose`. The exact adapter command map has 12 entries and a test asserting no extra/missing name.
- Freeze the adapter invoke map: `openClient -> ssh_forward_open_client`, `activateScope -> ssh_forward_activate_scope`, `snapshot -> ssh_forward_snapshot`, `createProfile -> ssh_forward_create_profile`, `updateProfile -> ssh_forward_update_profile`, `deleteProfile -> ssh_forward_delete_profile`, `start -> ssh_forward_start`, `stop -> ssh_forward_stop`, `restart -> ssh_forward_restart`, `listKeys -> ssh_forward_list_keys`, `approveHost -> ssh_forward_approve_host`, `purgeScope -> ssh_forward_purge_scope`. `subscribe` and `dispose` are local adapter methods, not commands.
- Context default `{host:null,environment:{kind:"web"}}`; environment kind `web | nativeDesktop | nativeMobile`. No fake/no-op snapshot host.
- Shared package contains no `@tauri-apps/*`, platform probe, timer, invoke/listen, HTTP forwarding request, or WebSocket forwarding channel.

### Native open-client and activation ordering

- `createNativeSshForwardHost(platform)` returns host only for Windows/macOS/Linux Tauri desktop; Android/iOS/unknown/disabled/non-Tauri return null without invoking/listening.
- Initialization order: install `ssh-forward:changed` listener; read known `ServerProfile` UUIDs with availability status; invoke `ssh_forward_open_client`; validate desktop/manager/client context; set local activation counter to returned floor.
- For each activate/deactivate intent A/B/C, checked-increment local `BigInt`, serialize canonical decimal `activationToken`, and invoke immediately with current context. Do not queue activation behind an older slow activation.
- Track adapter operation ID/requested scope/token. Accept activation response only when context and exact token/requested scope match current operation. `ACTIVATION_SUPERSEDED` is control flow: fetch current activation/snapshot only if current operation still needs it; never show stale scope as an error.
- Same-scope reload opens a new Rust client epoch, issues token floor+1, receives existing runtime/listener, and does not invoke Start. Old adapter epoch responses/events are rejected.
- Manager-session mismatch clears context, re-opens client once, then re-activates current scope with a new token. Mutations are never automatically replayed; user reviews retry after snapshot.

### Command/snapshot/event reconciliation

- Every non-open command fills context, current activation token, scope ID/generation, and revisions/generation from cached authoritative snapshot; UI cannot supply them.
- Command snapshot is accepted only on exact desktop/manager/client/activation/scope match. Strict-parse Tauri errors; malformed objects become fixed `IPC_UNAVAILABLE` without raw detail.
- Hint is considered only on exact current `desktopInstanceId`, `managerSessionId`, `clientEpoch`, `activationToken`, and `scopeId`. Mismatch performs no refetch. After that identity gate, strict-parse scope/profile generations and revisions to `BigInt`; stale numeric values are ignored, otherwise schedule one in-flight snapshot plus one trailing refetch. Event never patches state and adapter filtering never replaces Rust authority.
- `dispose` invalidates operations and unlistens. It does not Stop/deactivate/purge; same-scope native runtime survives webview reload.

### ServerProfile synchronization and purge

- Add `readServerProfiles(): {status:"available";profiles:ServerProfile[]} | {status:"unavailable"}` without breaking existing fallback getters.
- Add typed subscription events: `{type:"activeChanged",activeProfileId:string|null}` and `{type:"deleted",deletedProfileId:string,knownProfileIds:KnownScopesInput}` after successful localStorage commit.
- Scope bridge mounts only with desktop host. It opens client with complete known scopes, activates current UUID/null, and sends refreshed known scopes on subsequent client reconciliation.
- On observed deletion: if deleted scope is active, await latest deactivate/new-scope activation; then invoke `purgeScope(deletedProfileId, availableKnownScopes)`. Inactive deleted scope purges directly. Unavailable profile read never purges or advances orphan aging.
- HTTP URL/hostname never crosses open/activation/purge IPC. Editing a ServerProfile URL emits no SSH profile mutation and does not re-activate unchanged UUID.

## Architecture

```text
server profiles available/unavailable + typed change/delete events
          |
SshForwardScopeBridge -> browser-safe SshForwardHost
          |
NativeSshForwardHost: listen -> open client -> A/B/C decimal tokens -> 12 invokes
          |
Rust manager authoritative ordering/snapshots

browser/native mobile -> null host -> no route/nav/listen/invoke/purge
```

Shared UI owns intent/public state. Adapter owns Tauri/context/token injection. Rust owns ordering/resources/persistence.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-host.ts` - DTOs, branded counter/timestamp/error parsers, 12-method host.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-host.test.ts` - Rust fixture parity and scalar/error tests.
- `G:\ws\sharing\dam-hopper\packages\ui\src\contexts\SshForwardHostContext.tsx` - nullable provider and scope/delete bridge.
- `G:\ws\sharing\dam-hopper\packages\ui\src\contexts\SshForwardHostContext.test.tsx` - activation/purge/unavailable/absent-host tests.
- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward.ts` - authoritative snapshot/mutation state.
- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward.test.tsx` - conflict/refetch/no-replay tests.
- `G:\ws\sharing\dam-hopper\apps\native\src\native-ssh-forward-host.ts` - sole SSH-forward Tauri adapter and token ordering.
- `G:\ws\sharing\dam-hopper\apps\native\src\native-ssh-forward-host.test.ts` - 12 commands, A/B/C, reload, hint, purge, mobile tests.

### Modify

- `G:\ws\sharing\dam-hopper\packages\ui\src\api\server-config.ts` - available/unavailable read and typed active/delete subscriptions only.
- `G:\ws\sharing\dam-hopper\packages\ui\src\api\server-config.test.ts` - commit events, read failure, deletion identity.
- `G:\ws\sharing\dam-hopper\packages\ui\src\embed\dam-hopper-app.tsx` - export provider and mount bridge only with host.
- `G:\ws\sharing\dam-hopper\apps\native\src\main.tsx` - desktop host composition, mobile null, unload unlisten.
- `G:\ws\sharing\dam-hopper\apps\native\package.json` - native Vitest script/dependency.
- `G:\ws\sharing\dam-hopper\pnpm-lock.yaml` - test dependency lock.

### Delete

- None.

## Implementation Steps

1. Mirror exact decimal/timestamp/profile/runtime/challenge/error fixtures; reject unsafe JSON numbers for all unbounded counters.
2. Implement nullable context and typed server-profile available/unavailable/change/delete events. Verify storage failure cannot look like authoritative empty list.
3. Implement desktop factory and exact 12-command map. Listener installs before open-client; mobile/non-Tauri perform zero calls.
4. Implement open-client context validation and checked caller activation token. Issue A/B/C immediately; local operation gate rejects late responses.
5. Implement manager restart reopen/re-activate without mutation replay; same-scope reload must preserve native worker/listener.
6. Centralize command input binding and snapshot validation. Strict error parser maps unknown objects to fixed error without logging raw payload.
7. Implement hint single-flight/trailing refetch bound to manager/activation/scope generations.
8. Implement observed deletion sequence: deactivate if needed, then inactive purge with available known list. Cover purge failure without resurrecting deleted browser profile.
9. Add tests: delayed A after B/C; A response after new client epoch; numeric `9 -> 10` and `99 -> 100` activation/revision/generation comparisons; decimal overflow; manager restart; hints with wrong client epoch/token/scope and duplicate/reordered hints; unavailable known scopes; active/inactive delete purge; URL edit no mutation; unload no Stop; Android/iOS zero calls.

## Todo list

- [ ] Shared package has no SSH-forward Tauri import.
- [ ] Adapter map contains exactly all 12 commands.
- [ ] All unbounded counters stay decimal strings across JSON.
- [ ] A/B/C and reload operation gates match Rust ordering.
- [ ] Counters compare numerically after parsing; 9/10 and 99/100 boundaries pass.
- [ ] Manager restart reopens context without mutation replay.
- [ ] Observed deletion deactivates then purges; unavailable read never purges.
- [ ] Same-scope reload invokes no Start and preserves listener.
- [ ] Browser/mobile invoke/listen/host/network call counts stay zero.
- [ ] Wrong client-epoch/activation/scope hint causes zero refetches.

## Success Criteria

- `pnpm --filter @dam-hopper/native test`
- `pnpm --filter @dam-hopper/ui test -- src/lib/ssh-forward-host.test.ts src/contexts/SshForwardHostContext.test.tsx src/hooks/use-ssh-forward.test.tsx src/api/server-config.test.ts`
- `pnpm --filter @dam-hopper/native build`
- A/B/C adapter response schedules never publish A/B after C becomes current; Rust race suite independently proves side effects.
- Android/iOS tests assert mocked `listen`, all 12 `invoke` names, REST, and WS forwarding counters remain zero.
- Deleting active scope proves activation null/new scope finishes before purge call; localStorage unavailable produces neither purge nor orphan aging.

## Risk Assessment

- **Late native side effect:** Rust ordering is authoritative; adapter response gate adds UI consistency only.
- **Counter precision:** Branded decimal strings plus strict BigInt adapter helper; no `Number` conversion.
- **Accidental purge on storage failure:** Explicit available/unavailable result and deletion event identity.
- **Snapshot herd:** One in-flight plus one trailing refetch.
- **Unload kills runtime:** Dispose only unlistens; Tauri close/exit owns shutdown.

## Security Considerations

- Components cannot forge desktop/context/scope/token fields or raw invoke payloads.
- Host caches public endpoints/fingerprints only; no password/passphrase/key bytes/path/HTTP token.
- Unknown IPC objects and raw errors are discarded, not interpolated into UI/logs.
- Protected server port-forward, PTY, SSH API, query, and WS files remain untouched.

## Acceptance

- Final independent review: 8.8/10, conditional accept; no critical findings.
- UI tests: 981/981 passed.
- Native tests: 17/17 passed.
- Builds passed; lint passed with 0 errors and 0 warnings.
- `cargo fmt`, `cargo check`, and `cargo clippy` passed.
- Diff check passed.
- Windows native runtime validation is now covered by Phase 04; the `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND` loader issue was fixed with the native Common Controls v6 manifest.
- Root `pnpm test` also reports unrelated `windows_by_handle` `E0658`; neither issue is attributed to this phase.
- This acceptance does not claim feature or release readiness.

## Next steps

- Phase 06 gates route/navigation on this non-null desktop host and uses exact fixed errors/remediation.
- Phase 07 validates adapter/native A/B/C ordering and observed/unobserved scope cleanup in packaged builds.

### Unresolved Questions

- Which desktop OS/agent combinations can remain release-supported after the Phase 01 dependency gate and Phase 07 packaged evidence are complete?
