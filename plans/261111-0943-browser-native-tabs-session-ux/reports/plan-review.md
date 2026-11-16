# Independent Browser plan review

## Status and disposition
- **Review: COMPLETE.** Coverage complete for overview, design, all five phase contracts and relevant supporting source boundaries; not a whole-codebase audit.
- **Plan readiness: corrections required.** Two High findings (F1/F2), one Medium (F3); no Critical finding established. Review completion is not implementation authorization, user approval or product acceptance.
- Evidence is **static source/spec inspection only**. Failure scenarios below are deductions, not reproduced runtime failures. No source-tested behavior or native-host qualification claimed; prior reports' execution claims were not rerun or independently certified.

## Exact inspected scope
All paths repository-relative unless absolute. Ranges describe inspected source sections; search/declaration-only coverage is identified separately.

### Selected plan — complete contents
- `plans/261111-0943-browser-native-tabs-session-ux/plan.md:1-57`
- `plans/261111-0943-browser-native-tabs-session-ux/design.md:1-189` (including full long lines 94/115/138/142).
- `plans/261111-0943-browser-native-tabs-session-ux/phase-01-owner-and-state-contracts.md:1-85`
- `plans/261111-0943-browser-native-tabs-session-ux/phase-02-persistence-and-lifecycle.md:1-96`
- `plans/261111-0943-browser-native-tabs-session-ux/phase-03-tab-root-resources.md:1-88`
- `plans/261111-0943-browser-native-tabs-session-ux/phase-04-native-chrome-and-launches.md:1-100`
- `plans/261111-0943-browser-native-tabs-session-ux/phase-05-qualification-and-docs.md:1-138` (including complete command line 27).
- Same directory `reports/coordinator-decisions.md:1-39`, `reports/ui-evidence.md:1-108`, `reports/session-evidence.md:1-248`, `reports/planner-report.md:1-56`.

### Current source — substantive sections
- `packages/ui/src/api/connections.ts:91-119,169-184,400-510,570-680`; `packages/ui/src/api/auth-client.ts:440-475`.
- `packages/ui/src/api/server-config.ts:115-135,606-620`; `packages/ui/src/api/browser-host-client.ts:1-75,89-168,175-240`; `packages/ui/src/api/browser-host-types.ts:1-185`.
- `packages/ui/src/os/apps/BrowserApp.tsx:162-365,675-905`.
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:57-123,359-440,480-565,745-905,980-1257,1490-1540`.
- `packages/ui/src/os/browser-session-sync.ts:1-138`; `packages/ui/src/os/window-store.ts:1-190`.
- `packages/ui/src/os/persistence.ts:1-80,193-247,633-720,786-900,1038-1080`; `packages/ui/src/os/recipes/launch-records.ts:1-45`.
- `packages/ui/src/os/action-executor.ts:330-390,480-548`; `packages/ui/src/os/OsShell.tsx:650-705`; `packages/ui/src/os/deep-links.ts:550-603`.
- `packages/ui/src/os/recipes/recipe-engine.ts:240-260,390-480`; `packages/ui/src/os/recipes/schema.ts:280-305,420-445`.
- `server/src/browser_host/session.rs:1-20,375-405,565-675,715-731,1284-1295`; `server/src/browser_host/config.rs:1-40`; `server/src/browser_host/auth.rs:258-275,379-389`.
- `server/src/api/browser_host.rs:145-175,400-570`; `server/src/api/auth.rs:1005-1022,1058-1078`.
- `packages/ui/package.json:1-76`; `packages/ui/e2e/fixtures/host-browser-app.ts:20-42,62-71,241-525,533-584`.
- `packages/ui/e2e/fixtures/host-browser-journey-driver.ts:1-148`; `packages/ui/e2e/os-host-browser/navigation.spec.ts:1-182`; `packages/ui/e2e/os-host-browser/selection.spec.ts:440-530`.
- `packages/ui/e2e/fixtures/capture-evidence.ts:1-130,215-317`.
- `packages/ui/browser-tests/host-browser-input.browser.tsx:1-55`; `packages/ui/browser-tests/host-browser-android.browser.tsx:1-55` (lower-layer harness boundaries only).

### Specifications / supporting context
- `README.md:1-126`; `docs/project-overview-pdr.md:5-20,126-148`; `docs/code-standards.md:18-60,179-183,240`; `docs/design-guidelines.md:7-16,89-96,148-156`.
- `docs/system-architecture.md:44-54,120-126,150-165,478-488`; `docs/architecture/host-browser-cdp-streaming.md:529-565`; `docs/testing.md:209-250`.
- `plans/261109-2251-host-browser-review-remediation/plan.md:1-51` (overlap classification only).
- Installed `/home/loidinh/.omp/agent/skills/planning/SKILL.md:1-113`, `planning/references/plan-review.md:1-46`, `planning/references/task-management.md:1-137`; `code-review/SKILL.md:1-143`, `code-review/references/verification-before-completion.md:1-139` under the same skills root.
- Installed `/home/loidinh/.omp/agent/evcrate/AGENTS.md:1-56`, `workflows/development-rules.md:1-44`, `workflows/primary-workflow.md:1-48`; `memory://root/memory_summary.md:1` for process context only.
- Additional targeted searches: Browser host public API callers across `packages/ui`; profile creation/auth principal fields; Browser/human-review/locking clauses in the cited docs; fixture assumptions in `host-browser-input`, `host-browser-android`, `os-shell`, `os-recipes` browser suites. Search hits are not full-file reviews.
- Exclusions: remaining large-file bodies/docs, backend media/CDP internals, unrelated applications, physical Android/Windows/audio-listening/soak qualification, full related-plan phase reviews, unimplemented proposed modules. Declaration maps alone did not establish behavior.

