# Calibration & Qualification Report: Browser adaptive stream (Phase 05)

Date 2026-11-14. Scope: Linux host, Chromium 156.0.8078.79 only. No claim about raw link capacity, other engines, Windows, physical Android. All numbers are single runs unless stated; raw data is OUTSIDE the repo in `~/dh-qual` (`/tmp/dh-qual` symlink, ~480 MB: `out/matrix2` 150 MB, `out/matrix3` 79 MB, plus attempt/diag/smoke dirs, reports, scripts). Evidence reports quoted below live in `~/dh-qual/reports/` (named per section). Unobserved items are tagged [INFERENCE].

## 1. Environment, baseline, shaping

| Item | Value (source) |
| --- | --- |
| Host | 16 cores, 23 GiB RAM (`env-capability.md`); kernel `6.12.107+deb13-amd64` recorded 2026-11-13 there, `6.12.116+deb13-amd64` from `uname -r` today; kernel at matrix time not recorded [INFERENCE: updated across the reboot] |
| Engine | `Chromium 156.0.8078.79 built on Debian GNU/Linux 13 (trixie)`, `/usr/bin/chromium`; host browser via production launcher (sandbox on); viewers via Playwright `--no-sandbox` (viewer only) (`QualHarness.md`) |
| Node | 24.22.3 (nvm); Node 26 default not used |
| Repo | HEAD `e62086745da9dfd53c09da44c6a9edd74009e1fa`, branch `feat/ai-os-redesign`; tree DIRTY: all adaptive/qualification work is uncommitted (13 tracked files modified, 8 untracked paths at report time; `git status --short`) |
| Profile | release, lto, opt-level 3 (`cargo build --release --features vendored --example browser_host_qualification`) |
| matrix2 binaries | adaptive `141360fec88725db76d650755f6e183fb1a7c9934b0bda95b5099fb6c0291935`, static `b9d6b4e37b19e15b0bffa5636fe6212ddcce8244a6bee950668d4021a4367a47` (`calib/bin-matrix2/identity.json`; static patch sha `b003fc5d498ad81300ee266fd13367c47983dce4e072acdf66ab549e445a8f0b`). Adaptive = controller BEFORE the final calibration change, with F1 + P1 + hints |
| matrix3 binaries | adaptive `6d08625da0841bb29208b9788d8c6f338e8595a57254610c139de563f1a8f3ff` (controller sha `c62ce99e44c90ad7...`, was `35af9910df5f9d2a...`); static sanity `e9aa7d785fc0c0e104224b14e042fd627e076ebc452985ed013f89a71edbcc23` (patch sha `bac3a3b4c25ae1a95a04de8df4fc83eeb5587e025706ba0a4795e647f21f652c`) (`bin/identity.json`, `calib/identity-matrix3.json`) |
| SPA | `apps/web/dist/index.html` sha256 `0eb5814e65ff561408ae682a1a3e5def33190687f140e82ba9a406e357c94182`, shared by both policies |
| Static baseline | compile-time pinned stage 0 = **20 fps / JPEG q75 / scale 1000** under default ceilings (fps 24, q75, 1280x900): no pressure/stall inference, no per-viewer pacing change, no `send_suspended`; mute/hidden audio gating unchanged. Same media/screencast/writer sources as adaptive (worktree + `static-policy.patch`). Observed in smoke: one `streamQuality` state `high 20fps q75 scale1`, 0 policy changes |
| Matrix runs | matrix2: 64 cells (32 x adaptive/static), 64/64 `valid:true`, all `rc=0`. matrix3: 32 adaptive cells, 32/32 valid, all `rc=0`; static comparison = matrix2 (3 static sanity cells re-run in matrix3). Parallel 3, host load 0.6-6.2 (m2) / 1.0-4.1 (m3) at starts; other host processes (a dev server/Chromium) were visible at times (`CalibrateController.md` s5). Phases 15 s warmup / 15 s idle / 60 s code / 60 s motion |

Reboot incident: the FIRST matrix run (matrix1) and the original harness/binaries/diag outputs were lost when `/tmp` was wiped by a reboot. Harness scripts were recovered from session logs and rebuilt (`QualHarness-Recovery.md`); everything reported here is from the RERUN on the post-fix tree (matrix2, matrix3). No matrix1 number is used.

### Shaping topology (`QualHarness.md`, `QualHarness-Recovery.md`)
- Each cell: `unshare -Unpf --kill-child --mount-proc --map-current-user --keep-caps` (user+net+pid+mount ns, uid 1000, caps in ns only). Server + host Chromium + fixture listener in ns R, unshaped. Each viewer in its own child netns joined by a veth pair (`vsX`<->`vcX`). Host `tc qdisc` unchanged before/after (diff saved).
- Both directions shaped on veth egress: `netem delay RTT/2 limit 100000` + child `tbf rate R burst max(4500, 1.25 R B) limit L`; **L = 1.5 x BDP + 4 x 1514 B** (BDP = rate x RTT). Example 1 Mbps/300 ms: BDP 37,500 B, L 62,306 B, max queue delay 498 ms. At 0.5 Mbps/40 ms L = 9.8 KB (~157 ms full queue, ~4 RTT): flagged floor, not hidden.
- DevTools/NetworkInformation throttling NOT used: real WebSocket TCP is shaped.
- DEVIATION (needed): SPA refuses credentialed requests to non-https non-loopback origins (`isSecureOrLoopbackOrigin`, `packages/ui/src/api/auth-client.ts`), so a per-viewer TCP forwarder `127.0.0.1:18080 -> 10.0.N.1:18080` (`lib/fwd.py`) runs inside the viewer netns. Chromium<->forwarder is local/unshaped; forwarder<->server (all HTTP/WS bytes) is the shaped TCP. Consequence: the server sees the forwarder peer; browser rx-window backpressure is decoupled by the forwarder's buffering. Viewer SPA load also crosses the shaped link (74 s at 1 Mbps/300 ms, 143.6 s at 0.5 Mbps).
- Probe before every cell (20 TCP ping-pongs; bulk down/up flood, steady goodput = last 60%): tolerance goodput/rate in [0.85, 1.05], min RTT within 10% of target; else `valid:false`. Max payload goodput = 0.9564 x rate. Results (`summary.json probes`): matrix2 64/64 in tolerance, ratios 0.952-1.030, RTT rel. err <= 0.010; matrix3 32/32, ratios 0.886-1.019, RTT rel. err <= 0.005.
- Two-viewer cells: target-rate viewer A + peer B (10 Mbps; 1 Mbps peer when target is 10 Mbps), control holder alternates (`cA`/`cB`). Viewers use the same origin; both shaped separately.

### Not measurable here
- No server-side per-frame service p95 in production (only baseline min + EWMA); "ack latency p95" in this report is VIEWER-observed (rx -> ack send, includes decode/draw, ~3-8 ms, local), not link service. Server `ack_service_ewma` is the link-service proxy.
- No native wasted-encode / per-candidate metric (only `eventsReceived/Admitted/Dropped`); `everyNthFrame` decision therefore has no measured basis.
- Per-viewer controller stage is not exported: taken from `streamQuality.viewerTier/fps` (A/B mapped via `subscriptionEpoch`).
- Pressure onset is a heuristic (>=2 consecutive 0.5 s polls with oldest age >= 500 ms or pending frame); settle is null unless the policy is quiet for the last >= 10 s.
- Kernel TCP internals (`tcp_info`) not sampled; cwnd statements are [INFERENCE].
- Server build in all cells = release; synthetic fixture pages only (generated code/prose, canvas motion).

