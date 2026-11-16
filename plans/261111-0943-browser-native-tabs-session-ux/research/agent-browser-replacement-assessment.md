# Research Report: `vercel-labs/agent-browser` Replacement & Integration Assessment

**Date**: 2026-11-11 | **Plan**: `plans/261111-0943-browser-native-tabs-session-ux/plan.md`
**Upstream Pin**: `vercel-labs/agent-browser` commit `d129226078e0fc8ee5dec48fbc96a46df5d0aafd` (`2026-11-10T19:56:18Z`, tree `c76df0f71f909625e6c8221e5873c9fb1be17f06`). Crate version `0.42.0` sampled from unpinned `main/cli/Cargo.toml`; exact release-tag equivalence not independently verified.

## External Fetch Log (5/5 Cap Reached)
1. `https://api.github.com/repos/vercel-labs/agent-browser/commits/main` (`200 OK`) — Pinned HEAD SHA, `v0.42.0`, per-platform npm binary packaging (`#2150`).
2. `https://raw.githubusercontent.com/vercel-labs/agent-browser/main/cli/Cargo.toml` (`200 OK`) — Rust crate metadata, dependencies, `Apache-2.0`.
3. `https://raw.githubusercontent.com/vercel-labs/agent-browser/d129226078e0fc8ee5dec48fbc96a46df5d0aafd/cli/src/native/browser.rs` (`200 OK`) — `BrowserManager`, CDP attach/discovery, tab/close/wedge/idle ownership.
4. `https://raw.githubusercontent.com/vercel-labs/agent-browser/d129226078e0fc8ee5dec48fbc96a46df5d0aafd/cli/src/native/daemon.rs` (`200 OK`) — Per-session UDS/TCP daemon loop, `StreamServer` boot, idle/autosave timers.
5. `https://raw.githubusercontent.com/vercel-labs/agent-browser/d129226078e0fc8ee5dec48fbc96a46df5d0aafd/cli/src/native/stream.rs` (`404 Not Found`) — Attempted module path failed; internal stream handlers/wire schema remain uninspected. A 404 alone does not establish the actual module layout or missing streaming features.

---

## 1. What `agent-browser` Is Today (vs. Browser Engine)

- **Not a Browser Engine `[STATIC CONFIRMED]`**: `agent-browser` (`v0.42.0`, Rust 2021) is a native CLI + per-session background daemon (`cli/Cargo.toml:1-47`). It contains **zero** HTML/CSS/JS rendering engine. It drives external browsers over CDP (`tokio-tungstenite = "0.24"`, `reqwest = "0.12"`).
- **Default & Optional Renderers `[STATIC CONFIRMED]`**:
  - Default engine `"chrome"` (`browser.rs:648, 709-715`): spawns local Chrome / Chrome for Testing (`launch_chrome`).
  - Optional engines (`browser.rs:667-708`): `"lightpanda"` (`launch_lightpanda`) and `"obscura"` (`launch_obscura`), both headless-only with no profiles, storage state, extensions, file access, or custom `--args` (`browser.rs:78-174`).
  - Local DamHopper baseline (`server/src/browser_host/process.rs:118-139, 309-325`, parent runtime check): already runs native `/opt/google/chrome/chrome` (observed `157.0.8103.38`, Blink+V8) as a direct child of `dam-hopper-server` using `chromiumoxide_cdp/types = 0.9.1` and `tokio-tungstenite = 0.28`.
- **License, Platform & Runtime Impact `[STATIC CONFIRMED]`**:
  - License: `Apache-2.0` (`cli/Cargo.toml:6`).
  - Packaging (`commits/main`, `package.json`): Node `>=22.0.0` launcher + 7 platform packages (`@agent-browser/cli-{darwin-arm64,darwin-x64,linux-x64-gnu,linux-arm64-gnu,linux-x64-musl,linux-arm64-musl,win32-x64-msvc}`).
  - Runtime model (`daemon.rs:33-175`): Spawns one OS daemon process per `--session <name>` listening on UDS (`.sock` on Unix) or localhost TCP (`.port` on Windows) plus an unconditional `StreamServer` TCP listener (`.stream`).

---

## 2. Attachment to DamHopper's Authenticated Raw CDP Gateway

- **Gateway Security Baseline (`server/src/browser_host/cdp_gateway.rs:185-232, 526-816`) `[STATIC CONFIRMED]`**:
  - Requires `Admin` principal via `Authorization: Bearer <token>` (or `--no-auth` loopback bypass) or single-use `Sec-WebSocket-Protocol: damhopper.browser.cdp.v1, damhopper.ticket.<base64url>` (`cdp_gateway.rs:535-612`).
  - Enforces exact single-Origin policy (allows Origin-less requests **only** with Bearer auth, `cdp_gateway.rs:185-209`), max 2 concurrent connections (`DEFAULT_MAX_AGENT_CDP_CONNECTIONS = 2`, `cdp_gateway.rs:35, 620`), 4 MiB frame cap, 5s write deadline, and 5s continuous DB live-auth supervision (`verify_live_admission`, `cdp_gateway.rs:793-815`).
