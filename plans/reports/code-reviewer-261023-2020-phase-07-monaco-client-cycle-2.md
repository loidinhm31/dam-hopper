# Code Review — Phase 07 Shared Monaco Semantic Client & Navigation — Cycle 2

Plan: `plans/260901-1000-lsp-server-integration/phase-07-shared-monaco-semantic-client-and-navigation.md`
Reviewer: ReviewerPhase07Cycle2 | Date: 2026-10-23 | Prior: `code-reviewer-261023-1955-phase-07-monaco-client.md` (3/10)

## Score: 5/10 — NOT approved. Big cycle-1 gaps closed; 14 existing tests now FAIL, ambient endpoint/token fallback + stale-replay + client leak remain, G8 coexistence unproven.

Handoff claim "128/128 pass" is **false for full UI suite**: `vitest run` → 14 failed / 3153 passed (344/346 files). Cause below (CR1).

## Scope
- Server: `semantic/gateway.rs`, `semantic/session.rs`, `api/semantic_ws.rs`, `tests/semantic_websocket.rs` (unchanged from cycle 1; fine).
- UI: `api/semantic-client.ts` (667), `lib/semantic-model-uri.ts` (380), `lib/semantic-monaco.ts` (416), `stores/semantic-navigation.ts` (195), `MonacoHost.tsx`, `EditorTabs.tsx`, `stores/editor.ts`, 5 unit/component tests + `browser-tests/semantic-navigation.browser.tsx`.
- Plan file: status line updated (still In progress, review cycle 2 not approved). Todos left unchecked.

## Cycle-1 findings: disposition
| ID | Status | Note |
|----|--------|------|
| C1 reachability | FIXED (mostly) | `useSemanticSettings` → store sync in EditorTabs; `setOptions` activates if already enabled. Per-profile → single global boolean (W-A). |
| C2 open/replay | FIXED | registerModel idempotent; replay pulls text + sends didOpen. But replay text source stale (CR3). |
| C3 multi-change | FIXED | all `ev.changes` forwarded. Resync-on-catch path is dead code (W-B). |
| C4 isolation | MOSTLY | client-scoped `clearWireBindings(targetId)`, replay filter by profile/project/targetKey, scope key has wsUrl+gen. Old-generation clients never disconnected (CR4). |
| C5 nav fences | MOSTLY | provider side-effect-free; `registerEditorOpener`; `expectedTargetId`; post-await fence in `queryNavigation`; intent TTL+identity. Destination content/version association still absent (CR5/G8). |
| W1 error vs empty | NOT FIXED | `queryNavigation` catch still returns `{locations: []}` for all errors; outsideTarget → `null`; rejected URIs silently `continue`. `clientStatuses` consumed nowhere → no visible disabled/starting/overload/crash state (plan Requirement last bullet). |
| W2 handshake/timeout | PARTIAL | handshake failure now closes socket + status error. Timeout still no `$/cancelRequest`; handshake reuses 5 s `NAVIGATION_TIMEOUT_MS` (cold TSLS init can exceed). |
| W3 ambient fallbacks | NOT FIXED | see CR2. |
| W4 didClose | FIXED | store calls `notifyDidClose`. Still inside zustand `set` updaters (impure) — style. |
| W5 coexistence | NOT FIXED | see CR5. |
| W6 effect cleanup/singleton | NOT FIXED | see CR4, W-C. |
| W8 didOpen version reset | FIXED | idempotent guard. |

## Critical Issues

**CR1. 14 existing tests regress (plan "Modify existing EditorTabs.test.tsx / MonacoHost.test.tsx" not done).**
`EditorTabs.test.tsx` (6) and `EditorTabsBlame.test.tsx` (8) mock `@/api/queries.js` without `useSemanticSettings` → `Error: [vitest] No "useSemanticSettings" export is defined on the "@/api/queries.js" mock` at `EditorTabs.tsx:140`. Fix: add `useSemanticSettings: () => ({ data: undefined })` (and `useConnectionSnapshot` mocks if needed) to both mocks; add EditorTabs semantic tests (enabled/disabled, cleanup). Full suite must be green.

**CR2. Ambient endpoint + auth token fallback (plan step 4 "never fall back to ambient/first profile"; security).** `EditorTabs.tsx:154-166`:
`serverUrl = connection?.serverUrl ?? "http://127.0.0.1:4803"`, `profileId ?? "default"`, `connection?.owner.generation ?? 1`, `targetGeneration: 1`, no check that connection snapshot is ready/connected. When snapshot is missing/disconnected the client connects to a hard-coded local URL carrying `getAuthToken(profileId)` in the query string → credential sent to an unrelated local service / wrong endpoint. `serverUrl.replace(/^http/,"ws")` fragile; reuse existing ws URL helper. Also no endpoint/root-binding (`ResourceBinding`) match check. Fix: require `connection?.status === connected` (snapshot ready), skip effect otherwise; derive URL via existing helper; take generations from snapshot only.

