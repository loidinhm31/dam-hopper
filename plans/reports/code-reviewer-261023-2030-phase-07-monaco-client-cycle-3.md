# Code Review — Phase 07 Shared Monaco Semantic Client & Navigation — Cycle 3

Plan: `plans/260901-1000-lsp-server-integration/phase-07-shared-monaco-semantic-client-and-navigation.md`
Reviewer: ReviewerPhase07Cycle3 | Date: 2026-10-23 | Prior: cycle 2 `code-reviewer-261023-2020-...-cycle-2.md` (5/10)

## Score: 6/10 — NOT approved

Cycle-2 CR1–CR4 genuinely fixed (verified, not taken on trust). Remaining: 1 new critical (stale client ref after reconnect → server doc diverges), G8 still unproven (STOP gate), freshness/status-UI/error-typing/resync gaps unchanged since cycle 2. Todos cannot be closed.

## Scope
- Server (unchanged vs cycle 2 per diff stat; re-run tests only): `semantic/gateway.rs`, `semantic/session.rs`, `api/semantic_ws.rs`, `tests/semantic_websocket.rs`.
- UI: `api/semantic-client.ts` (667), `lib/semantic-model-uri.ts` (380), `lib/semantic-monaco.ts` (416), `stores/semantic-navigation.ts` (195), `MonacoHost.tsx`, `EditorTabs.tsx`, `stores/editor.ts`, EditorTabs(+Blame) tests, `MonacoHost.semantic.test.tsx`, `semantic-navigation.browser.tsx`.
- Plan file status line updated (Cycle 3, not approved). Todos left unchecked.

## Cycle-2 disposition
| ID | Status | Evidence |
|----|--------|----------|
| CR1 14 failing tests | FIXED | `useSemanticSettings` added to both mocks; full `vitest run` 346/346 files, 3167/3167. But no *new* EditorTabs semantic tests added (mock stub only) — W-3. |
| CR2 ambient URL/profile/generation | FIXED | `EditorTabs.tsx:151-166` requires `semanticEnabled`, `project`, `connection.status==="connected"`, `targetRef.profileId`; url/generation from snapshot; no `127.0.0.1:4803`/"default" fallback in connect path. Token in `?token=` matches existing `ws-transport.ts:2351` convention. Residual: `"default"` fallbacks remain in `MonacoHost.tsx:200,230,343` (registry/reveal identity) — W-6. |
| CR3 stale replay / per-keystroke connect | FIXED | `getModelText` reads `useEditorStore.getState().tabs` live (`EditorTabs.tsx:185-189`); `tabs` removed from deps; open effect in MonacoHost no longer depends on content. |
| CR4 client leak | MOSTLY FIXED | cleanup → `disconnectClient(scopeKey)` (`:265-267`); `findClientForTab` unchanged but now at most one client/scope. **New critical C-1** from the MonacoHost side. |
| CR5 G8 | NOT FIXED | see W-1/C-2. |
| W1 error vs empty | NOT FIXED | `queryNavigation` catch (`semantic-client.ts:496-501`) still returns `{locations: []}` for every error; `clientStatuses` consumed nowhere (grep: only store). |
| W2 timeout cancel | NOT FIXED | timeout (`:601-604`) rejects with no `$/cancelRequest`; handshake still 5 s. |
| W-A..W-G | NOT FIXED | W-B dead resync (`:392-395`, `notifyDidOpen` early-returns when bound), W-D sessionGeneration const 1, W-C singleton `setOptions`/hijack, global boolean. |

## Critical Issues

**C-1. Edits stop reaching the live session after reconnect/generation change (data correctness).**
`MonacoHost.tsx:183-219`: `semanticClientRef.current` is assigned only inside an effect whose deps are `[semanticEnabled, tabKey, path, project, targetKey, profileId]`. `EditorTabs.tsx:265-277` now correctly disposes the client and creates a new one when `connection.owner.generation`/`serverUrl`/`status` changes, but MonacoHost is not notified. After that: `onChange` (`:640`) calls `notifyDidChange` on the **disposed** client (`status==="disconnected"` → returns 0 silently, `semantic-client.ts:351`). New client replays text once at `ready` (from live store), then every later keystroke is dropped → server overlay stale → definition/implementation ranges computed against old text (and wrong-line reveal). Same effect for a same-client socket drop: nothing reconnects (no policy, `connect()` only invoked from EditorTabs effect), silent permanent degradation.
Fix: resolve client at call time (`findClientForTab(tabKey)` inside `onChange`) instead of caching in a ref, or subscribe to `clientStatuses`/a client-generation counter in effect deps. Add a MonacoHost test: client A → generation bump → client B → type → B (not A) receives `notifyDidChange`. Current `MonacoHost.semantic.test.tsx` mocks `findClientForTab` with a constant and never asserts onChange wiring.

