# Phase 05: Explicit-connect multi-port UI

## Context Links

- [Plan](./plan.md)
- [Phase 04](./phase-04-tauri-typescript-contract-compatibility.md)
- [Current-flow research](./research/researcher-01-commit-current-flow-report.md)
- Baseline symbols: `useSshForward`, `useSshForwardPageController`, `SshForwardingPage`, `SshForwardProfileCard`, `SshForwardProfileDialog`, `PassphraseDialog`, `SshHostKeyApprovalDialog`, `SshForwardScopeBridge`.

## Overview

- Date: 2026-08-16
- Description: Make target establishment/authentication explicit, then provide prompt-free connection-grouped port toggles.
- Priority: P2
- Implementation status: Completed 2026-08-18
- Review status: Completed after UI/accessibility/security-copy and native lifecycle review; Phase 06 release gates remain pending

## Key Insights

- Current controller starts a port, catches auth errors, prompts, loads credentials, then restarts. V2 must move that entire loop behind Connect.
- Grouping rules under their parent makes many servers/many ports understandable without adding a second route or global scope concept.
- Existing host-key and passphrase/password dialogs can be reused with connection terminology, default-on 30-day remember intent, and focus behavior.

## Requirements

- Page shows one active DamHopper scope with a connection list. Each connection shows endpoint/user/auth, Disconnected/Authenticating/Established/Reconnecting status, safe error, Connect/Disconnect/Edit/Delete actions, and child rules.
- Add connection flow: save credential-free profile -> click Connect -> handle unknown-host challenge -> exact approval -> explicit Connect retry -> handle encrypted-key passphrase or editable username/password prompt -> Established.
- Credential prompts show “Remember for 30 days” on by default. Copy states fixed expiry (not sliding), Windows user-vault storage, and same-user-process risk. Successful saved status shows exact `expiresAt`; connection cards expose Forget.
- On app restart or after disconnect/scope round-trip, Connect automatically uses an unexpired non-rejected saved credential without showing the prompt. Port toggles remain vault-free.
- Host-key change keeps “credential saved” metadata but blocks Connect and clearly states the secret will not be sent until explicit trust repair/approval.
- Expired/rejected/unavailable status requires prompt/replacement; vault save failure keeps the live connection Established but warns “not saved.” Forget confirmation removes only the saved credential, not the profile or current connection unless native policy requires disconnect first.
- Password username edit updates the disconnected connection profile before staging password; refreshed revisions/generation are used for load/connect.
- Only Established connections expose enabled rule toggles. Enable/disable calls never open credential dialogs. During Reconnecting, new enables are disabled; existing rules show waiting/rejecting-new-clients state and remain individually disable-able via cleanup path.
- Add/edit/delete rule separately from connection. Rule fields: name, local port, fixed target explanation, target port, desired-enabled/reconnect intent. Prevent edit/delete while active; expose Disable then Edit/Delete.
- Disconnect warns when child rules are on and confirms all listeners/channels will close. Delete requires Disconnected and no active children.
- Support up to 16 simultaneous connection groups and 64 enabled rules without a single-selected-server assumption.
- Display 30-day vault copy: disconnect/trust change/scope switch/app exit close live resources but retain the unexpired saved credential; trust remains a separate blocking gate.
- Preserve Windows desktop route/nav gating, keyboard/focus trap, loading/error/empty states, responsive layout, and loopback local-process warning.

## Architecture

`SshForwardingPage -> useSshForwardPageController -> useSshForward -> SshForwardHost`.

- Controller owns selected connection/rule dialog targets, trust challenge, credential prompt, confirmation, and action pending IDs.
- Hook owns authoritative snapshot refresh/conflict retry and exposes connection/rule CRUD, connect/disconnect, set-enabled, key/load/approve operations.
- Render connection cards keyed by connection ID; join rules/runtimes by validated IDs. Never infer Established from cached profile or last success.
- Event hints only invalidate/refetch through the host adapter; UI renders snapshots.

## Related Code Files

- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward.ts` — **modify**: v2 snapshot/actions, stale revision/generation refresh, no port credential path.
- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward-page-controller.ts` — **modify**: explicit Connect auth/trust loop, separate connection/rule dialogs, pending/error/confirmation state.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\pages\SshForwardingPage.tsx` — **modify**: connection-grouped layout, limits/empty/error state, no combined-profile assumptions.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\molecules\SshConnectionCard.tsx` — **create**: connection identity/status/actions and child-rule region.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\molecules\SshForwardRuleCard.tsx` — **create**: independent port state/toggle/edit/delete display.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshConnectionDialog.tsx` — **create**: credential-free endpoint/user/auth profile create/edit.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardRuleDialog.tsx` — **create**: local/target port and reconnect/enable intent create/edit.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\PassphraseDialog.tsx` — **modify**: connection-target copy, encrypted-key/password modes, default-on fixed 30-day remember control, no rule lifecycle action.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshHostKeyApprovalDialog.tsx` — **modify**: connection ID/generation challenge and explicit-retry copy.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardEndpointFields.tsx` — **modify**: connection endpoint/user fields only.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardAuthFields.tsx` — **modify**: connection auth identity fields only.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardTargetFields.tsx` — **modify**: forwarding rule loopback/port fields only.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-form.ts` — **modify**: split connection/rule drafts and shared validators.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\molecules\SshForwardProfileCard.tsx` — **delete after replacement**: remove combined identity/port card.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\molecules\SshForwardProfileSummary.tsx` — **delete after replacement**: remove combined summary.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardProfileDialog.tsx` — **delete after replacement**: remove combined editor.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardProfileFields.tsx` — **delete after replacement**: remove combined field composition.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardProfileReview.tsx` — **delete after replacement**: remove combined review.
- `G:\ws\sharing\dam-hopper\packages\ui\src\hooks\use-ssh-forward.test.tsx` — **modify**: v2 hook actions, stale refresh, no credential call on rule toggles.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\pages\SshForwardingPage.test.tsx` — **modify**: grouped connections/rules and authoritative state gating.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshConnectionDialog.test.tsx` — **create**: connection form, focus, edit restrictions.
- `G:\ws\sharing\dam-hopper\packages\ui\src\components\organisms\SshForwardRuleDialog.test.tsx` — **create**: rule form, loopback/port/reconnect validation.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-credential-dialog.browser.tsx` — **modify**: explicit Connect trust/key/password and prompt-count flows.
- `G:\ws\sharing\dam-hopper\packages\ui\browser-tests\ssh-forward-route-gating.browser.tsx` — **modify**: Windows-only multi-connection route and no-host regression.

## Implementation Steps

1. Split form types/builders/validators into connection and rule drafts; centralize UUID/host/port/auth/reconnect validation and map native field errors.
2. Refactor `useSshForward` around connections/rules and two revisions. On stale conflicts, refetch once and require caller retry; do not replay credential/enable operations automatically.
3. Refactor controller state machine: `idle -> connecting -> trustReview|credentialPrompt -> connecting -> established|error`. Native Connect checks the vault after trust; `AUTH_REQUIRED` opens the prompt. Cancel clears prompt target/attempt and leaves Disconnected.
4. Preserve host-key flow: show exact endpoint/algorithm/fingerprint/expiry; approval never auto-connects; UI instructs and requires a new Connect action.
5. Preserve credential flow: encrypted selected key requests passphrase; agent/key auth failure may offer explicit username/password method; update username first if changed; stage remember intent then Connect. Only successful auth may show Saved until.
6. Build connection and rule dialogs/cards. Group all matching rules under each connection and surface orphan data only as a blocking corruption error.
7. Gate toggles from authoritative runtime: Established enables; Reconnecting disables new enables; disconnected toggle explains Connect first; disable remains available for an existing child.
8. Add disconnect/delete/Forget confirmations, limit copy, saved/rejected/expired/unavailable credential states, fixed-expiry copy, loopback local-process warning, and app-restart reuse copy.
9. Remove legacy components/imports after replacement; keep route and `SshForwardScopeBridge` behavior unchanged.
10. Add unit/browser tests for keyboard focus, dialogs, trust retry, encrypted key, username/password edit, remember default/opt-out, restart reuse, Forget, expiry/rejection, no-prompt port toggles, two connections/multiple ports, sibling failure, scope switch, and unavailable browser/mobile route.

## Todo List

- [x] Split connection/rule form models.
- [x] Refactor hook/controller to explicit Connect.
- [x] Build connection-grouped page and cards.
- [x] Reuse trust and credential dialogs with connection semantics.
- [x] Remove combined-profile UI.
- [x] Add confirmations, security copy, accessibility states.
- [x] Add 30-day saved status, default remember control, rejection/expiry warnings, and Forget.
- [x] Pass unit and focused Chromium browser flows; broad browser release qualification remains in Phase 06.

## Success Criteria

- A user must establish/authenticate a target before any child rule can turn on.
- After Established, multiple rule toggles complete without another trust/credential prompt.
- Two or more server connections remain Established simultaneously and their rules operate independently.
- Wrong/stale/disconnected connections show deterministic errors and never trigger credential UI from a rule toggle.
- An unexpired saved credential reconnects after disconnect, scope round-trip, or app restart without a credential dialog; fixed expiry, rejection, or Forget returns to the prompt flow.
- Trust change visibly retains credential metadata but blocks before secret use until explicit trust repair/approval.
- All dialogs are keyboard operable, focus-restoring, responsive, and route-gated to Windows native desktop.

## Risk Assessment

- **High — controller prompt loops:** explicit state machine, one attempt target, no automatic approval retry.
- **High — UI/native state divergence:** snapshot-only rendering and conflict refetch; events stay hints.
- **Medium — crowded multi-connection layout:** grouped cards, concise child rows, bounded counts, responsive tests.
- **Medium — destructive disconnect surprise:** active-child count and confirmation.

## Security Considerations

- Password/passphrase lives only in dialog local state until one Tauri call; clear on submit/cancel/error/unmount and never store in query cache/URL/localStorage. Native code alone may save it in Windows Credential Manager after successful auth.
- Render only safe vault state and expiry. Never expose or copy a Credential Manager target/account identifier.
- Do not display or log raw native error detail, key paths, usernames in generic telemetry, or credential attempt IDs.
- Keep host-key warning/recovery copy exact and prevent approval after challenge expiry.
- Never make UI disabled state the only enforcement; native checks remain authoritative.

## Next Steps

- Phase 06 qualifies the complete flow with fake SSH servers and packaged Windows evidence.
- Do not ship based on browser/unit success alone.

## Unresolved Questions

None.
