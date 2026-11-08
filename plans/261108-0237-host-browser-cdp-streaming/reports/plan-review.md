# Independent plan review

**Terminal status: COMPLETE — scoped static review complete; findings require coordinator disposition.**
No implementation, qualification, approval or ready-to-code claim. Only this report written.

## Scope and evidence

Paths below relative to repository root unless absolute; `P` = `plans/261108-0237-host-browser-cdp-streaming/`.
All final selected design files inspected, including task JSON, acceptance and verification—not only overview or parent suspicions:
- `P/plan.md:1–51`; `P/architecture-contracts.md:1–179` (long lines84/123/169 also read verbatim).
- `P/phase-01-compatibility-contracts.md:1–216` (line92 also verbatim).
- `P/phase-02-managed-lifecycle.md:1–198`; `P/phase-03-admission-control.md:1–211`.
- `P/phase-04-agent-cdp-gateway.md:1–147`; `P/phase-05-producer-fanout.md:1–198`.
- `P/phase-06-viewer-client.md:1–202`; `P/phase-07-os-cutover.md:1–232`.
- `P/phase-08-selection-credential-reset.md:1–284`; `P/phase-09-integrated-qualification.md:1–203`.
- `P/phase-10-documentation-rollout.md:1–160`; `P/acceptance-matrix.md:1–67`; `P/execution-ownership.md:1–70`.
Supporting evidence inspected:
- `plans/reports/brainstorm-261108-0138-host-browser-cdp-streaming.md:1–170`.
- `P/reports/{review-checklist.md:1–52,parent-inspection.md:1–28,advisor-design-disposition.md:1–38,planning-intake.md:1–43}`.
- `P/reports/{backend-boundaries.md:1–79,viewer-boundaries.md:1–80,design-direction.md:1–86}`; `P/research/stream-protocol.md:1–101` (research line21 truncated; not relied on beyond supplied conclusions).
- `README.md:1–113`; `docs/project-overview-pdr.md:1–103`; `docs/code-standards.md:1–113`; `docs/architecture/agent-store-ports-and-browser.md:1–115` (long PDR/standards cells partly truncated).
- `server/src/api/auth.rs:40–225,600–650`; `server/src/api/router.rs:75–100,325–365`; `server/src/api/browser_debug.rs:1–134`; `server/src/browser_debug/store.rs:1–203`.
- `packages/ui/src/os/apps/BrowserApp.tsx:1–264`; `packages/ui/src/os/OsResourceHost.tsx:30–85,195–230,380–405`.
- `packages/ui/src/components/organisms/{ServerProfilesDialog.tsx:170–228,ServerSettingsDialog.tsx:830–898,BrowserDebugKeepAliveHost.tsx:1–84}`; `packages/ui/src/api/auth-client.ts:505–537`; `apps/browser-extension/src/content.ts:1–29`.
- `packages/ui/{package.json:1–76,playwright.config.ts:1–69}`; `packages/ui/e2e/fixtures/{application-fixture.ts:1–84,application-services.ts:1–138}`.
- `server/Cargo.toml:37–47,170–190`; targeted `server/Cargo.lock` version entries; targeted installed Axum/tungstenite source below.

## Findings

### F1 — HIGH: selected atomic envelope conflicts with shared no-copy fanout
- **Plan:** `P/architecture-contracts.md:81,99–113`; `P/phase-05-producer-fanout.md:70`.
- **Evidence:** `server/Cargo.lock:163–164` pins Axum **0.8.8**, not the parent's inspected0.8.9. Exact installed `/home/loidinh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/axum-0.8.8/src/extract/ws.rs:561–571,735–739,779–781` exposes `Sink<Message>` and contiguous `Binary(Bytes)`; no segmented message body. Its transport dependency is tokio-tungstenite/tungstenite0.28.0 (`server/Cargo.lock:192,4213–4221`); installed `tungstenite-0.28.0/src/protocol/message.rs:157–161` likewise uses `Binary(Bytes)`. Separately inspected0.26.2 has a raw Frame variant, but Axum does not expose one.
- **Failure:** two viewers have distinct subscriptionEpoch values, required inside each header. Their complete prefix+header+JPEG messages therefore cannot be the same immutable buffer. Sending through selected Axum Binary requires assembling distinct contiguous messages, copying JPEG per viewer; sending the same bytes instead violates one viewer's identity check. The binding no-copy requirement is unsatisfied, not merely a benchmark risk.
- **Impact/confidence:** high-confidence feasibility contradiction in frozen producer/parser contract; implementation must break a requirement or invent an unplanned lower-level writer.
- **Smallest correction:** make subscription immutable per media socket, require a fresh socket on resume/rebind, fence old-socket callbacks, and bind ACK/discard subscription to that socket; serialize/share one target-scoped full envelope without viewer-specific fields. Propagate wire/parser/task/matrix changes. Alternatively explicitly permit/account copies. Do not assume scatter/gather support in `Binary(Bytes)` or silently split header/image messages.

