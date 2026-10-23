# Code Review — Phase 07 Shared Monaco Semantic Client & Navigation

Plan: `plans/260901-1000-lsp-server-integration/phase-07-shared-monaco-semantic-client-and-navigation.md`
Reviewer: ReviewerPhase07 | Date: 2026-10-23

## Score: 3/10 — NOT ready. Server edits good; UI integration does not work end-to-end.

Unit tests (112/112) pass because every integration seam is mocked (`getClient` mocked, Monaco mocked, browser test never fires a provider). Real mount order + wiring defeat the feature.

## Scope
- Server: `semantic/session.rs`, `semantic/gateway.rs`, `api/semantic_ws.rs`, `tests/semantic_websocket.rs` (~+400/-34)
- UI: `api/semantic-client.ts` (598), `lib/semantic-model-uri.ts` (368), `lib/semantic-monaco.ts` (321), `stores/semantic-navigation.ts` (164), `MonacoHost.tsx`, `EditorTabs.tsx`, `stores/editor.ts` diffs, 5 test files + browser test.
- Plan file updated: status line (not complete, review failed). Todo boxes left unchecked.

## Critical Issues

**C1. Feature unreachable in production.** `setGlobalSemanticEnabled` has zero non-test callers (grep). `globalSemanticEnabled` stays `false`; EditorTabs/MonacoHost effects early-return. Admin settings (`useSemanticSettings`, Phase 06) never sync into the nav store. Compounding: `semantic-monaco.ts` registers its toggle listener at module import, but the module is only dynamically imported *after* `semanticEnabled` is already true (EditorTabs effect) → the `true` event already fired → `activate()` never runs → providers never registered and built-in `definitions/implementations` never suppressed. Chicken-and-egg.
Fix: sync store from server semantic status (per captured owner); activate manager explicitly after `setOptions` when enabled; eager lightweight import or call `activate()` in the `.then`.

**C2. didOpen/didChange never reach server under real mount order.**
- `MonacoHost` effect (`notifyDidOpen`) runs on first render; `defaultSemanticModelRegistry.registerModel` runs later in async `handleMount` → `getByTabKey` undefined → no-op. Nothing re-triggers open after registration or after client becomes `ready` (effect deps exclude status).
- `registerModel` on every mount bumps incarnation and sets `wireBinding = null` (also drops the old binding on tab-switch remount) → subsequent `notifyDidChange` returns 0 (`!model.wireBinding`).
- `replayMatchingModels` binds wire but never sends `didOpen` (comment: "will be synchronized on … mount"). Plan requires full replay of *current Monaco text* before readiness. Dirty text never replayed.
- Navigation on bound-but-never-opened doc → server error → swallowed to `[]` (see W1). Built-in fallback silently used when no binding. User sees no semantic results and no error.
- Tests miss this: `MonacoHost.semantic.test.tsx` mocks `getClient`; browser test never invokes a provider.
Fix: single owner for open/replay (client pulls text via a `getModelText(tabKey)` source = Monaco model/editor store); trigger open on (model registered ∧ client ready) via registry/status subscription; make `registerModel` idempotent for same tab (keep incarnation unless actual close/reopen) and never null the binding on remount.

**C3. Multi-change edits desync (data-correctness).** `MonacoHost.onChange` forwards only `ev.changes[0]`. Multi-cursor, replace-all, format, paste-over-selections produce N changes. Below 64 KiB the full-text path hides it; at/above 64 KiB only the first range is sent → TSLS buffer diverges silently; no resync path (plan step 7 requires cancel + full resync). Also server on malformed change just closes doc (good) but client is never told → subsequent didChange for closed doc dropped silently.
Fix: send all `ev.changes` in Monaco order as one `contentChanges` array; on any conversion/ordering doubt or server close, full `didOpen` resync; add server→client signal or have client verify.

