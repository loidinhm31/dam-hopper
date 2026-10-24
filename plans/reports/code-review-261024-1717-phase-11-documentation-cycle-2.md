# Phase 11 Documentation Review — Cycle 2

## Score: 7/10 — Corrections still required

Documentation materially improved; no critical runtime issue identified in this documentation-only change. Remaining authoritative-contract inaccuracies prevent closing all Cycle 1 warnings. Reviewed security/resource truthfulness, protocol interoperability, lifecycle ownership, rollback operations, and KISS/DRY. No product or plan edits; Main retains status ownership. This is not a fresh runtime security/performance qualification.

## Critical issues

None identified within the reviewed documentation change.

## Warnings

### W1 — High: Destination metadata correction introduces an incorrect wire value

- **Location:** `docs/semantic-lsp-protocol-guide.md:267-276`.
- Guide says `damHopperDestinationVersion` is `0` for unopened files and describes incarnation without its nullable case. Actual gateway constructs `version: None, open_incarnation: None` for unopened destinations (`server/src/semantic/gateway.rs:1748-1755,1947-1961`); URI serialization emits both fields as JSON `null` (`server/src/semantic/uri.rs:654-657`). Zero is an internal pinning distinction, not the published unopened-destination version.
- **Impact:** A client following the authoritative schema can require an overlay/version match for an unopened result and incorrectly reject valid navigation. Shipped client deliberately skips that match for null metadata (`packages/ui/src/api/semantic-client.ts:1105-1115`).
- **Correction:** Document `number | null` for both fields: active overlay version/incarnation when open; null when destination is not user-open. Explain server-side bounded FIFO pin-and-requery, provenance association, and range-in-content validation instead of only saying coordinates are pinned. The real validation is gateway/URI-side; client/Monaco additionally verifies destination content before reveal.
- **Confidence:** High.

### W2 — High: Authoritative replay contract still omits root and actor provenance

- **Location:** `docs/semantic-lsp-protocol-guide.md:291-297`.
- New enumeration lists profile/generation/project/target/endpoint but omits **configured project root and authenticated actor/credential identity**, the central Cycle 1 cross-owner upload protection.
- Actual `canAccessModel` first checks profile/project/target identity, then compares captured and live endpoint/root/actor provenance before reading model text (`packages/ui/src/api/semantic-client.ts:387-413,824-838`). `matchesSemanticProvenance` explicitly compares normalized URL, `configuredRoot`, and `actor` (`packages/ui/src/lib/semantic-model-uri.ts:119-128`).
- **Impact:** A guide-based implementation can replay retained dirty text into a changed root or replacement login with otherwise identical labels. This is a documentation defect, not evidence that the shipped gate is missing.
- **Correction:** State all exact binding checks, missing-provenance fail-closed behavior, and the before-model-read/upload ordering. Distinguish replaceable connection generations from immutable captured endpoint/root/actor provenance so genuine matching reconnect remains possible.
- **Confidence:** High.

### W3 — Medium: Recovery and resolved-security dispositions still contradict across current docs

- **Locations:** `docs/system-architecture.md:673`; `docs/project-overview-pdr.md:99`; newly linked authority `docs/architecture/semantic-websocket-gateway.md:352,356,373-378`.
- Architecture still promises exponential 1.5–10s jitter; PDR still calls reconnect exponential. Linked gateway architecture promises 1,500–10,000 ms and still labels R1 provenance protection and C2/R3 checks open. Updated `docs/api/websocket.md:90,153` explicitly directs readers there for authoritative recovery.
- Actual `packages/ui/src/api/semantic-client.ts:1275-1290` schedules one 1,000 ms timer; provenance gate exists as W2 evidence shows. `docs/system-architecture.md:679-680` itself records the review items resolved.
- **Impact:** W3/W5 are only partially remediated; clients/operators see incompatible current contracts and a false open security disposition.
- **Correction:** Reconcile all linked current authorities to the single 1,000 ms attempt, strict provenance, empty-result/no-original-query-retry resync, and actual closed dispositions. Prefer a canonical protocol recovery section plus links. Guide error table `:409` should also name actual `CONNECTION_TREE_LIMIT` and `GLOBAL_TREE_LIMIT` variants (`gateway.rs:747-763`) rather than mentioning their triggers without identifiers.
- **Confidence:** High.

