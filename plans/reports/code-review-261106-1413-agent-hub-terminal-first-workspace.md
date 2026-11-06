# Agent Hub terminal-first workspace — code review

## Score: 6/10

Changes requested. Strong decomposition and useful fail-closed primitives, but the final composition has identity/pin/restore regressions that isolated hook tests do not exercise. No new authentication bypass, injection vulnerability, or backend authorization regression identified in the inspected changes. This is not a security certification.

## Scope and evidence

- Reviewed tracked source diffs against HEAD plus new Agent Hub modules, workspace/sidebar components, identity/presentation helpers, launch lifecycle, browser/E2E additions, plan acceptance requirements and qualification documentation.
- Principal paths: `packages/ui/src/os/{OsShell,OsResourceHost,DesktopCanvas,window-ops,window-store,action-executor,persistence,agent-hub}.ts*`; `os/apps/{AgentHubApp,TerminalsApp,EditorApp}.tsx`; `os/agent-hub/*`; `stores/editor.ts`; changed terminal/project organisms; `hooks/use-traditional-terminal-project-selection.ts`; new `lib/*` contracts; associated unit/browser tests and `e2e/os-agent-hub-workspace/*`; six updated product documents.
- Read project README, PDR, code standards, published development rules and code-review skill. Assessed security/ownership, async lifecycle, renderer continuity, architecture, performance, YAGNI/KISS/DRY and plan acceptance.
- Static review only: no builds, tests, linters or formatters rerun. Passing UI unit/browser/build/lint results supplied by the assignment are upstream evidence, not independently exercised here. No numeric type/test coverage collected.
- No product or plan-state edits. Findings below distinguish code defects from missing qualification evidence.

## Critical Issues — MUST FIX

### C1. Relocated Review uses incompatible terminal IDs
- **Location:** `packages/ui/src/os/apps/AgentHubApp.tsx:105`; producer `packages/ui/src/os/agent-hub.ts:368`; qualified tab producer `os/agent-hub/use-agent-hub-workspaces.ts:235-245`.
- **Severity:** High; confidence high from direct call chain.
- **Failure:** Tab callbacks carry `terminalKey({profileId,id})`, but inventory-backed `AgentHubItem.sessionId` remains raw `s.id`. The lookup compares these directly.
- **Impact:** Normal Hub Review clicks fail with “Terminal session not found in active inventory” before the otherwise fenced review action runs.
- **Correction:** Join using `item.terminalRef` and the canonical logical key (or explicitly parse the callback and compare both profile and raw ID). Preserve raw/runtime identity separation. Add a composition regression clicking a real Hub Review button with qualified tabs and inventory-backed items.

### C2. Pin state never reaches rendered tabs or close protection
- **Location:** `packages/ui/src/os/apps/AgentHubApp.tsx:47-50,60-66,218-236`; consumer `packages/ui/src/components/organisms/TabBar.tsx:130-156`.
- **Severity:** High; confidence high.
- **Failure:** `useHubTerminalTabActions` persists pins and exposes `isTabPinned`, but composition never projects that value into `DisplayTabEntry.isPinned`. The rendered tabs are built without `isPinned`.
- **Impact:** Pin remains visually unpressed; close remains available despite the control promising “Pin terminal (prevents closing).” Persisted pins do not restore the expected protection, risking accidental process termination.
- **Correction:** Decorate the actual tabs supplied to Display with reactive `isPinned` values; defensively reject close for pinned sessions. Test click → pressed state → close unavailable → project switch/reload → still pinned, using actual composition rather than just the hook accessor.

