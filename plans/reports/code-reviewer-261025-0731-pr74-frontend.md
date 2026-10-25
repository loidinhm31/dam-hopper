## Code Review Summary

### Scope and validation
- PR #74 only: base `45a51efe43ef6024dbd875d2498b456a7d4db110`, head `b031e6a40123d8c5169012e0b736ac8c4f1f6091`.
- Production reviewed: `packages/ui/src/api/{semantic-client,client,queries,ws-transport}.ts`; `lib/{semantic-monaco,semantic-model-uri,monaco-setup}.ts`; `stores/{semantic-navigation,editor}.ts`; `components/organisms/{EditorTabs,MonacoHost,EditorStatusBar}.tsx`; `components/molecules/EditorTab.tsx`. Relevant unit/browser/E2E tests inspected as evidence, not assumed passing. Settings components excluded per ownership.
- Contracts read: README, PDR, code standards, semantic protocol guide; supporting gateway/overlay/URI and connection/cache lifecycle sections inspected.
- Four conclusive static defects below: one P1, three P2. No P0 findings. Runtime reproductions are **suggested, not executed**.
- No build/typecheck/lint/tests/formatters/installations; no source/test/CI/plan edits. Only this report written. Coverage percentages and runtime qualification not measured.
- Advisor consulted before direction/finalization; final consultation completed. First consultation unavailable due provider quota.

