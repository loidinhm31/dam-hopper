# Browser server media transport review

## Scope and assessment
- Read-only review; no code/plan changes, builds, tests, linters, or runtime experiments. Confidence below means source-level confidence, not reproduction.
- Primary: `server/src/browser_host/media.rs` transport/non-test paths; `config.rs`; capture/viewer/geometry portions of `session.rs`, `manager.rs`; `input.rs`; `server/src/api/browser_host.rs`, browser routes/middleware in `router.rs`.
- Supporting evidence: `attachments.rs`, `auth.rs`, `diagnostics.rs`, `protocol.rs`, selected `screencast.rs` and UI visibility handling. Standards: `docs/code-standards.md:28-35,161-170`; PDR browser invariants.
- No Critical finding verified. Highest priorities: geometry/epoch consistency, reliable held-input release, bounded attachment admission. Static capture policy is confirmed, not presented as a newly discovered defect.

## Performance

### Medium P1 — Socket writes block media ACK/heartbeat processing and audio delivery
- Evidence: `media.rs:1175-1200,1295-1306,1373-1380`: awaited `SinkExt::send` is inside the receive/select branch; write deadline 5s (`:53`). Audio shares that sink (`:1204-1255,1390-1397`).
- Impact: a congested JPEG write stops reading credits/heartbeats and audio for that viewer until completion/timeout; JPEG head-of-line blocking remains even with bounded frame credits. No measured latency claimed.
- Minimal fix: keep one bounded writer with explicit latest-frame/audio policy; continue reading controls independently. Include queued/write time in adaptation; do not introduce an unbounded writer channel. Confidence: high.

### Medium P2 — Viewport changes have no coalescing/rate limit and hold geometry lock across CDP
- Evidence: `api/browser_host.rs:866-903`, `session.rs:1454-1463`: even identical viewport requests renew lease, bump epoch and publish. `screencast.rs:699-740`: geometry write guard remains live through metrics command and, for changed dimensions, `Page.startScreencast`. Browser route layer only adds body limit (`api/router.rs:714,735-742`).
- Impact: an admitted lease holder can repeatedly fence every viewer and serialize producer geometry readers behind CDP round-trips; alternating sizes reissues capture commands. Shared producer means all viewers affected, unlike normal per-viewer lag.
- Minimal fix: no-op identical sanitized geometry; serialize and coalesce latest resize per session, with modest rate limit. Copy state under lock, release guard before CDP awaits, retain epoch fencing. Confidence: high.

### Low P3 — Per-viewer frame metadata repeatedly decoded without need
- Evidence: `media.rs:788-804,823-831`: each viewer unpacks BHJF JSON on receipt, then again when pending is flushed; outstanding keys allocate strings. `diagnostics.rs:148-164`: JPEG payload clones themselves are shared `Bytes`/`Arc`, not full copies.
- Impact: avoidable parse/metadata allocation on fan-out; bounded two-viewer default limits magnitude.
- Minimal fix: carry validated header/key metadata beside tracked producer bytes; reuse it in credit controller. Confidence: high.

### Backpressure and transport facts (not findings)
- Two outstanding tracked frames + one replace-latest pending per viewer (`media.rs:49-52,740-748,795-813`); a 2-slot producer broadcast ring (`screencast.rs:579`) does not await slow viewers. Native ACKs independent of viewer ACKs (`screencast.rs:1703-1707`). Ordinary slow viewer does not directly block a fast viewer.
- Write failure/5s timeout disconnects; oldest unreturned credit >30s disconnects (`media.rs:1168-1173,1373-1380`); pending replacement drops old handles rather than growing. Broadcast lag is discarded via `.ok()` (`:1185-1187`). No separate application writer queue here.
- `GLOBAL_PRODUCERS` lookup only clones `Arc` under brief async read lock; removal releases map lock before stop awaits (`media.rs:74-89`). No verified registry contention defect.
- `send` flushes each message; upgrade overrides receive sizes, not write-buffer settings (`media.rs:1079-1083,1514-1516`). No explicit TCP_NODELAY/compression/write-buffer tuning found in reviewed transport/server entry points; effective library/proxy behavior unverified, not a finding.

## Functional correctness

### High F1 — Viewport API can commit one geometry/epoch and stream another
- Evidence: registry clamps width/height/DPR and advances epoch (`session.rs:1454-1463`), but handler constructs producer geometry from raw request and ignores result (`api/browser_host.rs:888-903`). Producer rejects invalid geometry before epoch bump (`screencast.rs:695-703`); protocol rejects CSS dimensions >1920×1080 (`protocol.rs:162-170`). CDP command failures also ignored (`screencast.rs:719-740`).
- Impact: e.g. width=3000 returns HTTP 200 with clamped DTO/new epoch, but producer remains at prior geometry/epoch; input manager expects new epoch, causing visible stream/input disagreement. Small positive widths or DPR outside registry clamps can instead produce different accepted geometry. Failed native resize also reported as success.
- Minimal fix: pass `dto.geometry`, not body fields; coordinate one authoritative viewport epoch through registry/producer/input manager; surface native failure and keep input fenced until applied. Serialize concurrent resize commits so an older completion cannot overwrite newer expected epoch. Confidence: high.