**C4. Owner/profile/worktree isolation broken (plan: same-name cross-profile/worktree isolation; never replay another owner's dirty text).**
- `SemanticClient.handleClose()` calls `registry.clearWireBindings()` with no target → wipes bindings of *all* clients sharing the global `defaultSemanticModelRegistry` (other profiles/projects).
- `replayMatchingModels` filters by `project` only (not profile, worktree/targetKey, endpoint) → a same-named project from another profile gets bound to this client's target.
- Client scope key = `profile::project::gen_1`: omits worktree and endpoint. Second worktree of the same project, or an edited endpoint for the same profile, reuses the first client (wrong `attachTarget` worktree, old server). `getOrCreateClient` ignores new options if key exists.
- `connectionGeneration` read live, but `targetGeneration`/`sessionGeneration` hard-coded `1`; scope key hard-codes `1` in EditorTabs/MonacoHost → generation fences are nominal.
Fix: key by owner (profile + endpoint + root binding + target/worktree + generation); per-client binding sets (clear only own); replay filter on full identity (`targetKey`, profile).

**C5. Navigation result handling lacks required fences and has side effects in the provider.**
- No re-check after `await`: source model incarnation/`wireVersion`, client/session generation, request identity. Late result after edit/close/reconnect is applied. Plan steps 8-10 / success criterion on stale ranges unmet; no destination content/version association (fresh read → old coordinates).
- `mapLocationsToMonaco` calls `parseSemanticWireUri(loc.uri)` **without** `expectedTargetId` → foreign `targetId` accepted (server filters, but client check is documented defence-in-depth).
- `provideDefinition` triggers `onNavigateToFile` (opens tab + `setRevealIntent`) **during query**. Monaco queries definitions on Ctrl+hover, peek, and for every returned location → tabs opened/stolen focus without user choosing; multiple results open multiple tabs; last intent wins.
- Unopened-destination URI fabricated as `buildLocalModelUri(editorFileTabKey({project}, path))` — ignores profile/worktree target → wrong tab key; model does not exist when Monaco resolves it (peek fails). [INFERENCE: Monaco standalone has no opener for other models without `registerEditorOpener`/`openCodeEditor` override; none present.] For already-open destination, `handleMount` never reruns so the reveal intent is never consumed and lingers (no TTL; `createdAt` unused) → later unexpected jump when file next mounts. Intent match is case-insensitive and ignores target/profile.
Fix: do navigation in an editor opener (user-selected), with intent bound to owner+target+destination incarnation + TTL; validate with `expectedTargetId`; recheck post-await.

## High / Warnings

**W1. Error vs empty distinction lost.** `queryNavigation` catch returns `{locations: []}` for *every* failure (timeout, STALE_VERSION, AUTH_REVOKED, -32800, overload). Plan: "preserve null/empty versus denial/error". Also no UI for disabled/starting/unsupported/overloaded/crashed states (`clientStatuses` consumed nowhere).
**W2. Handshake failure leaves socket open, status stuck** (`attaching`/`initializing`); `ws.onopen` catch rejects but no `setStatus("error")`, no `ws.close()`. No reconnect at all (EditorTabs effect only reruns on dep change) → "same-endpoint reconnect preserves dirty model" untestable/unimplemented. Pending timeout does not send `$/cancelRequest`.
**W3. Ambient fallbacks forbidden by plan:** `serverUrl ?? "http://127.0.0.1:4803"`, `getAuthToken(profileId)` with `profileId ?? "default"`, `connection?.owner.generation ?? 1`. Plan step 4: never fall back to ambient/first profile. Skip connecting when snapshot not ready. Also `serverUrl.replace(/^http/, "ws")` fragile; reuse existing ws URL helper.
**W4. No `didClose` ever sent.** `notifyDidClose` has no callers; `editor.ts` only `unregisterModel` → server overlay/doc leak until session end; plan success criterion "closing one document sends its didClose" unmet. Store also calls registry inside zustand `set` updaters (impure side effects ×4) and couples store→lib; move to explicit action after `set`.
**W5. Provider coexistence contradicts requirement.** `setModeConfiguration({definitions:false, implementations:false})` is global for all TS/JS models incl. non-owned/diff/scratch; fallback re-implements Definition only via worker (`provideImplementation` returns `null` for non-owned → regression of built-in implementation). Restore sets `true` unconditionally (not previous). Plan: "without changing non-owned models… Phase 01 must prove coexistence" — no Phase 01 evidence referenced. Also fallback ignores cancellation token.
**W6. EditorTabs effect has no cleanup**; `setOptions` closure captures `target`, `project` from first run (deps omit `target`), `Object.assign` mutates a shared singleton so concurrent EditorTabs instances (split panes/other owners) overwrite each other's `getClientForModel`/`onNavigateToFile` → cross-owner leak. Also `getClientForModel` hard-codes generation `1`.
**W7. Test quality.** Browser test #1 activates then asserts only the model URI; #2 tests registry bind/unbind, not Monaco providers or reconnect. No test for real mount ordering, multi-change, replay text, cancel/error distinctness, cross-profile isolation, endpoint change, close/reopen. Plan todo list remains unchecked; no Phase 01 gate evidence for sync/freshness/coexistence.
**W8. `notifyDidOpen` resets `wireVersion = 1`** on a live session → duplicate didOpen with regressed version; violates monotonic versions.

## Suggestions
- `TextEncoder.encode(newFullContent)` per keystroke allocates O(n) every edit; use `Blob`-free byte counting (`utf8ByteLength` loop) or track length incrementally; only needed near threshold.
- Document queue promise chain: `nextTask` rejection (e.g. closed socket) poisons chain; add `.catch`; no byte/queue bound (plan: "reject overload before queue growth").
- `exit` sent without prior `shutdown`; acceptable server-side (teardown) but spec-wise send `shutdown` first or just close.
- Token in WS query string matches existing `/ws` convention (`ws-transport.ts:2351`) — fine; ensure semantic logs never print URL.
- `semantic-model-uri.ts`: `parseSemanticWireUri` — keep; `normalizeRelativePath` accepts backslash conversion silently (differs from server strictness); `getByLocalModelUri` is O(n) per provider call — add index.
- `semantic-navigation.ts`: module-level `activeClients` map outside the store duplicates state; `toggleListeners` pub/sub redundant with `store.subscribe` (KISS/DRY).
- Formatting: missing blank lines after imports/`useEffect` in EditorTabs/MonacoHost (prettier will touch); unused `RegisteredModel`, `formatSemanticWireUri`-adjacent imports, `SemanticMonaco` options type unused fields (`targetId`).

## Positive Observations
- Server: cancelled requests now return `-32800` instead of fake `null` success; orphaned response with no mapped client id is dropped rather than emitted with `id:null` — correct JSON-RPC behavior.
- `did_change` now validates URI/root *before* mutating and closes the doc on malformed input (consistent with existing lines 622/696 pattern) → fail-closed against desync.
- `outbound_tx.closed()` select arm + awaiting aborted auth watcher prevent reader-loop/task leak. `send_outbound` no longer swallows `Ok(Err)` ambiguity. `$/cancelRequest` id validation bounded.
- Strict wire URI parse (traversal, encoded separators, query/fragment, scheme) and exact UTF-16/1-based conversion helpers are sound and well-tested.
- Stable local identity separate from wire binding (design correct; wiring wrong).
- No command/exe config surface; `tsc --noEmit` clean.

## Recommended Actions (priority)
1. Wire store to server semantic status per owner; fix toggle/activate chicken-and-egg (C1).
2. Redesign open/replay: registry subscription, text source, idempotent register, replay sends didOpen with current text (C2).
3. Send all change events; add full-resync path (C3).
4. Owner-scoped client key + per-client binding sets + full-identity replay filter (C4).
5. Move navigation side effects to editor opener; add post-await fences, expectedTargetId, TTL'd intent, correct target for destination tab key (C5).
6. Typed error results + visible status UI; handshake failure cleanup; reconnect; didClose on close (W1, W2, W4).
7. Remove ambient fallbacks; scope manager options per owner; scope built-in suppression (W3, W5, W6).
8. Add real-integration tests (non-mocked mount order, multi-change ≥64 KiB, reconnect replay, cross-profile) and re-run.

## Validation Commands / Results
- `cargo test --test semantic_websocket` (server/) → 8 passed, 0 failed.
- `npx tsc --noEmit -p .` (packages/ui) → clean.
- `npx vitest run` on 5 semantic UI test files → 5 files / 27 tests passed (QA report: 112/112 across wider run).
- `grep` for callers: `setGlobalSemanticEnabled` (def only), `notifyDidClose` (tests/def only), `disconnectClient` (def only).
- Browser tier (`semantic-navigation.browser.tsx`) not run by me.

## Metrics
- Type check: clean. Lint: not run. Coverage: not measured.
- Phase todo: 0/7 honestly complete.

## Unresolved Questions
1. Where should global enable state come from in the UI — per-owner `useSemanticSettings` query, or a push event? Phase 06 API shape should drive C1.
2. Phase 01 gate results (adaptive sync, destination freshness, provider coexistence, stable-model rebind) — not referenced anywhere in code/docs; are G-gates closed? Without them freshness (C5) and coexistence (W5) designs are unverified.
3. Is `damHopperDocumentVersion` stripped server-side in the gateway (UI sends it)? Not re-verified in this diff.
4. Should the client resync on server-side doc close (server→client notification), or should the server return an explicit error for didChange to closed doc?
