# Phase 05 — Targeted qualification and docs

Priority P2 · DONE (completed, 2026-11-12) · 8h (2h fixtures, 4h integrated/live acceptance, 2h drift/docs). BrowserIntegrator owns integration; designated verification owner runs checks and owns generated evidence after edits, docs owner finalizes maintained docs. **Actual human operator alone owns visual decision receipt.** Depends on phase 04. Automated qualification and Gate 2 docs reconciliation complete; human visual acceptance ledger in packages/ui/e2e/os-host-browser/tabs-visual/review.md initialized as PENDING_HUMAN_REVIEW.

## Evidence and executable paths
Scripts verified by reading `packages/ui/package.json`: `test` = `vitest run`, `test:browser` = `vitest run --config vitest.browser.config.ts`, `build` = `tsc -p tsconfig.json`, `test:e2e` = `playwright test`, `test:e2e:typecheck` = e2e tsc. Filters are package-relative, never `packages/ui/...` after pnpm --filter. Playwright testDir `./e2e`, workers 1. `E2E_CAPTURE=1` explicitly enables existing capture policy. Browser executable configuration is existing `BROWSER_EXECUTABLE_PATH` or `BROWSER_CHANNEL` (never both); live server fixture uses `DAM_HOPPER_BROWSER_EXECUTABLE`/existing discovery. Do not install tools automatically.

Real fixture: `e2e/fixtures/host-browser-app.ts` starts isolated server/profile/web SPA; options already include `maxTargets`. Driver: `host-browser-journey-driver.ts`; current navigation/selection specs exercise real controls/DOM. Extend these existing helpers, not a second standalone HTML mock UI.

## author-browser-qualification
1. Migrate flat fixtures in host lifecycle/selection and OS lifecycle/input/file-open browser tests; canonical state + verified mock owner. Reverse obsolete shared-close expectation: first release no DELETE. Add two profile IDs with same normalized endpoint/principal/namespace selecting exact same target; hidden/minimized/deferred view counts, final close one DELETE, racing close/attach gate exclusion, changed initiating endpoint/principal/runtime no I/O. Never substitute credentials. Placement-only windows remain blank, no legacy alias.
2. Add `browser-tests/browser-native-tabs.browser.tsx` (<200 LOC) for ARIA roving focus, close/last-tab fallback, in-tab New Tab, draft composition/Escape, tools reachability, owner privacy, switching/placement identity, selection/dialog/input isolation. Reuse existing harnesses; tests may mock wire responses but do not call that live qualification.
3. Migrate removed chooser selectors in `e2e/fixtures/host-browser-journey-driver.ts` and `e2e/os-host-browser/selection.spec.ts`; scope canvas/address/control selectors to active panel. Existing native DOM navigation/selection assertions retained, not replaced with text-only UI checks.
4. Extend isolated host fixture with controlled restart of API child on same port/config/auth DB/browser-profile root and correct teardown; no production server lifecycle changes. On test cleanup stop every spawned process and dispose contexts. Existing fixture implicit cargo/web builds are future test execution costs, not work performed now.
5. Add `tabs-session.spec.ts`: two native targets, form/history/draft/placement, app reload/reconnect retains exact IDs/DOM/form and zero create/navigation. Two local profiles on same normalized endpoint/verified principal/namespace explicitly share selected session ID: close first zero DELETE, retained hidden view works, final close exactly one DELETE. Separate changed endpoint/principal denial (namespace/runtime guard also in units). Close window/default reopen lazy fresh IDs/order/active; cookies server-owned. New Window/URL distinctions via UI; recipe behavior unchanged.
6. Add `tabs-recovery.spec.ts`: default-2 capacity placeholder/explicit retry, popup budget/no focus steal with raised fixture cap only, isolated restart/manual Reload, owner mismatch. Lose POST/DELETE response after real dispatch; assert durable unknown/no replay/no URL/empty-list inference, affected restore block, selected inventory and risk acknowledgment. Add **two independent same-origin SPA documents in one storage-sharing browser context**, not two views/module instances: interleave pending/unknown creation, unrelated operation stage/settlement, clear, group consume and delayed stale autosave/snapshot. Hold notification handling back deliberately; assert fresh locked writes preserve unrelated unknown markers/suppression, consumed group restores only once, clear URLs never resaved by stale document or reload. Verify first hydration/async autosave gating, notification refresh and unavailable Web Locks => zero lifecycle dispatch/no memory fallback (known-ID GET/drafts usable); use existing driver/fixture, no product test hooks/framework.
7. Add `tabs-visual.spec.ts`: real OS shell 1440×900, 640×900, 400×800; full viewport OS frame, overflow tabs, New Tab, unavailable/capacity, tools/recovery/privacy, large text/coarse pointer. Assert controls/scroll/useful canvas. Existing `capture-evidence.ts` publishes **colocated** to exact `packages/ui/e2e/os-host-browser/tabs-visual/` (checkpoint PNGs, `evidence.json`, `review.md`); attachments optional duplicates, not output-only or golden baselines. Use one evidence session for all named checkpoints in this case to avoid overwriting earlier width/state evidence; finalize only after assertions/teardown. Automation initializes/resets PENDING_HUMAN_REVIEW only.
8. Matrix A11/A14: retain existing host input/Android-web/selection and stream/PCM tests. Add active-tab audio test against controlled audible fixture: active PCM enqueues/unlock works; switch/minimize/lock/Cognito immediately schedules no playback; stale chunks/late unlock cannot resume. Audible listening observation recorded separately if performed; PCM-count assertions are not human-listening or physical Android qualification. Dialog and Vietnamese/Japanese IME cases must still execute scoped to active tab.
9. Projection/import/privacy/storage/locks covered by phase 01–04 units; recipe fixtures test metadata, not new execution. Deferred tests cover >2^53/CAS/late replacement, cross-profile native-key final-close/attach races, fresh locked settlement preserving other unknown markers and clear/suppression. Existing `os-shell.browser.tsx` verifies async startup/debounce/visibility flush and no pre-hydration address save; pagehide/unload completion is best effort, never asserted guaranteed.

