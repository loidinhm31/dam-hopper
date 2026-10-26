# Code Review — Phase 08 Lifecycle Invalidation and Recovery

Date: 2026-10-23 | Reviewer: EvcCodeReviewer | Branch: feat/lsp-server-integration-reassess (uncommitted diff over 3a2d11f1)
Plan: `plans/260901-1000-lsp-server-integration/phase-08-lifecycle-invalidation-and-recovery.md`

## Score: 5.5 / 10

Two-phase invalidation core is sound & lock-safe. Cancellation/ref-count/side-effect extraction mostly good. But: resync path breaks navigation (reproduced), recovery after server-side invalidation missing (client never learns, indicator lies), over-invalidation on unrelated config edits / worktree add, reap under `workspace_context_guard` in git.rs path, handle leak in import-failure path, several dead APIs, a few Phase 07 remediation items claimed but not delivered. Phase 08 todo list: NOT complete (see plan update).

## Scope
Files reviewed (diff + surrounding code): `server/src/semantic/supervisor.rs`, `server/src/api/{workspace,config,settings,semantic_ws}.rs`, `server/src/{state,main}.rs`, `server/src/semantic/{gateway,session}.rs` (callers/handle semantics), `server/src/api/git.rs` (callers of `invalidate_project_worktrees`), `server/tests/semantic_supervisor.rs`; UI: `api/semantic-client.ts(+test)`, `stores/{editor,semantic-navigation}.ts(+test)`, `lib/semantic-monaco.ts`, `components/organisms/{MonacoHost,EditorTabs,EditorStatusBar}.tsx`, `MonacoHost.semantic.test.tsx`, `EditorTabs.semantic.test.tsx`. Plan phase file. Tester report `plans/reports/tester-261023-2130-phase-08-lifecycle.md` consumed (not re-run in full).

## Answers to the 5 focus questions
1. **Two-phase / lock safety**: YES for deadlock. Supervisor locks (`sessions`, `connection_epochs`, `active_reap_tasks`) never acquire workspace/config locks; nested order is only `sessions(w) -> connection_epochs(r)` (supervisor.rs:445-456) and no path takes the reverse -> acyclic. workspace/config/settings/import paths prepare under guard and `reap_sessions` after guard release (workspace.rs:166-186,203-224; config.rs:718-724; settings.rs:256-258 + drop guard). Tombstoning: `prepare_invalidate_all` tombstones all epochs (None), `invalidate_connection` tombstones, `register_connection` after revoke tombstones (returns 0). OK. BUT: (a) gateway/resolver do not take `workspace_context_guard.read()`, so a *new* connection registered between `prepare_invalidate_all` and config publish can attach to the old root and survive (narrow race, W-1); (b) `git.rs` removal path reaps while holding the guard (C-3); (c) import failure path drops handles (W-2).
2. **Cancellation safety**: Local cancel + timer clear + `$/cancelRequest` are correct; late response ignored since `handleMessage` looks up `pendingRequests` (client.ts:630-633); timeout path deletes pending first. Test covers late response. BUT the `-32003` resync path is broken (C-1).
3. **Side-effect isolation (editor.ts)**: YES for `close/closeOthers/closeAll`; no side effects remain in reducers (editor.ts:762-900). Flags assigned inside reducer are fine (zustand vanilla runs updater synchronously once).
4. **Scoping/ref-count**: ref-count implemented & tested. Per-profile enable implemented. "default" fallbacks NOT fully eliminated: `MonacoHost.tsx:341` still `?? "default"`; `isSemanticEnabledForProfile` falls back to global for unknown profile (W-3); `useConnectionSnapshot(profileId ?? "")` (W-9).
5. **Status indicator**: partially accurate. Wrong label for `unsupported` (shows "Starting"); lookup via registry-dependent `findClientForTab` can be stale/null at first render; server-side tombstone never changes client status so it shows "Ready" while all queries fail (C-2).

## Critical Issues

**C-1. `-32003` resync permanently breaks navigation for all docs of the client** (`semantic-client.ts:553-567`, fences at 496/527, 302-310).
`resyncDocument` does `this.sessionGeneration++` but never rebinds wire bindings. `queryNavigation` snapshots `requestSessionGen = this.sessionGeneration` and post-await requires `wireBinding.sessionGeneration === requestSessionGen`; bindings keep the old generation, so every later definition/implementation result is discarded `{locations: []}` for the resynced doc AND all other docs on the client (also `notifyDidOpen` sees `isAlreadyBound=false` and re-sends didOpen v1 on the same URI). Reproduced: temp probe = existing -32003 test + second `getDefinition` answered with a valid location -> got 0 locations (probe deleted). Existing test does not assert post-resync navigation. Fix: do not bump global generation (resync is per-document; plan says "increment session generation" only to fence stale results); instead bump the doc's wire version only (already done by `bumpWireVersion`) and let version fence drop stale results, or rebind the document with the new generation. Also route resync through `documentQueues` (currently bypasses queue; a queued incremental/full didChange carrying older `newVersion` can be sent after the resync version -> server sees regression/-32003 again). Guard concurrent resyncs per tabKey. Add test: query -> -32003 -> second query returns locations.
Cause confirmed: same probe with the `this.sessionGeneration++` line temporarily removed -> 7/7 pass (second query returns 1 location); source restored afterwards (diff unchanged). So the global generation bump is the cause, not the version fence or URI mapping.