- **Exact URL & Header Behavior in `agent-browser` (`browser.rs:820-833, 2970-3010`)**:
  - **HTTP Discovery Path Incompatibility `[STATIC CONFIRMED]`**: In `resolve_cdp_url` (`browser.rs:2975-3000`), passing `http(s)://<host>:<port>/api/browser/cdp/json/version` extracts only `host`, `port` (default `9222`), and `query`, **discarding the URL path**, and probes root `/json/version`. This fails against DamHopper's `/api/browser/cdp/json/version` route.
  - **Direct `ws(s)://` Endpoint Path `[STATIC CONFIRMED]`**: Passing `ws(s)://<host>:<port>/api/browser/cdp/ws` returns the URL verbatim (`browser.rs:2971-2973`) and calls `CdpClient::connect_with_headers(&ws_url, headers)` (`browser.rs:833`).
  - **Header Plumbing & Subprotocol Ticket Auth `[UNKNOWN / UNTESTED]`**: `browser.rs:820-833` confirms `headers: Option<Vec<(String, String)>>` is passed to `CdpClient::connect_with_headers`, which `[INFERENCE]` supports `Authorization: Bearer <token>` on Origin-less WS upgrade (`cdp_gateway.rs:192`). However, `cli/src/flags.rs` and `cli/src/native/cdp/client.rs` were not fetched at the 5-call cap, so exact CLI flag syntax for WS headers vs `Sec-WebSocket-Protocol` ticket subprotocols remains `[UNKNOWN]` and live handshake compatibility is `[UNTESTED]`.
- **Ownership on Connect, Tab, Close & Idle (`browser.rs`, `daemon.rs`) `[STATIC CONFIRMED]`**:
  - **Connect side effects (`browser.rs:884-998, 1041-1072`)**: `discover_and_attach_targets` attaches to existing non-internal pages, probes renderers via `Runtime.evaluate("1")`, and enables Page/Runtime/Network/WebMCP plus auto-attach with paused child admission. This differs from DamHopper's producer setup, which avoids `Runtime.enable`. Effects on detection, worker admission, input and concurrent viewers are **untested compatibility risks**, not an established violation or demonstrated site-login failure.
  - **Close (`browser.rs:1658-1685`)**: Because `self.browser_process` is `None` when attached via `--cdp`, `close()` skips `Browser.close` and only closes its own CDP WebSocket (`self.client.close().await`).
  - **Tab create/close (`browser.rs:1984-2005, 2138-2147`)**: CLI sends raw `Target.createTarget`/`Target.closeTarget`, bypassing the managed REST creation-key/preflight path. **Coordinator source correction:** DamHopper already accounts raw pages against shared capacity (`session.rs:1039-1061`, `admit_raw`) and reconciles native inventory/destruction (`manager.rs:2347-2404`). Do not infer raw commands evade all registry, network or revocation supervision. Logical-session adoption, close notification and human-view coexistence still need qualification.
  - **Idle shutdown (`browser.rs:643-645`, `daemon.rs:317-334`)**: `blocks_default_idle_shutdown()` is `true` when `browser_process.is_none()`, so the default 60m timeout (`DEFAULT_IDLE_TIMEOUT_MS`) re-arms without closing attached browsers. Explicit `AGENT_BROWSER_IDLE_TIMEOUT_MS` overrides this, running `auto_save_restore_state` and disconnecting.
  - **ID Domains `[STATIC CONFIRMED]`**: per-daemon `t1`/`t2`, raw Chrome target IDs and element refs (`browser.rs:314-384`) are not DamHopper logical session UUIDs. No built-in mapping was established in inspected source; a bridge would need explicit verified correlation, not URL guessing.

---

## 3. Can Its Streaming/Dashboard Replace DamHopper's Human Browser Surface?

**Not demonstrated as a drop-in replacement.** DamHopper's custom media/security/lifecycle contracts would need to remain or be deliberately reimplemented. The stream module was not inspected; absence of a feature from browser/daemon code is not proof the entire upstream project lacks it.

| Capability / Invariant | DamHopper Current Stack (`server/src/browser_host/`) | `agent-browser` (`v0.42.0`) |
|---|---|---|
| **Video Wire Framing** | BHJF v1, decimal epochs, bounded per-viewer credits (`protocol.rs`, `media.rs`). | StreamServer exists (`daemon.rs:129-158`); exact wire/credit behavior unknown. No compatible DH consumer contract established. |
| **Tab Audio (PCM)** | Fenced 24 kHz PCM16LE and synchronous privacy/hide flush (`screencast.rs`, `pcm-player.ts`). | Stream internals uninspected; audio presence/absence and compatibility unknown. Must prove end-to-end parity before substitution. |
| **Input & Mobile IME** | Cooperative leases, ordered input, held-key cleanup and text proxy (`input.rs`, `text-input-proxy.tsx`). | CLI commands confirmed; human stream input/IME internals uninspected. DH lease/proxy integration not established. |
| **Auth, Viewers & Privacy** | Live admitted Admin, ticket/origin checks and Cognito/PIN fences. | Local daemon command transport inspected; no DH integration shown. Attachment through DH gateway would retain gateway checks; separately exposed upstream services need their own trust analysis. |
| **Profiles & Containment** | Principal profile directory, flock, reset tombstones and owned process containment. | Attached mode rejects separate --profile (`browser.rs:36-39`) and does not own Chrome on close. Replacement launch/containment/reset parity not established; retain DH ownership for an external-client design. |

