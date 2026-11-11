# Planner Report — Browser Video and Audio Streaming

## Deliverable
Canonical plan: `/home/loidinh/WS/dam-hopper/plans/261111-0220-browser-video-audio-streaming/plan.md`.

| Phase | Task ID | Dependency | Estimate |
| --- | --- | --- | --- |
| Backend video/audio | `backend-browser-video-audio-streaming` | None in task DAG | 12h |
| UI PCM/audio controls | `ui-browser-pcm-player-and-controls` | Backend task | 8h |

Created overview, two linked phases and this report only. No product edits, dependency changes, tests/builds/live probes, task hydration, execution-state mutation or Git operations. Estimates are planning estimates, not measured execution time.

## Evidence used
- User-confirmed preflight is design authority: in-page Symbol PCM bridge, 24 FPS/75 JPEG defaults with legacy 100 ms constructors, selective codec/device/permission port, exact autoplay launch flag, immediate privacy/lock/reset/hidden/mute flush and <200-line new player.
- Current `server/src/browser_host/screencast.rs`: `new` stores `DEFAULT_GOVERNOR_INTERVAL` 100 ms; native screencast and screenshot fallback hardcode quality 65; `clone_handle` carries producer state; `run_producer_tasks` owns demand/run cancellation and video event drain. Existing apply-stealth functions already inject at document start/current document.
- Current `server/src/browser_host/media.rs`: `build_producer` constructs default producer; both viewer delivery paths hardcode `MIN_DELIVERY_INTERVAL` 100 ms; session pending flush is 50 ms; writes already race bounded deadline/auth cancellation. Reuse these owners, not another transport.
- Current `protocol.rs`: `EffectiveBounds` defaults 10/65; media client controls and server control events are separate from BHJF. New audio is a distinct server-to-media text DTO, not a control-event union member.
- Current UI controller: media strings ignored; sockets/credentials are captured and retired on privacy/visibility/dispose. Root keep-alive host combines Cognito, LockScreen and reset fencing into `isSuppressed` and derives `isEffectiveVisible`; BrowserApp registers the visible slot. These are authoritative playback gates.
- Donor `/home/loidinh/WS/aicoworker/electron/browser/anti-detection-preload.cjs:419-531`: permission defaults, device labels/IDs stripping and H.264/AAC codec reporting. WebM/VP8/VP9/Opus/MSE additions are requested extensions, not source-verified donor features.
- Donor `/home/loidinh/WS/aicoworker/src/audio/pcm-player.ts`: signed PCM conversion, 24 kHz format, running start-time schedule, resume epoch, source cleanup. Its WebRTC/AEC and delayed fade-out do not fit this feature and must not be copied.
- `README.md`, `docs/code-standards.md`, relevant browser architecture sections and installed planning/development workflow references consulted. UI scripts confirm Vitest and TypeScript build commands.

## Design synthesis
- Production capture policy and per-viewer cadence must both be wired; config-only tuning leaves existing 10 FPS bottlenecks intact. Both screenshot and screencast use configured JPEG quality.
- No new stealth-setup commands or `Runtime.enable`. Audio polling belongs to active run lifetime with one independent cancellable single-flight worker, so slow CDP evaluation cannot block video ACK processing.
- Audio format: 24 kHz mono PCM16LE, <=100 ms chunks, <=500 ms page/broadcast/player backlog; <=8 KiB outgoing JSON. Authority comes from backend/attachment, never page-provided fields. Existing incoming control cap unchanged.
- Bounded source mixing, dynamic element cleanup, native WebAudio graph semantics and embedded-media contribution must be qualified in a real engine; top-page serializer success cannot establish tab-audio correctness. Protected/tainted media remains subject to browser security; no permission/security bypass.
- PcmPlayer/root host owns runtime playback; BrowserApp owns ephemeral per-viewer mute intent and actual gesture unlock. Immediate gain zero/source stop/epoch invalidation deliberately replaces donor's audible fade tail.
- No audio ACK protocol, new service, browser-engine replacement, persistence migration, dependency or general-purpose jitter/A/V-sync subsystem.

## Authoring contract disposition
- Overview includes required pending YAML frontmatter, linked sibling phases and exact managed progress block initialized 0/2.
- Each phase carries exactly one `evcrate-tasks` JSON array, one stable task ID and a matching unchecked task marker/title; no status/owner/steps fields inside JSON.
- Task allowlists match assigned nine backend and nine UI paths. Literal project-relative paths; no globs; two create actions are UI player/test only. Phase prose includes absolute file paths/actions and task-ID-specific ordered changes.
- Dependency graph is backend → UI, with no cycles or concurrent writable overlap. Ownership, required outcomes and future verification are explicit; no tasks.json created.
- Artifact structure is inspected after authoring; this is authoring compliance, not semantic implementation validation or a passing product check.

## Coordinator-owned gates and boundaries
- Handoff status: authored, pending coordinator review/validation, not ready-to-code approval. Delegated author does not repeat selected route's research staffing, independent challenge, interview or final handoff gates.
- Architecture/code-standards docs still describe 10 FPS/65 quality and old allowlist. Plan-only write scope prevents publishing architecture changes here. Coordinator must resolve Gate 1 disposition before implementation and arrange a separately scoped docs owner for final architecture/configuration/changelog/roadmap reconciliation.
- Related `plans/261111-0024-browser-cloudflare-google-login/plan.md` overlaps stealth/process/OS; current code contains its relevant integration. Its completion labels are not execution approval or qualification evidence.
- `plans/261109-2251-host-browser-review-remediation/plan.md` has unfinished overlapping stream/OS/qualification work. Coordinator serializes shared writers and records actual dependency disposition; no other plan edited/imported or broad historical platform qualification claimed.
- Active-plan session persistence and task hydration remain coordinator-owned; this author uses the explicit selected path throughout and claims no activation receipt.
- Required future evidence: focused Rust and UI regressions, Rust compile/UI typecheck, unchanged setup/native-credit behavior, real Chromium media/WebAudio/embedded-frame capture and output-browser autoplay/mute/privacy/reset/visibility/reconnect journey. Phase contracts specify commands and observables; none were executed here.
- User escalation requirement remains applicable during implementation: repeated failures, regressions or state deadlocks require the main agent's advisor consultation using the user's architectural-mentor question. Do not suppress failing gates or broaden scope to make checks pass.

## Unresolved questions
None requiring a new product choice. Pending coordinator architecture/review/validation/overlap gates and real-engine qualification are not claimed complete. Material ordinary-media, WebAudio or embedded-frame capture gaps must be reported with exact evidence, not silently excluded from acceptance.