### C3. Qualified UI tab shape breaks the summary evidence join
- **Location:** `packages/ui/src/os/agent-hub/use-agent-hub-workspaces.ts:245,305-314`; `packages/ui/src/os/agent-hub.ts:243-250,321-342`; join contract `packages/ui/src/lib/traditional-terminal-agents.ts:128-147`.
- **Severity:** High; confidence high.
- **Failure:** Hub groups now set `session.id` to the qualified UI key. Display explicitly adapts that field back to the raw ID for the traditional agent builder, but the Hub read-model call passes the qualified groups unchanged. The builder rejects them because `session.id !== ref.id`. Consequently the inventory-first read model takes its raw-status fallback instead of the availability-qualified presentation.
- **Impact:** Header Working/Attention counters can present retained status rows as current while the agent-status profile is unavailable, lacks a ready epoch, or belongs to a retired status generation. Connection readiness plus equal numeric incarnation is not sufficient agent-evidence authority. Sidebar and header can disagree.
- **Correction:** Adapt the evidence-join input without changing qualified UI IDs. Also make the fallback fail closed on status owner/availability/epoch rather than inventing ready presentation. Add integration cases for unavailable status baseline and generation retirement with retained equal-incarnation rows.

## Warnings — SHOULD FIX

### W1. Workspace restore is overwritten before loading completes
- **Location:** `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:312-319`; `packages/ui/src/os/agent-hub/use-agent-hub-workspaces.ts:60-69,328-358,434-440`.
- Child Display immediately reports its default/null selection, and the parent writes that over persisted `selectedWorkspace` even while restore is waiting for inventory. On the next render a missing key returns `drop` before checking inventory readiness; `restoreAttemptedRef` is then committed. A cold load with initially empty/loading inventories loses the saved selection.
- Gate selection persistence until restoration resolves, or keep a separate initial restore key and ensure initialization callbacks cannot overwrite it. Test the real parent/Display pair with delayed inventory. **Severity:** Medium; confidence high.

### W2. Claim hook does not survive actual StrictMode effect replay
- **Location:** `packages/ui/src/os/agent-hub/use-hub-terminal-attach-gate.ts:124-135,219-234`; test `use-hub-terminal-attach-gate.test.ts:200-239`.
- Cleanup clears/releases `heldClaims` but retains `desiredEntriesRef`. Effect replay preserves refs; the next layout reconciliation sees equal desired keys and returns without reacquiring. With no further registry notification, Hub has no claim. The test named StrictMode destroys/recreates a root, which resets refs and cannot cover this transition.
- Reconcile missing held claims even when desired keys match, or reset desired state consistently during cleanup. Use a real `<StrictMode>` wrapper. **Severity:** Medium; confidence high from lifecycle inspection; not runtime-reproduced here.

### W3. Destructive close currency check compares the same snapshot twice
- **Location:** `packages/ui/src/os/agent-hub/use-hub-terminal-tab-actions.ts:169-183`; test `use-hub-terminal-tab-actions.test.ts:192-220`.
- Both `renderedTarget` and `currentTarget` come from the same callback-captured map at click time. This is not the specified rendered-versus-current identity check. A retained callback cannot observe a newly committed replacement index, and the test exercises only a missing target, not replacement.
- Capture the offered target with the rendered tab and compare it against a committed/current resolver, analogous to Display’s committed agent-selection fence. Keep server-side exact-target fencing. **Severity:** Medium; stale dispatch risk, not an assertion that backend fences allow killing the replacement.

### W4. Header worktree label is not reactive
- **Location:** `packages/ui/src/os/apps/AgentHubApp.tsx:92-99`.
- `getState().activeTargetByProject` is read inside a memo depending only on `selectedGroup`. Changing the worktree updates the tree/selector and launch uses the fresh store value, but does not subscribe/recompute this pill.
- Subscribe to the selected project’s worktree through the existing `useProjectTarget` hook or a narrow Zustand selector. **Severity:** Medium; misleading displayed launch/file context.

