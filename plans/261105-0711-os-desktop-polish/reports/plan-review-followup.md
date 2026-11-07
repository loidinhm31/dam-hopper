# Targeted independent plan follow-up

## Status / disposition

**Review: COMPLETE within assigned targeted scope. Disposition: revision required; not all initial blocking findings resolved.** F1/F3/F4/F5/F6 addressed in revised design; F2 partially addressed, with one concrete public-caller migration omission below. These are planning dispositions, not implementation results, user validation or authorization to code.

Only this report written. Original review, author triage, plans and product source unchanged. Plan-relative references below use `plans/261105-0711-os-desktop-polish/`; P01/P02/P03/P07 denote their existing phase filenames.

## F1–F6 disposition / evidence

### F1 — Resolved in revised scheduling design; coherent-caller qualification still subject to F2

- P01:23–38,47–69 makes pure implemented catalog/additive types the sole preparation node; no nullable/removal/required-intent cutover there. P02:23–66,92–140 groups schema/store/API/TOML, known nullable/Fleet callers, Rust literals/API assertion and browser fixtures under one checked node, then controls.
- P03:23–59,65–110,116–162 preserves old callable APIs during resolver/journal preparation, then atomic executor/intents/consumers followed by atomic input-owner transfer. No required P06 menu export is deferred into the root prerequisite.
- `execution-ownership.md:5–40,171–187`, `architecture-contracts.md:195–201`, `plan.md:38–43`: serialized P02/P03; sequential checks/review before child; only three independent G3 nodes concurrent, all terminal before coordinator checks/completion. Failed applicable compile cannot become N/A. This removes the original structural completion deadlock, not a guarantee that undiscovered callers compile.

### F2 — Unresolved, partially corrected: actual deep links owned, public browser callers still omitted

- Corrected product seam: C1/C11 (`architecture-contracts.md:37,177–181`), P03:65–66,72–99,227–255 and ownership:134–135 assign actual deep-links source/tests, OsShell authorization and required intent handlers together. AC1:28 and AC2:32 cover qualified success, stale/unavailable/unauthorized owner and changed-owner rejection. URL parse no longer fabricates authority.
- **Residual High / high confidence — omitted public intent test producers prevent the promised exhaustive atomic cutover.** Current `packages/ui/browser-tests/os-workspace-apps.browser.tsx:183–206` calls `createIntent("file:reveal", {profileId,projectId,filePath})` and `createIntent("search:query", {profileId,projectId,query})`, then expects handled results. Neither supplies required target/generation; search also lacks required mode under revised C1:37.
- File is absent from every revised phase/ownership reference search. P03's exact prose/fenced executor allowlists (:72–99,227–255) and focused checks (:107–110,267–270) omit it; P08:23–42 neither owns nor schedules it. Generic unknown-caller escalation is not concrete ownership for this now-known caller.
- Scenario: executor node tightens intent types/qualification while these existing direct producers remain old-shape. They become invalid typed calls; strict handlers cannot continue honoring their success expectations without weakening the new qualification contract. **Predicted**, not an observed test failure. UI `build` does not establish their validity: `packages/ui/tsconfig.json:18–19` includes only src and excludes unit tests; package scripts:7–11 run separate browser tests.
- Impact/severity: High against the promised coherent public-contract migration/completion barrier, not evidence of a demonstrated production outage. Focused checks could pass while this existing suite remains incompatible. Original deep-link omission itself is corrected, but F2's complete producer/test ownership requirement is not.
- **Smallest correction:** add this exact browser file to P03 `execute-captured-actions` prose and durable `allowed_files`, plus ownership inventory; migrate both producers and their owner-qualified fixtures in that same node; include its focused browser invocation before node completion. Preserve strict required payloads; do not defer repair to P08 or delete the behavioral cases merely to evade migration.

### F3 — Resolved in revised design

- C5:125–137 and P03:116–162,279–324 own root entry/tests, browser guard hook/lib/tests, Cognito hook/tests, terminal/Monaco/frame/hook consumers and current menu coordinator/tests in the same root-input node. Existing source confirms why all are needed: root:231–264,332–336,433–437; Cognito hook:122–214,234–305; browser hook:6–21 and browser lib:6–13,42–54.
- Root directly orders privacy physical policy → capture → IME → current menu/modal → configured action/page-wide font → browser suppression → local input. Shell delegate registration is lazy, not another native listener; privacy held-key state survives shell unmount. Existing keyboard registrations/global font duplicate explicitly removed.
- Menu prerequisite is actual work, not appendix reassurance: P03:121,128–129,161,318–323 implements synchronous snapshot/subscription/dismiss and immediate TerminalPanel suppression; ownership:180 transfers completed seam to P06:25,46,96. Current coordinator:1–27 exposes only claim/release, so this assigned addition matters. AC3:39–44 covers late shell/remount, Mod+R capture/remap, full key phases and immediate menu transitions. No unfinished P06/Cognito/context API remains an identified semantic prerequisite.

