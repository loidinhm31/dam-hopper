# Code Review: Phase 04 — Profile-owned enrollment and MFA UI

**Plan:** `plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md`  
**Date:** 2026-09-27  
**Score:** 8.6 / 10  
**Status:** Approved with Warnings (fix non-blocking warnings before Phase 05 qualification)

---

## Executive Summary

Phase 04 implements the client-side profile-bound enrollment and MFA authentication lifecycle for DamHopper protocol v2. It provides typed discriminated response parsing, owner-fenced connection test states in `ServerSettingsDialog`, QR and manual Base32 setup keys with rate-limiting feedback in `MfaChallengeForm`, `mfa-required` snapshot state and WS 4403 / REST 401 drop handling in `connections.ts` and `ws-transport.ts`, cross-tab token synchronization, and scoped Android Chrome input exemptions.

One TypeScript compilation error in `connections.ts` broke `tsc -p tsconfig.json` and was resolved during review. All 7 scoped test suites (75 tests) and the full `@dam-hopper/ui` test suite (271 test files, 1899 tests) pass.

---

## Critical Issues (MUST FIX)

1. **[RESOLVED IN REVIEW] Type Error in `packages/ui/src/api/connections.ts:27-28, 387`**
   - **Location:** `packages/ui/src/api/connections.ts:27`
   - **Impact:** `isSameOriginProfile` wrapper was declared as `(url: string)` instead of accepting `ServerProfile`. Line 28 passed `url` to `serverConfig.isSameOriginProfile(profile: ServerProfile)` and line 387 passed `profile: ServerProfile` to `isSameOriginProfile(url: string)`. This broke project-wide TypeScript build (`tsc -p tsconfig.json`) with `TS2345: Argument of type 'string' is not assignable to parameter of type 'ServerProfile'`.
   - **Resolution:** Updated wrapper signature to `(profile: serverConfig.ServerProfile)` matching `server-config.ts`. Verified with `pnpm --filter @dam-hopper/ui build` (clean exit 0).

---

## Warnings (SHOULD FIX)

1. **Unreachable In-Session Step-Up MFA in UI (`stepUpProfileMfa`)**
   - **Location:** `packages/ui/src/api/connections.ts:775-798` vs `packages/ui/src/components/organisms/ServerSettingsDialog.tsx:214-220`
   - **Impact:** `stepUpProfileMfa` is implemented and unit-tested in `connections-mfa.test.tsx`, but no UI component invokes it. When connection enters `mfa-required`, clicking "MFA" in `ServerProfilesDialog` opens `ServerSettingsDialog` with a blank password. Clicking "Test connection" fails with `"Username and password are required"`. Users are forced to execute a full re-login (re-enter username + password + TOTP) rather than an in-session step-up (only entering TOTP code using the existing valid bearer).
   - **Recommended Fix:** When opening `ServerSettingsDialog` for an existing profile with an active token and `snapshot?.status === "mfa-required"`, display a direct TOTP entry form calling `stepUpProfileMfa(profile.id, code)` without demanding password re-entry.

2. **Non-JSON 401 Misclassified as `offline` and Triggering Reconnect Loops**
   - **Location:** `packages/ui/src/api/auth-client.ts:466-495` and `packages/ui/src/api/connections.ts:441-488`
   - **Impact:** In `checkAuthStatus`, if a 401 response contains a non-JSON body (e.g. reverse proxy Nginx/Cloudflare HTML error page or empty body), it falls through and throws an `AuthClientError(..., AUTH_REQUIRED, 401)`. In `connections.ts:performConnectProfile`, `catch (fetchErr)` catches it and sets `status: "offline"`, scheduling a continuous reconnect loop instead of transitioning to `"login-required"`.
   - **Recommended Fix:** In `checkAuthStatus`, return `AuthStatusLoginRequired` whenever `res.status === 401` even if `data` is null. In `connections.ts`, check `if (fetchErr instanceof AuthClientError && fetchErr.status === 401)` before defaulting to `"offline"`.

3. **Incomplete Error Code Mapping in `PluginManagementSection.tsx`**
   - **Location:** `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx:104-108`
   - **Impact:** `setUnauthorized` only checks `MFA_REQUIRED`, `AUTH_REQUIRED`, and `SESSION_EXPIRED`. If the server returns `SESSION_REVOKED`, `ACCOUNT_DISABLED`, or `ACCOUNT_LOCKED`, `unauthorized` evaluates to `false`, leaving the plugin management UI rendered in an inconsistent state.
   - **Recommended Fix:** Set `setUnauthorized(!result.authenticated)`.

