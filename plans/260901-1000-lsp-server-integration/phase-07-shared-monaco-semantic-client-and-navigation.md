# Phase 07 — Shared Monaco Semantic Client and Navigation

## Context links

- Parent authority: [latest Validation Summary and revision ledger](./plan.md#validation-summary); September research is historical input, not current qualification.
- Direct dependencies: [Phase 01](./phase-01-protocol-dependency-real-process-spike.md), [Phase 05](./phase-05-authenticated-semantic-websocket-gateway.md), [Phase 06](./phase-06-global-hot-toggle-and-unsafe-override-gate.md). Initial enforced bounds flow from [Phase 03](./phase-03-pinned-tool-provisioning-and-resource-controls.md), not completed Phase 09.
- Repository: [Monaco host](../../packages/ui/src/components/organisms/MonacoHost.tsx), [editor tabs](../../packages/ui/src/components/organisms/EditorTabs.tsx), [editor store](../../packages/ui/src/stores/editor.ts), [ownership types](../../packages/ui/src/api/ownership.ts), [connections](../../packages/ui/src/api/connections.ts), [transport seam](../../packages/ui/src/api/transport.ts).
- Evidence: [historical client research](./research/researcher-01-lsp-client-transport.md), [architecture decision](../reports/brainstorm-260901-1000-lsp-server-integration.md). Current ledger supersedes native/override/acknowledgment assumptions.

## Overview

- Date: 2026-10-23
- Description: Integrate the narrow shared Monaco TS/JS client into actual editor ownership/model lifecycle; qualify the web surface only.
- Priority: P1
- Implementation status: DONE (2026-10-23) — Administratively complete under approved exceptions; release qualification pending
- Review status: Approved by user on 2026-10-23 under tracked exceptions (Score: 6/10, Cycle 3; C-1, C-2/G8, W1–W10 tracked for Phase 08/09/10)
- Effort: 32h, provisional until Phase 01 stop/go; increase covers stable local/wire identity separation, real host integration, and freshness fences.

## Key Insights

- Current `MonacoHost` already renders `path=inmemory://dam-hopper/encode(tabKey)` but has no explicit semantic owner/target/wire binding props. Reuse the editor's identity conventions; do not replace its model URI with a reconnect-varying session-target URI.
- Existing tab keys include profile/project/target/path; `ResourceBinding` separately records endpoint/root. A reused profile ID is not proof that the server/root still matches.
- Register only Definition and Implementation for Monaco `typescript`/`javascript` covering `.ts/.tsx/.js/.jsx`. Preserve multiple results and normal null/empty versus denial/error distinctions.
- LSP advertises one `TextDocumentSyncKind`; Definition/Implementation has no standard document-version parameter, and document notifications have no standard acknowledgments. Consume Phase 01's proven filtered-profile contract; do not invent either.
- ON performs integrity/configuration checks only and starts zero children; the first authorized lazy session performs any required bounded protocol probe. Default OFF and failures must leave ordinary editing usable.

## Requirements

- One lazy shared adapter, no full VS Code service graph or host fork; only bundled immutable Node/TypeScript/TSLS may run. No executable/argument/environment/override fields, command execution, native bridge, or local sidecar.
- Separate stable local model identity from replaceable semantic wire binding. Local identity binds profile, endpoint/root binding, immutable target, relative file/tab key, and model incarnation; wire binding adds captured connection generation, target generation, semantic session generation, descriptor, and server-issued session-target URI.
- Same endpoint/root reconnect must preserve dirty model object, text, undo/view state, and tab identity. Endpoint edit, different target/root, auth identity change, removed target, or unavailable owner never automatically uploads retained dirty text to a replacement server/session.
- Full `didOpen`, full reconnect/restart replay, and full resync; adaptive full below and incremental at/above the initial Phase 01/03 UTF-8 threshold, later tuned in Phase 09. Honor the single negotiated sync contract proven in Phase 01, including gateway translation if required by that proven design.
- Ordered UTF-16 edits and monotonic wire document versions; exact post-edit UTF-8 byte accounting within initial document/overlay/message/queue bounds. Reject overload before queue growth; no unbounded replay.
- Fence navigation by captured owner, endpoint/root, target/session generations, model incarnation/current source version, and request identity. For both open and unopened destinations, Phase 01 must prove returned coordinates correspond to exact destination content/version through demonstrated association or validated invalidation plus requery. A fresh authorized/readable file or fresh editor read alone is not proof.
- Replay only currently open eligible models matching the newly authorized owner/endpoint/root/target. Unsaved text comes from current Monaco/editor state, never stale disk/snapshot or another profile; clean open models may also be reopened in that same matched set.
- Visible disabled, starting, unsupported, missing-tool/incompatible, overloaded, timeout, crashed, invalidated, and resource-degraded states; no fabricated success or effect on normal save/tab behavior.

## Architecture

`SemanticClient` owns the dedicated owner-bound socket, attach/initialize state, bounded ordered document queue, wire versions, pending requests, replaceable URI bindings, and replay barrier. A local model registry maps the existing tab/model identity to the current authorized wire URI without mutating the model URI on reconnect. Provider registration is shared and reference-counted; each callback resolves only an exact registered model binding, never the globally active profile.

Initialization uses the Phase 01-approved capabilities and UTF-16 contract. Its candidate is one `Incremental` sync kind, with range-less full changes below the initial 64 KiB post-edit UTF-8 threshold and ranged changes at/above it; the exact bundled tuple must prove this before GO. Navigation uses the required filtered-profile `params.damHopperDocumentVersion` candidate, stripped before child-facing standard LSP, together with actual child-writer FIFO ordering and server overlay/version/document-incarnation fences. Phase 01 must prove TSLS source-state correctness and destination-range freshness; forwarding order alone is insufficient. If proof fails, STOP and explicitly revise the contract rather than silently substitute a gateway barrier. No client waits for a nonexistent LSP notification acknowledgment.

Returned `dam-hopper://semantic` URIs must match the current session-target binding. Resolve authorized relative paths through the captured owner's editor/API flow, wait for the matching destination model, and recheck exact destination identity/content/version against the proven range association before reveal. If stale, invalidate/requery through the Phase 01-proven path; do not apply an old range to freshly read content. No browser/Tauri filesystem opening and no raw child `file:` URI. Session readiness follows the proven ordered replay fence, not a guessed acknowledgment.

Failure boundary: revoke only the obsolete semantic binding; preserve local edits. Do not dispose another owner's providers/models or close editor tabs. New generation becomes ready only after authorization and complete matching-model replay.

## Related code files

- Modify: `packages/ui/package.json`, `pnpm-lock.yaml` — only Phase 01-approved pinned transport dependencies.
- Create: `packages/ui/src/api/semantic-client.ts` — owner-bound connection, ordered sync, wire bindings, cancellation, bounded replay/readiness.
- Create: `packages/ui/src/lib/semantic-model-uri.ts` — local model identity/wire URI mapping and strict parsing, not a second target authority.
- Create: `packages/ui/src/lib/semantic-monaco.ts` — Definition/Implementation providers, UTF-16 range mapping, exact-model registration.
- Create: `packages/ui/src/stores/semantic-navigation.ts` — ephemeral qualified state/reveal intents; no source persistence.
- Modify: `packages/ui/src/components/organisms/MonacoHost.tsx`, `EditorTabs.tsx`, `packages/ui/src/stores/editor.ts` — explicit semantic binding props, mount/content/tab-close lifecycle, stable model retention, owner-bound open/focus/reveal.
- Modify: `packages/ui/src/api/connections.ts`, `ownership.ts`, `server-config.ts`, `transport.ts`, `ws-transport.ts` only where needed for captured-owner URL/auth/lifecycle reuse; dedicated semantic traffic stays separate from core `/ws`.
- Create: `packages/ui/src/api/semantic-client.test.ts`, `packages/ui/src/lib/semantic-model-uri.test.ts`, `semantic-monaco.test.ts`, `packages/ui/browser-tests/semantic-navigation.browser.tsx` — observable contracts using repository test tiers.
- Modify: existing `MonacoHost.test.tsx`, `EditorTabs.test.tsx`, and `packages/ui/src/stores/editor.test.ts` for changed model/binding behavior.
- Delete: no existing editor behavior; discard unselected dependency experiments during implementation only.

## Implementation Steps

1. Require Phase 01 proof of adaptive sync, source-version fencing, destination freshness, stable-model/rebind feasibility, and supported Monaco provider coexistence before client implementation. Demonstrate simultaneous semantic-owned/non-owned TS/JS models and OFF restoration without disabling unrelated features; stop if any contract remains unproven.
2. Define the stable local identity and replaceable wire-binding types using existing owner/tab/`ResourceBinding` conventions. Never include host root paths in semantic wire URIs or diagnostics; do not rekey models on socket reconnect.
3. Add explicit owner/target/model binding props to `MonacoHost` and `EditorTabs`. Pair mount/content/model-dispose listeners with exact registry handles; distinguish view unmount/tab switch from actual document close. Preserve dirty text/undo/view state through reconnect.
4. Build `/ws/semantic/v1` from captured ready profile transport/auth/exact Origin policy. Bind every async continuation, cancellation, and cleanup to that owner generation; never fall back to ambient `getTransport` or a first-connected profile.
5. Implement attach → approved initialize → initialized → bounded full replay → readiness using initial enforced policy values. ON/disabled idle and unsupported Rust create no semantic child/session.
6. Serialize `didOpen`/changes/navigation in document order. Compute post-edit byte size once; below threshold full, at/above incremental according to the proven single-capability contract. Apply UTF-16 range events in validated order with one new wire version per committed event.
7. On conversion/order/binding divergence or missing version-fence precondition, cancel affected requests and use the Phase 01-proven full resync/replay path. Never heuristically patch source or assume the child acknowledged a notification.
8. Register only the two TS/JS providers using the Phase 01-proven coexistence mechanism; prevent competing built-in Definition/Implementation results for semantic-owned models without changing non-owned models, unrelated features or OFF behavior. Exact-model callback checks alone do not prove built-in suppression. Preserve Monaco cancellation and Monaco's native multiple-result UI.
9. Validate `Location`/`LocationLink` URI/ranges and null/empty responses; retain multiple authorized results and explicit outside-target/error state without exposing rejected paths. Convert zero-based LSP UTF-16 ranges to one-based Monaco exactly.
10. Open/focus an authorized destination through the captured owner and target; after each await recheck source request, session, model incarnation/version, and destination identity/content/version association before reveal, including unopened files. A fresh read cannot validate an old coordinate by itself. Changed/closed source or destination discards the old intent and requires the proven invalidation/requery path.
11. On reconnect, reauthorize and remap only matching open models into fresh wire URIs. Never dispose/recreate a dirty local model just because session-target ID changed; no replay across endpoint/root/actor changes without the existing explicit authorized rebind flow.
12. Add observable client/browser cases for below/equal/above and both crossings; Unicode/non-BMP/multiline edits; multiple/null/denial; full replay; endpoint change; same-name cross-profile/worktree isolation; close/reopen incarnation; late result/reveal/cleanup; and OFF/failure normal editor behavior.

## Todo list

- [ ] Close Phase 01 identity/sync/version/freshness prerequisites (adaptive sync, version fencing, and model rebind delivered; destination freshness G5 and live-browser G8 coexistence remain open gates).
- [x] Integrate stable local model registry and replaceable owner/session wire bindings (`semantic-model-uri.ts`, `semantic-client.ts`).
- [ ] Implement bounded ordered adaptive sync, full replay/resync, and exact UTF-8/UTF-16 handling (adaptive sync and initial replay delivered; resync path W-9 and timeout $/cancelRequest W-5 remain open).
- [ ] Register only TS/JS Definition/Implementation without duplicate results (providers delivered; live-browser model-scoped coexistence G8/C-2 remains open).
- [x] Open/focus/reveal through exact-owner target-aware editor lifecycle (`MonacoHost.tsx`, `EditorTabs.tsx`, `semantic-navigation.ts`).
- [ ] Preserve dirty models and fence cancellation/result/reveal/cleanup across replacements (disconnect teardown and scoped cleanup delivered; C-1 stale client ref across reconnect and W-7 singleton options remain open).
- [x] Cover changed observable contracts; keep all implementation progress at 0% until executed (128/128 target & regression tests passing per QA report; full UI 3,167/3,167 passing).

## Success Criteria

- Actual web Monaco Definition/Implementation reaches correct open/unopened target files and ranges for all four extensions; multiple results remain selectable, null/empty is not an error, external denial remains distinct.
- Adaptive full/incremental paths yield equivalent TSLS state/navigation under the Phase 01-proven single advertised sync contract. Exact-threshold/crossing/UTF-16 cases are deterministic within initial bounds.
- Same-endpoint authorized reconnect changes wire session-target URI but preserves dirty local model identity/text/undo/view state and replays current text before navigation readiness.
- Endpoint/root/profile/target/actor mismatch never replays a previous owner's dirty source. Old results, timers, callbacks, reveal intents, and disposals cannot modify or close a replacement owner/model incarnation.
- No nonexistent standard version parameter or LSP notification acknowledgment is required. Source-version correctness and exact destination content/version-to-coordinate association for open/unopened targets are demonstrated under delayed edits/results; a fresh read alone never qualifies stale ranges.
- Closing one document sends its `didClose` and cancels its work only; it does not destroy a session with other open documents. Whole-session retirement clears all affected wire bindings, not local tabs.
- Runtime OFF/failed/unsupported retains existing editor/save/tab/shortcuts; no command configuration or native-host bypass exists. Web evidence does not qualify native.

## Risk Assessment

- Session URI used as local model identity loses dirty state: separate identities and prove reconnect/close-reopen behavior in Phase 01.
- Sync/version semantics subtly incompatible with chosen TSLS: explicit Phase 01 stop/go; no implementation on guessed capabilities/barriers.
- Duplicate providers or global Monaco controls cross owners: Phase 01 must prove a supported coexistence mechanism on simultaneous owned/non-owned TS/JS models and OFF restoration; exact registry/refcount handles alone are insufficient.
- Destination changes while loading: enforce the proven destination freshness policy before range reveal; cancel stale intent.
- Added adapter cost/dependency weight: keep existing lazy Monaco/workers and Phase 01 dependency/chunk budget.

## Security Considerations

- Server controls target/tool/URI authority; client checks are defense-in-depth, not an OS filesystem sandbox. Trusted workspace restriction remains mandatory.
- No command fields, arbitrary configuration, plugin system, local execution bridge, or host-origin exception. No tokens/source/absolute paths in logs or semantic persistence.
- Ordinary authenticated users may navigate when enabled; only current server-authorized admins mutate global runtime. Do not duplicate role authority in the client.

## Next steps

- Phase 07 complete under user approval on 2026-10-23. Tracked items C-1 (call-time client resolution in `onChange`/`notifyDidClose` across reconnect and generation changes), C-2/G8 (live web browser Monaco definition action verification across owned and non-owned models with clean restore on OFF), W-1 (destination freshness G5), W-2/W-4 (typed errors and visible status indicators), W-3 (direct EditorTabs effect tests), W-5 (`$/cancelRequest` timeout and handshake margin), and W-6 to W-10 (ambient defaults, singleton options, global boolean switch, resync path, zustand side-effects) are carried forward into Phase 08 (Lifecycle invalidation and recovery), Phase 09, and Phase 10.
- Phase 08 completes lifecycle reauthorization/invalidation; Phase 09 measures final threshold/limits and security/resource behavior; Phase 10 qualifies the actual built web app.
