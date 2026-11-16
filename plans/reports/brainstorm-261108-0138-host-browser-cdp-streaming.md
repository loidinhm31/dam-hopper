# Host-run Browser + CDP + efficient streaming

Status: **approved design; implementation planning explicitly deferred by user. Report-only deliverable.**
Destination: `/home/loidinh/WS/dam-hopper`. Source: `/home/loidinh/WS/aicoworker`.

## Problem and final artifact

Evolve DamHopper's Browser app into an interactive view of a host-run browser that AI tools can control through CDP, showing the **same live target**, not a separate automation browser. Final artifact: this approved evidence-backed design report, written only under `/home/loidinh/WS/dam-hopper`. User explicitly deferred planning and requested report only; no separate journal, implementation plan, product edits, installations, feature prototype, migration or source transfer.

## Corrected findings

| Earlier claim | Current evidence |
| --- | --- |
| AICoworker remote access uses `Page.startScreencast` | Incorrect. `electron/remote/browser-screencast.ts:291-355` polls `captureTabScreenshot`; timer 100 ms, eligible direct frame interval 150 ms, relay 1,000 ms. These are scheduling settings, not achieved FPS. |
| Streaming is CDP screenshots only | Incorrect. `electron/browser/automation-views.ts:1194-1213` first uses Electron `webContents.capturePage()` for remote/offscreen views, then CDP screenshot, with native fallback on failure (`1216-1269`). |
| Static pages are polled at full direct cadence forever | Incorrect. Identical encoded frames suppress delivery and defer next check 1,000 ms (`browser-screencast.ts:310-315`); capture/encoding still happens on those rechecks. |
| The proxy is a transparent thin relay | Incorrect. It generates target discovery, creates Electron views, rewrites commands and handles page sockets through Electron debugger. Its header is stale. |
| Stealth makes login/bot challenges reliably disappear | Unsupported. Preload modifies browser fingerprints; no anti-bot guarantee was established. |
| Every tab has a fixed dedicated process/RAM cost, or desktop has zero latency | Unsupported. Chromium process allocation and resource usage vary; no memory/latency benchmark was performed. |
| Artifact iframes all have one uniform sandbox policy | Unsupported generalization. Separate iframe consumers have separate policies; unrelated artifact surfaces are outside this transfer. |

### AICoworker mechanics worth preserving

- Main-process `WebContentsView` lifecycle: `electron/browser/automation-views.ts:327-478`; renderer geometry via `src/pages/Chat/BrowserPanel.tsx:1474-1508`.
- CDP entrypoints: real Chromium endpoint configured at 9223 (`electron/main/index.ts:163`); proxy defaults 9333/9223 (`electron/browser/cdp-proxy.ts:2251-2254`). Page and browser connections take different internal paths.
- Remote viewer frame gating: one pending frame per viewer; ACK matching, 30-second stalled-viewer reaping and late revival (`electron/remote/browser-screencast.ts:13-47,272-355,402-451`).
- Current stream payload is JPEG quality 50 encoded as base64 in JSON; recipients selected individually (`305-341`). Native CDP screencast is used separately by `electron/browser/chrome-features/devtools-screencast.ts` for recording.
- Avoid copying the global `capturing` lock plus sequential per-session capture loop (`291-343`): slow capture can delay unrelated viewers.
- Avoid copying global-active-tab screenshot lookup: browser-session interception uses desktop active tab instead of incoming CDP target/session binding (`electron/browser/cdp-proxy.ts:1026-1044`). Static routing concern observed; exploit not exercised.
- Electron off-window presentation and debugger lease workarounds solve Electron-specific problems, not requirements for standalone headless Chromium.

### DamHopper mechanics and migration boundary

- Browser OS app currently renders a URL label and reserves an iframe slot; claim identity is `{profileId,generation,resourceId:previewUrl}` (`packages/ui/src/os/apps/BrowserApp.tsx:183-264`). This is client coordination, not server authorization.
- `OsBrowserIframe` keeps a DOM iframe alive, positions it from slot geometry, and hides it for Cognito (`packages/ui/src/os/OsResourceHost.tsx:75-230`). No host browser or streaming is provided by this path.
- Browser debug UI/bridge/extension is a separate inspection workflow. `packages/ui/src/components/organisms/BrowserDebugPanel.tsx`, `packages/ui/src/hooks/use-browser-debug.ts`, `packages/browser-bridge/src/protocol.ts`, and `apps/browser-extension/src/content.ts` provide conventions to preserve, not a CDP engine.
- Existing backend artifact API creates bounded selection artifacts, uploads PNG and hands a file reference to a specific terminal incarnation (`server/src/api/browser_debug.rs:29-120`). It does not launch or automate Chromium.
- Existing `/ws` uses bounded alert/PTY/filesystem channels, one writer and an awaited send (`server/src/api/ws.rs:312-383`). A browser-specific queue inside that same socket would NOT eliminate transport head-of-line blocking for terminals.
- Rust native releases target Linux/systemd and Windows; target hosts do not require Node or Rust toolchains (`docs/deployment-guide.md:7-19`). A bundled sidecar could technically satisfy no-system-Node, but adds another runtime to package, update and supervise.
- Historical design deliberately limited iframe preview to cooperative development pages (`plans/reports/brainstorm-260724-0114-browser-debug-embedded-selection.md:19-27,102-115`); many old listed UI paths are now retired. This request changes that execution boundary.