## 2. Focused real-engine receipts (Chromium 156, production `BrowserProcess`/`ScreencastProducer`)

Sources: `RealEngineReceipts.md`, `ReceiptsRerun.md`, `FixStaleFirstFrame.md`, `AudioMixedViewerReceipts.md`, `UiAdaptiveBrowserTests.md`, `FixUntrustedInput.md`, `FixAudioDocEpochRetire.md`.

**Geometry / DPR / SOF.** SOF = CSS size x scale (rounded), independent of DPR: DPR 1, 1.5, 2 each give 1280x720 / 960x540 / 640x360 at scale 1000/750/500. DPR is never multiplied in (DPR-2 page captured at CSS resolution). Page `innerWidth/innerHeight/devicePixelRatio`, header CSS dims and `viewportEpoch` (2) stayed constant across tier switches; header dims == SOF in every row. `trusted=true` only at scale 1000. Outliers: DPR 2 `to1000` once showed raw metadata 2560x1440 + `fallbacks=1` (not reproduced in 3 other observations); DPR 1.5 `to750` row `fallbacks=1` in `ReceiptsRerun.md` (both uninvestigated).

**Click oracle.** 4 layouts (native-16x9, pillarbox-4x3 dpr1.5, ultrawide-21x9, square-odd-css dpr2) x scales 1000/750/500 x 10 points = **120 clicks**: every click hit the expected DOM element; **max error 1.414 CSS px** (1 px on single axes: Chromium truncates dispatched mouse coords to integer CSS px; scale-independent; set-A letterbox points 0.000 px). Negative controls (corrupt dpr / click mapping / JPEG size / inner size) each failed `qualify_downscale` and left `qualified=false`; 4/4 layouts qualify on real data. Mutation M1 (neutralise corruption) -> oracle test fails in all 4 layouts; M2 (`late_total` assertion flipped) -> gap test fails.

**Downscaled frames stay input-untrusted in production.** `CaptureTierState::qualify_downscale` has NO production caller (only tests), so `downscale_input_qualified` stays false and Low/Constrained frames (scale < 1000) are always `inputTrusted=false`. Matrix evidence: code-phase `input_trusted_frames` 19 of 24 (1 Mbps/300 ms smoke), 0 of 41 in motion. The engine passes the oracle (above), but nothing enforces it at runtime. This is a LIMITATION and a rollout prerequisite: wire a production qualification gate or accept display-only Low/Constrained (see s8).

**Stop/start gap (serialized production tier switches, 32 per run, publish -> first frame of the new run).** All 544 switches (17 early runs) + 288 (F1 verification, 9 runs) + ReceiptsRerun runs rotated the run id, `lateOld=0`, `acksFailed=0`.

| Target tier | p50 ms | p95 ms | max ms | Source |
| --- | --- | --- | --- | --- |
| High (20 fps) | 53.3 | 54.5 | 54.8 | `RealEngineReceipts.md`, 511 rows |
| Medium (10 fps) | 102.8 | 103.7 | 105.0 | same |
| Low (6 fps) | 170.0 | 171.0 | 180.8 | same |
| Constrained (2 fps) | 503.0 | 504.1 | 504.6 | same |
| all | 103.7 | 503.5 | 504.6 | same |
| rerun on final tree (G1, G2: 6 runs) | 103.3-110.8 | 503.7-506.6 | 503.8-507.4 | `ReceiptsRerun.md` |
| after F1 fix, idle host (3 attempts, load 0.2-0.5) | ~104 | ~503-504 | - | `FixStaleFirstFrame.md` |

Gap = one governor period (50/100/167/500 ms) + ~3-4 ms [INFERENCE]. One rerun failed: G3 (`frame within deadline: Elapsed` before the first switch, load avg 10.17 from a peer build; not retried, not root-caused). Hosts were not idle in the early runs (load 1.4-4.4).

**F1 stale-first-frame (REAL FINDING, FIXED).** Before the fix, 10 of 544 switches (~1.8%/switch) published a stale first frame: class N (7): new native id but previous session pixel size, published and proved `effective_capture` wrongly; class S (3): old native id adopted as the run's id -> later `NativeSessionChanged` abort + recovery run (~1/180 switches). Fix in `screencast.rs` (`SwitchFence`/`ReplacedRun`; ingress drops frames with id <= retired id; publish drops SOF dims that fill the replaced bounds but not the run's own). After fix: strict test `real_native_restart_admits_only_target_session_frames` 6/6 attempts green + 3/3 in the later rerun; 672 real switches: staleFirst 0, aborts 0, recoveries 0. Not a proof of absence (pre-fix rate predicted ~12 in 672; class S proven only by mock). Mock tests added for classes N and S; mutations M1/M2 each fail their test. Scope: capture switch only (not resize/recovery starts; quality-only switch is distinguishable only by id).

**Audio receipts (real Chromium, 440 Hz tone, live Axum router; `AudioMixedViewerReceipts.md`, reruns in `ReceiptsRerun.md`).**
- audioRun invariance: across 9 native tier switches/run, `audioRun`, `docEpoch`, `subscriptionEpoch` constant on all 955 chunks; `audioSeq` strictly 1..955; video `producerRun` rotated 9x; worst inter-chunk gap at switches 51-85 ms vs steady 51-53 ms.
- Suppression after server ack (chunks after ack = 0 in every leg, both runs): muted ack 0-11 ms; hidden 322-327 ms; stalled 5.93-6.95 s (119 chunks ~ 6 s of audio delivered BEFORE the ack, observed); bandwidth 11.96-13.96 s.
- Fresh unmute (muted 3.5 s while source kept broadcasting): first seq > broadcast seq at request in all legs; muted skipped 0, 23-41 ms to first chunk; hidden/stalled skipped 9-10 seqs, ~530-546 ms; no backlog replay.
- Mixed viewers (2 runs): shared Low reached ~9.0 s after slow viewer's acks lag; fast viewer kept medium/high, audio on (60 chunks/3 s) while slow got 0 after its ack; delivered fps fast 8.0-9.5 vs slow 2.5-3.0; hidden slow viewer stops voting (first improvement 7.0 s); stalled 6 or 15 s (run-to-run spread, assertion <= 40 s); expiry drops voter after 15 s without heartbeat; lease holder swap does not change shared descent.
- Mutations: counting chunks from request instead of after ack -> stalled leg 119 chunks, test fails; slow chunk count from lag start -> 378, fails.
- Full `browser_host_media` at that time: 31 passed (228 s). Real-Chromium caveats: "slow link" in these tests is application-level (ack delay/hold) only.
- Observed live findings (documented as actual behavior in the API doc, tagged observed): media-only socket without a control socket is reset at the 15 s pair deadline; wire `sharedTier` lags FPS-only steps; label Constrained and `bandwidth` audio cut begin at the 750-scale 2 fps rung (stage 6); stalled viewer still gets ~6 s audio; sole hidden viewer stops audio production.

**UI browser tests (`UiAdaptiveBrowserTests.md`, `FixUntrustedInput.md`).** New files `browser-adaptive-stream.browser.tsx` (+ harness, fixtures): real controller/canvas/PcmPlayer/BrowserTools with fake sockets: 4 tiers real parsed `streamQuality`, selector sends `qualityPreference` on the media socket without a lease, late retired-run events ignored, preference survives reconnect, zero web-storage writes, audio runs (rotation keeps queue, new audioRun = one reset, mute silences synchronously). Mutations M1 (trust gate removed), M2 (retire no-op), M3 (audio reset per frame), M4 (epoch fence off) each fail tests. **F2 (found + fixed):** two `it.fails` KNOWN GAP tests showed key/text/wheel input was NOT gated by `inputTrusted` (pointer only) and wheel reused stale pointer coords. Fix: `isDisplayOnly()` in `input-controller.ts` gates pointer down/up/move/cancel, wheel, keyDown/keyUp, insertText (text/composition/paste), releasing held input once as paired keyUp/pointerCancel; mutation of each of 8 gates fails unit tests. Release is lazy (first local event while untrusted); host `onGeometryChange` not wired (fires before stale-run discard). Final rerun: browser config 5 files / 36 tests pass; unit set 23 files / 282 pass; `tsc --noEmit` exit 0 (`ReceiptsRerun.md`).