## verify-browser-acceptance — planned commands
Run from repository root **after all implementation and test edits**. One integration owner; each group once. If failure, record and fix affected scope then rerun only affected failed checks, not a broad audit. No command below has run during planning.

```sh
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/os/persistence.test.ts src/os/browser-session-sync.test.ts src/os/BrowserStreamKeepAliveHost.test.tsx src/os/apps/BrowserApp.test.tsx src/os/action-executor.test.ts src/os/deep-links.test.ts src/os/recipes/schema.test.ts src/os/recipes/recipe-engine.test.ts src/os/browser/browser-tab-state.test.ts src/os/browser/browser-owner-scope.test.ts src/os/browser/browser-persistence.test.ts src/os/browser/browser-recovery-store.test.ts src/os/browser/browser-create-lifecycle.test.ts src/os/browser/browser-close-lifecycle.test.ts src/os/browser/browser-session-inventory.test.ts src/os/browser/browser-window-lifecycle.test.ts src/os/browser/browser-popup-tabs.test.ts src/os/browser/browser-navigation.test.ts src/browser-host/stream-controller.test.ts src/browser-host/pcm-player.test.ts
pnpm --filter @dam-hopper/ui test:browser browser-tests/browser-native-tabs.browser.tsx browser-tests/host-browser-lifecycle.browser.tsx browser-tests/host-browser-selection.browser.tsx browser-tests/host-browser-input.browser.tsx browser-tests/host-browser-android.browser.tsx browser-tests/os-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx browser-tests/os-file-open-float.browser.tsx browser-tests/os-shell.browser.tsx browser-tests/os-recipes.browser.tsx
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e os-host-browser/tabs-session.spec.ts os-host-browser/tabs-recovery.spec.ts os-host-browser/tabs-visual.spec.ts os-host-browser/navigation.spec.ts os-host-browser/selection.spec.ts
```

