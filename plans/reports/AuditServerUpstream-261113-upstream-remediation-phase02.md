# Audit Report: Phase 02 Stream/Input Contracts & Bounds Remediation

**Date**: 2026-11-13  
**Auditor**: Upstream Remediation Audit Sub-Agent  
**Target Plan**: `plans/261109-2251-host-browser-review-remediation/phase-02-stream-input-contracts.md`  
**Scope**: 4 tasks — `unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads`

---

## 1. Task: `unify-geometry-counters`

- **Overall Verdict**: **PARTIAL**
- **Finding Map**: SI:SI-01, SI-04, SI-08

### Constraint Checklist
- **Reuse existing target owner, no parallel geometry registry**: **DONE**  
  `server/src/browser_host/session.rs:1615-1660`, `server/src/browser_host/screencast.rs:1136-1260`. `SessionRegistry` and `ScreencastProducer` remain authoritative; no secondary registry created.
- **Migrate all counter callers without number unions or compatibility shims**: **MISSING**  
  Numeric compatibility shims and unions remain widespread:
  - `server/src/api/browser_host.rs:29-60`: `deserialize_u64_or_string` and `deserialize_opt_u64_or_string` explicitly permit numeric values (`visit_u64`, `visit_i64`) on REST endpoints (`navigate`:577, `history`:664, `reload`:778, `selection`:1224,1324,1348).
  - `packages/ui/src/api/browser-host-types.ts:143`: `SetViewportRequest.viewportEpoch: number | string`.
  - `packages/ui/src/api/browser-host-types.ts:139`: `ReloadRequest.navigationRevision: number | string`.
  - `packages/ui/src/api/browser-host-types.ts:851-853`: `InputMessage` uses numeric `profileEpoch: number`, `inputSeq: number`, `viewportEpoch: number`.
  - `packages/ui/src/browser-host/input-controller.ts:495,500,666,674`: casts via `Number(this.getViewportEpoch())` and sends JSON numbers.
  - `server/src/browser_host/input.rs:112-114`: `InputMessage` expects numeric serde deserialization (`pub profile_epoch: u64`, `pub input_seq: u64`, `pub viewport_epoch: u64`).
- **No CDP await under inverted state/geometry locks**: **PARTIAL**  
  `server/src/browser_host/screencast.rs:1140-1170` drops `geometry.read()` before CDP await, mitigating SI-04 deadlock. However, `update_geometry` does not hold `state.write()`, checking only `*self.state.read().await == ScreencastState::Streaming` (:1188), which unsafely races `start_run_locked` (:1513) while in `Starting` state.

### Acceptance Criteria Checklist
- **SI-01: initial/requested/native geometry agree or input is disabled**: **MISSING**  
  `server/src/browser_host/screencast.rs:2528-2537` publishes `metadata_geometry` in frame headers when scale >= 1000 without checking or updating `self.geometry`. Frame `input_trusted` (:2556) relies solely on `self.capture.input_trusted_for(&run_snap)` (`capture_tier.rs:410-412`), which marks unscaled frames input-trusted regardless of native coordinate divergence. Input dispatch in `server/src/browser_host/media.rs:2378` projects against `producer.geometry()`, mismatching native dimensions while input remains active.
- **SI-01: raw same-target resize fences epoch before input**: **MISSING**  
  `server/src/browser_host/cdp_gateway.rs:1040-1042` intercepts `Emulation.setDeviceMetricsOverride` and invokes `SessionRegistry.fence_geometry_and_advance_epoch`. Session lookup fails for flattened sessions because `sessionId` does not match `session.native_target_id` (:1026). Even if matched, `session.rs:1715-1748` updates only `SessionRegistry.viewport_epoch`: it never fences `ScreencastProducer.viewport_epoch` (:screencast.rs:585), never invalidates screencast frame caches, and never notifies `SessionInputManager.set_expected_viewport_epoch` (:input.rs:326).
- **SI-01: center click reaches displayed native center**: **MISSING**  
  Due to lack of reconciliation between raw/native metrics and producer geometry, coordinate mapping in `media.rs:2394,2696-2715` projects fractions against requested geometry rather than displayed native geometry.
- **SI-04: concurrent start/resize progresses**: **PARTIAL**  
  Lock inversion deadlock removed, but unsynchronized state check causes dropped screencast reconfiguration if resize coincides with `ScreencastState::Starting`.
