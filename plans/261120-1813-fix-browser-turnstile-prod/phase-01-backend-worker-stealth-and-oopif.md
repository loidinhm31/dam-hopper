# Phase 1: Backend Stealth, Worker Overrides & OOPIF Admission

## Context Links
- [stealth.rs](file:///home/loidinh/WS/dam-hopper/server/src/browser_host/stealth.rs)
- [screencast.rs](file:///home/loidinh/WS/dam-hopper/server/src/browser_host/screencast.rs)
- [manager.rs](file:///home/loidinh/WS/dam-hopper/server/src/browser_host/manager.rs)
- [browser_host_process.rs](file:///home/loidinh/WS/dam-hopper/server/tests/browser_host_process.rs)

## Overview
- **Priority:** P1 | **Status:** Completed | **Effort:** 3h
- Extract full Chrome version from `Browser.getVersion.product`, cache per-process UA override params on `NativeControl`, apply overrides to paused Web Workers, mask patched JS methods' `.toString()`, and admit OOPIF `iframe`s while their owned parent's frame tree is in flight.

## Key Insights
- Local Chromium `156.0.8078.79` returns `product: "Chrome/156.0.8078.79"` and `userAgent: "...HeadlessChrome/156.0.0.0..."`; checking `userAgent` first loses real `fullVersionList`.
- `Target.setAutoAttach` pauses `worker` targets (`waitForDebuggerOnStart: true`), and `Emulation.setUserAgentOverride` succeeds on paused workers before `Runtime.runIfWaitingForDebugger` + `Target.detachFromTarget`.
- `retain_page_session` (`manager.rs:5911-5915`) and `FrameNavigated` reseed (`manager.rs:6684-6716`) insert `state.owners` and start async `request_frame_tree` before `finish_frame_tree` inserts `state.frame_sessions`. Meanwhile `ChildAttached` (`manager.rs:6856-6863`) kills paused `iframe`s if `state.frame_sessions` lacks `parent_session_id`.
- Revoked root frame trees keep `state.owners` (`remove_owners = false`), so `paused_admitted` must require active frame-tree presence or pending/retry/ancestor frame-tree state, not `owners` alone.

## Requirements
- Prefer `product` over `userAgent` in `Browser.getVersion` parsing while keeping UA reduced to `Chrome/{major}.0.0.0` and `Not;A=Brand` v8 / `Google Chrome` contract intact.
- Cache resolved `ua_params` on `NativeControl` (retry on `Browser.getVersion` failure; never hold synchronous locks across `.await`).
- Apply `Emulation.setUserAgentOverride` on `ChildAttached` for `worker` / `shared_worker` before `release_attached`, failing open to `release_attached` on override error.
- Admit paused `iframe` when `token.is_some()` and `parent_session_id` is in `frame_sessions` or actively awaiting its frame tree (`pending_frames`, `frame_tree_retries`, or bounded `pending_children` ancestor chain with matching `owner` and `token`); remain fail-closed otherwise.
- Mask `.toString()` via single-install `WeakMap` on `Function.prototype.toString` in `ANTI_DETECTION_SCRIPT` without breaking `server/tests/browser_host_process.rs:1433-1437`.

## Related Code Files
- Modify `server/src/browser_host/stealth.rs`
- Modify `server/src/browser_host/screencast.rs`
- Modify `server/src/browser_host/manager.rs`
- Modify `server/tests/browser_host_process.rs`

## Implementation Steps
1. **Shared `Browser.getVersion` helper & `toString` masking (`stealth.rs`):**
   - Add `ChromeIdentity::from_get_version(version_payload: Option<&Value>) -> Self` trying `product` token first, then `userAgent`, then `DEFAULT_CHROME_VERSION`. Keep `ChromeIdentity::from_version_str` intact.
   - Inside `ANTI_DETECTION_SCRIPT` (guarded by existing `EventTarget.prototype` symbol check so it installs once per realm), wrap `Function.prototype.toString` using a `WeakMap` + `maskFn(fn, name)` helper returning `"function <name>() { [native code] }"` and delegating unmasked `this` to native `toString`.
   - Apply `maskFn` to `wrappedToStr`, `Document.prototype.hasFocus`, `Permissions.prototype.query`, `navigator.mediaDevices.enumerateDevices`, `HTMLMediaElement.prototype.canPlayType`, `MediaSource.isTypeSupported`, `History.prototype.{pushState,replaceState}`, `AudioNode.prototype.{connect,disconnect}`, `AudioContext.prototype.createMediaElementSource`, and `HTMLIFrameElement.prototype` `contentWindow` getter.
2. **Cache UA params on `NativeControl` & override workers (`screencast.rs`, `manager.rs`):**
   - Update `ScreencastProducer::apply_stealth_and_focus` (`screencast.rs:1909-1928`) to use `ChromeIdentity::from_get_version`.
   - Add `cached_ua_params: tokio::sync::Mutex<Option<Value>>` on `NativeControl` (`manager.rs`) and async `NativeControl::ua_override_params(&self) -> Value` caching only successful `Browser.getVersion` lookups.
   - Replace `Browser.getVersion` call in `ObserverShared::configure_recursive_session` (`manager.rs:5796-5812`) with `control.ua_override_params().await`.
   - In `CdpTargetEvent::ChildAttached` (`manager.rs:6898-6900`), for `matches!(info.target_type.as_str(), "worker" | "shared_worker")`: fetch `control.ua_override_params().await`, send `Emulation.setUserAgentOverride` on `Some(session_id)` ignoring errors with `debug!` log, then call `release_attached(control, session_id, *waiting_for_debugger).await`.
3. **Fix OOPIF frame-tree admission race (`manager.rs`):**
   - Add bounded helper `parent_has_active_or_pending_frame_tree(state, parent_session_id, owner, token)` verifying `state.frame_sessions.contains(parent_session_id)` OR matching `(owner, token)` in `state.pending_frames` / `state.frame_tree_retries` OR walking up `state.pending_children` (max 64 hops, matching `owner`) to a pending/admitted ancestor.
   - Update `paused_admitted` (`manager.rs:6856-6857`) to use `token.is_some_and(|t| parent_has_active_or_pending_frame_tree(state, parent_session_id, owner.as_ref(), t))` when `owner` is `Some`.
   - Add unit tests in `manager.rs` for worker UA override (success + fail-open error) and paused iframe admission during in-flight parent `pending_frames` + fail-closed rejection for revoked/unowned parents, plus `from_get_version` tests in `browser_host_process.rs`.

## Todo List
```evcrate-tasks
[
  {
    "id": "fix-chrome-identity-and-worker-stealth",
    "title": "Prefer product version, cache UA params, override workers, and mask toString",
    "blocked_by": [],
    "allowed_files": [
      "server/src/browser_host/stealth.rs",
      "server/src/browser_host/screencast.rs",
      "server/src/browser_host/manager.rs",
      "server/tests/browser_host_process.rs"
    ],
    "constraints": [
      "Keep ChromeIdentity::from_version_str, Chrome/{major}.0.0.0 userAgent freeze, and Not;A=Brand v8 contract intact.",
      "Worker Emulation.setUserAgentOverride must fail open to release_attached so workers never deadlock.",
      "Do not hold synchronous locks across .await; keep ANTI_DETECTION_SCRIPT assertions in browser_host_process.rs passing."
    ],
    "acceptance": [
      "Browser.getVersion with product Chrome/156.0.8078.79 yields full_version 156.0.8078.79 and frozen Chrome/156.0.0.0 userAgent.",
      "NativeControl issues Browser.getVersion at most once across repeated configure_recursive_session and worker attaches.",
      "Paused worker/shared_worker ChildAttached sends Emulation.setUserAgentOverride before Runtime.runIfWaitingForDebugger + Target.detachFromTarget.",
      "Patched JS methods return native-style [native code] from .toString() and Function.prototype.toString.call()."
    ],
    "verification": [
      "cd server && cargo test --test browser_host_process test_automation_controlled_allowlist_and_chrome_identity",
      "cd server && cargo test browser_host::manager::"
    ]
  },
  {
    "id": "fix-oopif-frame-tree-admission-race",
    "title": "Admit paused OOPIF iframes while owned parent frame tree is in flight",
    "blocked_by": ["fix-chrome-identity-and-worker-stealth"],
    "allowed_files": [
      "server/src/browser_host/manager.rs"
    ],
    "constraints": [
      "Keep fail-closed refusal via close_refused_page when token is None, owner is missing, or parent has no active/pending/retry frame-tree path.",
      "Bound any ancestor walk through pending_children (<= 64 hops) to prevent cycles."
    ],
    "acceptance": [
      "Paused iframe ChildAttached while parent_session_id is in pending_frames or frame_tree_retries is tracked in pending_children + pending_child_resumes and resumed once frame trees complete.",
      "Paused iframe under a revoked root or missing validity token is still closed without resuming."
    ],
    "verification": [
      "cd server && cargo test browser_host::manager::"
    ]
  }
]
```

- [x] <!-- evcrate-task:fix-chrome-identity-and-worker-stealth --> Prefer product version, cache UA params, override workers, and mask toString
- [x] <!-- evcrate-task:fix-oopif-frame-tree-admission-race --> Admit paused OOPIF iframes while owned parent frame tree is in flight

## Success Criteria & Risks
- **Success:** All unit and process tests pass; `Browser.getVersion` calls drop to 1 per browser instance; workers receive full UA/Client Hints; OOPIF iframes survive parent navigation races.
- **Risk & Mitigation:** Incorrect `Function.prototype.toString` hook could break third-party error stacks -> delegate unmasked `this` directly to native `Function.prototype.toString.call(this)`.

## Security Considerations
- Request policy (`Fetch.enable`), `network_policy`, target ownership fences, and fail-closed refusal for unowned/revoked targets remain enforced.
