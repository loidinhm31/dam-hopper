# Phase 05 — Host Resources status and always-mounted consent UI

## Context links
- [Overview](plan.md), [contracts](contracts.md), [client research](reports/client-consent-research.md).
- Repository: `docs/idle-suspend-status-ui.md`, `docs/user-guide-multi-server-profiles.md`, `docs/frontend-components/host-and-usage.md`.
- Dependencies: Phase 01 DTOs, Phase 03 transport receipt and Phase 04 authoritative API/status. UI layout can develop against frozen fixtures, but fixtures do not certify application integration.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 10h.
- Implementation status: pending. Review status: not started.
- Show sleep request even with Host Resources closed and when the affected server is an inactive profile.

## Key Insights
- `HostResourcePopover` mounts detailed status only while open; this cannot be the sole automatic prompt entry point.
- Actual registry is `api/connections.ts`; actual shell is `components/templates/IdeShell.tsx`.
- Existing `use-sse.ts` bridges websocket revision events into owner-qualified queries; despite filename this is not a new SSE channel.
- Shared UI must cover web/native and desktop/compact/traditional/IDE surfaces. Do not add another terminal host or xterm lifecycle.

## Requirements
- Always-mounted profile-aware consent host outside popover-local lifecycle. Verify common shell coverage; if `IdeShell` misses a surface, use common app/workspace root rather than duplicate subscriptions.
- One request UI per exact server instance/request, deterministic queue for multiple hosts, explicit target and host-wide effect.
- Single captured-owner decision POST, retry=false, receipt/request invalidation on reconnect; stale response cannot update another profile/generation.
- Allow sleep / Do not sleep; no auto-approval via close, Escape, timeout, visibility, Cognito or component unmount.
- Display managed-only scope and explicit external-work exclusion, free counts/unknown blockers, connection count, three-hour interval, unanswered response deadline and existing wake.
- Preserve manual ForceSleepDialog and active-fleet confirmation unchanged.

## Architecture
- Add narrow `use-host-sleep-consent` hook which subscribes all connected profile generations and uses their bound API/receipt. Existing status query and revision event remain server authority.
- Add shared `HostSleepConsentHost` and dedicated `HostSleepConsentDialog` using existing Radix dialog primitives/portal. Mount once at stable shared root that survives popover and workspace surface changes.
- Server request state remains in owner-qualified TanStack Query. Local state only pending button/network error/queue focus; no persisted approval or browser-owned three-hour scheduler.
- Deduplicate duplicate aliases only through proven server instance identity (`serverEpoch` from qualified server status + exact request UUID), never hostname/profile label alone. Different host requests cannot share approval.
- Legacy server with valid old payload has no semantic consent; no fabricated prompt. New-mode old UI requires coordinated update and remains presence blocker until timeout.

## Related code files

