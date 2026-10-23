# Phase 08 — Lifecycle Invalidation and Recovery: Code Review

## Score: 5.5/10 — Changes required

Static review finds useful cleanup, but end-to-end model/client routing and lifecycle fencing remain incomplete. Earlier green focused suites do not establish Phase 08 acceptance. Findings below describe current code; inherited Phase 07 defects are identified rather than presented as newly introduced regressions.

## Scope and evidence

- Reviewed working-tree changes plus relevant caller/ownership contracts; no source/test/plan edits. This report is the only authored artifact. Plan ownership remains with Main.
- Required guidance read: published `evcrate/AGENTS.md`, development rules, primary workflow; `code-review/SKILL.md` and verification reference. Project context: `README.md`, `docs/project-overview-pdr.md:1-83`, `docs/code-standards.md:19-43,90-112`, `docs/architecture/semantic-websocket-gateway.md:1-125`, phase overview and Phase 08 plan.
- Findings are based on inspected code paths. Runtime scenarios below are **[INFERENCE]**, not executed reproductions. Confidence describes strength of static evidence.
- No build, test, lint, formatter, browser, or temporary probe executed in this review; main-agent verification ownership respected.

## Critical issues / acceptance blockers

### C1 — Real editor models cannot find their semantic client: incompatible target keys

**Priority:** High / functional blocker. **Confidence:** High. **Origin:** inherited integration defect, still present in the Phase 08 paths being remediated.

**Evidence:**
- `packages/ui/src/api/client.ts:2242-2246`: `projectTargetCacheKey()` returns `root` or `worktree:<path>`.
- `packages/ui/src/stores/editor.ts:41-46,625-642`: `editorTargetScopeKey()` returns `<profile>::<project>::<cache-key>`, but real `Tab.targetKey` is only `projectTargetCacheKey(targetRef)`.
- `packages/ui/src/components/organisms/EditorTabs.tsx:108-111,182-199`: the semantic client receives the composite `targetScopeKey` as `options.targetKey`.
- `packages/ui/src/components/organisms/MonacoHost.tsx:195-205`: the registered model receives the non-composite `effectiveTab.targetKey`.
- `packages/ui/src/stores/semantic-navigation.ts:175-186` and `packages/ui/src/api/semantic-client.ts:251-257`: lookup and replay require exact target-key equality.

**Failure/impact [INFERENCE]:** For profile `p`, project `app`, root target, client key is `p::app::root` while model key is `root`. `findClientForTab()` returns null; model open/change/close routing and reconnect replay miss the client. `EditorTabs.tsx:531-538` consequently supplies no semantic status. Monaco can fall back to its built-in worker instead of using the advertised server semantics.

**Correction:** Keep the existing composite editor scope for active-tab storage, but use one canonical target discriminator (`projectTargetCacheKey(targetRef)`) for client/model matching and semantic reveal matching. Profile/project/endpoint/generation already belong in the enclosing semantic scope. Add an integration regression with a real editor-store-created tab, real registry/store lookup, and root/worktree targets; do not mock `findClientForTab`.

**Coverage gap:** `MonacoHost.semantic.test.tsx:94-101` mocks the lookup. `EditorTabs.semantic.test.tsx:93-112,178-187` hand-builds target keys and mocks acquisition; it does not connect these contracts.

### C2 — Phase-one detachment does not revoke existing actor handles or fence outgoing results

**Priority:** High / authority-boundary blocker. **Confidence:** High.

**Evidence:**
- `server/src/semantic/supervisor.rs:543-552`: all-scope prepare increments runtime epoch, tombstones connections, and drains registry handles; it does not invalidate actor handles.
- `server/src/semantic/supervisor.rs:556-592`: project/target prepare only increments the global runtime epoch and removes handles; neither tombstones affected connections nor installs a target/session revocation fence.
- `server/src/semantic/session.rs:225-231,328-358,416-419`: actual actor shutdown/cancellation starts only when phase two sends/processes `Shutdown`.
- `server/src/semantic/gateway.rs:194-206,809-832,930-934,994-1020`: ready-session dispatch and asynchronous successful response publication do not check connection/runtime/session revocation. Checking the old directory inode is not authorization after project/config replacement.
- `server/src/api/workspace.rs:169-183,203-218`: root/config publication precedes phase-two shutdown, as intended by the split; this makes a true phase-one fence necessary.

