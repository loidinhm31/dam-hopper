# PR #49 — Project Plans Dashboard Review

**Verdict: Request changes.** One P1 sandbox issue; fifteen P2 correctness/resource/lifecycle issues. Thirteen reproduced through live Rust endpoints or the actual React application; three source-traced only.

- PR: https://github.com/loidinhm31/dam-hopper/pull/49
- Reviewed head: `6d6f16242885e40bc5a0cc8a26bf18d044c9a349`; base: `9969a7e2dd352e158956f82e948e471e9083c8ca`.
- Read-only implementation review. Two parallel researchers; four parallel code reviewers. Parent validated findings, rejected unsupported/security-style claims, and ran smoke scenarios.
- No implementation changes. Review/research reports added; unrelated untracked files preserved. Isolated temporary fixtures, syscall interposer, browser instrumentation, and servers removed after verification.

## Findings

### 1. P1 — Windows ancestor links bypass the configured filesystem boundary
- **Location:** `server/src/fs/secure_path.rs:880-891` (also directory/probe helpers at 807-808 and 840-845).
- `root.join(relative)` plus final-component `symlink_metadata` does not reject linked ancestors; `File::open` follows them. New strict REST/WS reads bypass the existing sandbox resolver and only revalidate the project root afterward.
- **[INFERENCE; source-traced, Windows not exercised]** A junction/symlink at `project/bridge` targeting an outside directory permits strict reading of `bridge/secret.md`; similarly, linked ancestors under `plans/` permit selected-plan reads outside the target.
- Reject ancestor/leaf reparse points using rooted Windows handles, or fail closed on unsupported secure traversal. A separate pathname pre-check is not a race-safe boundary.

### 2. P2 — Response trimming performs quadratic serialization
- **Location:** `server/src/plans/scan.rs:297-300`.
- Each removed folder causes serialization of the entire remaining response. Bounds on the final JSON do not bound cumulative CPU/allocation.
- **Reproduced:** 1,500 directories; 1,936-byte relative path; 12 components, all within supported limits. Live debug server took **56.162 seconds**, retained 851 folders, and returned `limitsReached: ["response-bytes"]`.
- Debug timing is not a production latency claim. Source establishes quadratic work; determine retained entries by size accounting or bounded binary search, then serialize once.

### 3. P2 — Three settled saves permanently exhaust automatic refresh
- **Location:** `packages/ui/src/hooks/use-project-plans.ts:294-306`; sole reset at 451.
- Counter counts all coalesced events over the hook lifetime, not consecutive unsettled churn. No reset on quiescence, successful reconciliation, or target change.
- **Reproduced:** Three separated, fully observed progress changes refreshed. Fourth changed server status to `pending`/0%; UI remained `completed`/100% and entered degraded coverage.
- Reset consecutive churn accounting after settled work and scope transitions; ordinary saves must not consume a permanent lifetime allowance.

### 4. P2 — Directory replacement leaves watches attached to the old inode
- **Location:** `packages/ui/src/hooks/use-project-plans.ts:349-353`.
- Event details are discarded. Watch re-registration depends on query-data/dependency changes; an identical listing preserves the DTO reference and the old directory subscription.
- **Reproduced:** Replace `plans/group` with a new inode containing the same child `a`; API responses before/after equal. Create `b` in the replacement: server lists `a,b`, UI shows only `a`, without a coverage warning.
- Explicitly retire/rebind affected descendant watches on rename/delete/create independently of DTO equality, then authoritatively refetch.

### 5. P2 — One inconsistent progress row completes two different phases
- **Location:** `server/src/plans/parser.rs:1463-1470`; matched row recorded at 1475-1477.
- A row can match phase 1 by its link and phase 2 by its number. Already-used row indices do not prevent reuse; conflicting identity hints are not rejected.
- **Reproduced:** Declared `1 -> one.md`, `2 -> two.md`; sole progress row `[02](./one.md) | Completed` yielded two completed phases, overall completed, fraction 1, no diagnostics.
- Validate link/number agreement and enforce one-to-one row matching before projecting decisive status.

### 6. P2 — Unreadable progress preserves frozen plan completion
- **Location:** `server/src/plans/parser.rs:1427-1429`.
- Invalid/present progress returns untouched plan-derived phases while only setting overall status to unknown/progress. Completion still uses those historical phases.
- **Reproduced:** One completed plan phase plus symlink `progress.md`: overall unknown/progress; phase completed/plan; completion 100%.
- Keep phase identities and captured evidence, but suppress decisive current phase statuses/completion when the opted-in progress document is unreadable.

