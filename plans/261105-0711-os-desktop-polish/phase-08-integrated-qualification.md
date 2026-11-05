# P08 — Integrated behavioral live and visual qualification

Status: **completed** · Priority: P2 · Estimated effort: **30h** work, not elapsed schedule.

## Context and contracts

[Overview](plan.md) · [C1–C14 architecture](architecture-contracts.md) · [ownership/DAG](execution-ownership.md) · [AC1–10](acceptance-matrix.md) · [accepted review decisions](reports/review-triage.md). Evidence: immutable [intake](reports/planning-intake.md), [commands](reports/command-evidence.md), [preferences](reports/preference-evidence.md), [desktop](reports/desktop-evidence.md), [review](reports/plan-review.md). C14 supersedes old group/cutover placement, not evidence. Planning only; no product edits/checks authorized now.

## Ownership and completion boundary

- Owner: **IntegrationOwner / bounded tester**. Group: **G5, four checked sequential nodes after G4**.
- Literal task allowlists below are exhaustive (root `/home/loidinh/WS/dam-hopper`); existing paths modify, new paths create. Obsolete code/tests removed in-place; no file deletion/shim. No implicit parent directory writes.
- All dependencies mean evidence-backed **completed**, not implementation-terminal. Sequential nodes checked/reviewed before next starts. G3 independent writers all terminal before one coordinator runs branch checks and completes each; no child starts on unchecked prerequisite.
- Coordinator alone schedules checks; workers do not run competing suites/formatters mid-edit. Build failures remain blockers, never N/A. Extra unknown callers require reviewed plan revision; known callers already owned here.
- Available LSP reference inventory before public changes; fallback targeted references if unavailable, record limitation. No unrelated-plan/docs/source edits; external exclusive handoffs in ownership map.

## Ordered changes, acceptance and future checks

### `qualify-behavioral-regressions` — Qualify integrated behavior at unit and real browser layers

- [x] <!-- evcrate-task:qualify-behavioral-regressions --> Qualify integrated behavior at unit and real browser layers

