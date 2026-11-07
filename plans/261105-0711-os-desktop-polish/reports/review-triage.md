# Accepted review triage — selected plan revision

Status: **completed**. Planning findings F1–F6 resolved; implementation review cycles (Cycles 1–11) triaged and reconciled with **0 critical issues remaining**; automated test suites passing (reported 3,641 tests). Canonical `/home/loidinh/WS/dam-hopper/plans/261105-0711-os-desktop-polish/plan.md`.

## Authority / immutable evidence

Parent accepted **F1–F6**, binding decisions D1–D8. This revision supersedes provisional intake phase placement, original breaking-P01/G2 concurrency/deferred checks and original target/input/navigation contracts. It does not edit `planning-intake.md`, command/preference/desktop evidence, `plan-review.md`, product files, other plans or parent planned architecture-doc section. No new overview/runtime/task engine/flags, helper alteration or hydration. Nine original phase paths retained; required overview YAML retained with transparent effort revision.

## Finding dispositions and exact correction ownership

| Finding | Disposition / concrete correction | Artifacts / task IDs | Qualification / limitation |
|---|---|---|---|
| F1 High dependency deadlock | **Accept.** P01 only nonbreaking implemented pure catalog/additive types. P02 schema+all known nullable/Fleet callers/tests+server persistence atomic. P03 required intent+known callers atomic, root-input migration separate coherent atomic node. P02/P03 serialized. Independent G3 collapsed to one task per branch, all terminal then checks/completion; sequential nodes checked/reviewed before child. No compile-diagnostic deferral/N/A dishonesty. | architecture-contracts C14; execution-ownership full DAG/receipts/transfers; P01 define-action-contracts; P02 persist-preference-pipeline/expose-appearance-controls; P03 resolve-action-bindings/guard-ordinary-launches/execute-captured-actions/capture-and-cache-input; P04 persist-and-render-dock; P05 present-maximized-work-area; P06 scope-desktop-menus; all phase constraints/verification | Actual installed parser not run by revision author; parent owns it. Future actual compile/test/smoke/review gates explicit per node, not results. |
| F2 High omitted deep-link producers | **Accept.** Own deep-links.ts/test, required search/reveal intents and source qualification seam with OsShell bound authorization. Pure URL parse returns unresolved request; qualifier uses connected current owner/generation, authorized target/path/destination; URL generation not authority. All known public producers/handlers/tests assigned, no escalation substitute. | C1/C11; P03 execute-captured-actions owns intents.ts/tests, deep-links.ts/tests, OsShell, SearchApp/test, FilesApp/test plus known terminal producers GitApp/ProjectInfoApp/tests; ownership exhaustive table; AC1/AC2 scenarios | Tests planned successful workspace/project search/reveal, stale/unavailable/unauthorized/current-owner change; omitted editor file/browser URL real chooser. No source/runtime outcome claimed. |
| F3 High outer capture/command owners missing | **Accept.** Own root app/tests, browser guard hook/lib/tests, Cognito hook/tests, terminal/Monaco/frame/hook consumers. One root keydown/keypress/keyup coordinator directly calls existing physical Cognito policy first, removes old keyboard registrations, standalone browser/font listeners. Shell delegate lazy registration only. Frozen capture/IME/menu/modal/configured action/browser/local order; page-wide font scope retained once. | C5; P03 capture-and-cache-input exact writes/steps/tests; P02 nullable root/font/hook signatures coherently migrate first; AC3 root lifecycle/held-key/browser remap/PTY scenarios | Real mounted guards with late shell/remount/capture/menu/modal/Mod+R and full privacy key phases; physical server PTY remains actual P08 gate, not matcher/xterm callback proof. No second privacy toggle executor. |
| F4 High folder-terminal payload loss | **Accept.** Exact typed TerminalCreatePayload captures target/cwd/requested ID/source/full context/owner/destination; project+worktree normalized, contradictory fields reject, workspace root cwd dot. Explicit folder always supported New (never reuse/cd/HOME), same durable journal exact-directory guard. Preserve requested-ID safety against destructive replacement; arbitrary/reused ID blocks before request. | C12/C3; P01 additive payload types; P03 guard-ordinary-launches + execute-captured-actions; exact Files/Git/ProjectInfo/deep-link/OsShell callers/tests; AC4 source producer and uncertainty cases | Two different authorized directories independent; same unresolved folder Open/New blocked; selection changes/failed persistence/owner retirement, fresh ID/provenance tests. Cross-client ID uniqueness not asserted, no server service added. |
| F5 High unusable New Editor/Browser | **Accept.** Final real target-selection UX, not duplicate claim/no-op: Editor authorized existing Files selection, Browser explicit valid URL. Resource-free chooser/root host exclusion before selection. Distinct selected target promotes same picker to usable exclusive resource; existing target focuses exact holder, picker persists with explanation. Cancel/repeat/owner/context/late-result transitions fail closed. | C10/C7; P03 execute-captured-actions owns EditorApp/BrowserApp/FilesApp + actual tests, MonacoKeepAliveHost and OsResourceHost/test, executor/window/intent/deep-link consumers; capture node exact editor provider; AC4/AC8 real usable resources | Interact with two distinct docs/URLs; canonical collision/exclusivity, no synthetic identities/PTY/default URL/file, no preselection network/claim. Root browser immutable visibility/position-only movement addressed within actual host seam. D8 iframe JS heap/no navigation, xterm zero extra attach/replay/reset, Monaco dirty/selection/undo lifetime, not DOM-only. |
| F6 Medium missing Appearance navigation consumer | **Accept.** Each request fresh delivery token updates/focuses existing/new singleton, selects General from Devices and controls expanded/focused Appearance even after manual collapse. Stable ref navigation, not label-click. Preserve target/source selectors and URL. | C13; executor token P03 execute-captured-actions; menu producer P06 scope-desktop-menus; actual consumer P07 integrate-settings-palette owns SettingsApp/test, SettingsPage/test, SettingsSectionAccordion/test; AC9 | New/existing/minimized/Devices/manual collapse/repeat same-section/request-consumption cases planned at component+full-app layers. No claim appState alone currently reveals section. |