### F2 — HIGH: prerequisite completion demands later integration evidence
- **Plan:** `P/phase-04-agent-cdp-gateway.md:59–68,129–143`; `P/phase-06-viewer-client.md:88–94,168–185,197–198`; `P/phase-02-managed-lifecycle.md:65,122`; matrix `P/acceptance-matrix.md:10,17`.
- **Supporting contract edges:** `P/execution-ownership.md:29–37`: producer waits for `qualify-agent-interoperability`; root UI waits for producer AND `implement-web-input`. `P/phase-07-os-cutover.md:68–73` is the actual iframe-to-canvas app cutover; current `packages/ui/src/os/apps/BrowserApp.tsx:183–264` only registers iframe slots. `P/phase-01-compatibility-contracts.md:92` explicitly says phase04 repeats proof on real app. Phase03, not phase02, owns capabilities routes (`P/phase-03-admission-control.md:61`).
- **Failure:** phase04 cannot complete required human-watched independent production stream before phase05 creates it and phase07 mounts its UI; phase06 cannot finish its real Android full-SPA smoke before phase07, which waits for phase06. Config phase's capabilities-read smoke also lacks its later HTTP route unless explicitly domain-only. Mandatory task-success rules prevent honest early completion; using mocks/source assertions would violate acceptance.
- **Impact/confidence:** high-confidence semantic forward prerequisites, despite the explicitly acyclic task JSON graph. These are scheduling/proof-contract defects, not claims that future feature tests already must pass.
- **Smallest correction:** early phase04 proves actual gateway+independent native sessions using an explicitly owned real qualification harness; phase06 proves isolated viewer/input components; phase02 reads a domain capability DTO only. Assign real human+production-stream and physical Android SPA evidence to phase09; update A02/A09 ownership, task acceptance/verification and handoff descriptions consistently. Do not add reverse DAG edges.

### F3 — MEDIUM: qualification fixture startup lacks executable launch prerequisites
- **Plan:** `P/phase-01-compatibility-contracts.md:92,99–102`; `P/architecture-contracts.md:20`.
- **Evidence:** `packages/ui/package.json:6–13` runs package-local Playwright; `packages/ui/playwright.config.ts:37–44` uses package-relative e2e paths and60s test timeout. Existing fixture explicitly derives repository root from `import.meta.url` (`packages/ui/e2e/fixtures/application-services.ts:1–8`).
- **Failure:** specified child command `cargo run --manifest-path server/Cargo.toml --example browser_host_qualification` inherits package cwd unless overridden, resolving a nonexistent `packages/ui/server/Cargo.toml`. Even with cwd corrected, the20s readiness window includes unconstrained Cargo compilation/linking, so a slow/cold build can fail before engine startup is assessed. No runtime timing was measured here.
- **Impact/confidence:** medium; high confidence in path-resolution gap, conditional cold-build timeout risk. Mandatory G1 can fail on fixture setup rather than engine compatibility.
- **Smallest correction:** explicitly derive/set repository cwd (or absolute manifest); specify a separate example prebuild and launch the resulting binary, starting20s readiness only then. Preserve bounded output and finally-owned stdin-close/reap on startup failure as well as success; forced timeout must also use the already-required Unix group/Windows Job descendant cleanup, not kill only Cargo. This is fixture setup, not permission for planning-time build/install.