**P1 audio doc-epoch transport retirement (FOUND by `QualDiag.md`, FIXED by `FixAudioDocEpochRetire.md`).** A navigation raced an in-flight audio write; the writer raced `doc_rx.changed()` against the send and retired the whole media transport (control close 1005 + media 1006, SPA never re-attached). Reproduced on saturated 0.5 Mbps/40 ms audio-on (matrix1 adaptive, try1, storm1 first navigation; storm on static build too: not adaptive-specific). Fix: in-flight write completes (5 s deadline/cancel only), stale queued audio is dropped at hand-off, doc change never retires the transport; `TransportFailed` now warn-logged. Regression test + retargeted cancellation test; mutations (restore old writer; drop admissibility clause) fail the new test; `browser_host_media` 32 passed. Live confirmation: no media/control close and no socket error event in any raw viewer log of matrix2 (96 viewer logs) and matrix3 (48), including all 0.5 Mbps audio-on cells (grep of close/error events = 0). The residual (<= 1 chunk of old-doc audio may play if the viewer has not advanced its doc epoch) is documented in the architecture doc.

## 3. Matrix: adaptive vs static, per viewer (single runs)

Cell key `r<kbit>-rtt<ms>-<aon|aoff>-<one|two>[-c<holder>]`; viewer rate in the `v` column (peer 10 Mbps, or 1 Mbps when target is 10 Mbps). Phases: code = scrolling code page, motion = canvas motion. fps = delivered at the viewer (drawn+discarded excluded as in `summary.json delivered_fps`). Static = matrix2 static (pinned 20 fps/q75/1.0, 0 restarts). Raw: `out/matrix2`, `out/matrix3`; pre-calibration per-viewer table `out/matrix2-table.md`/`matrix2-server.md`; side-by-side `calib/cmp3-final.md`; generator `tmp/mk_tables.py`.

### 3a Delivered fps (code/motion), final adaptive stage (m3: tier/fps/jpeg/scale), capture restarts m2/m3
| cell | v (Mbps) | static c/m | adaptive m2 c/m | adaptive m3 c/m | m3 final viewer stage | restarts m2/m3 |
|---|---|---|---|---|---|---|
| r1000-rtt300-aoff-one | A (1) | 2.1/2.9 | 2.5/3.3 | 2.5/3.3 | med/10/q65/s1 | 0/0 |
| r1000-rtt300-aoff-two-cB | A (1) | 2.1/2.9 | 3.1/3.3 | 3.1/3.3 | med/10/q60/s0.75 | 8/3 |
| r1000-rtt300-aoff-two-cB | B (10) | 3.3/3.3 | 2.6/2.1 | 3.4/3.3 | low/6/q60/s0.75 | 8/3 |
| r1000-rtt300-aon-one | A (1) | 0.9/1.1 | 1.7/2.0 | 1.7/2.0 | con/2/q60/s0.75 | 8/8 |
| r1000-rtt300-aon-two-cA | A (1) | 0.9/1.1 | 1.7/2.0 | 1.7/2.0 | con/2/q60/s0.75 | 8/8 |
| r1000-rtt300-aon-two-cA | B (10) | 5.7/5.7 | 5.7/5.7 | 5.7/5.7 | med/10/q60/s0.75 | 8/8 |
| r1000-rtt40-aoff-one | A (1) | 2.2/2.9 | 4.2/3.6 | 4.1/4.9 | low/6/q60/s0.75 | 6/3 |
| r1000-rtt40-aoff-two-cA | A (1) | 2.3/2.9 | 4.0/4.9 | 4.1/4.9 | low/6/q60/s0.75 | 4/5 |
| r1000-rtt40-aoff-two-cA | B (10) | 17.2/17.2 | 14.8/18.6 | 11.9/18.8 | hig/20/q60/s0.75 | 4/5 |
| r1000-rtt40-aon-one | A (1) | 1.6/1.6 | 2.0/2.0 | 1.9/2.0 | con/2/q60/s0.75 | 8/8 |
| r1000-rtt40-aon-two-cB | A (1) | 1.6/1.8 | 1.9/2.0 | 2.0/2.0 | con/2/q60/s0.75 | 9/9 |
| r1000-rtt40-aon-two-cB | B (10) | 17.2/17.2 | 11.8/17.8 | 14.4/17.9 | hig/20/q60/s0.75 | 9/9 |
| r10000-rtt300-aoff-one | A (10) | 3.3/3.3 | 2.5/2.1 | 3.3/3.3 | low/6/q60/s0.75 | 8/3 |
| r10000-rtt300-aoff-two-cB | A (10) | 3.3/3.3 | 2.6/2.1 | 3.3/3.3 | low/6/q60/s0.75 | 8/3 |
| r10000-rtt300-aoff-two-cB | B (1) | 2.1/2.9 | 3.1/3.3 | 3.1/3.3 | med/10/q60/s0.75 | 8/3 |
| r10000-rtt300-aon-one | A (10) | 5.7/5.7 | 5.7/5.7 | 5.7/5.7 | med/10/q65/s1 | 0/0 |
| r10000-rtt300-aon-two-cA | A (10) | 5.7/5.7 | 5.7/5.7 | 5.7/5.7 | med/10/q60/s0.75 | 8/8 |
| r10000-rtt300-aon-two-cA | B (1) | 0.9/1.1 | 1.8/2.0 | 1.7/2.0 | con/2/q60/s0.75 | 8/8 |
| r10000-rtt40-aoff-one | A (10) | 17.1/17.2 | 11.4/17.1 | 11.7/17.2 | hig/20/q75/s1 | 2/2 |
| r10000-rtt40-aoff-two-cA | A (10) | 17.2/17.2 | 12.0/18.6 | 11.9/18.8 | hig/20/q60/s0.75 | 7/4 |
| r10000-rtt40-aoff-two-cA | B (1) | 2.2/2.9 | 4.1/2.5 | 4.1/4.9 | low/6/q60/s0.75 | 7/4 |
| r10000-rtt40-aon-one | A (10) | 17.2/17.2 | 14.4/17.2 | 11.3/17.2 | hig/20/q75/s1 | 2/2 |
| r10000-rtt40-aon-two-cB | A (10) | 17.2/17.1 | 11.8/17.9 | 11.7/17.8 | hig/20/q60/s0.75 | 9/9 |
| r10000-rtt40-aon-two-cB | B (1) | 1.8/2.0 | 2.0/2.0 | 2.0/2.0 | con/2/q60/s0.75 | 9/9 |
| r3000-rtt300-aoff-one | A (3) | 3.3/3.3 | 3.3/3.3 | 3.3/3.4 | low/6/q60/s0.75 | 1/3 |
| r3000-rtt300-aoff-two-cA | A (3) | 3.3/3.3 | 3.4/2.1 | 3.3/3.3 | low/6/q60/s0.75 | 11/4 |
| r3000-rtt300-aoff-two-cA | B (10) | 3.3/3.3 | 2.6/2.1 | 3.3/3.3 | low/6/q60/s0.75 | 11/4 |
| r3000-rtt300-aon-one | A (3) | 4.4/4.8 | 4.6/5.0 | 4.6/5.0 | med/10/q65/s1 | 0/0 |
| r3000-rtt300-aon-two-cB | A (3) | 4.4/4.8 | 4.6/5.0 | 4.6/5.0 | med/10/q65/s1 | 0/0 |
| r3000-rtt300-aon-two-cB | B (10) | 5.7/5.7 | 5.7/5.7 | 5.7/5.7 | med/10/q65/s1 | 0/0 |
| r3000-rtt40-aoff-one | A (3) | 6.8/8.8 | 7.8/8.1 | 7.8/9.3 | med/10/q65/s1 | 2/0 |
| r3000-rtt40-aoff-two-cB | A (3) | 6.8/8.8 | 7.7/9.3 | 7.8/9.3 | med/10/q65/s1 | 2/1 |
| r3000-rtt40-aoff-two-cB | B (10) | 17.2/17.1 | 10.6/17.2 | 10.9/17.1 | hig/20/q65/s1 | 2/1 |
| r3000-rtt40-aon-one | A (3) | 5.5/7.0 | 5.8/5.9 | 5.8/5.9 | low/6/q65/s1 | 5/5 |
| r3000-rtt40-aon-two-cA | A (3) | 5.5/7.0 | 5.8/6.3 | 5.8/6.0 | low/6/q65/s1 | 6/6 |
| r3000-rtt40-aon-two-cA | B (10) | 17.1/17.1 | 14.4/17.2 | 14.5/17.2 | hig/20/q65/s1 | 6/6 |
| r500-rtt300-aoff-one | A (0.5) | 1.1/1.4 | 1.4/2.4 | 1.3/1.9 | low/6/q60/s0.75 | 3/3 |
| r500-rtt300-aoff-two-cA | A (0.5) | 1.1/1.4 | 1.9/2.4 | 1.9/2.4 | med/10/q60/s1 | 8/4 |
| r500-rtt300-aoff-two-cA | B (10) | 3.3/3.3 | 2.6/2.1 | 3.3/3.3 | low/6/q60/s0.75 | 8/4 |
| r500-rtt300-aon-one | A (0.5) | 0.3/0.3 | 1.2/2.0 | 1.2/1.9 | con/2/q55/s0.75 | 5/5 |
| r500-rtt300-aon-two-cB | A (0.5) | 0.3/0.4 | 1.2/1.9 | 1.1/2.0 | con/2/q55/s0.75 | 5/7 |
| r500-rtt300-aon-two-cB | B (10) | 5.7/5.7 | 5.7/5.7 | 5.7/5.7 | med/10/q55/s0.75 | 5/7 |
| r500-rtt40-aoff-one | A (0.5) | 1.1/1.4 | 2.0/2.4 | 2.1/2.4 | low/6/q60/s0.75 | 3/3 |
| r500-rtt40-aoff-two-cB | A (0.5) | 1.1/1.4 | 2.1/2.4 | 2.0/2.4 | low/6/q60/s0.75 | 4/4 |
| r500-rtt40-aoff-two-cB | B (10) | 17.1/17.1 | 12.1/18.8 | 12.0/18.7 | hig/20/q60/s0.75 | 4/4 |
| r500-rtt40-aon-one | A (0.5) | 0.9/1.0 | 1.0/1.2 | 1.0/1.2 | med/10/q65/s1 | 2/0 |
| r500-rtt40-aon-two-cA | A (0.5) | 0.9/1.1 | 1.0/1.2 | 1.1/1.1 | med/10/q65/s1 | 1/1 |
| r500-rtt40-aon-two-cA | B (10) | 17.1/17.0 | 14.6/17.2 | 14.6/17.1 | hig/20/q65/s1 | 1/1 |

