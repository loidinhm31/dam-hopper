# Design risk review — Traditional terminal Agents sidebar

## Code Review Summary

### Scope
- Planning-only review of frozen [`02-planner-contract.md`](02-planner-contract.md#fixed-scope-and-design); no application implementation reviewed or changed.
- Assigned sources: `stores/agent-status.ts`, `api/agent-status-types.ts`, `TraditionalTerminalProjectsDisplay.tsx`, `TraditionalTerminalProjectsNavigator.tsx`, `TerminalTabBar.tsx`, `use-traditional-terminal-project-selection.ts`, `AgentStorePage.tsx`, `api/connections.ts`, `server/src/agent_status/reducer.rs`.
- Supporting contracts: `api/client.ts`, `api/queries.ts`, `MultiTerminalDisplay.tsx`, `traditional-terminal-projects.ts`, `terminal-incarnation-state.ts`, `AgentStatusBadge.tsx`, `AgentSettings.tsx`, `ui/Dialog.tsx`; selected Workspace references.
- Approximately 2,300 unique relevant source lines inspected; targeted static inspection, not full-source/security audit.
- Standards: `docs/code-standards.md:19-44,64-71,87-99`; PDR `docs/project-overview-pdr.md:9-17,47-52,74-79`; proposal `docs/system-architecture.md:169-179`.
- Code-review skill read directly from `/home/loidinh/.omp/agent/skills/code-review/SKILL.md`; local workflow absent, global fallback read.
- Updated plans: none by ownership contract. Actionable findings sent to ParallelPlanWriter; reviewer owns only this report. No unfinished planner artifacts read.

### Overall Assessment
Fixed scope is compatible with current status protocol and terminal selection architecture. No backend/DTO change needed. Implementation contracts must explicitly account for optional incarnation, retained rows, reactive connection ownership and denial-before-query-mount. Compact focus restoration is not already proven by existing Radix usage. These are pre-implementation corrections, not observed runtime failures.

### Critical Issues
No demonstrated new exploit or data-loss defect: feature is unimplemented and runtime was not exercised. Cross-profile fallback is a security-sensitive release blocker if introduced/retained for an explicit requested target; see H3.

### High Priority Findings

#### H1 — Identity cannot be inherited unquestioningly from project groups
- Evidence: [`SessionInfo.incarnation`](../../../packages/ui/src/api/client.ts#L214-L230) is optional; [`MountedSession`](../../../packages/ui/src/components/organisms/MultiTerminalDisplay.tsx#L19-L28) has no incarnation. [`TerminalTabBar`](../../../packages/ui/src/components/organisms/TerminalTabBar.tsx#L111-L123) supplies session metadata, but its fallback chain is not a validation contract.
- Existing [`group builder`](../../../packages/ui/src/lib/traditional-terminal-projects.ts#L25-L64) indexes mounted sessions by qualified AND bare ID, then derives group ownership from the matched mounted session. With conflicting/legacy inputs, the group is not sufficient evidence of tab ownership. This is a static consumer risk, not a claimed reproduced collision.
- [`incarnation helper`](../../../packages/ui/src/lib/terminal-incarnation-state.ts#L13-L85) is a mutable nonreactive Map, with no generation field or subscription. A getter-only `useMemo` fallback cannot guarantee current render identity.
- Mitigation: resolve a canonical tab-owned TerminalRef; require exact agreement among every present ref/qualified key/profile/id and its mounted entry. Reject conflicting evidence. Obtain a concrete safe-integer incarnation from reactive current terminal metadata; zero is valid. Missing incarnation excludes the agent row, never copies status incarnation. Do not modify existing Projects membership/grouping merely to build the roster.
- Acceptance: duplicate bare IDs across profiles remain distinct; conflicting tab/mounted refs cannot borrow harness/project context; missing incarnation produces no row; incarnation 0 joins; a changed current incarnation immediately removes old status until exact replacement arrives. Repeated refs deduplicate to one row per owner-qualified terminal incarnation, in open-tab order.

#### H2 — Status ownership equality alone does not certify fresh reconnect evidence
- Evidence: [`beginAgentStatusConnection`](../../../packages/ui/src/stores/agent-status.ts#L47-L58) rebinds old rows to the NEW owner while setting availability unavailable; snapshots replace the complete row map silently (`:86-121`). Existing status/availability hooks (`:223-241`) do not compare connection generation.
- [`connections`](../../../packages/ui/src/api/connections.ts#L281-L298) increments generation on drop independently of status-store updates; [`isCurrentConnection/getApi`](../../../packages/ui/src/api/connections.ts#L663-L701) require connected current ownership.
- Mitigation: freeze builder input as readonly profile status views plus captured reactive current connection snapshots, or explicitly generation-safe caller-filtered views. No ambient getters inside the pure builder; no per-row full scan. Ready semantic presentation requires current connected generation AND status availability ready. Exact-incarnation retained rows may remain visible only as unavailable; never resurrect retained Working/Done. Non-ready platform-unqualified/unsupported labels override semantics.
- Acceptance: old generation ready data cannot render ready even before status-store catch-up; new owner + retained old rows stays unavailable before baseline; reconnect snapshot silently replaces/prunes roster; removed profile or closed tab removes eligibility; generation-only connection updates recompute presentation without requiring tab/status changes. Test platform-unqualified, unsupported and null availability as non-ready.
- Input detail: `getAllConnectionSnapshots()` allocates a new array (`connections.ts:351-358`); do not use that uncached return value directly as a `useSyncExternalStore` snapshot. Reuse stable per-profile snapshots/subscriptions or a stable captured aggregate.

#### H3 — Explicit profile denial must precede all query-owning mounts
- Evidence: [`AgentStorePage`](../../../packages/ui/src/components/pages/AgentStorePage.tsx#L58-L95) currently falls back to first profile and memoizes owner only by profileId. Same-profile reconnect cannot refresh that memo. Settings and dialogs receive owner (`:254-305`); three data queries run regardless of active tab.
- [`useConnectionSnapshot`](../../../packages/ui/src/api/connections.ts#L801-L809) already supplies reactive snapshots. [`queries`](../../../packages/ui/src/api/queries.ts#L2300-L2315) and [`matrix query`](../../../packages/ui/src/api/queries.ts#L2374-L2387) explicitly branch to ambient API without an owner. Passing `owner=undefined` is not denial. Existing getApi rejects stale/disconnected owners, so the current memo risk is stale denial, not evidence of cross-profile transport leakage.
- Mitigation: distinguish absent query parameter from explicit empty/unknown/removed profile. Parse encoded profile separately from tab; no truthiness fallback. Render unavailable/choose-profile UI outside the query-owning subtree for invalid or disconnected targets; never mount Settings with undefined ownership. For valid connected targets subscribe to the named profile's current snapshot; key/reset owner-bound child/dialog state across generation changes so stale selection/feedback cannot be presented as current. Preserve explicit profile intent after removal until deliberate selection.
- Acceptance: explicit valid B opens Settings for B even with active A; disconnected B stays B/unavailable; unknown/removed/empty explicit target never reads or mutates A, including after B removal. No automatic connect/install/policy/global-active-profile changes. Same-profile reconnect changes generation for queries and subsequent mutations; old generation child/dialog state does not survive as actionable state. Refresh and in-app query changes resolve the requested tab/profile consistently; special-character profile IDs round-trip URL encoding.
- Missing input assumption: when sidebar cannot establish an owner, bare Agent Store navigation currently selects active/first profile (`:58-65`). The plan must specify an explicit choose-profile route state rather than rely on bare navigation to ask automatically.

### Medium Priority Improvements

#### M1 — Compact focus restoration is not guaranteed by current opener
- Evidence: [`compact opener`](../../../packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx#L202-L214) is a plain button outside the Dialog root (`:243-259`); [`Dialog wrapper`](../../../packages/ui/src/components/ui/Dialog.tsx#L6-L9) exposes Radix Trigger, but the display never uses it. Wrapper forwards Content props (`:29-59`), so local focus restoration can be provided without a global wrapper refactor.
- Mitigation: use DialogTrigger asChild within the shared root, or preserve opener ref and restore via local onCloseAutoFocus. Keep modal focus trapping; do not focus xterm while the sheet remains open. Agents use a separate button list, not fake project tabs. Status updates must not alter tab order or force live-announcement/focus churn.
- Acceptance: Tab/Shift+Tab stays in sheet; Escape, close, project selection and agent selection dismiss and restore an existing opener. Agent Enter/Space selects once. No remounted PTY/buffer. Status changes retain focused row. Wide/compact section content is reachable within bounded scroll height.
- Existing compact controls are below requested 44px target: opener/new terminal 32px (`Display:211,229`), navigator add button 40px (`Navigator:159-160`), shared close icon has no minimum (`Dialog:51-56`). Apply local sizing to affected compact navigation controls; include settings link/close target in acceptance, not only agent rows.
- Existing project Arrow/Home/End handling selects immediately (`Navigator:116-135`) and display closes the sheet on group selection (`Display:135-140`). Focus tests must cover this dismissal, not assume arrows leave the dialog open.

#### M2 — Exact session activation must not degrade to remembered-project selection
- Evidence: [`selection hook`](../../../packages/ui/src/hooks/use-traditional-terminal-project-selection.ts#L89-L109) group selection picks remembered/last tab; exact handleSelectTab switches group and forwards sessionId. It also forwards unknown IDs, so caller must validate membership.
- [`MultiTerminalDisplay`](../../../packages/ui/src/components/organisms/MultiTerminalDisplay.tsx#L148-L158) activates and focuses the pane containing exact activeSessionId; display uses persisted per-group layout key (`Display:169-188`). Existing [`display tab handler`](../../../packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx#L143-L149) does not dismiss sheet.
- Mitigation: agent handler revalidates current canonical session + incarnation membership, calls existing exact tab handler, then closes compact sheet. No handleSelectGroup-only path, layout reset, new host or second selection store.
- Acceptance: choose agent in different project where another tab was remembered; exact target wins. Choose target in nonfocused split pane; pane/tab focuses without changing pane membership/layout/PTY identities/output. Stale removed/restarted target callback cannot select replacement incarnation or forward unknown ID.

#### M3 — Secondary Done is explicit historical evidence, never completion state
- Evidence: [`DTO`](../../../packages/ui/src/api/agent-status-types.ts#L13-L40) has no done state; decoder validates turnId/outcome individually (`:246-277`), not their semantic combination. [`OMP transitions`](../../../server/src/agent_status/reducer.rs#L986-L1071) clear outcome on new turn/session and store explicit ended as Idle; snapshots install outcome silently. Public row contains turnId and lastOutcome (`:800-825`).
- Native [`Stop`](../../../server/src/agent_status/reducer.rs#L712-L727) becomes Unknown while preserving active turn; Interrupt yields idle/interrupted (`:690-709`). Authority loss/lease expiry clear outcome (`:1177-1250`); reconnect resets Unknown (`:888-902`). None supplies native ended evidence.
- Mitigation: secondary hint predicate = exact current identity + effective ready + state idle + lastOutcome ended + turnId absent. Primary label remains Idle. Unknown/blocked/working/unavailable always suppress the hint; native coverage explanation stays visible. Do not require attention event/revision, infer unseen state, acknowledge alerts, or introduce a timer/state protocol.
- Acceptance: ready idle ended snapshot can show hint silently even with attentionRevision 0; idle interrupted/error/unknown/absent outcome cannot. Active turn, Unknown with ended, generation/incarnation mismatch, disconnect, authority loss and lease expiry suppress it. All three admitted harness kinds and notification-policy-off roster behavior are tested; current native Stop never becomes Done.

### Low Priority Suggestions
No stylistic blockers. Keep pure status/identity derivation separate from rendering; index captured inputs once. Do not grow global status store, invent inventory rows, or retrofit shared badge vocabulary.

### Positive Observations
- Existing readonly status map, silent authoritative snapshots and reducer authority/lease fences already model conservative semantics.
- Existing exact selection hook and pane activation avoid new terminal orchestration.
- PDR and code standards explicitly prohibit ambient fallback and success inference; frozen scope respects both.

### Recommended Actions
1. Freeze H1–H3 identity/readiness/profile-denial input contracts and corresponding behavioral acceptance before implementation.
2. Add local compact opener restoration/44px sizing and validated exact selection; retain current project keyboard semantics.
3. Implement only secondary historical outcome presentation; qualify actual app wide/compact, duplicate-profile IDs, reconnect and split panes after integration.
4. Keep backend/API/hooks unchanged. Any need for additional source changes must be declared in implementation ownership, not made during planning.

### Metrics / Verification Limits
- Type coverage: not measured; no compile/typecheck run.
- Test coverage: not measured; no tests/build/lint/formatters or application runtime exercised, per planning assignment.
- Linting issues: not measured. No new source changes exist to validate in this review.
- Task completeness: review and report only; implementation remains pending. Report does not attest planner TODO completion or other artifacts.

### Unresolved Questions
- Product wording/layout preferences remain optional validation questions from the frozen contract; no technical prerequisite requires a user answer.
- Runtime focus restoration, harness-version/platform coverage and real reconnect/split-buffer preservation require later application evidence; static code alone cannot qualify them.