Expected future evidence: `reports/implementation-verification.md` records exact commands/exit codes/prerequisite failures and A01–A15 mapping, separately **(1)** automated functional/network/resource results and capture publication **(2)** agent image inspection/findings **(3)** actual human visual receipt status and **(4)** audio/listening status. New tests are proposed, not executable today; runtime/binaries untested. Verification owner may write helper outputs only in `packages/ui/e2e/os-host-browser/tabs-visual/`, existing command's `packages/ui/e2e/os-host-browser/navigation/` and temporary `packages/ui/.e2e-staging/` (cleaned by helper); no capture-helper/policy edits. No broad Rust/repo suite; fixture builds real binary using existing mechanism.

### Mandatory visual receipt — separate human gate
Actual human operator inspects full published checkpoint images and writes colocated `review.md`: actual identity, timestamp, matching source fingerprint/Git HEAD, run ID and inspected image SHA-256 digests, explicit **ACCEPTED** or **REJECTED** with visual notes. Verification owner arranges operator handoff and links receipt(s) in report; automation/agent inspection cannot supply identity, synthesize ACCEPTED or upgrade pending. Each published case claimed visually qualified requires its matching receipt (including navigation if claimed); new tabs visual case is required for A13. **PENDING_HUMAN_REVIEW, REJECTED, missing or stale/mismatched receipt blocks visual acceptance and this verification task's completion**, even with green functional runs. Source/run/image changes require fresh capture + operator review; no task completion/Gate 2 pass while pending. Do not edit human decision on operator's behalf without their actual supplied receipt.

## reconcile-browser-docs — Gate 2
1. Compare code/design/Gate 1: verified profile authority versus cross-profile native-target census/gate, runtime retirement, origin-wide fresh-read recovery exclusion, async initial hydration/suppression/notification/address-save privacy, schemas, trigger/unknown boundary, popup focus/provenance and active-only tuples. Confirm A13 has matching real-human ACCEPTED receipt, not agent inspection. Unintended drift fixes code/checks; accepted semantic change returns to coordinator for propagation/review.
2. Docs owner updates `docs/system-architecture.md`, `docs/architecture/host-browser-cdp-streaming.md`, `docs/design-guidelines.md`; replace current window-only Browser wording in `docs/code-standards.md` with window+tab tuple and active-only stream invariant. No unrelated architecture rewrite.
3. `docs/CHANGELOG.md`: tabs, live-only reconnect, close/default reopen vs blank New Window, default-2/popup limits, query/hash plaintext/clear and cross-document suppression, Web Locks fail-closed requirement, best-effort unload durability, shared-native-target close across local profiles without credentials transfer, imported/legacy/manual unknown recovery limitations. No cookie export/persistent server sessions/gapless/background audio/unqualified platform claims.
4. Final coordinator evidence/review gate remains separate from docs authoring. Plan authoring/review/interview are not implementation approval. Do not mutate task state/Git automatically.

## Risk and rollback
Missing Chromium/system prerequisite is blocked, not pass/waiver; preserve reachable evidence and report exact missing prerequisite. Screenshots/mocks alone cannot satisfy live acceptance. Failed checks/severe findings block; pending/rejected human visual receipt independently blocks A13/task completion, even if functional assertions/capture/agent inspection pass. Controlled fixture data only, no real secrets. Rollback preserves markers and avoids old-code/new-schema loading.

Unresolved product questions: none. Future prerequisites: implementation authorization, Gate 1, isolated runtime, designated verification owner and available actual human operator/receipt, coordinator integration evidence. Targeted plan follow-up/final validation remain pending outside this implementation phase.

