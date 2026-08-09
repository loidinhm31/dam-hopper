# Phase 06: Desktop-Only Control Surface

## Context links

- [Plan](./plan.md)
- [Phase 05 host integration](./phase-05-host-context-native-adapter.md)
- [Architecture correction](./reports/02-native-ipc-architecture-correction.md)
- [Shared app routes](../../packages/ui/src/embed/dam-hopper-app.tsx)
- [Navigation registry](../../packages/ui/src/lib/navigation.ts)
- [Component standards](../../docs/code-standards.md#component-structure)

## Overview

- **Priority:** P2
- **Status:** Pending
- **Effort:** 10h
- **Description:** Add the host-gated SSH forwarding page, explicit profile form, lifecycle controls, key inventory selection, host-fingerprint approval, and security-boundary copy.

## Key Insights

- Capability hiding must occur at route and navigation construction, not after a page makes a failed call.
- The active HTTP server profile is only a create-form convenience. It is not native state and must never resynchronize a saved SSH endpoint.
- Generic TCP forwarding cannot authenticate local clients. The UI must state that other local desktop processes can use the bound port.
- Unknown-key approval is explicit and separate from Start; changed-key failure offers no approve/replace button.
- Conflicts and active-profile updates require deliberate user retry/Stop-then-Edit, not silent mutation.

## Requirements

### Availability and routing

- Route is exactly `/ssh-forwarding`; navigation label `SSH FORWARDS` appears only when `useSshForwardHost().host` is non-null and environment is `nativeDesktop`.
- Conditionally register the route and nav entry. Browser/native mobile direct navigation has no matching route, mounts no page/hook, and performs zero host/Tauri/server calls.
- Do not add `useQuery`, `api`, `WsTransport`, REST path, WebSocket message, server capability, or feature flag.

### Profile list and lifecycle

- Page shows current scope only: profile name, `127.0.0.1:localPort`, explicit `sshUser@sshHost:sshPort`, fixed remote `127.0.0.1:targetPort`, auth mode, runtime decimal generation, retry attempt, auto-start disposition, and exact Phase 03 error copy.
- Actions use snapshot generation: Start, Stop, Restart. Disable incompatible operations while a mutation is pending. Idempotency remains native-authoritative.
- Edit/Delete on active state first explains `Stop before editing/deleting`; user performs Stop as a separate action. No combined hidden stop/update.
- Auto-start and bounded reconnect toggle/max attempts are explicit. `skippedActiveLimit` is visibly stopped with the fixed code and an explicit later Start path. No arbitrary target host, remote/SOCKS/wildcard/IPv6/password/arbitrary-option controls.
- Surface active limit, port-in-use, agent unavailable, encrypted-key-agent instruction, remote refusal, and timeout codes with actionable fixed copy. Never render raw source error.

### Create/edit form

- New form reads the current `ServerProfile` once on open. Parse `new URL(profile.url).hostname`; if valid safe ASCII/non-IPv6, prefill `sshHost`; otherwise leave blank. Prefill `sshPort=22`, render immutable remote target `127.0.0.1`, set `auth.mode="agent"`, reconnect enabled/max 5. Local/target ports remain explicit required fields.
- Display “Defaulted from <profile name>; review before saving.” Require an unchecked `I reviewed the SSH endpoint` confirmation. Editing host/port does not remove the requirement.
- Save sends explicit values only after validation. Saved profile never keeps a `defaultSource`, HTTP URL, or live link. Reopening Edit reads native snapshot only; later HTTP URL/hostname changes cannot rewrite it.
- Edit endpoint changes require review again. Name/user <=64; SSH host <=253 safe ASCII; every port integer `1..65535`; local bind and remote target hosts display immutable `127.0.0.1` and are absent from editable request fields.
- Auth defaults agent. Optional key mode calls inventory on demand and stores only selected opaque `keyId`; no path input/drop zone/file picker/passphrase/password field.
- If no safe unencrypted keys exist, instruct user to load an encrypted key in the OS agent. Do not offer keychain or passphrase prompt.

### Trust and local security copy

- Unknown-key runtime failure with challenge opens a modal showing canonical SSH endpoint, algorithm, SHA-256 fingerprint, expiry, and warning to verify out of band. Approval sends the displayed algorithm and exact canonical fingerprint; success states “Approved; press Start to connect” and never auto-starts.
- Changed key/algorithm shows the exact Phase 03 blocking copy plus the runtime-resolved Tauri app-config trust path and a copyable maintenance command built from the signed current executable, scope UUID, canonical host, and port—never a user-supplied filesystem path. It explains backup ID/recovery, optional quarantine, full quit/runtime-lock requirement, unknown challenge, exact approval, and explicit Start. No “trust anyway,” replace, delete-known-host, or hidden override action exists; UI never edits trust storage.
- In-app updater/restart/relaunch controls are absent in v1. `createUpdaterArtifacts` is packaging metadata only; any future control stays hidden/blocked until it uses the native disposal coordinator and passes packaged closure proof.
- Persistent callout near every local endpoint: “Any process on this computer can connect to 127.0.0.1:<port> and use this forward. Loopback prevents LAN access; it does not isolate other local processes.”
- Copy must not claim encryption between the local process and listener; SSH protection begins inside the native client toward the SSH server.

## Architecture

```text
host exists? --no--> no nav, no route, no component, no calls
     |
    yes
     v
SshForwardingPage -> useSshForward -> SshForwardHost -> native adapter
     | create/edit dialog (explicit values)
     | host-key approval dialog (unknown only)
     ` lifecycle buttons (snapshot revision/generation)
```

React local state holds only current form/public challenge/status data. Authoritative profiles/runtime live in the latest native snapshot.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\packages\ui\src\components\pages\SshForwardingPage.tsx` - scoped profile/runtime list and lifecycle actions.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\pages\SshForwardingPage.test.tsx` - availability, lifecycle, conflict, limitation copy tests.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardProfileDialog.tsx` - reviewed explicit profile form and key inventory.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardProfileDialog.test.tsx` - defaults, validation, no silent resync, secret-input absence tests.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshHostKeyApprovalDialog.tsx` - unknown fingerprint verification and changed-key hard-fail presentation.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshHostKeyApprovalDialog.test.tsx` - approve/retry/manual-remediation behavior.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-availability.browser.tsx` - desktop-host route/nav and browser/mobile zero-call regression.

### Modify

- `G:\ws\sharing\dam-hopper\packages\ui\src\embed\dam-hopper-app.tsx` - lazy page and conditional route only when desktop host exists.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\navigation.ts` - separate SSH-forward nav entry/filter helper.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\TopNavRouteMenu.tsx` - choose host-aware entries for desktop and compact menus.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\TopNav.tsx` - pass/use host capability without server request.

### Delete

- None.

## Implementation Steps

1. Add a pure `getNavEntries({sshForwardHostAvailable})` helper and conditional lazy route. Test absent host before implementing page behavior.
2. Build page from `useSshForward` snapshot. Join profiles/runtimes by profile ID; do not copy profiles into a second persistent store or TanStack Query.
3. Implement the complete fixed Phase 03 error/retry/message presentation and state-aware buttons. Keep decimal revision/generation strings opaque; surface conflict-refetched state with explicit retry.
4. Build new form defaults from active server profile only at dialog-open initialization. Track endpoint review locally; validate integers/ASCII/bounds before host call.
5. Build edit form from saved native profile only. Add regression: change `ServerProfile.url` after snapshot, rerender/reopen, and assert saved host/port and outgoing update remain unchanged unless user edits them.
6. Load safe key inventory only after key mode selection. Render opaque selection labels; omit path/file/password/passphrase/keychain UI and redact error handling.
7. Implement host-key modal. Unknown approval echoes exact algorithm/fingerprint and current decimal generation; after approval close with explicit Start prompt. Changed-key view has no approval callback/button and shows exact resolved path/command, protected backup/quarantine/recovery, and offline removal/reapproval procedure.
8. Add permanent local-process/loopback limitation copy and targeted accessibility labels, focus restoration, keyboard navigation, and pending/error announcements.
9. Add JSDOM and Chromium coverage for route/nav gating, form validation, host trust, lifecycle, compact navigation, and zero calls without host.

## Todo list

- [ ] `/ssh-forwarding` route/nav exist only for `nativeDesktop` non-null host.
- [ ] New form defaults host once, port 22, immutable target `127.0.0.1`, and requires review.
- [ ] Port 0, IPv6, wildcard, invalid/decimal/out-of-range ports rejected.
- [ ] Saved endpoint never follows HTTP profile URL edits.
- [ ] Agent preferred; key mode exposes opaque safe inventory only.
- [ ] Unknown approval echoes exact fingerprint and does not auto-start; changed key/algorithm has no override.
- [ ] Changed-key copy/path/command matches the stopped-app maintenance contract on each OS.
- [ ] No updater/restart/relaunch UI is exposed.
- [ ] Deterministic auto-start skipped state and explicit later Start are visible.
- [ ] Stop-then-Edit/Delete is explicit.
- [ ] Other-local-process limitation is visible and exact.
- [ ] Browser/native mobile tests prove zero host/Tauri/server calls.

## Success Criteria

- `pnpm --filter @dam-hopper/ui test -- src/components/pages/SshForwardingPage.test.tsx src/components/organisms/SshForwardProfileDialog.test.tsx src/components/organisms/SshHostKeyApprovalDialog.test.tsx`
- `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/ssh-forward-availability.browser.tsx`
- `pnpm --filter @dam-hopper/ui build`
- Browser/mobile render contains neither `SSH FORWARDS` nor matching route; host/Tauri/network spies remain zero.
- Desktop create -> approve unknown host -> explicit Start -> Running -> Stop journey works from authoritative snapshots.
- UI source and rendered form contain no password/passphrase/key path/keychain/general SSH option input.
- Changed-key UI snapshot contains the exact blocking copy, Tauri-resolved path/maintenance command, backup recovery, and no approval callback.

## Risk Assessment

- **Conditional nav/route diverge:** Drive both from one context predicate/helper and test full/compact menus.
- **Default becomes hidden coupling:** Initialize only on new dialog open; never subscribe form endpoint to profile URL.
- **Approval click races restart:** Current challenge/generation is required; native rejects stale approval and hook refetches.
- **Dense form confuses users:** Group SSH endpoint, local listener, fixed remote-loopback target port, and auth; keep advanced reconnect bounded.
- **Security copy omitted in responsive layout:** Assert callout in desktop and compact Chromium views.

## Security Considerations

- Browser capability absence is enforced structurally: no route/hook/adapter call, not a disabled button that can be bypassed.
- Fingerprint challenge shows only public verification data; errors never show full public key, path, username, or target payload.
- UI validation improves feedback; Rust remains authoritative for every field and lifecycle precondition.
- Never reuse existing Git passphrase dialogs or server `/api/ssh/*` credentials for native forwarding.

## Next steps

- Phase 07 validates the full journey with real SSH/target services and packaged Tauri binaries on all three desktop OSes.
- Capture security-boundary and host-key evidence in release smoke artifacts, not source docs during this planning task.

### Unresolved Questions

- Exact platform-specific config paths and atomic stopped-app edit commands shown in remediation copy remain gated on Phase 03/07 verification.
