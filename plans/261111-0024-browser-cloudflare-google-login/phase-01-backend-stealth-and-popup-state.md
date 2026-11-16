# Phase 01 — Backend Stealth and Popup State

Priority: P2 · Status: pending · Effort: 8h · Owner: backend implementer.

## Context and requirements
- [Overview](./plan.md); supplied investigation of `c1deabaa`, `08901a14`, `13de0468`, `588c44c6`.
- Reference: `/home/loidinh/WS/aicoworker/electron/browser/chrome-identity.ts` and `anti-detection-preload.cjs`; adapt techniques, not Electron process/session ownership.
- Existing standards: [code standards](../../docs/code-standards.md), [browser architecture](../../docs/architecture/host-browser-cdp-streaming.md).
- Launch currently exposes automation/headless signals. JS alone cannot fix engine-level webdriver exposure in cross-origin frames/workers.
- Popup admission already materializes through the adoption pump and `ProducerOrigin::Popup`; registry updates, not a second event bus, must notify existing opener viewers.

## Architecture and interface contract
1. `BrowserProcess::launch` adds one safe engine flag. `ChromeIdentity` derives one identity per producer/browser version; no CDP lookup per intercepted request/frame.
2. `build_producer` installs request policy and calls `ScreencastProducer::apply_stealth_and_focus(&self, page_sid: &str)` before initial navigation or popup resume. Existing single-flight/admission fences still determine `Running` publication.
3. Page-scoped OOPIF attachment applies the same identity/focus/script on child sessions; browser-level paused **page** admission still controls popup containment. Never replace its filter or resume unmanaged pages.
4. Registry relationship: child records `parent_session_id` at admission; successful `commit_running` sets its live parent's `active_popup_session_id` and publishes parent `sessionUpdated`. Retirement clears the pointer only if it still references that child.
5. Rust fields use `Option<String>`; DTO fields retain `#[serde(skip_serializing_if = "Option::is_none")]` under existing camelCase serialization. Ordinary sessions initialize both to `None`; child DTO retains parent identity for restore context. No persistent schema.

## File ownership and actions
All paths below are relative to `/home/loidinh/WS/dam-hopper/`; only the listed task may write each path at a time.

| Task | Action / files |
| --- | --- |
| `normalize-browser-identity` | Modify `server/src/browser_host/process.rs`, `mod.rs`; create `server/src/browser_host/stealth.rs`; colocated launch/identity tests |
| `apply-browser-stealth` | Modify `server/src/browser_host/cdp.rs`, `screencast.rs`, `media.rs`; colocated CDP/producer tests |
| `publish-popup-lifecycle` | Modify `server/src/browser_host/session.rs`, `session-state-tests.rs`, `manager.rs`; existing constructors/admission/retirement tests |

No files deleted. No writes to the aicoworker reference. Shared `media.rs` remains owned by `apply-browser-stealth`; unexpected additional callers require integration-owner reassignment before editing.

## Implementation steps

### normalize-browser-identity
1. Add `--disable-blink-features=AutomationControlled` to launch defaults and accept **only that exact argument** in `is_allowlisted_arg`. Reject arbitrary/comma-extended Blink-feature flags and retain all existing forbidden launch settings. Preserve `--headless=new`, managed debugging endpoint and process containment.
2. Create/register focused `stealth.rs` (<200 LOC). `ChromeIdentity` parses `Browser.getVersion`, strips headless branding, derives platform-accurate desktop UA/platform, frozen `Chrome/<major>.0.0.0` and matching `userAgentMetadata`. Preserve actual full version in `fullVersionList`; fallback version `136.0.0.0` only when discovery is unavailable/unparseable. Keep platform/architecture fields coherent with actual runtime.
3. Emit matching brands: `Not;A=Brand` v8, `Chromium` v<major>, `Google Chrome` v<major>; align full versions, platform and JS userAgentData/high-entropy fields. Use safe serialization when embedding identity values into JS.
4. Port `ANTI_DETECTION_SCRIPT` with an idempotent Symbol guard: webdriver deletion, userAgentData, Chrome PDF plugins/mimeTypes, `window.chrome.app/runtime/csi/loadTimes`, permission-query/Notification normalization, media `canPlayType`, nonzero outer dimensions, document focus, same-origin iframe `contentWindow` proxy and CDP stack cleanup. Preserve native behavior for unrelated inputs; do not fake permission grants, bypass origin checks, or suppress unrelated errors. Codec claims must match the reference/platform, not indiscriminately return playable.
5. Add identity cases for valid/malformed/missing versions, platform consistency and fallback; launch allowlist cases include exact acceptance and unsafe variants rejected. Document script-specific compatibility assumptions in short comments.