**C-2. No recovery path after server-side invalidation; client reports Ready while dead** (`supervisor.rs:553-565` tombstone; `semantic_ws.rs` no epoch watch; `semantic-client.ts:535-545`, `726-745`).
`prepare_invalidate_all` (workspace switch/init, config reload, cache clear, import) tombstones all connection epochs permanently but does not close the sockets. Gateway answers `-32005 AUTH_REVOKED`; client swallows every RPC error to `{locations: []}`, never changes status, never reconnects (no reconnect/backoff exists; effect in EditorTabs only reconnects on dep change, and connection generation does not change on workspace switch). Result: semantic navigation silently dead until page reload; indicator keeps "TS/JS Ready". Violates Phase 08 Requirements ("Recovery requires ... fresh attach/init/full replay", "retain explicit invalidated/unavailable state") and todo "define reconnect/backoff policy". Fix: (server) close WS (or send a `-32005` + close) for tombstoned connections / emit session-invalidated notification; (client) on `-32005`/socket close set status `error|disconnected`, re-attach with fresh handshake + `replayMatchingModels`, bounded backoff. Add test.
Evidence class: static trace (no client handling of `-32005`, no epoch watch in `semantic_ws.rs`, no reconnect code); not reproduced at runtime.

## High Priority Findings

**H-1. Reap awaited while holding `workspace_context_guard.write()` in worktree removal** (`state.rs:191-206` -> `invalidate_project/invalidate_all`; call sites `git.rs:459,490` inside `remove_worktree_route` which holds the guard from git.rs:407). `git.rs` itself is not in the changed set; the new `state.rs` hook runs inside existing routes.
No deadlock (actors don't take the guard) but `invalidate_project` awaits sequential `handle.shutdown()` up to `TOTAL_TEARDOWN_BUDGET` (5s) each under the write guard, stalling terminals/media/fs reads/config reload — directly contradicts plan Architecture ("no child wait under mutation authority"). Use prepare (under guard) / reap (after guard) like the other call sites, or `spawn_reap_sessions`.

**H-2. Over-invalidation: any config edit tombstones every connection; worktree *add*/prune kill all project sessions** (`config.rs:731` unconditional `prepare_invalidate_all`; callers `config.rs:53,206`; `state.rs:191` called from `git.rs:356` add and `:521` prune). Perf/UX alone; escalates to "semantic dead until reload" while C-2 stands.
Plan Step 2/3: "unrelated config changes must not erase ...", "Refresh invalidates only if identity/generation actually changed". Compare target-root/project set (config diff) before invalidating; scope by target (`prepare_invalidate_target` exists but is unused). Fallback `invalidate_all` when project path lookup misses (`state.rs:204`) compares raw `Path`s (`p.path` vs canonical `project_root`) — likely to hit fallback often.

**H-3. Regression: turning semantic OFF no longer deactivates Monaco providers / restores built-in TS navigation** (`EditorTabs.tsx:~157-162` now calls `setProfileSemanticEnabled`; `semantic-navigation.ts` `setProfileSemanticEnabled` never invokes `toggleListeners`; `semantic-monaco.ts:480-485` is the only subscriber and `deactivate()` (208-233) restores `definitions/implementations: true`; the only remaining `setGlobalSemanticEnabled` callers are tests). After runtime OFF the delegating providers stay active with built-in definitions/implementations still suppressed and no client -> go-to-definition dead instead of default behaviour. Fix: notify listeners when derived `globalSemanticEnabled` flips (compute in `setProfileSemanticEnabled`), add test.

**H-4. Singleton `defaultSemanticMonacoManager.setOptions` closure is last-writer-wins across EditorTabs instances and never reset** (`EditorTabs.tsx:~213-270`; `resetOptions` unused). `onOpenCodeEditor` captures that instance's `targetRef/profileId/project/targetScopeKey` (fallback open + reveal intent use them), so cross-target navigation can open/reveal in the wrong profile/target when multiple EditorTabs exist, and stale closures survive unmount. Call `resetOptions()` in cleanup (only if options still belong to this instance) and derive profile/target from the model, not closure.

## Warnings

- **W-1** Admission fence gap: `prepare_invalidate_all` only bumps `runtime_epoch` + tombstones existing epochs; connections registered afterward get a fresh epoch and can resolve/attach via not-yet-invalidated resolver/config before publication (gateway takes no `workspace_context_guard.read()`). Sessions created in that window are not in the detached list. Fix: hold guard.read across resolve+`get_or_create_session`, or re-run `prepare_invalidate_all` after publication (cheap), or tag sessions with a config generation.
- **W-2** `settings.rs:260-261`: restore-path `reload_config_locked` returns `Vec<SemanticSessionHandle>`; only `.is_ok()` is read, handles dropped un-reaped. Handles are `Clone` and gateways keep clones, so detached sessions stay alive until the socket closes. Reap them (or reap in `reload_config_locked` failure branches).
- **W-3** `isSemanticEnabledForProfile` returns `globalSemanticEnabled` for unknown profile (`semantic-navigation.ts:~120`), and global = OR of profiles -> profile B inherits profile A's ON. Default to `false`. `MonacoHost.tsx:341` still `?? "default"`; `MonacoHost.tsx:~180` falls back to global when profileId missing. Plan Cleanup W-6 claims elimination. No test for unknown-profile.
- **W-4** `reap_sessions` is sequential: N sessions x 5s inline in HTTP handlers (workspace switch, import, config reload) with up to `MAX_GLOBAL_SEMANTIC_TREES` sessions. Use `join_all`/`JoinSet`. `SemanticSupervisor::shutdown()` (supervisor.rs:~716) still has no per-session timeout (pre-existing; early `revoke_admission` in main.rs helps admission only; existing sessions are not cancelled until after HTTP drain, main.rs:1120-1121).
- **W-5** Misleading error: project/target invalidation bumps global `runtime_epoch` (supervisor.rs ~565/582), so an unrelated in-flight `get_or_create_session` fails with `SupervisorError::Disabled` -> gateway maps to `SEMANTIC_DISABLED` -32000 (user sees "disabled"). Use a distinct error / retry.
- **W-6** `spawn_reap_sessions` tracking is racy: handle registration happens in a second `tokio::spawn`; `shutdown()` can `take()` the vec before registration, leaving an untracked reap. Also **no caller** (see dead code).
- **W-7** `EditorStatusBar`: `unsupported` status renders label "TS/JS Starting" (EditorStatusBar.tsx label ternary). `activeSemanticStatus` memo (EditorTabs.tsx ~527) uses registry-dependent `findClientForTab`; model is registered in MonacoHost effect after first render and registration does not change `clientStatuses`, so indicator can be null until another dep changes. No status-bar test for the indicator (`EditorStatusBar.test.tsx` has no semantic cases). When semantic enabled but no client yet, no "starting" indicator.
- **W-8** `findClientForTab` (semantic-navigation.ts:167) matches first client by profile/project/targetKey, ignoring serverUrl/connectionGeneration, and reads private `options` via `as unknown as` cast. Plan requires exact owner/handle capture to stop cross-generation leakage; works today only because effect cleanup precedes re-acquire.
- **W-9** `useConnectionSnapshot(connectionProfileId ?? "")` (EditorTabs.tsx) swaps `"default"` for `""` — still a silent fallback key; gate the hook instead.
- **W-10** `setProfileSemanticEnabled(false)` disconnects by `key.startsWith(profileId + "::")` ignoring ref counts and without bumping/notifying; subsequent `releaseClient` is a no-op (OK) but prefix match is fragile if a profile id contains `::`. `globalSemanticEnabled: enabled || some(...)` is redundant (the `some` already includes `enabled`).
- **W-11** `resetOptions()` (semantic-monaco.ts:149) has no caller (prod or test); plan item "clean singleton manager options on unmount" not delivered (EditorTabs cleanup only `releaseClient`).
- **W-12** Test gaps: no tests for workspace/config/settings/cache two-phase wiring, `spawn_reap_sessions`, target-scoped invalidation, concurrent create-vs-invalidate, status-bar indicator, post-resync navigation, timeout-path `$/cancelRequest`. Added `MonacoHost.semantic.test.tsx` case is an unsupported-path test, not the planned generation-bump test.

## Suggestions
- Remove dead API (YAGNI): `reset_admission_revocation`, `prepare_invalidate_target`/`invalidate_target` (or use them for worktree removal instead of project-wide), `spawn_reap_sessions` + `active_reap_tasks` (or wire them for the git.rs path), `registerSemanticToggleListener` (no subscribers; pre-existing).
- `set_enabled(false)` -> `shutdown()` -> `revoke_admission()` is a one-way latch; `set_enabled(true)` afterwards never re-admits (`reset_admission_revocation` never called). Test-only API today but a trap; split shutdown from OFF.
- Doc comment on `prepare_invalidate_*` says "synchronously" but they are `async` lock acquisitions; reword.
- DRY: `prepare_invalidate_project/target` and `invalidate_connection` repeat the same filter-drain loop; extract `drain_where(pred)`.
- DRY: `invalidate_project_worktrees` project-name lookup could live in resolver/state helper; compare canonicalized paths.
- Stronger typing: expose `getOptions()`/`matches(identity)` on `SemanticClient` instead of casting private `options`.
- Add cleanup of Monaco cancellation-token listener after request settles (minor leak per request).

## Positive Observations
- Lock-safe two-phase pattern applied consistently at all four `reinit_sandbox` publication sites (workspace init/switch, config reload, cache clear) with guard scoped by block; `workspace_target_resolver.invalidate_all()` added to init/switch/cache.
- Tombstone semantics (None) prevent resurrection; `register_connection` post-revoke tombstones; `get_or_create_session` re-checks runtime + connection epoch after spawn.
- `writer_task` abort/join fix removes a leak; early admission cutoff on shutdown signal is minimal and correct for admission.
- `SemanticClient` cancellation: pending removed + timer cleared + rejection + notification; handshake vs navigation timeouts split; `$/cancelRequest` not sent for handshake methods.
- Zustand reducers now pure; side effects after `set`, guarded by `wasRemoved`.
- Ref-counted `getOrCreateClient/releaseClient` with tests; profile-scoped disable test.
- Tester: 61 backend semantic + 70 frontend semantic tests passing; typechecks clean.

## Validation
| Command | Result |
|---|---|
| Tester run (EvcTester, `plans/reports/tester-261023-2130-phase-08-lifecycle.md`): `cargo test --test 'semantic_*'`, UI semantic vitest set, `cargo check`, `tsc --noEmit`, build, browser spec | PASS (171/171) — reported by tester, not re-executed by me |
| Reviewer probe A: existing `semantic-client.test.ts` copied + post-resync second `getDefinition` | FAIL (`expected 0 to be 1`) |
| Reviewer probe B: same, with `this.sessionGeneration++` temporarily removed from `resyncDocument` | PASS 7/7 -> cause of C-1 confirmed. Probe file removed, source restored (`git diff --stat` unchanged: +46/-7 on semantic-client.ts) |
| Static trace: lock order, callers of `reload_config_locked`, `invalidate_project_worktrees`, `spawn_reap_sessions`, `resetOptions` | done (see findings) |

Passing suites do not cover C-1, C-2, H-1..H-4: tests are green while the issues exist. C-2 is a static-trace finding (not reproduced); H-1/H-2 are static traces of existing `git.rs` routes calling the new `state.rs` hook.

## Plan todo status (Phase 08)
Done: scoped admission stop/drain (partly: dead scoped target API), workspace/config/import/cache boundaries (over-broad), editor side-effect extraction, ref-count/profile scoping (partly), `$/cancelRequest` + timeout split (W-5), EditorTabs semantic tests (W-3).
Not done / partial: worktree boundary (git.rs unchanged; state hook over-invalidates, reaps under guard), per-document didClose vs session teardown (not touched), live-auth integration (unchanged), dirty-model replay/reconnect policy (absent), W-9 resync (broken), W-2/W-4 visible status (partial), W-6/W-7/W-8/W-10 cleanup (partial), G8/G5 live browser verification (not run). Phase should stay In Progress.

## Recommended Actions (priority)
1. Fix C-1 (drop global `sessionGeneration++` or rebind; queue resync; add post-resync navigation test).
2. Implement C-2 (server close/notify on tombstone; client error->reconnect->replay; indicator reflects it).
3. Fix H-1 (prepare under guard / reap after for git.rs path).
4. Fix H-2 (invalidate only on identity change; use target scope).
5. Fix H-3 (notify toggle listeners; deactivate providers on OFF) and H-4 (reset singleton options per instance).
6. Reap handles in settings restore path (W-2); parallelize reap (W-4); close admission window (W-1).
7. Finish scoping cleanup (W-3, W-9, W-11) and status bar (W-7); add missing tests (W-12); delete dead code.

## Unresolved Questions
1. Should tombstoned-by-config-reload connections be closed by server (client reconnects) or should epochs be re-armed in place (no tombstone) for non-identity changes? Plan is silent on mechanism.
2. Is `git.rs` worktree wiring intentionally deferred to a later phase (file untouched; only `state.rs` hook)? Plan lists it in Phase 08 scope.
3. Is per-document `didClose` isolation + live-auth integration considered already delivered by Phases 04/05 (task list in phase file still unchecked)?
4. Was plan's "increment session generation" on resync meant as client-global? As implemented it invalidates all docs; confirm intended semantics.