| Action | Full path | Change |
|---|---|---|
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/client.ts` | Complete decoder and owner-bound decision method |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/ws-transport.ts` | Receipt access and consent HTTP channel mapping |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/queries.ts` | Bound status/decision hook; no automatic POST retries |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/hooks/use-sse.ts` | Exact-owner hint invalidation and reconnect catch-up |
| Create | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/hooks/use-host-sleep-consent.ts` | Connected-profile consent subscriptions/queue |
| Create | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/components/organisms/HostSleepConsentHost.tsx` | Single shared host, finite request queue |
| Create | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/components/organisms/HostSleepConsentDialog.tsx` | Explicit consent dialog and accessible actions |
| Modify after mount audit | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/components/templates/IdeShell.tsx` | Stable common root integration, if it covers all required surfaces |
| Modify if common root required | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/embed/dam-hopper-app.tsx` | Single shared mount covering web/native and non-IDE shells |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx` | Semantic eligibility/presence/consent status, no quiet=free wording |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.tsx` | Fixed three-hour quiet display + current wake edits |

No files deleted. `HostResourcePopover` and `ForceSleepDialog` intentionally unchanged unless mounting/status integration needs a small owner-prop adjustment.

## Implementation Steps
1. Use LSP references for client/status/transport exported changes. Trace shared app/shell ownership and Cognito portal/input boundary; choose exactly one mount that covers every shared surface.
2. Extend strict decoder for new policy, complete aggregate structures, finite states, nullable counts, safe timestamps/revisions and policy/field consistency. A malformed new payload is an error, not normalized eligibility.
3. Implement captured-owner `system` consent method / websocket HTTP channel mapping using existing Bearer + credentials-omit transport convention. Do not globally enable cross-origin cookies. Any cookie-only caller remains same-origin and uses server Origin guards.
4. Capture `{profileId,generation}`, request UUID/revision and current socket receipt before rendering/action. Keep receipt in transport memory; never localStorage/sessionStorage/query public payload or toast diagnostics.
5. Subscribe all connected profiles. Fetch authoritative GET on mount, connected transition, receipt acquisition and revision invalidation. Repair broadcast lag; no second client-side eligibility polling loop or new scheduler. Disconnect removes that owner's queue entry and invalidates callback without affecting another profile.
6. Render target profile/endpoint, free for >3h explanation, Idle+Blocked definition and wake timing. State “DamHopper terminals only; external work does not block sleep.” Warn one user's first accepted approval may immediately sleep the host after final safety checks; no withdrawal by another client. Blocked still means waiting, not task success.
7. Provide primary `Allow sleep` and `Do not sleep`, with explicit pending network state. One POST per deliberate action, retry=false. Successful approval displays Waiting for server/final checks, not Sleeping; observe status for handoff/outcome.
8. On 409 refetch authoritative request/outcome; never resend automatically. Already-settled request closes action controls and shows accepted decision, rather than requiring a new contrary action. Timeout/503 shows uncertainty and GET reconciles. A later No cannot undo accepted Yes.
9. Explicit X/Escape/outside dismissal sends one deny only while the request is still pending. Once settled, dismissal closes presentation without a consent POST. Failed pending deny delivery cannot fabricate success; unanswered timeout handles it. Unmount/profile switch/network loss never approves.
10. Queue multiple host requests deterministically by opening time plus owner identity. No implicit approval of queued hosts; preserve deadline display and show other pending-host indicator. If aliases cannot be proven same backend, keep separately bound requests rather than unsafe deduplication.
11. Integrate focus trap, keyboard navigation, screen-reader labels/live state, compact viewport and focus restoration. Cognito hides/isolates prompt and never answers; background tabs remain present but unanswered.
12. Extend Host Resources semantic status independently from legacy heuristic activity. Unknown/incomplete counts shown explicitly; timer only from server deadlines; display-only clock stops when unnecessary. Settings quiet duration read-only 3h in new mode; preserve existing wake setting and manual force choices.
13. Add consumer-visible unit/browser cases for stale generation, late response, decoder inconsistency, closed popover, inactive profile, two hosts, reconnect receipt and focus/deny behavior. Existing permanent tests pinning wording/source/incidental wiring must be removed, not re-pinned.
14. Run actual authenticated application with real websocket/REST path and visual proof; isolated component mocks cannot certify prompt mount/routing.

## Todo list
- [ ] Decode complete status and bind consent API.
- [ ] Mount one shared all-profile consent host.
- [ ] Capture exact request/socket/generation for every action.
- [ ] Implement finite queued dialogs and deny/error behavior.
- [ ] Add semantic Host Resources / fixed quiet settings.
- [ ] Verify privacy/accessibility/responsive surfaces.
- [ ] Capture full application evidence.

## Success Criteria
- Prompt appears with Host Resources closed, in traditional/IDE/compact surfaces, and for inactive connected profile.
- Clicking after active-profile switch still addresses original owner; stale reconnect callback sends no replacement-socket approval.
- Two distinct servers never cross-send or share request state. Duplicate aliases need proven backend identity before dedupe.
- Silent/hidden/privacy-masked clients never auto-approve; pending dismissal denies once; settled approval is not falsely presented as cancellable.
- Manual force flow retains actual active-session confirmation and wake-choice semantics.

## Risk Assessment
- Wrong mount lifecycle: use shared root discovered through runtime proof, not a desktop-only popover or duplicated shell hooks.
- Approval immediately begins final checks but is not physical-sleep proof; show accepted decision, irreversible handoff and first-answer/external-work risks accurately.
- Stale async response: fence after every await and cancel exact owner on invalidation.

## Security Considerations
- Memory-only per-socket capability, exact owner transport, no ambient client and no profileId on wire.
- Preserve Cognito input isolation and Radix React 19 ref patch. No dialog keystrokes leak to terminal/editor.

## Next steps
- Phase 06 qualifies complete app and operational rollout; do not enable production sleep merely because fixtures render.

## Unresolved questions
- Single shared root and exact server-instance alias identity must be verified from current app composition; no product decisions outstanding.
