# Phase 04 — Profile-owned enrollment and MFA UI

## Context links

[Plan](./plan.md) · [Client research](./research/client-auth-flow.md) · [API contract](./security-contract.md#proposed-http-contract) · [Phase 02](./phase-02-authentication-api.md) · [Phase 03](./phase-03-transport-enforcement.md)

## Overview

Date: 2026-09-26. Priority: P1. Implementation: pending. Review: pending. Shared web/native login and periodic MFA flow; no app-wide lockout for a single stale profile.

## Key Insights

`ServerSettingsDialog.testConnection()` currently expects an immediate token and marks the test successful. `connections.ts` collapses 401/403 into login-required. `WsTransport` captures token for its entire lifetime and treats close as generic drop. Existing `react-qr-code` renders QR locally. Android Chrome policy currently blocks credential entry; do not inherit that restriction into an unusable mandatory MFA flow without resolving it.

## Requirements

QR and selectable/copyable equivalent Base32 key, issuer/account/algorithm instructions, first-code confirmation, login-MFA challenge, periodic step-up, full login at expiry. Session tokens stay in existing profile-bound storage; secrets/challenges/passwords do not. Healthy profiles keep working. Client clock only drives hints, never security decisions.

## Architecture

Extend existing profile connection state with `mfa-required` and auth deadline metadata. Use a small shared `MfaChallengeForm` for enrollment/verification and a profile-owned auth operation context: profileId or unsaved-draft ID, normalized server URL, authType, generation, and request nonce. Retirement after MFA must create a new prompt owner before capturing submissions; do not bind requests to an already-invalid old transport. Successful step-up persists replacement bearer and creates a new transport generation for the same MongoDB session/deadline.

## Related code files

Modify: `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`, `ServerProfilesDialog.tsx`, `TopNav.tsx`; `packages/ui/src/api/connections.ts`, `ws-transport.ts`, `server-config.ts`; `packages/ui/src/embed/dam-hopper-app.tsx`; auth-status consumer `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx`.

Create: `packages/ui/src/api/auth-client.ts` for typed HTTP flow and `packages/ui/src/components/molecules/MfaChallengeForm.tsx` for shared fields. Avoid another token store or a separate web/native implementation.

Inspect/modify only as required: `packages/ui/src/contexts/AndroidChromeInputPolicyContext.tsx` and its existing input-policy implementation for a narrow auth-entry path, not global keyboard-policy removal.

## Implementation Steps

1. Add typed discriminated response parsing for authProtocol 2 and structured error codes. An old server/unknown shape must not be guessed into an MFA success; show explicit incompatibility where required.
2. Extend settings login flow: password -> enrollment or MFA challenge -> complete session. No "Reachable/authenticated" result or saved session until final success; registration approval remains separate.
3. Render local QR from otpauthUri and manual key from same server payload; show issuer/account/6 digits/30 seconds and explicit setup confirmation. Provide accessible label, paste/numeric OTP input, leading-zero support, retry feedback, and copy feedback. Do not auto-copy secrets.
4. Clear secret/challenge/password on cancel, timeout, completion, unmount, endpoint/profile change. Fence every async response by auth operation owner; editing an unsaved profile must not allow an old server response to attach credentials to a different URL.
5. Add profile-local mfa-required state for status/REST errors and WS auth close. Stop generic reconnect loops while waiting for interaction; close stale transport and detach capabilities without clearing the restricted bearer needed for step-up or deleting profile/workspace selections.
6. Step-up challenge requests use captured profile bearer over HTTP, not a blocked WS API. Final response updates only matching profile's existing auth record, retires old generation, and reconnects with new token. Original expiresAt unchanged.
7. Full expiry/legacy/reset clears invalid credentials only for affected owner and opens password+MFA/enrollment flow. Maintain storage-failure reporting; no in-memory success if durable token write failed and would be misleading.
8. Converge other auth-status consumers on typed state; suppress protected queries until profile fresh. Multiple tabs detect stored token change and recreate affected transport without retrying an invalid old revision indefinitely.
9. Wire ServerProfilesDialog Login/MFA actions through existing owner-local settings entry. Its optional login callback currently falls back to onEditProfile; preserve the selected profile, not ambient active profile.
10. Provide a narrowly scoped usable authentication input path on Android Chrome while preserving terminal/editor input suppression. Do not release a flow that locks mobile users out or asks them to copy a token from another device. Validate on the actual target browser; exact interaction is a plan-validation decision.

## Todo list

- [ ] Typed auth client and owner-fenced dialog state.
- [ ] QR/manual setup and first-code confirmation.
- [ ] Periodic MFA state, token replacement, and transport recreation.
- [ ] Full expiry, reset, multi-tab, storage failure, and profile isolation.
- [ ] Accessible web/native/mobile authentication entry verified.

## Success Criteria

A real browser enrolls via QR and manual key and cannot access protected resources before confirmation. Wrong/replayed code does not unlock. Profile A entering MFA does not interrupt B. Late results after edit/remove/switch cannot persist another owner's credentials. Day-10 replacement preserves day-30 deadline. Mobile credential/code entry is actually usable.

## Risk Assessment

Existing Android Chrome suppression is intentional across many unrelated features; global removal would be unjustified. Use auth-only interaction and retain other policy. Auth-required WS handshake may appear as opaque browser network failure: follow with typed status evaluation, not blind reconnect.

## Security Considerations

Never persist setup URI/key/code; never trust frontend due timers; never transmit credentials to another profile/endpoint on fallback. Native restrictions and exact CORS remain intact. Reauthentication does not reset unrelated profile state or kill server terminals.

## Next steps

Phase 05 exercises actual enrollment and transport cutoff on isolated backend/browser. Native/mobile failures must be fixed or explicitly block release, not silently waived.