1. Create integrated browser scenarios from every acceptance-matrix row. Reuse P02/P03 migrated fixtures, do not defer known Fleet literals or changed public test contracts to this phase. Permanent tests observe action results/current ownership/resources/input, not source spelling/default strings/icon wiring/name-map/theme-token copies.
2. Mounted actual root/coordinator with real shell/Monaco/xterm: formerly blocked browser chord remap, capture/menu/modal/IME/AltGraph/privacy physical keydown/keypress/keyup/held releases, lazy shell mount/remount, exact editor A while desktop B. No mocked executor/independent matcher as evidence of integration.
3. Add mounted pins import/error/menu keyboard/accessibility/nested maximize/resource-exclusive assertions. Two distinct usable editor docs and browser URLs interacted with, collision focus/picker retained/cancel/repeat/owner invalidation. Behavior doubles only isolate genuine boundary failure; do not replace real app/PTY with mock pass.
4. One coordinator reads installed test policy and executes UI build/unit/browser/Rust config/API tests/E2E typecheck. Record exact exit/status/output/infra failure and independent review. Prerequisite checks already passed at earlier nodes; this is integrated regression scope.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/browser-tests/os-desktop-polish.browser.tsx`
- `packages/ui/browser-tests/os-input-isolation.browser.tsx`
- `packages/ui/browser-tests/os-shell.browser.tsx`
- `packages/ui/browser-tests/project-worktree-target.browser.tsx`
- `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx`
- `plans/261105-0711-os-desktop-polish/reports/behavioral-qualification.md`

**Acceptance:**
- Behavior tests cover AC1-10 and D2-D8 transitions; no redundant permanent static copy assertions.
- Actual commands/status recorded individually; failures block, missing infrastructure never mock pass.

**Future verification, not receipts:**
- pnpm --filter @dam-hopper/ui build; pnpm --filter @dam-hopper/ui test; pnpm --filter @dam-hopper/ui test:browser browser-tests/os-desktop-polish.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/os-workspace-apps.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx
- cargo test --manifest-path server/Cargo.toml config::tests; cargo test --manifest-path server/Cargo.toml api::tests; cargo test --manifest-path server/Cargo.toml --test settings_import_export; pnpm --filter @dam-hopper/ui test:e2e:typecheck
- Coordinator records integrated browser smoke and passing independent review before next node; no planning-time checks executed.

### `exercise-full-app-journey` — Author and execute real authenticated full-app journey

- [x] <!-- evcrate-task:exercise-full-app-journey --> Author and execute real authenticated full-app journey

1. Use existing authenticatedContext/authenticatedPage/appServices application-fixture and capture-evidence helper; exact new E2E files only, no shared fixture/config rewrite or mock fallback. Actual backend/container/image support required, image build only with later execution authorization.
2. Exercise source A/B/unset/disconnected/edit fences, API->TOML empty->backend restart->GET null/defaults, paired map merge/reset/Cognito validation, all action surfaces and qualified deep-link search/reveal/stale denial. Pin/unpin/final close/[]/reload/dock-only import/export mounted notifications.
3. Two cooperating tabs: same-folder unresolved Open/New one request, two proven distinct directories retain both durable records; global lock lost-update regression/caps/corrupt/missing locks/storage/failed reserve/settlement/stale token/crash-before-send/lost response then reload/endpoint or target ambiguity. Exact request/provenance count, no inferred identity/retry/TTL.
4. Explicit Files workspace folder/root and project-worktree/ProjectInfo terminal creates: existing compatible terminal not reused, exact target/cwd retained despite desktop selection change; requested-ID collision blocks pre-network, no destructive ID replay. Destination removed/owner retired no retarget/kill.
5. New Editor/Browser picker: no preselection resource/iframe/load/navigation/PTY; two distinct actual docs/URLs usable, same target focuses holder/picker explanation, cancel only picker, repeated independent pickers and stale owner/context fails closed. Appearance from Devices/manual collapsed receives each token and focuses expanded section with both selectors unchanged.
6. Nested tile/float maximize/restore/resize/minimize/desktop switch: same xterm object/exact session zero additional attach/replay/reset, Monaco same editor/model dirty contents/selection/undo applied after transition; browser same real iframe JS context nonce/counter and zero navigation/reload (Frame object/DOM identity alone insufficient). Use controlled same-origin fixture page or externally controlled test endpoint through existing authorized fixture, no product iframe injection; additionally preserve cross-origin focus/right-click boundary honestly.
7. Root guard ordering/late-shell remount and physical key phases, menu scope/collision/focus return/captured owner/privacy, iframe-body right-click no desktop menu. Browser slot position-only moves and immutable visibility updates demonstrated without iframe navigation.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts`
- `packages/ui/e2e/os-desktop-polish/scenarios.ts`
- `plans/261105-0711-os-desktop-polish/reports/full-app-qualification.md`

**Acceptance:**
- Real authenticated mounted journey exercises all AC1-10 functional paths with real persistence restart and two-tab safety.
- Usable chooser resources, lossless directory payload, repeated Appearance and live resource-lifetime invariants observed beyond frame/DOM counts.
- Uncertainty stays blocked indefinitely with local/browser/alias limits explicit.

**Future verification, not receipts:**
- pnpm --filter @dam-hopper/ui test:e2e:typecheck; pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts
- Record exact real backend journey smoke, command exits and passing independent review before dependent probe; unavailable container/auth/controlled page is blocked prerequisite, not invented observation.

### `probe-live-terminal-boundary` — Observe physical PTY bytes exact provenance and lifetime

- [x] <!-- evcrate-task:probe-live-terminal-boundary --> Observe physical PTY bytes exact provenance and lifetime

1. Authorized isolated authenticated server PTY runs actual raw-byte observer. Record exact invocation/environment and originating profile/generation/epoch/incarnationExact, redact secrets. Actual browser xterm focus handled command -> zero command bytes and exactly one OS action; ordinary characters/Enter and remapped old unowned chord -> bytes/normal interaction.
2. Exercise copy/find/font/ordinary Shift and capture/menu/modal/privacy/IME/AltGraph suppression; full physical activation/dismissal/held key release. Browser/OS interception outside JS not web shortcut pass. No xterm callback-only fake physical probe.
3. Observe compatible focus/restore vs explicit New exact PTY counts and target/cwd, async desktop removal/owner retire/uncertain no retry, no kill/retarget confirmed orphan. Observe xterm same object and no added attach/replay/reset, not just DOM equality.
4. Protected ReviewTarget exact eight-tuple and Conflict Resolver real current operation/root or actionable disabled path. Inherited Recipe/F1/lifecycle/owner/Cognito release gates remain separately open. Cleanup only exact separately authorized isolated resources, never unsafe ID/name cleanup.

