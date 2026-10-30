# Phase 07 — Current-server Git and real Android qualification

## Context / overview
Priority P2. Status blocked (GATE-C physical/emulator qualification blocked pending adb; runner W9 and journey W10 open). Effort unestimated. Owner: **qualification owner**. Execution group: **G3 sequential qualification with independent fixture boundary**.
Predecessors: mount-focused-git-host. Successors: 08 after evidence collected; failed gates remain blocked.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [coordinator evidence](reports/coordinator-evidence.md), [Git evidence](reports/git-contract-evidence.md), [workspace evidence](reports/workspace-safety-evidence.md). Read relevant current source before coding; source facts are not runtime results.

## Key insights
- Existing NativeEditorExplorerJourneys constructs some state directly and has optional server branches; it is a pattern reference, not evidence of mounted Git or independent Git qualification.
- Installed Android module already includes Compose UI test JUnit4, ActivityScenario and runner dependencies; no dependency addition necessary.
- Existing editor fixture runner seeds authenticated SQLite via application_e2e_seed; reuse its authority/conventions, not its optional checks or content echo as proof.

## Functional / nonfunctional requirements
- All ten approved ACs remain required, with current unchanged server and real disposable Git/bare remote.
- Independent external authority verifies actual objects/index/files/remote, real mounted root and all negative scope/retry/safety cases. Physical ARM64/API29 and phone/tablet visuals remain release gates. No product repair/installation/server writes. AC01–AC10.

## Architecture and data flow
New shell runner -> built current server and existing auth seed executable -> isolated SQLite/config/project registry/repos/worktrees/remote -> adb reverse loopback -> real MainActivity Compose journeys. New Node standard-library fixture/proxy controls delays/ack drops and executes external git observations, not app repositories. Android NativeGitServerFixture parses mandatory args and reads independent observation snapshots; test-only lifecycle, no product service. Reports are from observed output only.

## Exact writable actions
Paths below are literal normalized repository-relative paths; this table and task arrays have identical writable union. No wildcard ownership. Create only named necessary files; modify existing patterns, no parallel replacement system.
| Action | File | Purpose |
|---|---|---|
| Create | `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitServerFixture.kt` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `native/android-app/scripts/run-git-workspace-journeys.sh` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `native/android-app/scripts/git-workspace-fixture.mjs` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitWorkspaceJourneys.kt` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `plans/261030-1617-android-focused-git-view/reports/git-qualification.md` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `plans/261030-1617-android-focused-git-view/reports/device-qualification.md` | Dedicated real Git runner/fixture/journey or evidence report |
| Create | `plans/261030-1617-android-focused-git-view/reports/request-contract-audit.md` | Dedicated real Git runner/fixture/journey or evidence report |

Delete files: none; delete obsolete members/calls inside owned modified files as specified. No compatibility aliases/shims.

Read-only related paths:
- `native/android-app/androidApp/build.gradle.kts`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeEditorExplorerJourneys.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeFileServerFixture.kt`
- `native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt`
- `native/android-app/scripts/run-editor-explorer-journeys.sh`
- `server/examples/application_e2e_seed.rs`
- `docs/api/git.md`
- `docs/api/authentication.md`
- `docs/android-native-acceptance.md`

