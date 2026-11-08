# Independent plan review checklist

Canonical overview: `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/plan.md`.
This rubric is preparation, not a review result. Reviewer must inspect the actual final overview, every linked phase and supporting contracts/ownership/acceptance; report evidence, failure scenario, impact/severity, confidence and smallest correction. Plan-only read-only; write assigned <=150-line report only, no product checks or hydration. A severe finding blocks readiness regardless of review-call allowance.

## Destructive logout and revocation
- Wipe authorized only by a fully evaluated live Admin session, correct CSRF/Origin/native-bearer admission, explicit confirmation and expected profile epoch. Decoded-only/expired/revoked claims never authorize wipe.
- Session/ticket revocation must NOT depend on successful wipe or new destructive preconditions. Preserve existing idempotent logout for expired/ordinary/native/old clients. If wipe cannot be authorized/completed, report credentials retained/reset required; do not silently claim reset. Check ordering and resetRequired tombstone/relaunch fences.
- All active paths migrated: `packages/ui/src/api/auth-client.ts`, `ServerProfilesDialog.tsx`, `ServerSettingsDialog.tsx` plus callers discovered before execution. Check native Android remains compatible without implementing native Browser.
- Local profile deletion/credential removal is not a remote logout or profile wipe. UI must state retained server credentials where applicable.
- Shared-principal wipe closes sibling targets and invalidates managed artifacts; production cannot wipe separate no-auth profile. Confirm descendant exit before deletion; keep failed-reset state honest and retry/reconciliation idempotent.
- Broad account-logout-wipe interpretation remains an UNCONFIRMED assumption: interrupted question received no answer; resume is not approval. Must surface before ready-to-code claim.

## Trust and privileged gateway
- Loopback debug port is approved report's transport choice, NOT local-user isolation: any local process/account reaching port can control admin browser. Confirm report wording (lines113–116); expose limitation prominently, disable capability for unsafe shared-host deployments. Do not present other-user isolation as established.
- Raw CDP covers entire owned principal instance including native filesystem/network privilege; no `Target.*` filter sandbox. Principal-owned process isolates remote owner selection only. Cooperative control lease and request interception cannot confine trusted raw CDP.
- Browser media/control one-use tickets purpose/actor/session/incarnation/Origin-bound; gateway baseline header Authorization. No account bearer in query URLs. Any request carrying Origin must match exact approved Origin, including discovery and WS. Origin-less remote gateway allowed only authenticated header clients; no arbitrary capability browser-CSRF hole.
- Phase01 future real Playwright proof passes headers to BOTH discovery and WS; fail closed on unsupported interoperability.
- Current Admin role revalidated, not only captured auth version. Expiry/revocation/demotion/store failure cancels stalled media/control/CDP independently of queued close alert; targeted revoke preserves sibling sessions/profile.
- No-auth checks actual bound listener and peer loopback, approved web Origin, dev-only allowed target/assets; no forwarded-header/public-tunnel authority or global admin elevation.

## Stream and input correctness
- Prompt exact-once producer ACK independent of viewers. CDP sessionId is run identity; no underflow/duplicate credit. Do not assume universal two-frame native window from experimental/version-dependent protocol.
- Viewer max2 outstanding+1pending, exact sequence/subscription/epoch credit matching, explicit discard disposition, no forged/future/duplicate ACK credit. One decode+one latest pending, bitmap disposal and stale completion fences.
- Native producer stops at zero visible demand; idle heartbeat handles missed pause; no perpetual screenshot fallback. Bounded initial/resize recovery preserves trusted geometry, no input from display-only frame.
- Frames separate from terminal/filesystem TCP queue and input/control path; all writer/event/JSON/base64/decode/command maps byte-count bounded, no task per frame, no library unbounded event queue hidden underneath mailbox.
- Only controller determines viewport; other viewers letterbox. Input sequence/lease/incarnation/geometry epoch; coalescing barriers preserve key/button release, IME commit once, clear held state on privacy/blur/disconnect and queue overflow. Actual Android-web input covered, native client not falsely claimed.
- Root target/canvas lifetime survives OS placement transitions; component unmount is not target close. Explicit target close warns about other viewers as applicable. Persistence/recipes cannot serialize capabilities or accidentally duplicate/rebind pages by URL.
- Metrics distinguish capture/encode/delivery/presented FPS.10FPS viewer cap is not producer cap; ACK delay does not prove no capture CPU. Name tuning knobs/bounds and conditions requiring design revisit rather than fake performance guarantees.