---

## 4. Architectural Options Comparison

| Option | Benefits | Costs & Risks | Smallest Scope / Prerequisites / Migration Risks |
|---|---|---|---|
| **A. Keep Current Stack** | Preserves existing renderer and DH owners; directly supports planned tab UX. | Continued maintenance of custom CDP/media stack. | No additional control-stack migration; existing UX/state migration still carries its documented risks. |
| **B. Optional External Automation Client** | Adds CLI snapshots/locators while DH keeps Chrome, profile, API and human media owners. | Whole-instance raw-CDP trust; attach/domain/viewport side effects; local state-export risk; exact authenticated CLI header wiring unverified. Raw pages remain supervised by DH observer/capacity. | Recommended investigation boundary: existing direct ws(s) gateway, secure credentials, no unwanted autosave/state export, target identity and coexistence checks. Not a proven setup recipe or low-risk guarantee. |
| **C. Replace Control Stack** | Could delegate generic automation operations upstream. | Must adapt/prove DH media, identity, leases, auth, process/profile/reset and tab contracts; added daemon/services. Not an engine change when Chrome remains renderer. | Major architecture migration, not a drop-in or justified dependency of native tab UX. Do not reuse/migrate a live profile concurrently or promise cookie preservation without proof. |
| **D. Alternative Renderers** | Potential automation-specific choice; no measured benefit here. | Inspected Lightpanda/Obscura branches reject several Chrome profile/state/options (`browser.rs:78-174`). Human rendering/media/OAuth parity not qualified. | Not recommended for this Browser UI plan on current evidence; no memory/speed/site-compatibility guarantee. |

---

## 5. Recommendation & Bounded Spike Specification

### Recommendation
1. **Recommendation:** keep Chrome and DamHopper's control/media/profile owners for the native-tabs UI plan. Agent-browser is an automation client/daemon, not a direct replacement rendering engine; custom-contract parity is unproven.
2. **Scope recommendation:** keep adoption out of the UX critical path. The user may choose a bounded compatibility investigation alongside this plan or a separate follow-up; that is a product/scope decision, not a static fact or settled authorization.
3. If CLI snapshot/locator ergonomics are desired, assess trusted external-client attachment through the existing gateway before considering control-stack replacement.

### Affected Local Boundaries & Bounded Go/No-Go Spike (Separate Future Plan Only)
- **Potential Local Boundaries**: authenticated raw CDP gateway/discovery, logical/raw target reconciliation and capacity, credential delivery, agent launch tooling, profile/state-export policy and existing same-target human-view coexistence checks. These are investigation surfaces, not authorization to change backend routes or weaken policy.
- **Observable Go/No-Go Checks (Before Any Integration)**:
  1. **Source Check**: Inspect upstream `cli/src/flags.rs`, `cli/src/native/cdp/client.rs`, and `cli/src/native/stream/` to confirm exact CLI flag/env syntax for WebSocket `Authorization: Bearer` headers and `Sec-WebSocket-Protocol` ticket headers.
  2. **Auth & Origin Gate**: Verify `agent-browser --cdp ws://127.0.0.1:<port>/api/browser/cdp/ws` authenticates with Bearer header (and rejects unauthenticated/bad-Origin upgrades with `401`/`403`).
  3. **Coexistence & State Gate**: inspect actual target-selection flag wiring (do not assume --pin-tab prevents initial sibling attachment), qualify Runtime/auto-attach/viewport side effects with a human viewer, and prove configured state-export/autosave policy prevents unwanted credential copies. No Chrome profile or cookie migration during the investigation.

---

## 6. Material Evidence Blockers & Unresolved Questions

- **Material Evidence Blockers (from 5-Fetch Cap)**:
  1. Stream module internals were not read after the attempted `cli/src/native/stream.rs` path returned 404; wire/audio/interactive-input behavior remains unknown.
  2. `cli/src/flags.rs` and `cli/src/native/cdp/client.rs` were not directly read; exact CLI flag/env wiring into `connect_cdp_with_headers` and WebSocket subprotocol support are `[UNKNOWN]`.
  3. Live runtime attach of `agent-browser v0.42.0` against `dam-hopper-server`'s `/api/browser/cdp/ws` is `[UNTESTED]`.
- **Unresolved Questions**:
  1. Does the user want `agent-browser` solely as an optional external CLI for trusted Admin agents over `/api/browser/cdp/ws`, or were they seeking a lower-memory renderer?
  2. Can the attached client coexist with current producer setup, target admission and login workflows without regressions? This requires source/runtime qualification, not user consent to assume safety.
