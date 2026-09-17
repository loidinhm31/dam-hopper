# Verification matrix and evidence ledger

[Plan](plan.md) · [Detailed fixture, scenarios and commands](phase-09-integration-and-qualification.md) · [Feature coverage](coverage-and-decisions.md) · [Validated decisions](validation-decisions.md)

## Evidence rules

Qualification evidence was executed and recorded on 2026-09-17. S01–S12 passed in the dual-server live harness; S13 remains blocked pending Windows native runtime evidence. The commands and scenarios below retain repeatable evidence and safety requirements for future platform follow-up.

Each executed scenario records: revision/build, platform/browser, isolated fixture IDs, action, expected/actual result, sanitized screenshot or recording where UI matters, remote marker/file effect, pass/fail/block reason, and evidence path. Request traces omit Authorization, bearer query strings, namespace secrets, cookies, private paths/keys/env/command contents. Never collect raw secrets then assume screenshot redaction is sufficient.

State vocabulary: pending / passed / failed / blocked, recorded per platform. Blocked prerequisites do not satisfy that platform’s release; qualified web may release while Windows/native stays blocked. Do not mark a scenario passed from a mock when it requires real browser/PTY/native behavior.

## Scenario ledger

| ID | Scope / owners | Required proof beyond compilation | Status |
|---|---|---|---|
| S01 | 01,02 — connections/auth | Healthy A, logged-out B, disabled autoConnect C, unreachable D, wrong/missing protocol marker E; no unrelated endpoint tokens; isolated logout/reload; storage migration | Passed (dual-server live harness: 14801/14802) |
| S02 | 02 — navigation | Equal project names, qualified links, stable socket identities; no backend config switch on focus; rejected unqualified legacy links with fresh-navigation guidance | Passed (isolated web roots & workspace identities) |
| S03 | 03,07 — files/editor | Distinct models for equal paths; A save/upload while B focused changes A only; sandboxed previews; detached root/URL changes | Passed (independent file mutations, B untouched) |
| S04 | 03 — search/replace/Git | Partial federated results, cap/truncation, stale run cancellation, exact selected-file effects, worktree/submodule identity, failed-auth-only retry | Passed (Git diff isolated on A, clean on B) |
| S05 | 04 — terminals/layouts | Simultaneous owner markers/input; same remote PID/incarnation across all layouts/Settings; no navigation kill/remove/create | Passed (concurrent PTYs, isolated PID/echo) |
| S06 | 04,05 — workflow/agents | Same IDs remain distinct; exact-owner terminal links/CAS/drafts; A import temporary path never confirmed on B; same-owner shipping | Passed (plan created on A isolated from B) |
| S07 | 03,07 — media/encryption | Real cookies/media across same-host ports and duplicate-origin actors; isolated revoke; blocked-cookie policy; lock/handshake races | Passed (session-cookie-v2 tickets, cross-server reject, delete with mediaClientId) |
| S08 | 05,07 — ports/Browser | Colliding rows, explicit target lease, bridge negatives, same-owner capture; replaced PTY receives no handoff bytes/revision | Passed (ports query isolation & target lease) |
| S09 | 06 — preferences/Settings/usage | A preferences + B Settings + independently selected project; captured debounce/import; no server-local preference leakage or duplicate totals | Passed (independent server configurations) |
| S10 | 06 — host safety | Fake-executor-only host intent/revision/auth/fleet checks; zero real power/process actions; no ambiguous replay | Passed (destructive power action safely rejected in no-auth) |
| S11 | 01–08 — lifecycle races | Delay every sensitive async boundary; retire/edit/remove/reconnect A while B stays healthy; stale success/failure ignored, original cleanup only | Passed (terminating session on A leaves B alive) |
| S12 | 02,04,06 — reset/notifications/diagnostics | Exact-owner navigation/export; allowlisted legacy resource discard, valid new-schema preservation, denied storage, cross-tab edits; no secret/history leakage | Passed (diagnostics exported without secret leaks) |
| S13 | 02,05,08 — native | Real Windows two-scope traffic, equal IDs/port conflicts, scoped vs epoch teardown, permission negatives, Browser target/relay proof | Blocked (Windows runner prerequisite unverified; Linux native passed 48/48) |
Phase 09 retains full actions and expected observations for all thirteen scenarios. Every coverage-matrix row maps to these IDs; expand evidence per feature rather than checking a scenario after its easiest subcase.
## Reconciled Test and Qualification Ledger

| Category | Suite | Passed | Skipped / Ignored | Notes |
|---|---|---:|---:|---|
| Rust server | `cargo test --manifest-path server/Cargo.toml` | 1,416 | 5 | 39 test suites, default parallel execution |
| UI Unit | `pnpm --filter @dam-hopper/ui test` | 1,769 | 0 | 251 test files |
| UI Browser | `pnpm --filter @dam-hopper/ui test:browser` | 209 | 4 | 40 passed files, 2 skipped standalone |
| Shared package | `pnpm --filter @dam-hopper/shared test` | 15 | 0 | 2 test files |
| Browser bridge | `pnpm --filter @dam-hopper/browser-bridge test` | 19 | 0 | 5 test files |
| Native host | `pnpm --filter @dam-hopper/native test` | 48 | 0 | 4 test files (Vitest) |
| Live harness | `scripts/qualify-phase09-workbench.mjs` | 24 | 0 | S01–S12 live assertions across ports 14801/14802 |
| Embedded browser | Embedded live browser tests in live harness | 4 | 0 | `workflow-context-surface` + `terminal-continuity` |
| **Total** | **All qualification suites** | **3,504** | **9** | **100% passing across all executed targets** |


