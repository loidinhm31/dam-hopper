# PR #74 — Auth / Settings / Filesystem Review

## Scope and validation
- Compared base `45a51efe43ef6024dbd875d2498b456a7d4db110` to head `b031e6a40123d8c5169012e0b736ac8c4f1f6091`; read assigned changed sections and supporting caller/sink paths.
- Reviewed `server/src/api/{semantic_settings,auth,config,settings,workspace,git,router,ws,error}.rs`, `server/src/{state,error}.rs`, `server/src/config/{parser,schema,global,replacement}.rs`, `server/src/fs/{decrypt,mutate,ops,secure_path}.rs` and the `fs/mod.rs` change.
- Supporting paths: `api/{fs,git_diff}.rs`, `git/{mod,worktree,cli_fallback,diff}.rs`, `fs/sandbox.rs`, `auth/mod.rs`, `utils/fs.rs`; UI `SettingsSemanticNavigationSection`, `SettingsPage`, semantic query hooks, and workspace-event consumers.
- Read applicable PDR/standards and Phase 06 requirements. Inspected selected `server/tests/semantic_settings.rs` and section component tests as coverage evidence only. Approximately 4,000 lines inspected; not a whole-repository audit.
- Coverage complete for assigned review slice; supervisor internals, gateway protocol and general editor lifecycle remain other reviewers' ownership. No plans/task state changed.
- **Validation: static review only. No builds, tests, linters, formatters, installs, or runtime reproductions executed.** Reproductions below are proposed, not observed results. No source/test/CI edits; this report is the only written artifact.

## Overall assessment
Two actionable defects: one remaining Git route around the new canonical-config privilege boundary; one settings error path that leaves the visible runtime state stale. No P0 findings. Both are conclusive static control-flow defects under the stated triggering conditions, not claims of exercised exploitation.

## Findings

### F1 — P1: Git mutations bypass canonical global-config protection
**Changed location:** `server/src/api/git.rs:453–459`.

**Trigger:** The canonical global config lies inside a registered, non-main, unlocked linked worktree being removed; no live PTY uses that target. An ordinary authenticated User submits worktree removal with `force: true`. This is possible with a configured `XDG_CONFIG_HOME` inside that worktree. No terminal command or OS privilege is needed by the requesting user.

**Evidence chain:**
1. `api/router.rs:192–195,508–511` exposes DELETE worktrees under ordinary `require_auth`, not current-admin authorization.
2. `api/git.rs:425–452` checks registration/main/lock/live-PTY conditions, but not whether the target contains the canonical global config.
3. Changed `api/git.rs:453–459` invalidates the semantic target and invokes `remove_worktree`; it does not invoke the new protected-path guard.
4. `git/mod.rs:69–72` → `git/worktree.rs:16–17` → `git/cli_fallback.rs:310–320` executes `git worktree remove --force <path>` directly. None of these layers consults `is_protected_global_config_path`.
5. `fs/secure_path.rs:1553–1560` explicitly protects containing directories, but this Git path never reaches that helper or the guarded raw-FS sinks.

**Consumer-visible impact:** A User can delete the durable server-global semantic intent and unrelated global settings without the dedicated Admin transaction. In-memory status can still describe the previous configuration. This is unauthorized durable mutation/reset, **not** a claim that deletion immediately enables or disables live admission. It violates Phase 06's explicit protection of deletion/reset and API-vs-local-operator distinction (`phase-06-global-hot-toggle-and-unsafe-override-gate.md:35–39,75–81`).

**Same boundary gap, additional inspected example:** If canonical config is tracked inside a registered repository, ordinary POST discard follows `api/router.rs:229` → `api/git_diff.rs:187–202` → `git/diff.rs:737–746`, where forced `checkout_head` restores HEAD bytes without the protected-file guard. This can replace durable semantic intent, not just delete it. These supporting unchanged paths become relevant because this PR introduces the protected canonical object; they are not separate style/pre-existing generic Git findings.

**Smallest correction:** Check protected canonical identity/containing paths before Git worktree deletion and protect affected config paths in Git worktree-writing operations, including discard. Reject only operations that can mutate the protected object; do not make unrelated Git operations Admin-only or blanket-disable repositories merely containing unrelated config siblings. Coordinate destructive Git effects with the protection boundary rather than assuming raw-FS helper coverage.

**Suggested safe reproduction:** Isolated loopback server under a disposable directory; place auth DB and engine outside the disposable linked worktree. Set `XDG_CONFIG_HOME=<linked-worktree>/.xdg`, provision canonical `dam-hopper/config.toml`, register the main repository, and ensure no live PTY uses the linked worktree. As signed User, DELETE `/api/git/<project>/worktrees` with `{ "path": "<linked-worktree>", "force": true }`. Inspect only temporary config existence/bytes. A corrected server must refuse before removal; unrelated worktree removal must still succeed. Separately, use a disposable repo tracking that config and POST discard to verify that HEAD cannot restore different semantic bytes as User.