## Feasibility evidence and limits

Read-only runtime inspection reached the running DamHopper frontend at `http://127.0.0.1:4802/`, title `Dam Hopper`, showing `Manage Servers & Log In`. No credentials were read; authenticated Browser app behavior was not exercised. AICoworker CDP ports 9223/9333 were not listening in the inspected environment, so source application end-to-end capture was not exercised.

On an investigator-owned Chromium tab displaying that login page, raw CDP `Page.startScreencast` returned a JPEG frame and accepted `Page.screencastFrameAck`. A separate concurrent CDP session read the same page title. Engine reported `Chrome/156.0.8078.79`, protocol 1.3. Sessions, screencast and tab were closed. This proves primitive availability on this engine, **not** Playwright integration, production packaging, throughput, or multi-user security.

| Single observed frame at JPEG quality 70; requested max 1280 x 900 | Bytes / characters |
| --- | ---: |
| Decoded JPEG | 14,263 bytes |
| CDP base64 payload | 19,020 characters |

Removing base64 on the browser-facing transport avoids its roughly one-third expansion relative to raw JPEG. It does not remove base64 encoding inside CDP. This static login sample is not representative bandwidth evidence.

Authoritative CDP protocol currently permits `jpeg` and `png` for `Page.startScreencast`, not WebP/H.264/AV1. `everyNthFrame` is not an FPS limit. Screencast and ACK are experimental; newest optional parameters such as `maxFramesInFlight`/`sendLastFrame` must not be assumed on older pinned browsers. CDP does not provide an audio/video media track through JPEG screencast.

## Options under discussion

| Option | Fit | Cost / limitation |
| --- | --- | --- |
| Rust-supervised dedicated Chromium, CDP control, binary JPEG WebSocket view | Preferred candidate for developer browsing, inspection and agent automation; fits native backend | Browser distribution, CDP lifecycle, secure ownership and bounded transport are new responsibilities; JPEG is inefficient for sustained high-motion media. |
| Headful browser with maintained desktop/video streaming engine, separate CDP control | Candidate if smooth video/audio is required from the beginning | Display/capture/encoder stack, media service, operating-system differences, and WebRTC ICE/TURN if selected. Must validate integration and licenses. |
| Electron browser sidecar patterned closely on AICoworker | Behaviorally closest | Copies native-window/compositor complexity with no visible native window benefit for web clients; substantially larger runtime/update boundary. Not recommended without a specific Electron-only dependency. |

Extending iframe/extension alone does not deliver an independently running host browser. Do not reverse-proxy arbitrary sites under the DamHopper origin or strip their framing protections.

## Proposed design

