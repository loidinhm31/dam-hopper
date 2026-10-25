# PR74 remediation — independent revised-plan review

## Status
**Complete review; revision required before plan readiness.** Three medium-severity contract/qualification findings below. No critical/high finding established. R1, R2 and R4 are adequately specified as future implementation gates; R3/R5 remain incomplete at the evidence-production boundary. This report neither authorizes implementation nor supplies final user validation.

All conclusions are **static source/plan analysis**. No new runtime observations. Historical execution results are attributed only to the initial triage, not independently reproduced.

## Inspected Files
Paths below are repository-relative unless explicitly HOME-qualified; ranges inclusive.
- `plans/261025-0731-pr74-review-remediation/plan.md:1-80`.
- `plans/261025-0731-pr74-review-remediation/phase-01-editor-content-integrity.md:1-248` (including untruncated lines 35/39).
- `plans/261025-0731-pr74-review-remediation/phase-02-gateway-coordinate-proofs.md:1-160` (including untruncated line 24).
- `plans/261025-0731-pr74-review-remediation/phase-03-session-lifecycle.md:1-155`.
- `plans/261025-0731-pr74-review-remediation/phase-04-release-and-config-boundaries.md:1-221`.
- `plans/reports/review-261025-0731-pr74.md:1-113`.
- `docs/architecture/semantic-websocket-gateway.md:109-407`; `docs/system-architecture.md:1-45,235-270`.
- `docs/project-overview-pdr.md:1-88`; `docs/code-standards.md:1-103`; `README.md:1-109` (long unrelated lines may be truncated).
- `packages/ui/src/stores/editor.ts:274-328` (especially 305-311).
- `packages/ui/e2e/fixtures/capture-evidence.ts:1-317`; `capture-policy.ts:1-39`; `application-fixture.ts:1-84` under the same fixture directory.
- `packages/ui/e2e/fixtures/application-services.ts:1-263,281-424`; `image-builder.ts:1-97`.
- `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts:1-83,309-401`; `packages/ui/playwright.config.ts:1-69`.
- `server/src/semantic/gateway.rs:1769-1978`; `server/tests/semantic_websocket.rs:1-243,1486-1613`.
- Targeted searches additionally inspected semantic-test references in `server/tests/semantic_websocket.rs`, Git removal/invalidation references in `server/src/api/git.rs` and `server/src/git/worktree.rs`, and version/retrieval declarations in `packages/ui/package.json` and `deploy/release/semantic-engine/stage-semantic-engine.mjs`.
- Review/schema authority: `~/.omp/agent/skills/planning/references/plan-review.md:1-46`, `task-management.md:1-137`; planning/code-review skills and published development/agent guidance; `memory://root/memory_summary.md` (context only).

## Findings

### P1 — Medium: final evidence owner cannot write its required capture artifacts
- **Plan:** `plans/261025-0731-pr74-review-remediation/phase-04-release-and-config-boundaries.md:63-67,161-193`. Integration must publish `packages/ui/e2e/semantic-navigation/evidence.json`, `review.md` and screenshots, but its authoritative `allowed_files` contains only four documentation paths (172-177). No task owns the generated evidence/review/PNG paths.
- **Supporting source/spec:** `packages/ui/e2e/fixtures/capture-evidence.ts:246-309` copies screenshots and writes both files into each case directory. `~/.omp/agent/skills/planning/references/task-management.md:45,94-96` defines literal writable ownership and scoped handoff contracts; `plans/261025-0731-pr74-review-remediation/plan.md:39` makes task fences authoritative.
- **Failure scenario:** coordinator claims integration under the durable contract, runs successful capture, and writes outside its declared scope. Enforcing scope instead prevents required evidence publication. A prose owner is insufficient when its writable contract excludes the deliverable.
- **Impact:** R3/R5 ownership gap; required terminal artifacts cannot be delivered within the declared task boundary.
- **Confidence:** high; direct plan/source mismatch, not an observed tool refusal.
- **Smallest correction:** add literal capture-output paths (or the case directory, with a no-source-edits constraint) to integration ownership. Its existing dependencies already serialize this with both spec writers. Preserve separately authorized human review; automation must not mark acceptance.

### P2 — Medium: prescribed acceptance command can pass without publishing evidence
- **Plan:** `plans/261025-0731-pr74-review-remediation/phase-04-release-and-config-boundaries.md:67,182,190-192,208` requires capture outputs but gives an unqualified Playwright command and no capture/publication assertion.
- **Supporting source:** `packages/ui/e2e/fixtures/capture-policy.ts:4-10,28-35` disables capture by default under CI. `capture-evidence.ts:117-119,208-226` returns without capturing/publishing when disabled or when no checkpoints exist. `application-fixture.ts:46-49` awaits finalization but does not require `published: true`.
- **Failure scenario:** run the planned command with `CI=1` and no `E2E_CAPTURE`; functional assertions pass, capture is skipped, and existing checked-in `evidence.json`/`review.md`/PNGs remain untouched. File existence alone can therefore present old evidence as the remediation receipt.
- **Impact:** R3's explicit fresh evidence gate is not deterministic; separate human review may receive no fresh run to inspect.
- **Confidence:** high; follows current capture policy/finalizer, not an executed CI result.
- **Smallest correction:** prescribe `E2E_CAPTURE=1` for the final capture run and require a positive publication receipt with fresh run ID/source fingerprint/checkpoint hashes plus successful test/cleanup outcomes. Fail the evidence gate on disabled/empty/unpublished capture; retain `PENDING_HUMAN_REVIEW` until separate human sign-off.

