# Phase 11 Documentation Review

## Score: 6/10 — Corrections required

Review complete for all 16 assigned documentation files and relevant implementation/evidence excerpts. No product or plan edits; Main retains plan-status ownership. Runtime security/performance was not independently re-qualified by this reviewer.

## Critical issues

None identified in this documentation-only change. This is not certification of the full implementation.

## Warnings

### W1 — High: Current docs still promise applied cgroup containment

- **Locations:** `docs/project-overview-pdr.md:86`, `docs/system-architecture.md:534-539`, `docs/codebase-summary.md:89`.
- These describe cgroup configuration and pre-exec attachment as effective behavior, degrading only when controllers/delegation are absent. Architecture line 535 even promises core services are never starved. Production does not select these adapters: `server/src/api/semantic_settings.rs:47-58` explicitly reports portable-only enforcement regardless of controller availability; the qualification report lines 149-154 agrees.
- **Impact:** Operators can incorrectly rely on hard CPU/memory containment. Later portable-only caveats do not cancel earlier affirmative claims.
- **Correction:** Label the cgroup implementation as unused/unqualified primitives; current sessions always use portable bounds. Remove starvation guarantees. Keep trusted-workspace/server-account filesystem authority explicit.
- **Confidence:** High.

### W2 — High: Authoritative protocol guide omits required negotiation and freshness contracts

- **Locations:** `docs/semantic-lsp-protocol-guide.md:124-178,228-247,276-287`.
- The guide documents only three initialize capabilities and no attach response schema. Actual attach response carries policy fields (`gateway.rs:574-586`); initialize adds `experimental.damHopperAdaptiveSync` (`gateway.rs:846-865`). The shipped client rejects missing/malformed policy and mismatched responses (`semantic-client.ts:156-193,219-285,725-731`).
- Result documentation omits `damHopperDestinationContentSha256`, `damHopperDestinationVersion`, and `damHopperDestinationIncarnation`, exact range-in-content validation, and unopened-destination pin/requery. These are emitted in `uri.rs:558-565,644-657`, implemented in `gateway.rs:1682-1984`, and checked before reveal by the client/Monaco manager.
- Replay section does not state exact profile/project/target plus endpoint/configured-root/actor matching. The implementation enforces these before any model replay (`semantic-client.ts:387-413,815-866`). “Confirmed synchronized” at line 247 implies an acknowledgement that didOpen notifications do not provide.
- **Impact:** An implementation following the authoritative guide can fail connection negotiation or omit the protections preventing stale reveals/cross-owner uploads.
- **Correction:** Publish exact request/response schemas and extension semantics, matching policy validation, destination freshness/reveal checks, provenance gate, and FIFO-not-acknowledgement distinction. Correct stable URI example at line 239 to `inmemory://dam-hopper/${encodeURIComponent(tabKey)}` (`semantic-model-uri.ts:169-171`).
- **Confidence:** High.

### W3 — Medium: Recovery behavior and error taxonomy are not exact

- **Locations:** `docs/semantic-lsp-protocol-guide.md:348-385`; repeated in `docs/api/transport-and-events.md:175`, `docs/api/websocket.md:149-151`, and `docs/system-architecture.md:679-682`.
- Guide promises automatic re-issue of stale navigation and exponential 1.5–10s reconnect with jitter. Actual `-32003` handling schedules full resync and returns an empty result; `-32005` schedules one reconnect after **1,000 ms** (`semantic-client.ts:1260-1290`). No automatic retry of the original navigation exists there.
- Error table says missing request IDs return `-32600`; request-only methods without IDs are silently dropped (`gateway.rs:319-323`). `-32003` also covers source/destination modification/closure and pin/requery freshness failure, not merely source version mismatch (`gateway.rs:1596-1620,1664-1667,1913-1983`). `-32004` also covers global/per-connection tree limits (`gateway.rs:747-763`).
- **Correction:** Describe actual recovery without adding retry behavior to code. Distinguish request IDs from notification rules and enumerate relevant `error.data.code` variants and freshness failures.
- **Confidence:** High.

### W4 — Medium: New architecture paragraph incorrectly denies ordinary-user status inspection