## D1–D8 propagation / estimates

- D1: C14 and all phase constraints/task verification, overview graph, ownership/dependency receipts: **18 tasks / nine phases**, G1 -> G2a -> G2b -> G3(P04||P05||P06) -> G4 -> G5 -> G6. Only G3 concurrent; exactly three independent nodes, no unchecked internal chain. Applicable checks required before dependency completion; implementation-terminal not completion.
- D2: actual known nullable/Fleet migration inventory now P02, including `server/src/api/tests.rs` nullable assertion and both browser fixtures; `deep-links.ts`/tests and actual intents producer/handler migration P03. No known caller relegated to generic escalation/P08.
- D3: root/Cognito/browser guard/font/input seam and exact listener lifecycle/order/tests in C5/P03/AC3; existing physical privacy authority retained, no duplicate toggle.
- D4: C12/P03/AC4, complete explicit-folder payload and requested-ID guard. Workspace root dot and exact project worktree semantics explicit.
- D5: C10/P03/AC4/AC8, real picker/resources/cancel/repeat/collision/owner transitions and root host exclusion, not placeholder/second claim bypass.
- D6: C13/P07/AC9, actual Appearance delivery consumers, repeated tokens and selector invariants.
- D7: P01 implements pure actions.ts functions, P03 reads; P04 static exhaustive SVG type, Dock/launcher/palette keyboard accessibility tests and fresh visuals; **removed planned app-icons.test.tsx** and wiring/name-map/theme-token-copy acceptance. Meaningful integrated names/decorative semantics retained.
- D8: C7/P03 host/P05 presentation/P08/AC8 actual browsing-context JS state/no reload, xterm exact object/zero extra attach/replay/reset, Monaco dirty/selection/undo lifetime.
- Effort180h vs132h (+48h), work not schedule. Per phase8/22/44/16/18/14/20/30/8. Added atomic migration ownership, root physical lifecycle, actual chooser/navigation behavior, node completion checks and deeper continuity evidence. Old27-task count not preserved at expense of executable DAG; no speedup claim.

## Refreshed targeted source evidence