### P3 — Medium: container qualification prerequisite ignores existing runtime engine injection
- **Plan:** `plans/261025-0731-pr74-review-remediation/plan.md:52`; `phase-04-release-and-config-boundaries.md:16,65,183,209` treats absence of staged engine in the container image as an actual-web blocker, without carrying the existing runtime staging path into the qualification contract.
- **Supporting source:** `packages/ui/e2e/fixtures/image-builder.ts:48-84` builds the image, but `application-services.ts:42-71,212-229` separately verifies/stages and copies the engine into the running container before server startup (310-329). `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts:15-25` already selects `semanticEngine: true`. Its staging helper uses a verified cache or default staging, not `--retrieve-pinned` (application-services 53-70).
- **Failure scenario:** the documented image condition marks the current semantic fixture blocked even when runtime injection supplies the verified engine. Conversely, a clean runner stages Phase 04's arbitrary `$ENGINE_DIR` successfully but the E2E helper still looks in its fixed cache/default inputs; publication staging does not automatically satisfy this separate fixture prerequisite.
- **Impact:** R3 environment distinction is misleading; clean-run qualification handoff has no explicit connection to the actual fixture's engine inputs. Image omission is not itself evidence of runtime absence.
- **Confidence:** high for the static mismatch; clean-run execution outcome unmeasured.
- **Smallest correction:** document `semanticEngine: true` runtime injection and explicitly provision/verify the fixture's existing cache path using the pinned helper before E2E (or declare a narrowly owned fixture-input change). Block on actual staging/runtime verification failure, not image contents alone. Keep extracted-tarball qualification separate: container success does not prove publisher correctness.

## Coverage and sound contracts
- **R1 — covered:** disk → TextDecoder → pinned Monaco/wrapper → default BOM-less model value → conditional projection is explicit. Double-strip outcome preserves current materialization; changes require user decision. Full BOM/EOL/UTF-16/astral/multi-edit/CR-LF/flush/undo matrix and line/column/edit-commutation prerequisite precede projection and gateway dependents (`phase-01:24-37,62-65,121-134`). These remain planned proofs, not already verified behavior.
- **R2 — covered at plan level:** full baseline SHA/disposable-worktree overlays and identical before/after gates exist for F1/F3/F9/F4. F3/F9 require async barriers rather than sleeps, preserve the vulnerable interleaving and reject fixture/quota failures as reproductions (`phase-01:41-45`; `phase-02:30-36,50-57`; `phase-04:33-38,54-58`). No deterministic reproduction is claimed by this review.
- **R3 — partly covered:** mock supervisor fixture vs dedicated real-tuple replay/Ping file is unambiguous; failed-OFF spec has an exact owner. One integration coordinator owns final acceptance and Playwright currently uses one worker. Pending human review is correctly distinguished from automation. P1-P3 prevent complete evidence/environment certification.
- **R4 — covered:** release hold, unsaved-draft preservation/export before reload/downgrade, no force-save, avoidance of config-hosting worktree mutations, and full rollback SHA are propagated across overview/phases. OFF is explicitly insufficient for F1/F4 (`plan.md:55-60`; `phase-01:17,160,239`; `phase-04:22,120,212`).
- **R5 — structurally covered except P1:** manually traced all 15 unique task IDs, seven-field records, markers and dependencies. Graph is acyclic; shared source/test paths are ordered; simultaneously eligible task slices are disjoint. Final integration depends transitively on every repair. No hydration or helper validation performed.
- Immutable query proof, logical cancellation/deadline ownership, terminal exhausted actors, complete overlay replay, Ping-independent idle eviction, fail-closed upgrade timeout and Git effect-first guard matrix align with the triage and existing boundary owners. No additional material design defect established in those contracts.

## Checks Performed vs Not Performed
**Performed:** read all five selected plan files; compared R1-R5 with initial F1-F13 triage and requested repository references; statically traced capture enablement/publication, container staging and gateway race boundaries; manually checked task schema/markers/DAG/parallel ownership. Only this report was written.

**Not performed:** product/plan edits, task-state changes/hydration, builds/typechecks/tests, package/engine retrieval, installation, disposable baseline worktrees, browser/container/release execution, native-host qualification, human screenshot acceptance, commit/push. Pinned Monaco internals were not independently inspected: the plan correctly makes that a blocking future prerequisite; node_modules discovery was access-blocked. Historical runtime findings were not rerun. No implementation TODO is required complete in this plan-only assignment.

## Unresolved Questions
- No new product-choice question. P1-P3 need bounded plan corrections before readiness/revalidation.
- Future evidence remains intentionally pending: exact pinned materialization/coordinate proof, deterministic baseline regressions, actual fixture staging and extracted-release qualification, and separate human visual acceptance. This static review does not discharge those gates.
