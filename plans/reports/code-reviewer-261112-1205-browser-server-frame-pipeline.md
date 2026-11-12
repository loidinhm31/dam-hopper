# Browser server frame pipeline review

## Scope
- Read-only review: `screencast.rs` production portion (tests begin :2093), screencast ingress/ACK/broadcast in `cdp.rs`, BHJF packing/header validation in `protocol.rs`, reservation/frame ownership in `diagnostics.rs`.
- Supporting evidence: `docs/code-standards.md`, PDR, host-browser architecture; targeted producer-supervision callsite search. No code edits, builds, tests, linters, formatters, or git mutations.
- Findings below verified by source inspection; runtime frequency/CPU cost not measured. No Critical finding in this slice.

## Performance

### P1 — Medium: governor limits publication, not native capture/encoding
- Evidence: `server/src/browser_host/screencast.rs:728-735,1017-1028` always requests `every_nth_frame(1)`; :1703-1707 ACKs before candidate replacement; :1742-1752 overwrites frames; :1786-1819 decodes only the governed winner.
- Impact: animated pages can encode/base64/transport/parse frames discarded before publication; lowering FPS changes only the Rust governor. Actual excess work depends on native production rate, not benchmarked here.
- Minimal fix: apply capture-tier quality/resolution upstream and a bounded native frame-sampling policy; retain ACK independence from slow viewers. Do not use viewer ACK withholding as congestion control.

### P2 — Medium: full base64 copy for every admitted event, including overwritten frames
- Evidence: `server/src/browser_host/cdp.rs:969,1400-1422` parses owned JSON and moves its payload into `Arc<ScreencastFrameData>`; `server/src/browser_host/screencast.rs:1733-1739` then clones the entire base64 `String` into each candidate.
- Impact: up to ~2.8 MB allocation/copy per native event, even when no JPEG is decoded or delivered.
- Minimal fix: retain the frame `Arc` in `EncodedCandidate`, or move an already-shared payload handle; preserve current single replaceable mailbox. JSON field extraction itself already moves, not clones, the CDP payload.

### P3 — Medium: fallback and ACK response waits block the video drain
- Evidence: `server/src/browser_host/screencast.rs:1158-1183` executes ACK handling/publication/fallback in one select-loop branch; :1703-1707 awaits ACK; :1919-1947 performs three sequential CDP RPCs, ignoring both metrics results. `server/src/browser_host/cdp.rs:757-766` waits for ACK response, not merely enqueue; `protocol.rs:16` gives each RPC a 10 s timeout.
- Impact: fallback can occupy the drain for up to three RPC deadlines; incoming frames wait/overflow, heartbeat expiry and cancellation selection are delayed. Governor ticker (:1110) uses default catch-up behavior, unlike audio's explicit `Skip` (:1200-1202).
- Minimal fix: keep one cancellable fallback worker outside the video drain; separate bounded ACK write admission from response accounting without retrying ambiguous writes; set governor missed-tick behavior to `Skip`. Remove unused metrics RPCs unless their results actually establish snapshot consistency.

### Hot-path checks that are already sound
- No task-per-frame in CDP ingress or candidate handling (`cdp.rs:1384-1427`; `screencast.rs:1645-1757`); task spawning is lifecycle-scoped.
- JPEG is decoded from base64 only for the governed candidate, not into pixels. Packing creates one contiguous allocation plus one JPEG copy (`protocol.rs:329-369`); `BytesMut::freeze` and tracked/broadcast clones do not copy JPEG bytes (`diagnostics.rs:157-164`). Small header serialization/UUID revalidation allocations exist, but optimize the large candidate copy first.
- Static pages do not trigger periodic screenshots: fallback is once per epoch (:1908-1911); governor wakes still occur at configured FPS. No evidence here warrants replacing native idle behavior with screenshot polling.

## Functional correctness

### F1 — High: geometry/state lock inversion can deadlock resize against start
- Evidence: `server/src/browser_host/screencast.rs:699-742` retains geometry write guard while awaiting CDP and then state read (:727). `start_screencast_run` holds state write (:971-1040) while awaiting geometry read (:1018; also :776 during setup).
- Failure: with an existing Page session, start owns state and waits for geometry; concurrent resize owns geometry and waits for state. Neither future can release its guard; streaming/control geometry stalls indefinitely.
- Minimal fix: commit/copy geometry in a short scope, drop its guard before all I/O/state acquisition; serialize start/stop/reconfigure under one lifecycle transition owner with a consistent lock order.