## Ordered implementation steps by task ID
### create-real-git-fixtures
0. Before completion, compile NativeGitServerFixture and run SAME-TASK `--self-test` (protocol/CLI/negative checks, no device/journey class) and `--smoke-current-server` (real authenticated current server + independent Git oracle). Implement both Node modes with actual behavior; neither starts Q2 nor loads NativeGitWorkspaceJourneys. Q2 is usable only after the next task creates that class. These tests and passing review close the fixture prerequisite.
1. Implement new runner CLI Q2 exactly, additionally require `--seed-bin <absolute-current-application_e2e_seed-binary>`; this existing helper is prebuilt from the same current source, not a server edit. Capture binary identities. Provision isolated config/APPDATA/auth.db/server-token/MFA key using existing seed semantics, no production tokens or no-auth qualification. Password/MFA UX is not redesigned/test-bypassed in product; fixture imports valid account session through existing secure profile bootstrap and requires server auth refresh returning that real account before root workspace mounts.
2. Require installed Git, Node, ADB/SDK/Gradle prerequisites and binaries; do not install/build server implicitly in runner. Bind all test listeners/current server to loopback with fresh ports, use adb -s exact serial reverse, no arbitrary first-device selection. Missing args/device/auth/session verification -> nonzero blocked result, never ignored assumption. Use argument arrays/quoted data for punctuation paths; never shell eval names/paths from device/app.
3. Host fixture creates real deterministic repos: staged+unstaged same file, untracked/binary/deleted/empty/renamed paths, linear/merge/octopus/skewed/shallow/empty/detached, local/remote name collisions, active/inactive branches, linked-worktree occupancy, nested project + nested repository and punctuation paths. Bare remote + peer clone for drift, actual conflict/active operation fixtures. Consent guard fixture may use signed-header objects via git hash-object; assert actual header presence/removal without claiming cryptographic signature verification.
4. Build independent per-action oracle with external `git status --porcelain=v2 --untracked-files=all`, `ls-files --stage`, `diff --binary`, `diff --cached --binary`, `rev-parse ref ref^{tree}`, `log --all --format=%H:%P`, `cat-file -p`, bare-remote refs and byte hashes. Expected preservation/changes derive from fixture setup and direct Git, not same app DTO/mapper. Node test-only HTTP endpoint serves captured observations to Android; no product endpoint.
5. Test proxy forwards real authenticated requests exactly once, can hold reads/reorder responses/drop mutation acknowledgement after server completion; authoritative Git oracle determines accepted outcome. Capture redacted endpoint/fields/request counts, never mutate successful/failed response into fabricated success. Cleanup only owned processes/adb reverse/disposable directories; preserve failure evidence. Never reset user's repository.

### qualify-live-git-journeys
0. This task creates its own instrumentation class, compiles it, then runs emulator Q2/Q3 with real Git Q4/Q5 and gets passing review before it can complete; do not defer that evidence to later qualification report.
1. Use installed Compose test JUnit4 and ActivityScenario on actual MainActivity, existing secure profile/session fixture setup then visible profile/project selection. Click Git row/sections/toolbar/buttons/dialog confirms; don't bypass by replacing active composition or directly calling controllers for claimed acceptance. Mandatory fixture args fail if unavailable. Keep read-only independent client separate from GitRepository.
2. Implement AC01/02: all sections/nested Back, rotate/panel retention, input/IME/hardware/paste isolation, terminal grid/session/draft and editor document/text/undo; stage/unstage/commit/amend/discard + refresh after terminal edits, binary/deleted/empty and false/error results. Assert Git oracle before/after each action, not only final state.
3. Implement AC03/04/05: visible graph against parent oracle including upward and page-boundary stubs, literal search/collisions; active/inactive complete-message rewrite and actual chain squash; stale HEAD/merge/gap/search/signature/occupancy blocks. Compare final tree/index/files/untracked unchanged where contract demands. For BOTH rewrite types remote unchanged until separate prepare/confirm; externally advance bare remote after prepare, stale-remote no force; no-op/uncertain/malformed results no receipt.
4. Implement AC06/07: create/open/remove/prune nested/punctuation worktrees; hidden/retired dirty and non-visible live terminals block deletion; failed inventory/missing discovery block; Cancel/Save fail/actual discard and post-prompt target/revision change; no fallback root dispatch, old PTYs unchanged and new terminal correct target. Use existing exact target creation UI, not terminal retarget.
5. Implement AC08/09/10: slow request root/ref/search/details/layout/profile/account/generation switch; old result cannot change new view/event/receipt; drop acknowledged mutation result, exactly one forwarded request, reconciliation only. Read conflict/operation handoff, non-Git409 not empty history; request inventory no new fields/endpoints, secondary fetch/pull zero requests and visibly disabled, selected root ordinary push.

