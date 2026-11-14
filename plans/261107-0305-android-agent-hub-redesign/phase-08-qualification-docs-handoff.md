# P08 — Qualify coherent app and publish truthful implementation docs

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/local-api-smoke.md](reports/local-api-smoke.md) | [acceptance-matrix.md](acceptance-matrix.md) | [execution-ownership.md](execution-ownership.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 20h.
- Owner: Qualification08 (single integration/check owner; docs finalizer serialized). Parallelization group: `S-4`.
- Prerequisite task IDs: `integrate-retained-lifetimes`
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
Planning performed no Android suite/device exercise. Parent observed current-source REST and WS bytes on own 4804, but corrected WS close failed1006/cleanfalse; original bad plaintext-content oracle remains distinct. Owned API4804 stopped and fixture removed; Termius4803 unchanged. ADB exists under ANDROID_HOME despite not on PATH; zero ready devices. Windows OPAQUE known-folder storage is not isolated by XDG_CONFIG_HOME; preexisting setup was loaded unchanged, not a fresh secret-isolation proof.

## Requirements
Functional: prove all acceptance matrix rows end-to-end through real entry/runtime, not only compiled isolated views. Run coherent automated, live disposable API/PTY/files/Git and Android OS/device/visual gates in sequence, then update docs/README/changelog after smoke results. Demonstrate two-server/account isolation, stale notification routing, dirty alias edits+native undo, guarded terminal lifetime, real socket retirement and current failure handling.
Nonfunctional: one suite owner, no source repair during validation-only work, no secret output/user workspace mutations, preserve original failure evidence. Physical ARM64/API29/API33+, phone/tablet/landscape/IME/font-scale/TalkBack and human review required. Missing ready device blocks release acceptance, not plan design. No release/signing/install/dependency operation implied by planning; future qualification needs implementation execution authority.

## Architecture and ports
P01–P07 slice owners author production/regression source but run no checks; coordinator already completed each stopped-wave applicable compile/focused tests/separate meaningful task-local smoke/independent review before predecessor completion. Qualification08 now repeats full integrated suites once after all implementation tasks evidence-backed complete, not as their first or deferred completion gate. Source-inspected commands below do not inherit historical passes. Real fixtures use disposable repos/config/workspace and loopback with asserted fixture identity before mutation. Preserve Windows OPAQUE setup: XDG_CONFIG_HOME does not isolate dirs::config_dir known-folder storage; full crypto isolation requires isolated OS/container identity, not invented APPDATA override. Termius4803 is never a fixture/kill target.
Use existing scripts/Gradle wrappers, no task-state/runtime/scheduler addition. Qualification reports record exact command, environment/server revision, device model/API/ABI, result/exit, per-scenario observations, failures/skips/blockers and owned cleanup. Failures return to the appropriate implementation slice under explicit repair scope, then the same check owner reruns affected gates after writers stop. Documentation finalizer runs only after qualification barrier; no full implementation/release success while device or WS gates remain unresolved.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- `plans/261107-0305-android-agent-hub-redesign/reports/integrated-automated-qualification.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/live-api-qualification.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/device-visual-qualification.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/implementation-handoff.md`

### Modify (existing files)
- `native/android-app/README.md`
- `docs/architecture/android-native-client.md`
- `docs/android-native-acceptance.md`
- `docs/CHANGELOG.md`
- `docs/project-roadmap.md`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/qualify-coherent-automated-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/qualify-disposable-runtime-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/qualify-device-visual-evidence.json`
- `plans/261107-0305-android-agent-hub-redesign/reports/publish-implementation-docs-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### qualify-coherent-automated
1. Confirm all implementation tasks already evidence-backed complete at their own stopped-wave barriers (not merely workers terminal) and existing toolchain prerequisites. Read installed test principles; keep scoped prior evidence distinct from this full integrated release run.
2. From repository root run pnpm android:test, pnpm android:test:app and pnpm android:assembleDebug serially. Run .\native\android-app\gradlew.bat -p native/android-app :androidApp:compileDebugAndroidTestKotlin to compile the actual instrumentation sources.
3. Run node native/android-app/scripts/git-workspace-fixture.mjs --self-test for independent oracle coverage. Inspect exact public contracts/source assertions for no terminal DELETE caller, no terminal WS epoch fields and no implicit filesystem selectors; treat grep as static evidence only.
4. Record exact failures/counts/skips/exit codes, not historical 1168 or a fabricated coverage target. No automatic repair, weakened tests or suppression during qualification.
5. Before completing this verification task, separately launch the actual built MainActivity on a ready device and observe secure entry/capability failure or owned-fixture Hub navigation; record meaningful basic app smoke distinct from unit-suite output, and collect passing independent review. Do not wait for dependent live/device task evidence; missing required device blocks this gate.

### qualify-disposable-runtime
1. Create isolated disposable fixture/config/repos and preflight crypto-storage isolation; source cargo command uses explicit absolute manifest/config and --host 127.0.0.1 --port 4804 --no-auth. A second owned server uses 4805 with distinct workspace/account identities; never mutate Termius4803. Auth/TLS/MFA scenarios require actual supported authenticated fixture and independent store, not no-auth masquerading as auth.
2. Assert health/auth/workspace/project fixture identity before writes. Exercise explicit workspace/project/worktree list/stat/read, REST text-header/binary identity, WS base64 read identity, mark/unmark, watch/search/replace, CAS conflict and upload/encrypted/media purpose/origin isolation through current clients.
3. Create disposable PTYs by distinct explicit intents, record original epoch+exact incarnation; verify actual stream/output/input/resize bytes, Close View sends no mutation and reopen same instance. Test guarded POST success/202-not-exit, refusal/409, missing protocol, unknown-create dropped response and original-epoch retention; no DELETE cleanup.
4. Retire/reconnect real socket/server and replace owner generations; stale filesystem/terminal/notification callbacks cannot dispatch into other server/account/workspace epoch. Preserve corrected baseline WS1006 failure; require clean expected retirement where contract permits or explicit current unavailable/error handling, never label close failure pass or suppress callback.
5. Use existing Git fixture current-server mode with explicit verified binaries/evidence directory (CLI below); oracle checks staged/unstaged commit, worktree dirtiness, CAS/lease refusal and read-only conflict handoff only in disposable repos. Capture actual safe Git outcomes, no user remote push.
6. Stop only owned servers/PTYs through supported guarded cleanup, verify owned ports released and remove only owned fixtures after evidence; record incomplete remote cleanup honestly. Do not delete uncertain intent records to make test green.

### qualify-device-visual
1. Use PowerShell & "$env:ANDROID_HOME/platform-tools/adb.exe" devices; select explicit serial, do not rely on PATH. Current observation is zero ready devices; absent hardware is BLOCKED_PENDING_DEVICE, not missing SDK/ADB. Do not install/start emulator/hardware as part of planning.
2. For ready device use explicit owned loopback reverse mappings: & "$env:ANDROID_HOME/platform-tools/adb.exe" -s <serial> reverse tcp:4804 tcp:4804 (and4805), then ANDROID_SERIAL=<serial> and .\native\android-app\gradlew.bat -p native/android-app :androidApp:connectedDebugAndroidTest. Existing per-class runner argument -Pandroid.testInstrumentationRunnerArguments.class selects authored AgentHubRootJourneys, RetainedWorkspaceLifecycleTest, NativeEditorExplorerJourneys, NativeTerminalAgentsJourneys, NativeGitWorkspaceJourneys and AndroidNotificationDeliveryTest as applicable; root must launch MainActivity.
3. Record physical ARM64/API29 and API33+ OS permission/channel paths, denied/blocked inbox, generic lockscreen, Cognito and stale/duplicate click pre/post dirty-consent checks. A x86_64 emulator/unit suite does not replace physical ARM64 release gate.
4. Capture actual phone/tablet, compact/split/fold-width, portrait/short landscape, IME visible, system font scale/terminal font independent. Measure usable viewport/chrome/accessory/line height and direct controls, no fixed row guarantee; verify >=48dp hit areas, contrast and TalkBack headings/tabs/focus.
5. Demonstrate normal navigation/rotation/background retains PTYs and in-memory dirty+undo, hidden input sends zero bytes, process recreation preserves only unresolved create nonsecret identity and blocks replacement. Do not claim crashed draft/undo restoration or always-on notifications.
6. In actual MainActivity repeat canonical native lifetime acceptance: edit A/open B/close A tab and workspace/B undo+save, reverse close order, final dirty alias save/discard/cancel, close/reload during in-flight save, all-alias tier replacement and late old-view detach; verify surviving input/view-state/undo and exactly-once final disposal. Retirement retains recoverable dirty state in process, never a crashed-draft claim.
7. Human review actual captured MainActivity journeys and failure states; record identity/date/captures and any usability block. Remove only owned reverse mappings. If no device, finish other reachable reporting, keep this gate and docs-finalization dependent acceptance blocked.

### publish-implementation-docs
1. After smoke/device/human gates settle, update active native README and exact Android architecture sections for actual Hub root, selected config, explicit FS targets/canonical docs, guarded PTY lifecycle and notification/lifecycle boundaries. Do not claim intended plan is already implemented.
2. Update acceptance ledger with new command/device evidence and retained historical failures; replace stale absent-ADB explanation with actual device prerequisites. Changelog/roadmap describe exercised change and remaining release blockers only.
3. Record clean cutover: no unsafe Android DELETE API/shim/dual selectors; unrelated dormant code stays unmounted. Remove only implementation-owned throwaway scaffolds; preserve permanent fixtures and user files.
4. Single finalizer collects terminal slice/review/test/doc evidence, actual ownership transfers, known WS/device risks and rollback instructions. No automatic task hydration/state/Git/release/signing action; planning approval is not implementation approval.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "qualify-coherent-automated",
    "title": "Run coherent native build and regression suites",
    "blocked_by": [
      "integrate-retained-lifetimes"
    ],
    "allowed_files": [
      "plans/261107-0305-android-agent-hub-redesign/reports/integrated-automated-qualification.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/qualify-coherent-automated-evidence.json"
    ],
    "constraints": [
      "Verification-only task: report writes only; no source edits or mid-flight parallel suites.",
      "No dependency installs, signing, Git mutation or task hydration authorized by this plan text."
    ],
    "acceptance": [
      "Integrated debug build/shared JVM/app unit/instrumentation-source compilation and independent oracle have current evidence.",
      "Any failed/blocked suite remains failed/blocked with scoped repair handoff, never relabeled passed."
    ],
    "verification": [
      "Before this task completes, coordinator records its own applicable compile/focused checks, separate meaningful smoke and passing independent review in this task report and plans/261107-0305-android-agent-hub-redesign/reports/qualify-coherent-automated-evidence.json; use current helper evidence schema, never a future dependent task as prerequisite evidence.",
      "Separate basic built-app MainActivity launch/navigation smoke at this gate, not test-suite output; existing focused component smokes already completed P01-P07. Ready-device absence blocks required smoke, not a pass.",
      "pnpm android:test",
      "pnpm android:test:app",
      "pnpm android:assembleDebug",
      ".\\native\\android-app\\gradlew.bat -p native/android-app :androidApp:compileDebugAndroidTestKotlin",
      "node native/android-app/scripts/git-workspace-fixture.mjs --self-test"
    ]
  },
  {
    "id": "qualify-disposable-runtime",
    "title": "Exercise real disposable API, terminal, files and safe Git",
    "blocked_by": [
      "qualify-coherent-automated"
    ],
    "allowed_files": [
      "plans/261107-0305-android-agent-hub-redesign/reports/live-api-qualification.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/qualify-disposable-runtime-evidence.json"
    ],
    "constraints": [
      "Verification-only report writes; disposable external fixtures only under explicitly scoped qualification execution.",
      "Preexisting Windows OPAQUE setup must remain unchanged; use isolated OS/container identity if full secret isolation is required."
    ],
    "acceptance": [
      "Real current API/PTY/FS/Git behavior and two-server owner isolation have per-scenario evidence, including actual bytes and unsafe negative paths.",
      "WS read success and close failure remain separate; retirement/reconnect behavior is qualified honestly.",
      "No user tunnel/config/repo/secret setup changed; disposable cleanup recorded."
    ],
    "verification": [
      "Before this task completes, coordinator records its own applicable compile/focused checks, separate meaningful smoke and passing independent review in this task report and plans/261107-0305-android-agent-hub-redesign/reports/qualify-disposable-runtime-evidence.json; use current helper evidence schema, never a future dependent task as prerequisite evidence.",
      "Use actual current clients with owned servers/PTys/files/Git to perform live state transitions and capture bytes; this task owns its real runtime smoke and independent review without waiting for qualify-device-visual.",
      "Source startup pattern: cargo run -j 1 --manifest-path G:/ws/sharing/dam-hopper/server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4804 --no-auth --config <absolute disposable config> (run from disposable CWD; second owned instance4805).",
      "node native/android-app/scripts/git-workspace-fixture.mjs --smoke-current-server --server-bin <verified absolute server executable> --seed-bin <verified absolute seed executable> --evidence-dir <owned evidence directory>",
      "Record concrete substituted commands and real request/response/WS close observations in live report; placeholders are preparation requirements, not claimed execution."
    ]
  },
  {
    "id": "qualify-device-visual",
    "title": "Qualify actual MainActivity, Android OS behavior and human UX",
    "blocked_by": [
      "qualify-disposable-runtime"
    ],
    "allowed_files": [
      "plans/261107-0305-android-agent-hub-redesign/reports/device-visual-qualification.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/qualify-device-visual-evidence.json"
    ],
    "constraints": [
      "Verification-only report writes; no source edits or synthetic physical-device pass.",
      "Never expose no-auth server to LAN; device access via owned adb reverse or authenticated HTTPS fixture."
    ],
    "acceptance": [
      "Real MainActivity/device/OS and human phone/tablet/IME/TalkBack evidence covers acceptance matrix; no unit/emulator substitute.",
      "Unconnected device or missing API/ABI scenario is explicitly blocked release acceptance; draft crash recovery and continuous background delivery not advertised."
    ],
    "verification": [
      "Before this task completes, coordinator records its own applicable compile/focused checks, separate meaningful smoke and passing independent review in this task report and plans/261107-0305-android-agent-hub-redesign/reports/qualify-device-visual-evidence.json; use current helper evidence schema, never a future dependent task as prerequisite evidence.",
      "Run actual MainActivity native-document lifetime regressions, OS/IME/accessibility journeys and separate human-driven smoke; retain device/API/ABI blockers and collect independent review before this task completes.",
      "PowerShell: & \"$env:ANDROID_HOME/platform-tools/adb.exe\" devices",
      "PowerShell: & \"$env:ANDROID_HOME/platform-tools/adb.exe\" -s <serial> reverse tcp:4804 tcp:4804",
      ".\\native\\android-app\\gradlew.bat -p native/android-app :androidApp:connectedDebugAndroidTest",
      "Record explicit serial, actual instrumentation class arguments, fixture URLs, model/API/ABI and captured visual/manual outcomes."
    ]
  },
  {
    "id": "publish-implementation-docs",
    "title": "Publish qualified architecture, acceptance and native handoff",
    "blocked_by": [
      "qualify-device-visual"
    ],
    "allowed_files": [
      "native/android-app/README.md",
      "docs/architecture/android-native-client.md",
      "docs/android-native-acceptance.md",
      "docs/CHANGELOG.md",
      "docs/project-roadmap.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/implementation-handoff.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/publish-implementation-docs-evidence.json"
    ],
    "constraints": [
      "Docs-only finalization after smoke; current planning does not edit product docs.",
      "If any required device/live gate is blocked, do not mark end-to-end implementation/release accepted."
    ],
    "acceptance": [
      "Docs/README/changelog match exercised active app and evidence, including honest device/WS/crypto isolation caveats.",
      "One final implementation handoff distinguishes complete acceptance from blocked release gates; no old-plan edits or fictitious approval."
    ],
    "verification": [
      "Before this task completes, coordinator records its own applicable compile/focused checks, separate meaningful smoke and passing independent review in this task report and plans/261107-0305-android-agent-hub-redesign/reports/publish-implementation-docs-evidence.json; use current helper evidence schema, never a future dependent task as prerequisite evidence.",
      "Docs compile is not_applicable with documented reason; perform focused link/claim checks, separately walk published instructions against existing qualified app/report artifacts as docs smoke, and collect independent docs review before completion; tests are not silently waived.",
      "Review Markdown links and actual docs against qualified runtime reports after all code writers finish.",
      "Independent implementation review must have no unresolved severe correctness/security finding before completion."
    ]
  }
]
```

- [ ] <!-- evcrate-task:qualify-coherent-automated --> Run coherent native build and regression suites
- [ ] <!-- evcrate-task:qualify-disposable-runtime --> Exercise real disposable API, terminal, files and safe Git
- [ ] <!-- evcrate-task:qualify-device-visual --> Qualify actual MainActivity, Android OS behavior and human UX
- [ ] <!-- evcrate-task:publish-implementation-docs --> Publish qualified architecture, acceptance and native handoff

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: historical tests and source compile do not prove redesign; enforce real entry, OS and human evidence. Safety: loopback-only no-auth, disposable Git roots, exact owner cleanup, OPAQUE setup preservation. Failure: observed WS1006 remains a baseline failure until scoped qualification resolves/characterizes it; no ignored close errors. Rollback: client-owned changes in reverse DAG, preserve remote PTYs/unknown intent/dirty buffers/config; no resets/token rotation/secret deletion or other-plan modifications. Missing ready devices block release qualification, not this completed design.

## Downstream barrier
Coordinator independently reviews each P08 task at its own stop/check/smoke/review/evidence-completion barrier before the next task; verification tasks do not depend on future reports for their own acceptance. Documentation finalizer follows all full release gates. No Git/sign/release implied. F1/F2 targeted follow-up is complete and both High findings resolved by design; user product validation confirms existing defaults, not implementation success.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