- **SI-08: canonical string DTOs round-trip losslessly above 2^53 and at u64 limits**: **MISSING**  
  `server/src/api/browser_host.rs:843` defines `UpdateViewportRequest.viewport_epoch: u64`. REST PUT with string `"viewportEpoch": "1"` returns 422 Unprocessable Entity. `server/tests/browser_host_input.rs:315` sends numeric `1`. UI client converts epochs using JS `Number` (`input-controller.ts:495,666`), losing integer identity past 2^53.

### Remaining Gap
1. Change `UpdateViewportRequest.viewport_epoch` in `api/browser_host.rs:843` to canonical decimal string or implement strict string deserializer rejecting numbers.
2. Remove `deserialize_u64_or_string` and `deserialize_opt_u64_or_string` numeric shims across all REST handlers.
3. Migrate UI types (`SetViewportRequest`, `ReloadRequest`, `InputMessage`) and `InputController` to canonical positive decimal strings; remove `Number()` casts.
4. Reconcile native frame metadata with `producer.geometry()`; mark `input_trusted: false` whenever native geometry diverges from producer geometry.
5. In `cdp_gateway.rs`, resolve flattened session target ID and synchronously fence `producer.viewport_epoch` and `input_mgr.set_expected_viewport_epoch`.

---

## 2. Task: `enforce-paired-input-lifecycle`

- **Overall Verdict**: **MISSING**
- **Finding Map**: SI:SI-02, SI-05, SI-12

### Constraint Checklist
- **Pair owns one global permit**: **MISSING**  
  `server/src/browser_host/media.rs:1320` acquires `ViewerPermit` only in `media_ws_handler`. `control_ws_handler` (`media.rs:2122-2210`) never acquires `ViewerPermit`. Control sockets bypass global viewer capacity.
- **Unpaired control never input-ready**: **MISSING**  
  `server/src/browser_host/media.rs:2366-2400` processes and dispatches input messages without checking `slot.media_connected`. Unpaired control sockets can enqueue and dispatch native input events.
- **Cleanup uses captured original native identity and propagates failed releases**: **MISSING**  
  REST `release_control` (`api/browser_host.rs:1161-1163`) and `enqueue_input` error paths (`input.rs:470,485`) completely discard returned releases. Dispatch failure is never captured or propagated.

### Acceptance Criteria Checklist
- **SI-05: control-only sockets are bounded and timer-reaped**: **MISSING**  
  `attachments.rs:395-420` prunes `pairs` only upon subsequent `register_connection` calls. No background task or timer sweeps incomplete pairs. Supervisor (`attachments.rs:710-750`) checks only auth identity, leaving standalone control sockets alive indefinitely past 15s.
- **SI-12: stale/closed tickets fail issue/consume/upgrade**: **MISSING**  
  - Issue: `api/browser_host.rs:1527-1538` checks `get_session(...)`, which returns `Ok` for `SessionStatus::Closed` or `Closing`; does not check `status == Running` or validate incarnation/epoch.
  - Deletion: `close_native_session` (`media.rs:615-688`) calls `release_session_viewers`, which cancels active connections (`attachments.rs:600-610`) but leaves unconsumed tickets in `self.tickets` valid.
  - Upgrade: `media_ws_handler` (`media.rs:1350-1400`) upgrades sockets with `producer: None` when `ensure_producer_for_session` fails, holding viewer capacity. `control_ws_handler` (:2220-2235) succeeds against closed sessions in registry, advertising `inputAvailable: true`.
- **SI-05: lease cannot use foreign viewer**: **MISSING**  
  `input.rs:430-438` checks `msg.lease_token`, but has no `viewer_id` parameter. `media.rs:2366` forwards input messages without verifying that the control socket's authenticated `viewer_id` matches `lease.viewer_id`.
- **SI-02: every termination emits native keyup/mouseup before clearing**: **MISSING**  
  - REST release: `api/browser_host.rs:1161-1163` ignores `release_lease()` return value; no CDP release dispatched.
  - Sequence gap / overflow: `input.rs:470,485` revokes lease and discards returned releases.
  - PointerCancel: `input.rs:508-510` clears `held_buttons` in memory while `media.rs:2721` treats `PointerCancel` as a no-op, stranding native button presses on disconnect.
  - Session deletion: `api/browser_host.rs:1708` discards `mgr.revoke_lease().await`.