### 7. P2 — Valid short GFM rows disappear from the completion denominator
- **Location:** `server/src/plans/parser.rs:911-914`.
- GFM permits missing trailing body cells. Rejecting every unequal row width silently drops declared phases instead of filling empty trailing cells or diagnosing an invalid inventory.
- **Reproduced:** Four-column table; completed first row, pending second row with no trailing Detail cell. API returned declared=1, completed=1, fraction=1 and no diagnostics.
- Preserve valid short rows; never derive successful completion from a silently reduced inventory.

### 8. P2 — Background workflow errors destroy unsaved manual drafts
- **Location:** `packages/ui/src/components/organisms/WorkflowContextDeck.tsx:253-264`; same branch in `WorkflowContextSheet.tsx:264-284`.
- Ordinary refetch errors replace the whole manual subtree even when previous overview data exists, unmounting locally owned capture/edit/note forms.
- **Reproduced in actual desktop app:** Draft title `Preserve this unsaved draft`; inject transient overview HTTP 503; draft unmounted. Recover real endpoint: form remounted with empty title. Mobile branch source-traced, not exercised.
- Preserve mounted forms across background errors and render a non-destructive error banner; distinguish initial no-data failure from retained-data refetch failure.

### 9. P2 — Reconcile claims live without retrying failed watches
- **Location:** `packages/ui/src/hooks/use-project-plans.ts:469-473`.
- Refresh only refetches data and unconditionally assigns live. Unchanged data does not retrigger the watcher effect or retry missing registrations.
- **Reproduced in actual app:** Inject transient failure for `plans` registration through the real transport seam; root watch succeeds and warning appears. Remove failure, click Reconcile: attempts remain 1, warning disappears, missing watch unrepaired.
- Run explicit watch reconciliation on manual recovery; publish live only after all required registrations succeed.

### 10. P2 — Atomic named-file replacement is accepted as an unchanged snapshot
- **Location:** `server/src/fs/secure_path.rs:594-610`.
- Final validation only fstats the opened inode. It never checks whether the named entry still identifies that inode; parent replacement is likewise unchecked.
- **Reproduced:** Temporary Linux `read` interposer atomically renamed replacement progress over the named file after opening/before reading. First API result: progress `readable`, pending, no diagnostics. Next read: completed.
- Ordinary coherent open-time snapshots can be valid designs, but this PR explicitly requires named-entry changes to return changed/target-conflict (`phase-02-native-read-api.md:53`). Validate named-entry/ancestor identity plus descriptor metadata before publishing, without automatic retry.

### 11. P2 — Labelled completion prose is not parsed as supported progress
- **Location:** `server/src/plans/parser.rs:1205-1207`.
- `Current status:` values are sent only to status-cell parsing. Completion prose is examined only in the no-colon branch, missing the existing labelled repository format.
- **Reproduced:** `**Current status:** All phases (Phase 01) completed with durable task sealing. Plan execution complete.` plus corroborating completed phase yielded overall unknown, phase completed, fraction 1, no diagnostics.
- Existing tracked example: `plans/261003-1822-advisor-routing-model-selector/progress.md:5`. Apply the bounded/corroborated prose grammar to labelled values too.

### 12. P2 — Generic Status overrides explicit Current status by column order
- **Location:** `server/src/plans/parser.rs:1284-1287`.
- First recognized status column wins, even when a later column explicitly represents current status.
- **Reproduced:** `Phase | Status | Current status` with `1 | Pending | Completed` returned phase/overall pending and fraction 0.
- Prefer explicit Current status regardless of column order; treat generic Status as fallback only.

### 13. P2 — Encoded local document links target literal percent-encoded filenames
- **Location:** `packages/ui/src/components/organisms/MarkdownPreview.tsx:57-61`.
- `decodeURIComponent` result is discarded; filesystem resolution still uses the original URI string.
- **Reproduced in actual app:** Existing `phase one.md`, link `./phase%20one.md`: viewer requests `phase%20one.md` and shows NOT_FOUND. Strict REST read of the decoded filename succeeds with HTTP 200.
- Split pathname/fragment, decode pathname once, then apply safety validation and relative resolution to the decoded name.