### apply-browser-stealth
1. Fetch `Browser.getVersion` using existing bounded command handling; cache identity for producer initialization. Implement `apply_stealth_and_focus`: `Emulation.setFocusEmulationEnabled({enabled:true})`, `Emulation.setUserAgentOverride` with metadata and `Page.addScriptToEvaluateOnNewDocument`. Register before first navigation; apply the script to an already-created current document where required using existing evaluation primitives.
2. In `build_producer`, invoke setup before initial navigation and before successful popup adoption returns for resume. Preserve ordering of network-policy installation and existing page admission. Use existing creation error/cleanup paths for failed required setup; no silent partial-success session.
3. Enable page-session OOPIF auto-attach with `autoAttach:true`, `filter:[{"type":"iframe"},{"exclude":true}]`, `waitForDebuggerOnStart:false`, `flatten:true`. Handle nested `Target.attachedToTarget` using the **child** CDP session ID; apply identity/focus/preload for `iframe` targets, including nested OOPIF attachment, without registering them as popup pages.
4. Route nested attachment events through existing bounded CDP/producer mechanisms; do not lose them at the root-only native-page publisher. Retire handlers with producer/child detachment and preserve CDP command budgets. Do not block the actor awaiting replies it must itself dispatch.
5. In `CdpActor::decide_request`, retain the URL/network-policy verdict first. Only allowed `Fetch.continueRequest` requests with a string header containing `HeadlessChrome` gain header overrides: `HeadlessChrome`→`Chrome` in User-Agent, headless brand→`Google Chrome` in client hints. Preserve all other names/values; never concatenate duplicate header semantics or log auth/cookie values. Requests without the marker keep the exact existing payload path, avoiding needless header allocation.
6. Test generated command ordering, child-session routing, reload registration/idempotence, unchanged no-marker continue payload, rewritten UA/client hints, and blocked-request precedence. Worker coverage distinguishes engine webdriver state from HTTP-header cleanup; page preload is not a worker-global script.

### publish-popup-lifecycle
1. Add optional `active_popup_session_id` and `parent_session_id` to `BrowserSessionDto` and `BrowserSession`; map in `to_dto`, initialize every ordinary/popup constructor and update all affected colocated fixtures. No deprecated alias/event-only substitute.
2. At popup reservation set the parent link after existing owner/incarnation/cap checks. Retain `NativePumpRequest::AdoptPopup` materialization; do not require a UI viewer before popup becomes Running.
3. In `commit_running`, after existing live/incarnation/native-target checks, validate a still-running same-owner, same-profile-epoch/incarnation parent. Commit child state and update/publish parent metadata under existing registry synchronization; do not hold a lock across CDP awaits. Notify opener streams with ordinary `sessionUpdated`, not just `PopupAdmitted`.
4. Reuse a small registry-internal relationship cleanup operation across native target destruction, close/forget, rollback/removal, incarnation retirement and principal shutdown/reaping. Ensure retired sessions cannot retain live child pointers; no recursive close policy change. Only clear parent pointer when `parent.active_popup_session_id == retiring_child_id`, so an older popup cannot erase a newer one.
5. For multiple running children, pointer represents latest committed popup; older-child retirement leaves it untouched. Latest-child retirement clears it rather than silently selecting another child. Failed admission/creation never publishes an active pointer; preserve existing `popupBlocked` semantics and parent updates for admission refusal.
6. Test DTO omission/camelCase, publish-on-Running not Initializing, opener update delivery, existing popup materialization without viewer, blocked/cancelled adoption, duplicate retirement, old-child/new-child races, parent lost/reset/logout and owner/incarnation isolation. Keep opener session/cookies/native target intact after child `window.close()`.

