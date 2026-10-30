## Code Review Summary — Cycle 3

**Score: 6/10 — original C1 signing-token fallback repaired in source; validation incomplete and high-priority defects remain. Not release approval.**

### Scope and evidence
- Plan folder: `plans/261030-1617-android-focused-git-view/`; Phases 01–08, acceptance requirements, completion checkboxes and release-readiness ledger.
- Reviewed current C1 fixture/runner, actual server token/config/environment/MFA resolution and auth seeder; re-inspected runtime/safety/publication, mounted Git controls/state/graph, retained editor/terminal bindings and instrumentation acceptance assertions. Relevant source ranges and branch changed-path inventory inspected; not exhaustive coverage of every changed test line.
- Read README, PDR, code standards, published development/primary/documentation workflows and code-review skill.
- No reviewer builds/tests/linters/device runs. Inspected supplied compile/JVM/Android execution logs (`artifact://482`, `artifact://485`, `artifact://488`) and persistent tester report `plans/reports/tester-261031-0029-c1-verification.md`. Tester reports 937 shared JVM + 231 Android tests passing, zero failures/errors/skips; compilation successful, mostly up-to-date. Self-test exit 0 and 13 PASS checkpoints recorded at tester report:30–79.
- Only this report authored. No product/test/plan/task-state edits; Main retains tracking ownership. LOC/type/test-coverage percentages not measured.
- Runtime failure scenarios below are **[INFERENCE] from inspected executable source**, not reproduced device observations. Confidence high except graph measurement, explicitly qualified.

### C1 disposition
| Requested check | Finding | Evidence |
|---|---|---|
| Absolute evidence path | **Resolved in source.** Run directory and downstream SQLite/config/HOME paths derive from `path.resolve(evidenceDir)`. | `native/android-app/scripts/git-workspace-fixture.mjs:841–844,864,907–921` |
| Child HOME/XDG config isolation on supported POSIX | **Resolved for server signing-token/default HOME-config resolution in source.** Both paths absolute and disposable; matching token files written with mode 0600. Seeder receives explicit disposable SQLite path and independent signing token. Ambient environment caveat remains W2. | Fixture:867–877,907–925; `server/src/main.rs:1120–1124,1140–1161`; `server/examples/application_e2e_seed.rs:76–87,137–141` |
| Win32/Darwin refusal before host credentials | **Resolved in smoke source.** Guard runs before Git setup, seeding, token creation and server spawn. An evidence directory may be created first; no host credential read/write appears in this smoke path. | Fixture:831–860 |
| Verified host-file non-mutation in self-test | **Partial, not end-to-end isolation proof.** Passing test compares one host token's existence/mtime/size around a call with nonexistent binaries. Call throws at line 832, before absolute-path, platform or child-environment logic. | Fixture:784–815,831–855; tester report:77–79 |

**Conclusion:** the concrete C1 relative-XDG/inherited-HOME signing-token fallback and Darwin allowance are removed. Do not claim all C1 acceptance evidence complete: actual supported-POSIX launch with relative evidence, platform-refusal regression and comprehensive disposable-sentinel non-mutation checks are absent. Self-test's real-host stat check does not itself read token contents or mutate them.

### Critical issues
- **None identified in the inspected current changes.** Previous direct host-token read/copy/overwrite/restore and relative-config fallback are not present in the smoke path. No remaining critical host-token mutation path established. This is not a blanket security certification or proof that all acceptance criteria pass.

### Warnings
Paths below relative to `native/android-app/`, unless another root is explicit.

**W1 — Medium: C1 regression does not exercise the repaired branches.**
- Fixture:784–815 compares only token existence, size and mtime, using a guaranteed missing binary. It never checks the actual child HOME/XDG values, relative evidence paths or Win32/Darwin refusal; the selected host path ignores custom XDG and Darwin's actual config location.
- Impact: regression could restore the vulnerable logic while this test still passes. Correction: disposable sentinel homes/config roots, same-size-content/hash checks, valid harmless binary prerequisites for refusal tests, and supported-POSIX current-server launch assertions. Never test by replacing real credentials. Current passing result is valid only for its narrow prerequisite case.

**W2 — High: HOME/XDG changes do not isolate all ambient credentials.**
- Fixture:873–877 leaves seed environment inherited; server environment at :915–925 spreads `process.env`, has no disposable `DAM_HOPPER_MFA_KEY_FILE`, and spawn leaves CWD inherited.
- Actual server startup calls `dotenvy::dotenv()` (`server/src/main.rs:628–629`) and reads configured MFA key bytes in SQLite mode (`:571–574`; `server/src/auth/secret.rs:57–75`). Thus an inherited or CWD-dotenv host MFA key path can still be read despite isolated HOME/XDG. No key copying/exfiltration/mutation demonstrated; this is a remaining credential-access/isolation gap, not the old signing-token overwrite.
- Correction: provision an independent owner-restricted MFA key; pass deliberate fixture auth/config environment and isolated CWD to applicable children. Resolve executable paths absolutely before changing CWD. Do not describe inherited environment as a fully isolated server.