**Failure/impact [INFERENCE]:** A gateway retains a cloned live handle after prepare returns. While the caller publishes new config or awaits other mutation work, old actor navigation can still execute and a previously completed result can still be sent. Project/target invalidation also leaves the affected admission epoch reusable after removal. The same result-fence gap applies to cancellation-first auth invalidation and early shutdown revocation. This is not proof of arbitrary filesystem access; it violates the stated old-authority cutoff and stale-result contract.

**Correction:** Revoke an exact shared session/target admission token before detachment/publication; make retained handles reject commands and completion workers discard results for that token. Prevent fresh admission to a removed identity until fresh target resolution/authorization succeeds. Serialize or revalidate attach/initialize against workspace mutation authority. Retain physical child/overlay accounting until reap completes so detached trees do not disappear from resource accounting while still alive.

**Regression needed:** Hold phase two, retain the original gateway/session clone, prepare invalidation, and assert both new commands and delayed successful results are rejected before publishing replacement state. Also cover attach-before-mutation/initialize-after-mutation. Current `semantic_supervisor.rs:807-849` tests new supervisor admission, not retained-handle/result rejection.

## Warnings

### W1 — Post-reap navigation errors bypass the new reconnect path

**Priority:** High. **Confidence:** High.

`server/src/semantic/gateway.rs:930-973` maps an immediate `submit_navigation()` failure—including `SessionError::Invalidated` after actor termination—to generic `RPC_ERR_INTERNAL_ERROR` / `NAVIGATION_FAILED`. Only the asynchronous response arm at `1054-1062` emits `-32005`. `SemanticSessionHandle::submit_navigation` maps a closed actor channel to `Invalidated` (`server/src/semantic/session.rs:193-209`). The client reconnects only for `-32005` (`semantic-client.ts:536-575`).

**Failure/impact [INFERENCE]:** An idle client whose session is invalidated and reaped remains locally `ready`; its next navigation gets a generic error and returns empty locations without recovery. This is more than delayed status notification. The server does not reliably produce the signal consumed by the client fix.

**Correction:** Emit the lifecycle-invalidated response/close consistently for expired bindings, including immediate submission errors, and actively retire the socket/binding on invalidation where appropriate. Test real gateway invalidation followed by a new query and fresh attach/replay. `semantic-client.test.ts:593-650` injects `-32005`, checks disconnected, then disconnects; it proves neither server error mapping nor reconnect completion.

### W2 — Socket callbacks and status publication are not exact-resource fenced

**Priority:** High. **Confidence:** High.

`semantic-client.ts:145-180` installs `onopen/onmessage/onerror/onclose` without checking the captured `ws` against `this.ws` or a connection-attempt generation. `handleServerInvalidation()` closes A, immediately cleans up, then starts B after 1s (`554-574`). A late close event calls `handleClose()` against current mutable state (`754-772`), clearing B's target/bindings/pending requests. Handshake catch cleanup also closes whichever `this.ws` is current (`233-244`). Store status callbacks publish by scope string without checking the exact live client (`semantic-navigation.ts:213-223`).

**Failure/impact [INFERENCE]:** Delayed close/error or handshake continuation from A can tear down or overwrite B. Request-ID cancellation alone does not prevent this. The test WebSocket closes synchronously (`semantic-client.test.ts:39-42`), hiding browser close-handshake timing.

**Correction:** Capture and compare a socket/attempt handle in every callback and after handshake awaits; cleanup must affect only that handle. Gate store status updates on exact active client identity. Test delayed A close/error after B reaches ready and replacement client reuse of the same scope.