**Exact writable paths** (modify existing/create new; no deletes):
- `plans/261105-0711-os-desktop-polish/reports/live-terminal-qualification.md`

**Acceptance:**
- Physical server PTY evidence proves zero handled bytes plus working ordinary input, exact originating provenance and no additional attachment/replay/reset.
- No unknown identity inference/unsafe cleanup; absent capability is blocked not passed.

**Future verification, not receipts:**
- Run authorized actual byte-probe command and drive pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts; record precise executed command/byte output/environment, no invented passing probe invocation.
- Coordinator verifies compile/tests retained unchanged from previous node (no source writes), actual live smoke and independent report review before completion.

### `capture-visual-human-ledger` — Capture fresh visuals and truthful separate human ledger

- [x] <!-- evcrate-task:capture-visual-human-ledger --> Capture fresh visuals and truthful separate human ledger

1. After earlier E2E writers terminal, receive ancestor directory ownership; generate fresh screenshot.png 1440x900, fhd.png 1920x1080, compact.png 1024x640 and supported app zoom/system-font scale (include max system font) via same real journey/helper. evidence.json records provenance/dimensions/SHA256.
2. Available themes/forced colors: shared SVG/focus/running/minimized/tooltip/44px targets, floating dock/gutter/overflow/permanent Apps, edge menus/canvas chrome. Meaningful actual keyboard/accessibility checks remain; no permanent copy assertions.
3. Interactive native cursor inspect text/all resize/move/grab/grabbing/drag, owned portals/system fallback and cross-origin iframe untouched. Screenshot bytes do not prove native cursor/PTY/JS-context lifetime. Human review.md starts PENDING_HUMAN_REVIEW; only actual human identity/date/observation changes it.
4. Report AC1-10 automated/live/pending-human links and failures. Artifact-generation node may complete on truthful pending-human ledger plus passing required code/test/smoke/review; this does NOT complete production visual/native-cursor acceptance. Never make human pending an automated pass, copy prior PNG/hash/approval or close predecessor plan gate.

**Exact writable paths** (modify existing/create new; no deletes):
- `packages/ui/e2e/os-desktop-polish`
- `plans/261105-0711-os-desktop-polish/reports/visual-qualification.md`

**Acceptance:**
- Three fresh viewport captures plus supported scale/provenance/hashes; minimum viewport still supported.
- Ledger truthfully separates automated/live from PENDING_HUMAN_REVIEW; human acceptance remains separate mandatory release gate.

**Future verification, not receipts:**
- pnpm --filter @dam-hopper/ui test:e2e:typecheck; pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts; use existing capture helper for PNG/hash checks.
- Coordinator independently reviews artifacts and real capture smoke; actual interactive human review required for corresponding production acceptance, never fabricated or waived.

## Durable task contract

Exactly one fence, exact installed schema; no runtime state authored.

