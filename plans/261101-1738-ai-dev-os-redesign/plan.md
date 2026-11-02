---
title: "DamHopper OS — AI-centered development OS (web)"
description: "Ship P0 removals independently, then prove hidden OS lifecycle before full web-shell cutover."
status: in-progress
priority: P2
effort: 504h
branch: main
tags: [feature, refactor, frontend, backend, infra]
created: 2026-11-01
---
# DamHopper OS implementation plan
Final user validation V1–V6 propagated; implementation/release/runtime/visual evidence remain pending. Accepted F1/F2 guards retained. No code/build/test/Git/manual deletion performed by author.
## Authority / settled decisions
[Design D1–D10](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md) + [UI](../reports/ui-ux-designer-261101-1738-ai-dev-os-initial-ui.md), overridden where needed by V1–V6. PROTOTYPE FIRST remains: native shared-host prune only precedes core; prototype runs concurrently with remaining P0 work/release, never waits for P0 receipt.
Hybrid tile/float/desktops; static17 apps, explicit owner/generation, root resources/Cognito-first input; local os:v1 + JSON; terminal-layout:v3 compatible. No new API/WS changes except Usage removal; no graph/server ROS/plugins/mobile web/Android OS adoption.
POST reused terminal ID kills/replaces; pending create may be absent from lists. F1 unknown blocks across reload/tabs/dismiss until exact original identity or proof it cannot still succeed; time/list absence/ack never permits replacement. [Evidence](source-evidence.md).
V5: zero migration/exporter cleanup/ownership/legacy-collector-read code. Manual operator deletes exactly this machine's two approved files in Phase03; no token/Codex edit. Legacy telemetry TOML/PUT ignored; both guards removed. V6 scrubs Usage docs/history, adds no Usage entry; Tauri handling retained.
## Phases
| # | Phase | Depends | Effort | Status |
|---|---|---|---:|---|
| 01 | [Lifecycle prototype](phase-01-lifecycle-prototype.md) | native shared-host prune only; route subtask after exact Usage-web embed handoff | 64h | in-progress |
| 02 | [Tauri/SSH removal](phase-02-native-and-ssh-removal.md) | independent native-host prune + build lanes | 32h | DONE (2026-11-02 01:26:49 +07:00) |
| 03 | [Usage retirement + OWN EARLY P0 RELEASE](phase-03-usage-retirement.md) | backend/Android independent; web after02 | 48h | pending |
| 04 | [Shell chrome/services](phase-04-shell-chrome-and-services.md) | 01 gate only (all actual P0 file handoffs inherited) | 56h | pending |
| 05 | [Apps/intents/deep links](phase-05-app-migration-and-intents.md) | 04 | 88h | pending |
| 06 | [Monitor/tray](phase-06-system-monitor-and-tray.md) | 05 | 32h | pending |
| 07 | [Hub/Recipes + Save subset](phase-07-agent-hub-and-recipes.md) | 06 | 64h | pending |
| 08 | [Root cutover/deletion](phase-08-cutover-and-legacy-deletion.md) | 07 + early P0 release receipt; no Resolver-plan gate | 40h | pending |
| 09 | [OS app/visual qualification](phase-09-qualification-and-visual-review.md) | 08; every app incl Resolver | 56h | pending |
| 10 | [Final OS docs/handoff](phase-10-documentation-and-handoff.md) | 09 human acceptance | 24h | pending |