### qualify-git-failure-boundaries
0. This verification-only task completes only after required physical ARM64/API29/form-factor/AC evidence passes review; missing hardware blocks it, not a passing implementation substitute.
1. After all source revisions, one coherent verifier runs Q1 and Q2/Q3/Q6, preserving exact exit codes/reports. Record observed commands/device/server/app identities and per-AC external evidence. Failures return to original implementation task for scoped fix; stop qualification while product edits occur; rerun affected coherent checks after terminal fix.
2. Emulator plus physical ARM64 and API29 target (may be one physical API29 device), phone-width and tablet visual inspections: graph geometry/refs/action reachability/Back/contrast/accessibility, rotation/foreground and responsiveness; no fabricated performance numbers. API29 and current supported API separately recorded. Existing security/release prerequisites remain, no signed release action implicit.
3. Write three reports: git-qualification per AC refs/index/files/remotes; device-qualification actual device/visual/blocker ledger; request-contract-audit redacted methods/routes/fields and negative zero-request/one-dispatch proof. No hardware => explicitly incomplete release gate, not passed by JVM. Retain real repeated identical errors in evidence and include H1–H5 re-evaluation dispositions rather than inherited defect labels.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "create-real-git-fixtures",
    "title": "Create disposable current-server Git/bare remote fixture and honest runner",
    "blocked_by": [
      "mount-focused-git-host"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitServerFixture.kt",
      "native/android-app/scripts/run-git-workspace-journeys.sh",
      "native/android-app/scripts/git-workspace-fixture.mjs"
    ],
    "constraints": [
      "Only dedicated fixture/runner files writable; product server and07 journey class read-only/not required by fixture modes. No dependency installation, product repair or skipped prerequisite success.",
      "Complete stable fixture compile/protocol tests/current-server oracle smoke/review BEFORE completing this task; Q2 is forbidden as this prerequisite evidence because its journey is authored next."
    ],
    "acceptance": [
      "Runner uses isolated disposable repositories/worktrees/bare remote, current server binary + existing auth seed helper, valid authenticated profile, independent Git observation authority and exact runner arguments.",
      "Missing SDK/device/server/seed/fixture args fails nonzero; no assume/skip-success, no product server change or package install; test proxy can delay/drop acknowledgement after forwarding once."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "Run node native/android-app/scripts/git-workspace-fixture.mjs --self-test for protocol/CLI/path/negative prerequisite behavior using code created in this task; require no ADB or NativeGitWorkspaceJourneys dependency.",
      "Run node native/android-app/scripts/git-workspace-fixture.mjs --smoke-current-server --server-bin <current-binary> --seed-bin <current-seed-binary> --evidence-dir <disposable-dir>; verify real isolated authenticated server + Git/bare-remote oracle/proxy exactly-once smoke without Android journey.",
      "Obtain passing scoped fixture implementation review and evidence before qualify-live-git-journeys can start."
    ]
  },
  {
    "id": "qualify-live-git-journeys",
    "title": "Author actual active-root journeys for all ten acceptance criteria",
    "blocked_by": [
      "create-real-git-fixtures"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/NativeGitWorkspaceJourneys.kt"
    ],
    "constraints": [
      "Only NativeGitWorkspaceJourneys writable; fixture task already verified independently. Mandatory fixture args and current account required, missing device/server blocks not skip.",
      "Stop editor, compile the new instrumentation class then run actual Q2/Q3 smoke/behavior and obtain passing review BEFORE task completion; no deferred prerequisite check."
    ],
    "acceptance": [
      "Compose tests launch actual MainActivity, select authenticated profile/project, click Git and mutations through visible controls; directly constructed hidden state/controller calls do not substitute root reachability.",
      "All AC01\u2013AC10 journeys assert independent Git evidence; use real callbacks/delays/conflict/worktree/lease behavior and capture phone/tablet/accessibility state."
    ],
    "verification": [
      "& .\\native\\android-app\\gradlew.bat -p native/android-app :shared:compileKotlinJvm :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin",
      "Run Q2 with the now-existing NativeGitWorkspaceJourneys and required server/seed binaries on selected emulator; Q3 exact class with runner args gives real-root behavioral smoke, independent Q4/Q5 verifies Git state.",
      "Obtain passing source/journey review and record actual compile/tests/real smoke evidence before completion. Broad physical ARM64/API29/form-factor qualification still required by next report task, not claimed from emulator."
    ]
  },
  {
    "id": "qualify-git-failure-boundaries",
    "title": "Record integrated race, hardware and request-contract qualification",
    "blocked_by": [
      "qualify-live-git-journeys"
    ],
    "allowed_files": [
      "plans/261030-1617-android-focused-git-view/reports/git-qualification.md",
      "plans/261030-1617-android-focused-git-view/reports/device-qualification.md",
      "plans/261030-1617-android-focused-git-view/reports/request-contract-audit.md"
    ],
    "constraints": [
      "Verification/evidence only; no product fixes/unrelated docs. Current compiled implementation/journey from predecessors must stay unchanged during qualification.",
      "Run required checks and review at this stable evidence boundary; never replace hardware/current-server results with mocks, guessed pass counts or waivers."
    ],
    "acceptance": [
      "Every AC has exercised evidence or explicit blocker; slow callbacks/lost acknowledgements never replay mutation or populate another owner; secondary-root no-request limit and current wire audit recorded.",
      "Emulator, phone/tablet visual inspection, physical ARM64 and API29 gates truthful; unavailable hardware blocks release qualification without fake fallback."
    ],
    "verification": [
      "Run additional Q1 against final coherent source, Q2/Q3 on emulator and required physical ARM64/API29 coverage, Q4/Q5 independent Git and Q6 visual/accessibility inspection; retain exact command/exit/device/AC artifacts.",
      "Audit actual request log against operation inventory; zero secondary fetch/pull/resolve/POST operation and exactly-one forwarded mutation in drop-ack case; test failures/skips remain blockers.",
      "Passing scoped evidence/release-gate review required; missing hardware means qualification task blocked, not merely a report saying all complete. No source repair while verification active."
    ]
  }
]
```

- [x] <!-- evcrate-task:create-real-git-fixtures --> Create disposable current-server Git/bare remote fixture and honest runner
- [ ] <!-- evcrate-task:qualify-live-git-journeys --> Author actual active-root journeys for all ten acceptance criteria (open: connected qualification blocked on device/adb and W10)
- [x] <!-- evcrate-task:qualify-git-failure-boundaries --> Record integrated race, hardware and request-contract qualification

## Conflict prevention / transfers
Sequential owner waits for every predecessor evidence-complete result (compile/scoped tests/real smoke/passing review), not implementation terminal alone. Any repair in another owner's source is an explicit ordered transfer/task-contract revision, never concurrent implicit write authority. Preserve unrelated plans/user edits.

## Compile-dependency closure (planned, not observed)
Fixture NativeGitServerFixture/Node/shell compile and self-test against existing source only. Its two fixture verification modes execute before and without NativeGitWorkspaceJourneys; the normal journey runner is not fixture prerequisite evidence. The next task owns/compiles/runs that class. Final evidence task consumes unchanged compiled predecessors and performs additional hardware/AC qualification. No forward verification dependency.

## Acceptance and future verification
Fixture task requires scoped compile + same-task --self-test/--smoke-current-server + passing review; Q2 waits for journey task. Future Q2 requires both --server-bin and --seed-bin. Run Q1/Q2/Q3/Q4/Q5/Q6 exactly as matrix, not during planning. Q3 direct Gradle command requires same runner args/environment produced by Q2; naked command without fixture must fail, not skip. No full-suite result invented from filtered class.

## Risks, security, failure and rollback
Fixtures are destructive only in explicitly owned temp directories. Never expose no-auth/test HTTP to LAN, never leak token/remote URL/raw messages into reports. Request proxy is test-only not a production service. Current-server auth seed is existing code read-only. Hardware or binary absence blocks qualification honestly. Rollback app only, leave real user Git history untouched.

## Next / unresolved
Proceed only through declared dependencies. No unresolved product choice; actual compile/runtime/device evidence remains pending. Planning authoring is not implementation approval or a passing qualification result.