- **SI-02: active expiry works**: **MISSING**  
  `input.rs:283,344,435` checks `lease.expires_at <= now` passively on incoming traffic. No active timer or background sweep exists; expired held keys/buttons remain unreleased in Chromium.
- **SI-02: dispatch failure is unavailable not released**: **MISSING**  
  Because release dispatch is not invoked, dispatch failures cannot be detected; REST release returns HTTP 200 `released` unconditionally.

### Remaining Gap
1. Acquire `ViewerPermit` per pair across media and control sockets.
2. Gate `input_manager.enqueue_input` on fully established pair (`media_connected && control_connected`) and matching `viewer_id`.
3. Add active background timer to reap unpaired sockets after 15s mate deadline in `attachments.rs`.
4. Validate live running session status, incarnation, and profile epoch at ticket issue; invalidate unconsumed tickets on session DELETE; reject WebSocket upgrades when producer attachment fails.
5. Pipe `release_lease` / `revoke_lease` outputs to CDP keyup/mouseup dispatch before clearing native state across REST release, sequence gap, queue overflow, PointerCancel, and disconnect; actively expire leases with timer; report failures as unavailable.

---

## 3. Task: `recover-screencast-runs`

- **Overall Verdict**: **MISSING**
- **Finding Map**: SI:SI-06

### Constraint Checklist
- **Prompt exactly-one current-run ACK attempt per accepted event, never ambiguous replay**: **MISSING**  
  `screencast.rs:2348-2376` awaits `cdp_client.ack_screencast_frame` inline inside `handle_incoming_frame`. ACK is not decoupled from command response wait.
- **Viewer credits do not pace native ACK**: **DONE**  
  `screencast.rs:2348` enqueues ACK upon frame arrival independent of downstream client viewer credit.
- **Fresh dedicated Page session on ambiguous failure**: **MISSING**  
  `screencast.rs:2367-2376` marks `state = ScreencastState::Stopped` and cancels run token on ACK failure. Old Page session is never detached; fresh actor/session/run recovery is not implemented.

### Acceptance Criteria Checklist
- **SI-06: bounded ingress cannot silently strand ACK obligation**: **MISSING**  
  `screencast.rs:1714,1762-1776` reads from a 2-slot broadcast channel. On `broadcast::error::RecvError::Lagged(n)` (:1771), dropped frames lose their native ACK obligation with only a warning logged (`"screencast receiver lagged; proceeding without crash"`). Chromium screencast permanently halts waiting for stranded ACKs.
- **SI-06: actor/ACK failure stops old run and visibly recovers current demanded target with fresh identity**: **MISSING**  
  `screencast.rs:2367-2376` halts on ACK failure with no recovery loop. Actor failure or broadcast closure (:1774) logs a warning and exits `run_producer_tasks`. Producer remains stopped despite active viewer demand.
- **SI-06: no-demand recovery does not restart**: **MISSING**  
  Recovery mechanism does not exist.
- **SI-06: static screenshot polling remains zero**: **MISSING**  
  Recovery mechanism does not exist. Fallback screenshot (:1796-1800) executes only on initial 250ms startup delay.

### Remaining Gap
1. Decouple ACK dispatch into bounded prompt worker independent of CDP response wait.
2. Treat broadcast ingress lag and CDP actor disconnect as fatal run aborts rather than dropped events.
3. Implement recovery supervisor in `screencast.rs`: on run abort, detach old Page session, verify active viewer demand, attach fresh Page session with new `producerRun` UUID, restart screencast, and take exactly one bounded recovery screenshot.
4. Ensure zero-demand state inhibits recovery restart.

---

## 4. Task: `bound-browser-payloads`

- **Overall Verdict**: **PARTIAL**
- **Finding Map**: SI:SI-07

### Constraint Checklist
- **No per-viewer JPEG copy or server re-encode**: **DONE**  
  `server/src/browser_host/media.rs:1880-1920` fans out shared `TrackedBhjfFrame` Bytes across viewers without per-viewer copy or server re-encoding.