### High F2 — Held inputs are cleared locally without releasing Chromium state
- Evidence: explicit release discards returned release events (`api/browser_host.rs:1049-1051`). Sequence-gap/overflow paths discard `revoke_lease()` releases (`input.rs:460-480`); caller only logs errors (`media.rs:1646-1647`). `PointerCancel` clears held buttons locally (`input.rs:496-498`) but dispatch is no-op (`media.rs:1985`).
- Impact: Shift/key/button held in Chromium can remain pressed after release/cancel/sequence fault; later teardown cannot recover keys already forgotten locally. Affects dragging and keyboard shortcuts, not just diagnostics.
- Minimal fix: one release-and-dispatch path for explicit release, cancellation, revocation and lease expiry; preserve held state until releases sent/best-effort teardown completes. Confidence: high.

### Medium F3 — Advertised/configured resource limits differ from runtime enforcement
- Evidence: configurable `max_viewers` 1..16 and effective DTO (`config.rs:168-172,634-657`) versus hardcoded global 2 (`media.rs:59,901-905`). Capture setup reads only fps/quality (`media.rs:493-510`); initial/update dimensions use viewport and hard ceilings, not configured `max_width/max_height` (`screencast.rs:728-735,1018-1027`). Configured memory ceiling validated (`config.rs:180-218`) but global admission uses fixed 128MiB (`diagnostics.rs:10,273-277`).
- Impact: max_viewers=1 still allows two media viewers; >2 never achieved. Default 1280×900 image bounds can be exceeded up to 1920×1080. Lower configured payload-memory ceilings are not the runtime admission ceiling.
- Minimal fix: derive admission and capture caps from one effective config; distinguish CSS viewport limits from encoded image bounds. Instantiate memory controller using configured payload ceiling. Confidence: high.

### Medium F4 — Heartbeat expiry silently strands an otherwise open subscription
- Evidence: producer removes demand after 15s (`screencast.rs:943-957`); later heartbeats only mutate an existing entry and never re-register/restart (`:920-925`). Media loop keeps socket alive with no independent heartbeat timeout (`media.rs:1133-1173,1330-1335`).
- Impact: >15s missed heartbeats can stop sole producer; later valid heartbeats on same socket cannot recover, and expired sockets retain viewer permits until another termination condition. If another viewer keeps producing, expired subscription can still receive frames. Normal UI hide uses pause+fresh credentials (`stream-controller.ts:815-827`), so hide itself is not claimed broken.
- Minimal fix: close expired subscriptions/pairs and require fresh attachment, or explicitly re-admit demand/restart on valid heartbeat; apply visibility/expiry consistently to frame and audio delivery. Confidence: high.

### Medium F5 — Control receive loop can be starved; CDP failures silently consume input
- Evidence: biased control select prioritizes session updates over input (`media.rs:1563-1609`); each accepted input awaits CDP dispatch inside receive branch (`:1649-1666`). Dispatch drops every command error (`:1863-1869,1912-1918,1955-1983`).
- Impact: resize/update churn or slow native commands delays subsequent input and cancellation processing; accepted sequence/held state can advance despite native rejection, with no client failure signal. No measured starvation claimed.
- Minimal fix: bound dispatch independently, preserve reliable event order; propagate native failure into lease revocation/status. Avoid permanently biased updates ahead of pending input. Confidence: high.

## Security

### Medium S1 — Arbitrary nonexistent viewport IDs allocate permanent input managers before ownership check
- Evidence: authenticated viewport handler calls `get_or_create_input_manager(&id)` before registry lookup (`api/browser_host.rs:866-883`); helper inserts without cap (`:123-127`). Missing lease then returns early. Removal is tied to real session cleanup (`:1594-1600`).
- Impact: an admitted Admin (or guarded loopback dev caller; `auth.rs:258-272,312-315`) can repeatedly use unique nonexistent IDs to grow global map indefinitely, including while lease checks fail. Not an unauthenticated exploit.
- Minimal fix: authorize/validate existing session before allocating; use lookup-only on viewport route, lifecycle-own input managers with real sessions. Confidence: high.

### Medium S2 — Control-only attachments bypass global viewer capacity and lack independent pair-wait expiry
- Evidence: viewer permit acquired only by media upgrade (`media.rs:1021-1031`), absent in control upgrade (`:1482-1530`). Active connections/pairs inserted without global cap (`attachments.rs:428-483`). Partial-pair timeout reaping only happens inside subsequent `register_connection` (`:410-425`), not auth supervisor (`:633-667,723-730`).
- Impact: valid Admin can consume fresh tickets into many control-only sockets; unconsumed-ticket caps do not bound active sockets. Last unmatched control can stay open beyond advertised 15s until another registration/auth close; each connection retains state and allows independent control traffic.
- Minimal fix: reserve bounded viewer-pair capacity on first half, share permit with second half; run timed pair expiry independent of future upgrades. Confidence: high.

