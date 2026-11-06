# Phase 07 — Qualification, E2E evidence and docs

## Context Links
- Design AC1–AC6 + §8 future acceptance (live PTY, input isolation, dirty reuse, multi-profile/worktree): `../reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md`
- Evidence D related plans (H1 live PTY attach/replay carry-over from `plans/261101-1738-ai-dev-os-redesign` Phase 09): `./reports/scout-261106-0334-evidence-and-decisions.md`
- Testing conventions: `docs/testing.md:45-74`, `docs/code-standards.md:201-214` (capture policy, human review gate)
- E2E convention: `packages/ui/e2e/os-recipes/` (`*.spec.ts`, `review.md`, `evidence.json`, `screenshot.png`/`fhd.png`/`compact.png`), `packages/ui/e2e/fixtures/capture-policy.ts`, `packages/ui/playwright.config.ts:37-38`

## Overview
- Priority: P1 · Status: complete · Effort: 7h
- Prove AC1–AC6 + B1–B4 + invariants C end-to-end, record evidence with a human visual review gate, then sync docs.

## Parallelization Info
- Sequential · Depends on: P06 · Blocks: none · Concurrent peers: none.

## Key Insights
- Green automation certifies behavior only; `review.md` stays `PENDING_HUMAN_REVIEW` until an operator inspects captures (`docs/code-standards.md:214`).
- `pnpm check` = `pnpm build && pnpm lint && cd server && cargo test` (root `package.json`); server untouched but gate still required.
- Docs to sync: `docs/frontend-components.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/CHANGELOG.md`, `docs/project-roadmap.md`, plus `docs/code-standards.md` (single-visible-slot text "Focus Existing Window" → Go to window reveal; new float-over-maximized stacking rule; Hub mounts in `OsResourceHost`) — ownership amendment.

## Requirements
- R1 E2E case `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts` (authenticated seed per `docs/code-standards.md:213`, no `--no-auth`) covering: Hub default desktop maximized; open zero-terminal project via `[+ Open ▾]`; expand tree; switch worktree; open file → float editor above Hub with owner badge of clicked tree (AC1, AC4); same relative path in second profile/worktree opens a distinct window, same tuple refocuses (AC2); Hub `[+ New Terminal]` streams output; project switch + sidebar hide/show + split keep streaming without xterm remount (AC3, AC6); agent row focus (AC5, when an observed agent fixture is available, else documented as N/A with reason); capture policy screenshots at 1440×900, 1920×1080, 1024×640.
- R2 `review.md` with checkpoints list, AC1–AC6 checklist, status `PENDING_HUMAN_REVIEW`.
- R3 Qualification report `plans/261106-0334-agent-hub-terminal-first-workspace/reports/qualification-report.md`: exact commands + results for full suites; live manual checks: streaming PTY across project switch/sidebar hide/split, hidden-terminal input isolation (typing in visible pane never reaches hidden/background PTY), Hub→standalone terminal handoff stays interactive on a quiet PTY (F2), Hub tab pin/close ends only the clicked terminal and Hub survives (F3), dirty editor reuse (buffer + undo unchanged), reconnect G→G+1 with dirty doc → Hub float request reveal-only (F1), profile re-pointed to another serverUrl → save denied with buffer intact, still denied after a dirty reload or float reopen via the new endpoint, "Discard changes and reload" rebinds, same-endpoint reconnect still saves (V1, F1-V1), page reload with a dirty editor tab → restored tab keeps its endpoint identity and saves on the same endpoint (V6), stuck launch: "Clear stuck launch" while the create is still pending → in-flight refusal; after it settles/abandons → definitely-absent → confirm → cleared → relaunch (V3, F8, F9), page reload with a selected (incl. zero-terminal) Hub workspace → same workspace reselected; removed project → falls back to the active session's project (V7), multi-profile/worktree file opening; AC1–AC6/B1–B4/C/F1–F10/V1–V7 → evidence map; "Known limitations" section (decided): BrowserApp iframe outside B2 stacking (V4); no renderer cap (V2); cross-tab in-flight launch not tracked — only caught once its PTY appears in fresh inventory (V5); legacy persisted dirty tabs without endpoint identity are save-blocked once until discard/reload (V6); failures recorded verbatim (no fabricated passes).
- R5 Renderer cost measurement (V2 no cap; F10 metric definitions; measurement-only, NO thresholds or pass/fail). Scenario: ≥20 live sessions across ≥2 profiles; sample at baseline, Hub open, project switch, sidebar hide/show, split, Hub close. Metrics, each reported separately:
  - M1 renderer instances = distinct `TerminalEntry` objects in `terminalRegistry` (`new Set(terminalRegistry.values()).size`; raw map size overcounts because canonical key + raw-id alias share one entry, `lib/terminal-registry.ts:60-77`), cross-checked with distinct DOM `data-xterm-instance-token` values (`TerminalPanel.tsx:368,405`).
  - M2 active stream/listener registrations = transport `onTerminalData`/`onTerminalBuffer`/`onTerminalExit`/`onTerminalLifecycle`/… subscriptions minus their released unsubscribers (`TerminalPanel.tsx:616-639` cleanup handles, `:727-779` registration), per session and total; a residual after Hub close or panel unmount is recorded as a leak finding that reopens P03/P06 (not a threshold).
  - M3 cumulative attach/replay attempts (`terminalAttach` calls, `buffer_replay` diagnostics) — separate counter, never presented as active subscriptions.
  - M4 JS heap (`performance.memory.usedJSHeapSize` in Chromium) per sample.
  - Sources: M1/M2/M3 from a P07-owned Chromium harness `packages/ui/browser-tests/os-agent-hub-renderer-measurement.browser.tsx` (imports the registry, counting fake transport following the `os-workspace-apps.browser.tsx:36-40` mock shape; evidence class "browser, mocked transport"); live E2E samples M1 (DOM tokens only) and M4 (evidence class "live"). The harness prints metrics and makes no threshold assertions.
  - Record results plus the known limitation (unbounded renderers, one per live session).