## Findings

### F1 — High: global recovery document has only page-local serialization
- **Plan:** `plans/261111-0943-browser-native-tabs-session-ux/phase-02-persistence-and-lifecycle.md:11-12,53-54`; `design.md:80-91,105,115-117`; group consumption also `phase-04-native-chrome-and-launches.md:17`.
- **Evidence:** proposed recovery key is origin-global, contains all owners' groups/operations/suppression; contract specifies only a same-page writer. Existing cross-document precedent: `packages/ui/src/os/recipes/launch-records.ts:12-33` uses exclusive Web Locks and fails closed when unavailable; `packages/ui/src/os/persistence.ts:1056-1068` distinguishes Web Locks from memory-only fallback. A localStorage item write does not make a multi-call read/modify/write transaction cross-document atomic.
- **Failure scenario [INFERENCE]:** two same-origin browser-client tabs read document D; A writes pending-create marker P then sends POST; B completes an unrelated recovery update using D and overwrites P. A reloads after losing the response: required unknown notice/blocker has vanished. The same race can consume one saved group twice or erase another tab's durable clear suppression, allowing sensitive URLs to reappear. Different owner scopes still collide because they share one document.
- **Impact/confidence:** High; loses the fail-closed prerequisite after a real remote mutation, risking duplicate pages/target-budget exhaustion and privacy regression. High confidence from explicit writer/key contracts; not runtime reproduced.
- **Smallest correction:** specify one origin-wide exclusive lock for every recovery read/modify/write, operation settlement, clear and group consumption; reread inside lock, preserve unrelated/unknown records. Reuse existing Web Locks API, not backend infrastructure; block affected durable mutations if locking unavailable rather than memory-only fallback. Define fresh suppression observation for other open documents before their OS address saves (notification alone is not mutual exclusion).
- **Propagation/check:** update design, phase-02 projector/lifecycle acceptance, phase-04 consumption and phase-05 A05/A10/A11/A15 checks. Add two independent same-origin documents interleaving operation writes/settlement/clear/consume; assert no lost marker/suppression and single consumption. Existing recovery/persistence tests and recovery live spec are writable locations; no new backend service needed.

### F2 — High: destructive reference census confuses profile ownership with native target identity
- **Plan:** `plans/261111-0943-browser-native-tabs-session-ux/design.md:29,121`; `phase-02-persistence-and-lifecycle.md:18,84`; manual inventory attachment at `:20`.
- **Evidence:** scope includes `profileId`; DELETE eligibility compares `(scope,sessionId)`. `packages/ui/src/api/server-config.ts:606-619` creates independently identified profiles without endpoint uniqueness. `server/src/browser_host/auth.rs:381-388` derives principal from actor, not frontend profile ID; `server/src/browser_host/session.rs:715-729,1285-1294` exposes the same target inventory to that principal. `server/src/api/browser_host.rs:550-565` closes the exact native session. Coordinator requirement `reports/coordinator-decisions.md:11` protects other same-client shared views.
- **Failure scenario [INFERENCE]:** local profiles A/B point to the exact same endpoint and verified principal/namespace. A creates target S; B explicitly attaches S through the planned inventory. Closing A's view sees no other `(A-scope,S)` reference and DELETEs S, destroying B's still-open page/form state. These are two views in one client, not the already-disclosed unknowable cross-client case.
- **Impact/confidence:** High; destructive loss of another retained view's remote state, violating shared-target closure. High confidence for identical normalized endpoint strings and verified identities; no endpoint-alias discovery assumed.
- **Smallest correction:** retain profile-qualified scope for metadata, authority and request routing, but key deletion census/final-reference lock/closing-target attach exclusion by verified native identity `(endpoint,principal,namespace,sessionId)` across local profile IDs (include current runtime identity where available). Do not transfer authority between profiles; retiring a view still uses its own captured owner and rechecks after awaits.
- **Propagation/check:** revise design close/reference contract, phase-02 lifecycle/inventory tasks, A04/A08/A09 tests and corresponding phase-05 journeys. Add two local profiles on identical endpoint/principal, shared selected target, close-one/no-DELETE, final-close/exactly-one-DELETE; owner mismatch must still deny I/O. No new backend registry required.