```evcrate-tasks
[
  {
    "id": "qualify-behavioral-regressions",
    "title": "Qualify integrated behavior at unit and real browser layers",
    "blocked_by": [
      "integrate-settings-palette"
    ],
    "allowed_files": [
      "packages/ui/browser-tests/os-desktop-polish.browser.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx",
      "packages/ui/browser-tests/project-worktree-target.browser.tsx",
      "packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx",
      "plans/261105-0711-os-desktop-polish/reports/behavioral-qualification.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Behavior tests cover AC1-10 and D2-D8 transitions; no redundant permanent static copy assertions.",
      "Actual commands/status recorded individually; failures block, missing infrastructure never mock pass."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui build; pnpm --filter @dam-hopper/ui test; pnpm --filter @dam-hopper/ui test:browser browser-tests/os-desktop-polish.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/os-workspace-apps.browser.tsx browser-tests/project-worktree-target.browser.tsx browser-tests/terminal-panel-replay-notifications.browser.tsx",
      "cargo test --manifest-path server/Cargo.toml config::tests; cargo test --manifest-path server/Cargo.toml api::tests; cargo test --manifest-path server/Cargo.toml --test settings_import_export; pnpm --filter @dam-hopper/ui test:e2e:typecheck",
      "Coordinator records integrated browser smoke and passing independent review before next node; no planning-time checks executed."
    ]
  },
  {
    "id": "exercise-full-app-journey",
    "title": "Author and execute real authenticated full-app journey",
    "blocked_by": [
      "qualify-behavioral-regressions"
    ],
    "allowed_files": [
      "packages/ui/e2e/os-desktop-polish/os-desktop-polish.spec.ts",
      "packages/ui/e2e/os-desktop-polish/scenarios.ts",
      "plans/261105-0711-os-desktop-polish/reports/full-app-qualification.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Real authenticated mounted journey exercises all AC1-10 functional paths with real persistence restart and two-tab safety.",
      "Usable chooser resources, lossless directory payload, repeated Appearance and live resource-lifetime invariants observed beyond frame/DOM counts.",
      "Uncertainty stays blocked indefinitely with local/browser/alias limits explicit."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:e2e:typecheck; pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts",
      "Record exact real backend journey smoke, command exits and passing independent review before dependent probe; unavailable container/auth/controlled page is blocked prerequisite, not invented observation."
    ]
  },
  {
    "id": "probe-live-terminal-boundary",
    "title": "Observe physical PTY bytes exact provenance and lifetime",
    "blocked_by": [
      "exercise-full-app-journey"
    ],
    "allowed_files": [
      "plans/261105-0711-os-desktop-polish/reports/live-terminal-qualification.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Physical server PTY evidence proves zero handled bytes plus working ordinary input, exact originating provenance and no additional attachment/replay/reset.",
      "No unknown identity inference/unsafe cleanup; absent capability is blocked not passed."
    ],
    "verification": [
      "Run authorized actual byte-probe command and drive pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts; record precise executed command/byte output/environment, no invented passing probe invocation.",
      "Coordinator verifies compile/tests retained unchanged from previous node (no source writes), actual live smoke and independent report review before completion."
    ]
  },
  {
    "id": "capture-visual-human-ledger",
    "title": "Capture fresh visuals and truthful separate human ledger",
    "blocked_by": [
      "probe-live-terminal-boundary"
    ],
    "allowed_files": [
      "packages/ui/e2e/os-desktop-polish",
      "plans/261105-0711-os-desktop-polish/reports/visual-qualification.md"
    ],
    "constraints": [
      "Implement frozen architecture-contracts.md including C10-C14; no shims, new service, Recipe rewrite or ambient authority.",
      "Implementation-terminal is not completion. Coordinator runs applicable compile/tests/smoke and independent implementation review before any dependent starts; no failed compile labeled N/A.",
      "Own only literal paths; inventory exported references before edits. New unknown callers require reviewed allowlist revision, not partial migration."
    ],
    "acceptance": [
      "Three fresh viewport captures plus supported scale/provenance/hashes; minimum viewport still supported.",
      "Ledger truthfully separates automated/live from PENDING_HUMAN_REVIEW; human acceptance remains separate mandatory release gate."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:e2e:typecheck; pnpm --filter @dam-hopper/ui test:e2e os-desktop-polish/os-desktop-polish.spec.ts; use existing capture helper for PNG/hash checks.",
      "Coordinator independently reviews artifacts and real capture smoke; actual interactive human review required for corresponding production acceptance, never fabricated or waived."
    ]
  }
]
```

## Risks, failure and rollback

Risk: mocks mistaken for actual root/PTY, same iframe element but reloaded context, no undo proof, stale screenshots or manufactured human approval. Failures block node/dependents; repair exclusively in original owner allowlist and reverify affected completion chain, preserve logs/journal/resources.

Common invariant: owner-bound authorization; recheck after awaits; retain exact PTY/ReviewTarget and root keep-alive identities. Never kill/retarget confirmed orphan, clear unresolved journal, suppress failure or substitute ambient owner. Rollback coherent authorized code/config groups only, preserve user work.

## Handoff / unresolved questions

P09 receives exact real reports/captures/status. No product check run in planning; all implementation/live/human outcomes pending. Human ledger truthfully pending is artifact completion only, not AC6/AC10 release acceptance.

No unsettled product choice. Separate implementation authorization, cross-plan ownership, actual infrastructure/check/review and production human acceptance remain gates. Parent owns installed structural parser, targeted independent planning follow-up and final validation/interview; this authoring return claims none.