## Durable tasks and todo
```evcrate-tasks
[
  {
    "id": "normalize-browser-identity",
    "title": "Add exact launch flag and coherent Chrome identity/preload",
    "blocked_by": [],
    "allowed_files": ["server/src/browser_host/process.rs", "server/src/browser_host/mod.rs", "server/src/browser_host/stealth.rs"],
    "constraints": ["Keep stealth.rs under 200 LOC; reuse supplied reference techniques without dependencies.", "Allow only the exact AutomationControlled flag; retain containment and browser security protections."],
    "acceptance": ["Launch uses the exact safe flag and rejects unsafe variants.", "Version/platform-derived UA, metadata and guarded preload cover all listed normalization surfaces with coherent fallback."],
    "verification": ["Integration owner runs cargo test --manifest-path server/Cargo.toml after all implementation tasks land; inspect launch/identity regression results.", "Live Chromium inspection checks webdriver in page, OOPIF and worker contexts; do not infer worker JS injection from a page preload."]
  },
  {
    "id": "apply-browser-stealth",
    "title": "Apply identity, focus, OOPIF preload and policy-preserving headers",
    "blocked_by": ["normalize-browser-identity"],
    "allowed_files": ["server/src/browser_host/cdp.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs"],
    "constraints": ["Preserve paused page/popup admission and bounded CDP actor behavior.", "No-marker requests keep the original continue payload; denial policy cannot be bypassed by rewriting.", "Non-paused iframe attachment is race-prone; qualify live document-start behavior rather than claiming a guarantee."],
    "acceptance": ["Initial page and adopted popup setup precede navigation/resume; iframe child sessions receive the same identity/focus/preload.", "Only HeadlessChrome-bearing allowed request headers change; worker/network and existing policy behavior remain intact."],
    "verification": ["Integration owner runs cargo test --manifest-path server/Cargo.toml once after integration; review CDP routing, policy and ordering regressions.", "Inspect actual UA/client hints and JS surfaces on top-level, reloaded and cross-origin challenge documents; record any first-document attach race."]
  },
  {
    "id": "publish-popup-lifecycle",
    "title": "Publish parent-child popup state through existing session updates",
    "blocked_by": ["apply-browser-stealth"],
    "allowed_files": ["server/src/browser_host/session.rs", "server/src/browser_host/session-state-tests.rs", "server/src/browser_host/manager.rs"],
    "constraints": ["Reuse popup adoption, registry locking, command policy and owner/incarnation fences.", "Never clear a newer active popup when an older child retires; no cookie/token persistence changes."],
    "acceptance": ["Optional camelCase relationship fields publish to opener viewers only after child Running.", "All close/lost/rollback/reset/logout paths clean relationship state without retiring the live opener or resurrecting stale sessions.", "Blocked popup feedback remains available and admission requires no popup UI viewer."],
    "verification": ["Integration owner runs cargo test --manifest-path server/Cargo.toml and records session lifecycle/DTO regression results after integration.", "Open and close a real window.open popup without attaching a viewer first; observe opener sessionUpdated then cleared pointer."]
  }
]
```

- [x] <!-- evcrate-task:normalize-browser-identity --> Normalize launch and identity.
- [x] <!-- evcrate-task:apply-browser-stealth --> Apply pre-navigation and OOPIF setup; sanitize headers.
- [x] <!-- evcrate-task:publish-popup-lifecycle --> Publish and clean popup relationship state.

## Verification, risks and rollback
- Final integration owner, not in-flight implementers, runs `cargo test --manifest-path server/Cargo.toml` once after both phases. Automated tests prove exercised contracts, not Cloudflare/Google acceptance.
- Live inspect `navigator.webdriver`, UA/CH/fullVersionList, userAgentData, plugins, permissions, chrome APIs, focus and outer geometry in a top page and cross-origin challenge frame; inspect worker requests separately.
- `waitForDebuggerOnStart:false` avoids pausing iframe execution but can race the first document's script. Cover real first-load/reload journeys and report observed failures honestly; do not change paused page policy or promise universal stealth.
- Fingerprint patches may regress site behavior; preserve property descriptors/native error shapes where possible. Never weaken sandbox, TLS, origin separation, SSRF/redirect policy, process flags or permissions to obtain a pass.
- Roll back only this change's identity/preload/attach/header integrations and optional relationship fields together with UI consumers; restart managed browser through existing lifecycle. Preserve profiles and cookies; no destructive Git commands or user-profile deletion.

## Handoff
Phase 02 consumes the camelCase optional fields and exact parent publication/cleanup semantics. Integration owner updates existing browser architecture, allowlist standards and changelog in phase 02 finalization. No unresolved authoring questions; live qualification and coordinator review remain pending.