**Confidence:** High; complete route-to-command and route-to-libgit2 chains inspected. Runtime behavior not exercised.

### F2 — P2: Failed OFF does not refresh the configured/runtime mismatch
**Changed location:** `packages/ui/src/api/queries.ts:2380–2385`.

**Trigger:** Settings initially caches healthy enabled status; OFF completes irreversible admission cutoff/cleanup but final authorization or persistence fails. User stays on the focused Settings page without reconnect/remount or another query invalidation.

**Evidence chain:**
1. `api/semantic_settings.rs:230–277` disables/reaps first; final-auth failure records safe-disabled and returns error (`252–261`), as does persistence failure (`266–273`). Durable intent stays enabled while effective admission is disabled.
2. `useUpdateSemanticSettings` invalidates status only in `onSuccess` (`queries.ts:2380–2385`); failed mutations do not run it.
3. `useSemanticSettings` has `staleTime: 5_000`, not polling (`2357–2366`). Staleness alone does not fetch fresh data.
4. `SettingsSemanticNavigationSection.tsx:57–70` catches failure and changes only the action message. Its runtime metrics/mismatch banner still derive from old query data (`74–76,87–95,136–160`).

**Consumer-visible impact:** UI reports an action error while continuing to show the previous healthy runtime state and omitting the required prominent configuration/runtime mismatch. A failed OFF is specifically not a rollback, so retaining the old healthy snapshot misleads the administrator about actual availability. The switch can still retry OFF; this finding does not claim recovery is impossible.

**Smallest correction:** Invalidate/refetch the captured owner/generation's semantic status on mutation settlement, including error; retain error feedback. Add a hook/component integration case using real query caching: initial healthy GET, rejected OFF after teardown, subsequent GET safe-disabled, mismatch visible without focus/remount.

**Suggested safe reproduction:** Disposable loopback, non-root server with valid engine; enable semantics and open Settings. Temporarily remove write permission on the disposable global-config parent, toggle OFF, then restore permissions. Compare the still-focused page to GET `/api/semantic/settings`: backend must report durable enabled/runtime disabled, while current UI retains the healthy snapshot until an independent refetch. Prefer deterministic persistence-failure injection for automated regression coverage; never alter a real user's config permissions.

**Evidence gap:** `server/tests/semantic_settings.rs:891–963` covers backend OFF persistence failure; `SettingsSemanticNavigationSection.test.tsx:110–121` renders an already-supplied mismatch. Neither verifies failed-mutation-to-status-refetch behavior.

**Confidence:** High; backend error transition and missing frontend error invalidation inspected. Browser reproduction not exercised.

## Positive observations / non-findings
- Dedicated PATCH denies no-auth and non-admin actors; fresh store/session checks occur before side effects, after lock acquisition, and immediately before persistence (`auth.rs:266–350`; `semantic_settings.rs:188–209,243–250,291–306`). The defined role-check linearization does not pretend to atomically serialize external operator demotions.
- Global defaults/UI/workspace-registry writers use the shared mutation lock and current disk state, preserving semantic intent during ordinary unrelated settings writes (`state.rs:560–580`; `config.rs:224–265,329–348`; `workspace.rs:269–318`). No blanket RBAC expansion found there.
- Raw write, persist, encrypted-write, rename/move/delete and WS streaming commits reach protected-path guards; guards include canonical parents and hardlink identity. The unused `replace_regular_file_if_bytes_match` wrapper has no production callers, so its missing guard is not a reachable finding.
- Workspace switch/init and cache-clear invalidate semantic handles under the workspace write guard before publishing new sandbox/config state (`workspace.rs:169–183,203–218`; `settings.rs:16–40`). Concurrent workspace events cause cache invalidation/refetch, not selection from the event path (`use-sse.ts:536–539,743–762`); no stale-path finding asserted.
- No execution-hook/OS-sandbox claim inferred. Existing trusted server-account terminal/operator authority is outside the new config API boundary.

## Recommended actions
1. Close Git-specific canonical-config mutation routes, retaining ordinary unrelated Git/FS access.
2. Refresh owner-scoped semantic status on failed as well as successful toggles.
3. Main reviewer may run narrowly targeted Git-protection and failed-OFF UI regressions after review synthesis; none were run here. Type/test coverage and lint counts: not measured.

## Unresolved questions
- None blocking these findings. Dynamic race/qualification behavior remains unverified by this read-only review; no unsupported race hypothesis promoted to a finding.