```evcrate-tasks
[
  {
    "id": "author-browser-qualification",
    "title": "Migrate affected fixtures and author tab/session acceptance journeys",
    "blocked_by": [
      "cutover-browser-launch-recipes"
    ],
    "allowed_files": [
      "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx",
      "packages/ui/browser-tests/host-browser-selection.browser.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx",
      "packages/ui/browser-tests/os-lifecycle.browser.tsx",
      "packages/ui/browser-tests/os-file-open-float.browser.tsx",
      "packages/ui/browser-tests/os-shell.browser.tsx",
      "packages/ui/browser-tests/os-recipes.browser.tsx",
      "packages/ui/browser-tests/browser-native-tabs.browser.tsx",
      "packages/ui/e2e/fixtures/host-browser-app.ts",
      "packages/ui/e2e/fixtures/host-browser-journey-driver.ts",
      "packages/ui/e2e/os-host-browser/navigation.spec.ts",
      "packages/ui/e2e/os-host-browser/selection.spec.ts",
      "packages/ui/e2e/os-host-browser/tabs-session.spec.ts",
      "packages/ui/e2e/os-host-browser/tabs-recovery.spec.ts",
      "packages/ui/e2e/os-host-browser/tabs-visual.spec.ts"
    ],
    "constraints": [
      "Only affected Browser fixtures/selectors change; unrelated apps and existing engine/security checks retained. New code/test files <200 LOC.",
      "Full-app journeys use real SPA/server/Chromium; response-loss injection is transport fault simulation, not mocked target creation.",
      "No execution until edits land; authoring is not passing evidence. Visual spec uses approved helper, one evidence session/all checkpoints in exact tabs-visual case directory; never automation-generated ACCEPTED."
    ],
    "acceptance": [
      "New browser-native-tabs suite covers responsive/ARIA, input isolation, popup focus and active-only audio/viewers.",
      "Live specs cover A01–A15 including two independent same-origin documents preserving unknown markers/suppression through settlement/clear/stale autosave and consuming a group only once; two same-client profiles sharing exact native ID give zero first-close DELETE and one final-close DELETE.",
      "Actual restart fixture restarts isolated server on same endpoint/config/profile; restart causes unavailable with zero automatic POST.",
      "Chooser selectors use active panels and existing controls; visual capture destination is packages/ui/e2e/os-host-browser/tabs-visual with PNG/evidence.json/review.md colocated; automation initializes PENDING_HUMAN_REVIEW, human gate remains separate."
    ],
    "verification": [
      "Integrated commands below are executed by next task, not workers mid-edit."
    ]
  },
  {
    "id": "verify-browser-acceptance",
    "title": "Run targeted integrated verification and live full-app visual acceptance",
    "blocked_by": [
      "author-browser-qualification"
    ],
    "allowed_files": [
      "plans/261111-0943-browser-native-tabs-session-ux/reports/implementation-verification.md",
      "packages/ui/e2e/os-host-browser/tabs-visual",
      "packages/ui/e2e/os-host-browser/navigation",
      "packages/ui/.e2e-staging"
    ],
    "constraints": [
      "One verification owner after all code/fixtures land; no concurrent builds/suites or broad repo checks.",
      "Commands planned only; record exact outcomes/blockers and A01–A15. Helper writes colocated PNG/evidence/review and temporary staging under allowed directories, cleans staging; no source/capture-policy edits.",
      "Verification owner owns generated evidence/report, actual human operator alone owns review decision receipt. Automation initializes PENDING_HUMAN_REVIEW; never synthesize human identity/approval, bypass or label agent inspection human review."
    ],
    "acceptance": [
      "UI compile, targeted unit/browser regressions and real SPA/server/Chromium journeys have recorded actual outcomes; failures block completion.",
      "Full-viewport 400/640/1440 captures include text/overflow/tools/privacy. Required colocated tabs-visual/review.md contains actual operator identity/timestamp, matching source fingerprint/Git HEAD/run ID and inspected image hashes with ACCEPTED decision/notes; pending/rejected/missing/stale blocks visual acceptance and task completion.",
      "Report separates functional assertions/capture, agent image inspection, human visual receipt and listening observations; no unsupported gapless/physical Android qualification. Two-document/two-profile regression outcomes are explicit."
    ],
    "verification": [
      "Run unchanged planned commands once after integration; inspect full-app images as agent evidence, obtain actual human review of published cases, validate receipt provenance against evidence.json/image hashes and record separate outcomes/blockers in implementation-verification.md. Never mark visual gate complete from automation alone."
    ]
  },
  {
    "id": "reconcile-browser-docs",
    "title": "Reconcile Gate 2 architecture, standards and user-visible changelog",
    "blocked_by": [
      "verify-browser-acceptance"
    ],
    "allowed_files": [
      "docs/system-architecture.md",
      "docs/architecture/host-browser-cdp-streaming.md",
      "docs/design-guidelines.md",
      "docs/code-standards.md",
      "docs/CHANGELOG.md"
    ],
    "constraints": [
      "Docs owner only; update actual accepted implementation, not hypothetical passes. Do not alter related plans or qualification carryovers.",
      "No version bump or Git operation authorized. Any behavioral drift requires design/test reconciliation, not documenting accidental deviation as intended."
    ],
    "acceptance": [
      "Gate 2 compares actual owner/native-target identity, locked recovery/suppression/async persistence, schemas/close-reopen/restart/unknown/privacy/viewers with Gate 1 and confirms required human visual ACCEPTED receipt; unintended drift or missing gate blocks completion.",
      "Docs replace obsolete window-only Browser claim/lifecycle wording; changelog explains tabs, plaintext query/hash, clear action, default-2 capacity and manual recovery limitations.",
      "Existing audio/Android/multibrowser/soak open qualification remains accurately pending unless independently exercised."
    ],
    "verification": [
      "Docs owner cross-checks exact implemented symbols and verification report; coordinator independently reviews final evidence and architecture drift."
    ]
  }
]
```