**CR3. Stale dirty-text replay + reconnect storm (data correctness / perf).** `EditorTabs.tsx:151-256` effect depends on `tabs` (changes every keystroke) and calls `client.connect()` whenever status is `"disconnected"`.
- `getOrCreateClient` returns the existing client and **ignores new options**, so `getModelText` closure is the `tabs` array captured at first creation. Any later reconnect (triggered by the next keystroke after a socket drop) replays **stale initial content** as `didOpen`. For docs ≥64 KiB, subsequent incremental edits then apply to a diverged base; plan requires replay from *current* Monaco/editor state.
- Server down/unsupported project/handshake failure → status returns to `disconnected` → a new connect attempt on every keystroke / any tabs change, no backoff, errors swallowed `.catch(() => {})`.
Fix: `getModelText` must read live state (`useEditorStore.getState()` / Monaco model), not a render closure; remove `tabs` from deps (use refs); explicit reconnect policy with bounded backoff and visible status; no per-keystroke connect.

**CR4. Clients/sockets never retired; wrong-client routing.** EditorTabs effect has no cleanup. Connection-generation, project, profile or worktree change creates a new scope-key client while the previous one stays connected in module-level `activeClients`. `findClientForTab` then returns the first (oldest) matching client by insertion order, and `MonacoHost` `semanticClientRef` is set once (deps exclude generation) so edits/`didClose` can go to a stale client while the model's `wireBinding` belongs to the new session (wire URI of new session sent on old socket). Fix: dispose superseded-generation clients on key change/unmount (effect cleanup or store-level supersede-by-owner), resolve client by current scope, not first match; `disconnectAll` on global toggle-off is also process-global across profiles (W-A).

**CR5. G8 / plan acceptance not met: built-in suppression is global, not model-scoped; no evidence artifact.** `SemanticMonacoManager.activate()` calls `setModeConfiguration({definitions:false, implementations:false})` on TS and JS defaults — affects every TS/JS model (non-owned, scratch, diff, other-profile) and `deactivate` restores `true` unconditionally (not previous). Phase 01 G8 (`phase-01*.md:74`) explicitly: "no global feature disabling … suppressed only for currently owned eligible models; Halt if model-scoped coexistence … cannot be proven". The worker-based fallback reimplements built-ins (also ignores cancellation token; only first path semantics) rather than proving coexistence. `reports/phase-01-web-navigation.md` G8 capture not present. Browser test calls private `provideDefinition` directly with a mocked client, never exercises registered Monaco providers, real suppression, unopened destination, opener, multi-result or real reconnect, so it cannot qualify G8. Also `monaco.languages.typescript` accessed via cast; if 0.55.1 build does not expose it, `getMonacoTypeScriptContribution()` returns null and **no suppression happens at all** → duplicate built-in results (could not inspect `node_modules` — blocked by workspace ignore; [INFERENCE] needs runtime check in the browser tier).
Also: destination freshness (plan steps 8-10 / success criterion) — nothing associates returned range with destination content/version; reveal after fresh `open()` applies server coordinates to freshly read content. Phase 01 G5 proved the server side only; client side unverified. Either implement + prove or explicitly record the G8 stop/revision in plan.

## Warnings

- **W-A.** `globalSemanticEnabled` is one boolean synced from the *current* EditorTabs owner's `GET /api/semantic/settings`. Switching profile/owner flips it (loading → `undefined` → `false` → `disconnectAll()` kills every owner's clients and reveal intent). Should be per-owner/scope state.
- **W-B.** `notifyDidChange` `.catch` → `notifyDidOpen` is a no-op when binding exists (`isAlreadyBound` early-return), and the queued task cannot throw (`sendNotification` swallows closed socket). Full-resync path from plan step 7 is not actually implemented; a failed/ dropped send leaves server doc diverged silently. Add explicit `resync(tabKey)` (didOpen with new version or didClose+didOpen) and trigger on send failure/socket not OPEN; `sendRaw` should report failure.
- **W-C.** `SemanticMonacoManager.setOptions` `Object.assign`s a module singleton; closures capture `tabs`, `setActive`, `connection` from whichever EditorTabs ran last (multi-pane/owner leak; stale `tabs` in `onOpenCodeEditor`). Also `handleOpenCodeEditor` returns `true` for **any** `inmemory://dam-hopper/` resource, hijacking non-semantic opens when ON.
- **W-D.** Binding sessionGeneration is hard-coded 1 forever (`this.sessionGeneration` never incremented); generation fences in `queryNavigation` compare constants. After reconnect wireVersion restarts at 1 — only safe because pending requests are rejected on close. Increment per handshake.
- **W-E.** Multi-result peek with unopened destinations: Monaco peek needs models; no model exists for unopened files (only single-result goto works via opener) [INFERENCE]. Unopened destination URI uses `editorFileTabKey({project, profileId}, path)` without worktree → may not equal real tab key; opener recovers via `open(targetRef…)` but mapping is fragile.
- **W-F.** Test quality: no test for CR2-CR4 paths, real provider registration, reconnect replay text freshness, EditorTabs semantic effect, per-keystroke connect; browser "reconnect" test only calls registry methods.
- **W-G.** `didOpen` replay sends all matching registered models in one sync loop with no byte/queue bound (plan: reject overload before queue growth; initial doc/message bounds).