- R4 Docs updated to shipped behavior only; CHANGELOG entry; roadmap item status.

## Related Code Files
- Create: `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts`, `packages/ui/e2e/os-agent-hub-workspace/review.md` (+ run-generated `evidence.json`, `screenshot.png`, `fhd.png`, `compact.png` in the same dir), `plans/261106-0334-agent-hub-terminal-first-workspace/reports/qualification-report.md`, `packages/ui/browser-tests/os-agent-hub-renderer-measurement.browser.tsx` (R5 measurement harness, F10)
- Modify: `docs/frontend-components.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/CHANGELOG.md`, `docs/project-roadmap.md`, `docs/code-standards.md`
- Delete: none

## Ownership & Conflict Prevention
- Sole writer of the new E2E dir, the qualification report, the R5 measurement harness (amendment F10; no other phase writes it) and docs. Product-code defects found here are NOT fixed in P07: reopen the owning phase task (P02–P06) and re-run.

## Implementation Steps
1. `p07-e2e-journey`: write spec + `review.md` following `os-recipes` layout; run with `E2E_CAPTURE=1`.
2. `p07-qualification-run`: write the R5 measurement harness; run full suites, harness and live checks; write report with AC/B/C/F/V evidence map, R5 metric tables (M1–M4 per sample, labelled by evidence class) and unresolved findings.
3. `p07-docs-sync`: update docs (component map, architecture: Hub mounts/attach gate/stacking/float file open/shared launch lifecycle; standards text; changelog; roadmap).

```evcrate-tasks
[
  {
    "id": "p07-e2e-journey",
    "title": "Agent Hub workspace E2E journey with capture policy and human review ledger",
    "blocked_by": ["p06-agent-hub-compose"],
    "allowed_files": ["packages/ui/e2e/os-agent-hub-workspace"],
    "constraints": ["Follow packages/ui/e2e/os-recipes layout and fixtures/capture-policy.ts; authenticated seeding, no --no-auth.", "review.md status remains PENDING_HUMAN_REVIEW; never self-approve visuals."],
    "acceptance": ["Spec exercises AC1, AC2, AC3, AC4, AC6 (and AC5 when an observed agent fixture exists, otherwise documented N/A) against a built SPA and real server.", "Captures at 1440x900, 1920x1080, 1024x640 with evidence.json and review.md colocated."],
    "verification": ["pnpm --filter @dam-hopper/ui test:e2e:typecheck", "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui exec playwright test os-agent-hub-workspace"]
  },
  {
    "id": "p07-qualification-run",
    "title": "Full-suite and live qualification with AC/decision evidence map",
    "blocked_by": ["p07-e2e-journey"],
    "allowed_files": ["plans/261106-0334-agent-hub-terminal-first-workspace/reports/qualification-report.md", "packages/ui/browser-tests/os-agent-hub-renderer-measurement.browser.tsx"],
    "constraints": ["Record exact commands and verbatim results; failures reopen owning phase tasks instead of being fixed here.", "Distinguish mocked/browser/E2E/live evidence (docs/code-standards.md:205)."],
    "acceptance": ["Report maps AC1-AC6, B1-B4, invariants C, review findings F1-F10 and validation outcomes V1-V7 to concrete passing evidence or explicit open findings; a Known limitations section lists the decided limitations (BrowserApp iframe stacking V4, uncapped renderers V2, cross-tab in-flight launch V5, legacy dirty tabs without endpoint identity V6) as limitations, not passes.", "Live checks recorded: streaming PTY across project switch/sidebar hide/split, hidden-terminal input isolation, Hub-to-standalone handoff, tab close isolation, dirty editor reuse and reconnect reveal-only, endpoint save fence (re-pointed denied incl. after dirty reload/alias reopen, discard-and-reload rebinds, same-endpoint reconnect saves, restored dirty tab keeps identity after page reload) (V1, F1, V6), stuck-launch clear: definitely-absent confirm then relaunch, in-flight/unknown refused (V3, F8, F9), selected Hub workspace restored after reload with fallback to the active session's project (V7), multi-profile/worktree file opening.", "Renderer measurement with >=20 live sessions across >=2 profiles reports separately: distinct renderer instances (deduped registry entries and DOM instance tokens), active stream/listener registrations minus releases, cumulative attach/replay attempts and JS heap, at baseline, Hub open, project switch, sidebar hide, split and Hub close; no thresholds; residual registrations after teardown recorded as findings (V2, F10)."],
    "verification": ["pnpm --filter @dam-hopper/ui test", "pnpm --filter @dam-hopper/ui test:browser", "pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-agent-hub-renderer-measurement.browser.tsx", "pnpm --filter @dam-hopper/ui test:e2e", "pnpm check", "pnpm lint", "pnpm build"]
  },
  {
    "id": "p07-docs-sync",
    "title": "Sync architecture, component, standards, changelog and roadmap docs",
    "blocked_by": ["p07-qualification-run"],
    "allowed_files": ["docs/frontend-components.md", "docs/codebase-summary.md", "docs/system-architecture.md", "docs/CHANGELOG.md", "docs/project-roadmap.md", "docs/code-standards.md"],
    "constraints": ["Describe only shipped, qualified behavior; keep docs under 800 lines each.", "Do not mark human visual review complete."],
    "acceptance": ["Docs describe terminal-first Hub (no roster), Hub mounts + attach gate in OsResourceHost, presentation-input ownership, Go to window reveal, float-over-maximized stacking (and its BrowserApp iframe limitation), file:open float mode with reuse of generation-equal or live-owner windows and fail-closed reveal for defined generation mismatch, editor endpoint save fence (incl. persisted identity of dirty tabs and one-time block of legacy dirty tabs), shared launch lifecycle with manual stuck-launch clearing, Hub tab pin/close semantics, and persisted Hub appState fields incl. selectedWorkspace.", "Known limitations are documented as decided: BrowserApp iframe stacking (V4), no renderer cap (V2), cross-tab in-flight launch not tracked (V5), legacy dirty tabs without endpoint identity (V6).", "CHANGELOG and roadmap entries reference this plan and its qualification report."],
    "verification": ["Manual diff review of docs against qualification-report.md; pnpm lint"]
  }
]
```