### 3b Wire and viewer-observed ack latency (static -> adaptive m3)
BHJF/audio = WS payload kbps at the viewer; `ack p95` = viewer-observed (decode+draw), NOT link service.
| cell | v | kB/frame code (static→m3) | BHJF kbps code | BHJF kbps motion | audio kbps motion | ack p95 ms code (viewer-observed) |
|---|---|---|---|---|---|---|
| r1000-rtt300-aoff-one | A | 52.1→46.1 | 896→916 | 947→912 | 0→0 | 6.0→5.3 |
| r1000-rtt300-aoff-two-cB | A | 51.9→26.4 | 888→740 | 953→646 | 0→0 | 5.6→5.3 |
| r1000-rtt300-aoff-two-cB | B | 52.3→26.4 | 1370→815 | 1086→647 | 0→0 | 5.4→4.8 |
| r1000-rtt300-aon-one | A | 52.5→26.3 | 392→411 | 379→386 | 576→57 | 7.1→6.3 |
| r1000-rtt300-aon-two-cA | A | 52.5→26.3 | 391→412 | 378→394 | 573→57 | 8.1→5.5 |
| r1000-rtt300-aon-two-cA | B | 52.5→26.4 | 2389→1410 | 1871→1110 | 569→570 | 5.1→5.0 |
| r1000-rtt40-aoff-one | A | 52.5→26.2 | 945→948 | 954→951 | 0→0 | 5.2→4.7 |
| r1000-rtt40-aoff-two-cA | A | 52.1→26.2 | 945→948 | 953→952 | 0→0 | 5.7→4.7 |
| r1000-rtt40-aoff-two-cA | B | 52.4→26.3 | 7206→2820 | 5596→3657 | 0→0 | 5.6→4.7 |
| r1000-rtt40-aon-one | A | 52.3→26.3 | 649→464 | 539→397 | 410→57 | 6.1→4.9 |
| r1000-rtt40-aon-two-cB | A | 52.2→26.3 | 653→492 | 581→396 | 371→48 | 8.0→5.4 |
| r1000-rtt40-aon-two-cB | B | 52.4→26.3 | 7198→3344 | 5608→3483 | 569→570 | 7.3→4.5 |
| r10000-rtt300-aoff-one | A | 52.3→26.4 | 1376→806 | 1079→647 | 0→0 | 5.3→4.7 |
| r10000-rtt300-aoff-two-cB | A | 52.5→26.3 | 1377→811 | 1083→650 | 0→0 | 5.3→4.9 |
| r10000-rtt300-aoff-two-cB | B | 51.9→26.3 | 887→740 | 950→647 | 0→0 | 5.6→4.8 |
| r10000-rtt300-aon-one | A | 52.5→45.9 | 2390→2095 | 1864→1586 | 569→569 | 5.0→5.1 |
| r10000-rtt300-aon-two-cA | A | 52.5→26.4 | 2390→1413 | 1868→1114 | 570→569 | 5.9→4.8 |
| r10000-rtt300-aon-two-cA | B | 52.6→26.2 | 393→411 | 374→389 | 575→47 | 7.3→5.6 |
| r10000-rtt40-aoff-one | A | 52.4→51.6 | 7185→4738 | 5607→5603 | 0→0 | 5.6→5.2 |
| r10000-rtt40-aoff-two-cA | A | 52.4→26.3 | 7212→2818 | 5589→3665 | 0→0 | 5.6→4.9 |
| r10000-rtt40-aoff-two-cA | B | 52.5→26.2 | 944→946 | 953→955 | 0→0 | 5.5→5.2 |
| r10000-rtt40-aon-one | A | 52.4→51.4 | 7234→4566 | 5596→5592 | 569→570 | 5.9→5.8 |
| r10000-rtt40-aon-two-cB | A | 52.4→26.3 | 7197→2774 | 5565→3472 | 569→569 | 5.9→4.7 |
| r10000-rtt40-aon-two-cB | B | 52.5→26.3 | 750→491 | 648→400 | 303→44 | 5.9→4.7 |
| r3000-rtt300-aoff-one | A | 52.5→45.8 | 1370→1207 | 1083→870 | 0→0 | 5.3→5.4 |
| r3000-rtt300-aoff-two-cA | A | 52.3→26.4 | 1369→801 | 1085→647 | 0→0 | 5.7→5.1 |
| r3000-rtt300-aoff-two-cA | B | 52.3→26.3 | 1369→806 | 1085→646 | 0→0 | 5.7→5.2 |
| r3000-rtt300-aon-one | A | 52.5→45.8 | 1861→1700 | 1569→1389 | 569→568 | 5.6→5.4 |
| r3000-rtt300-aon-two-cB | A | 52.4→45.8 | 1858→1699 | 1568→1383 | 569→570 | 5.7→5.3 |
| r3000-rtt300-aon-two-cB | B | 52.5→46.0 | 2389→2095 | 1864→1583 | 570→569 | 5.8→5.3 |
| r3000-rtt40-aoff-one | A | 52.4→46.0 | 2857→2850 | 2854→2587 | 0→0 | 5.5→5.2 |
| r3000-rtt40-aoff-two-cB | A | 52.3→46.0 | 2856→2855 | 2851→2591 | 0→0 | 5.4→5.3 |
| r3000-rtt40-aoff-two-cB | B | 52.4→46.0 | 7202→4016 | 5564→4745 | 0→0 | 5.2→5.2 |
| r3000-rtt40-aon-one | A | 52.4→46.0 | 2292→2146 | 2293→1635 | 570→570 | 5.9→5.4 |
| r3000-rtt40-aon-two-cA | A | 52.5→46.0 | 2288→2152 | 2296→1667 | 570→570 | 6.3→5.6 |
| r3000-rtt40-aon-two-cA | B | 52.4→45.9 | 7176→5324 | 5562→4762 | 569→570 | 6.3→5.4 |
| r500-rtt300-aoff-one | A | 52.3→44.0 | 454→462 | 470→457 | 0→0 | 5.8→5.4 |
| r500-rtt300-aoff-two-cA | A | 52.4→26.2 | 463→447 | 459→458 | 0→0 | 5.6→5.0 |
| r500-rtt300-aoff-two-cA | B | 52.5→26.3 | 1370→798 | 1085→647 | 0→0 | 5.5→4.9 |
| r500-rtt300-aon-one | A | 52.5→24.8 | 126→253 | 105→360 | 371→0 | 14.1→5.1 |
| r500-rtt300-aon-two-cB | A | 52.8→24.8 | 147→238 | 122→363 | 350→0 | 6.6→5.7 |
| r500-rtt300-aon-two-cB | B | 52.5→25.6 | 2391→1438 | 1866→1054 | 570→570 | 5.6→5.1 |
| r500-rtt40-aoff-one | A | 52.5→26.2 | 468→468 | 474→475 | 0→0 | 5.6→4.8 |
| r500-rtt40-aoff-two-cB | A | 52.0→26.2 | 467→470 | 478→472 | 0→0 | 5.6→4.7 |
| r500-rtt40-aoff-two-cB | B | 52.4→26.3 | 7155→2829 | 5573→3638 | 0→0 | 5.5→4.6 |
| r500-rtt40-aon-one | A | 52.5→46.2 | 391→355 | 329→329 | 144→146 | 5.7→5.6 |
| r500-rtt40-aon-two-cA | A | 52.2→45.8 | 392→384 | 351→301 | 120→176 | 6.2→5.9 |
| r500-rtt40-aon-two-cA | B | 52.4→46.0 | 7163→5350 | 5543→4750 | 570→569 | 5.8→5.5 |

