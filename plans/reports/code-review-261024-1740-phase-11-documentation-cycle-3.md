# Phase 11 Documentation Review — Cycle 3

## Score: 7/10 — Changes requested

Reviewed security-contract accuracy, performance/resource claims, architecture, and YAGNI/KISS/DRY after Cycle 2. Main architecture and release wording improved, but the inspected protocol guide still contains the two high-priority contract errors reported in Cycle 2. The supplied remediation summary and current file contents disagree; findings below describe the inspected worktree, not presumed fixes. No runtime changes are included in the reviewed diff; runtime correctness was not independently requalified.

## Critical issues

None identified in this documentation-only change. This is not a fresh runtime security or performance qualification.

## Warnings

### W1 — High: Destination wire metadata remains incorrect

- **Location:** `docs/semantic-lsp-protocol-guide.md:267-276`.
- **Observed:** Line 274 still says destination version is `0` for unopened files; line 275 omits nullable incarnation. The promised Cycle 3 correction is absent from the inspected guide.
- **Evidence:** `server/src/semantic/gateway.rs:1750-1755,1950-1961` uses `None` for version/incarnation when not user-open; `server/src/semantic/uri.rs:652-658` serializes both fields as JSON `null`. The shipped client distinguishes null from an overlay version (`packages/ui/src/api/semantic-client.ts:1105-1118`).
- **Impact:** Guide-based consumers can incorrectly reject valid unopened-file navigation or conflate internal pin version zero with an open user overlay. This does not establish a shipped-client vulnerability.
- **Correction:** Document both fields as `number | null`, with null for unopened on-disk destinations. Explain bounded FIFO pin-and-requery, validated destination provenance membership, and server-side range-in-content checking before client content/reveal validation. Actual pinning is bounded to four unopened destinations and document-size limits (`gateway.rs:1682-1707,1759-1768,1969-2012`; `uri.rs:644-650`).
- **Confidence:** High.

### W2 — High: Authoritative replay contract still omits root and actor

- **Location:** `docs/semantic-lsp-protocol-guide.md:291-297`.
- **Observed:** Replay enumeration still names only `profileId`, `generation`, `project`, `targetRef`, and `endpoint`. The guide contains no `configuredRoot` or actor provenance contract.
- **Evidence:** `packages/ui/src/api/semantic-client.ts:387-413` checks profile/project/target plus captured and live provenance; `:824-838` does so **before reading model text**. `packages/ui/src/lib/semantic-model-uri.ts:93-128` requires configured root, normalized endpoint, and actor (`credential:<SHA-256 of token>` or `no-auth`), failing closed when provenance is missing.
- **Impact:** A guide-based client can replay retained dirty text to a changed root or replacement login with otherwise identical labels. The shipped implementation has the stronger gate; this finding is documentation-contract incompleteness, not evidence that gate is absent.
- **Correction:** State complete root/actor/endpoint/owner/target checks and before-read/upload ordering. Distinguish replaceable wire generations from captured immutable provenance so matching reconnect remains possible.
- **Confidence:** High.

### W3 — Medium: Recovery reconciliation remains incomplete in PDR

- **Locations:** `docs/project-overview-pdr.md:44,99`.
- **Observed:** PDR still promises “exponential auto-reconnect backoff” on `-32005`, contradicting corrected gateway architecture (`docs/architecture/semantic-websocket-gateway.md:373-378`) and system architecture (`docs/system-architecture.md:673`).
- **Evidence:** `packages/ui/src/api/semantic-client.ts:1275-1290` retires the invalidated attempt and schedules a reconnect after a fixed 1,000 ms; it does not implement the documented exponential delay.
- **Impact:** Product and authoritative architecture describe incompatible recovery behavior. Cycle 2 W3 is partially, not completely, resolved.
- **Correction:** Replace both PDR claims with the fixed-delay admission-invalidation behavior or link to the canonical recovery contract. Keep this separate from child crash restart backoff, which genuinely uses 1s/3s stages.
- **Confidence:** High.

### W4 — Medium: Cached-integrity summaries still obscure authorization boundary

- **Locations:** `docs/project-overview-pdr.md:88`; `docs/codebase-summary.md:89`.
- **Observed:** Both retain “off-thread cached SHA-256 integrity verification” without explaining the fresh execution-authority checks. The main architecture now correctly rejects cached authorization and distinguishes 10s server navigation from 5s client cancellation (`docs/system-architecture.md:546,558`).
- **Evidence:** `server/src/semantic/supervisor.rs:569-585,667-683,746-750` requires fresh verification for enable/launch; `server/src/semantic/session.rs:887-905` checks before child initialization/restart. `supervisor.rs:149-165` hashes off-thread under a held semaphore permit. Cached status is diagnostic only (`:662-665`).
- **Impact:** Readers of current summaries can infer cached success authorizes later execution. This is a wording/consistency defect, not a missing implementation integrity gate.
- **Correction:** State “fresh serialized off-thread verification at enable/launch/restart; cached status for diagnostics only,” or replace duplicated detail with a canonical link.
- **Confidence:** High.

## Cycle 2 disposition / Positive observations

- **W1/W2:** Not resolved in the inspected protocol guide; precise remaining defects above.
- **W3:** Gateway recovery timing and stale open R1/C2/R3 caveats corrected; PDR recovery wording remains W3 above. Architecture now records remediation dispositions rather than presenting those issues as open.
- **W4:** Main architecture cached-authorization, future-admission narration, and server timeout corrected. Summary wording remains W4 above. Server timeout source is 10s (`server/src/semantic/resources.rs:60-61`).
- **W5:** Public scaffold-purge language narrowed in `docs/CHANGELOG.md:7`, `docs/system-architecture.md:741`, and `docs/project-overview-pdr.md:102` to documentation reconciliation/generic-section removal and packaging checks. No longer claims named runtime scaffolds were removed by this documentation diff. Phase checklist finalization remains Main-owned.
- Portable-only production status, lack of hard RSS/CPU or filesystem sandbox guarantees, default-OFF, current-admin mutation, native deferral, and pending human visual review remain explicit.
- No runtime allocation/computation, dependency changes, generic engine registry, or additional execution paths introduced by this phase.