**C-2. G8 gate not satisfied; plan acceptance/todo 4 stays blocked.**
Phase 01 ledger (`reports/phase-01-gate-disposition.md:23`, `phase-01-web-navigation.md:14-18,49`): G8 = **STOP** until Phase 07 proves *model-scoped* coexistence without global feature disabling. Implementation (`semantic-monaco.ts:122-136,177-192`) still does global `typescriptDefaults/javascriptDefaults.setModeConfiguration({definitions:false, implementations:false})` (spread of current config, then restore to unconditional `true`, not prior value) and re-implements built-ins via the TS worker for non-owned models. That is a global side-effect + reimplementation, not a proof; no evidence update to `phase-01-web-navigation.md`/ledger. The browser test (`semantic-navigation.browser.tsx`) passes (2/2) but: calls private `provideDefinition` through an `as unknown` cast (`:122-128`), never asserts via Monaco's provider registry/`goToDefinition` command, never asserts suppression, non-owned model fallback, OFF restoration, or that `monaco.languages.typescript` exists; the "reconnect" test only calls registry methods (`:183-207`) — no `SemanticClient`, no EditorTabs/MonacoHost. Handoff claim "real browser test verifies DefinitionProvider routing, … dirty buffer across simulated reconnect" is overstated.
Fix: either (a) browser test that (i) opens an owned and a non-owned TS model, (ii) triggers real Monaco definition (editor action `editor.action.revealDefinition`) and asserts owned→semantic only/no duplicates and non-owned→built-in still resolves, (iii) toggles OFF and asserts built-in restored with previous config; then record GO in ledger; or (b) record explicit G8 STOP/revision in plan and keep feature gated. Gating decision required before approval.

## Warnings

- **W-1 (freshness, plan step 10 / success criterion 5).** Reveal intent (`EditorTabs.tsx:211-259`, `MonacoHost.tsx:221-248`) applies server coordinates to destination content opened later; no content/version association, `targetId:""` never validated, no source-request/session/incarnation fence on intent. G5 is "UNQUALIFIED (Simulated)" in ledger. Unproven, undocumented.
- **W-2 (visible states).** Plan requirement "visible disabled/starting/unsupported/overloaded/timeout/crashed" unmet: `clientStatuses` produced, never rendered; all errors/timeouts/denials/outsideTarget → empty/`null` → "No definition found". Users cannot distinguish. Type error results (`-32800/-32003/-32005`, timeout) and surface a status indicator.
- **W-3 (tests).** CR1 requested EditorTabs semantic tests (enabled/disabled, cleanup on generation change, no ambient connect when snapshot missing) — only a mock stub added (`EditorTabs.test.tsx:53`). The new effect (security-sensitive: gating + token) has **zero** direct tests. Add: not-connected → no `getOrCreateClient`; generation change → old client disconnected; disabled → none.
- **W-4 (reconnect policy).** No reconnect/backoff and no status after unexpected socket close; provider silently falls back to built-in worker (`semantic-monaco.ts:220-221`) when client is not ready, mixing non-project-aware results into owned models. Decide: show "starting/disconnected", don't silently substitute, or document as intended.
- **W-5 (timeout/cancel).** No `$/cancelRequest` on timeout; handshake shares 5 s navigation timeout (cold TSLS init may exceed) → spurious `error` state and socket close.
- **W-6 (residual ambient defaults).** `profileId ?? "default"` in MonacoHost (`:200,230,343`) and `connectionProfileId = targetRef.profileId ?? "default"` (`EditorTabs.tsx:138`, harmless due to guard but queries snapshot of a profile named "default"). Prefer skip when undefined.
- **W-7 (singleton options).** `defaultSemanticMonacoManager.setOptions` `Object.assign`s closures from last-mounted EditorTabs (stale `targetRef`, `serverUrl`, `connectionGen`); multi-pane/owner leak; cleanup disposes client but not options. `handleOpenCodeEditor` returns true for any `inmemory://dam-hopper/` resource and `onOpenCodeEditor` parses `JSON.parse(tabKey)` last element as path (couples to tab-key format; throws caught → false).
- **W-8 (global boolean).** `globalSemanticEnabled` is derived from the currently mounted EditorTabs' profile; profile switch → `disconnectAll()` kills other owners' clients & reveal intent.
- **W-9 (resync/version).** `notifyDidChange` catch → `notifyDidOpen` is no-op when already bound; `sendNotification` swallows closed socket so failure undetected; sessionGeneration constant 1. Plan step 7 resync not implemented.
- **W-10 (purity).** `editor.ts` calls `client.notifyDidClose`/registry mutation inside zustand `set` updaters (side-effects in reducers; may double-run under StrictMode-like replays).