### W3 — Shared Monaco options remain last-writer-wins and cleanup can erase a live owner

**Priority:** Medium/High. **Confidence:** High for cleanup race; multi-owner routing depends on active layout.

`EditorTabs.tsx:211-270` writes a singleton `onOpenCodeEditor` capturing that effect's `targetRef`. Its asynchronous cleanup unconditionally calls `resetOptions()` (`274-281`), which erases callbacks regardless of owner (`semantic-monaco.ts:139-152`). `handleOpenCodeEditor` has no alternate opener when the callback is absent (`347-372`). Model-derived client fallback fixes client resolution, not opener ownership.

**Failure/impact [INFERENCE]:** If B installs options before A's cleanup import resolves, A erases B's active opener. With multiple owners, an existing destination is activated with the callback owner's `targetRef` (`EditorTabs.tsx:220-235`), and an unopened destination uses that owner's captured project/target (`239-264`).

**Correction:** Use a single owner-independent opener resolving the target from the destination tab/model, or exact owner-token registration/unregistration. Cleanup must only release the registration it created. Test A cleanup after B registration and cross-profile/worktree destinations.

### W4 — Same-name recovery does not establish endpoint/root/actor equivalence before dirty replay

**Priority:** High security risk, currently partly masked by C1. **Confidence:** High for missing guards; actual replay requires a matching model/client key.

`semantic-client.ts:248-284` matches only profile/project/target strings and uploads `getModelText()`; `SemanticClientOptions` and `StableModelIdentity` carry no captured actor/root binding (`semantic-client.ts:66-79`, `semantic-model-uri.ts:15-23`). `EditorTabs.tsx:190-204` returns any matching tab's content without checking `targetAvailable` or `resourceBinding.serverUrl`. These fields already exist (`editor.ts:149-150,182-183,616-642`). `reconcileProfileTabs` does not protect this upload path and deliberately excludes dirty tabs (`1616-1635`).

**Failure/impact [INFERENCE]:** Once C1 is corrected, reconnect to another endpoint/root or authenticated actor with the same profile/project/target labels can upload retained dirty source without explicit rebind. A fresh WebSocket authenticates the new session, not the provenance of the retained draft.

**Correction:** Capture and compare the exact endpoint/root/actor resource binding before binding/replay and document-open/edit sends. Retain mismatched drafts locally as unavailable. Test same-binding dirty replay and equal-string identities after endpoint/root/actor replacement. Fix alongside C1, not as an optional later enhancement.

### W5 — Worktree invalidation remains broader and later than the plan contract

**Priority:** Medium. **Confidence:** High.

`state.rs:191-207` invalidates resolver state first, then every semantic session for the project, with global fallback if raw configured-path equality fails. `git.rs:448-459,518-521` invokes this after removal/prune; add also invalidates the entire project (`353-356`). The new target-scoped prepare API is not used by these callers. Gateway attach/navigation does not take `workspace_context_guard`.

**Failure/impact [INFERENCE]:** Adding a sibling worktree or no-op pruning disconnects unaffected root/worktree sessions; removal changes filesystem identity before semantic cutoff. Holding the workspace write guard in remove does not protect an unguarded semantic gateway.

**Correction:** Compute affected identity changes, revoke exact removed/replaced targets before mutation publication, and preserve unaffected sessions. Pass the known project identity rather than recovering it from raw path equality. Test unchanged refresh/no-op prune and two worktrees where only one is retired.

### W6 — Visible status is not yet an accurate active-model availability contract

**Priority:** Medium. **Confidence:** High.

`EditorStatusBar.tsx:92-123` correctly renders the supplied states, but `EditorTabs.tsx:531-538` depends on C1's failed lookup. Even after C1, idle invalidation remains shown as ready until a status event, W1 prevents recovery for the common post-reap case, and unsupported paths return null. No production `setStatus("unsupported")` path was found in the inspected client. Handshake failure sets error then immediately disconnected (`semantic-client.ts:233-244,754-755`), obscuring the failure reason.