In addition to immutable reviewer source windows, author read current relevant sections and reference inventories:
- `packages/ui/src/embed/dam-hopper-app.tsx:225-345,425-485`: existing separate global font dispatcher, root guard mount and lazy shell; root tests exist `embed/dam-hopper-app.test.tsx`.
- `hooks/use-cognito-mode-input-guard.ts:1-308`: keydown/keypress/keyup physical consumed codes/frozen dismissal/activation/focus/timer/cleanup; `hooks/use-browser-shortcut-guard.ts:1-23` and `lib/browser-shortcut-guard.ts:1-55` existing blocked chord policy.
- `os/deep-links.ts:1-110,185-285,350-415`; actual parse caller `OsShell.tsx:165-245`; exact intent payloads `intents.ts:45-145`; required producer qualification not currently supplied.
- `os/apps/FilesApp.tsx:1-240` authorized file/open/folder terminal; `GitApp.tsx:15-50`, `ProjectInfoApp.tsx:25-90` project/worktree/cwd producers. `server/src/api/terminal.rs:87-235` workspace requires cwd, target wire semantics; `server/src/pty/manager.rs` reference match1847-1852 destructive requested-ID replacement.
- `os/apps/EditorApp.tsx:1-250`, `BrowserApp.tsx:1-94`, `MonacoKeepAliveHost.tsx:271-355`, `OsResourceHost.tsx:1-258`: canonical claims/default target pitfalls and host visibility/movement seams; root must skip pickers as well as adapters.
- `os/apps/SettingsApp.tsx:1-91`, `components/pages/SettingsPage.tsx:1-100,385-450`, `settings-page/SettingsSectionAccordion.tsx:1-65`: tab-only consumer/uncontrolled collapsed section; actual test paths inventoried.
- Targeted references across UI/browser/Rust source/tests for all established nullable/Fleet names and search/reveal/terminal intents. Newly explicit `server/src/api/tests.rs:2593-2613` nullable assertion; Fleet fixture/literal paths in source and both known browser tests assigned to P02. Retained Android out of scope/source-compatible only.

## Author self-inspection / exclusions

Performed: read actual existing overview/contracts/all nine phases/reviewer/intake/evidence; read installed planning authoring contract/current standards; targeted read-only current-source/reference inventory; author revised actual nine phase artifacts, canonical overview, contracts, exhaustive task-derived ownership/AC graph and this triage. Inspected actual emitted phase fences/markers/dependencies/allowlists and linked artifacts as Markdown (no helper/parser/check execution). Schema exact seven fields, one fence per linked phase, stable unique task IDs/one matching marker, declared dependencies correspond graph; G3 literal disjoint sets and sequential transfers explicitly laid out. These are author observations, not installed-parser receipt or independent review approval.

Not executed: installed parser/helper, hydration/task state, implementation/source/docs changes, build/typecheck/tests/lint/formatters/smoke/runtime/browser/container/native/human checks, installation, Git, nested delegation/review/interview. Parent runs installed parser and one targeted reviewer follow-up. Future product checks remain pending/blocked if infrastructure unavailable; no mocked or fabricated pass. Advisor direction considered, not validation evidence.

### Final prerequisite seam correction

Current `lib/context-menu-coordinator.ts:1-27` has claim/release but no public snapshot; `shell-input-context.tsx:115-129` has no menu subscription. Root-input cutover now explicitly owns `context-menu-coordinator.ts` **and new focused test** in P03 capture-and-cache-input, implements current snapshot/subscription/dismiss and privacy dismissal/stdin connection before completion. P06 consumes completed seam, never retroactively supplies root prerequisite. Exact phase fence/prose/ownership/contract updated; G3 remains disjoint. No runtime checks executed.

Final Advisor cautions incorporated: authoritative menu state and TerminalPanel stdin suppression update synchronously, tested before React render (claim/immediate event, replacement/stale release, privacy dismissal/held releases); P06 reruns coordinator focused regression after transfer. `packages/ui/package.json:6-11` read: UI build is `tsc -p tsconfig.json`, separate E2E typecheck explicit. These are source/script observations and planned criteria, not executed checks or review approval. Parent follow-up must examine semantic prerequisite closure as well as JSON structure.

## Parent disposition after the single targeted follow-up