### F4 — Resolved in revised design

- C1:45 and C12:183–189 preserve target/cwd/requested ID/source/full context/owner/destination; directoryKind distinguishes explicit-folder/root/profile-default. Optional terminalCreate permits generic New without fabricating folder payload; C12 expressly allows supported server default only absent explicit-folder intent. Folder authority cannot be silently substituted.
- P03:46–55,65–67,83–90,103 and ownership:175 assign journal plus actual Files/Git/ProjectInfo/deep-link/OsShell adapters/tests. Workspace root uses dot; project/worktree normalization survives wire projection; explicit folder always New despite existing compatible terminal; fresh-ID provenance blocks destructive arbitrary/reused IDs.
- AC4:48–49,52–53 covers full producers, two distinct folders, changed selection, uncertainty and failed durable writes. Source `server/src/api/terminal.rs:107–172` distinguishes workspace-required cwd from untargeted default, matching the revised policy. No additional generic-default defect established from optional request/policy combination.

### F5 — Resolved in revised design

- C10:169–175, P03:68–70,91–97,104,264 explicitly own real Editor Files selection/Browser URL form, chooser/resource children and **both** root hosts. Chooser/unset/invalid target skipped before claim/load/iframe/navigation; fabricated untitled/localhost defaults removed. This addresses current adapter claims and root-host defaults, not merely new frame count.
- Exact holder collision focuses/restores existing exclusive resource while picker remains usable; distinct selection promotes the same picker, cancel/repeat/token/owner/await races fail closed. AC4:50–51 and AC8:76 require meaningful interaction with two distinct resources and real lifetime evidence, not DOM/frame equality. Source confirms affected seams: EditorApp:79–157, BrowserApp:22–73, MonacoKeepAliveHost:285–313 and OsResourceHost:157–177; all are assigned in P03.

### F6 — Resolved in revised design

- C13:191–193, P03:70, P06:24 and P07:47–67,110–138 connect fresh delivery token → existing/new singleton → General → controlled Appearance accordion/stable focus ref. P07 owns all actual SettingsApp/Page/accordion source/tests together; ownership:181 makes transfer explicit.
- AC9:82 covers Devices, minimized/new/existing singleton, repeat after collapse, manual collapse afterward and unchanged target/source/route. Current SettingsApp:12–28,74–79, SettingsPage:34–44,421–426 and accordion:6–19,23–61 confirm why explicit consumers/control are necessary. No appState-only or DOM-label-click substitute remains in the task contract.

## Inspected coverage / checks

- Actual revised plan: `plan.md:1–55`; `reports/plan-review.md:1–99`; `reports/review-triage.md:1–58`; `architecture-contracts.md:1–201`; `execution-ownership.md:1–204`; `acceptance-matrix.md:1–103`; P01:1–82; P02:1–179; P03:1–340; P07:1–147. Supporting affected boundaries: P06:18–98; P08:18–110. Read prose and durable task fences, not triage assertions alone.
- Source windows additionally inspected: `packages/ui/src/os/types.ts:1–133`, `api/ownership.ts:35–70`, `os/intents.ts:45–140,165–205`, `os/deep-links.ts:220–280`, `os/OsShell.tsx:315–450`, `os/apps/FilesApp.tsx:1–239`, `GitApp.tsx:15–52`, `ProjectInfoApp.tsx:26–90`, `os/shell-input-context.tsx:1–173`, `components/organisms/MonacoHost.tsx:280–405`. Root/guards/claims/Settings/omitted caller/script windows cited above also inspected.
- Performed: read-only plan/source comparison; cross-UI intent-producer and nullable/Fleet reference inventory; manual DAG/barrier/transfer/allowlist/AC trace. No additional nullable/Fleet source gap established by inspected references. Read memory summary, installed planning-review/code-review guidance and development rules; README:1–90, code-standards:1–90, PDR:1–65 and preference architecture:1–80 for relevant project policy.
- Parent-reported parser result remains parent's evidence; not rerun or presented as this review's verification. No whole-plan second audit, entire-repository audit or unrelated-plan qualification.
- **Not performed:** builds/typechecks/tests/lint/formatters/smoke/runtime/browser/PTY/native/human probes, installation, Git, hydration/task-state updates, external research, implementation or nested agents. Source-derived consequences are not passing/failing execution receipts. Product/live/human acceptance remains pending, including inherited gates.

## Unresolved questions / remaining gate

- No essential targeted evidence unreachable; review coverage complete. F2 correction above remains a concrete planning blocker. Parent must disposition the bounded follow-up; neither the structural parser nor author triage closes it. Separate final user validation, implementation authorization and future execution/release evidence remain required.