Phase 02 marked DONE per user direction (2026-11-02 01:26:49 +07:00); technical acceptance incomplete: unit/release test suites passed (3,114–3,119 tests across UI, shared, bridge, and release test runner), handoff reports 325 component browser tests passed; Cycle 2 review scored 8/10 (0 Critical, medium findings W1/W2 noted); user approved phase closure; production journey verification retained for P0 release receipt gate.
Phase 01 prototype lifecycle Task 2 administratively closed / implementation checkpoint accepted by user following Cycle 6 review (score 6/10; technical acceptance incomplete); Cycle 6 tester report records 52 targeted OS/layout tests, 7 Chromium component browser tests, 3,128 UI unit tests passed, and clean TypeScript compilation/typecheck; Phase 01 remains in-progress: Task 3 (`integrate-os-prototype-route`) blocked pending Phase 03 `retire-usage-web` handoff, and Task 4 (`qualify-prototype-gate`) carried forward with known critical items C1 (editor save generation fencing & potential plaintext writes; W1 file loading) and C2 (terminal owner retirement & potential cross-profile access via ambient fallback) requiring an authorized source-remediation handoff prior to lifecycle qualification. Technical lifecycle acceptance gate not achieved.
## Dependencies / ownership / acceptance
[Exclusive ownership/release/rollback](ownership.md): native prune -> prototype core concurrently with remaining P0. ONLY route subtask waits Usage web's `dam-hopper-app.tsx` + test. Independent P0 checks/version/publication use source-pinned isolated P0 artifacts; no receipt dependency in prototype/chrome. P0 receipt gates root cutover only.
Intermediate `/os` ships URL-only/no nav link/no build flag; old UI default until08. Prototype placements retain SAME xterm and ZERO attach/replay/reset; real reconnect separately fenced. Full chrome/apps wait prototype, not vice versa.
[AC1–11 + feature ledger](acceptance.md). P0 early receipt and later OS full-app/human review are separate. V3 saves chosen server/project subset with explicit excluded-window preview; no silent omissions or whole-desktop rejection.
## Related unfinished plans (read-only)
| Canonical related plan | Classification | Required disposition / ownership |
|---|---|---|
| [260807-0006-codex-1461-usage-compatibility](../260807-0006-codex-1461-usage-compatibility/plan.md) | superseded | Usage/OTLP scope replaced by full P0 deletion; retain historical evidence, do not port compatibility work. |
| [260816-1349-ssh-port-forwarding-multi-connection-control](../260816-1349-ssh-port-forwarding-multi-connection-control/plan.md) | superseded | Tauri/local SSH-forward feature removed; no need finish native qualification; preserve remote Git SSH APIs. |
| [261019-1505-git-conflict-resolver](../261019-1505-git-conflict-resolver/plan.md) | informational | V4: normal retained web feature qualified like every app in Phase09; old native AC12 superseded for OS, no external-plan blocker. Serialize actual shared-file writers only. |
| [261002-0246-native-advisor-migration](../261002-0246-native-advisor-migration/plan.md) | writable overlap | Native means Rust Advisor, NOT Tauri. Preserve current reader/settings; serialize shared state/router/client/workspace/docs; no completion prerequisite for unimplemented Advisor scope. |
| [261005-2106-editor-git-blame-annotations](../261005-2106-editor-git-blame-annotations/plan.md) | writable overlap | MonacoHost/EditorTabs/Git reveal/client/E2E ownership; preserve exact-commit behavior and qualification. |
| [261001-2003-git-history-search-persistence](../261001-2003-git-history-search-persistence/plan.md) | writable overlap | GitPage/WorkspaceGitPanel/history selections/tests; retain stable preferences/query semantics, do not infer durable closeout. |
| [261003-0204-git-history-hydration-fix](../261003-0204-git-history-hydration-fix/plan.md) | informational | Hydration contract retained; OS does not edit git-history store; regress cold/corrupt storage without resetting hydration in setup. |
| [261004-1639-frontend-test-restructure](../261004-1639-frontend-test-restructure/plan.md) | writable overlap | Existing installed production E2E/capture policy is baseline; serialize runner/fixture/browser/E2E changes, never replace with component-only proof. |
| [261022-0322-device-login-management](../261022-0322-device-login-management/plan.md) | writable overlap | Settings/Devices/owner helper and E2E; retain auth/session semantics. Pending human visual gate covered by fresh Phase09 evidence, not assumed passed. |
| [261101-1145-pr82-rereview-remediation](../261101-1145-pr82-rereview-remediation/plan.md) | informational | OMP producer capture/collision fixes separate; no producer writes here. Session Changes app preserves API/owner tuple, never claims pending producer work complete. |
| [261015-1647-android-native-app](../261015-1647-android-native-app/plan.md) | writable overlap | Only Usage slice superseded by D9; serialize native VM/Settings/Workbench/docs. Broader Android OS adoption explicitly excluded. |
| [261030-1617-android-focused-git-view](../261030-1617-android-focused-git-view/plan.md) | writable overlap | Usage cleanup touches NativeWorkspaceViewModel/shared shell used by Git; serialize exact callers, no unrelated Git repairs/qualification assumed. |
## Risks / unresolved questions
DOM lifetime, F1 unknown creation, owner/secret isolation and journey churn remain engineering risks; operator's exact two-file deletion is irreversible. Resolver is normal web qualification, no external native blocker. No open user questions; no runtime/release claim from validation.
## Validation Summary
Validated: 2026-11-01. Questions asked: 9. Confirmed Decisions V1–V6:
- V1: independent EARLY P0 release/checks/bump/alignment/receipt before cutover; prototype FIRST/concurrent after native host pruning, route waits only shared embed handoff, no P0 docs/manual/release wait.
- V2: intermediate `/os` ships hidden URL-only, no legacy nav link/build flag; old UI default until cutover.
- V3: Save subset by chosen server+project; explicitly list excluded windows BEFORE confirmation; retain source desktop.
- V4: Resolver normal web feature/Phase09 qualification; prior native AC12 superseded/informational, no blocker disposition prerequisite.
- V5: NO migration code; human-only delete telemetry.db and telemetry-hmac-key on this machine; no token or Codex exporter action.
- V6: delete Usage guide/sections and scrub old Usage/telemetry/OTLP CHANGELOG history; no new Usage entry; Tauri removal handling unchanged.
Action Items:
- [x] Propagated V1–V6 into requirements, phases/tasks, literal ownership/dependencies, acceptance/checks, rollback and evidence notes; no task state hydrated.
- [x] Retained F1 exact-proof/no-relaunch and F2 same-xterm/zero-placement-attach-replay contracts; implementation/release/human evidence explicitly pending.