### 14. P2 — Document Retry does not retry the failed request
- **Location:** `packages/ui/src/components/organisms/ProjectPlanDocument.tsx:236-243`.
- Retry calls navigation with the same current path. Dashboard sets unchanged path/tab state; query key does not change and no refetch occurs.
- **Reproduced in actual app:** Main-world WebSocket instrumentation saw 3 document requests in the navigation positive control; subsequent Retry produced 0 new requests and retained NOT_FOUND.
- Wire Retry to explicit document refetch/refresh rather than unchanged navigation state.

### 15. P2 — Overlapping overflow reconciliation can leak subscriptions
- **Location:** `packages/ui/src/hooks/use-project-plans.ts:377-382`; overwrite at 363.
- **[INFERENCE; source-traced, not exercised]** While a registration is pending, another installed watch can overflow and launch a second reconciliation. Both passes subscribe the same pending path because only completed handles are tracked; later completion overwrites the first handle without cleanup.
- Cleanup then loses a subscription ID and its listeners. Serialize reconciliation and track pending registrations; never overwrite an owned handle silently.

### 16. P2 — Watch cap silently drops selected evidence-document coverage
- **Location:** `packages/ui/src/hooks/use-project-plans.ts:214-221`.
- **[INFERENCE; source-traced, not exercised]** Supported 32-component selected plan paths already require 33 ancestor watches. Adding a Markdown document under another parent creates path 34; slicing removes that document parent while reporting live coverage.
- With infinite document stale time, edits there never invalidate the visible document. Reserve its required watch or explicitly report degraded/incomplete coverage rather than silently truncating.

## Exercised Verification

| Command / scenario | Observed result |
|---|---|
| `cargo test --test plans_api --test ws_fs_subscribe` | 13 + 9 passed |
| `cargo test --lib plans::` | 18 passed; unrelated existing unused-import warning in PTY tests |
| Focused Vitest run: project queries/hook/timeline, five ProjectPlan organisms, MarkdownPreview, WorkflowPlansIntegration | 10 files, 69 tests passed |
| Isolated `cargo run` + Vite + real Chromium app | Folder browsing, selected plan/documents, four saves, replacement directory, manual draft recovery, watch failure/reconcile, encoded link, Retry |
| Live parser API boundary fixtures | Row identity collision, unreadable progress, short GFM row, status-column precedence, labelled prose |
| Bounded listing probe | 56.162 seconds on debug server; response capped, 851 of 1,500 folders retained |
| Deterministic Linux atomic replacement probe | Named progress replaced during read; old snapshot accepted as readable/current |

No full repository suite, container E2E, Windows runtime, overflow-race runtime, or maximum-watch-path runtime qualification claimed.

## Qualification Gaps

- E2E `project-plans-dashboard.spec.ts:133-147` uses `writeContainerFile`, whose implementation truncates/writes in place (`application-services.ts:211-219`); not atomic rename. It clicks Refresh but never asserts changed status/content, so cannot certify automatic invalidation or atomic replacement.
- E2E steps 149-156 switch modes without creating/asserting a draft. Secondary-target checks validate server DTO phase count, not client profile/target cache isolation.
- Visual review remains `PENDING_HUMAN_REVIEW`. Screenshot files are locally untracked and absent from the PR file list; committed evidence metadata does not supply inspectable PR image artifacts.
- Completed scalar vs phase-row disagreement not elevated: an explicitly reported overall administrative status may be independent unless a stronger contract requires conflict. Unsafe default Markdown URL claims rejected: react-markdown performs URL transformation before custom rendering.

## Remediation Order

1. Close Windows sandbox bypass; enforce specified snapshot identity checks.
2. Fix truthful phase/completion projection and bounded response work.
3. Repair watcher lifetime, replacement, failure recovery, and ownership bookkeeping.
4. Preserve drafts and correct document navigation/retry behavior; add consumer-visible regressions for the reproduced failures.
5. Strengthen actual E2E assertions and complete human visual qualification before approval.

## Research References

- [Filesystem research](researcher-261007-0803-pr49-filesystem.md): [openat2](https://man7.org/linux/man-pages/man2/openat2.2.html), [inotify](https://man7.org/linux/man-pages/man7/inotify.7.html).
- [Client research](researcher-261007-0803-pr49-client.md): [disabled queries](https://tanstack.com/query/v5/docs/framework/react/guides/disabling-queries), [QueryClient](https://tanstack.com/query/v5/docs/reference/QueryClient), [React effects](https://react.dev/learn/synchronizing-with-effects).

## Unresolved Questions

None requiring user input. Windows behavior remains source-reviewed, not runtime-qualified; two additional lifecycle boundary scenarios are explicitly source-only above.