- **Location:** `docs/system-architecture.md:699-701`.
- Wording groups GET and PATCH and then says non-admin/no-auth callers fail with 403. GET is intentionally accessible for safe inspection, including development mode; it returns `canMutate: false` (`server/src/api/semantic_settings.rs:114-136`). The same document correctly states this at line 607.
- **Impact:** Incorrect client/operator authorization contract; conflates mutation denial with enabled-feature usage/status access.
- **Correction:** Restrict Admin/no-auth rejection to mutation; retain authenticated User inspection/navigation and no-auth read-only status behavior.
- **Confidence:** High.

### W5 — Medium: Obsolete current-state residue remains despite reconciliation claims

- **Locations:** `docs/code-standards.md:101`, `docs/project-overview-pdr.md:88`, `docs/system-architecture.md:526,555,567,582`, `docs/api/websocket.md:147-151`.
- Restart window is described as 60 seconds; effective constant is **300 seconds** (`resources.rs:75-83`, consumed by `session.rs:1732-1733`). Architecture says server navigation timeout is 5 seconds; effective server timeout is **10 seconds** (`resources.rs:59-61`, `session.rs:1935-1937`). Client timeout is separately 5 seconds.
- Architecture describes cached integrity success as avoiding repeated verification, contradicting fresh verification at each enable/launch/restart documented in standards line 94. It still labels wired resource constants “awaiting” Phases 04–05.
- WebSocket reference says R1 provenance checking and C2/R3 invalidation fixes remain open, contradicting current code and architecture line 689. Phase 11 plan lines 21,63,100,119 still describe a text-only planning pass and unresolved upstream gates while all TODOs are checked.
- **Correction:** Remove historical implementation-progress narration from current contracts or clearly archive it; reconcile all current constants and resolved review dispositions. Main should reconcile plan narrative/status.
- **Confidence:** High.

### W6 — Medium: Rollback runbook omits its required semantic quiescence step

- **Locations:** `docs/deployment-guide.md:126-136`, `docs/linux-systemd.md:344-355`.
- Both go straight to rollback; Phase 11 explicitly requires Admin OFF, observed zero children/overlays, then compatible server/UI/tool release restoration (`phase-11...md:50,77`). No operational OFF/inspection step is provided.
- Linux guide hardcodes `<version>/server/lib/semantic-engine`; role views also include `both` (`linux-systemd.md:101-108`). Use `<release-root>/lib/semantic-engine` or `<version>/<role>/lib/semantic-engine`.
- “Strictly zero” surviving children across every rollback is stated as a guarantee without release-manager rollback qualification evidence here; ordinary OFF/E2E cleanup evidence is not that evidence.
- **Correction:** Add the authorized OFF/inspection sequence and failure stop condition, retain release activation restart distinction, use role-correct paths, and avoid an unqualified rollback-specific process guarantee.
- **Confidence:** High for omissions/path; medium for unexercised rollback guarantee.

### W7 — Medium: Completion/publication and cleanup claims exceed the recorded disposition

- **Locations:** `docs/project-roadmap.md:9,25`, `docs/semantic-lsp-protocol-guide.md:5`, `docs/CHANGELOG.md:2-7`, Phase 11 plan lines 15-16,82-89.
- Roadmap says all phases complete/100%, but parent plan still lists Phase 11 pending and Phase 11 itself awaits review. Human record is `PENDING_HUMAN_REVIEW` (`packages/ui/e2e/semantic-navigation/review.md:3-5,25-26`). Parent plan records user-approved administrative Phase 10 completion; do not erase that approval or fabricate human acceptance. Distinguish administrative/functional completion from release visual acceptance.
- “Purging obsolete experimental scaffolds” is asserted without identified deletions/evidence in this docs-only diff. Textual obsolete residue demonstrably remains (W5).
- **Correction:** Preserve accepted administrative status while explicitly keeping final release sign-off gated by the actual pending review. Reconcile parent/phase/roadmap status during Main finalization. Name cleanup evidence or remove unsupported purge claims.
- **Confidence:** High for contradictory status/pending human record; medium for cleanup evidence absence.

## Suggestions

