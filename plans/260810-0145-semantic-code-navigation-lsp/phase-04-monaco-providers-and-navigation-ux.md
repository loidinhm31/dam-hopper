# Phase 04 — Monaco Providers, Trust UX, and Delayed Prewarm

## Context links

- [Plan overview](./plan.md)
- [Phase 01 compatibility gate](./phase-01-contract-and-monaco-compatibility-gate.md)
- [Phase 03 transport](./phase-03-semantic-websocket-document-sync-navigation.md)
- [Monaco host](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MonacoHost.tsx)

## Overview

- Priority: P1
- Status: complete
- Effort: 24h
- Connect editor buffers to semantic sync; expose navigation; make trust/revocation visible; and enforce the 750 ms no-churn prewarm policy.

## Key Insights

- Sync follows open tabs; prewarm is narrower: one continuously active, hydrated tab/language/project for 750 ms.
- Trust confirmation must describe fixed policy effects and never imply a sandbox or allow a user-supplied command/path.
- Revocation aborts work and clears results without discarding unsaved editor content.

## Requirements

- Mount transport only inside authenticated/profile guards; consume sanitized capability/trust state.
- Prewarm after exactly 750 ms for stable supported hydrated active tab; key by profile/workspace/project/language/tab generation; cancel all key changes; explicit navigation bypasses dwell; scans/churn start none.
- Display restricted/trusted/revoked, availability, limitations, and policy revision. Confirm/revoke only through Phase 3 APIs.
- Implement public Monaco F12, Ctrl/Cmd+F12, Shift+F12, modifier-click, and context actions; lazily load selected target only.

## Architecture

- `SemanticTransport` is profile-bound reconnecting typed socket. `SemanticNavigationProvider` owns lifecycle; pure `SemanticPrewarmController` sends at most one intent and never opens a session.
- `SemanticTrustController` consumes server challenge/transition state. `SemanticDocumentController` owns snapshots/versions/didOpen across tabs.
- Providers install once; selected Gate A uses native UI, Gate B uses virtualized metadata-only results.

## Related code files

- Create: `packages/ui/src/api/{semantic-transport,semantic-trust}.ts`, `packages/ui/src/contexts/SemanticNavigationContext.tsx`, `packages/ui/src/lib/{semantic-navigation,semantic-prewarm}.ts`, `packages/ui/src/stores/navigation-results.ts`, `packages/ui/src/components/organisms/SemanticTrustDialog.tsx` plus tests.
- Modify: `MonacoHost.tsx`, `EditorTabs.tsx`, `editor.ts`, `dam-hopper-app.tsx`, and `transport-utils.ts`.
- Create conditional Gate B `NavigationResultsPanel.tsx` plus focused unit/Chromium tests.

## Implementation Steps

1. Implement transport/provider lifecycle and pure timer controller with cancellation/deduplication across tab/profile/project/workspace changes.
2. Implement document sync and safe `openPath`/pending reveal; coalesce edits 50 ms maximum and flush before navigation.
3. Implement trust confirmation/revocation UX with fixed policy language and no-sandbox caveat; invalidate actions/results on policy change.
4. Register public providers/actions and capability-aware labels. Implement Gate A or B results without eager target loading.
5. Test 749/750 ms, rapid tabs, explicit bypass, switching, trust/revoke, dirty buffers, multi-results, reconnect, and input focus.

## Todo list

- [x] Transport binds only active profile.
- [x] Prewarm is exact, idempotent, and churn/scan-free.
- [x] Trust UX remains server-authoritative.
- [x] Actions respect capability/policy/cancellation; selected target alone loads.

## Success Criteria

- Stable tab yields at most one intent after 750 ms; rapid tabs yield none; F12 need not wait.
- Restricted/trusted/revoked transitions preserve unsaved content and block stale navigation.
- No private Monaco API, path, raw LSP object, bundle data, or executable enters frontend code.

## Risk Assessment

- HMR can duplicate providers. Mitigation: singleton registry/disposables.
- Timer tests can flake. Mitigation: fake timers plus Chromium event-count assertions.

## Security Considerations

- Never store trust/challenges in browser storage; clear transient UI on project/profile change. Escape labels and render only relative paths.

## Next steps

- Phase 5 validates packaged Rust/TS release and rollback; Phase 6 enables Java only after qualification.