- [x] <!-- evcrate-task:p07-e2e-journey --> Agent Hub workspace E2E journey with capture policy and human review ledger
- [x] <!-- evcrate-task:p07-qualification-run --> Full-suite and live qualification with AC/decision evidence map
- [x] <!-- evcrate-task:p07-docs-sync --> Sync architecture, component, standards, changelog and roadmap docs

## Success Criteria
- AC1–AC6 each have passing automated evidence (unit/browser/E2E) plus live-check notes; `review.md` pending human gate; all suites green or findings reopened.
- **Verified Verification Evidence:**
  - **Vitest UI Unit Suite:** 370 test files, 3,537 tests passed (`vitest run`).
  - **Chromium Browser Suite:** 5 test files, 58 tests passed in Chromium (`vitest.browser.config.ts`).
  - **Full Browser Suite:** 64 test files, 358 tests passed.
  - **Playwright E2E:** `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts` passed cleanly.
  - **Production Builds & Typecheck:** Web & Extension build succeeded (`pnpm build`); E2E typecheck clean (`tsc -p tsconfig.e2e.json`).
  - **Repository Lint:** Passed (0 errors, 379 warnings).
  - **R5 Renderer Telemetry:** 0 unreleased tracked subscriptions (`176 -> 0`) confirmed on Hub unmount across 22 sessions in 2 profiles; 0 xterm remounts across project switch/sidebar toggle/split.
- **Qualification Boundary:** Visual review ledger `packages/ui/e2e/os-agent-hub-workspace/review.md` initialized as `PENDING_HUMAN_REVIEW` per `docs/code-standards.md:214`; live container streaming PTY daemon continuity gate.
## Risk Assessment
- E2E environment lacking an observed agent (OMP/Codex/Claude) → AC5 covered by browser suite; E2E notes N/A with reason.
- Flaky PTY streaming timing → use output markers, not sleeps.
- Measurement environment (V2) may lack two reachable profiles with ≥20 sessions → seed via the E2E server fixture or a second local profile; if impossible record the exact shortfall instead of extrapolating.
- Mocked-transport M2/M3 counts differ from production transport internals → labelled evidence class; live run supplies M1 (DOM) and M4 only; no cross-class extrapolation (F10).

## Security Considerations
- E2E uses deterministic auth seeding; captures must not include tokens/secrets in URLs or terminal output.

## Rollback
- Docs/E2E additive; revert P07 commit. Integrated product rollback (consumers before providers; see `plan.md`): P06 → P02, P03, P04 and P05 (all mandatory before P01, since P05 imports P01 workspace types/`canDismissWorkspace`) → P01; a partial rollback that stops before P01 may retain P01. Reverting P06 alone keeps P02's GLOBAL stacking + float file-open active. Server sessions, pin sets and dirty editor buffers are never touched by rollback.

## Next Steps
- Operator visual review of captures; coordinator finalization.

## Unresolved questions
- None (V2 decided: no cap, measured + documented; F10 metric definitions fixed).