**Correction:** Derive status from the active model's exact current binding and explicit disabled/unavailable/unsupported/failure state, not merely a cached client readiness string. Add `EditorTabs` integration assertions for active-model switches, invalidation without a pending RPC, unsupported files and retained failures. The status test only supplies ready/initializing/error props (`EditorStatusBar.test.tsx:34-66`).

## Suggestions

1. **Cancellation subscription cleanup:** Local cancellation removes pending requests, clears their timeout and emits `$/cancelRequest` (`semantic-client.ts:597-605`); timeout likewise removes the request before rejection (`717-727`), so late matching responses are ignored. However, `queryNavigation` discards the disposable returned by Monaco's cancellation event (`514-518`), with the custom token type erasing it to `void`. Capture/dispose that subscription in `finally`; add fake-timer timeout and listener-disposal tests. No timeout/fake-timer test was found in the inspected client suite.
2. **Exact reap-task registration:** `supervisor.rs:617-630` launches reaping and separately spawns its registration task; shutdown can drain `active_reap_tasks` before registration (`721-726`). Prefer one synchronously registered task handle with a short non-awaiting lock, or another existing structured task-owner pattern. Add a spawn-versus-shutdown regression; do not equate batch timeout with observed process-tree disappearance.
3. **Fail-closed profile defaults:** `semantic-navigation.ts:124-125` lets an unknown profile inherit another profile's aggregate enabled state. Default unknown to false, and bind enablement freshness to current owner/endpoint. Keep the aggregate only for Monaco provider activation. Existing recorded-profile OFF and listener notification paths are useful improvements.
4. **KISS/DRY:** Retain prepare/reap separation. Once identity policy is aligned, share the config change classification between `reload_config_locked` and `cache_clear`; cache clear currently unconditionally invalidates all sessions (`settings.rs:21`) while reload diffs project sets (`config.rs:730-748`). No generic framework or extra abstraction is necessary.

## Requested checks: disposition

| Area | Assessment |
|---|---|
| Two-phase locks | Workspace init/switch, config reload, cache clear and successful import release `workspace_context_guard` before awaiting reap. Worktree/restore use background reap. This removes child-wait-under-guard coupling in those paths; it is not a blanket deadlock proof. Phase-one authority/result fencing fails C2. |
| Admission epochs | All-scope connections are tombstoned and register does not resurrect a tombstone (`supervisor.rs:285-299,543-552`). Scoped invalidation lacks equivalent affected-target fencing. |
| Cancellation / reconnect timer | Local cancellation and request timer cleanup present; `reconnectTimer` is tracked and cleared in connect/disconnect (`123-125,778-780`), resolving the prior untracked-timer finding. Listener cleanup and exact socket ownership remain incomplete. |
| Zustand side effects | `close`, `closeOthers`, `closeAll` now perform `notifyDidClose`/`unregisterModel` after `set()` (`editor.ts:764-897`). No remaining semantic I/O in these three updater bodies. Actual document routing still blocked by C1. |
| Frontend scoping / references | Acquisitions increment and releases decrement counts (`semantic-navigation.ts:192-247`); recorded-profile OFF only disconnects that profile. Literal `"default"` profile fallbacks removed from inspected production EditorTabs/MonacoHost code. C1, W2-W4 and unknown-profile fallback prevent full owner-isolation acceptance. |
| Visible status | Label rendering present; active-model status acquisition and invalidation accuracy incomplete (C1, W1, W6). |

## Positive observations

- Concurrent `join_all` reaping avoids sequential per-session timeout accumulation in `reap_sessions` (`supervisor.rs:601-613`).
- Config project-set comparison avoids unconditional teardown on unrelated reloads (`config.rs:730-748`).
- Writer timeout now aborts and joins the actual task rather than detaching it (`semantic_ws.rs:526-534`).
- Resync bumps per-document wire version and sends full text without mutating session generation (`semantic-client.ts:580-594`), avoiding the prior global-session fence mismatch.
- No new custom engine execution path, source persistence, or origin-policy exception found in inspected changes.