### W4 — Medium: Current architecture still documents obsolete integrity authority and timeout

- **Locations:** `docs/system-architecture.md:546,551,558`; cached-verification summaries in `docs/project-overview-pdr.md:88`, `docs/codebase-summary.md:89`.
- Architecture claims a `toolchain_verified` AtomicBool prevents repetitive verification and says server `NAVIGATION_REQUEST_TIMEOUT = 5.0s`. Effective server constant is **10s** (`server/src/semantic/resources.rs:60-61`); fresh verification explicitly never authorizes from cached success (`server/src/semantic/supervisor.rs:667-683`). Architecture `:551` also leaves a per-connection atomic admission check described as future Phase 05 work.
- **Impact:** Cycle 1 W5 remains incomplete. Misstates integrity trust and server latency contracts; contradicts correct fresh-verification guidance in `docs/code-standards.md:94` and runtime settings `:70`.
- **Correction:** Explain fresh off-thread enable/launch/restart verification with observational cached status only; distinguish 10s server navigation deadline from 5s client cancellation; remove obsolete implementation-progress narration.
- **Confidence:** High.

### W5 — Medium: Scaffold-purge completion remains unsupported by the inspected change

- **Locations:** `docs/CHANGELOG.md:7`; `docs/system-architecture.md:741`; `docs/project-overview-pdr.md:102`; Phase 11 checklist `:89`.
- Still claims obsolete experimental scaffolds were purged. The inspected change contains documentation modifications plus the new protocol guide; no named scaffold removals or supporting removal record supplied. This does not prove historical cleanup did not occur; it means the claim is not evidenced here. Current obsolete prose also remains demonstrably present (W3/W4).
- **Correction:** Cite specific prior removal/evidence or narrow wording to the documentation/release checks actually performed. Do not infer product cleanup from successful manifest tests.
- **Confidence:** High for unsupported claim in this change; medium for absence of historical evidence.

## Suggestions

1. **DRY/KISS (Cycle 1 S1 remains):** Collapse repeated protocol, numeric-policy, and phase-history narratives into canonical contracts and short cross-links. Existing duplication caused the remaining recovery/integrity drift; no new abstraction or runtime feature is needed.
2. **Rollback failure stop:** Quiescence sequence and role-generic tool path are now present in both runbooks (`docs/deployment-guide.md:130-144`, `docs/linux-systemd.md:346-359`). Make failure behavior explicit: do not proceed on failed OFF/inspection or nonzero resources; inspect `transitionError`/runtime state before rollback. Current text only describes successful progression.
3. **Delivery/status finalization:** Step 1 heading is restored (`deployment-guide.md:28`), and protocol links exist. Guide remains untracked in the inspected worktree; include it in delivery. Main should reconcile parent `plan.md:16,52` (Phase 11 pending) with roadmap `:9,25` (delivered/complete) after review disposition, without erasing approved administrative Phase 10 completion or marking human visual acceptance complete. Phase 11 checked human-acceptance item `:82` should be described consistently with the actual pending human gate.

## Positive observations / Cycle 1 disposition

- W1 substantially corrected: PDR `:86`, architecture `:527-530`, standards `:97`, deployment `:25`, and protocol `:367-372` explicitly identify current portable-only production operation; no hard RSS/CPU or filesystem-sandbox inference.
- W2 negotiation schemas now match gateway attach/initialize payloads; stable URI and FIFO-not-synthetic-ack distinction corrected. Destination nullability/provenance detail still needs W1/W2 above.
- W3 corrected in guide, transport page, and WebSocket API; unreconciled authorities remain W3 above.
- W4 GET/PATCH authorization distinction corrected in architecture `:691`, consistent with `server/src/api/semantic_settings.rs:114-136`.
- W5 restart window corrected to 300s; integrity/timeout residue remains W4 above.
- W6 operational OFF/zero-resource/rollback sequence and `<release-root>` paths added; unconditional rollback-specific zero-survivor claim removed.
- W7 human-pending disclosure improved in roadmap, protocol, architecture, and changelog; approved administrative Phase 10 status preserved. No synthetic human approval detected.
- No runtime code/dependency/performance changes in the reviewed phase diff; no additional runtime complexity introduced.