**W3 — High: late refresh can undo runtime revocation.**
- `features/git/GitWorkspaceRuntime.kt:83–109,112–123,161–165`: unowned refresh job can complete roots after revoke, select/propagate scope, then revalidate shared presentation; old mutation events refresh without exact-owner admission.
- `WorkspaceGitSafety.kt:42–53` accepts missing live connection; production ViewModel captures old immutable `apiClient.connection` (`androidApp/.../platform/workspace/NativeWorkspaceViewModel.kt:1359–1376,1405–1422`).
- Impact: retired runtime can repopulate controls/presentation. Correction: runtime epoch/owned cancellation, actual installed owner/generation/root admission after suspensions and before every host effect; missing/retired authority must fail closed even for clean workspaces.

**W4 — High: post-dispatch uncertainty becomes rejection; cancellation swallowed.**
- `WorkspaceGitSafety.kt:107–112` catches dispatch exceptions, including cancellation. `GitChangesController.kt:156–198` and `LeasedPublishController.kt:125–185` classify returned failures as REJECTED, bypassing their outer UNKNOWN paths. Runtime reconciles SUCCEEDED only (:161–165).
- Impact: accepted writes with lost acknowledgements appear refused and leave stale state/baselines; no automatic resend observed. Correction: distinguish preflight denial/domain rejection from uncertain dispatched completion, rethrow cancellation, spend uncertain baselines and reconcile exact original owner without resend.

**W5 — High: affected-document transaction and successful whole-target reconciliation incomplete.**
- Dirty FILES/TARGETS/HISTORY now safely refuse (`WorkspaceGitSafety.kt:68–104`), preserving the concrete Drop repair. Approved affected-document Save/actual Discard/Cancel and revision revalidation are still absent.
- `openWorkspaceFile` passes raw Git path (:200–215); reconciliation (:219–236) omits HISTORY/TARGETS, loops only supplied paths and matches clean tabs by path without full owner/target. Empty-path whole-target mutations reload no clean tabs; nested-root mapping differs from the dirty guard.
- Impact: clean buffers remain stale after checkout/reset/drop; nested review may open the wrong workspace-relative file. Correction: one exact-owner root projection, both rename paths, complete affected-document transaction, whole-target clean-tab/tree refresh preserving dirty text and undo.

**W6 — High: mounted navigation/conflict recovery not wired end-to-end.**
- `GitChangesView.kt:20–24,72–119` never invokes its diff callback; `GitHistoryView.kt:149,177–190` opens the parallel details dialog without route diff callback. `GitWorkspaceState.kt:91–100` sends Diff Back directly to Overview. Worktrees expose Remove but no Open (`GitBranchesWorktreesView.kt:142–166`).
- Production search for `getConflicts`, `getOperation`, `openRecoveryTerminal` finds repository facade/declarations and runtime implementation, no mounted consumer. Runtime has no actual conflict/operation discovery state.
- Impact: AC01/06/09 cannot be satisfied by API declarations or direct state tests. Correction: wire retained nested routes/Back, worktree Open and truthful conflict/operation unknown/blocked states with target-qualified terminal handoff; remove parallel dead presentation paths.

**W7 — High: retained terminal binding still admits stale same-controller effects.**
- `ui/screens/ProjectTerminalScreen.kt:340,529–570,750–800`: surface epoch stays 1; write completion invokes captured callbacks without post-suspension binding admission; stream checks compare captured repository/connection to themselves.
- `features/terminal/TerminalAttachQueue.kt:71–82` explicitly calls `controller.failAttach()` after `isCurrent()` is false, so an obsolete request can fence a newer controller attach.
- Correction: advancing retained installed-binding identity and admission at every attach/stream/write/result effect; stale requests must not mutate the new replay/input gate.

**W8 — High: editor completion admission happens too late or not at all.**
- `features/editor/EditorTabsState.kt:298–344,356–380`: epoch checks cover successful loads only; late unavailable/error branches mutate retained tabs. `:486–499` checks save epoch after coordinator already mutates session/tab (`EditorTabSaveCoordinator.kt:27–68`). Force overwrite (:636–670) has no corresponding fence.
- Impact: old transport results can affect current retained editor state; discarded successful loads can leave loading placeholders. Correction: admit all outcomes before session/tab effects, including overwrite/error paths; settle or restart loading work on rebind.

**W9 — High: device runner cannot maintain an authenticated fixture.**
- `scripts/run-git-workspace-journeys.sh:144–184` waits for finite smoke, whose `finally` stops proxy/server (`git-workspace-fixture.mjs:1001–1002`), then invokes instrumentation with `AUTH_TOKEN=""` against stopped ports. CLI advertises `--serve` but has no implementation. Fixed ports and first-device fallback (:96–99,132–133) remain.
- Correction: genuine runner-owned fixture lifetime/readiness, protected bearer handoff, exact requested serial, fresh owned ports/reverse mappings and cleanup. Win32/Darwin refusal is a safety boundary, not a passing live smoke or device gate.

