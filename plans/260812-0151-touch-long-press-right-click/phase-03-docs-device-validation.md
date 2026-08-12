# Phase 03 — Documentation, device matrix, and release validation

## Context links
- Parent: [plan.md](./plan.md)
- Architecture gate already applied: `docs/system-architecture.md:2032-2042`
- Roadmap note to update: `docs/project-roadmap.md:343-346`
- Standards: `AGENTS.md`, `CLAUDE.md`, `docs/code-standards.md`, `docs/frontend-components.md`
- Source reports: `plans/reports/preflight-260812-0151-touch-long-press-right-click.md`, `plans/reports/researcher-260812-0210-touch-long-press-pointer-events-retry.md`

## Overview
- **Date:** 2026-08-12
- **Description:** Record validation status, exact commands, side effects, and physical-device limitations without widening runtime scope.
- **Priority:** P2
- **Implementation status:** Completed 2026-08-12
- **Review status:** Approved — overall review 8.5/10; no blockers

## Key Insights
- The architecture contract already matches the plan: Radix is the single 700 ms owner; Explorer rows/editor tabs are the boundary; Monaco text/preview is a non-goal.
- `vitest.browser.config.ts` runs headless Chromium only. Playwright mobile emulation is useful for app timing/layout, not Android/iOS OS-menu certification.
- iOS Safari may omit `contextmenu`; Android Chrome event ordering can vary. Physical checks must record these limitations rather than trigger source work.

## Requirements
- Update the roadmap with touch validation status and the remaining device limitation; do not rewrite the already-gated architecture section unless it drifts.
- Record no auth/API/database/business/config/deployment side effects and no new package.
- Run exact UI build, focused unit (if changed), focused browser, full UI unit, and full UI browser commands; report failures honestly.
- Manual matrix must include Chromium touch emulation, physical Android Chrome, physical iOS Safari, desktop mouse/keyboard, scroll/drag, focus/dismissal, and viewport-edge placement. WebKit emulation is not iOS certification; Tauri/WebView is not required.

## Architecture
This phase changes documentation and evidence only. No server/Rust/native bridge, network contract, persistence, configuration, gesture policy, global CSS, or shared runtime behavior is introduced. Rollback is removal of the test/doc additions; no migration is needed.

## Related code files
- **Modify:** `docs/project-roadmap.md` (touch milestone and validation limitations).
- **Verify only:** `docs/system-architecture.md` (existing contract; do not duplicate or contradict it).
- **Validation references:** `packages/ui/package.json`, `packages/ui/vitest.browser.config.ts`, test files from Phase 02.
- **No create/delete:** no application source, backend, native, API, database, config, or dependency files.

## Implementation Steps
1. Update the roadmap entry from “touch long-press not run” to the achieved automated evidence and clearly retained physical-device follow-up.
2. Run focused checks:
   - `pnpm --filter @dam-hopper/ui build`
   - `pnpm --filter @dam-hopper/ui exec vitest run src/components/ui/ContextMenu.test.tsx src/components/ui/ContextMenuCompatibility.test.tsx src/components/organisms/ContextMenuConsumers.test.tsx`
   - `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/consumer-context-menu.browser.tsx browser-tests/global-native-context-menu-suppression.browser.tsx browser-tests/viewport-context-menu.browser.tsx`
3. Run complete UI checks: `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui test:browser`; use `pnpm check` only when the normal repository gate is requested.
4. Record browser/device results, test limitations, and any residual selection semantics question; do not call emulation a physical-device pass.
5. Review `git diff --check`, `git status --short`, and staged state. Implementation and docs are complete; review approved 8.5/10, and remaining physical-device and parallel-media risks are documented.

## Todo list
- [x] Update roadmap without changing the architecture gate.
- [x] Run and record each command/result in the implementation record, including the failed parallel browser gate and passing serial fallback.
- [x] Exercise Chromium synthetic touch/pen holds with a margin beyond 700 ms; do not call this physical-device certification.
- [x] Record Android Chrome and iOS Safari smoke checks as required follow-up; neither device was available in this Linux validation session.
- [x] Confirm no staged app files and no dependency/config changes.

## Completion evidence — 2026-08-12
- UI build passed. Focused unit passed **35/35**; focused browser passed **17/17**; full UI unit passed **992/992**; `git diff --check` passed; no staged files.
- Full parallel browser execution remains a known nondeterministic media flake: reported runs reached **117–119/120** (one fresh run reached 120/120), with only existing image `naturalWidth`/video `readyState` readiness failures. Isolated media and serial full browser passed **11/11** and **120/120** respectively.
- Coverage command was not available: `@vitest/coverage-v8` is not installed. No coverage metric is claimed and failures were not suppressed.
- Automated evidence is Linux Chromium synthetic app-level input. Physical Android Chrome and iOS Safari native event ordering, callouts, scrolling, and device behavior remain unverified follow-up.

## Success Criteria
- Roadmap accurately states automated coverage and device limitations.
- All applicable UI checks pass, or failures are recorded with residual risk.
- Evidence distinguishes app-level synthetic pointer coverage from UA/native context-menu behavior.
- Scope remains Explorer rows/editor tabs only; Monaco text and preview remain no-goals.

## Risk Assessment
- **Medium:** headless Linux cannot validate OS callouts/native menus; mitigation: physical Android/iOS follow-up.
- **Medium:** iOS and Android event ordering differs; mitigation: retain Radix timer/fallback and document observed traces.
- **Low:** roadmap drift could imply unsupported guarantees; mitigation: cite exact commands and environments.

## Security Considerations
No authentication, authorization, token, API, database, file-sandbox, or permission change. Preserve capture-level suppression for unmarked surfaces; do not weaken it to make Monaco or previews appear supported.

## Side-effect checklist
- [x] Auth/permissions — unchanged.
- [x] API compatibility — no REST/WS/client DTO changes.
- [x] Database/persistence — none.
- [x] Business semantics — existing menu commands only; no selection/action redesign.
- [x] Security — marker and native suppression remain fail-closed.
- [x] Performance — no global listeners; Radix remains the sole per-trigger non-mouse timer.
- [x] Docs — roadmap update plus this plan; architecture contract already gated.
- [x] Config — no flags, CSS gesture policy, or dependency.
- [x] Deployment — no server/Rust/native artifact or rollout change.

## Next steps
Phase complete after review approval. Schedule physical Android Chrome/iOS Safari smoke validation before any release claim; open a separate product/architecture plan before considering Monaco text/preview actions or Explorer selection changes.

## Unresolved questions
- Which physical Android/iOS versions and Tauri/WebView targets are release blockers?
- Should long-press on an unselected Explorer row preserve current selection or select before opening? This plan intentionally does not decide it.