## Reviewed files

All 16 assigned documentation/plan files (relevant sections and changes; approximately 1,200 documentation/source lines examined):

- `README.md`
- `docs/system-architecture.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/project-overview-pdr.md`
- `docs/project-roadmap.md`
- `docs/CHANGELOG.md`
- `docs/api-reference.md`
- `docs/api/websocket.md`
- `docs/api/transport-and-events.md`
- `docs/configuration/index.md`
- `docs/configuration/server-runtime-settings.md`
- `docs/deployment-guide.md`
- `docs/linux-systemd.md`
- `docs/semantic-lsp-protocol-guide.md` (new/untracked)
- `plans/260901-1000-lsp-server-integration/phase-11-documentation-roadmap-changelog-and-release-cleanup.md`

Supporting excerpts: `docs/architecture/semantic-websocket-gateway.md`; parent integration `plan.md`; Cycle 1 review; Phase 09 qualification report; `packages/ui/e2e/semantic-navigation/review.md`; `server/src/{api/semantic_settings.rs,semantic/gateway.rs,semantic/uri.rs,semantic/resources.rs,semantic/supervisor.rs}`; `packages/ui/src/{api/semantic-client.ts,lib/semantic-model-uri.ts,lib/semantic-monaco.ts}`.

**Updated plans:** None; Main owns plan/status edits. Only this requested review report created.

## Validation commands/results

**Reviewer exercised:**

- `git diff --stat && git diff --name-only` — 15 tracked files, 149 insertions/68 deletions at review start.
- `git diff -- README.md docs plans/260901-1000-lsp-server-integration/phase-11-documentation-roadmap-changelog-and-release-cleanup.md && git ls-files --others --exclude-standard` — inspected documentation diff; confirmed guide/new Cycle 1 report separately untracked.
- Read/grep source-to-document comparisons establish findings above. No reviewer-run build, test, formatter, linter, deployment, or runtime qualification; no coverage percentage asserted.

**Independent tester evidence inspected (`agent://Phase11TesterCycle2`), not rerun by reviewer:**

| Command/check | Reported result |
| --- | --- |
| Internal link/anchor scan over 16 files | 227/227 resolve; 0 broken |
| `node /home/loidinh/.omp/agent/evcrate/scripts/validate-docs.cjs docs/` | Exit 0; 306 working links; heuristic warnings retained |
| `cargo test --test linux_release_manifest --test linux_release_manifest_errors` (server) | 49 passed, 0 failed; `artifact://47` |
| `cargo test --lib semantic --test semantic_tool_profile`, then `cargo test --test semantic_tool_profile` (server) | 49 library + 11 tool-profile tests passed; first invocation filtered out all profile tests, corrected invocation ran them; `artifact://49` |
| `pnpm --filter @dam-hopper/ui test --run src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts` | 28 passed, 0 failed |
| `pnpm lint` | Exit 0; 0 errors, 174 warnings; `artifact://51` |
| `cargo check --all-targets` (server) | Passed |
| `pnpm --filter @dam-hopper/ui build` | Typecheck passed |
| `pnpm --filter @dam-hopper/browser-bridge typecheck` | Passed |
| `pnpm --filter @dam-hopper/web build` | Passed |

Tester reports **137 selected tests passed**. These static/unit/integration results do not validate prose semantics, human visuals, or systemd rollback behavior.

Advisor consultation attempted with concise findings/evidence draft; primary and fallback providers both rejected with quota errors. No Advisor endorsement claimed.

## Unresolved questions

- Human visual reviewer/date/outcome remains pending in `packages/ui/e2e/semantic-navigation/review.md:3-5,25-26`; automation cannot supply it.
- What specific prior scaffold-removal evidence supports the Phase 11 purge claims? No such record identified in this inspected change.