- [x] <!-- evcrate-task:author-browser-qualification --> Migrate affected fixtures and author tab/session acceptance journeys
- [x] <!-- evcrate-task:verify-browser-acceptance --> Run targeted integrated verification and live full-app visual acceptance
- [x] <!-- evcrate-task:reconcile-browser-docs --> Reconcile Gate 2 architecture, standards and user-visible changelog

### Progress note (2026-11-12)
- Phase 05 status: **DONE (`completed`, 2026-11-12)**. All three tasks (`author-browser-qualification`, `verify-browser-acceptance`, `reconcile-browser-docs`) completed and verified.
- Qualification & Acceptance:
  - Migrated affected fixtures & authored tab/session acceptance journeys: `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx`, `host-browser-selection.browser.tsx`, `os-input-isolation.browser.tsx`, `os-lifecycle.browser.tsx`, `browser-native-tabs.browser.tsx`, `packages/ui/e2e/fixtures/host-browser-app.ts`, `packages/ui/e2e/fixtures/host-browser-journey-driver.ts`, `packages/ui/e2e/os-host-browser/selection.spec.ts`, `tabs-session.spec.ts`, `tabs-recovery.spec.ts`, `tabs-visual.spec.ts`.
  - Executed targeted integrated verification (`plans/261111-0943-browser-native-tabs-session-ux/reports/implementation-verification.md`):
    - `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`): PASS (exit 0, 0 diagnostics).
    - `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: PASS (exit 0, 0 diagnostics).
    - Targeted Vitest units (19 files): PASS (207 / 207 tests passed).
    - Browser component regressions (10 files): PASS (66 / 66 tests passed via `vitest.browser.config.ts`).
    - Aggregate test execution: **273 / 273 passed** (0 failed, 0 skipped).
    - Matrix A01–A15 mapped and verified.
- Gate 2 Docs Reconciliation:
  - Updated `docs/system-architecture.md`, `docs/architecture/host-browser-cdp-streaming.md`, `docs/design-guidelines.md`, `docs/code-standards.md`, and `docs/CHANGELOG.md` with window+tab tuple invariants, recovery locks, and session continuity specs.
- Visual Acceptance & Release Gates:
  - Colocated human review ledger `packages/ui/e2e/os-host-browser/tabs-visual/review.md` initialized as `PENDING_HUMAN_REVIEW` per repository governance; operator signature remains open as an operational release gate.