## Suggestions
- ESLint: 8 warnings, 0 errors — unused `formatSemanticWireUri`, `RegisteredModel`, `event` (`semantic-client.ts:16,20,159`), `buildSemanticScopeKey` (`MonacoHost.tsx:49`), `ProfileId` (`editor.ts:19`), 3× `react-hooks/exhaustive-deps` (EditorTabs:268, MonacoHost:212,241). Clean the unused imports.
- `findClientForTab` casts to access private `options`; expose `getScope()`.
- `serverUrl.replace(/^http/,"ws") + "/ws/semantic/v1"` breaks on trailing slash/path; use `new URL()` as `ws-transport.ts:2341`.
- `TextEncoder.encode(newFullContent)` per keystroke O(n); only needed near threshold.
- `activeClients` module map + `toggleListeners` duplicates store state; use `store.subscribe`.
- `registerModel` JSDoc says "increments incarnation" but idempotent.
- `replayMatchingModels` unbounded sync loop; add byte bound (plan: reject overload before queue growth).

## Positive Observations
- Connect gating now strict (connected snapshot, profile, project; generation from snapshot); cleanup disposes superseded client.
- Live model text for replay; no per-keystroke connect; open effect decoupled from content.
- Provider side-effect-free; `registerEditorOpener` for navigation; reveal TTL + full identity match; wire-URI parse with `expectedTargetId`; post-await fence in client.
- All `ev.changes` forwarded; adaptive 64 KiB threshold by UTF-8 bytes.
- Server: 8/8 websocket + 43 lib semantic tests pass; fail-closed didChange, cancellation retained.
- Full UI suite green (3167/3167).

## Validation Commands / Results
- `cd packages/ui && npx tsc --noEmit -p .` → exit 0, no errors.
- `cd packages/ui && npx vitest run` → 346 files / 3167 tests passed, 0 failed (jsdom "navigation not implemented" stderr noise pre-existing).
- `cd packages/ui && npx vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` → 1 file, 2 tests passed (see C-2 on test strength).
- `cd server && cargo test --test semantic_websocket` → 8 passed; `cargo test --lib semantic` → 43 passed.
- `npx eslint <7 changed src files>` → 0 errors, 8 warnings (listed above).
- Not run: Playwright e2e, coverage, full cargo suite, manual browser (C-1 is from static reading, not executed repro) [INFERENCE: relies on `connection.owner.generation` changing on reconnect].

## Metrics
- Type check: clean. Lint: 0 errors/8 warnings. UI tests 3167/3167. Server semantic tests 51/51 run. Coverage: not measured.
- Phase todo: 0/7 closable (todo 4/6/7 blocked by C-1, C-2, W-1).

## Recommended Actions (priority)
1. Fix C-1: resolve client at call time in `onChange`/`notifyDidClose`; add generation-change MonacoHost test.
2. Resolve G8 (C-2): real-browser test through Monaco's definition action with owned/non-owned/OFF cases, record GO/STOP in `phase-01-web-navigation.md` + ledger; avoid global config toggle or prove collateral-free restoration (save/restore previous config).
3. Add EditorTabs effect tests (W-3); clean lint warnings.
4. Typed errors + visible status indicator (W-2, W-4); `$/cancelRequest` + separate handshake timeout (W-5).
5. Destination freshness decision/implementation or explicit plan revision (W-1); real resync + session generation increment (W-9).

## Unresolved Questions
1. Does `connection.owner.generation` change on same-endpoint reconnect (so a new scope key/client is created — C-1 trigger)? Confirm in `connections.ts`; if it never changes, only the socket-drop/no-reconnect variant applies.
2. Is the global `setModeConfiguration` + worker-fallback design acceptable as G8 "model-scoped coexistence", or must G8 be formally revised/stopped?
3. Destination freshness: is "requery after open via Phase 01 G5 version extension" the intended proof, or may reveal be dropped when destination content differs?
4. Should unexpected socket loss auto-reconnect (bounded backoff) or remain manual until the user re-toggles/reconnects?
