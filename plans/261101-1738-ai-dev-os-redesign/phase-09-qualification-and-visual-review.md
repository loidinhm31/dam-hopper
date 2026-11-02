# Phase 09: P5 gate — Application qualification and visual review

Estimate: 56h; implementation status: **pending**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; pending. This gate qualifies the LATER OS cutover, not the independently shipped P0 release in Phase03. Every app, including Conflict Resolver, follows ordinary web qualification; old native AC12 is superseded, no external resolver blocker. Before cutover intermediate builds served URL-only `/os` without discovery links/build flag. [Policy](../../AGENTS.md#7-testing-guidelines), [ledger](acceptance.md). No execution performed during planning.

### Carried Phase 01 Qualification & Remediation Ingress
Per user approval (2026-11-02), Phase 01 was marked DONE on the component DOM continuity checkpoint; the following technical acceptance items and remediation gates are formally received by Phase 09:
- **H1 (Live Lifecycle Oracle):** E2E live streaming PTY, outbound zero-attach/replay/reset counters across window placement and desktop moves, dirty Monaco model/undo preservation, and controlled preview JS execution continuity under running container daemon.
- **H2 (Behavioral Privacy Oracle):** Physical behavioral input-isolation assertions under Cognito mode verifying zero received PTY bytes, zero editor mutations, zero preview events, and clean restored input upon mask removal.
- **C1 (Editor Save Fencing & Plaintext Risk):** Editor save generation fencing, potential plaintext writes (hard-coded generation 1 encryption policy lookup), async upload race clearing newer edits, and fabricated empty tab state (Cycle 3 W1). Requires authorized source-remediation handoff.
- **C2 (Terminal Owner Retirement & Cross-Profile Risk):** Ambient transport fallback (`ambient:<generation>`) for retired profile connections risking cross-profile read/write across equal raw terminal IDs, and retained-focus keyboard/paste exposure under CSS pointer suppression. Requires authorized source-remediation handoff.
- **Cycle 3 Carried Warnings:** Monaco DOM reparenting cleanup during unmount (W2), real resource controller integration (W3), rendered-slot/shortcut-capture input regressions (W4).
- **Cycle 4 Carried Warnings:** Connected parking-host containment assertions (W1; registry retention alone permits detached DOM), reactive profile notification boundary without explicit test re-render (W2), visual review ledger completion (`review.md`; W3), React 19 test harness `act(...)` warning elimination (W4).

## Ordered implementation by task ID
### migrate-application-journeys
1. Retain useful component/browser regressions; remove only deleted shell/mobile/native/Usage presentation tests. Rewrite remaining WorkspacePage/IdeShell/AppLayout/HostResourcePopover imports and selectors to actual OS apps/frames, preserving original assertions (no skipped suites/mock-shell substitution).
2. Update existing production app journeys for Traditional agents/worktree, editor blame/media/dirty save, Plans dashboard/doc navigation, conflict lifecycle, Session Changes, privacy, font/contrast/zoom, devices/MFA and idle-suspend. Preserve real server/auth/temp-root fixtures, capture policy, failure integrity and cleanup; no personal server/HOME/dev token reuse. Keep sqlite auth test distinction; no-auth cannot prove device auth.
3. Extend root/catalog os-lifecycle: each placement-only tile/float/maximize/minimize/desktop op retains SAME xterm with ZERO additional terminal:attach/replay/reset; actual reconnect separately permits necessary fenced attach/replay without parked destruction. Cover OS catalog, root/basename/intents/storage and verify prior intermediate `/os` was URL-only/no build flag/old default until cutover.
4. Add multi-profile equal-ID/name adversarial coverage: profile disconnect while save/kill/launch/review/encrypted upload in flight, replacement generation/incarnation/epoch rejected, sibling remains live. Browser and Monaco continuity assert real instances/markers, not only text. Encrypted upload keys fail closed on retirement and capability sessions never silently rebind.
5. Test V3 mixed desktop Save subset: selected server/project, explicit matching/excluded name/context/reason preview BEFORE confirm, cancel/empty selection, same-project worktrees, deterministic pruned topology and unchanged source desktop. Keep authored commands/inert validated import/export warnings and F1 pending-create reload/lost-response/absent-list/second-tab ZERO-additional-create/exact late-adoption/proof-gated retry matrix; user acknowledgement never unblocks unknown.
6. Performance/resource behavior: background app bodies unmounted; only visible active-desktop terminals fit/WebGL, hidden terminals no WebGL contexts; context loss -> DOM; Monitor/tray share bounded SSE and generation cleanup; no duplicate topic/toast listeners after repeated desktop/route moves. Avoid inventing throughput/latency thresholds absent project policy.
### verify-release-integration
1. Single main integration owner freezes source and runs applicable typecheck/build/unit/browser/server/Android/version/CI checks once after every writer lands; collect exact commands, exits/failures/skips/coverage and scope in report. Do not run concurrent whole-repo suites.
2. Run real production-container E2E at1440x900,1920x1080,1024x640; capture full viewport locally. CI `E2E_CAPTURE=0`/CI=true runs assertions with zero artifacts, never certifies visual approval. Existing human-review source/evidence hashes must match final code.
3. Regress already-released P0 compatibility under OS: isolated legacy server.telemetry TOML/PUT accepted, Usage404/no4811, other REST/WS/Android contracts stable. V5 has no migration/exporter cleanup code; do NOT repeat manual machine-file deletion (already one-time Phase03 operator receipt).
4. Retained server/web/Android release/version manifests remain aligned without native jobs. Phase03 already performed its own authorized synchronized bump/early publication; this OS gate does not bump, commit, tag or push. Windows runtime proof stays distinct from Linux. Verify V6 docs/history remain scrubbed with no new Usage entry.
5. Failures reopen owning source task and invalidate affected evidence. Record per-placement attach/replay/reset vs reconnect, V3 subset matrix and F1 delayed-create proof. Resolver is qualified/fixed exactly like other apps here; no external-plan/native gate. Other real shared-writer claims serialize, never auto-import unrelated unfinished work.
### accept-fresh-visual-review
1. Human reviewer inspects fresh full-app captures for each affected existing journey + new OS lifecycle/recipes/cutover at supported viewports/zoom; inspect seven chrome states, context badges, compact/short layout, focus/z ordering, palette/dock/minimized list, Hub/Monitor/Recipes, unknown/offline states and Cognito opacity/redaction.
2. Record exact run/source/evidence filenames and ACCEPTED/REJECTED in each `review.md`; automated agents never synthesize human acceptance. Rejected/missing/stale captures block release; fix, rerun affected captures and review again.

## Success
All design §8 AC1–11 mapped in acceptance.md exercised with current evidence. Functional CI green alone is insufficient; real PTY/editor/browser continuity and human visual review required. Linux web runtime is target; do not claim removed Tauri/mobile qualification. Existing unrelated unresolved gates remain honestly recorded.

## Risks / security / rollback
Journey fixture churn never permits narrowed coverage. Use fixture identities; sleep stays isolated, never suspend workstation. Failed OS cutover deploys prior coherent intermediate artifact (P0 retained, old UI default, hidden OS); preserve OS JSON/unresolved launch evidence/PTYs. Do not restore or repeat explicitly deleted local telemetry files, invent migration code or recreate scrubbed Usage docs/history. Main owns integrated result and repairs.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `migrate-application-journeys` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/browser-tests` |
| Modify | `packages/ui/e2e/session-changes-review` |
| Modify | `packages/ui/e2e/sqlite-auth-lite-mode` |
| Modify | `packages/ui/e2e/ui-contrast-font-system` |
| Modify | `packages/ui/e2e/traditional-terminal-agents` |
| Modify | `packages/ui/e2e/traditional-terminal-worktree-switching` |
| Modify | `packages/ui/e2e/project-plans-dashboard` |
| Modify | `packages/ui/e2e/git-conflict-resolver` |
| Modify | `packages/ui/e2e/privacy-heavy-blur` |
| Modify | `packages/ui/e2e/editor-git-blame` |
| Modify | `packages/ui/e2e/device-login-management` |
| Modify | `packages/ui/e2e/host-auto-sleep` |
| Modify | `packages/ui/e2e/os-lifecycle` |
| Modify | `packages/ui/e2e/os-recipes` |
| Create | `packages/ui/e2e/os-cutover` |
| Modify | `packages/ui/e2e/fixtures` |
| Modify | `packages/ui/playwright.config.ts` |
| Modify | `packages/ui/tsconfig.e2e.json` |

### `verify-release-integration` file actions

| Action | Literal writable path |
|---|---|
| Create | `plans/261101-1738-ai-dev-os-redesign/reports/integration.md` |

### `accept-fresh-visual-review` file actions

| Action | Literal writable path |
|---|---|
| Modify | `packages/ui/e2e/session-changes-review/review.md` |
| Modify | `packages/ui/e2e/sqlite-auth-lite-mode/review.md` |
| Modify | `packages/ui/e2e/ui-contrast-font-system/review.md` |
| Modify | `packages/ui/e2e/traditional-terminal-agents/review.md` |
| Modify | `packages/ui/e2e/traditional-terminal-worktree-switching/review.md` |
| Modify | `packages/ui/e2e/project-plans-dashboard/review.md` |
| Modify | `packages/ui/e2e/git-conflict-resolver/review.md` |
| Modify | `packages/ui/e2e/privacy-heavy-blur/review.md` |
| Modify | `packages/ui/e2e/editor-git-blame/review.md` |
| Modify | `packages/ui/e2e/device-login-management/review.md` |
| Modify | `packages/ui/e2e/host-auto-sleep/review.md` |
| Create | `packages/ui/e2e/os-lifecycle/review.md` |
| Create | `packages/ui/e2e/os-recipes/review.md` |
| Create | `packages/ui/e2e/os-cutover/review.md` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "migrate-application-journeys",
    "title": "Rewrite retained browser and production application journeys for OS",
    "blocked_by": [
      "remove-web-mobile-paths"
    ],
    "allowed_files": [
      "packages/ui/browser-tests",
      "packages/ui/e2e/session-changes-review",
      "packages/ui/e2e/sqlite-auth-lite-mode",
      "packages/ui/e2e/ui-contrast-font-system",
      "packages/ui/e2e/traditional-terminal-agents",
      "packages/ui/e2e/traditional-terminal-worktree-switching",
      "packages/ui/e2e/project-plans-dashboard",
      "packages/ui/e2e/git-conflict-resolver",
      "packages/ui/e2e/privacy-heavy-blur",
      "packages/ui/e2e/editor-git-blame",
      "packages/ui/e2e/device-login-management",
      "packages/ui/e2e/host-auto-sleep",
      "packages/ui/e2e/os-lifecycle",
      "packages/ui/e2e/os-recipes",
      "packages/ui/e2e/os-cutover",
      "packages/ui/e2e/fixtures",
      "packages/ui/playwright.config.ts",
      "packages/ui/tsconfig.e2e.json"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "No obsolete shell imports/selectors remain; meaningful retained feature assertions preserved at correct test layer.",
      "Real full app covers all17 apps, owners and root parity; every placement-only operation retains xterm identity with zero additional attach/replay/reset, while legitimate reconnect is separately qualified.",
      "Pending create across reload/lost response/absent lists/second-tab retry yields zero additional creates; late success adopted by exact original profile+epoch+id+incarnation; time/absence/user acknowledgement never permits replacement.",
      "V3 mixed desktop saves chosen server/project only after explicit matching/excluded preview and confirmation, with cancel/empty/pruned-topology/source-unchanged cases; validated inert import/authored commands/export warning and evidence policy retained."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:e2e:typecheck",
      "pnpm --filter @dam-hopper/ui test:browser",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e",
      "Within os-lifecycle/os-recipes/os-cutover cases, report per-placement xterm/terminal:attach/replay/reset deltas and delayed-create reload/lost-response/second-tab zero-additional-create plus exact late-success adoption; test authoritative failure/server-restart resolution separately."
    ]
  },
  {
    "id": "verify-release-integration",
    "title": "Run one coherent integration matrix and collect bounded evidence",
    "blocked_by": [
      "migrate-application-journeys"
    ],
    "allowed_files": [
      "plans/261101-1738-ai-dev-os-redesign/reports/integration.md"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "All AC1–11 have actual current-source results or explicit failed/blocking evidence; no fabricated passes.",
      "Previously released P0 contracts stay stable without native coupling/migration code or repeat manual deletion; Resolver qualifies normally, V3 subset and F1/F2 proof pass, Usage docs/history remain scrubbed."
    ],
    "verification": [
      "pnpm check",
      "cargo test --manifest-path server/Cargo.toml",
      "pnpm --filter @dam-hopper/ui test",
      "pnpm --filter @dam-hopper/ui test:browser",
      "pnpm --filter @dam-hopper/ui test:e2e:typecheck",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e",
      "pnpm android:test && pnpm android:test:app",
      "node scripts/run-gradle.mjs :shared:compileKotlinJvm :androidApp:compileDebugKotlin",
      "node --test tests/deploy/bump-version.test.mjs && node deploy/release/check-version-alignment.mjs",
      "pnpm release:verify",
      "Regress isolated legacy config PUT/Usage404/no4811/route inventory without repeating Phase03 one-time deletion or adding exporter/migration code; verify V6 scrub persists.",
      "Record V3 subset selection/explicit excluded preview/confirm/cancel/pruned topology/source unchanged, F1 pending-create and F2 placement/reconnect matrices; include ordinary Resolver web journey and prior hidden-URL/default-shell checks."
    ]
  },
  {
    "id": "accept-fresh-visual-review",
    "title": "Obtain real human review of final-source full-application captures",
    "blocked_by": [
      "verify-release-integration"
    ],
    "allowed_files": [
      "packages/ui/e2e/session-changes-review/review.md",
      "packages/ui/e2e/sqlite-auth-lite-mode/review.md",
      "packages/ui/e2e/ui-contrast-font-system/review.md",
      "packages/ui/e2e/traditional-terminal-agents/review.md",
      "packages/ui/e2e/traditional-terminal-worktree-switching/review.md",
      "packages/ui/e2e/project-plans-dashboard/review.md",
      "packages/ui/e2e/git-conflict-resolver/review.md",
      "packages/ui/e2e/privacy-heavy-blur/review.md",
      "packages/ui/e2e/editor-git-blame/review.md",
      "packages/ui/e2e/device-login-management/review.md",
      "packages/ui/e2e/host-auto-sleep/review.md",
      "packages/ui/e2e/os-lifecycle/review.md",
      "packages/ui/e2e/os-recipes/review.md",
      "packages/ui/e2e/os-cutover/review.md"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Human ACCEPTED records identify fresh final-source captures for all affected cases/viewports; no automated approval.",
      "Missing/rejected/stale evidence blocks release and returns to repair task."
    ],
    "verification": [
      "Human inspects fresh full application captures from E2E_CAPTURE=1 runs at1440x900,1920x1080,1024x640, records run/source identity and explicit disposition in each review.md."
    ]
  }
]
```

- [ ] <!-- evcrate-task:migrate-application-journeys --> Rewrite retained browser and production application journeys for OS
- [ ] <!-- evcrate-task:verify-release-integration --> Run one coherent integration matrix and collect bounded evidence
- [ ] <!-- evcrate-task:accept-fresh-visual-review --> Obtain real human review of final-source full-application captures