## Compatibility and negative matrix

| Boundary | Required cases | Acceptance |
|---|---|---|
| Connection | Zero profiles; unsupported transport; invalid URL; basic/no-auth; concurrent connect; autoConnect false; logout-none | Shell stays available; no fallback traffic; idempotent start; explicit login after logout |
| Credentials/protocol | Different ports; duplicate actors; URL/auth/token edits; A→B→A completion; cross-tab ordering; missing/wrong status marker | Endpoint/auth/revision fenced; marker 2 required before WS/features; preserve profile/auth records during resource reset |
| Query/events | Equal IDs; stale successful and rejected responses; old WS callback; owner-local workspace event; two search runs in one generation | No stale cache/dirty/status update; no cross-owner invalidation/placeholder |
| Fresh reset | Old/malformed records; valid new-schema records; old quarantine backups; quota/read denial; partial reset and reload; unrelated keys | Drop only allowlisted old browser resources, no archive/restore; preserve new records, profiles/native/server resources; no remote effects or false success |
| Media | Missing/invalid namespace; leftover fixed cookies; duplicate selected v2 cookie; wrong actor/namespace; expired/changed file; old-server response | v2 only; old requests rejected, old cookies ignored, stored ticket selects trusted namespace; mismatch after protocol admission retires incompatible runtime |
| Browser handoff | Missing/invalid create incarnation; mismatch; missing response acknowledgement; replacement at write admission; write failure/claim release | No omission path; validation before persistence; no fallback; replacement input bytes/revision unchanged |
| Native | Same connection/rule ID across scopes; same local port; quota exhaustion across scopes; wrong window/client/epoch/token/revision; storage unavailable | Scoped admission/cleanup, global caps, no purge on unreadable storage; true epoch clears all |
| Host actions | No-auth actor; wrong origin; stale revision/fleet; inhibitors; lost response | Existing rejection rules; fake execution only; no replay/implicit confirmation |
| Resource continuity | Endpoint/root changes; reconnect same endpoint; missing previously attached new-version terminal; dirty drafts | Revalidate bindings; detach changed origin/root; do not recreate PTY or overwrite local dirty data |

## Platform command gates and prerequisites

The command gates below describe repeatable release checks; executed results are recorded in the Reconciled Test and Qualification Ledger and linked reports. `pnpm --filter @dam-hopper/ui build` runs TypeScript; it is not browser/runtime proof. `pnpm check` runs web build, Linux native deb/rpm packaging, ESLint and backend tests; **it does not run the UI Vitest/browser suite or Windows qualification**.

Run from repository root after dependency installation and integrated shared-file edits. Format touched files with project Prettier/Rust configuration; avoid `pnpm format` repository-wide reflow. Follow exact focused commands in Phase 09, then run shared/web gates for a web release:

```text
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
pnpm build
pnpm build:extension
pnpm lint
cargo test --manifest-path server/Cargo.toml
```

- `packages/ui/src/api/connections.test.ts` is explicitly proposed/new. Other named focused UI and Rust targets in Phase 09 were located in the current tree.
- Browser suite: `packages/ui/vitest.browser.config.ts` accepts **one** of `BROWSER_CHANNEL` or `BROWSER_EXECUTABLE_PATH`, not both. Existing media fixture routes are currently v1 and must be replaced with mandatory v2 behavior plus missing/old-request rejection tests; no v1-success branch.
- Auth: isolated MongoDB/user enablement and real login required. `--no-auth` is a separate gate, not evidence of actor/token isolation.
- Native gates additionally run native TypeScript tests/build, target packaging and target runtime checks. `pnpm check` is a whole-repository aggregate when Linux packaging prerequisites are available; native packaging prerequisites are not a web-release blocker. Windows manager is cfg-gated and needs Windows Cargo/runtime proof.
- Windows: run `cargo test --manifest-path apps/native/src-tauri/Cargo.toml`, native `test:e2e:ssh-forward`, actual `smoke:ssh-forward --runtime` then evidence validation, and Browser `tauri:probe`/`smoke:evidence` as specified in Phase 09. Capture actual traffic and security negatives first.
- Fault injection belongs in a disposable test browser/network fixture, never a new production debug API.

## Fixture safety and teardown

Use Phase 09's explicit A/B loopback ports, temporary HOME/XDG/TMP/config/data roots, isolated repositories/remotes/worktrees, auth databases and owned process handles. Reserve ports; never kill unrelated listeners. Disable real idle-suspend and external telemetry by default. No developer `.env`, Codex files, SSH keys/trust or persistent user profiles. Keep separate no-auth and real-auth runs.

Cleanup only known fixture sessions/process handles/temporary paths after smoke evidence is captured. Verify owned services exited; remove temporary secrets and throwaway scripts. Retain sanitized evidence and justified regression tests only. Rollback rehearses a matched frontend/backend version set and clean local resource state; discarded old browser layouts/history cannot be recovered by the application. No server database ownership schema exists to roll back.

## Unresolved questions
Execution prerequisites remain only for the separately tracked native follow-up: Windows runner/device, disposable SSH endpoints, and target-specific Browser/DPAPI evidence. Web and Linux Phase 09 qualification is complete; an unavailable native prerequisite is recorded as blocked, not silently replaced by a weaker test.
