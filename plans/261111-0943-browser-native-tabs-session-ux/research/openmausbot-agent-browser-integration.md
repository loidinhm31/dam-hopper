# Research Report: OpenMausBot `agent-browser` Integration & DamHopper Applicability

**Date**: 2026-11-11 | **Target Plan**: `plans/261111-0943-browser-native-tabs-session-ux/plan.md`
**Pinned Repo**: [`milind-soni/OpenMausBot`](https://github.com/milind-soni/OpenMausBot/tree/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d) commit [`613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d`](https://github.com/milind-soni/OpenMausBot/commit/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d) (`2026-11-11T02:48:39Z`, tree `60ee3ce81915955d083c402544d5800db340c9da`).

## External Fetch Log (5/5 Cap Reached)
1. [`api.github.com/.../commits/main`](https://api.github.com/repos/milind-soni/OpenMausBot/commits/main) (`200 OK`, `artifact://22`) — Pinned HEAD commit `613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d`, tree SHA, `server/index.ts` & `electron/main.mjs` patches.
2. [`api.github.com/.../git/trees/60ee3ce81915955d083c402544d5800db340c9da?recursive=1`](https://api.github.com/repos/milind-soni/OpenMausBot/git/trees/60ee3ce81915955d083c402544d5800db340c9da?recursive=1) (`200 OK`, `artifact://23`) — Full 63,631-line tree across `server/browser*`, `src/components/browser/*`, `electron/*`, `third_party/*`.
3. [`raw.githubusercontent.com/.../server/browser/engines.ts`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts) (`200 OK`, `artifact://24`) — Dual-engine routers (`RuntimeRouter`, `LiveRouter`) & `ChromeEngine` (`"omb-cdp"`).
4. [`raw.githubusercontent.com/.../server/host/browser.ts`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts) (`200 OK`, `artifact://25`) — Host wiring, turn MCP proxy tokens, profile/session lifecycle, lent Chrome doors, cleanup.
5. [`raw.githubusercontent.com/.../server/browser-engine.ts`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts) (`200 OK`, `artifact://26`) — `agent-browser` binary resolution, SHA-256 installer, `agentBrowserIntegration` CLI/MCP flags, daemon/state/profile workarounds.
- *Local artifacts reused (0 external fetches)*: Parent `artifact://19` (root README/tree), `plans/261111-0943-browser-native-tabs-session-ux/reports/current-browser-engine.md`, peer `plans/261111-0943-browser-native-tabs-session-ux/research/agent-browser-replacement-assessment.md`.

---

## 1. What Pinned OpenMausBot Actually Uses (Q1)

- **Dual browser-control paths `[STATIC SOURCE]`**: pinned source wires two selectable **automation/control backends**, not two different rendering engines, through RuntimeRouter and LiveRouter. Both inspected branches use external Chrome; reachability here is source wiring, not a runtime qualification.
  1. **Default `agent-browser` Engine (`browserEngine.engine = "agent-browser"`, plus all "My Chrome" attaches)** ([`server/host/browser.ts:1-3, 333-335, 551`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts#L1-L3)):
     - Resolves binary via [`resolveAgentBrowserBinary`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L395-L407): (a) `OMB_AGENT_BROWSER_PATH`, (b) packaged desktop bundle `$OMB_RESOURCES_PATH/browser-engine/<platform>-<arch>/` verified for `[manifest, engine, chrome, licenses]` ([`server/browser-engine.ts:381-393`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L381-L393)), (c) size+SHA-256 verified download to `<DATA_DIR>/tools/agent-browser/<AGENT_BROWSER_VERSION>/agent-browser[.exe]` ([`server/browser-engine.ts:352-355, 410-471`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L410-L471)), or (d) `PATH` fallback with version mismatch warning ([`server/browser-engine.ts:308-316`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L308-L316)).
     - Provenance/patches: Bundled via `scripts/prepare-browser.mjs` and `.github/workflows/browser-vendor-windows.yml` with local patch `third_party/browser/agent-browser-windows-stdio.patch` (`artifact://23:149, 19962, 63165`). Source comments target **`agent-browser 0.36/0.37`** ([`server/browser-engine.ts:44, 198, 210, 560`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L44)); exact `AGENT_BROWSER_VERSION` constant lives in `server/browser-engine-release.ts` (`[UNKNOWN]` at 5-fetch cap).
     - Spawns `agent-browser mcp --tools core --no-webmcp` ([`server/browser-engine.ts:635`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L635)) plus CLI subcommands (`session list --json`, `open --json --no-webmcp`, `close`, `install`) ([`server/browser-engine.ts:116, 158, 177, 190, 481`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L116-L190)).
  2. **New Direct-CDP Engine (`ChromeEngine` / `"omb-cdp"`, when `browserEngine.engine = "chrome"`)** ([`server/browser/engines.ts:1-4, 26, 55-127`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L55-L127)):
     - **Bypasses `agent-browser` completely** (`"one Chrome launcher (no agent-browser wrapper), the browser service, its live views and its sweep"`, [`server/browser/engines.ts:55`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L55)).
     - Uses OpenMausBot's own TypeScript CDP client (`server/browser/cdp/*.ts`, `artifact://23:23795-24100`) + vendored Playwright ARIA snapshot scripts (`third_party/playwright-injected/src/{ariaSnapshot,ariaSnapshotDistiller,domUtils,roleUtils}.ts`, `artifact://23:63365-63504`) + `server/browser/{service,tabs,viewers/*}.ts`.
- **Electron `webContents` & VM/Computer-Use Separation (`[STATIC CONFIRMED]`)**:
  - In inspected browser-engine/router branches, the bot browser is external Chrome/Chrome for Testing; Electron supplies the desktop shell. BrowserPanel and remaining Electron bodies were not fully inspected, so no claim that every possible embedded surface was excluded.
  - Full-desktop computer use — **Boat** cloud Linux VMs (`server/boat.ts`), **Local VMs** (`server/local-vm-box.ts`), and host **Cua Driver 0.41.3** (`electron/cua.mjs`, `third_party/cua-driver/`) — is a separate subsystem from the CDP browser host ([`README.md:394-441, 505-530`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/README.md)).
- **Licensing evidence boundary**: fetched README declares Apache-2.0 except enterprise; tree lists third-party license/notice files for agent-browser, Playwright, Puppeteer, axe-core and Cua. Full license/notice texts and vendor build script were not fetched. Exact obligations for any copied/vendored artifact must be verified before reuse; filenames and root license do not certify every subtree.

---

## 2. End-to-End Trace & Persistence Boundaries (Q2)

```text
Agent CLI (claude/codex/grok)
  └─ stdio MCP -> node [SPAWNED_PROXIES.harnessMcp, "browser"] + per-turn token (server/host/browser.ts:346-354)
       └─ HTTP -> Harness Server (127.0.0.1:PORT) -> RuntimeRouter.agentRpc (server/browser/engines.ts:219-240)
            ├─ [default / My Chrome] -> BrowserRuntime -> agent-browser (mcp / relay) -> daemon (<session>.pid/.stream) -> Chrome
            └─ [engine="chrome" ("omb-cdp")] -> ChromeEngine -> BrowserService -> server/browser/cdp/* -> Chrome
```

1. **Agent Command -> Harness MCP Proxy**: Bot turns never execute `agent-browser` directly; [`turnIntegration`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts#L346-L354) spawns `SPAWNED_PROXIES.harnessMcp` (`server/harness-mcp-proxy.ts`) with a turn-scoped capability token (`mintInternalCapability`).
2. **Router -> Engine Process**: [`RuntimeRouter.agentRpc`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L219-L240) enforces egress policy (`browserEgress.callRefusal`), claims `browser:${session}`, and dispatches to either `BrowserRuntime` (`agent-browser`) or `ChromeEngine.service` (`"omb-cdp"`).
3. **Where Sessions, Tabs & Cookies Survive**:
   - **Session scoping**: Per-bot (`bot-<botId>` / `bot:<botId>`), shared profile (`<partitionId>` / `shared:<partitionId>`), or guest (`guest-<hash>-<rand>` / `temp:<session>`), suffixed per Team Cloud audience ([`server/host/browser.ts:255-275, 336-341`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts#L255-L275)).
   - **On agent-browser**: OMB comments describe temp-profile/restore-name problems in older 0.36/0.37 behavior. Its adapter sets an explicit persistent AGENT_BROWSER_PROFILE and manages encrypted restore-state files (`server/browser-engine.ts:32-49,229-287,517-528,614`). These are confirmed OMB policies; their necessity for current upstream 0.42.0 is unverified.
   - **On `ChromeEngine` (`"omb-cdp"`)**: Persistent Chrome profiles live under `browserRoot(dataDir)/profiles` (`server/browser/chrome/profile.ts`), with server-owned tab tracking (`server/browser/tabs.ts`) and 60s idle/process sweeps (`MAX_RUNNING = { desktop: 6, server: 4, container: 2 }`, [`server/browser/engines.ts:41-42, 130-148`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L41-L42)).
   - **On My Chrome**: inspected adapter selects AGENT_BROWSER_AUTO_CONNECT or AGENT_BROWSER_CDP and sets AGENT_BROWSER_RESTORE_SAVE="never" (`server/browser-engine.ts:605-610`). Intended to avoid copying attached-browser state; runtime guarantees and support in the selected upstream version require qualification.
4. **Human Browser Panel / Stream / Input ([`LiveRouter`, `server/browser/engines.ts:299-347`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L299-L347))**:
   - `agent-browser` supports **only legacy v1 viewing** (`BrowserLive` via `relay(port, { action: "cdp_url" })`, [`server/host/browser.ts:118-120`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/host/browser.ts#L118-L120)).
   - **`StreamV2` (`server/browser/viewers/stream-v2.ts`), popups (`server/browser/viewers/popups.ts`), file choosers, and downloads exist ONLY on `ChromeEngine` (`"omb-cdp"`)** (`LiveRouter.stream` returns `false` on `agent-browser`, [`server/browser/engines.ts:294-297, 320-338`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser/engines.ts#L320-L338)).

---

## 3. UX vs. Automation Decisions & DamHopper Incompatibilities (Q3)

- **Human-browser adapter evidence, not an upstream limitation proof**:
  - OMB's browser-engine.ts contains compatibility/security workaround comments referring to older agent-browser behavior (including 0.37). The following are historical integration evidence, **not reproduced bugs or current 0.42.0 security findings**:
    1. *Implicit daemon/Chrome relaunches*: `agent-browser` silently relaunches Chrome when env flags differ ([`L560-561`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L560-L561)) and starts a daemon on `close` if launch flags are present ([`L75, L148`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L148)).
    2. *Orphaned Chrome processes*: Native `close` returns before daemon exit, re-parenting Chrome helpers; OMB must scrape `<session>.pid` process trees before closing and poll every 25ms ([`L151-169`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L151-L169)).
    3. *Broken `state clear`*: Upstream CLI drops session names before dispatch (`"never use it"`, [`L704`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L704)).
    4. *Unauthenticated any-Origin `.stream` server*: `"agent-browser 0.37 upgrades a WebSocket from any origin"` ([`L210`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L210)).
  - Its inspected LiveRouter exposes its newer StreamV2/picker/download routes only for the direct-CDP backend. This demonstrates OMB-owned integration work; it does not prove upstream agent-browser lacks equivalent features elsewhere or establish why the authors added that backend.
- **DamHopper transfer risks `[ENGINEERING ASSESSMENT]`**:
  - **Host Desktop Privileges**: OMB's `AGENT_BROWSER_AUTO_CONNECT="1"` (`DevToolsActivePort` / ports `9222/9229`) and Electron `utilityParentPort` IPC assume a single-user desktop host. DamHopper retired its desktop host (`README.md:5, 25`) and isolates per-principal headless Chrome on a multi-user server (`docs/architecture/host-browser-cdp-streaming.md:12-19, 65`).
  - **Security/containment parity is unproven**: OMB's observed wrapper uses PID-tree capture/polling and local-service isolation policies; DamHopper owns process-group containment, principal auth, tickets and privacy fences. Do not replace those owners with a desktop-local adapter or expose an upstream stream port without qualification. Historical any-Origin comments are not a verified current-upstream vulnerability.
  - **Cookie Export**: OMB copies `~/.agent-browser/sessions/*.json.enc` state files; DamHopper (`coordinator-decisions.md:16`) forbids cookie/session export outside the server-owned `0700` Chromium profile.

---

## 4. Reusable Patterns vs. Control-Stack Replacement (Q4)

- **Control-stack replacement recommendation: do not adopt for this UI change.** Both products already use Chrome; OMB's router retains an agent-browser adapter and a separate direct-CDP human-view path. That is evidence an automation CLI alone does not supply the host application's complete native-tab UX/lifecycle contract, not proof replacement is technically impossible.
- **Small Reusable Agent-Automation Patterns (Separate from Human Tab UX)**:
  1. **Per-turn capability MCP proxy (`[STATIC CONFIRMED]`)**: Mounting a minimal stdio proxy (`server/harness-mcp-proxy.ts`) with a turn-scoped capability token (`server/host/browser.ts:346-354`) rather than exposing raw browser binaries/profiles to agent CLIs.
  2. **Stateless CDP-attach flags (`[STATIC CONFIRMED]` in OMB, `[UNTESTED]` with DamHopper)**: When attaching `agent-browser` to an external CDP endpoint, OpenMausBot sets `AGENT_BROWSER_CDP=<wsUrl>`, `AGENT_BROWSER_RESTORE_SAVE="never"`, `AGENT_BROWSER_NO_WEBMCP="1"`, `AGENT_BROWSER_CONFIG=<empty.json>`, and `args: ["mcp", "--tools", "core", "--no-webmcp"]` ([`server/browser-engine.ts:592-635`](https://github.com/milind-soni/OpenMausBot/blob/613ed01fdc2b04860ef63e3dbdcb46d7e6b1666d/server/browser-engine.ts#L592-L635)).
  3. **Proposed DamHopper Boundary (`[INFERENCE / UNTESTED FIT]`)**: Keep `server/src/browser_host/*` and `packages/ui/src/os/*` authoritative. If `agent-browser` CLI/MCP tools are desired for agents, evaluate attaching as an external client to `ws(s)://<host>:<port>/api/browser/cdp/ws` (`server/src/browser_host/cdp_gateway.rs`; HTTP discovery `/api/browser/cdp/json/version` is incompatible because upstream `resolve_cdp_url` discards URL paths). Note that DamHopper's raw target observer (`session.rs:1039-1061` `admit_raw`, `manager.rs:2347-2404`) still enforces shared target capacity, network policy, and native destruction reconciliation, though raw CLI target creation bypasses REST `creationKey` idempotency. Exact upstream CLI WS `Authorization` header/ticket flag wiring (`[UNKNOWN]` at 5-fetch cap) and `Runtime.enable`/auto-attach/sibling-target attach side effects with concurrent human viewers (`[UNTESTED]` compatibility risks, not proven breaches) require qualification before adoption.

---

## 5. Recommendation for Active Plan (Q5)

- **Primary Recommendation — Keep `plans/261111-0943-browser-native-tabs-session-ux/plan.md` UNCHANGED on the UX critical path (Option 1), with any `agent-browser` gateway attach check isolated to a separate spike plan (or optional bounded non-blocking spike phase if requested by user).**
  - The active plan solves human multi-tab chrome, `(windowId, tabId)` viewer isolation, and fail-closed Web Locks recovery over DamHopper's existing multi-target Rust/Chrome stack with zero backend/dependency changes (`plan.md:21-29`).
  - In OpenMausBot's inspected source, `LiveRouter` (`server/browser/engines.ts:294-338`) disables `StreamV2`, file pickers, and downloads on `agent-browser` sessions and requires OpenMausBot's own `"omb-cdp"` direct-CDP engine for them (upstream `agent-browser` stream internals remain `[UNKNOWN]` at the 5-fetch cap).
  - Make **no** unverified performance or Cloudflare/Google login compatibility guarantees, and do **not** copy OpenMausBot's broad Electron/Boat/LentChrome/Cua product stack.
---

## 6. Evidence Limitations & Unresolved Questions

- **Evidence Limitations (5-Fetch Cap)**:
  1. Exact AGENT_BROWSER_VERSION literal was not fetched. Comments mention 0.36/0.37 workarounds; they do not verify the currently packaged binary version or establish current upstream 0.42.0 bugs.
  2. Internal implementation of OpenMausBot's `server/browser/cdp/*`, `server/browser/tabs.ts`, `server/browser/viewers/stream-v2.ts`, and `src/components/BrowserPanel.tsx` was not read beyond `server/browser/engines.ts` and the recursive file tree (`artifact://23`); absence of inspected source due to the 5-fetch cap is `[UNKNOWN]`, not proof a feature is absent.
  3. No runtime execution, install, or live CDP attach test was performed (per research-only safety constraint).
- **Unresolved Questions**:
  1. Did the user's interest in OpenMausBot stem from wanting `agent_browser_*` (`@eN` ARIA snapshot) MCP tools for local coding agents, or from assuming `agent-browser` powered OpenMausBot's human browser UI?
