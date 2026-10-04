# Enhanced `/cmd-plan__hard` brief

## Goal
Plan—not implement—the confirmed restructure in [advisor report](../../reports/advise-261004-1527-frontend-test-evidence.md). Keep valuable Vitest browser-component coverage. Introduce a separate Playwright Test application runner with isolated backend/frontend services and deterministic data. Replace only the three mislabeled E2E cases with journeys through the actual web application. Require fresh local complete-application viewport screenshots and real human inspection; CI retains functional assertions without generating screenshots.

## Required deliverables
- Separate unit/component/application runner discovery, commands, and CI integration.
- Reusable real-app fixtures; deterministic policy/model/evaluation/project data; no personal workspace/config/credentials; bounded readiness and owned process cleanup on success, failure, startup failure, and cancellation.
- Privacy journey: actual application below mask; real activation/dismissal chord; relevant input isolation and restored interaction.
- Advisor journey: enable/open actual Workspace Advisor; edit primary/backup route through controls; independent persisted-value readback; application-shell evidence.
- Evaluations journey: discover real seeded descriptors; narrow docked panel within wide application; functional inspect/compare and clipping/overflow checks; full viewport evidence.
- One repository-relative capture policy; failures fail capture-enabled runs; skipped captures never labeled fresh; provenance includes source revision/dirty state, fixture identity, viewport, checkpoint, run outcome and human review.
- Project-wide browser-suite/workflow inventory; retain unique targeted checks; rank uncovered integration risks without wholesale component conversions.
- Planned updates to docs/testing.md, root AGENTS.md and existing changelog. Acceptance matrix for integration, evidence authenticity, cleanup, and capture-disabled CI.

## Scope rules
No production/test/doc implementation now. Only markdown planning artifacts under this plan directory. No images in plans. Architecture-first mutation skipped: test-only restructure; docs/testing.md remains unchanged until implementation. Use current repo over historical summaries. Native Advisor is current; no legacy plugin runner. No new generic abstraction, blanket pixel baseline, retries, telemetry, or mass component rewrite.

## Workflow/environment
- No active plan in injected context; naming: `plans/261004-1639-frontend-test-restructure/`.
- Hard-planning command template read directly from installed OMP commands; planning, web-testing and sequential-thinking instructions loaded directly. No claim of automatic skill activation.
- Global set-active-plan.cjs executed; `EVCRATE_SESSION_ID` absent, so hook active-plan state did not persist. All workers receive this directory explicitly.
- Current evidence inspection: privacy image is blurred and source provenance unknown; advisor and evaluations images show isolated Advisor/components, not the application shell. Existing images are not fresh acceptance evidence.
- Research only; no tests/builds run and no application-capture claim.
- Source research found `/etc/dam-hopper/host.toml` overrides effective Advisor HOME. Final design: production Dockerfile's actual SPA/backend in owned app container + private Mongo/network; canonical Rust auth seed; no host-home/etc mounts or production bypass. Correct evaluation root is `.evcrate/advisor-evaluations`; history directory gates capability. Real dock minimum is 180px; exercise original 320px affected width through resize controls.

## Unresolved questions
None blocking design. Fixture/source findings resolved in Phase 02; actual runtime qualification, final-source captures and real human image review remain implementation acceptance gates.
