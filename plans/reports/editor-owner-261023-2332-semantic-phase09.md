# Phase 09 editor integration handoff

Status: implementation and regression authoring complete; validation **NOT RUN** (parent integration contract). No qualification/plan-DONE/visual acceptance claim. No native changes, restyle, assets, images or captures.

## Actual edits

- `packages/ui/src/lib/semantic-monaco.ts` / `.test.ts`: replace mutable singleton options with independently disposable registration tokens; exact source-tab target resolver for existing/unopened destinations; remove positional JSON parsing and captured-pane opener. Exclusive per-model Definition/Implementation selectors instead of global TS/JS mode mutation. Full URI/client/provenance guards inside providers; registry/status/model/availability refresh; same-path foreign-authority collision restores normal providers. Bound source request epochs, destination model/registry/binding/version fences, final multi-destination recheck, duplicate elimination, exact source/resource/range opener routing and reverse-open completion fence. Open failures do not fall through to ambient opener.
- `packages/ui/src/components/organisms/EditorTabs.tsx` / `.semantic.test.tsx`: preserve `worktreePath`, pass immutable client provenance, guard source getter, exact-client release, dispose only own manager registration.
- `packages/ui/src/components/organisms/MonacoHost.tsx` / `.semantic.test.tsx`: register accepted tab provenance even when semantics OFF; never synthesize absent provenance on render/reconnect; guard didOpen/didChange. Retain supported qualified Monaco model on pane unmount. Remove unvalidated mount-time reveal path. Require proven destination SHA-256; after await recheck exact editor/model/version/registry incarnation/binding/version/client/authority/intent, then atomically consume expected intent and reveal synchronously.
- `packages/ui/src/stores/editor.ts` / `.test.ts`: ephemeral `Tab.semanticProvenance`; capture authorized authority **before** reads, revalidate live authority after await, stamp only accepted clean content. Dirty branches preserve original text/provenance. Actual document close retires retained Monaco model with close/reopen fences; same-binding reconnect never disposes model.
- `packages/ui/browser-tests/semantic-navigation.browser.tsx`: real Monaco `editor.action.revealDefinition` / `editor.action.goToImplementation` actions; actual built-in Definition adapter observation for TS/JS; competing Implementation provider; owned/nonowned/OFF/unbind restoration; surviving registration; unopened worktree dispatch/proof; destination edit during awaited proof; actual model/text/undo/redo/view preservation on registry rebind.

## Integration API

ClientOwner owns `SemanticProvenance`, `captureSemanticProvenance`, `matchesSemanticProvenance`, `computeUtf8Sha256Hex`, registry `subscribe`, `client.canAccessModel`, `client.validateDestination`, expected-client release and expected-intent consumption. Provenance = immutable normalized endpoint + configured project root + actor; current authority checked dynamically. Editor source getter verifies both tab provenance and client model access before returning any retained source. Missing/mismatched authority stays local, unavailable to semantic transport; no dirty draft adoption.

GatewayOwner location proof fields consumed: `damHopperDestinationContentSha256`, `damHopperDestinationVersion`, `damHopperDestinationIncarnation`. Required hash represents server-proven exact evaluated text, not a fresh disk read alone. UI compares exact UTF-8 text hash, tracked version when supplied, and local registry/binding identity. Server incarnation is not assumed equal to local tab incarnation. Unopened proof depends on gateway FIFO pin-and-requery implementation.

## Risk → regression boundary

| Risk | Authored oracle | Evidence still required |
| --- | --- | --- |
| Same-scope pane cleanup erases survivor | manager independent token disposal | actual integrated multipane web lifecycle |
| Wrong root/worktree | exact source-tab target + unopened action dispatch | authenticated root/worktree files with distinct content |
| Retained source crosses authority | getter/open/change guards; actor/root changes during read; dirty provenance unchanged | real endpoint/root/actor replacement while mounted/replaying |
| Stale reveal | two-destination delayed proof; same-text close/reopen; delayed old/new hash; reverse open completion | real packaged TSLS stale/pinned requery race through built web |
| Duplicate provider/global collateral | actual Monaco actions, builtin Definition, explicit competing Implementation | Chromium execution and full visual surface smoke |
| Reconnect damages buffer | actual model undo/redo/view on registry rebind | real client handshake/replacement + React host lifecycle |

## Exact proposed validation commands

Main/tester only, after all slices integrate:

```sh
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test src/lib/semantic-monaco.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/stores/editor.test.ts
pnpm --filter @dam-hopper/ui test src/components/organisms/MonacoHost.test.tsx src/components/organisms/EditorTabs.test.tsx src/components/organisms/EditorTabsBlame.test.tsx src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/stores/semantic-navigation.test.ts
pnpm --filter @dam-hopper/ui test:browser browser-tests/semantic-navigation.browser.tsx
```

Browser runner configured port 15173; isolate from other jobs. Existing browser suites and visual surface smoke remain Main/tester-owned. No command above executed by this worker.

## Qualification limits / blockers

- G5/G8 remain **unexercised**, not qualified by authored tests/jsdom/source review. Browser transport collaborators are controlled; they do not prove packaged TSLS, authenticated server, or client authority implementation.
- Actual-web gate still requires authenticated Linux server + exact packaged tuple, all four TS/JS extensions, root/worktree destinations, dirty ordered sync, destination pin-and-requery/content incarnation races, OFF/nonowned provider restore, endpoint/root/actor replacement and same-binding reconnect. Observe actual Monaco action/selection, model identity/text/undo/view and no duplicate peek entries.
- Monaco 0.55.1 upstream `tsMode.js` registers Definition but no built-in Implementation provider. Browser suite exercises actual Definition adapter and an explicit competing Implementation provider; do not claim built-in Implementation restoration exists. Source: https://unpkg.com/monaco-editor@0.55.1/esm/vs/language/typescript/tsMode.js . Exclusive selector behavior/public typing source: https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/languageFeatureRegistry.js . Installed dependency inspection blocked by tooling ignore; actual installed browser behavior pending.
- `docs/design-guidelines.md` absent; parent directed existing `docs/code-standards.md` as behavioral UI authority, no new design document/restyle.
- Tests follow existing repository `Promise.withResolvers` pattern. Main reports production client converted to ES2022-compatible promise executors; no worker verification claim.

Unresolved questions: none requiring user policy choice. Integration/runtime gates above remain outstanding.
