# Research Report: CDP Gateway Auth/Origin, Chrome Profile Changes & Containment

- **Date:** 2026-11-09 (`Asia/Saigon`) | **Scope:** Review support for `plans/261108-0237-host-browser-cdp-streaming` (Phases 01–09, HEAD `cdfa9c6b`)
- **External Calls / Primary Sources Used:** 2 / 2 calls, 2 / 2 primary sources (within 5-source project cap):
  1. **[S1]** Will Harris (Chrome Security), *Changes to remote debugging switches in Chrome*, Chrome for Developers (2025-03-17): `https://developer.chrome.com/blog/remote-debugging-port`
  2. **[S2]** Chromium `149.0.7827.55` `content/browser/devtools/devtools_http_handler.cc`: `https://raw.githubusercontent.com/chromium/chromium/149.0.7827.55/content/browser/devtools/devtools_http_handler.cc`

---

## 1. Evidence Classification Summary

- **[EXTERNAL FACT]:** Behavior proven directly by **[S1]** or **[S2]**.
- **[REPO FACT]:** Contracts and review findings verified in `architecture-contracts.md`, `engine-qualification.md`, `platform-qualification.md`, and Cycle 2/3 code review reports (`code-review-261109-0209-phase-04-cycle-3.md`, `code-review-261109-1935-phase08-selection-credential-reset-cycle2.md`, `code-review-261109-2144-host-browser-phase-09.md`).
- **[EXTERNAL RECOMMENDATION]:** Concrete review checks derived from **[S1]**/**[S2]** and contract invariants.
- **[UNVERIFIED / INFERENCE]:** Race/timing consequences or platform behaviors not yet exercised at runtime.

---

## 2. CDP Gateway Authentication, Discovery Rewriting & Origin Enforcement

### Primary Source Evidence ([S2] `devtools_http_handler.cc`)
- **DNS-Rebinding `Host` Check (`:121-129, 469-473, 524-528`):** **[EXTERNAL FACT]** `RequestIsSafeToServe` rejects HTTP (`/json*`) and WS requests with `500` unless `Host` header is empty, an IP literal (`HostIsIPAddress()`), or `localhost` (`net::IsLocalHostname`).
- **Asymmetric Upstream `Origin` Enforcement (`:591-662, 825-838, 934-941`):** **[EXTERNAL FACT]** `OnWebSocketRequest` rejects any WS upgrade containing an `Origin` header (`403 Forbidden`) unless matched in `--remote-allow-origins` or `*`, while allowing Origin-less non-browser requests (`!request.headers.count("origin")`). Conversely, `OnJsonRequest` (`/json/version`, `/json/list`, `/json/new` `PUT`) performs **no** `Origin` check.
- **Host-Derived Discovery URLs (`:630-633, 1061-1063`):** **[EXTERNAL FACT]** `/json/version` and `SerializeDescriptor` format `webSocketDebuggerUrl` directly from the incoming `Host` header (`ws://%s%s`).
- **Full Instance Privilege & Unbounded Upstream Buffers (`:91-92, 355, 855-867`):** **[EXTERNAL FACT]** `DevToolsAgentHostClientImpl::MayAccessAllCookies()` returns `true`; attaching to `browser_guid_` (`CreateForBrowser`) grants full instance authority. Upstream sets 256 MiB send / 100 MiB receive buffers per WS connection.

### Concrete Review Checks (Phases 03–05, 09)
1. **Check G1 — Origin on Discovery AND WS Upgrade (`cdp_gateway.rs`, `auth.rs`):** **[EXTERNAL RECOMMENDATION]** Because Chromium never checks `Origin` on `/json/*` and allows Origin-less WS upgrades, the gateway must require exact approved `Origin` on *every* Origin-bearing request (both `/api/browser/cdp/json/{version,list}` and `/api/browser/cdp/ws`), and permit Origin-less requests *only* with `Authorization: Bearer` (never capability-only `Sec-WebSocket-Protocol` tickets).
2. **Check G2 — Trusted Public Server Origin Rewriting (`cdp_gateway.rs:145-168, 397-398, 514-521`):** **[REPO FACT]** Phase 04 Cycle 3 review (`High #3 / W4`) found `cdp_gateway.rs` still accepts prefix-only env strings or falls back to request `Host` (`ws://`). **[EXTERNAL RECOMMENDATION]** Parse a single configured public origin (`http`/`https` -> `ws`/`wss`, rejecting path/query/fragment/userinfo) and fail closed when absent; never derive discovery URLs from client `Host`/`X-Forwarded-Host`.
3. **Check G3 — Flattened `sessionId` vs `targetId` Epoch Fencing (`cdp_gateway.rs:760-762, 1026-1041`, `session.rs`, `input.rs`):** **[REPO FACT]** Phase 04 Cycle 3 review (`High #1 & #2 / C2`) showed the relay compares wire `sessionId` against `targetId`, leaves `native_target_id: None` on normal creation, and only sets `expected_viewport_epoch` in unit tests. **[EXTERNAL RECOMMENDATION]** Track `Target.attachedToTarget` `sessionId <-> targetId` mappings per upstream relay, retain direct-page route `target_id`, and wire `viewportEpoch` bumps into production `InputManager` admission + pre-dispatch checks.
4. **Check G4 — Setup Auth Window & Biased Cancellation (`cdp_gateway.rs:675-709, 862-952`):** **[UNVERIFIED / INFERENCE]** Starting the live-auth supervisor *after* `ensure_running`/upstream connect plus a 5s initial sleep leaves a revocation blind window during slow startups (`Phase 04 W1`). **[EXTERNAL RECOMMENDATION]** Start auth supervision before setup, race setup against cancellation, and use `biased;` `tokio::select!` so revocation preempts ready relay writes.

---

## 3. Chrome 136+ Remote Debugging Profile Changes & Credential Isolation

### Primary Source Evidence ([S1], [S2])
- **Non-Default `--user-data-dir` Requirement (`[S1]`):** **[EXTERNAL FACT]** Following App-Bound Encryption bypasses by infostealers, Chrome 136+ ignores `--remote-debugging-port` and `--remote-debugging-pipe` when pointed at the default Chrome data directory. Remote debugging requires `--user-data-dir` pointing to a non-standard directory, which uses a separate encryption key.
- **`DevToolsActivePort` & Stderr Emission (`[S2] :296-313`):** **[EXTERNAL FACT]** When `--remote-debugging-port=0` binds, `StartServerOnHandlerThread` prints `\nDevTools listening on ws://%s%s\n` to `stderr` and writes `<port>\n<browser_guid>` to `<output_directory>/DevToolsActivePort`.

### Concrete Review Checks (Phases 01–03, 08)
1. **Check P1 — Non-Default Restricted Profile & Launch Allowlist (`process.rs`, `profile.rs`):** **[REPO FACT]** Observed engine on host is Google Chrome `157.0.8103.38` (`engine-qualification.md:19`), well past the Chrome 136 cutoff. **[EXTERNAL RECOMMENDATION]** Verify launcher always supplies explicit hashed `--user-data-dir` (`<root>/{prod,dev}/<sha256>/user-data`, mode `0700`/restricted DACL), `--headless=new`, and `--remote-debugging-port=0`, while rejecting `--no-sandbox`, `--disable-web-security`, `--ignore-certificate-errors`, `--remote-allow-origins=*`, and `--password-store=basic` (`chromiumoxide` default).
2. **Check P2 — `DevToolsActivePort` Freshness & Secret Redaction (`process.rs`):** **[EXTERNAL RECOMMENDATION]** Because `DevToolsActivePort` persists in `output_directory` across crashes (`[S2] :306-310`), verify launcher removes any pre-existing `DevToolsActivePort` before spawn, caps discovery reads (<=64 KiB, 15s timeout), verifies loopback (`127.0.0.1`/`[::1]`) and child identity, and never logs the raw `ws://` capability GUID.
3. **Check P3 — Loopback TCP Non-Isolation Caveat (`architecture-contracts.md` §1):** **[REPO FACT]** Any local OS process/user sharing the network namespace can read `DevToolsActivePort` or connect to loopback TCP where `MayAccessAllCookies() == true`. Verify documentation/contracts never claim same-host local-user or hostile-tenant isolation.

---

## 4. Process & Profile Containment (Chromium / Linux / Windows Caveats)

### Caveats & Concrete Review Checks (Phases 01, 02, 08, 09)
1. **Check C1 — Linux PGID + Death-Pipe Supervision vs Sandbox Helpers (`process.rs`, `browser_host_platform.rs`):**
   - **Caveat:** Chromium spawns multi-process zygote/GPU/renderer trees; root `Child::kill` alone leaks descendants on parent `SIGKILL`, while changing systemd `KillMode` kills user PTYs.
   - **[REPO FACT]:** Linux uses `setpgid` + an anonymous death-pipe watcher grandchild (`platform-qualification.md:16, 41-42`), and `manager.lock` (`flock`) + `manager.json` + `reset.json` live outside `user-data/` so resets preserve the lock inode (`platform-qualification.md:53-70`). However, Phase 09 review (`W7`) found `browser_host_platform.rs:102-132, 190-238` only tests orderly `terminate()` and manual tombstone writes without parent `SIGKILL` injection, descendant PID inventory verification, or real PTY co-survival.
2. **Check C2 — Windows Job Object Ordering & Nested Sandbox Jobs (`process.rs`, `browser_host_platform.rs:87-92`):**
   - **Caveat:** Windows Chromium sandboxes child renderers using restricted tokens and nested Job Objects. Containment requires `CREATE_SUSPENDED` -> `AssignProcessToJobObject` (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) -> `ResumeThread` before child creation, plus restricted DACLs on the principal root.
   - **[REPO FACT]:** Non-Unix targets currently fail closed with `ProcessError::ContainmentUnavailable` (`engine-qualification.md:100`), yet `platform-qualification.md` claimed Windows completion without a Windows runner (`Phase 09 C2`). Review must keep Windows marked **UNQUALIFIED / FAIL-CLOSED** until native Windows PowerShell evidence is recorded.
3. **Check C3 — Reset/Logout Ordering, Worker Deadline & Generation Fencing (`manager.rs`, `store.rs`, `ServerSettingsDialog.tsx`):**
   - **Caveat:** Deleting `user-data/` or unlinking `SingletonLock` before all Chromium descendants exit corrupts profile databases or resurrects stale files.
   - **[REPO FACT]:** Phase 08 Cycle 2 review identified unresolved carryovers: (a) `manager.rs:817-844` awaits `sync_cb()` (`spawn_blocking` artifact file deletion) *before* spawning the manager worker and starting the 2s `cleanupPending` timer (`R1`, **[INFERENCE]** request drop can orphan durable reset intent); (b) `execute_handoff` drops Browser/selection locks before acquiring artifact entry lock (`R2`); (c) quota/upload reservations lack drop rollback (`R3`); (d) standalone UI reset/status callbacks omit `{token, generation}` fencing (`R4`) and mint a fresh `operationId` instead of resuming a failed tombstone's `operationId` (`R5`); and (e) media-session revocation before logout sends `Bearer` over non-loopback HTTP (`R8`).

---

## 5. Unresolved Questions

1. **Phase 04 Gateway Carryovers (`C2`, `W4`, `C1`):** Were flattened `sessionId -> targetId` correlation, production `InputManager` epoch wiring, and strict config-origin `webSocketDebuggerUrl` rewriting remediated after Cycle 3, or do they remain open at HEAD `cdfa9c6b`?
2. **Phase 08 Reset/Artifact Carryovers (`R1–R8`):** Does `manager.rs` at HEAD `cdfa9c6b` still execute `sync_cb()` file deletion before worker spawn/2s timer, and does UI retry reuse the tombstone's original `operationId`?
3. **Native Windows & Linux Fault-Injection Evidence (`Phase 09 C1/C2/W6/W7`):** When will a native Windows host runner and Linux `SIGKILL`/reset-interruption fault injection be executed to replace synthetic/fail-closed qualification claims?