- **Include encoded/decode/pack overlap and raw/actor/command retention in one ceiling**: **MISSING**  
  - Overlap: `screencast.rs:2475-2565` reserves base64 estimate once, but holds base64 string, decoded JPEG, and packed BHJF frame simultaneously before adjusting down. Peak overlap is not pre-reserved.
  - Ingress: `cdp.rs:1442` allocates `ScreencastFrameData.data_base64` without memory controller reservation.
  - Candidate: `screencast.rs:2395` clones `data_base64` into `EncodedCandidate` without reservation.
  - Gateway: `cdp_gateway.rs` has zero memory accounting for raw CDP messages.
  - Commands: `command_budget.rs:14-40` maintains isolated per-client `CommandBudget` disconnected from `GLOBAL_MEMORY_CONTROLLER`.
- **No RSS-as-payload substitution**: **DONE**  
  `diagnostics.rs:228-330` tracks allocated payload bytes directly using atomic counters (`reserved_bytes`, `peak_reserved_bytes`).

### Acceptance Criteria Checklist
- **SI-07: every distinct covered live buffer is pre-reserved**: **MISSING**  
  Ingress frames (`cdp.rs:1442`), candidate clones (`screencast.rs:2395`), raw gateway relays (`cdp_gateway.rs`), and command queues (`command_budget.rs`) are allocated before/without reservation in `global_memory_controller()`.
- **SI-07: complete shared BHJF charged once through final physical owner**: **DONE**  
  `TrackedBhjfFrame` (`diagnostics.rs:125-150`) wraps `Bytes` with `Arc<FrameReservationOwner>`, charging reservation once and returning bytes when the last clone drops.
- **SI-07: reservations return on cancellation/failure**: **PARTIAL**  
  Implemented for `TrackedBhjfFrame` and `MemoryReservation` drops, but unbudgeted buffer allocations (ingress, candidate clones, gateway, commands) have no reservation to return.
- **SI-07: global high-water cannot exceed configured ceiling under cross-product load**: **MISSING**  
  Because ingress buffers, candidate clones, decode/pack overlap, raw CDP relays, and command queues bypass `GLOBAL_MEMORY_CONTROLLER`, actual retained browser payloads can exceed the configured 128 MiB ceiling under load.

### Remaining Gap
1. Pre-reserve memory in `global_memory_controller()` before reading/allocating CDP base64 frames in `cdp.rs`.
2. Avoid cloning `data_base64` into `EncodedCandidate`; share `Arc<ScreencastFrameData>` or pre-decoded bytes.
3. Reserve peak overlap memory (`base64 + decoded JPEG + packed BHJF`) during candidate publication, releasing transients only when dropped.
4. Unify `CommandBudget` and `CdpGateway` allocations into `GLOBAL_MEMORY_CONTROLLER`.

---

## Audit Summary Table

| Task ID | Overall Verdict | Sub-requirements / Criteria Met | Critical Remaining Gaps |
|---|---|---|---|
| `unify-geometry-counters` | **PARTIAL** | Target owner reused; lock inversion deadlock addressed. | Wire DTOs expect numeric values; numeric shims persist in REST; UI uses `Number()` conversions; raw CDP resize does not fence producer/input; native geometry divergence not reconciled. |
| `enforce-paired-input-lifecycle` | **MISSING** | None verified in source. | Control sockets bypass capacity and reap timer; closed session tickets admitted; unpaired control accepts input; foreign leases accessible; release events discarded on REST release, sequence gap, and overflow; active expiry absent. |
| `recover-screencast-runs` | **MISSING** | ACKs not paced by viewer credits. | Broadcast ingress lag strands ACKs without recovery; ACK/actor failure halts producer permanently; no automatic Page session recreation or demand recovery. |
| `bound-browser-payloads` | **PARTIAL** | Shared BHJF Bytes charged once; no per-viewer JPEG copies; honest atomic counters. | Ingress frames, candidate clones, peak decode/pack overlap, raw CDP gateway, and command budgets bypass `GLOBAL_MEMORY_CONTROLLER`. |

---

## Unresolved Questions
1. Does the existing Chromium deployment on production hosts expect `Emulation.setDeviceMetricsOverride` or `Page.setDeviceMetricsOverride` for OOPIF target resizes?
2. Should `UpdateViewportRequest.viewport_epoch` strictly reject numeric JSON representations with HTTP 422 or parse stringified JSON numbers via custom deserializer during cutover?
3. What is the intended timeout duration for reaping unpaired control sockets (15s mate deadline vs general ticket TTL)?
4. Should raw CDP gateway messages that exceed memory ceiling be dropped with protocol error or throttle the WebSocket connection?