**W10 — High: instrumentation is not the required visible authenticated acceptance journey.**
- `androidApp/.../NativeGitWorkspaceJourneys.kt:88–168` uses synthetic profile navigation/direct state changes and no-op WebSocket overrides rather than authenticated root bootstrap and Compose clicks; expects Diff→Details, contradicted by state Back implementation.
- :356–382 loads an inactive-branch snapshot then edits a different signed commit; :561–578 checks direct clean/retired guards, not full active dirty-dialog flow; :624–636 checks existence of dropped POST, not exactly-one count plus external accepted mutation state.
- Correction: actual mounted visible controls with deterministic waits, real auth/transport, per-action external Git assertions and exact denied/dispatch counts. Device absence is not the only qualification blocker.

**W11 — Medium: graph geometry/per-frame work and retained ref remain problematic.**
- `GitCommitRow.kt:39–45` + `GitGraphLane.kt:41–48`: width-only Canvas inside unconstrained-height Row risks zero measured height **[INFERENCE, medium-high confidence; not measured]**. Padding separates row-clipped ancestry.
- `GitGraphLayout.kt:92,198–202` repeatedly scans all edges per row, O(VE); `GitHistoryView.kt:46–50` computes layout in composition; `GitGraphLane.kt:73–115` allocates dash/geometry/path/stroke objects during draws. Runtime refresh (:96–104) also resets viewed ref to active branch; LazyColumn state is composition-owned.
- Correction: measured contiguous row geometry, outgoing-edge/row-segment indexing, changed-layout computation outside main-thread composition with owner admission, cached draw resources, retained viewed-ref/viewport authority. No performance measurements claimed.

**W12 — Medium: confirmations and completion documentation still overstate guarantees.**
- `GitChangesView.kt:37,172–184` remembers path-only discard across scope changes, dispatches through current controller scope and immediately calls success callback, including later refusal. Branch-delete dialog likewise not owner/root-bound (`GitBranchesWorktreesView.kt:173–185`). Bind confirmation identity and notify only on actual admitted completion.
- `plans/.../plan.md:4,13,23–30,61–63` simultaneously says complete and future implementation/evidence; several phase checklists remain unchecked. Phase07:148–150 marks integrated qualification complete despite explicit hardware-block rules (:63–66,140–142). Release-readiness:25,33–42,50–54 claims functional/live verification beyond current source and current platform refusal.
- Main should reconcile implemented/reachable, exercised and blocked states with provenance; do not rewrite historical pass evidence as current success or use report completion to satisfy missing hardware gates.

### Positive observations
- Original signing-token issue addressed at its actual config-resolution boundary: absolute disposable paths plus both HOME and XDG, independent random token, 0600 token files, explicit unsupported-platform refusal; no host-token backup/restore.
- Dirty HISTORY is included in the guard; invalid dirty-path translation fails closed. Keep this repair while implementing the full approved transaction.
- External Git commands use argument arrays rather than shell evaluation. Separate rewrite and exact-lease publication, explicit owner/generation/root values and deterministic-vs-live suite separation remain appropriate designs.
- Supplied deterministic test and compile gates pass; no claim they prove disconnected UI, supported-POSIX isolation or hardware acceptance.

### Suggestions / recommended actions
1. Close W1/W2 with disposable-sentinel regression coverage and deliberate fixture child environment/CWD/MFA ownership. Main should exercise safe POSIX current-server smoke using relative evidence, plus Win32/Darwin refusal with valid prerequisites; none executed by this reviewer.
2. Prioritize runtime/terminal/editor completion admission and unknown-outcome semantics, then affected-document transaction and exact clean-buffer reconciliation. Add production-controller denied/race regressions, not guard-only assertions.
3. Wire visible routes/worktree Open/conflict recovery; scope confirmations and retain viewed state; fix measured graph geometry and avoid quadratic UI-thread work.
4. Repair fixture lifetime/authentication and genuine mounted journeys before seeking emulator/physical ARM64/API29/form-factor evidence. Run coherent checks once after edits stop; preserve failures and blocked gates.
5. Reconcile plan/docs only to source and exercised evidence. No retries/telemetry/new framework/dependencies needed for these corrections.

### Metrics and unresolved evidence
- Critical findings identified: **0**. Warnings: **12 grouped findings** (9 high, 3 medium); review categories, not lint diagnostics.
- Tester-reported deterministic total: **1,168 passed**, zero failures/errors/skips; compiler success corroborated in supplied log. Reviewer executed no checks. No lint/type-coverage/test-coverage percentages measured.
- Unresolved: actual supported-POSIX child launch/config isolation and sentinel non-mutation, executable platform-refusal regression, full affected-document/race/controller evidence, real mounted graph measurements and authenticated emulator/ARM64/API29/phone/tablet/security qualification. No unresolved product decision identified.