## Artifact/extension and process safety
- All artifacts actor-bound; immutable server-set ManagedBrowser/Cooperative classification. ManagedBrowser access needs current Browser admission/Admin even for same subject after demotion; ordinary cooperative extension retains owner-only functionality.
- `server/src/browser_debug/` store/API/tests have serialized writer ownership, all internal signature callers migrated; terminal incarnation/revision/owner fences and atomic PTY handoff retained. Independent extension/bridge and HtmlPreview preserved.
- Windows assign kill-on-close Job Object BEFORE Chromium can spawn descendants; qualify nested sandbox Jobs without disabling browser sandbox. Unix process group plus parent-death/orphan recovery contract, not root-only kill_on_drop.
- Profile lock and persistent reset tombstone; active SingletonLock not removed by guessed PID/time, no arbitrary process adoption. Confirm all relevant descendants gone before deleting directory; failure blocks relaunch, preserves evidence.

## Coverage, phases and evidence
- Approved brainstorm acceptance maps fully to task/phase/scenario; popups/navigation/history/dialogs/resize/zoom/IME/selection/handoff/admin/noauth/Windows/Android-web all covered without scope shrink.
- Engine/schema/static-first/final-frame/resize/zoom/multi-session/process/CPU/WAN/proxy measurements are FUTURE implementation qualification obligations, never observed passes. Unsupported target blocks applicable release, cannot be waived by unit tests or source reads.
- Qualification commands name current runners and planned fixtures honestly; no source-text assertions, mock-only integration proof, fabricated visual acceptance, repeated same-path trivial tests or benchmark hardware claims.
- One canonical overview under80 lines, frontmatter, valid linked phases; exactly one `evcrate-tasks` JSON fence per linked phase and matching unique stable task markers; exact seven fields, literal normalized paths, nonempty behavior acceptance/verification.
- Global dependency DAG acyclic; shared files serialized transitively, independent stream/viewer tasks truly disjoint, integration owner explicit. `allowed_files` exists or is explicitly new; full maps include action/reason.
- No tasks.json, hydration, native task engine, product implementation/build/test/install/Git publication during planning. Read-only installed `source.load` is sufficient structural parser; manual semantics/link/ownership checks still required.

## Coordinator preparation checks and draft caveats
- Verified existing `server/tests/auth_device_sessions.rs` via glob. `packages/ui/package.json:9` invokes `vitest run --config vitest.browser.config.ts`; config lines411–426 include `browser-tests/**/*.browser.{ts,tsx}`. Planned `.browser.tsx` files match. No product tests executed.
- Draft Phase08 preview is NOT final verification. Recheck per-file Purpose reasons rather than repeated task-title boilerplate; generic task constraints are sufficient only if authoritative architecture supplies the concrete invariant.
- Check non-destructive logout remains available: explicit "Log out, keep browser data" vs confirmed shared-profile wipe. A Cancel button alone must not trap users into retaining account authentication. This remains tied to the unconfirmed product interpretation, not permission to weaken authenticated reset.
- Confirm late-relayed corrections in each relevant phase JSON, not only prose: Phase01 Playwright discovery+WS headers; Phase03/04 gateway Origin; Phase05/09 bounded tuning/revisit; Phase08 and integrated qualification revoke-first200+retained/resetRequired and ManagedBrowser/currentAdmin vs Cooperative.

## Unresolved questions
Before ready handoff: explicitly settle or retain pending the account-logout-wipe assumption; prominently acknowledge loopback local-account exposure. Runtime/platform qualification remains future execution work, not a planning pass receipt.

