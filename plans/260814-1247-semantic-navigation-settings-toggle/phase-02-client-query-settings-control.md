# Phase 02 — Client query and Settings control

## Context links
- [API client](../../packages/ui/src/api/client.ts) — typed `api` facade and settings channels.
- [REST channel mapper](../../packages/ui/src/api/ws-transport.ts) — `channelToEndpoint` maps transport calls to protected `/api/*`.
- [Queries](../../packages/ui/src/api/queries.ts) — TanStack Query hooks/mutation invalidation patterns.
- [Settings page](../../packages/ui/src/components/pages/SettingsPage.tsx) and [Appearance section](../../packages/ui/src/components/organisms/SettingsAppearanceSection.tsx).
- [Switch](../../packages/ui/src/components/atoms/Switch.tsx) and [SettingRow](../../packages/ui/src/components/molecules/SettingRow.tsx) — established accessible Settings controls.
- [Semantic context](../../packages/ui/src/contexts/SemanticNavigationContext.tsx) — handshake availability and lifecycle cleanup.
- [Tests](../../packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx), [query tests](../../packages/ui/src/api/queries.test.ts), and [browser Settings flow](../../packages/ui/browser-tests/settings-usage-insights.browser.tsx).

## Overview/date/priority/status
- Date: 2026-08-14; priority: P2; status: completed (2026-08-14 15:28 +07:00).
- Surface the server-owned setting in Settings without creating a browser/global preference or changing unrelated Appearance controls.

## Key Insights
- `WsTransport.invoke` is a REST transport abstraction, not a server-side IPC protocol; adding channels in `client.ts` plus `ws-transport.ts` keeps auth/base URL/profile behavior DRY.
- Existing Settings UI uses `SettingRow` + `Switch`; `docs/design-guidelines.md` is absent, so do not invent a new visual system.
- The semantic context already clears pending navigation, result store, documents, and prewarm state on `semantic:workspace_changed`/`closed`; server lifecycle events must make that path reliable.
- API errors are already surfaced as `ApiRequestError`; a failed toggle must leave the prior switch state and show the server-safe reason.

## Requirements
- Add typed settings API methods/channels for GET and PATCH, with response fields `enabled`, `available`, and nullable `disabledReason`.
- Query is keyed independently from global UI config and active workspace config; invalidate/refetch after mutation and on workspace/profile changes.
- Render a clearly labeled “Semantic navigation” row on the Settings page. It is off by default, server-scoped across all projects in the active workspace, and has no per-project/profile control.
- Disable the Switch while loading/mutating or when `available=false`; show the server-provided reason in the row description (fallback to “A valid signed semantic bundle is required on this server.”).
- Toggle success is live and should not claim a restart. Toggle failure rolls back/keeps prior state and displays a concise error; no optimistic state may remain after a rejected request.
- Do not show host executable paths, PATH fallback language, production port `4800`, or bundle internals.
- UI-UX designer review required during `/code`; preserve existing spacing, borders, focus/keyboard semantics, and accessible aria label.

## Architecture
- Extend `api.settings` in `client.ts` with `semanticNavigation.get/update`; map them in `ws-transport.ts` to `GET /api/settings/semantic-navigation` and `PATCH /api/settings/semantic-navigation`.
- Add `useSemanticNavigationSettings` and `useUpdateSemanticNavigationSettings` in `queries.ts`. Use the existing query client; invalidate the semantic settings query and `config` after a successful update so the TOML editor cannot display stale server config.
- In `SettingsAppearanceSection`, consume the query/mutation and render one `SettingRow`. Keep the control controlled by server data, not `useSettingsStore` or `ui-config.ts`; no localStorage/global UI field.
- If profile switching can leave a stale query, include the active transport/profile identity in the query key or rely on the existing profile cache-flush hook, then test the chosen behavior. Do not add polling; normal mount refetch and lifecycle/query invalidation are sufficient.
- The semantic editor context remains the backend lifecycle owner. The Settings row only calls the protected API; it must not close WebSockets or mutate trust client-side as a second implementation.

## Related code files
- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts`, `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`.
- Update tests: `packages/ui/src/api/queries.test.ts`, `packages/ui/src/api/ws-transport.test.ts`, `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`, semantic context/transport tests as needed.
- Update/add browser coverage under `packages/ui/browser-tests/` for Settings + editor flow; no new design component needed.

## Implementation Steps
1. Add response/request TypeScript types with camelCase names and map the two transport channels to the protected REST route.
2. Add query/mutation hooks with deterministic invalidation and safe error propagation.
3. Add the row near other server/runtime behavior controls, using existing `SettingRow`/`Switch` patterns and server-aware description text.
4. Ensure disabled bundle state renders `Switch disabled` and an actionable reason, while false/off remains visibly off.
5. Ensure a rejected PATCH restores the rendered server value and presents an error without swallowing auth/HTTP failures.
6. Add accessible selectors/test IDs only where the existing browser suite needs stable targeting; avoid broad Settings refactor.
7. Request ui-ux-designer review before `/code` phase completion and adjust only within established patterns.

## Todo list
- [x] Typed client channels and REST mapping.
- [x] Query/mutation hooks and cache invalidation.
- [x] Settings row, disabled reason, pending/error behavior.
- [x] Component/query/transport tests.
- [x] UI-UX designer review (existing `SettingRow`/`Switch` pattern applied; no separate artifact).

## Success Criteria
- Settings always shows the switch; a default response renders off.
- No valid bundle renders a disabled switch with clear explanation and cannot issue enable PATCH.
- Valid bundle toggles issue authenticated requests and reflect the server response after live apply.
- Active workspace/project controls remain unchanged; no UI config/localStorage key is added.
- TypeScript strict build and component tests pass.

## Risk Assessment
- Query data can be stale after profile/workspace changes; scope key/invalidation to the active transport and add a switch-flow regression.
- Mutation errors can leave an optimistic switch checked; use server-owned controlled state or explicit rollback.
- Existing Appearance section is long; keep the addition local and avoid unrelated extraction/refactor.

## Security Considerations
- Reuse `WsTransport` auth headers/cookies and protected route; do not add an unauthenticated fetch.
- Treat server reason as bounded safe text; do not interpolate paths/commands into UI.
- The client gate is UX only; backend supervisor and authenticated semantic WS remain authoritative.

## Completion record
- **Completed:** 2026-08-14 15:28 +07:00.
- **Evidence:** typed protected transport channels, query/mutation invalidation, server-controlled Settings switch, unavailable/error/pending states; UI 1,038 tests, TypeScript check, build, targeted lint, and formatting/diff checks passed.
- **Residual:** live browser/signed-bundle enable/editor flow remains unvalidated; availability may be stale after bundle mutation.

## Next steps
- Phase 03 wires/validates lifecycle events so the editor cancels stale work and reconnects after live changes.
- Phase 04 runs browser and full validation gates, then records review findings.