1. Managed Chromium lives on the selected DamHopper **server/host**, not necessarily the device opening the SPA. One lazily started browser instance and persistent managed profile per authenticated admin principal on that host; independent targets for Browser windows intentionally share that admin's logins. Another server/principal never inherits them. Development mode uses a separate persistent profile, never the production admin profile.
2. Rust owns browser lifecycle and stable `browserSessionId`/target mappings. UI `profileId`/`generation` fences stale connection state; authenticated server principal owns authorization. URLs are navigation state, not session identity.
3. Human and agent operate on the same owned target. Give agents a scoped CDP connection; never publicize an unauthenticated browser-wide debug port. Arbitrary CDP is highly privileged; a UI controller lease alone cannot constrain an unfiltered raw CDP client.
4. Dedicated media WebSocket isolates frames from terminal/file transport. Reuse existing authentication, Origin validation and expiration policies, not the same congestible writer. Browser input/control can use a bounded control path.
5. One producer per target; binary JPEG, capture size bounded by viewport and budget, no decode/re-encode on the server. Keep at most a latest pending frame plus bounded in-flight delivery per viewer; slow viewer never blocks other viewers/targets. CDP producer ACK and viewer presentation ACK are distinct credit systems.
6. Use native CDP screencast instead of fixed screenshot polling. Rate/quality/size adaptation is explicit; painted animation can continue producing frames, so idle capture is not guaranteed free. Stop production when there are no visible viewers; agent execution can continue. Initial/recovery screenshot is a bounded exceptional action, not a second perpetual polling engine.
7. Cache viewport metadata; transform letterboxed CSS coordinates to target CSS pixels. Bind input to target, controller lease, sequence and viewport epoch. Coalesce pointer/wheel movement but preserve key/button ordering, releases, modifiers, IME text and disconnect cleanup.
8. Preserve OS window continuity, viewport/debug selection and explicit terminal-artifact handoff where applicable. Audit every active iframe/bridge caller before clean cutover; do not remove independent extension functionality blindly. Minimize/Cognito/desktop switch pause this viewer and input, not another authorized viewer or active agent.
9. Network policy must intentionally support approved project dev-server origins while protecting host management/metadata endpoints. CDP Fetch interception and DNS rules alone are not an egress isolation boundary (WebSocket/WebRTC/redirect/DNS cases). Untrusted tenants require process/account/container and network isolation, not merely browser contexts.
10. User explicitly selected a **functional first milestone**, with full media later. Current acceptance includes web tasks and same-target CDP, not audio, smooth continuous video, webcam or DRM. Do not install encoder/WebRTC/TURN infrastructure now. Full media needs a separately approved design; JPEGs over a DataChannel would not supply video compression.

## Scope / constraints / touchpoints

In scope: host execution, same-target CDP, functional interactive JPEG stream, Browser OS integration, persistent managed admin profiles, development no-auth exception and bounded efficiency. Out of scope: audio/smooth-video media delivery, hostile multi-tenant isolation, WebAuth model adapters, social daemons, stealth preload, whole-desktop remote control, copying AICoworker code, new agent tools, implementation or rollout during brainstorm.