1. DRY: Keep exact wire schemas/error recovery in the protocol guide and numeric policy in one canonical current table; replace duplicated phase-by-phase implementation histories across architecture, PDR, and summary with concise capability summaries and links. Existing duplication has already caused measurable drift.
2. Restore deleted `### Step 1: Download Bootstrap Installer` in `docs/deployment-guide.md` before its download command (line 28); numbered instructions currently begin at Step 2.
3. Keep the new guide in the delivered change: it is new/untracked relative to the tracked diff inspected, yet many new links depend on it.
4. Positive: endpoint `/ws/semantic/v1`, subprotocol `dam-hopper.semantic.lsp.v1`, frozen **65,536-byte UTF-8** threshold, single Incremental sync, bundled versions/digests examined, default-OFF/admin mutation rejection, normal-navigation zero restart versus release-update restart, and native/non-TS/JS deferrals are represented correctly in the new material. Trusted-workspace and portable-only caveats are valuable; remove the contradictory older claims rather than adding more caveats.

## Coverage

| Acceptance area | Disposition |
| --- | --- |
| Implemented/measured Linux server + web TS/JS behavior | Partial: measured values agree with Phase 09 report; protocol/current-state discrepancies above remain. |
| Trusted-workspace / portable-only honesty | Partial: new caveats correct, older cgroup promises contradict. |
| Endpoint / subprotocol / 64 KiB / errors | First three agree with source; errors/recovery need correction. |
| Admin-only mutation / no-auth denial | Documented across dedicated/raw/import protections; GET wording incorrect. Source guard references and qualification evidence inspected, not a new exhaustive runtime sink audit. |
| Update restart versus navigation/toggle no restart | Correct distinction; rollback runbook incomplete. |
| Native/non-TS/JS deferral | Correct; no native qualification inferred. |
| Links / duplicate sections / obsolete residue | Tester reports links/heading checks pass; obsolete semantic residue remains. |

## Reviewed files

All assigned files: `README.md`; `docs/system-architecture.md`; `docs/codebase-summary.md`; `docs/code-standards.md`; `docs/project-overview-pdr.md`; `docs/project-roadmap.md`; `docs/CHANGELOG.md`; `docs/api-reference.md`; `docs/api/websocket.md`; `docs/api/transport-and-events.md`; `docs/configuration/index.md`; `docs/configuration/server-runtime-settings.md`; `docs/deployment-guide.md`; `docs/linux-systemd.md`; `docs/semantic-lsp-protocol-guide.md`; `plans/260901-1000-lsp-server-integration/phase-11-documentation-roadmap-changelog-and-release-cleanup.md`.

Supporting sections: parent `plan.md`; Phase 09 qualification report; visual `review.md`; `docs/api/workspace-settings.md`; `server/src/{api/semantic_settings.rs,api/semantic_ws.rs,semantic/gateway.rs,semantic/uri.rs,semantic/resources.rs,semantic/session.rs,semantic/tool_profile.rs,semantic/supervisor.rs,fs/ops.rs,fs/secure_path.rs,fs/mutate.rs}`; `packages/ui/src/{api/semantic-client.ts,lib/semantic-model-uri.ts,lib/semantic-monaco.ts}`; release archive builder.

## Validation commands/results

- **Reviewer exercised:** `git diff --stat && git diff -- <15 tracked assigned paths plus new guide path>` — inspected 15 tracked files, 132 insertions/52 deletions; new guide inspected separately through read. Read/grep source-to-document checks established W1–W7. No compile, test, linter, or runtime qualification commands executed by reviewer; no new coverage percentages claimed.
- **Independent tester message, not reviewer-exercised:** Phase11Tester reports 227/227 internal links resolve, zero broken anchors, no unintended duplicate headings; `validate-docs.cjs docs/` reports 306 working links. Also reports release-manifest tests 49/49, semantic core/profile tests 60/60, UI client tests 28/28, ESLint 0 errors/174 warnings, and cargo/TS/web build checks passing. Exact commands/output belong to tester handoff; Main must use that evidence, not this summary, for final validation claims.
- **Evidence reviewed, not rerun:** Phase 09 report records portable-only qualification and frozen limits; Phase 10 review record remains pending human acceptance.

## Unresolved questions

- Human visual decision is still pending; its reviewer/date/outcome cannot be supplied by automation.
- No rollback-specific process-cleanup qualification or named scaffold-removal evidence was located in the inspected Phase 11 change. Provide existing evidence or qualify those claims.