### Boundaries verified (not findings)
- Ticket issuance authorizes session owner (`api/browser_host.rs:1424-1435`); media/control consume purpose-bound ticket, exact Origin validation and live admission (`media.rs:981-1019,1443-1479`), then bind per-subscription pair. Producer lookup also owner-checks registry (`:181-183,239-244`). Viewport registry checks owner (`session.rs:1434-1439`), but S1 occurs earlier.
- Receive caps: media 1KiB, input/control 16KiB (`media.rs:1081-1082,1515-1516`); REST browser bodies 64KiB (`api/router.rs:714`). Typed media kinds: frameAck/frameDiscarded/pause/heartbeat (`protocol.rs:456-479`); credit return requires exact outstanding socket/run/epoch/seq key (`media.rs:851-882`). Malformed media text disconnects; malformed control input silently ignored (`:1346-1348,1639-1670`). Binary/ping/pong ignored by application branch, not unbounded payload acceptance.
- Text message rate >100 in fixed 1s window disconnects both paired sockets (`media.rs:1272-1280,1626-1635`; `attachments.rs:489-505`). Auth cancellation races media writes; control writes additionally clip deadline (`media.rs:1373-1397,1595-1603,1740-1748`).

## Hooks for adaptive resolution/quality
- **Available local observations:** outstanding map retains frame handle/byte length and `Instant` admission timestamp (`media.rs:742,804,831`; `diagnostics.rs:152-153`); exact ACK/discard receive path (`media.rs:844-882`); outstanding count, pending occupancy and delivery/ACK/discard totals (`:746-748,778-783`). Heartbeat visibility available (`:1330-1335`). No persisted per-viewer throughput, send completion timestamps or RTT estimator currently exists.
- **Missing useful counters:** pending replacement drops are not counted (`media.rs:807-812`); broadcast lag count erased (`:1187`); ACK timestamp immediately discarded with removed entry (`:869`). Record bounded per-viewer sent bytes, write duration/completion time, ACK elapsed, replacements, lag, occupancy. ACK delay includes network + client decode/present, not pure RTT; write completion measures local socket progress, not remote delivery.
- **Estimator placement:** put small rolling/EWMA state in `ViewerCreditController` and update in `run_media_session` after writes/credit returns; use captured subscription/run identity, reset on reconnect/run. Do not trust client-reported bandwidth or use cross-host wall-clock subtraction as RTT.
- **Policy plumbing:** producer gets immutable fps/quality at creation (`media.rs:493-510`, `screencast.rs:636-641`); viewer interval separately static at upgrade (`media.rs:1068-1077`). Add one runtime capture-policy update path, bounded tiers+hysteresis, keeping CSS viewport independent of capture max pixels. Do not implement adaptive quality by repeatedly calling viewport API (F1/P2).
- **Wire hooks:** existing media client union only credits/pause/heartbeat (`protocol.rs:456-479`); server control has sessionUpdated/status/error but no stream-tier event (`:644-666`). Add typed, subscription-qualified quality/metrics control only if necessary; producer-wide effective quality can extend session DTO/event, viewer-specific tier must not be stored in shared watch snapshot. Capabilities expose configured fps/quality/bounds, not actual per-viewer tier (`config.rs:634-657`).
- **Coordinates:** normalized u/v map to CSS `(u*cssWidth, v*cssHeight+offsetTop)`; scroll/DPR not multiplied (`input.rs:171-195`, actual dispatch `media.rs:1852-1854`). BHJF already separates image width/height from CSS geometry (`protocol.rs:202-213`). Aspect-preserving image-only downscale should retain coordinate mapping; changing CSS viewport to encoded dimensions, cropping without new mapping, or publishing inconsistent epochs breaks clicks/selection. UI downscale acceptance remains UI reviewer’s scope.
- **Conflicting viewers:** one producer/encode/broadcast per target (`media.rs:63-76`, `screencast.rs:579,656-657`); cannot send distinct encoded quality to each viewer without separate encoding/scaling. Minimal initial policy: one producer tier from visible admitted viewers with explicit priority (e.g. active control holder), per-viewer delivery interval/drop policy. A slow viewer must not silently force every fast viewer to minimum quality; choose/document priority vs lowest-common-tier tradeoff. Hidden/expired viewers must not vote. Per-viewer true quality variants require bounded extra resource accounting, not just DTO fields.

## Unresolved questions
- Actual JPEG size/throughput distribution, mobile latency, audio-vs-JPEG head-of-line delay and TCP/proxy buffering require runtime measurement; none exercised here.
- Reservation formula `config.rs:140-152` assumes ~4.4MiB/viewer despite up to three distinct tracked BHJF handles plus transport buffering; exact aggregate bound needs lifetime/allocator proof, including shared broadcast/cache overlap and Tungstenite buffers. No unbounded frame queue alleged.
- Product decision: which viewer controls shared producer tier (lease holder, aggregate/fair-share, or slowest), and what visual-quality floor/latency objective applies?