### 3c Server-side delivery (static -> adaptive m3)
`svc ewma p50` = server ack-service EWMA median code/motion (static, then m3); `baseline` = min service seen; `oldest age` = max oldest outstanding frame; `queue>=1s` = longest run in seconds; `resv` = reservation high-water.
| cell | v | svc ewma p50 ms code/motion (static) | (m3) | baseline min ms s→m3 | oldest age max ms s→m3 | queue>=1s sustained s s→m3 | resv high kB s→m3 |
|---|---|---|---|---|---|---|---|
| r1000-rtt300-aoff-one | A | 914/687 | 786/604 | 606→599 | 1284→1162 | 0.5→0.5 | 419→302 |
| r1000-rtt300-aoff-two-cB | A | 914/688 | 604/603 | 605→485 | 1150→939 | 0.5→0.0 | 452→391 |
| r1000-rtt300-aoff-two-cB | B | 604/604 | 604/603 | 599→315 | 649→899 | 0.0→0.0 | 452→391 |
| r1000-rtt300-aon-one | A | 2141/1719 | 607/474 | 742→430 | 2602→1991 | 17.5→6.5 | 408→301 |
| r1000-rtt300-aon-two-cA | A | 2146/1724 | 625/474 | 711→442 | 2781→1957 | 17.5→9.0 | 453→394 |
| r1000-rtt300-aon-two-cA | B | 350/350 | 350/350 | 338→314 | 344→899 | 0.0→0.0 | 453→394 |
| r1000-rtt40-aoff-one | A | 881/687 | 442/401 | 470→264 | 950→898 | 0.0→0.0 | 348→299 |
| r1000-rtt40-aoff-two-cA | A | 876/684 | 443/401 | 483→246 | 984→939 | 0.0→0.0 | 400→314 |
| r1000-rtt40-aoff-two-cA | B | 79/69 | 56/55 | 61→50 | 79→98 | 0.0→0.0 | 400→314 |
| r1000-rtt40-aon-one | A | 1283/1204 | 349/220 | 593→186 | 1358→1250 | 1.5→0.5 | 355→301 |
| r1000-rtt40-aon-two-cB | A | 1269/1132 | 335/222 | 446→178 | 1275→1105 | 2.5→1.5 | 406→354 |
| r1000-rtt40-aon-two-cB | B | 81/71 | 67/66 | 63→51 | 85→77 | 0.0→0.0 | 406→354 |
| r10000-rtt300-aoff-one | A | 604/604 | 604/604 | 599→337 | 1099→900 | 0.5→0.0 | 415→345 |
| r10000-rtt300-aoff-two-cB | A | 605/604 | 605/604 | 338→314 | 995→898 | 0.0→0.0 | 453→392 |
| r10000-rtt300-aoff-two-cB | B | 916/687 | 605/604 | 605→599 | 1139→1059 | 0.5→0.5 | 453→392 |
| r10000-rtt300-aon-one | A | 350/350 | 348/350 | 338→333 | 348→899 | 0.0→0.0 | 344→353 |
| r10000-rtt300-aon-two-cA | A | 350/350 | 350/350 | 329→315 | 344→899 | 0.0→0.0 | 453→395 |
| r10000-rtt300-aon-two-cA | B | 2150/1721 | 639/474 | 718→431 | 2744→1921 | 44.5→7.5 | 453→395 |
| r10000-rtt40-aoff-one | A | 79/69 | 79/70 | 62→61 | 77→77 | 0.0→0.0 | 351→381 |
| r10000-rtt40-aoff-two-cA | A | 79/69 | 56/54 | 61→50 | 75→59 | 0.0→0.0 | 452→358 |
| r10000-rtt40-aoff-two-cA | B | 886/688 | 437/404 | 470→282 | 985→679 | 0.0→0.0 | 452→358 |
| r10000-rtt40-aon-one | A | 81/71 | 80/70 | 62→63 | 97→75 | 0.0→0.0 | 303→292 |
| r10000-rtt40-aon-two-cB | A | 81/71 | 67/66 | 62→51 | 80→70 | 0.0→0.0 | 407→320 |
| r10000-rtt40-aon-two-cB | B | 1119/1002 | 357/220 | 597→171 | 1198→1146 | 1.5→0.5 | 407→320 |
| r3000-rtt300-aoff-one | A | 605/604 | 604/603 | 588→387 | 604→899 | 0.0→0.0 | 346→354 |
| r3000-rtt300-aoff-two-cA | A | 604/604 | 604/603 | 587→425 | 1149→603 | 0.5→0.0 | 456→400 |
| r3000-rtt300-aoff-two-cA | B | 604/604 | 604/603 | 598→334 | 898→900 | 0.0→0.0 | 456→400 |
| r3000-rtt300-aon-one | A | 449/416 | 430/399 | 396→378 | 448→899 | 0.0→0.0 | 415→362 |
| r3000-rtt300-aon-two-cB | A | 450/416 | 430/400 | 390→378 | 445→437 | 0.0→0.0 | 513→389 |
| r3000-rtt300-aon-two-cB | B | 350/350 | 350/350 | 332→320 | 345→898 | 0.0→0.0 | 513→389 |
| r3000-rtt40-aoff-one | A | 291/227 | 253/134 | 146→112 | 303→321 | 0.0→0.0 | 413→298 |
| r3000-rtt40-aoff-two-cB | A | 292/227 | 255/136 | 147→114 | 375→325 | 0.0→0.0 | 465→348 |
| r3000-rtt40-aoff-two-cB | B | 79/69 | 74/64 | 62→58 | 77→75 | 0.0→0.0 | 465→348 |
| r3000-rtt40-aon-one | A | 364/285 | 172/139 | 182→112 | 453→311 | 0.0→0.0 | 345→299 |
| r3000-rtt40-aon-two-cA | A | 364/284 | 172/140 | 182→118 | 409→261 | 0.0→0.0 | 455→362 |
| r3000-rtt40-aon-two-cA | B | 81/71 | 75/65 | 62→59 | 80→76 | 0.0→0.0 | 455→362 |
| r500-rtt300-aoff-one | A | 1746/1380 | 1465/1117 | 898→642 | 2598→1976 | 6.5→4.0 | 411→302 |
| r500-rtt300-aoff-two-cA | A | 1760/1389 | 927/832 | 878→633 | 2341→1460 | 7.5→4.5 | 450→390 |
| r500-rtt300-aoff-two-cA | B | 604/604 | 604/603 | 599→316 | 934→900 | 0.0→0.0 | 450→390 |
| r500-rtt300-aon-one | A | 5759/6211 | 657/623 | 2451→545 | 7422→6000 | 68.5→23.5 | 355→399 |
| r500-rtt300-aon-two-cB | A | 5329/5237 | 656/623 | 2699→554 | 6736→6850 | 118.5→15.5 | 458→395 |
| r500-rtt300-aon-two-cB | B | 350/350 | 349/350 | 341→314 | 344→899 | 0.0→0.0 | 458→395 |
| r500-rtt40-aoff-one | A | 1777/1382 | 888/824 | 895→680 | 3948→3900 | 7.5→2.5 | 348→296 |
| r500-rtt40-aoff-two-cB | A | 1770/1386 | 897/825 | 846→630 | 3985→2940 | 6.5→4.5 | 403→313 |
| r500-rtt40-aoff-two-cB | B | 79/69 | 56/55 | 62→50 | 80→70 | 0.0→0.0 | 403→313 |
| r500-rtt40-aon-one | A | 2101/2067 | 1950/1718 | 1649→1454 | 3950→2899 | 28.5→63.5 | 353→308 |
| r500-rtt40-aon-two-cA | A | 2077/1835 | 1810/1856 | 1580→1527 | 2178→1915 | 22.5→32.5 | 407→362 |
| r500-rtt40-aon-two-cA | B | 81/71 | 75/65 | 62→58 | 75→70 | 0.0→0.0 | 407→362 |