### F2 — High: resize reissues active start, ignores errors, and does not rotate capture identity
- Evidence: `server/src/browser_host/screencast.rs:699-740` advances epoch, silently discards emulation/start errors, then returns success. It sends `Page.startScreencast` without stop, fresh `producerRun`, or native-ID reset; :1685-1696 rejects a changed native ID without ACK.
- Impact: advertised geometry can diverge from actual capture settings. Current [Chromium PageHandler source](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc#L1630-L1673) rejects active start with `Screencast is already active`; successful starts increment native session ID. Deployed Chromium version still needs confirmation.
- Minimal fix: one stop → apply viewport/tier → fresh-run start transition; relearn native identity, clear incompatible candidate/cache, propagate command failure instead of reporting applied geometry. Reuse one parameter builder for :730-736 and :1022-1028.

### F3 — High: queued zero-demand stop can stop a newly demanded stream
- Evidence: `server/src/browser_host/screencast.rs:928-939,943-957` snapshots zero viewers and spawns a stop. :1090-1099 checks only state, never current demand. :905-915 starts only when registration observes `Stopped`.
- Failure: final old viewer leaves; replacement registers while stream remains `Streaming`; old stop then executes despite positive demand. Replacement heartbeats (:920-925) cannot restart the stopped stream.
- Minimal fix: reconcile current demand and state within the same serialized lifecycle transition; recheck demand immediately before stop and ensure a concurrent positive-demand update schedules the resulting start.

### F4 — High: frame authority is checked too early; old pixels can receive a new epoch
- Evidence: `server/src/browser_host/screencast.rs:1664-1707` checks run, then awaits ACK; :1739 assigns the epoch only afterwards. :1796-1799 checks candidate epoch, but :1854 may await geometry and :1858 reloads epoch for the header. Cache writes/broadcast (:1885-1894) have no final current-run/epoch check. Fallback (:1917-2017) checks epoch once but never rechecks current run/cancellation before publishing.
- Failure: resize during ACK labels a pre-resize frame with the new epoch; resize after the initial governor check can relabel again. Stop/restart during fallback can publish an old-run frame into current cache. Native publication marks input trusted (:1871), so stale pixels can authorize misplaced interactions.
- Minimal fix: capture immutable run/viewport/capture-generation authority before awaits; never relabel a candidate. Commit cache/header/broadcast only under a short shared authority fence that rejects superseded work. Bracket resize with a fresh native run, not just an epoch increment.

### F5 — High: dropped native events strand frame credits instead of ACKing or aborting
- Evidence: `server/src/browser_host/screencast.rs:1673-1682,1685-1696` returns on oversized payload/native-ID mismatch before ACK; :1167-1168 logs broadcast lag and continues. `server/src/browser_host/cdp.rs:485,1417-1427` broadcasts through only two slots, without actor-owned ACK/drop recovery.
- Impact: oversized current-run frames can consume all native credits and freeze capture; overwritten broadcast entries cannot subsequently be ACKed. Current upstream Chromium defaults to three in-flight frames (linked source above), exceeding ring capacity; exact deployed behavior/version unverified.
- Minimal fix: ACK safely routable, explicitly dropped frames exactly once; if identity or ingress continuity is ambiguous, abort/recreate the run/session rather than silently continuing. Keep native credit release ahead of any lossy mailbox, or make loss trigger fenced recovery.

### F6 — High: actor death does not close the producer's broadcast subscription
- Evidence: `server/src/browser_host/cdp.rs:435,497,515` retains broadcast senders in both actor and client. :598-604 exposes command-channel closure, but `screencast.rs:1149-1185` never selects it; it expects broadcast `Closed` (:1170). The producer itself retains the client, so actor exit alone cannot close that broadcast.
- Impact: an existing viewer can remain on a frozen stream with state `Streaming`; continuing heartbeats prevent expiry-based teardown. Audio's `is_closed` check (:1235-1238) does not reconcile video state. Fresh attachment can repair the producer, but active streaming has no local recovery signal.
- Minimal fix: select `cdp_client.closed()` in producer execution; atomically retire run/state/caches as appropriate, cancel workers, and notify transport to obtain a fresh producer/Page session.

### F7 — Medium: capture timestamp is admission time after ACK, not capture time
- Evidence: `server/src/browser_host/screencast.rs:1703-1707,1736,1759-1778` waits for ACK then stamps `Utc::now`, ignoring native metadata timestamp.
- Impact: delayed frames look freshly captured; future latency-based adaptation would underestimate capture-to-publication delay.
- Minimal fix: validate and preserve native capture timestamp; retain a separate local receive instant for elapsed-time measurements.

## Security

### S1 — High: payload admission does not cover retained ingress/candidates or packing peak
- Evidence: `server/src/browser_host/cdp.rs:969,1417-1427` allocates/retains base64 event data with no `MemoryReservation`; candidate cloning (:1735) is also unreserved. `screencast.rs:1802-1819` reserves only base64 length + 1040, then `protocol.rs:351-367` allocates another complete JPEG packet while decoded JPEG and base64 remain alive; :1876 shrinks reservation before those temporaries disappear. Fallback repeats this (:1956-2001).
- Impact: the 128 MiB tracked ceiling is not a hard live-payload ceiling; ingress continues allocating even when admission is exhausted. Content-driven large frames can amplify heap/CPU pressure across admitted targets. OOM or cross-principal impact was not runtime-demonstrated.
- Minimal fix: reserve retained ingress/candidate payloads before retention; transfer/share reservations with payload ownership; reserve simultaneous decode + packed output before allocation, releasing temporary portions only when their buffers drop. Keep per-message byte bounds as separate defenses.
- Positive: packed `TrackedBhjfFrame` clones correctly share one RAII reservation until last tracked owner drops (`diagnostics.rs:106-170`); the uncovered lifetime is before/alongside that packed buffer, not its tracked clone implementation.

## Hooks for adaptive resolution/quality
- **Shared mutable policy:** replace copied scalar `governor_interval`/`jpeg_quality` (`screencast.rs:559-560,636-640,2045-2046`) with one shared validated capture-tier snapshot/version. Updating only the original producer cannot affect existing `clone_handle` copies.
- **Upstream dimensions/quality:** one builder used by :728-736 and :1017-1028 should apply tier scale to CSS capture ceilings, preserving aspect ratio and existing absolute bounds. Keep `Emulation.setDeviceMetricsOverride` CSS viewport/DPR unchanged: network adaptation must not reflow the page or change input coordinates.
- **Live cadence:** :1110 creates its interval once. A policy-change notification must reset/recreate that interval (with `Skip`) and coordinate any delivery-side ceiling separately. New policy must affect screenshot quality too (:1926-1929).
- **Pixels versus CSS:** this reviewed wire path already separates actual JPEG `width`/`height` (:1833-1868) from `geometry.css_width/css_height`; `TargetFrameHeader::validate` (:244-258) does NOT require equality. `pack_bhjf_frame` (:320-326) requires equality only between header image dimensions and JPEG SOF. Do not weaken those checks to add scaling.
- **Existing coupling to remove:** native maximum dimensions currently derive directly from unscaled CSS size (:728-729,:1019-1020). Fallback has quality but no clip/scale bounds (:1926-1929), so it must use the same tier-aware capture limits or remain an explicitly bounded display-only fallback. Metadata reconstruction hardcodes DPR=1 and visual offsets=0 (:1768-1777); do not reinterpret CSS geometry as scaled JPEG dimensions.
- **Safe mid-run switch prerequisite:** resolve F1–F5 first. Serialize reconfiguration; stop old native capture; cancel/fence old async work; clear candidate; apply latest tier; mint/relearn run/native identity; publish only matching-generation frames. Rotate `producerRun` for capture-only changes rather than pretending CSS viewport changed. Decide whether retained old cache is display-only until the first new-tier native frame.
- **Signal placement:** `cdp.rs:380-387`, `screencast.rs:74-86`, and `diagnostics.rs:288-302` expose aggregate capture/drop/byte counts, not per-viewer throughput/RTT. Feed network feedback from transport into this single target-level policy; specify multi-viewer aggregation outside this slice. No network-speed adaptation exists here today.

## Unresolved questions
- Which deployed Chromium version is supported? Confirm active-start rejection and native in-flight limit against that version; current-upstream evidence is not a deployed-version qualification.
- Which target-level tier should win when viewers have different bandwidth? Per-viewer feedback/aggregation belongs to transport ownership, not this producer audit.
- No runtime profiling/failure injection performed by contract; frequency of races, actual native capture rate, and peak heap excess remain unmeasured.