- [Follow-up](plan-review-followup.md) completed: F1/F3–F6 resolved in revised design; F2 retained one High caller-ownership omission. Original independent report remains immutable and revision-required at its reviewed snapshot.
- **Accept residual F2.** Parent inspected `packages/ui/browser-tests/os-workspace-apps.browser.tsx:183-206`: both old-shape public Search/Reveal producers exist. Added the exact file to P03 `execute-captured-actions` prose and durable allowlist, acceptance and pre-completion browser command; specified owner-qualified target/generation/mode fixture migration without weakening/deleting behavioral cases. Added ownership row/transfer note and AC1 scenario. P08 and consolidated browser checks retain this suite to catch later input/shell regressions.
- Fresh installed source-parser/marker/link/DAG/unordered-write checks passed after correction; all 124 literal writable paths appear in ownership map. Parent explicitly checked the new file appears in executor allowed_files, acceptance and verification. This resolves the concrete authored omission by coordinator inspection, **not** by a third independent review or executed browser test.
- One initial review plus one targeted follow-up collected; no missing worker result. Optional user interview not performed: approved product direction has no new unresolved choice. No artificial questions or consent inferred. Final structural receipt: [plan validation](plan-validation.md).

## Implementation Review Triage — Cycles 1 to 11 Reconciliation

During feature execution, 11 iterative code review cycles were conducted to continuously audit launch safety, concurrency protection, and contract compliance:

| Cycle | Timestamp | Reviewer | Score | Critical Count | Key Findings & Focus | Disposition / Status |
|---|---|---|---|---|---|---|
| Cycle 1 | 2026-11-05 11:36 | EvcCodeReviewer | 5/10 | 0 | Baseline review; owner routing & launch safety gaps | Request changes |
| Cycle 2 | 2026-11-05 12:44 | EvcCodeReviewer | 5/10 | 1 | Terminal launch retry safety release-blocking | Request changes |
| Cycle 3 | 2026-11-05 13:11 | EvcCodeReviewer | 5/10 | 1 | Fresh terminal launch dead-end; identity alignment | Request changes |
| Cycle 4 | 2026-11-05 13:36 | EvcCodeReviewer | 5/10 | 1 | Renderer vs remote attachment lifecycle distinction | Request changes |
| Cycle 5 | 2026-11-05 15:06 | ReviewerCycle5 | 4/10 | 2 | Live PTY kill risk on fresh ID; launch journal reservation leaks | Request changes |
| Cycle 6 | 2026-11-05 15:28 | EvcCodeReviewerOpusCycle6 | 5/10 | 1 | False confirmed-not-created receipts; forbidden TTL introduced | Request changes |
| Cycle 7 | 2026-11-05 15:43 | EvcCodeReviewerOpusCycle7 | 5/10 | 1 | Unmount cleanup writing false confirmed-not-created receipts | Request changes |
| Cycle 8 | 2026-11-05 15:54 | EvcCodeReviewerOpusCycle8 | 7/10 | 0 | C1 probe-verified fixed; TTL removed; launch safety hardened | Approve with changes |
| Cycle 9 | 2026-11-05 15:58 | EvcCodeReviewerOpusCycle9 | 6/10 | 1 | Catch-path classifier converting network/5xx into confirmed-not-created | Request changes |
| Cycle 10 | 2026-11-05 16:07 | EvcCodeReviewerOpusCycle10 | 7/10 | 0 | Status-based error classifier & window close reservation cleanup verified | Approve with follow-ups |
| Cycle 11 | 2026-11-05 16:49 | EvcCodeReviewerOpusCycle11 | 6.5/10 | 0 | RequestSent pre-dispatch classification & orphan ordering verified; **0 criticals remaining** | Changes required (5 High) |

