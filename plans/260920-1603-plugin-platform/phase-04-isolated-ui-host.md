# Phase D04 — Isolated plugin UI host and dynamic navigation

## Context Links

- [Plan](plan.md)
- [D00 contracts](phase-00-contracts-and-feasibility.md)
- [D03 authorized API](phase-03-authorized-api.md)
- [Shared UI isolation contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#package-ui-isolation-and-activation)
- [Repository evidence](reports/repository-analysis.md)
- Existing UI paths: [`dam-hopper-app.tsx`](../../packages/ui/src/embed/dam-hopper-app.tsx), [`navigation.ts`](../../packages/ui/src/lib/navigation.ts), [`TopNavRouteMenu.tsx`](../../packages/ui/src/components/organisms/TopNavRouteMenu.tsx), [`connections.ts`](../../packages/ui/src/api/connections.ts)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Dependencies:** G1, D03 and E03 bridge/view implementation. May proceed in parallel with D05 after G1.
- **Gate contribution:** D04 + E03 demonstrate all four owner-data views through an isolated iframe on a real separate LAN browser at G2. G2 need not wait for D05 management polish.
- **Effort:** Unestimated.

Add a host-owned plugin route, inert protected asset transport, opaque sandboxed iframe and capability bridge. Navigation follows the active authenticated connection/project and installation state. The iframe never receives credentials, transport objects, source paths or direct network authority.

## Key Insights

- Plugin HTML must not enter the existing SPA/static-file path: a normal `text/html` response can execute on the DamHopper origin during direct navigation.
- Opaque `srcdoc` produces `origin: null`; origin comparison cannot authenticate it. Identity comes from the exact iframe `WindowProxy`, a random one-use nonce, transferred `MessagePort` and explicit port acknowledgement.
- CSP inside a package is untrusted input. The host must construct and inject a restrictive CSP before any plugin code.
- Navigation visibility is contextual. Absent entitlement hides an item; installed disabled/incompatible/failed states stay visible with explicit status rather than silently disappearing.
- Focus must not create extra API/WebSocket transports. Plugin calls reuse the active owner-bound client from D03.

## Requirements

### Protected inert asset transport

1. Add an authenticated endpoint keyed by installation ID, active package digest and activation generation. Reauthorize actor/target visibility, invoke the generic runner `plugin.readUi` operation for that exact approved version, and return only those bytes; ordinary list calls remain metadata-only.
2. Serve bytes as `application/octet-stream` with `X-Content-Type-Options: nosniff`, restrictive download disposition, private/no-store or digest-safe immutable caching, and no SPA fallback. Reject stale generation/digest and direct executable rendering paths.
3. Fetch through the owner-bound host client. Server-side, enforce <=5 MiB raw UI and the encoded frame cap; verify length/digest against runner metadata. Browser host rechecks length/digest and decodes only as strict UTF-8. Never let the iframe fetch package files directly.
4. Parse/sanitize the package document under the G0 UI contract. Reject external URLs, navigation, forms, base tags, inline event handlers, workers, popups and undeclared resources.
5. Construct CSP at the host boundary before plugin code. Baseline: `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; allow only exact hashed script/style and explicitly bounded embedded data resources frozen at G0. No `unsafe-eval` or remote source.

### Frame and bridge isolation

6. Create an iframe solely with `srcdoc` and exactly `sandbox="allow-scripts"`; do not add same-origin, forms, popups, downloads, top-navigation, storage or presentation permissions.
7. For each frame generation create a cryptographically random nonce and retain the exact `contentWindow` `WindowProxy`. Accept one bootstrap message only from that window with the matching nonce.
8. Transfer a fresh `MessageChannel` port once. Require a schema/version/nonce acknowledgement on the port before opening context or sending data. After transfer, reject all window messages for data/control.
9. Validate every bridge envelope, operation, sequence, request ID and byte/item bound before D03 invocation. Expose only the frozen bridge capabilities required by E03; no generic fetch, URL, filesystem, token, DOM or transport handles.
10. Treat the expected initial `srcdoc` load as bootstrap, not revocation: bind its document generation, complete load, then establish the nonce/port handshake. Revoke/close port and D03 context on every subsequent iframe reload/navigation, component unmount, profile/project/worktree switch, connection generation/API epoch change, grant/install activation change, worker failure or auth loss.
11. Tag bridge replies/events with frame and installation generation. Drop late/mismatched replies and settle each accepted iframe request exactly once.
12. Treat `origin: null` as expected opaque behavior, never identity. CSP/sandbox/nonce/WindowProxy/one-use port are all required layers.

### Navigation and user experience

13. Add host-owned route `/plugins/:installationId`; installation metadata selects the approved package, not an arbitrary route/path supplied by the frame.
14. Insert dynamic plugin navigation into the existing top-level navigation for the active connection/project. Entitlement absence hides it; disabled, incompatible, failed, updating or unavailable states render an explicit non-executable state.
15. Switching owner/project/worktree tears down old frame/context before rendering the new selection. Browser local `profileId` and generation never cross the bridge.
16. Preserve keyboard focus, landmarks, accessible status/error text, compact/desktop layouts and deterministic loading/cancellation states for E03's Overview, History/detail, Configuration and Evaluations views.
17. Focusing/reopening a plugin route reuses the current owner connection; no duplicate WebSocket or REST client is created.

## Architecture

```text
protected octet-stream bytes ── host digest/CSP validation ── srcdoc sandbox
                                                               │ bootstrap only
host PluginFrame ── WindowProxy + nonce ── one-use MessagePort ◄┘
       │
       └─ schema/bounds/generation ── owner-bound D03 ApiClient ── runner
```

`PluginFrame` owns one `FrameSession` state machine: `Fetching → LoadingInitialDocument → Bootstrapping → AwaitingPortAck → Ready → Revoked`. Only the expected first document load advances bootstrap; a later load or owner/security generation change revokes it. A replacement session uses new bytes, nonce, port and context. The plugin never receives an endpoint URL or credential. Gate G0 qualifies the exact load/handshake ordering so initial load cannot kill the legitimate port or let a navigated document inherit it.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/server/src/api/plugin_assets.rs` — protected inert byte endpoint with digest/generation checks.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/plugins/bridge-host.ts` — nonce/WindowProxy/port state machine, validation and cancellation.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/plugins/bridge-validators.ts` — frozen envelope/capability schemas and bounds.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/plugins/use-plugin-navigation.ts` — owner/project-scoped visible installation/navigation model.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/PluginFrame.tsx` — isolated frame lifecycle.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/PluginHostPage.tsx` — host route and accessible loading/error shell.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/PluginUnavailableState.tsx` — disabled/incompatible/failed/update states.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/plugins/bridge-host.test.ts` — adversarial frame/port lifecycle tests.
- `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/plugin-frame.browser.tsx` — real browser sandbox/direct-navigation/LAN interaction scenarios.

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` — mount asset endpoint before SPA fallback.
- `/home/loidinh/WS/dam-hopper/server/src/web_host/router.rs` — reconcile actual host response CSP/embedding headers with the G0-qualified child policy; no broad shell script-policy relaxation or plugin executable static fallback.
- `/home/loidinh/WS/dam-hopper/server/src/api/plugins.rs` — authorize exact active asset generation/digest.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/embed/dam-hopper-app.tsx` — register host-owned plugin route.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/navigation.ts` — support dynamic owner-scoped entries/status without a second navigation model.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TopNavRouteMenu.tsx` — render dynamic entry and explicit lifecycle state.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/client.ts` — protected byte fetch and bridge invocation using existing owner client.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.ts` — activation/revocation events consumed by frame lifecycle.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/connections.ts` — frame/context teardown hooks on generation transition.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/index.css` — host shell/status/focus/responsive styles only.

### Delete

- None. Standalone evcrate viewer retirement belongs to E05 only after joint G4.

## Implementation Steps

1. Add the protected asset handler ahead of static fallback. Require actor, target, installation, digest and generation; emit inert headers and exact bytes only.
2. Implement host validation: size/hash/UTF-8, declared resource inventory and forbidden-document checks. Construct the CSP/bootstrap document rather than trusting plugin metadata.
3. Build `FrameSession` with explicit generation and revocation transitions. Set exact sandbox before assigning `srcdoc`; never use a same-origin blob/data endpoint as a shortcut.
4. Verify bootstrap event source equals the frame's current `contentWindow` and nonce matches. Transfer one port, require acknowledgement, then permanently disable window-message data handling.
5. Validate and bound port messages before mapping allowed capabilities onto the existing D03 `ApiClient`. Bind cancellation and teardown to the owning context.
6. Integrate dynamic navigation using active `ConnectionRef`, selected project/worktree and visible installation state. Preserve explicit disabled/incompatible/failure entries while hiding absent entitlement.
7. Revoke frame, port, pending requests and context on every subsequent document load or owner/auth/target/activation transition. Prove initial document load completes bootstrap exactly once and late responses cannot update a replacement frame.
8. Integrate E03's four views without granting new bridge capabilities. Verify keyboard, responsive layout and visible loading/error/cancel states.
9. Execute G2 from a separate browser host over the reference LAN against a real installed package and owner data. Capture direct-navigation inertness and one owner-connection evidence; leave full performance qualification to D06/G4.

## Todo List

- [ ] Protected plugin asset endpoint is authenticated, digest-bound and inert on direct navigation.
- [ ] Host-generated CSP and exact sandbox contain plugin UI.
- [ ] WindowProxy/nonce/one-use port acknowledgement precedes all context/data flow.
- [ ] Bridge schemas, bounds, cancellation and revocation follow owner/security generations.
- [ ] Dynamic navigation and explicit unavailable states match current connection/project.
- [ ] Four E03 views work on a real separate LAN browser for G2.

## Success Criteria

- Future, proposed UI test: `pnpm --filter @dam-hopper/ui test -- bridge-host` passes spoofed window/nonce, duplicate transfer, pre-ack data, schema/bounds and late-generation cases.
- Future, proposed browser test: `pnpm --filter @dam-hopper/ui test:browser -- plugin-frame.browser.tsx` confirms opaque origin, exact sandbox, host CSP, direct-navigation inertness, teardown and one connection per owner.
- Directly navigating to the protected asset cannot execute it as DamHopper-origin HTML; stale digest/generation and unauthorized actors receive no bytes.
- The iframe has no cookies/tokens, local/session storage authority, direct network capability, source path or generic fetch/DOM bridge.
- Overview, History/detail, Configuration and Evaluations render against a real owner worker from a separate LAN browser and remain keyboard/responsive accessible.
- G2 evidence records the actual browser/host/network/artifact and does not claim D05 lifecycle or G4 workload qualification.

## Risk Assessment

- Browser CSP/srcdoc behavior can vary. Qualify supported browser versions on the actual client OS and fail closed on unsupported behavior.
- Sanitizing arbitrary HTML is easy to under-specify. Prefer a frozen self-contained package document shape and reject ambiguity instead of general-purpose rewriting.
- Route changes can leave a live old port. Centralize teardown in `FrameSession` and make every owner/generation signal idempotently revoke it.
- Cached bytes can pair with new grants/generation. Key and validate all caches by actor/target/installation/digest/generation or use no-store initially.

## Security Considerations

- UI isolation contains accidental compromise and strips host capabilities, but the trusted backend worker still executes as the owner; no malicious-code sandbox claim.
- Do not add `allow-same-origin` or infer trust from `origin: null`. Do not expose a generic RPC escape hatch for future convenience.
- Host-generated CSP is enforcement; plugin-provided CSP is at most validation input.
- All frame errors are bounded and path-free. Development diagnostics must not weaken production headers/sandbox.

## Next Steps

1. D05 connects activation/update/disable/rollback events to atomic nav/frame revocation.
2. E04 publishes the reviewed real artifact for G3; D04 must not rewrite E03 domain semantics.
3. D06 repeats all four views under the 10k-history workload and G4 release environment.

## Unresolved Questions

- Supported production browser/version matrix and client OS are deployment inputs for G2/G4.
- If E03 requires embedded images/fonts, exact media types, per-resource limits and CSP hashes must be frozen at G0 rather than enabling broad `data:` by default.
