# Phase 05: Wire per-server toggle and all Workspace surfaces

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phases 02–04 complete.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Integration owner. Estimated implementation effort: 6h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Settings target and Workspace project owner are independent in current multi-profile architecture. Advisor already has persistent slot/host placement across IDE/Terminal/compact. Launchers and restored tool state currently exist without native enabled/admin gating.

## Requirements

Replace Plugin Platform registration section with one admin Advisor toggle and detected-directory path/availability/error status only. No hash field, generation/copy button or hashing state. Persist on Settings target server, default disabled; Workspace uses its own owner server setting. Every Advisor launcher/shortcut/surface obeys enabled/admin visibility. Layout switches preserve same-owner panel state.

## Architecture

ApiClient.advisor and WsTransport REST channel mapping; owner-qualified React Query keys using existing helpers. Reuse WorkspaceAdvisorPlacementProvider, AdvisorPanelSlot and persistent WorkspaceAdvisorHost, replacing PluginHost with AdvisorPanel and native activate/dismiss callbacks. One visibility predicate: connected + admin + enabled; history absence renders unavailable/empty state within enabled section, not registration UI.

## Related code files

MODIFY /home/loidinh/WS/dam-hopper/packages/ui/src/api/{client.ts,ws-transport.ts,ownership.ts only if existing helper insufficient}.
MODIFY /home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/{SettingsPage.tsx,WorkspacePage.tsx}.
MODIFY /home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/{WorkspaceAdvisorHost.tsx,AdvisorPanelSlot.tsx}; retain placement context/lib if still useful.
CREATE /home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx and /home/loidinh/WS/dam-hopper/packages/ui/src/hooks/use-advisor.ts.
UPDATE /home/loidinh/WS/dam-hopper/packages/ui/browser-tests/workspace-advisor.browser.tsx to native consumer behavior; delete obsolete iframe-only expectations.

## Implementation Steps

1. Add explicit typed ApiClient.advisor methods/status types and REST mappings from Phase 01. Owner-bound getApi(ConnectionRef), no singleton/fallback client or profileId sent as server authority.
2. Native hooks key profile+generation+source/query identity; disable queries when hidden/disabled/disconnected/non-admin. Capture owner and intended value before toggle dispatch; invalidate only captured owner after success.
3. Replace entire Settings Plugin Platform accordion with Advisor settings. Default off, including upgrade; preserve persisted enabled even when directory missing. Show detected path, real-directory availability and source errors, including final-root symlink rejection. No editable root, hash field, Generate/Copy hash button, hash error state, grants or bindings. Status error does not masquerade as disabled.
4. Swap persistent WorkspaceAdvisorHost child to native panel; remove UiIntent imports from plugin bridge. Preserve native focus activation/dismiss/Escape callbacks, measured placement/zoom/resize behavior and slot padding.
5. Filter IDE right tools, terminal floating tools/shortcut strip, mobile/compact surfaces and keyboard actions using same owner/admin/enabled state. Normalize restored Advisor selection to safe existing surface when unavailable; disable immediately closes and unmounts data provider.
6. Distinguish Settings target profile A from Workspace owner B: toggling A never modifies B visibility or sends B's root to A. When no selected project exists, require an explicit connected profile selection rather than first-connected fallback.
7. Remove old registration UI/modal imports once no callers remain; Phase 06 owns full platform deletion. Integrator stages all shared files together and coordinates lockfile changes only once.
8. Smoke actual Settings toggle, reload, IDE→Terminal→compact with selected tab/filter preserved, Escape/focus return, narrow resize and browser zoom. Exercise profile switch during read and setting write, role loss, directory absent→created and disable→re-enable.
9. Record parity evidence for all eight operations and four views. This is gate G1: only after native browser/API parity may Phases 06 and 08 delete old source/platform paths.

## Todo list

- [ ] Add explicit typed ApiClient.advisor methods/status types and REST mappings from Phase 01. Owner-bound getApi(ConnectionRef), no singleton/fallback client or profileId sent as server authority.
- [ ] Native hooks key profile+generation+source/query identity; disable queries when hidden/disabled/disconnected/non-admin. Capture owner and intended value before toggle dispatch; invalidate only captured owner after success.
- [ ] Replace entire Settings Plugin Platform accordion with Advisor settings. Default off, including upgrade; preserve persisted enabled even when directory missing. Show detected path, real-directory availability and source errors, including final-root symlink rejection. No editable root, hash field, Generate/Copy hash button, hash error state, grants or bindings. Status error does not masquerade as disabled.
- [ ] Swap persistent WorkspaceAdvisorHost child to native panel; remove UiIntent imports from plugin bridge. Preserve native focus activation/dismiss/Escape callbacks, measured placement/zoom/resize behavior and slot padding.
- [ ] Filter IDE right tools, terminal floating tools/shortcut strip, mobile/compact surfaces and keyboard actions using same owner/admin/enabled state. Normalize restored Advisor selection to safe existing surface when unavailable; disable immediately closes and unmounts data provider.
- [ ] Distinguish Settings target profile A from Workspace owner B: toggling A never modifies B visibility or sends B's root to A. When no selected project exists, require an explicit connected profile selection rather than first-connected fallback.
- [ ] Remove old registration UI/modal imports once no callers remain; Phase 06 owns full platform deletion. Integrator stages all shared files together and coordinates lockfile changes only once.
- [ ] Smoke actual Settings toggle, reload, IDE→Terminal→compact with selected tab/filter preserved, Escape/focus return, narrow resize and browser zoom. Exercise profile switch during read and setting write, role loss, directory absent→created and disable→re-enable.
- [ ] Record parity evidence for all eight operations and four views. This is gate G1: only after native browser/API parity may Phases 06 and 08 delete old source/platform paths.

## Success Criteria

One native Advisor toggle and folder status; no plugin registration section or path-hash UI. Initial server setting off, including upgrades. Enabled visible in every supported Workspace mode; disabled/non-admin absent everywhere and sends no data traffic. Missing/unreadable/non-real final directory reports meaningful state without extra configuration. Two profile scenario keeps read/write/cache/visibility ownership separate. G1 real UI and domain parity evidence recorded.

## Risk Assessment

WorkspacePage is large; exact tool arrays/shortcut callsites must all migrate. Hiding only panel body leaves ghost launchers. Settings/preference ownership confusion causes cross-server toggles.

## Security Considerations

UI role checks are visibility only; every API still validates current role. No-auth cannot fake admin. Disconnect/logout/role denial clears retained source data and settles pending requests.

## Next steps

After G1, Phases 06 and 08 can retire platform/integration independently; Phase 07 removes deployment plumbing before script applies on host.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