## Suggestions

1. **DRY/KISS:** Keep schema, replay provenance, recovery timings, and integrity authority in canonical sections; summarize elsewhere with links. Repeated long phase histories in PDR/summary/architecture are demonstrably drifting.
2. **Sync terminology:** Replace “`TextDocumentSyncKind.Full`” resync wording (`docs/semantic-lsp-protocol-guide.md:424`, `docs/api/websocket.md:150`, gateway architecture `:371`) with “range-less full-content `didChange` under the negotiated Incremental sync kind.” Resync does not renegotiate capability `2`.
3. **Error taxonomy completeness:** Name `CONNECTION_TREE_LIMIT` and `GLOBAL_TREE_LIMIT` alongside other `-32004` identifiers in the authoritative guide (`:409`); actual identifiers are in `server/src/semantic/gateway.rs:747-763`.
4. **Rollback failure stop:** Explicitly stop the documented rollback sequence if OFF/inspection fails or resources remain; inspect `transitionError`/runtime state. Current runbooks describe successful quiescence only (`docs/deployment-guide.md:130-144`; `docs/linux-systemd.md:346-359`). Static/manifest checks do not establish real systemd rollback behavior.
5. **Final delivery/status:** Include the untracked protocol guide. Main should reconcile parent `plan.md:16,52` (Phase 11 pending) with delivered roadmap claims after review disposition. Preserve approved Phase 10 administrative acceptance and pending human review. Phase 11 `:82,89,99` still uses broad checked human-acceptance/residue claims; align these with actual documentation-only evidence instead of implying new human approval or runtime scaffold removal.

## Reviewed files

Relevant changes/sections across all 17 scoped documentation/phase files:

- `README.md`
- `docs/CHANGELOG.md`
- `docs/api-reference.md`
- `docs/api/transport-and-events.md`
- `docs/api/websocket.md`
- `docs/architecture/semantic-websocket-gateway.md`
- `docs/code-standards.md`
- `docs/codebase-summary.md`
- `docs/configuration/index.md`
- `docs/configuration/server-runtime-settings.md`
- `docs/deployment-guide.md`
- `docs/linux-systemd.md`
- `docs/project-overview-pdr.md`
- `docs/project-roadmap.md`
- `docs/system-architecture.md`
- `docs/semantic-lsp-protocol-guide.md` (new/untracked)
- `plans/260901-1000-lsp-server-integration/phase-11-documentation-roadmap-changelog-and-release-cleanup.md`

Supporting evidence: parent `plan.md`; Cycle 2 review report; `packages/ui/e2e/semantic-navigation/review.md`; `server/src/semantic/{gateway.rs,uri.rs,resources.rs,supervisor.rs,session.rs}`; `packages/ui/src/{api/semantic-client.ts,lib/semantic-model-uri.ts,components/organisms/EditorTabs.tsx}`.

**Updated plans:** None. Main retains task/status ownership. Only this review report created.

## Validation commands/results

**Reviewer exercised:**

- `git diff --stat && git status --short`: 16 tracked modified files (+160/-79), plus new untracked guide and prior reports at review start.
- `git diff -- README.md docs`: inspected tracked documentation changes; new guide inspected separately.
- Focused read/grep comparisons of actual source and documentation substantiate W1–W4. No reviewer-run build/test/linter/formatter/deployment; no duplicate checks against the tester's already completed gates.

**Independent tester evidence inspected:** `agent://Phase11TesterCycle3` terminal report and raw manifest/library/lint outputs (`artifact://72`, `artifact://74`, `artifact://76`). Results below are tester execution, not reviewer reruns:

| Command/check | Result |
| --- | --- |
| Scoped internal link/anchor scan | 231 links across 17 files resolve; 0 broken |
| `node /home/loidinh/.omp/agent/evcrate/scripts/validate-docs.cjs docs/` | Exit 0; 306 working links; 812 code-reference / 375 config-key heuristic warnings |
| `cargo test --test linux_release_manifest --test linux_release_manifest_errors` (`server/`) | 49 passed, 0 failed |
| `cargo test --lib semantic --test semantic_tool_profile` then `cargo test --test semantic_tool_profile` (`server/`) | 49 library + 11 profile passed; first command filtered all profile tests, corrected command executed them |
| `pnpm --filter @dam-hopper/ui test --run src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts` | 28 passed, 0 failed |
| `pnpm lint` | Exit 0; 0 errors, 174 warnings |
| `cargo check --all-targets` (`server/`) | Passed |
| `pnpm --filter @dam-hopper/ui build` | Typecheck passed |
| `pnpm --filter @dam-hopper/browser-bridge typecheck` | Passed |
| `pnpm --filter @dam-hopper/web build` | Passed |

**Total:** Tester records 137 selected automated tests passed. No coverage percentage measured. These checks do not validate every prose contract, establish fresh runtime security/performance qualification, exercise systemd rollback, or replace human visual acceptance.

Advisor consultation completed; its recommendations informed bounded findings/validation wording. Advisor did not independently verify the cited protocol/source excerpts.

## Unresolved questions

- Human visual reviewer/date/outcome remains pending in `packages/ui/e2e/semantic-navigation/review.md:3-5,25-26`; automation cannot supply this release sign-off.