### F3 — Medium: visual acceptance omits mandatory human receipt and conflicts with capture destination
- **Plan:** `plans/261111-0943-browser-native-tabs-session-ux/phase-05-qualification-and-docs.md:17,32,91-104`; `design.md:177`.
- **Evidence:** `docs/testing.md:219-250` and `docs/code-standards.md:240` require colocated image/evidence/review artifacts and actual human identity, timestamp, source/run/image hashes plus ACCEPTED/REJECTED. `packages/ui/e2e/fixtures/capture-evidence.ts:31-69,246-309` publishes into an E2E case directory, always initializes PENDING_HUMAN_REVIEW; it does not publish only to Playwright output. Existing `packages/ui/e2e/os-host-browser/navigation.spec.ts:16,68,133-139` follows that contract.
- **Failure scenario [INFERENCE]:** automation and an agent inspect successful screenshots, record “visually reviewed” in implementation-verification, and satisfy task wording while required human review remains pending. Alternatively, implementer must bypass the approved helper to honor output-only wording. Verification task currently permits writing only the report, not the helper-generated case artifacts/ledger.
- **Impact/confidence:** Medium; invalid visual qualification and contradictory writable/output contract, not evidence of a current visual defect. High confidence.
- **Smallest correction:** choose exact colocated case directory/artifact ownership using the existing helper; allow its evidence outputs (attachments may duplicate them; they are not golden baselines). Separate automated functional/capture outcomes and agent inspection from mandatory operator decision. Name receipt owner; pending/rejected human review remains an explicit visual qualification gate, never an agent-synthesized ACCEPTED. Propagate to phase-05 prose/task acceptance/allowlist/report and A13.

## Other challenged contracts
- **Existing API ambiguity boundary is honest:** `design.md:111-117` forbids uncertain key replay, URL matching and empty-list proof; exact-ID inventory actions do not settle an unknown POST. TTL/source DTO support this limit (`session.rs:15,375-403,586-608`; `browser-host-types.ts:95-120`). No requirement justifies new backend infrastructure.
- `browser-host-client.ts:123-158` can discard a response after generation retirement. Such a result belongs to the expressly documented late-unpublishable/create-unknown branch, not guaranteed late-ID cleanup. A09 exact-result cleanup must not be reported as universal cleanup across owner retirement. Persistent unresolved notices/capacity impact are real residual limitations, already disclosed.
- Principal/endpoint/dev binding, no JWT/user-label trust, popup lifetime exclusion, ordinary query/hash plaintext warning, userinfo rejection and clear suppression are explicit. Same-tab OAuth secrecy is correctly not promised. F1 affects suppression durability, not this settled privacy policy.
- Active-only paired sockets/PCM/input, synchronous hide, stable tuple resources and conditional popup focus/completion preserve current architecture. Lazy hidden-popup reconciliation honestly permits stale hidden state; active-only is not OS-focus-only.
- Default reopen versus server-restart/manual Reload, blank New Window, explicit URL launch, recipe metadata-only migration and unchanged terminal-only recipe execution are distinguished. Default target/viewer limits stay 2; no silent eviction or fabricated occupancy.
- Ordering/ownership: Gate 1 precedes code; 11 tasks are dependency-serialized through Gate 2; affected source/test families are assigned. Cross-plan source writers require serialization, not inherited whole-plan blocking. F3 is a concrete evidence-write omission; F1/F2 corrections must reach task contracts, not only an appendix.
- Rollback is deliberately destructive-operation-aware: no old-code/new-schema load, no marker deletion or remote-target deletion to force rollback success (`design.md:187`). This is a future operator procedure, not tested reversibility or a guarantee to recover already-closed DOM state.

## Checks performed / not performed
- Performed: read-only contract/source/spec comparison, caller searches, dependency/writable-coverage reasoning, static concurrency/failure scenarios, URL/identity/resource/rollback and visual-governance review; wrote only this assigned report.
- Not performed: tests, compilation/typecheck/build/lint, browser/server execution, installs, Git commands, runtime fault injection, source edits, plan/task-state edits, hydration, nested agents or external research. Did not duplicate coordinator's reported syntax/schema validator. No pass percentages, benchmark claims or user approval inferred.

## Unresolved questions
- No additional user product decision established. Planner/coordinator must settle F1/F2 correctness contracts and F3 evidence ownership/human gate before readiness; no proposed correction is yet accepted or implemented.