### 3d Reading the matrix (absolute deltas from the tables; single runs)
Counting viewer-phase rows (96) vs matrix2 static with a +/-10% band: matrix2 adaptive 38 better / 24 worse / 34 within; matrix3 adaptive 39 better / 12 worse / 45 within (`CalibrateController.md` s5; recomputed here from `summary.json`).

- **Wins (<= 1 Mbps viewers):** r500-rtt300-aon-one A 0.3/0.3 -> 1.2/1.9 fps (queue>=1s 68.5 -> 23.5 s; oldest age 7422 -> 6000 ms); r1000-rtt300-aon-one A 0.9/1.1 -> 1.7/2.0 (17.5 -> 6.5 s queue); r1000-rtt40-aoff-one A 2.2/2.9 -> 4.1/4.9; r500-rtt40-aoff-one A 1.1/1.4 -> 2.1/2.4; r1000-rtt300-aoff-one A 2.1/2.9 -> 2.5/3.3; r500-rtt300-aoff-one A 1.1/1.4 -> 1.3/1.9. Mechanism (observed): Constrained sheds the ~570 kbps tone and smaller frames (26 kB vs 52 kB p50) reach the viewer.
- **Neutral:** 3 and 10 Mbps at 300 ms single viewer: equal fps (3.3/3.3, 5.7/5.7, 4.6/5.0 vs 4.4/4.8) with lower fidelity on audio-off cells (final low/6fps/q60/s0.75 vs static 20/q75/s1); r500-rtt40-aon-one 0.9/1.0 -> 1.0/1.2 fps (inside noise). 3 Mbps/40 ms audio-off 6.8/8.8 -> 7.8/9.3 (+1.0/+0.5, slight gain).
- **Losses (kept visible):**
  1. Shared-fidelity cost on fast viewers in two-viewer cells (design: slowest eligible viewer sets pixels): code phase B 10 Mbps 17.2 -> 11.9 (r1000-rtt40-aoff-two-cA), 17.2 -> 10.9 (r3000-rtt40-aoff-two-cB), 17.1 -> 12.0 (r500-rtt40-aoff-two-cB), 17.1 -> 14.5 (r3000-rtt40-aon-two-cA), 17.1 -> 14.6 (r500-rtt40-aon-two-cA), 17.2 -> 14.4 (r1000-rtt40-aon-two-cB). Motion phase equal or up to +1.6 fps (e.g. 17.2 -> 18.8).
  2. 10 Mbps/40 ms slow ramp (single viewer, no slow peer): code phase 17.1 -> 11.7 (aoff), 17.2 -> 11.3 (aon); motion equal (17.2/17.2). Upgrade steps at +22.9 s and +20.9 s; 16 of 29 up-steps (m3) were followed by a down-step within 30 s so faster probing is not supported by evidence (`CalibrateController.md` s1).
  3. Text shrinking on RTT-bound paths (300 ms, >= 3 Mbps, no concurrent audio): q60 + scale 0.75 engage though the link is not the bottleneck; fps now equals static (3.3/3.3) but fidelity is lower. Not separable from 1 Mbps/40 ms by any controller-visible signal; needs a transport signal (tcp_info) or a byte-sensitivity revert.
  4. 3 Mbps/40 ms audio-on motion 7.0 -> 5.9 / 6.0 fps (r3000-rtt40-aon-one, -two-cA A).
  5. r500-rtt40-aon-one (0.5 Mbps, 40 ms, audio on): no fps gain and queue>=1s INCREASED 28.5 -> 63.5 s (two-viewer cell 22.5 -> 32.5 s); final stage medium/10fps/q65 (never reached Constrained); audio ~570 kbps tone exceeds the 0.5 Mbps link.
  6. Two candidate regressions vs matrix2 adaptive, not proven caused by the calibration change: r1000-rtt40-aoff-two-cA B code 14.8 -> 11.9 (repeatable: 12.1 in attempt 1), r500-rtt300-aoff-one A 1.4/2.4 -> 1.3/1.9 (attempt 1: 1.9/2.4). Also r10000-rtt40-aon-one A code 14.4 -> 11.3 (attempt 1: 14.2).
