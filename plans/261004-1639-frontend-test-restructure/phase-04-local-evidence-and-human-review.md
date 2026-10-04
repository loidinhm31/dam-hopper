# Phase 04 — Local evidence and human review

## Context links
- [Plan](./plan.md), [journeys](./phase-03-real-application-journeys.md), [acceptance matrix](./acceptance-checks.md).
- Current `packages/ui/e2e/e2e-capture-helper.ts`; [Playwright screenshot API](https://playwright.dev/docs/api/class-page#page-screenshot), [trace API](https://playwright.dev/docs/api/class-tracing#tracing-start).

## Overview
- Date: 2026-10-04. Priority: P2. Implementation: pending. Review: pending.
- Replace untraceable PNG existence with fresh actual-application checkpoints and explicit human visual review.

## Key Insights
- Current helper accepts arbitrary buffers/directories and is not called by the three existing cases. Evaluations captures an absolute workstation path.
- Existing advisor/evaluations images show isolated components; privacy image provenance is unknown. No existing image can satisfy the new fresh-run gate.
- `page.screenshot({ fullPage: false })` captures the complete visible viewport. `fullPage: true` instead captures the whole scrollable document; neither an element crop nor stretching a component creates application evidence.
- Default failure screenshots, video and trace screenshots can generate images even when a custom capture helper is disabled. Capture policy must cover those paths too.

## Requirements
- One Node-side policy consulted before browser screenshot calls or buffer allocation.
- Local default capture on; CI default off; `E2E_CAPTURE=1|true` explicitly on; `0|false` explicitly off. Treat `CI=0|false` as false rather than merely nonempty. Reject other nonempty capture values with actionable error.
- Functional actions/assertions run unchanged in both modes; never skip a case or checkpoint assertions based on capture policy.
- Required primary image `screenshot.png` beside every case; named extra checkpoints only when needed. No evidence binaries under plans.
- Enabled capture failures fail the run. Disabled capture yields `skipped` in transient run output, never a new fresh-evidence/review record.
- Human inspection mandatory; automation cannot sign on a person's behalf. CI proves functionality, not visual acceptance.

## Architecture
- New pure `e2e/fixtures/capture-policy.ts` supplies one Node policy to Playwright and both Vitest browser configs (including `browser.screenshotFailures`). `capture-evidence.ts` handles complete-application captures, colocated paths, provenance and checkpoints. Retire old arbitrary-buffer helper; migrate genuine evidence callers; remove component-to-E2E image writes.
- Capture helper accepts real `Page`, case/checkpoint identity, and run context; derives an allowlisted relative destination from case location. No absolute caller-specified directories, parent traversal, element locators, clips or masks.
- Before capture assert actual fixture URL, application shell/navigation and relevant connected project/state. For privacy verify shell before activation and keep underlying routed content mounted; do not require it to remain accessible while inert.
- Capture `type: png`, `fullPage: false`, `scale: css`, fixed viewport/DPR; wait for fonts and real loaded-data states. Disable animations only for the capture; no DOM/style rewriting to hide defects.
- Stage captures under ignored temporary output. Publish case images and `evidence.json` only after every required assertion and service teardown succeeds. Failed/partial run leaves no new passing freshness record. Clean staged output on all failures.
- Case `evidence.json`: run ID, command, started/completed UTC times, case/test/checkpoint, real route, Git HEAD, dirty-source fingerprint, seed digest, browser/version/OS, viewport/DPR and measured dock width, image filename/SHA-256, functional outcome and cleanup outcome. Exclude auth secrets, personal/temp-home absolute paths and unrelated payloads.
- Source identity: HEAD plus digest of relevant tracked working-tree and untracked app/shared/server/spec/fixture/config/dependency files; exclude generated outputs, evidence/reviews, logs, plans and unrelated documentation to avoid self-invalidating captures. Record at service start and recheck at finish; relevant source changes during capture invalidate the run. A dirty checkout is honest evidence only with its exact fingerprint; HEAD alone is insufficient.
- Review: `review.md` beside each case records reviewer, review UTC time, matching run/image hashes/source identity, inspected checkpoint list, layout/input outcome and accepted/rejected decision. A fresh capture resets review to pending; never silently carries old approval.
- Default runner screenshot/video/trace off. This satisfies capture-disabled CI even on failure. Optional debug traces/images must use the same explicit enabled policy; easiest initial design leaves them off and retains text/JSON reports plus redacted service logs.

## Related code files
- Create `packages/ui/e2e/fixtures/capture-policy.ts`, `capture-evidence.ts`, and behavior tests for policy/freshness boundaries following existing unit conventions.
- Remove `packages/ui/e2e/e2e-capture-helper.ts` after callers cut over.
- Modify three new `.spec.ts` cases and Playwright config.
- Replace each case's stale `screenshot.png`; add necessary named checkpoints, `evidence.json`, `review.md`.
- Modify `.gitignore` for Playwright report/test-results/staging files; do not ignore colocated reviewed evidence.
- Update `docs/testing.md` and `AGENTS.md` in Phase 05.

## Implementation Steps
1. Implement and unit-test capture precedence, invalid values, skipped behavior and capture/publication error propagation. Tests protect consumer-visible gates, not helper invocation counts or source strings.
2. Derive case destinations from repository paths, validating containment. Check policy before requesting screenshots, creating directories or touching existing evidence.
3. Record source/seed/run provenance and stage page captures at meaningful checkpoints. All checkpoint functional assertions happen regardless of policy.
4. Publish after passing test and cleanup; do not label failed or incomplete captures fresh. A capture/decode/write failure makes enabled run nonzero.
5. Generate fresh images for all three actual journeys using `E2E_CAPTURE=1`; verify PNG decoding and viewport dimensions, not extension alone.
6. Open every image. Inspect application context, frost usability/coverage, route editor theme/open state, and narrow-panel wrapping/actions. An agent inspection may add observations but is not the required human approval.
7. Request actual human inspection and a matching signed review record. Until supplied, functional gate may pass but visual acceptance remains pending. Refresh and re-review after relevant changes; no baseline approval to silence a failure.

## Todo list
- [ ] Unified capture policy and error/freshness boundaries.
- [ ] Application checkpoint/provenance publication.
- [ ] Fresh local images; real human inspection records.
- [ ] Disabled-mode no-image/no-evidence-write proof.

## Success Criteria
- Acceptance E01–E07 and C01–C04 in [matrix](./acceptance-checks.md) pass; human gate E04 explicitly remains unaccepted if no person reviewed.
- Enabled runs replace images with decoded complete-application viewport screenshots; metadata matches tested source and exact image bytes.
- Capture-disabled success and deliberately failing runs neither call screenshot generation nor change evidence/review files; no hidden image/video/trace capture.
- Missing/stale/component-only image, wrong source identity, hash mismatch or pending human review fails acceptance even if functional CI is green.

## Risk Assessment
- Contributor/reviewer discipline is irreducible: metadata supports provenance, not cryptographic proof of human inspection.
- Dynamic timestamps/terminal cursors may vary; fixed seeds/fonts/locale and meaningful readiness stabilize evidence without hiding real UI.
- Partial multi-file publication or source drift: stage files, publish manifest last, validate image hashes; no acceptance from orphaned image files.

## Security Considerations
Only deterministic non-sensitive data in captures. Credentials remain runtime-only; avoid traces/HAR that could expose bearer/session material. Review records contain no tokens.

## Next steps
Phase 05 runs acceptance locally and under CI-disabled capture. Unresolved questions: no design blocker; actual human reviewer must perform inspection during implementation acceptance.