4. **Android Chrome Input Suppression Blocks New Profile Creation in Dialog**
   - **Location:** `packages/ui/src/components/organisms/ServerSettingsDialog.tsx:868, 963`
   - **Impact:** Buttons are disabled when `(isAndroidChromeNativeInputSuppressed && !profile)`. When creating a new profile (`profile === null`), this completely prevents testing and saving on Android Chrome.
   - **Recommended Fix:** Scope the Android Chrome exemption to dialog controls using the container attribute `data-auth-container="true"`.

---

## Suggestions (NICE TO HAVE)

1. **CORS Consistency in `logout()`**
   - **Location:** `packages/ui/src/api/auth-client.ts:524`
   - **Note:** `logout()` sets `credentials: "include"`, whereas `checkAuthStatus()` and `WsTransport.invoke()` use `credentials: "omit"`. For consistent cross-origin Bearer token transport, use `credentials: "omit"`.

2. **Timer Type Cleanliness in `MfaChallengeForm.tsx`**
   - **Location:** `packages/ui/src/components/molecules/MfaChallengeForm.tsx:34`
   - **Note:** `copyTimeoutRef` is typed as `NodeJS.Timeout | number | null`. Prefer `ReturnType<typeof setTimeout> | null` for browser Vite environments.

3. **Modularization of `connections.ts`**
   - **Location:** `packages/ui/src/api/connections.ts` (843 LOC)
   - **Note:** Decompose into `connections-store.ts` (state snapshots & registry), `connections-reconnect.ts` (backoff & lifecycle), and `connections-sync.ts` (cross-tab storage subscriber).

---

## Positive Observations

- **Fenced Request IDs:** `ServerSettingsDialog` fences async operations with `testRequestIdRef`, `latestUrlRef`, and `latestProfileIdRef`, preventing stale in-flight responses from attaching credentials to modified profiles.
- **Fail-Closed Gate on Save:** Profiles cannot be saved or marked "ok" until MFA challenge verification completes.
- **Zero Grace Reconnect Prevention:** Connections entering `mfa-required` immediately destroy the active transport, detach capabilities, and stop reconnect loops without wiping the restricted token needed for step-up.
- **Multi-Tab Token Sync:** `connections.ts` subscribes to storage changes across browser tabs, seamlessly disconnecting stale revisions and connecting new tokens.
- **Accessible MFA Form:** `MfaChallengeForm` provides accessible labels, input sanitization preserving leading zeros, manual setup key with copy fallback, and rate-limit retry feedback.

---

## Reviewed Files

- `packages/ui/src/api/auth-types.ts`
- `packages/ui/src/api/auth-client.ts`
- `packages/ui/src/api/auth-client.test.ts`
- `packages/ui/src/components/molecules/MfaChallengeForm.tsx`
- `packages/ui/src/components/molecules/MfaChallengeForm.test.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialogMfa.test.tsx`
- `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`
- `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
- `packages/ui/src/components/organisms/TopNav.tsx`
- `packages/ui/src/api/connections.ts`
- `packages/ui/src/api/connections-mfa.test.tsx`
- `packages/ui/src/api/connections.test.ts`
- `packages/ui/src/api/ws-transport.ts`
- `packages/ui/src/api/server-config.ts`
- `packages/ui/src/lib/android-chrome-input-policy.ts`
- `packages/ui/src/lib/android-chrome-input-policy.test.ts`
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx`
- `packages/ui/src/hooks/use-file-search.ts`
- `plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md`
- `plans/260926-2157-token-rotation-mfa/plan.md`

---

## Validation Commands and Results

- `pnpm --filter @dam-hopper/ui build`: Passed (clean `tsc` output, 0 errors).
- `pnpm --filter @dam-hopper/ui test src/api/auth-client.test.ts src/components/molecules/MfaChallengeForm.test.tsx src/components/organisms/ServerSettingsDialogMfa.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx src/api/connections-mfa.test.tsx src/api/connections.test.ts src/lib/android-chrome-input-policy.test.ts`:
  - 7 test files passed, 75 tests passed (934ms).
- `pnpm --filter @dam-hopper/ui test`:
  - 271 test files passed, 1899 tests passed (12.85s).

---

## Unresolved Questions

*None.*