## Reviewed files

**Production changes:**
- `server/src/semantic/supervisor.rs`
- `server/src/api/{workspace,config,settings,semantic_ws}.rs`
- `server/src/{state,main}.rs`
- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/stores/{editor,semantic-navigation}.ts`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/components/organisms/{EditorTabs,MonacoHost,EditorStatusBar}.tsx`

**Tests, selected sections:**
- `server/tests/semantic_supervisor.rs`
- `packages/ui/src/api/semantic-client.test.ts`
- `packages/ui/src/stores/semantic-navigation.test.ts`
- `packages/ui/src/components/organisms/{EditorTabs.semantic,MonacoHost.semantic,EditorStatusBar}.test.tsx`

**Supporting implementation:** `server/src/semantic/{gateway,session}.rs`, `server/src/api/git.rs`, `packages/ui/src/api/{client,queries}.ts`, `packages/ui/src/lib/semantic-model-uri.ts`; editor mount locations in `components/pages/WorkspacePage.tsx`.

**Plan/evidence:** `plans/260901-1000-lsp-server-integration/{plan,phase-08-lifecycle-invalidation-and-recovery}.md`, prior review `plans/reports/code-reviewer-261023-2200-phase-08-lifecycle-cycle-1.md`, tester `plans/reports/tester-261023-2155-phase-08-lifecycle.md`.

## Validation commands / results

**Executed here:** `git diff --stat && git status --short`, scoped backend/frontend `git diff -- <review files>`; source, plan and test inspection through read/search tools. These are review evidence, not runtime verification.

**Historical reported evidence only** — tester report `plans/reports/tester-261023-2155-phase-08-lifecycle.md:36-47` records:

| Command | Prior reported result; not rerun/currently certified |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'` | 61 passed |
| `pnpm --filter @dam-hopper/ui test src/stores/semantic-navigation.test.ts src/lib/semantic-monaco.test.ts src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/EditorStatusBar.test.tsx src/stores/editor.test.ts` | 73 passed |
| `cargo check --manifest-path server/Cargo.toml` | Exit 0 |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | Exit 0 |
| `cargo check --manifest-path server/Cargo.toml --tests` | Exit 0 |
| `cargo test --manifest-path server/Cargo.toml --lib semantic::` | 38 passed |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/semantic-navigation.browser.tsx` | 2 passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript compilation, not built-web runtime proof |

The earlier report totals 174 tests. Current inspected test contents differ from some prior report descriptions/counts; do not treat that total as fresh coverage of this snapshot. Lint count, numeric type coverage and numeric test coverage not measured. No new validation failure asserted.

**Main-agent validation recommendation:** After fixes, run the focused commands above once, plus exact regressions for real editor/model key matching, retained-handle cutoff before reap, post-reap gateway recovery, delayed socket cleanup, and foreign-binding replay denial. Keep real auth/backpressure/G5/G8 qualification separate and explicit.

## Plan completeness

Not complete. Phase 08 already tracks partial live-auth/replacement-resource proof and open live-browser G5/G8 qualification (`phase-08...md:78-87`). Those are acknowledged deferred validation, not demands to implement unrelated future phases. However, checked routing/replay/exact-invalidation claims at `75-86` are not established by current code (C1/C2/W1/W4). Parent ledger still lists Phase 08 Pending (`plan.md:49`). Leave administrative acceptance with Main; no task state modified by this review.

## Unresolved questions

1. Is there an approved exception covering immediate old-result/admission cutoff or endpoint/root/actor replay matching? None was present in the inspected Phase 08 acceptance requirements; treat these as required fixes, not merely Phase 09 measurement work.
2. Live auth-store failures/revocation, non-reading WebSocket teardown, actual built-web G5/G8 coexistence/destination freshness remain unexercised here. Which evidence artifacts will establish these gates before release acceptance?
