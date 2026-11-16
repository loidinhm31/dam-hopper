# Targeted independent plan-review follow-up

**Terminal status: COMPLETE — assigned correction scope inspected.**
F1/F2/F3 resolved at plan-contract level; U1/U2 clarified. No remaining material finding or correction regression established within this scope. Not implementation approval, readiness certification, final user validation or a runtime pass.

## Scope / inspected evidence

`P` = `plans/261108-0237-host-browser-cdp-streaming/`; paths otherwise repository-relative. Ranges identify inspected sections, including actual task JSON acceptance/verification and writable sets, not just author receipts.

- `P/reports/followup-review-scope.md:1–19`, `plan-review.md:1–69`, `review-triage.md:1–23`, `revision-check.md:1–65`.
- `P/plan.md:1–51`; `P/architecture-contracts.md:1–183`; long changed lines20/115/158/175 additionally read verbatim. Other truncated long-line portions not relied upon.
- `P/phase-01-compatibility-contracts.md:1–220`; long fixture step93 additionally verbatim.
- `P/phase-02-managed-lifecycle.md:56–173`; `P/phase-03-admission-control.md:57–193`.
- `P/phase-04-agent-cdp-gateway.md:22–151`; long actual-gateway step62 additionally verbatim.
- `P/phase-05-producer-fanout.md:22–198`; `P/phase-06-viewer-client.md:22–203`.
- `P/phase-07-os-cutover.md:60–105,111–208`.
- `P/phase-08-selection-credential-reset.md:22–295`.
- `P/phase-09-integrated-qualification.md:22–212`; long fixture step54 additionally verbatim.
- `P/phase-10-documentation-rollout.md:46–136`.
- `P/acceptance-matrix.md:1–69` (all40 rows); `P/execution-ownership.md:1–71`.
- Context: `README.md:1–75`, `docs/code-standards.md:1–90`, `docs/project-overview-pdr.md:1–78`; truncated unrelated long cells not used as proof.
- Transport: `server/Cargo.toml:1–45`, `server/Cargo.lock:160–198,4210–4230`.
- Exact installed registry source under `/home/loidinh/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`: `axum-0.8.8/src/extract/ws.rs:561–575,735–745,775–790`; `tungstenite-0.28.0/src/protocol/message.rs:150–175`.
- Fixture/runner: `packages/ui/package.json:1–76`, `playwright.config.ts:1–69`, `vitest.browser.config.ts:1–100,360–429`; `packages/ui/e2e/fixtures/application-fixture.ts:1–84`, `application-services.ts:1–150,146–235`, `application-data.ts:1–85`, `image-builder.ts:1–97`, `application-runtime.Dockerfile:1–18`.
- Bootstrap interfaces: `server/src/main.rs:30–67`, `server/examples/application_e2e_seed.rs:1–75`, `apps/web/package.json:1–32`.
- Logout/cooperative baseline: `server/src/api/auth.rs:613–637`; `packages/ui/src/os/apps/BrowserApp.tsx:180–264`; `packages/ui/browser-tests/browser-debug-panel.browser.tsx:1–105`, `browser-debug-keep-alive.browser.tsx:1–105`; targeted symbol search across `packages/ui/src` and `apps/web`.

## F1 — RESOLVED: shareable publication and socket-bound credit

- `P/architecture-contracts.md:99–118` now specifies a target-only header: no viewer, subscription, login or ticket fields. One complete immutable prefix+header+JPEG `Bytes` publication is shared unchanged; no segmented/custom-WS substitute or per-viewer JPEG assembly.
- Exact transport evidence agrees: lockfile pins Axum0.8.8 → tokio-tungstenite0.28.0 → tungstenite0.28.0; installed Axum exposes `Binary(Bytes)` and forwards that buffer. This confirms the selected transport type only, not implemented allocation/runtime behavior.
- `P/architecture-contracts.md:81,105,115–118` makes subscription immutable to admitted media socket; resume/rebind needs fresh socket/ticket/subscription and matching fresh control pair. ACK/discard travels on the originating media socket with callback-captured subscription. Server checks that exact socket before removing its outstanding key; old completions cannot credit replacement sockets.
- `P/phase-03-admission-control.md:75–85,151–158`, `P/phase-05-producer-fanout.md:70–92,139–170` and `P/phase-06-viewer-client.md:55–79,118–150` propagate admission, parser/local-context, late-decode and verification guards consistently.
- Unique COMPLETE allocation remains charged until final cache/pending/outstanding/slow-writer clone drops, even after credit cleanup (`architecture-contracts.md:31,40–48,115`; phase05:85,165–170). Two outstanding/one pending,5s writer and30s ACK bounds remain explicit.
- Matrix A18/A22/A23/A24/A27 agrees (`P/acceptance-matrix.md:28,32–34,37`). No header identity/shareability contradiction remains in inspected contracts.

## F2 — RESOLVED: evidence follows producing implementation

