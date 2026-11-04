# P08 — Integrated server/browser/authenticated-app qualification

Priority P2 · Status pending · Effort 20h (author 8h + execution 8h + human review 4h).
Owner QualificationOwner; HumanReviewer owns final visual decision sequentially. No source writer live.

## Context, prerequisites and parallelization
Read [acceptance matrix](acceptance-matrix.md), [ownership](execution-ownership.md), [brainstorm rows 1–7](../reports/brainstorm-261104-1231-os-session-management-and-interactions.md#acceptance-criteria-and-validation), P02–P07 exact checks, repository `docs/testing.md`, installed test principles and real E2E fixture/config before running anything.
Entry `integrate-close-input-retirement` terminal, every source branch handed off, future implementation/check authority granted. Current planning author runs no product checks. Qualification is one sequential owner, one coherent change set and serial real-app worker. P08 authoring task creates meaningful tests; execution task does not grant repairs. Failures return to integration coordinator with exact scope and a new serial ownership handoff; never patch while tests run.

## Requirements and evidence architecture
Use existing Vitest/node/browser/Playwright conventions, authenticated isolated container services and supported profile storage provisioning. No new runner, global test bypass, fake auth success or blanket no-auth application. Local server unit doubles can force races; only real PTY/browser checks establish process/input/continuity claims. Human full-app review remains REQUIRED separately from automated checks.

### Task `author-integrated-qualification`
**Modify:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`, `packages/ui/e2e/os-recipes/os-recipes.spec.ts`, `packages/ui/e2e/os-cutover/os-cutover.spec.ts`. **Create:** `packages/ui/e2e/os-session-management/os-session-management.spec.ts`, `packages/ui/e2e/fixtures/terminal-session-observation.ts`. **Delete:** no files; replace obsolete native-select locator/default/DOM-marker-only assertions inside existing specs. QualificationOwner only. New spec location is deliberately CREATE and follows existing `e2e/**.spec.ts` Playwright testMatch; do not present it as existing evidence.

1. Reuse `application-fixture.ts` authenticatedPage/appServices, existing isolated service lifecycle/data seeding and capture helper. Provision second isolated authenticated server/profile with existing `startApplicationServices` for equal raw-ID collision tests; capture generations explicitly. Verify safe local origins/owned databases/processes, installed container/browser prerequisites, supported login/storage mechanism; never print/persist credentials in reports. No auth bypass if fixtures unavailable: gate BLOCKED.
2. Correct existing lifecycle tests: use actual Radix role/option interactions instead of native select; stop forcing obsolete tile/float default. Establish explicit initial state where needed then assert new-window float preference separately. Remove DOM attribute marker as sole continuity proof; use actual xterm lifecycle token from real `new Terminal`, actual outgoing attach and incoming replay frame counts plus actual reset diagnostic. A DOM marker may remain supporting evidence only.
3. New bounded observation fixture reads existing diagnostic snapshot/storage and browser WebSocket events without recording terminal content/auth URLs. For a known synthetic target capture initial created/attach/replay completion and monotonic live-output sentinel, then snapshot counters. Assert baseline exists and diagnostics have not truncated/reset; missing data is failure/blocked, never zero. Run each tile/float/maximize/restore/minimize/tab/desktop/Open-beside/move/double-click transition while real output is streaming; assert SAME token, no create/dispose and delta attach/replay/reset all ZERO. Also assert backend epoch/incarnation unchanged. Actual reconnect is separate and may attach/replay only after owner revalidation.
4. Separate Close/reopen: Cancel no effect, Close disposes renderer but exact backend/history/Background survive; reopen may new token/attach/replay, backend create ZERO. Live End202 keeps view until exact exited; real restartPending alive:false uses three choices, End200 exact cancellation completes immediately/history retained. Held/lost responses test origin: pending completes only matching restartCancelled marker, ordinary exited/absence stays unknown; live needs exact exit. Cover both cancellation/reservation orders, stale queue/timer no-op, admitted spawn protected, later same-ID explicit create and normal uncancelled respawn publication. Controlled domain/router races +real app endpoint flows, not fake202 signal proof. Exact max-u64 inventory End enabled despite unsafe legacy numeric; missing/malformed exact never fallback, safe-number disagreement fails closed; numeric agent/port/replay unsafe proof unavailable without blocking exact inventory End. Old-headerless server remains read-only.
   - Include P02's deterministic held-target-validation failure case: cancel before reservation, release validation with target-loss/non-target error, verify no stale tombstone/persistence/workflow effect and retained exact cancellation projection. Pair with pending-origin lost-response reconciliation; ordinary uncancelled validation failure remains covered. Real app flows complement, not replace, this controlled concurrency oracle.
5. Physical PTY-byte oracle (Linux isolated test image): verify `sh`, `stty`, `od` prerequisites, launch synthetic `sh -c 'stty raw -echo; od -An -v -tx1 -w1'` terminal. Send allowed sentinel bytes and prove their exact hex output before/after each blocked interaction so a stopped/buffered process cannot vacuously pass. Through Playwright physical keyboard/pointer paths exercise Target selector, Window List, Notification Center, Palette, Profiles, Settings, nested Select/context menu, dirty confirmation, modifier shortcuts, Escape and backdrop clicks. Assert consumed key/printable/Escape bytes ABSENT between sentinels; allowed input resumes afterward. Modal background click must not activate terminal. Cognito covers every named surface, paste/key/IME boundary where supported and aborts active drag/resize without post-activation geometry writes. Synthetic pure arbiter calls alone cannot establish H2.
6. Review full app: exact losslessly joined eligible metadata opens readonly tuple; unsafe numeric agent association or exact Status disagreement unavailable while corresponding inventory End usable. Safe equality positive case; no coercion/protocol expansion. Disabled/unsupported/initializing/missing root/baseline explicit. Held Status/files awaits with visible/minimized/other-desktop retirement/disconnect/config-disable: viewer gone, protected queries/tuple purged, late discard. Close one of two same-owner identities; sibling cache/reads remain (actual request counts/data).
7. Recipe full app: actually import inert JSON, select source/server/project, author/change/confirm commands, preview all included/excluded windows and save/export; verify source layout/ownership unchanged. Cover sole/mixed/duplicate-name/worktree/offline/missing-profile/no-context/fleet-only/different-desktop/delayed-discovery states. Never claim terminal-only executor restored apps/topology. Retain explicit AC8/F1 limitation text.
8. At both 1440x900 and 1024x640 run authenticated `/` or `/os`, fresh full-viewport captures, app zoom 100% and 125%, viewport shrink->widen then restored geometry, repeated open/close/mode/drag cycles (at least three), same IDs/profiles, reconnect/retirement and Cognito. Verify controls reachable and source windows unmutated. Cover every matrix row; no component-only substitution or cropped element screenshot qualification.
9. Preserve historical evidence with NEW sibling case folders listed below. Each case has exactly ONE dedicated capture test/evidence session that visits every required state at every viewport/zoom and finalizes ONCE; other functional tests must not publish into that case. Existing helper finalization replaces the manifest, so separate sessions cannot accumulate a receipt. Keep the existing helper unchanged. For each stem below retain `-fhd`, `-compact`, `-fhd-zoom125`, `-compact-zoom125` checkpoints; generic four names apply to the base state. Also capture one primary `screenshot.png` per case. The execution allowlist enumerates every PNG literally; no overwrites of a different state or predecessor evidence.

| New case folder under `packages/ui/e2e/` | Base state using generic four names | Additional checkpoint stems, each at all four size/zoom combinations | Sole capture-session owner |
|---|---|---|---|
| `os-session-management-lifecycle` | Live placement | `cascade`, `titlebar` | Dedicated capture test in `os-lifecycle.spec.ts` |
| `os-session-management-recipes` | Source/target capture form | `exclusions` | Dedicated capture test in `os-recipes.spec.ts` |
| `os-session-management-cutover` | Hub inventory | `adjacent`, `close-prompt` | Dedicated capture test in `os-cutover.spec.ts` |
| `os-session-management` | Eligible Review | `target-selector`, `window-list`, `notifications`, `palette`, `profiles`, `settings`, `review-unavailable` | Dedicated capture test in `os-session-management.spec.ts` |

Together the cases retain 64 distinct state/size/zoom checkpoints plus four primary images. Every case manifest must enumerate its complete matrix, not only the last test's images. Human receipt remains `qualification/human-review.md`; generated pending reviews never imply approval.

### Task `execute-integrated-qualification`
**Source modify/create/delete:** none. **Create/overwrite evidence only:** literal files in task allowlist below, generated runner directories only as declared. QualificationOwner after test author terminal. Product repairs need separate scoped handoff; first failures retained.

1. Resolve environment/check permissions and safety; inspect actual scripts for destructive setup and use isolated owned services/ports. No dependency installation or developer auth changes under this task. If test images need build, record prerequisite and require authorized environment preparation; no silent network setup. Test fixture owns only its resources and must report disposal result.
2. Execute P02–P07 focused commands once against integrated tree, then required wider gates sequentially: `cargo test --manifest-path server/Cargo.toml`; `pnpm --filter @dam-hopper/ui build`; `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`; `pnpm --filter @dam-hopper/ui test:e2e:typecheck`; `pnpm lint`; `pnpm build`; `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle/os-lifecycle.spec.ts os-recipes/os-recipes.spec.ts os-cutover/os-cutover.spec.ts os-session-management/os-session-management.spec.ts`. Package scripts/config/capture policy were located, but no command result exists today. Explicit capture enable prevents CI default from silently skipping evidence. Do not run `pnpm check` as a redundant second full suite unless coordinator selects it instead of equivalent individual required gates.
3. Run authenticated matrix and actual HTTP/CORS with original exact/state inventory metadata from BOTH projections. Domain/API proves both cancellation admission orderings, normal respawn publication, stale wake/no signal, marker lifetime and same-ID later create; client/app proves 200-vs202 origin-specific completion/loss and max-u64 eligibility/malformed-no-fallback/unsafe downstream refusal. Portal/focus +real process/input/counters remain required. Record exact environment/commands/status/results/initial failures/changed-condition retries/skips/blocks; no inferred counts or waived failure.
4. Preserve fresh captures/manifests from existing helper; sanitize logs/artifacts. Write only the NEW literal evidence destinations in the task allowlist. Each case's sole evidence session publishes every state/size/zoom checkpoint in the matrix above, one `screenshot.png`, one complete `evidence.json` and helper-generated PENDING `review.md`. Before human review, compare each manifest's checkpoint set and files against the required matrix; missing/duplicate/overwritten state evidence blocks the packet. Write runtime report and human-review input index linking actual fresh captures. Old case artifacts remain unchanged. Helper staging is generated `packages/ui/.e2e-staging`, cleaned by owned run lifecycle; no fabricated screenshot/hash/review fields.
5. Reconcile each matrix row with actual artifact/check, including headerless read-only, exact full-u64 vsunsafe downstream, pending cancellation/loss, same-ID profiles, normal respawn and reconnect. Cleanup owned PTYs/services/DBs/temporary hooks only; preserve first failures/user work. Minimal justified diagnostics remain; no throwaway globals/scripts. Cleanup failure BLOCKED.

### Task `human-full-app-visual-review`
**Modify source/tests:** none. **Create:** `qualification/human-review.md` under selected plan. HumanReviewer only after automated/runtime evidence terminal; not a model-generated substitute for a human. QualificationOwner may prepare links but cannot self-mark this human gate passed.

1. Actual human reviews fresh uncropped authenticated full-app captures AND interactive behavior at both sizes/zoom, repeat and Cognito. Inspect owner labels, live-vs-pending Close/End explanations, 202 awaiting exit vs200 restart-cancelled status/lost-outcome reasons, valid exact identity vsunsafe downstream availability, Review, Recipe exclusions/selectors, portal focus, clipping/cascade/title controls. Keep the 64+4 image matrix/one-session-per-case rule unchanged; interactive pending/live checks do not silently replace named capture states.
2. Record reviewer identity/date, exact capture provenance/checkpoints, accepted/failed rows and any required correction. Automated visual similarity, screenshots existing on disk or assistant review is not human acceptance. If unavailable retain pending and block production qualification/handoff completion; do not invent consent or request unrelated product choices.
3. Carry predecessor H1/H2 as addressed ONLY for explicitly exercised integrated surfaces with real live evidence; retain other unexercised historical gates. AC8/F1 remain unresolved/out-of-scope. Human approval of these seven concerns is not retroactive certification of all prior OS apps or release receipt.

## Consumer-visible success and checks
Every acceptance row 1–7 + guard has current implementation and actual observed results, no severe unresolved failure; authenticated input/process/resource checks pass; actual human review recorded. Planning parser success is separate and cannot satisfy any of these runtime conditions.

## Failure, rollback, security and resources
Missing authenticated access, container daemon, browser, real capture metadata or human reviewer -> precise BLOCKED/PARTIAL gate, not no-auth/component substitute. Never broaden remediation into Recipe executor/F1 or unrelated predecessor defects; report them honestly. Repair authorized issues through one IntegrationOwner then rerun affected checks plus required regressions, preserving failure history. No production mutation, credentials in artifacts, unowned service shutdown or destructive Git.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "author-integrated-qualification",
    "title": "Author meaningful real-app guard, continuity and input qualification",
    "blocked_by": [
      "integrate-close-input-retirement"
    ],
    "allowed_files": [
      "packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts",
      "packages/ui/e2e/os-recipes/os-recipes.spec.ts",
      "packages/ui/e2e/os-cutover/os-cutover.spec.ts",
      "packages/ui/e2e/os-session-management/os-session-management.spec.ts",
      "packages/ui/e2e/fixtures/terminal-session-observation.ts"
    ],
    "constraints": [
      "QualificationOwner only after all source handoffs.",
      "Use authenticated real app and actual counters/PTY bytes; replace obsolete assertions, no wiring-only tests."
    ],
    "acceptance": [
      "All seven rows plus V2/V3 guard races, normal respawn and exact/downstream boundary cases have meaningful lowest-layer and real-app oracles.",
      "Real live/pending 202/200 and loss-origin scenarios preserve existing complete capture matrix and sole-session manifests."
    ],
    "verification": [
      "Inspect actual test oracles against acceptance matrix; then execute-integrated-qualification runs exact commands/scenarios, not during authoring."
    ]
  },
  {
    "id": "execute-integrated-qualification",
    "title": "Run integrated required gates and authenticated full-app matrix",
    "blocked_by": [
      "author-integrated-qualification"
    ],
    "allowed_files": [
      "plans/261104-1529-os-session-management-and-interactions/qualification/runtime.md",
      "plans/261104-1529-os-session-management-and-interactions/qualification/capture-index.md",
      "packages/ui/test-results",
      "packages/ui/.e2e-staging",
      "packages/ui/e2e/os-session-management-lifecycle/screenshot.png",
      "packages/ui/e2e/os-session-management-lifecycle/fhd.png",
      "packages/ui/e2e/os-session-management-lifecycle/compact.png",
      "packages/ui/e2e/os-session-management-lifecycle/fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/compact-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/cascade-fhd.png",
      "packages/ui/e2e/os-session-management-lifecycle/cascade-compact.png",
      "packages/ui/e2e/os-session-management-lifecycle/cascade-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/cascade-compact-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/titlebar-fhd.png",
      "packages/ui/e2e/os-session-management-lifecycle/titlebar-compact.png",
      "packages/ui/e2e/os-session-management-lifecycle/titlebar-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/titlebar-compact-zoom125.png",
      "packages/ui/e2e/os-session-management-lifecycle/evidence.json",
      "packages/ui/e2e/os-session-management-lifecycle/review.md",
      "packages/ui/e2e/os-session-management-recipes/screenshot.png",
      "packages/ui/e2e/os-session-management-recipes/fhd.png",
      "packages/ui/e2e/os-session-management-recipes/compact.png",
      "packages/ui/e2e/os-session-management-recipes/fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-recipes/compact-zoom125.png",
      "packages/ui/e2e/os-session-management-recipes/exclusions-fhd.png",
      "packages/ui/e2e/os-session-management-recipes/exclusions-compact.png",
      "packages/ui/e2e/os-session-management-recipes/exclusions-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-recipes/exclusions-compact-zoom125.png",
      "packages/ui/e2e/os-session-management-recipes/evidence.json",
      "packages/ui/e2e/os-session-management-recipes/review.md",
      "packages/ui/e2e/os-session-management-cutover/screenshot.png",
      "packages/ui/e2e/os-session-management-cutover/fhd.png",
      "packages/ui/e2e/os-session-management-cutover/compact.png",
      "packages/ui/e2e/os-session-management-cutover/fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/compact-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/adjacent-fhd.png",
      "packages/ui/e2e/os-session-management-cutover/adjacent-compact.png",
      "packages/ui/e2e/os-session-management-cutover/adjacent-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/adjacent-compact-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/close-prompt-fhd.png",
      "packages/ui/e2e/os-session-management-cutover/close-prompt-compact.png",
      "packages/ui/e2e/os-session-management-cutover/close-prompt-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/close-prompt-compact-zoom125.png",
      "packages/ui/e2e/os-session-management-cutover/evidence.json",
      "packages/ui/e2e/os-session-management-cutover/review.md",
      "packages/ui/e2e/os-session-management/screenshot.png",
      "packages/ui/e2e/os-session-management/fhd.png",
      "packages/ui/e2e/os-session-management/compact.png",
      "packages/ui/e2e/os-session-management/fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/compact-zoom125.png",
      "packages/ui/e2e/os-session-management/target-selector-fhd.png",
      "packages/ui/e2e/os-session-management/target-selector-compact.png",
      "packages/ui/e2e/os-session-management/target-selector-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/target-selector-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/window-list-fhd.png",
      "packages/ui/e2e/os-session-management/window-list-compact.png",
      "packages/ui/e2e/os-session-management/window-list-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/window-list-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/notifications-fhd.png",
      "packages/ui/e2e/os-session-management/notifications-compact.png",
      "packages/ui/e2e/os-session-management/notifications-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/notifications-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/palette-fhd.png",
      "packages/ui/e2e/os-session-management/palette-compact.png",
      "packages/ui/e2e/os-session-management/palette-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/palette-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/profiles-fhd.png",
      "packages/ui/e2e/os-session-management/profiles-compact.png",
      "packages/ui/e2e/os-session-management/profiles-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/profiles-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/settings-fhd.png",
      "packages/ui/e2e/os-session-management/settings-compact.png",
      "packages/ui/e2e/os-session-management/settings-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/settings-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/review-unavailable-fhd.png",
      "packages/ui/e2e/os-session-management/review-unavailable-compact.png",
      "packages/ui/e2e/os-session-management/review-unavailable-fhd-zoom125.png",
      "packages/ui/e2e/os-session-management/review-unavailable-compact-zoom125.png",
      "packages/ui/e2e/os-session-management/evidence.json",
      "packages/ui/e2e/os-session-management/review.md"
    ],
    "constraints": [
      "QualificationOwner only; source/test repair requires separate serialized handoff.",
      "Generated test-results and .e2e-staging directories are owned runner output only, not source directory permissions; preserve old capture case folders.",
      "One evidence session per case publishes the entire explicit state/size/zoom matrix; missing or overwritten checkpoints block human review.",
      "No auth bypass, fabricated human pass, install, production mutation or hidden skipped failure."
    ],
    "acceptance": [
      "Integrated required checks and authenticated seven-row matrix have exact recorded results or explicit blockers.",
      "Real PTY/input/counters, cancellation/admission/normal-respawn/no-mutation guard, full-u64/malformed/unsafe-downstream and retirement evidence is non-vacuous.",
      "All 64 state/size/zoom checkpoints plus four primary images are retained under complete per-case manifests without cross-session overwrite."
    ],
    "verification": [
      "Run P02-P07 focused commands and P08 wider command list sequentially; record per-check exit/status and fresh full-viewport captures at both sizes/zoom."
    ]
  },
  {
    "id": "human-full-app-visual-review",
    "title": "Obtain actual human full-app visual and interaction acceptance",
    "blocked_by": [
      "execute-integrated-qualification"
    ],
    "allowed_files": [
      "plans/261104-1529-os-session-management-and-interactions/qualification/human-review.md"
    ],
    "constraints": [
      "HumanReviewer only; automated assistant/model review cannot substitute.",
      "Keep historical review ledgers and AC8/F1 unresolved claims honest."
    ],
    "acceptance": [
      "Actual human signs fresh authenticated full-app evidence at both sizes/zoom or gate stays pending/failed.",
      "No retroactive qualification of unrelated predecessor apps/releases."
    ],
    "verification": [
      "Human inspects actual captures and interactive scenarios; record reviewer/date/provenance and row-by-row disposition."
    ]
  }
]
```

- [ ] <!-- evcrate-task:author-integrated-qualification --> Author meaningful real-app guard, continuity and input qualification
- [ ] <!-- evcrate-task:execute-integrated-qualification --> Run integrated required gates and authenticated full-app matrix
- [ ] <!-- evcrate-task:human-full-app-visual-review --> Obtain actual human full-app visual and interaction acceptance