## Suggestions
- `textEncoder.encode(newFullContent)` allocates O(n) per keystroke; only compute near threshold or count UTF-8 length incrementally via change deltas.
- `activeClients` map + `toggleListeners` duplicate store state/subscribe (KISS): use `store.subscribe` and keep clients in store state.
- Remove unused imports (`RegisteredModel` in client; `ev` param in `onerror`), add blank lines after imports/effects (prettier).
- `findClientForTab` reaches into `client.options` via cast; expose `getScope()`/identity accessor.
- `normalizeRelativePath` silently converts backslashes — differs from server strictness; prefer reject.
- Send `$/cancelRequest` on timeout; surface `-32800/-32003/-32005` as typed results.
- `registerModel` JSDoc says increments incarnation; behavior is idempotent return — fix comment.

## Positive Observations
- Provider/side-effect separation: `provideDefinition` pure; navigation via `registerEditorOpener`; reveal intent has TTL + full identity match.
- `parseSemanticWireUri(…, expectedTargetId)` now enforced; post-await incarnation/session/wireVersion fence in client.
- Idempotent `registerModel`, per-target `clearWireBindings`, replay filter by profile/project/targetKey; stable local vs wire identity design sound.
- All `ev.changes` forwarded in Monaco order (descending offsets valid for sequential LSP application [INFERENCE: standard Monaco ordering]); adaptive 64 KiB threshold with UTF-8 byte count.
- `didClose` on tab close/removal; server fixes (-32800 cancel, fail-closed didChange, writer-closed arm) retained, 8/8 server tests pass.
- Settings endpoint GET is non-admin (verified `router.rs:138`), so ordinary users can enable navigation per plan.

## Validation Commands / Results
- `cd packages/ui && npx tsc --noEmit -p .` → clean.
- `npx vitest run <5 semantic test files + MonacoHost(.semantic).test + EditorTabs.test + editor.test>` → 7 files pass; `EditorTabs.test.tsx` FAIL 6/6 (missing mock export) → 69 pass / 6 fail.
- `npx vitest run` (full UI) → **14 failed / 3153 passed** (2 failed files: `EditorTabs.test.tsx` 6, `EditorTabsBlame.test.tsx` 8), same root cause.
- `cd server && cargo test --test semantic_websocket` → 8 passed, 0 failed.
- Browser tier (`pnpm test:browser`) and eslint not run by me; browser test inspected statically.

## Metrics
- Type check: clean. Lint: not run. UI full-suite: 14 regressions. Coverage: not measured.
- Phase todo: 0/7 closable yet (G8 gate evidence missing; coexistence/freshness unproven).

## Recommended Actions (priority)
1. Fix the two mocks + add EditorTabs semantic tests; full `vitest run` green (CR1).
2. Remove ambient URL/profile/generation fallbacks; require ready connection snapshot; use existing ws URL helper (CR2).
3. Live `getModelText`; drop `tabs` dep; bounded reconnect/backoff + visible status; per-owner state (CR3, W-A).
4. Dispose superseded clients / cleanup on unmount; resolve client by current scope; update `semanticClientRef` on client change (CR4).
5. Model-scoped provider coexistence or record G8 stop; add real-browser test exercising registered providers/opener/suppression; produce `phase-01-web-navigation.md` evidence; destination freshness decision (CR5).
6. Typed error results + status UI; cancel on timeout; real resync path; increment sessionGeneration (W1, W-B, W-D).

## Unresolved Questions
1. Does monaco-editor 0.55.1 still expose `monaco.languages.typescript` (`setModeConfiguration`)? If not, suppression never happens. Needs browser-tier assertion.
2. Is a provider-level (model-scoped) suppression mechanism acceptable vs. global `modeConfiguration` toggle — i.e. should G8 be formally revised/stopped?
3. Should `globalSemanticEnabled` be per-owner (profile) state, given `GET /api/semantic/settings` is per server/profile?
4. Destination freshness: is "re-query after open" via the Phase 01 G5 version extension the intended client proof, or should reveal be dropped when destination content differs from server overlay?