## Examined concerns not established as defects

- Reset/crash safety: `P/architecture-contracts.md:149–162` and phase02:70–84 preserve stable external lock inode/metadata/tombstone, durable epoch before cancellation, idempotent reconciliation, descendant-exit proof before deletion and dirty-relaunch fencing. Exact platform behavior remains future G1/G3 proof, not a missing planning-time pass.
- Artifact actor/source roles: architecture:141–145 and phase08:78–96 explicitly require current Browser admission even after same-subject demotion, immutable server-set ManagedBrowser classification, Cooperative owner compatibility, and upload/handoff/reset completion rechecks. Current API/store lack these checks; plan correctly owns migration, not merely host-path special-casing.
- RawCDP: architecture:11,80–84 expressly grants whole-instance filesystem/network authority, acknowledges local-user loopback exposure, requires exact Origin on origin-bearing discovery/upgrade and header authentication for origin-less access. Shared auth currently accepts cookie fallback (`server/src/api/auth.rs:139–151`); phase04:45/50 correctly requires the stricter origin-less header path rather than inheriting that fallback.
- Hidden queues/HOL/cancellation: architecture:16–17,24–48,81–83,107–117 specifies command/event/message/byte/global bounds, prompt native ACK independent of viewers, bounded writer deadlines and independent auth cancellation. No full chromiumoxide runtime/unbounded listener is selected. Real starvation/cancellation/CPU/allocation evidence remains mandatory future qualification.
- Non-wiping logout: architecture:157–158 retains successful session/media revocation even without wipe. Its Browser attachments lose authority under the independent supervisor's explicit5s healthy-store/7s error bound (:83; phase03:76–85), not a demonstrated instantaneous close hook. This bounded interval is the specified contract; no new zero-latency logout requirement inferred. Confirmed reset additionally cancels principal-wide before process deletion (:160–161).
- Actual cutover: targeted source search found retired iframe symbols only in mapped OsResourceHost/BrowserApp and mapped lifecycle assertions; phase07 covers those, URL identity collisions and launch/persistence/recipe callers. No unsupported additional file omission established. Generic Purpose cells are repetitive, but numbered steps/contracts supply substance; no material finding solely for that style.

## Checks, exclusions and missing evidence

Performed: read-only file/range inspection, symbol/caller/version searches, manual semantic dependency/acceptance review; Advisor challenge used as advice, not source verification. Parent parser/link/overlap counts treated as supplied structural evidence, not rerun or feature proof.
Not performed: product execution, builds, tests, lint, formatting, installs, Git, hydration, external research or additional agents. Installed node_modules glob was access-blocked; no bypass attempted; package scripts/current fixture source supplied runner context instead.
No exact engine/schema/zoom/static-final/session-isolation, Linux/Windows containment, physical Android, human visual, memory/CPU/WAN/proxy measurements observed. These are explicitly assigned future blocking qualification obligations, not by themselves critical/high planning evidence gaps. F1/F2 instead need contract correction before their producing tasks can be executed coherently. This review does not independently certify all source paths, parser counts or runtime properties.

## Unresolved questions

1. **Non-destructive UI logout disposition:** phase08:125 makes Cancel retain login;129 calls authorized logout the confirmed wipe workflow, while architecture:156 asks whether to clear Browser data and158 permits retained logout. Must admitted users be offered “Log out, keep Browser data” alongside wipe/cancel, or is wipe-required UI intended? Approved brainstorm:103 and Advisor disposition:10 retain the broad interpretation as unconfirmed; server backward compatibility alone does not establish a required UI branch. Parent validation must settle this; not reported as an established bug.
2. **Cooperative regression baseline:** production-source search found BrowserDebugPanel/KeepAlive/useBrowserDebug definitions and test uses, no current SPA mount under UI src/web. `BrowserApp.tsx:1–264` is the distinct iframe-slot app; extension `content.ts:22–28` installs only in framed pages. For A33/phase08:99, identify the actual independent entrypoint or explicitly scope preservation proof to existing bridge/component harnesses. Do not invent preexisting live SPA functionality or require unrequested restoration.
