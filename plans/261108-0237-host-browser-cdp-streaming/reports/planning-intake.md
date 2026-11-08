# Planning intake

Status: planning only; no implementation authorized.

## Canonical destination
`/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/plan.md`.
No selected/active plan supplied. New directory follows injected naming. Source report is not a selected implementation plan and remains unchanged.

## Requested outcome
Research the stream architecture beyond the approved [brainstorm](../../reports/brainstorm-261108-0138-host-browser-cdp-streaming.md), then author comprehensive ordered phases with exact writable ownership, durable tasks and observable acceptance for later implementation.

## Settled requirements
- Rust-supervised host Chromium, human and agent CDP share the exact target; standalone remote web SPA, including Android browser clients.
- Admin-only production; Browser-specific guarded loopback no-auth development exception; no global role elevation.
- One persistent managed profile per server principal; separate development profile. Reconnect retains live state; restart preserves storage/selected URLs only. Explicit logout/reset clears saved browser credentials.
- Dedicated binary JPEG WebSocket; no large frames on existing terminal/filesystem `/ws`.
- One producer per watched target, separate producer and viewer credit, bounded latest-only work, two outstanding frames plus one pending per viewer, bounded decoder concurrency.
- Stop production at zero active viewers; visibility/privacy pause is viewer-local, not target destruction or agent cancellation.
- Preserve navigation, history, popups, resize/zoom/input/IME, debug selection and incarnation-safe terminal artifact handoff.
- Linux and Windows host scope; admin-provisioned compatible Chromium; no silent download, ordinary-profile attachment or iframe fallback.

## Non-goals
Audio/smooth-video/WebRTC/TURN/encoders, native Android Browser implementation, hostile tenant isolation, Electron/Node sidecar, new agent tools, copied AICoworker source, stealth/anti-bot guarantees, release/install/product edits during this invocation.

## Evidence and gates
- Planning skill loaded from `/home/loidinh/.omp/agent/skills/planning/SKILL.md`; project-local skill/workflow resources absent, published HOME workflows loaded.
- Hard planning route selected: coupled auth/lifecycle/CDP/transport/UI and platform compatibility require deeper analysis, not alternative product approaches.
- Existing system architecture and browser-debug architecture read. Preferred `docs/architecture.md` and root `ARCHITECTURE.md` absent; use current `docs/system-architecture.md` and `docs/architecture/agent-store-ports-and-browser.md` as baseline. Intended architecture belongs in this selected plan; do not falsely update maintained live architecture to claim unimplemented behavior. Future implementation includes documentation reconciliation.
- Three bounded investigators: backend scout, viewer scout, one external protocol researcher (five external calls maximum, <=150-line report). Parent docs-seeker detector ran; fetch returned `Documentation not found on context7.com`, so primary-source research remains the fallback; this is not product evidence.
- Independent plan-only reviewer required by auth, credential deletion, async stream/input and cross-platform lifecycle risks. One initial review plus at most one targeted follow-up.
- Final interview policy: prompt, 3–8 genuine questions if accepted; no re-opening approved scope just to fill quota. Coordinator owns final validation; no take caller retains it.
- No task execution state hydration, product builds/tests, dependency installation or Git publication.

## Related-plan disposition
- `plans/261022-0322-device-login-management/plan.md`: in-progress; source implementation exists, human visual gate pending. Writable auth/client/docs overlap; serialize writers and preserve session revocation and sibling behavior. No whole-plan dependency.
- `plans/260929-1522-host-resources-sse/plan.md`: declared completed with release/runtime qualification still pending; state/router/auth-client patterns overlap. Reuse relevant source, not old pass claims. Browser does not close those gates.
- `plans/260812-1747-session-bound-media-stream-authorization/plan.md`: informational baseline; its purpose-bound file/media cookies are not Browser socket authorization. Do not extend existing filesystem tickets into raw-CDP authority.
- `plans/261101-1738-ai-dev-os-redesign/plan.md` and `plans/261105-0711-os-desktop-polish/plan.md`: Browser resource continuity and shared OS files overlap; preserve PTY/Monaco/root-input invariants, serialize actual writers. Administrative closure is not proof of current live acceptance.
- `plans/261107-0247-os-enhancements/plan.md`: PIN privacy/lock boundary baseline; serialize shared root input/config/docs writes, retain PBKDF2 implementation rather than stale summary text.
- `plans/261108-0122-agent-hub-file-changes-refresh/plan.md`: informational; unrelated sidebar scope untouched; its open test/manual carryovers are not inherited success or blockers for Browser design.

## Unresolved questions
No new product interview yet. Protocol/client, exact lifecycle hooks and cutover inventory are investigation inputs; runtime/platform/performance proof belongs to later implementation qualification, not this planning result.