- Phase02 config completion probes direct domain capability DTO, not future HTTP route (`P/phase-02-managed-lifecycle.md:56–65,115–122`).
- Phase04 owns modifications to dependency-created qualification helper/example and its agent spec; it mounts actual production router/auth/manager/gateway and proves independent native Page sessions, not later producer/SPA/human (`P/phase-04-agent-cdp-gateway.md:34–40,58–70,103–124`).
- Phase06 owns actual isolated browser-mounted decoder/input/text-proxy harnesses. It records emitted command boundaries without fake backend success, combines prerequisite phase03 native dispatch evidence, and distinguishes injected privacy from real OS wiring (`P/phase-06-viewer-client.md:66–95,129–175`).
- Phase09 explicitly owns full production-stream/same-target interference, real SPA zoom/privacy and physical Android/human receipts; new `same-target.spec.ts` and `android.spec.ts` are literal planned creations and task `allowed_files` (`P/phase-09-integrated-qualification.md:25–47,51–99,107–183`). Late defects reopen originating04/06 tasks and affected dependents, not reverse DAG edges or acceptance waivers (:198–201).
- All40 matrix rows inspected for stage consistency; specifically A02/A09 now09, A07 native geometry01 vs web09, A15 injected06 vs OS07/integrated09, A25 real owned Rust demand viewer05 (`P/acceptance-matrix.md:5,12,17,19,25,35,54–59`; phase05:53–65,100–119).
- `P/execution-ownership.md:8–13,23–47,67` matches affected literal task sets and forward handoffs. Selection08 owns self-contained real SPA setup in its spec, not future09 helper (`phase08:47,98,180–208`). No semantic forward-proof prerequisite or new fixture bootstrap cycle established.

## F3 — RESOLVED: executable fixture startup contract

- Existing runner really has package-relative e2e paths and60s test timeout (`packages/ui/playwright.config.ts:37–44`); existing root derivation uses `import.meta.url` (`application-services.ts:1–8`).
- `P/architecture-contracts.md:20` and phase01:93,100–104,188–192 now require absolute repo cwd/manifest, scoped660000ms worker setup outside tests, separate600000ms Cargo build, matching compiler-artifact executable including native `.exe`, then20s readiness only after binary spawn. No Cargo-run/guessed-target-path readiness contract remains.
- Readiness line<=4KiB, retained runtime stdout/stderr each<=64KiB, synthetic credentials memory-only; malformed/missing/overflow fails. Partial startup, readiness/output/build failure and normal teardown all require bounded reap plus Unix group/parent-death or Windows Job descendant cleanup, not root/Cargo-only kill.
- Writable helper/example paths are planned01 creations and ordered04 modifications (`phase01:47–55,171–177`; `phase04:108–112`; `ownership:23,31`). Platform primitives precede fixture implementation; primitive mode has no later gateway dependency.
- Later native full-app fixtures own implementation sources (`phase08:98`; `phase09:54,112–117`). Existing production binary/config/web-dir, synthetic seeder and web-build interfaces exist (`server/Cargo.toml:19–21`; `main.rs:35–65`; `application_e2e_seed.rs:19–49`; `apps/web/package.json:6–12`). These make bootstrap implementable without assuming the current container image already supplies Chromium or requiring edits to a later task. Actual provisioning/lifecycle implementation is not observed.

## U1 / U2 — CLARIFIED

- **U1:** explicit keep-data/clear-shared-data/Cancel; BOTH logout branches call server revoke-FIRST. Keep returns200 retained/resetRequired or truthful unknown/absent, not local-only signout. Clear additionally needs live pre-revocation admission, current Admin, Origin/CSRF, confirmation, expected epoch/operation and sibling warning. Cancel preserves login/profile (`P/architecture-contracts.md:154–164`; phase08:115–140,229–266; matrix A35/A36:45–46). Existing logout revocation/cookie-clear compatibility remains recognizable (`server/src/api/auth.rs:613–637`). Default/preselection remains expressly UNCONFIRMED, not answered by revision or review.
- **U2:** preservation now names existing cooperative definitions/component/bridge harnesses; no invented current SPA mount or restoration. Existing harness sources actually mount Panel/KeepAlive. New managed selection/handoff requires actual post-cutover SPA proof with owned spec and runner (`P/architecture-contracts.md:137`; phase07:71; phase08:81,98–110,196–208; matrix A33:43). Targeted production-source search supports this distinction, not a current cooperative SPA reachability claim.

## Checks / exclusions / unresolved questions

Performed: static reads, targeted symbol/version searches, manual task/proof/ownership/matrix consistency review; Advisor challenge treated as advice, not verification. Parent structural parser/link/DAG/overlap counts supplied in assignment were not rerun or independently certified here.

Not performed: implementation, task-state/hydration, Git, builds, tests, lint, formatters, installs, engine/browser launch, external research or extra agents. No whole-plan rediscovery or unrelated preexisting verification/style audit. Only assigned repository report written.

Future exact-engine/schema/geometry, Linux/Windows containment, native fixtures, memory/performance, actual humans and physical Android remain blocking implementation/release qualification obligations—not planning-time passes and not themselves unresolved technical design findings here. Parent retains final validation/Advisor/readiness decision.

**Unresolved user decision:** default/preselected logout choice. This policy question remains pending final user validation; review supplies no answer or implementation permission.