- **Repeat variance seen:** identical short 3-cell probe set: viewer B motion 9.5 / 16.5 / 9.4 fps (`QualHarness.md`); unchanged audible cells m2 vs m3 within ~0-5% (run-to-run floor ~ +/-3 fps in ramp phases, `CalibrateController.md`). One run per cell: not point estimates.
- Static sanity re-run in matrix3 (binary `e9aa7d78`): r10000-rtt300-aoff-one 3.28/3.30 (m2 3.28/3.30), r3000-rtt300-aoff-two-cA 3.27/3.32, r1000-rtt40-aoff-one 2.27/2.92 (m2 2.25/2.92).
- Zero WS close/error events in all 144 matrix viewer logs; no `fatal`/`pageerrors` in any summary.

## 4. Candidate objectives vs measured (adaptive m3; per viewer-phase row; static has no responses by construction)

Per-phase stats use the harness onset heuristic (`response_times`, code and motion rows, viewer rows with a response / settle). Settle = last policy change minus onset with quiet last >= 10 s, else null. At 10 Mbps many "responses" are ramp UP steps, not pressure responses [INFERENCE from `CalibrateController.md` s1].

| Objective | 0.5 Mbps | 1 Mbps | 3 Mbps | 10 Mbps | Verdict |
| --- | --- | --- | --- | --- | --- |
| Pacing response <= 3 s | n=7, med 9.4 s, min 3.2, max 37.3; 7/7 > 3 s | n=17, med 5.4, min 0.8, max 32.0; 12/17 > 3 s | n=7, med 2.2, min 0.4, max 40.5; 3/7 > 3 s | n=18, med 6.2, min 1.4, max 28.5; 13/18 > 3 s | **FAIL** at all rates as defined (3 Mbps median passes). Calibration report quotes medians 1.9-4.1 s (3/10 Mbps), 3.3-3.6 (1), 8.1-9.0 (0.5) via its own onset definition |
| Fidelity settle <= 20 s | n=7 med 20.0, 4 > 20 s, 9 null | n=16 med 37.1, 11 > 20 s, 8 null | n=7 med 22.9, 4 > 20 s, 9 null | n=18 med 18.7, 8 > 20 s, 22 null | **FAIL** (medians >= 20 s except 10 Mbps; many nulls = no onset or not quiet). Phase includes page-switch retriggers |
| No capture switch < 5 s apart | min gap 5.0 s over 45 native fidelity switches (m3; 43 in m2) (`calib/evidence-m3.txt`) | | | | **PASS**. Viewer-observed restart timestamps show min 4.15 s (m3) / 4.67 s (m2): viewer poll/clock jitter [INFERENCE], server dwell constant 5 s |
| Recovery after >= 10 healthy busy s | min gap between up-steps 20.9 s (m3), 10.9 s (m2); failed probes 16/29 (m3), 29/42 (m2) | | | | **PASS** for "never earlier than 10 healthy windows"; faster recovery not beneficial per failed-probe rate; recovery latency to the pre-pressure stage not characterised |
| p95 frame service <= 2 s (0.5, 1 Mbps) / <= 1 s (3, 10 Mbps) | proxy only: svc EWMA p50 623-1950 ms, EWMA max 5880 ms (static 1380-6211, max 6674) | proxy: p50 220-786, max 2026 (static 684-2150, max 2416) | proxy: p50 134-604, max 915 (static 227-605, max 984) | proxy: p50 54-605, max 914 (static 69-605, max 912) | **NOT MEASURABLE** (no per-frame server p95). EWMA proxy exceeds 2 s at 0.5 and just at 1 Mbps; <= 1 s at 3/10 Mbps |

Infeasible / structurally limited cases (measured): 0.5 Mbps with audio on (tone ~570 kbps alone exceeds the link before video starts; relief only when the viewer reaches Constrained); 300 ms RTT with only 2 credits caps delivered fps at ~3.3 (2 credits / ~600 ms service) whatever the bytes, so downshifting cannot help there (`CalibrateController.md` s1); 0.5 Mbps/40 ms audio-on cell above never reached Constrained and shows no gain.

## 5. Final constants (`CalibrateController.md` s6; matrix2 + matrix3 evidence)
ONE controller change kept: muted/hidden viewers enter Constrained only after overdue frames (see s7). All constants UNCHANGED, `capture_tier.rs` byte-identical.

| Constant | Value | Evidence |
| --- | --- | --- |
| CAPTURE_DWELL | 5 s | 43 (m2) / 45 (m3) native fidelity switches, min gap exactly 5.0 s, 16/43 within 5.0-5.6 s (binding) |
| PRESSURE_WINDOWS | 2 | 0 policy changes in idle phase of 64 adaptive cell-runs; pacing response medians above |
| BASE/MAX_RECOVERY_WINDOWS | 10 / 60 | min up-step gap 10.9 s (m2) / 20.9 s (m3); failed probes 29/42, 16/29; MAX 60 never reached |
| WARMUP_WINDOWS | 2 | estimator warming max 2.0 s, p50 1.0 s (96 runs) |
| HEADROOM | 1.25 | no isolatable evidence; kept |
| STALL_MIN/MAX | 5 / 15 s | max gap between viewer acks 4.4 s (m2) / 6.5 s (m3); `audioReason=stalled` 0 (m2) / 1 (m3 attempt 1, load transient) |
| REPORT_EXPIRY | 15 s | heartbeat gap median 5.0 s, max 5.006 s (1615 gaps) |
| SERVICE_MARGIN_MS | 100 | uncongested static excess svc-b +12..+60 ms; failure mode is a lucky-low baseline, not the margin |
| PROBE_BACKOFF_WINDOW | 30 s | failed-probe counts |
| AUDIO_HINT_DECAY | 0.95 | not separately identifiable; kept |
| Stage table (effective under defaults) | (fps,q,scale): 20/75/1000, 10/75/1000, 10/65/1000, 6/65/1000, 6/60/1000, 6/60/750, 2/60/750, 2/55/750, 2/55/500 | measured bytes/frame code page: 10/65/1000 45.7 kB; 10/60/1000 43.3 (model -8%, measured -5%); 10/60/750 25.8 (model x0.56, measured x0.60); 10/55/750 23.2 (x0.92 / x0.90): bytes model within ~7% |
| `everyNthFrame` | **1** | no wasted-encode metric exists; no measurement justified a change |