Likely existing touchpoints: `server/src/state.rs`, `server/src/api/router.rs`, `server/src/api/ws.rs`, `server/src/api/ws_protocol.rs`, `server/src/api/browser_debug.rs`, `server/Cargo.toml`; `packages/ui/src/os/apps/BrowserApp.tsx`, `packages/ui/src/os/OsResourceHost.tsx`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/client.ts`, browser-debug hooks/components, `packages/browser-bridge/src/protocol.ts`; release installers/systemd, docs and existing Browser/UI/backend tests. New browser-host/stream modules may be justified; names/interfaces are not yet frozen.

AICoworker `LICENSE:1-61` is PolyForm Perimeter, with notice and noncompete conditions. Reuse permission depends on ownership/licensing context; not established. Recommend independently implementing standard protocol behavior, not copying source. Architecture similarity is not a legal clearance or a clean-room claim.

## Proposed acceptance / validation contract

- A non-cooperative, frame-denying target renders as a top-level host browser page in Browser app without an extension.
- Human click/type and agent CDP action demonstrably affect the same target/session; screenshots and DOM inspection cannot resolve through a global active tab.
- Navigate/reload/history/popups, viewport resize/DPR/zoom, keyboard modifiers/IME, selection preview and terminal-incarnation handoff work under the selected scope.
- Session survives OS move/minimize/restore/desktop changes and viewer reconnect without an unintended navigation or loss of in-page state; stale generations/viewport epochs cannot inject input.
- Unauthenticated and ordinary-user production requests cannot create/discover/attach/control/read Browser sessions; expired/revoked admin auth closes media/control/CDP. Explicit development bypass works only on loopback with approved web Origins; production guards remain intact. Reject forbidden schemes and configured management/metadata destinations; do not claim comprehensive network or hostile-admin isolation.
- Stream queues are bounded, no unbounded decode backlog; disconnect/Cognito/hidden-viewer handling releases subscription; one stalled tab/viewer cannot stall terminals or other browser sessions.
- Measure presented FPS, bytes/s, p50/p95 input-to-present latency, CPU/RSS, queue depth and dropped frames across static text, scrolling, animation, two viewers, resize and disconnect. Initial configurable tuning proposal: JPEG quality 65, maximum image 1280 x 900 and active delivery cap 10 FPS; not achieved measurements or smooth-media guarantees. No periodic screenshot requests on settled static pages; stop screencast with zero viewers. Bound each viewer to two outstanding frames plus one replaceable latest pending frame, and bound decode concurrency.
- Validate minimum/pinned Chromium protocol, Linux sandbox/service prerequisites and Windows descendant cleanup with an admin-provisioned engine; missing/unsupported browser is an actionable error, never silent download or iframe fallback.

## Discovery decisions — supplied by user

1. “first MVP to check function and full media later”: functional browser/CDP/stream first; audio and smooth-video delivery are explicitly outside this milestone.
2. “only admin logged in account” plus development no-auth: production is admin-only; explicit development mode supplies a Browser-specific exception.
3. Persistent managed profiles: live reconnect preserves page state; host restart preserves cookies/storage, not unsaved DOM/JavaScript state. Explicit logout/reset removes saved credentials.

Linux and Windows host compatibility follows existing release scope. Primary client is the web SPA, including remote Android browser use; no native Android/CDP host changes. Initial qualification: one admin browser instance, two targets and two viewers. Broader concurrency remains unqualified rather than promised.

## Interfaces, authorization and lifecycle

- Reuse REST/control conventions (`camelCase`, `{kind: ...}`), server actor authentication and client profile/generation fences. Server issues `browserSessionId`, target binding, browser incarnation and viewport epoch. Do not key a session by URL or authorize from client `profileId`.
- Logical API: create/list/close sessions and targets; navigate/history/reload/resize; attach/detach viewer; request/release cooperative human-or-agent control; mint short-lived attachment tickets. Route families: `/api/browser/sessions`, target control children, dedicated media WebSocket and authenticated CDP gateway. Exact spelling is a planning detail.
- Production requires a fully authenticated `AuthenticatedActor` with `role == Admin`. The existing development actor is **User**, not Admin (`server/src/api/auth.rs:96-105`). Implement a Browser-specific `state.no_auth` exception, never global admin elevation, a magic header, a UI switch or a production bypass.
- Existing no-auth startup environment/store checks remain (`server/src/state.rs:285-304`). Browser dev admission additionally requires loopback listener/peer and allowed Origin for web clients. Origin-less dev agent clients are loopback-only. Public tunnels/forwarded-host claims cannot enable this exception. Expose capability/unavailable reasons so UI and API agree.
- Native Chromium creates targets directly; no Electron `Target.createTarget` shim. Agent and viewer operate on the same target. Gateway authenticates admin or short-lived session capability and restricts discovery/attachment to that admin's managed instance. Tokens/raw endpoints stay out of logs and terminal history.
- Use an OS-assigned **loopback** Chromium debug port with a dedicated profile, not fixed/public 9223/9333. Only the authenticated gateway is remotely reachable. Same-account host agents are trusted and may access that local endpoint: this is **not** local-user isolation. Pipe-only CDP needs separate Linux/Windows transport qualification; not a prerequisite for this selected threat model.
- Prefer a maintained Rust Chromium/CDP client to a general-purpose handwritten CDP stack. `chromiumoxide` 0.9.1 documents launch/profile/headless/events/commands; pin and qualify it before adoption. Axum/Tokio/base64 exist; `tokio-tungstenite` is currently dev-only (`server/Cargo.toml:185-186`), so runtime use requires explicit production dependency. No system Node requirement.
- Configure an admin-provisioned compatible Chrome/Chromium executable; report missing/unsupported engine clearly. No silent runtime download or attachment to ordinary Chrome. Managed browser installation/update is not included. Qualify Linux service-user libraries/fonts/sandbox and Windows process-tree cleanup; never blanket-disable sandbox/web security.
- OS move/minimize/desktop change preserves target identity. Hiding/locking/Cognito pauses this viewer and releases its held input, not another viewer or agent. Closing the Browser target closes it. Reconnect resumes a live page; restart restores storage and selected URLs with an explicit reloaded state, not an unsaved-state guarantee.
- Profile lock prevents simultaneous browser processes sharing a user-data directory. Profile reset is a destructive confirmed action, closing targets before deletion.

## Efficient stream contract

- One native CDP screencast producer per watched target. JPEG/PNG are the protocol formats; no WebP or encoded-video assumption. Reconfigure only for meaningful viewport/budget changes.
- Decode CDP base64 once; send compressed binary JPEG to clients, sharing immutable bytes for same-target fan-out. No host JPEG decode/re-encode, base64 JSON wire payload or React state update per frame.
- Dedicated media socket/writer keeps large images out of terminal/file TCP queues. Reuse auth/Origin/expiration logic, not the congestible queue. Frames identify protocol version, session/target/incarnation, frame sequence, dimensions and viewport epoch; validate bounds before allocation/drawing.
- Producer ACK and viewer presentation ACK are distinct credits. Admit a frame into a bounded latest-frame mailbox; release producer credit according to target rate/budget. Replace stale pending work. A slow viewer cannot withhold every viewer's producer credit. Viewer ACK follows decode/draw, not packet receipt; stop production with no active viewers.
- `createImageBitmap` plus canvas, bounded decode jobs and bitmap disposal. Input projection uses the actual letterboxed image and cached target CSS geometry; no layout-metrics CDP request per pointer event. Coalesce movement/wheel, preserve button/key order/releases, modifiers and IME text; clear held state on lease loss/disconnect.
- Qualify against equivalent screenshot polling on the same hardware/workload. Record idle capture requests, scrolling CPU/bytes, displayed frame age under delayed ACK, and terminal responsiveness while media is constrained. No absolute WAN latency, per-tab RAM or hardware-decoding guarantee.

## Boundaries, risk and decision framework

One feature, three coupled boundaries: **host/session lifecycle → authenticated CDP/control → stream/UI**. Host identity/control contract precedes viewer attachment; UI and producer work can then use that contract independently. This dependency outline is not an implementation plan.

Persistent profiles contain credentials: restricted filesystem permissions, explicit reset and deliberate backup policy. Admin-issued raw CDP is privileged; cooperative input leases cannot constrain an unfiltered trusted CDP client. Cookie contexts are not OS isolation.

Web content remains untrusted. Preserve Chromium sandbox/web security, keep workbench credentials out of managed browser profiles, reject dangerous schemes and configured management/metadata destinations across navigation/redirects/subresources. URL/CDP interception is **not** comprehensive egress containment. Strong private-network guarantees or hostile tenants need enforced proxy/network/OS isolation and a different design.

No-auth plus arbitrary Internet browsing on the same host is particularly risky. Restrict no-auth Browser mode to explicitly approved development origins and required asset origins; use authenticated mode for general-purpose browsing. No request parameter or forwarded header can opt into the development bypass.

Pixels do not provide DOM semantics, accessibility, native file dialogs, clipboard or find-in-page automatically. Existing debug selection/terminal handoff needs CDP integration with current bounded artifact and terminal-incarnation contracts. Define upload/download, popup and dialog policy explicitly; no arbitrary filesystem paths, silent permission grants or sensitive auto-accepts.

Choose Rust/Chromium + JPEG for the functional scope. Reopen media design only when audio/smooth-video is requested or measured bandwidth/latency fails an agreed budget. Do not prebuild a transport framework: stable session/control identity is enough to allow a separately designed media path later.

No deadline/resource ceiling supplied. Pinned-client compatibility, authenticated end-to-end behavior, release packaging, full client matrix and numeric efficiency remain qualification obligations, not completed validation.

## Decision gates

Design-specific approval: **approved explicitly by user** for this report's functional browser/CDP/JPEG-stream scope, admin-only access, development exception and persistent profiles. Separate planning decision: **explicitly deferred by user**. Planner/router: **not invoked; no implementation plan created**. Decision journal: **not created, per the latest report-only request**. Implementation: **not authorized**. Next step: revisit planning only on a new explicit request.

## Workflow / evidence gaps

All three scoped read-only scouts completed: source engine/stream, destination UI, destination Rust/deployment. Their recommendations were independently checked against source/specs; unsupported WebP screencast, exact per-tab RAM, mandatory sidecar size estimates, all-viewer ACK coupling, and isolation-by-client-profile claims were rejected.

`take` is not an installed shell function. The published `/evcrate:take` command specification exists at `/home/loidinh/.omp/agent/evcrate/commands/evc-cmd-take.md`; its explicit **compare** mode stops at findings, while omitted mode defaults to port and can proceed toward planning/implementation gates. No port/improve/copy/code command was invoked. This brainstorm retains design-approval and separate planning-consent gates.

Docs-seeker's helper returned no Context7 entry for this topic; primary documentation was used instead. No project tests/builds ran; no implementation changed. Existing user changes in terminal-project display and its active plan were left untouched.

## Primary references

- CDP Page: https://chromedevtools.github.io/devtools-protocol/tot/Page/ ; raw protocol: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json
- Headless Chrome: https://developer.chrome.com/docs/automation-and-testing/headless
- CDP compatibility caveats: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- Chrome dedicated debug-profile requirement: https://developer.chrome.com/blog/remote-debugging-port
- WebSocket lacks automatic backpressure: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- WebRTC codecs: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs
- TURN deployment: https://webrtc.org/getting-started/turn-server
- Existing media-stack alternative (not qualified here): https://github.com/selkies-project/selkies

## Unresolved questions

None blocking this approved design report. Performance budgets, pinned-engine compatibility and release/client qualification remain future validation obligations; no implementation or production-readiness claim is made.