### Dependency evidence
- Local `packages/ui/package.json:27,42` and `pnpm-lock.yaml:184-186,229-231` pin **patched Monaco 0.55.1** and **@monaco-editor/react 4.7.0**, not research Monaco 0.57.
- `patches/monaco-editor@0.55.1.patch:1-46` changes word-highlighter promise observation only; it does not change text normalization, provider selection, or model lifecycle.
- Installed `node_modules` reads denied by tool policy. Reviewed exact-version published Monaco sources and React wrapper v4.7.0 sources instead; no claim that installed files were executed or independently integrity-verified.
- Pinned wrapper evidence: [Editor value effect and creation](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/Editor/Editor.tsx#L95-L115), [retained-model factory](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/utils/index.ts#L21-L23), [update-hook mount guard](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/hooks/useUpdate/index.ts#L3-L17).
- Pinned Monaco evidence: [0.55.1 text model](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/model/textModel.js), [buffer normalization](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js), [exclusive provider selection](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/common/languageFeatureRegistry.js), [ordered edit-event contract](https://unpkg.com/monaco-editor@0.55.1/esm/vs/editor/editor.api.d.ts).

### Findings

#### F1 — P1: Retaining models also retains obsolete clean text across an accepted disk reload
- **Changed anchor:** `packages/ui/src/components/organisms/MonacoHost.tsx:617`.
- **Trigger:** Open a provenance-bearing TS/JS file, leave it clean, change it externally, then focus/reconcile it or perform a Git mutation that reloads the tab. Semantics need not currently be ON: retention depends on provenance/path, not enablement.
- **Evidence chain:** `editor.ts:1201-1205` sets loading before reload; `EditorTabs.tsx:646-650` consequently unmounts MonacoHost. New `keepCurrentModel` preserves the old model. `editor.ts:1244-1254` then accepts new disk content, savedContent and mtime. On remount the pinned wrapper's `getOrCreateModel` returns the existing model unchanged; its value-only update hook skips initial mount and does not rerun merely because editor readiness changes. No mount reconciliation in `MonacoHost.tsx:332-347` applies the newly accepted clean text. Same-provenance registration also preserves the existing wire binding (`semantic-model-uri.ts:326-342`), and `notifyDidOpen` returns for an already-bound model (`semantic-client.ts:901-908`).
- **Consumer impact:** Store/saved baseline and displayed Monaco text disagree. A subsequent edit/save can overwrite newly loaded external/Git changes: the old visible text becomes `tab.content`, while save uses the **new** accepted mtime (`editor.ts:921-928,947-964`). Semantic overlays can likewise retain the old snapshot.
- **Smallest correction:** Explicitly reconcile an accepted **clean reload** into the retained model and semantic overlay before making it editable. Preserve existing dirty/reconnect models and their undo stacks; do not solve by globally recreating every model.
- **Safe runtime reproduction:** Disposable fixture only: open `reload.ts` containing marker V1; replace disk contents with distinct V2 using a terminal; refocus until reload completes. Compare disk, editor store and `window.monaco` model. Then type one character and save the fixture; check whether V2 was overwritten by V1-derived text.
- **Confidence:** High, conclusive static chain; no runtime reproduction executed. Current mocked MonacoHost tests do not exercise the real wrapper reload/remount path.

#### F2 — P2: Unexpected semantic socket closure has no recovery while its owner stays connected
- **Changed anchor:** `packages/ui/src/api/semantic-client.ts:636-640`.
- **Trigger:** Drop only `/ws/semantic/v1` after ready, while core connection, endpoint, target and editor mount remain unchanged; includes the shipped `forceSocketLoss()` helper.
- **Evidence chain:** `onclose` only retires the attempt. `retireAttempt` (`452-525`) clears bindings/status but schedules nothing. The only reconnect timer is `handleServerInvalidation` (`1275-1290`), reached for a navigation error `-32005`, not ordinary close/error. `EditorTabs.tsx:217-218` calls connect only inside an effect whose dependencies (`235-247`) omit client status. Store/manager status subscribers refresh state/providers, not connections.
- **Consumer impact:** Semantic navigation stays unavailable until an unrelated remount/target/connection/toggle transition. Built-in local TS navigation can reappear instead of the server-backed cross-file/dirty-overlay service.
- **Smallest correction:** Schedule owner-fenced recovery for unexpected socket loss, cancel it on explicit release/disable, and respect non-retryable auth/disabled closure reasons. Reuse the existing handshake/replay barrier.
- **Safe runtime reproduction:** Ready a disposable TS fixture, make an unsaved edit, obtain its client via `window.__dam_hopper_semantic_store.getState().findClientForTab(tabKey)` and call `forceSocketLoss()`. Observe a disconnected transition and absence of a replacement semantic WebSocket after several seconds, with core socket still connected. After correction require a new handshake and dirty replay before ready.
- **Confidence:** High, conclusive static chain. E2E `semantic-navigation.spec.ts:354-369` waits for already-visible ready without first observing disconnected/new socket identity; it does not independently prove reconnection.

#### F3 — P2: Rejected over-budget edits leave old document snapshots eligible for navigation
- **Changed anchor:** `packages/ui/src/api/semantic-client.ts:982-985`.
- **Trigger:** Grow an already-bound file beyond 1 MiB, or grow session overlays beyond 4 MiB. Continue editing or navigate before content is fully resynchronized.
- **Evidence chain:** `canAdmitOverlayBytes` (`781-813`) is a pure limit check. Failure returns before bumping the wire version, without marking the model unsynchronized or removing its binding. MonacoHost ignores the return (`643-644`). `queryNavigation` (`1195-1215`) still submits the previous binding/version; its post-await fences compare that same unchanged version (`1243-1251`). Manager's source fence (`semantic-monaco.ts:176-185`) captures the current Monaco version but does not establish that it corresponds to the old wire snapshot. A later accepted edit at/above 64 KiB forwards only the latest ranged edit (`1011-1027`), although its base includes discarded changes.
- **Consumer impact:** Go to Definition can resolve the old symbol at the current cursor, despite showing “Ready”; returning under the cap can desynchronize the overlay or require a failed navigation/resync cycle. Destination hashing does not prove source synchronization.
- **Smallest correction:** Mark the document unsynchronized on rejected changes, suppress semantic queries while in that state, and send a bounded full replacement when it becomes admissible again before accepting incremental changes/navigation.
- **Safe runtime reproduction:** In a disposable initially bound TS file importing different symbols `foo`/`bar`, paste enough comment text to exceed 1 MiB, then replace a `foo` usage with `bar` while still oversized. Navigate that usage and inspect that no new didChange was sent but a definition request uses the old version. Reduce below the cap but above 64 KiB and inspect whether a full resync precedes subsequent ranges.
- **Confidence:** High, conclusive static chain. `semantic-client.test.ts:1354-1356` checks only return value zero for one rejected edit, not subsequent query/re-entry behavior.

#### F4 — P2: Destination proof compares raw disk bytes with normalized editor text
- **Changed anchor:** `packages/ui/src/components/organisms/MonacoHost.tsx:244-246`.
- **Trigger:** Navigate to an unopened, valid in-target TS/JS destination containing a UTF-8 BOM or mixed LF/CRLF endings; choose a definition beyond the default cursor position.
- **Evidence chain:** Gateway reads exact UTF-8 disk text and hashes it unchanged (`server/src/semantic/gateway.rs:1723-1754`; `uri.rs:449-452`). Editor load uses default `TextDecoder`, which strips a leading UTF-8 BOM (`editor.ts:305-310,741-757`). Pinned Monaco's buffer factory normalizes mixed endings to its selected EOL. Reveal validation hashes `model.getValue()` and demands equality with the raw-file digest; already-created destination models are rejected similarly by `semantic-monaco.ts:200-212` → `semantic-client.ts:1120-1123`.
- **Consumer impact:** A valid cross-file definition either yields no usable destination or opens the file without selecting/revealing the definition. The freshness check deterministically rejects semantically unchanged content representations.
- **Smallest correction:** Define and implement one coordinate-bearing content representation across gateway pin/query, document synchronization and client proof checks, retaining necessary BOM/EOL metadata. Do not merely normalize a digest while leaving ranges computed from different text.
- **Safe runtime reproduction:** Disposable fixture imports a definition at line 4 from an unopened BOM-prefixed `dest.ts`. Trigger definition; inspect supplied digest, loaded model digest and unchanged cursor. Repeat with a BOM-free file mixing LF and CRLF, then compare with a uniform-LF control. No original project files need alteration.
- **Confidence:** High, conclusive static chain with exact-version normalization source; no runtime reproduction executed. Existing cross-file E2E line-1 destination assertions can conceal a failed reveal after a tab merely opens.

### Positive observations and coverage
- Stable local identity vs replaceable wire binding, attempt-object fencing, model/incarnation checks, destination content proofs and exact-client release guards are substantive safeguards.
- Shared-client refcount and independent manager registration tokens avoid tearing down a surviving same-scope mount (`semantic-navigation.ts:218-221,246-269`; `semantic-monaco.ts:76-83`).
- Model-scoped exclusive selectors match the pinned Monaco 0.55.1 implementation; global TS worker defaults remain untouched. Its documented edit-event order is descending, so forwarding multi-edit batches in event order is not itself a defect.
- Source text/semantic authority excluded from persisted tab metadata. Unsupported languages remain outside semantic registration.
- Inspected version/identity/profile/target/reveal fences and cancellation paths; gateway's separate response-provenance race communicated to GatewayReview, not duplicated here.

### Recommended actions
1. Fix clean reload/model/overlay reconciliation first; exercise the real pinned React wrapper, not only a mocked Editor.
2. Address socket-loss recovery, rejected-edit synchronization state and representation-consistent destination proofs.
3. Main-agent validation should run fixture-only reproductions above after repairs, plus dirty undo/redo across tab switches/reconnect, owner/worktree retirement, and shared-mount teardown. No checks claimed run by this reviewer.

### Unresolved evidence
- Installed dependency bytes inaccessible under tool policy; local lock and patch plus exact-version published sources were inspected. No runtime validation or test-coverage measurement performed by assignment.