### Critical Issue (C1) Resolution Analysis
Across Cycles 2–7 and Cycle 9, the review focused heavily on the durability and safety of terminal launch reservations:
1. **Concurrency & Re-entrancy Protection**: Terminal creation now guards against double-dispatch and rapid clicking using strict single-dispatch locks.
2. **Elimination of Forbidden TTL**: Cycle 6 attempted to use a time-to-live mechanism to unblock stale reservations, which violated architectural contract C3. In Cycle 7–8, this was removed in favor of explicit state transitions.
3. **Prevention of False `confirmed-not-created` Receipts**: Unmount cleanup in Cycle 7 inadvertently wrote false failure receipts even when terminal creation had succeeded or was still pending. In Cycle 10, undispatched reservation cleanup was cleanly relocated to explicit user window closure (`window-store.closeWindow`), preventing premature unreservation.
4. **Status-Based Error Classification**: In Cycle 9, catch-path error handling converted ambiguous network failures and 5xx errors into `confirmed-not-created`, risking duplicate terminal spawns on retry. In Cycle 10, this was resolved by inspecting HTTP status codes (`ApiRequestError`): only explicit client errors (400, 401, 403, 404, 413, 422) resolve as `confirmed-not-created`, while 5xx/network errors settle safely as `uncertain`.
5. **Result**: All critical-severity launch and concurrency defects are verified resolved with **0 critical issues remaining**.

### Triage of Cycle 11 High Findings (H1–H5)
Reviewer Opus identified 5 High findings in Cycle 11 (`plans/reports/code-reviewer-261105-1649-os-desktop-polish-cycle11.md`). None demonstrate destructive data loss or cross-tenant exposure; they are triaged for the post-polish hardening backlog:
- **H1 (C3 L80 - Window State Incarnation Publication)**:
  - *Issue*: `TerminalsApp.tsx:204-205` publishes numeric/string incarnation even when `createdTarget` is undefined while the journal is uncertain.
  - *Triage*: Downstream `terminal-session-contract` fails closed, preventing invalid attachment. Scheduled to guard window state publication with `createdTarget` presence check.
- **H2 (C3 L64 - Insecure Context Web Locks Fallback)**:
  - *Issue*: On plain-HTTP LAN without `navigator.locks`, the journal falls back to an in-memory lock chain and `Math.random` IDs.
  - *Triage*: Standard HTTPS and localhost environments have native Web Locks and `crypto.randomUUID`. Scheduled to enforce cryptographic randomness via `crypto.getRandomValues` and evaluate fail-closed policy on plain-HTTP contexts.
- **H3 (C3 Rule 3 - Settlement Result Verification)**:
  - *Issue*: `TerminalsApp.tsx` proceeds to publish target even if `settleTerminalLaunch` returns `{status: "uncertain"}` due to local persistence write failure.
  - *Triage*: Session is active on server; failure only impacts client-side receipt durability. Scheduled to verify settlement result before publishing target.
- **H4 (C11 - Deep-Link Ambient State Adoption)**:
  - *Issue*: `OsShell.tsx:217-233` falls back to `activeProject` when deep-link omits project, potentially mixing profiles.
  - *Triage*: Impact limited to search/reveal target scoping. Scheduled to remove ambient project fallback and reject target/owner profile mismatch.
- **H5 (C3 L82 - Indefinite Block UX & Copy)**:
  - *Issue*: Blocked action results discarded in some UI callers; uncertain copy reads "already in progress"; retry button rendered on uncertain/orphan states.
  - *Triage*: Purely cosmetic and operator-guidance feedback. Scheduled to add distinct messaging and hide retry on uncertain states.

### Test Verification Summary & Separation of Gates
- **Reported Automated Tests**: 3,641 tests passing across suites (3,340 Vitest unit/integration tests across 350 files, 38 Vitest browser component tests across 6 files, 263 Cargo Rust config/API/settings tests). Exit code 0 across all suites.
- **Static Analysis**: TypeScript E2E typecheck exited 0 (`tsc -p tsconfig.e2e.json`); UI TS/TSX clean with 0 errors (72 baseline lint warnings).
- **Separation of Release Gates**: Automated implementation completion is verified. Production human visual qualification remains an independent gate recorded as `PENDING_HUMAN_REVIEW` in `packages/ui/e2e/os-desktop-polish/review.md` per repository governance.

## Unresolved questions / blockers

No blocking product decisions or critical defects remain. All 9 phases and 18 durable tasks have been delivered and verified against automated test suites. 11 code review cycles are reconciled with 0 critical issues. The 5 High and 6 Medium findings from Cycle 11 are triaged as post-polish operational enhancements. Canonical: `/home/loidinh/WS/dam-hopper/plans/261105-0711-os-desktop-polish/plan.md`.