### W5. E2E script does not prove its advertised acceptance scenarios
- **Location:** `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts:165-183,194-225,289-295`.
- Secondary profile is seeded but never exercised. Isolation steps are conditional; `editor count >= 1` cannot prove a distinct second window. There is no worktree selection assertion, command/output marker oracle, project-switch streaming check, split continuity check, quiet-PTY handoff or hidden-terminal input-isolation oracle. A DOM instance token alone does not prove streaming/input continuity. The capture matrix omits required 1920×1080 and labels 1440×900 “fhd.”
- Make required fixtures/assertions deterministic, require exact distinct owner-qualified windows, and use real PTY input/output markers. Retain separately documented AC5 fixture limitations. **Severity:** Medium, release-signoff relevant; coverage gap does not itself establish a product failure.

### W6. Qualification and plan statuses overstate closure
- **Location:** `plans/261106-0334-agent-hub-terminal-first-workspace/phase-07-qualification-and-docs.md:10,79-84`; `reports/qualification-report.md:18-20,99-108,175-177` within that plan.
- Live container qualification is explicitly pending, but Phase 07 and its live qualification task are checked complete. Evidence map marks acceptance PASS without the required live checks. Plan overview still lists every phase pending, while several phase files say completed and Phase 05 checkboxes remain unchecked.
- Reconcile statuses with actual evidence; retain live qualification/human review as open gates. Do not infer live input/stream safety or per-session heap cost from mocked DOM/counting-transport measurements. **Severity:** Medium.

## Suggestions — NICE TO HAVE

1. **DRY presenter teardown:** `PaneContainer.tsx:167-220,259-278` repeats handler restore, suppression, blur, cancellation, parking and token release. A small local release helper would make ownership invariants harder to drift; do not add a new lifecycle framework.
2. **Simplify launch lifecycle locally:** `terminal-launch-lifecycle.ts:464-499,570-602` duplicates success settlement plus durable provenance reread. Share this exact repeated transaction, preserving both fresh observations and all owner checks.
3. **Integration tests over accessor-only tests:** The existing pin and workspace tests validate individual hooks but miss final tab projection, ID adaptation and restore ordering. Several fixtures use noncanonical values such as `incarnation: "inc-1"` and omit epoch; use canonical factory fixtures where testing authority paths so doubles cannot bypass the contracts under review.
4. **Honest transient errors:** `stores/editor.ts:1813-1819,1861-1868` preserves the dirty buffer on discard/reload failure, correctly, but silently clears loading without actionable failure feedback. Surface a non-destructive retry notice.
5. **Keep measurements scoped:** Uncapped renderers are an explicit accepted decision, not an unsolicited request for a cap. Preserve separate registry-instance, active-subscription, cumulative-attach and heap metrics; label mocked-transport results as such. Whole-heap deltas without GC control do not establish retained bytes/session.

## Positive observations

- UI-only change does not expand backend route/authentication surface.
- Endpoint identity is captured before reads and travels with the retained content baseline; dirty-skip/alias reuse and persisted dirty-document handling show deliberate fail-closed design.
- Exact terminal target/claim helpers, first-claim-wins presentation and atomic reveal avoid silently stealing sessions across windows/profiles.
- Launch lifecycle is window-independent; manual stuck-launch resolution uses fresh per-owner observations and durable settlement rereads rather than cached fleet absence.
- Persisted Hub state remains logical/view-only; runtime generations, epochs and terminal targets are not added to its persistence projection.
- No unfinished TODO/FIXME markers found in the new Hub/lifecycle/helper/sidebar production paths searched.

## Recommended handoff

Fix C1–C3 first, then restore/StrictMode/current-target wiring. Main should run focused regressions for these real integration paths, followed by the project’s existing aggregate gates once after fixes. Complete container/live acceptance and human visual review separately; do not replace those gates with mocked transport success.

## Unresolved evidence

- Live PTY streaming/input isolation, quiet handoff, dirty-editor live scenarios and required capture matrix remain unestablished in the inspected qualification artifacts.
- Static findings were not runtime-reproduced by this reviewer; passing checks are supplied upstream, not rerun here.