Known weakness: service baseline never ages (one lucky-low sample lowers it for the whole run; plan risk #4).

## 6. Human legibility verdicts
Recorded 2026-11-14 as reported by the user via Main; no signed review file exists in `~/dh-qual/legibility/`. Scope: SYNTHETIC fixtures only (dark/light panels, monospace code 12/14/16 px with syntax colours, sans body 12/14/16 px, 1 px-bordered boxes/tables), captured through the production producer, rendered at 1x CSS with the viewer's canvas stretch (`sheet-*.png` built by `make-sheets.py`). No production page content.

| Item | Stages shown (q/scale) | Verdict |
| --- | --- | --- |
| High + Medium: 12 px code readable | sheet rows stage 0 (q80/1000), 2 (q65/1000) | **ACCEPTED** (2026-11-14, no notes) |
| Low: 16 px body readable | stage 4 (q60/1000), 5 (q60/750) | **ACCEPTED** |
| Constrained: 16 px body readable | stage 7 (q55/750), 8 (q55/500) | **ACCEPTED** |
| 1 px borders | all six sheet rows | **ACCEPTED** |

Gaps: the sheets used the ladder-table q80 for stage 0, but under default ceilings stage 0 is q75 (q75 not rendered); stages 1, 3, 6 (q75/1000, q65/1000, q60/750) differ from stages 0, 2, 5 by fps only. Verdict covers the stage->tier mapping of `Ladder::tier_of` (stage 0 High, 1-2 Medium, 3-5 Low, 6-8 Constrained) on these fixtures only. Real display size/page content not covered; text still shrinks on RTT-bound paths (s3d loss 3).

## 7. Fixes made during qualification

| Id | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| F1 | stale first frame after capture switch (~1.8%/switch; class S aborts run) | `screencast.rs` `SwitchFence` (id + size fence) | 2 mock tests (mutations M1/M2 fail); strict real test 6/6 + 3/3; 672 real switches clean; `screencast` 68 passed |
| F2 | key/text/wheel not gated by `inputTrusted` (pointer only) | `isDisplayOnly()` in `input-controller.ts` for ALL input | 2 `it.fails` -> `it`; +1 test +8 `it.each`; 8/8 gate mutations killed (unit) |
| P1 | doc-epoch change during audio write retired transport (saturated link + navigation) | `media_writer.rs`: let in-flight write finish; drop stale at hand-off; `media.rs` warn log | new deterministic test + retargeted cancel test; 2 mutations fail; media 32 passed; 0 closes in all matrix logs |
| Hints / fits | after an ack-starved link the controller ratcheted UP to High every 20 s (baseline polluted by self-queueing; `fits()` probe clause treated `AckStarved` as non-busy) (`QualDiag.md`) | remembered goodput/frame-size/audio-rate hints across capture restarts; unfit-upgrade fallback only for `ApplicationLimited`; audio returns only if it fits the remembered audio rate | tests `ack_starved_samples_never_unlock_the_unfit_upgrade_fallback`, `upgrade_that_lets_audio_back_in_must_fit_the_remembered_audio_rate`, `hints_survive_estimator_resets_and_only_track_audible_busy_samples`; no mutation log for the hints in the evidence files [GAP]; the QualDiag attribution was code reading, not proven by a modified build |
| Gate | muted/hidden viewers dropped to Constrained (2 fps) on RTT-bound paths: 24 viewer-phase rows > 10% below static | `try_down`: entry into Constrained for a viewer with no audio to shed needs `overdue_run >= 2` or severe; overdue = oldest age > 2 x baseline + 500 ms + decode | 5 new tests (boundary 1173/1174 ms); 12/12 mutants killed (13th removed with its code); lib `browser_host::` 126/0; media 32/0; screencast 68/0; rows >10% worse 24 -> 12. Attempt 1 (absolute 1 s) REJECTED: broke `real_audio_run_survives_video_only_tier_switches...` |

Settings > Host Browser section (enable/executable/profile/origins; restart required) was added in parallel (`SettingsHostBrowser.md`): 30 vitest pass, `tsc` exit 0, E2E on a real debug server (PUT 200, restart applied, 3 negatives HTTP 400). Not part of stream calibration.

## 8. Open items / release blockers / not executed

**Blockers / limitations**
1. Downscaled frames input-untrusted (no production `qualify_downscale` caller): decide wiring vs display-only for Low/Constrained.
2. Text shrinking (q60/s0.75) on RTT-bound paths (300 ms, >= 3 Mbps); fix needs a transport signal.
3. 10 Mbps/40 ms slow ramp (code phase 11.3-11.7 vs 17.1-17.2 fps static).
4. Two candidate unproven regressions (s3d loss 6); needs repeats.
5. SPA does not re-attach after a server-initiated media close (`QualDiag.md`); out of scope, now attributable via warn log.
6. 0.5 Mbps/40 ms audio-on: no gain, longer sustained queue.
7. No per-frame server p95, no native wasted-encode metric: objectives for p95 and `everyNthFrame` unmeasurable.
8. F1 stale-frame fence applies to capture switches only, not resize/recovery restarts (same race possible there; resize is epoch-fenced).
9. Flaky/environment-sensitive tests seen: rerun G3 timeout (load 10); `real_engine_dom_click_oracle...` failed alone 3/3 and 1 of 2 full runs during the P1 session (later 68/68; CDP "Session with given id not found", cause unconfirmed); `browser_host_compatibility` visual-viewport case documented intermittent (plan phase-05 note).
10. Live (shaped) confirmation of P1 is indirect: matrices ran after the fix and show 0 closes, but no dedicated nav-storm rerun on a release build.

**Not executed / still gating Browser release (this phase waives none):** Windows containment runner; physical Android (Gboard Vietnamese Telex/Japanese Kana); desktop Chrome/Firefox human visual ledger; continuous soak/physical latency; remediation items `wire-browser-interaction` (native dialogs, popup-as-window, 5 s lease renewal, proxy focus), reset-context keying (`reconcile-browser-ownership`), SI-03 input-release flush/saturation; other engines/versions; matrix repeats.

**Fault/race sequences (plan list) - coverage**
| Sequence | Covered by | Status |
| --- | --- | --- |
| hidden / stalled / expired voter removal + rejoin | `qual_live::real_mixed_viewers...` (hidden-stops-voting 7.0 s, visible re-vote 17.0 s, stalled 6/15 s, expiry, rejoin) + lib tests | covered (app-level slowness, no kernel shaping) |
| late old socket/frame/status | UI browser tests (retired-run, epoch fences; M2/M4 mutations) + F1 tests | covered |
| blocked media write | P1 deterministic writer test + `decoupled_media_writer_blocked_sink...` | covered at writer level |
| navigation/doc epoch vs audio | P1 test | covered |
| missing createImageBitmap / draw error | pre-existing decoder tests (Phase 02) | not re-run for this phase [GAP] |
| rapid resize + preference | `real_streaming_resize_keeps_frames_flowing_with_clean_epochs` (resize only) | resize+preference combination NOT executed |
| 240 Hz input + wheel/key | F2 display-only gating tests; no 240 Hz generator run | NOT executed |
| actor loss, privacy/reset | existing suites (logout/selection/lifecycle) from the upstream ring | not re-executed here |

## 9. Rollback / matched deployment
Static policy = the matched previous backend/UI pair. The "static" binary here is a compile-time pin for measurement only, not a runtime switch; no runtime knob was added. Phase 03 + 04 + these fixes must ship as one backend/UI pair (`audioRun` cutover; F2 is UI-only but gates input). Rollback = redeploy the previous matched backend and UI.

## Unresolved questions
1. Wire a production downscale qualification gate (F1 ids make one-shot samples safe?) or ship Low/Constrained display-only?
2. Accept a transport-level signal (`tcp_info`) for RTT-bound vs rate-bound?
3. Keep initial stage Medium (ramp cost 40+ s to High on fast links)?
4. r1000-rtt40-aoff-two-cA B (-31%) and r500-rtt300-aoff-one A: side effect or noise? Needs repeats.
5. Why the SPA does not re-attach after a server-initiated media close?
6. Should wire `sharedTier` track published target on FPS-only steps; should stalled viewers lose audio before ~6 s; is Constrained label at the 750-scale 2 fps rung intended? (`AudioMixedViewerReceipts.md`)
7. Is a signed human receipt file required for the s6 verdicts?
