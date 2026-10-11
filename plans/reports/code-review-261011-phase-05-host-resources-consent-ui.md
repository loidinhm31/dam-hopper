# Code Review Report: Phase 05 — Host Resources Status and Always-Mounted Consent UI

**Phase**: Phase 05 — Host Resources status and always-mounted consent UI (`plans/261010-1746-host-resources-auto-sleep/phase-05-host-resources-and-consent-ui.md`)  
**Contracts**: `plans/261010-1746-host-resources-auto-sleep/contracts.md`  
**Reviewer**: Phase05CodeReviewer  
**Date**: 2026-10-11  
**Score**: 9.1 / 10 (APPROVED)

---

## Code Review Summary

### Scope
- **Files reviewed (17)**:
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/ws-transport.ts`
  - `packages/ui/src/api/queries.ts`
  - `packages/ui/src/hooks/use-sse.ts`
  - `packages/ui/src/hooks/use-host-sleep-consent.ts`
  - `packages/ui/src/components/organisms/HostSleepConsentDialog.tsx`
  - `packages/ui/src/components/organisms/HostSleepConsentHost.tsx`
  - `packages/ui/src/embed/dam-hopper-app.tsx`
  - `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`
  - `packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.tsx`
  - `packages/ui/src/api/idle-suspend-client.test.ts`
  - `packages/ui/src/api/ws-transport.test.ts`
  - `packages/ui/src/hooks/use-sse.test.ts`
  - `packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx`
  - `packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.test.tsx`
  - `packages/ui/src/components/organisms/HostSleepConsentHost.test.tsx`
  - `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`
- **Lines of code analyzed**: ~2,150 lines across production + test files.
- **Review focus**: Security/capability isolation, owner/generation fencing across `await`, Cognito privacy boundary, deterministic multi-host queue & alias deduplication, strict DTO decoding, performance (timer & query lifecycles), YAGNI/KISS/DRY.

### Overall Assessment
Implementation cleanly satisfies Phase 05 architectural and security contracts:
- `HostSleepConsentHost` mounts once at canonical root `DamHopperApp` (`packages/ui/src/embed/dam-hopper-app.tsx:372`), covering web/native and all routes/workspace modes even when `HostResourcePopover` is closed or an inactive profile is targeted.
- Per-socket `host:uiConnection` capability receipt stays strictly in `WsTransport` memory (`currentUiConnection`), never persisted to storage, URLs, or public query cache, and is cleared on socket close/error/destroy.
- Decision POSTs capture `{ owner, requestId, requestRevision, connectionId }`, enforce `retry: false`, fence on `isCurrentConnection(target.owner)` and matching `connectionId` before and after `await`, and never auto-approve on Escape/close/timeout/unmount/Cognito mode.
- `HostIdleSuspendStatus` and `SettingsIdleSuspendTimingSection` accurately present `agent-free` (>3h / 10,800s read-only quiet period, managed-terminals-only scope notice, `Idle / Blocked` vs `Working / Unknown` counts, client presence, and server-driven countdowns) while preserving manual `ForceSleepDialog` behavior.

---

## Critical Issues
None.

---

## Warnings (Medium Priority)

1. **`seenActiveKeysRef` prefix pruning splits on `:` instead of matching `connectionKey(owner)` prefix (`packages/ui/src/hooks/use-host-sleep-consent.ts:158-162`)**
   - **Problem**: `connectionKey(t.owner)` returns `JSON.stringify([profileId, generation])` (e.g. `["prof-a",1]`), and `itemKey` is `${connectionKey(target.owner)}:${consent.requestId}` (`["prof-a",1]:<uuid>`). Line 160 computes `const prefix = `${key.split(":").slice(0, 2).join(":")}:`;`, which includes `<uuid>:` whenever `profileId` contains no colon, causing `activeOwnerPrefixes.has(prefix)` to evaluate `false` and delete active keys when the `useEffect` runs. Furthermore, `seenActiveKeysRef.current.add(itemKey)` is called inside `useMemo` during render while pruned in `useEffect`. If a pending request is settled externally (e.g., denied by another client or expired) without local button state (`localStates[itemKey]` undefined) after `seenActiveKeysRef` was pruned by a `receiptSig` update, the externally settled banner can be skipped.
   - **Fix**: Derive prefix via `key.slice(0, key.lastIndexOf(":") + 1)` (or check `[...activeOwnerPrefixes].some((p) => key.startsWith(p))`) and record active keys inside the effect or preserve them for connected owners.

2. **Pending Escape/outside dismissal records `itemKey` but not `dedupeKey` in `dismissedKeys` (`packages/ui/src/hooks/use-host-sleep-consent.ts:341-343`)**
   - **Problem**: When a settled dialog is dismissed (`lines 414-418`), both `[itemKey]: true` and `[matched.dedupeKey]: true` are added to `dismissedKeys`. When a pending dialog is dismissed via Escape/outside click and `submitDecision` succeeds with `deny` (`line 342`), only `[itemKey]: true` is set. If two connected profile aliases share a proven `serverEpoch` + `requestId` (`dedupeKey = server-instance:<epoch>:<uuid>`), dismissing the first alias while pending can briefly surface the second alias until its status refetch settles.
   - **Fix**: Pass or compute `dedupeKey` in `submitDecision` (or mark both `itemKey` and `matched.dedupeKey` in `dismiss` upon successful pending deny) so deduplicated aliases dismiss together.

---

## Suggestions (Low Priority)

1. **Enforce `state` vs `decision` consistency in `decodeConsentStatus` (`packages/ui/src/api/client.ts:1150-1189`)**
   - Contract specifies `decision` is `null` while `state === "pending"`, `"approve"` when `state === "approved"`, and `"deny"` when `state === "denied"`, plus `expiresAtMs >= requestedAtMs`. Adding this cross-field check in `decodeConsentStatus` tightens transport boundary validation.

2. **Narrow `IdleSuspendAgentFreeStatusV1["scope"]` type (`packages/ui/src/api/client.ts:777, 1108`)**
   - `decodeAgentFreeStatus` already validates `val.scope === "managed-terminals"`. Narrowing `scope: string` to `scope: "managed-terminals"` on `IdleSuspendAgentFreeStatusV1` reflects the runtime invariant at the type level.

---

## Positive Observations
- **Strict Capability & Owner Fencing**: `submitDecision` checks Cognito state, `isCurrentConnection(target.owner)`, in-flight deduplication (`inFlightRef`), and live socket `receipt.connectionId` both before invoking the owner-bound API and after `await`.
- **Safe Alias Deduplication**: `useHostSleepConsent` deduplicates profiles only when a fresh `serverEpoch` and valid UUID `requestId` match, falling back to per-owner entries rather than guessing by URL/hostname.
- **Timer Discipline**: Both `HostSleepConsentDialog` and `HostIdleSuspendStatus` run 1s display intervals strictly while an active deadline is present and stop when settled, disabled, or in Cognito mode.

---

## Validation Commands and Results

| Step | Command | Result |
|---|---|---|
| 1. Targeted Vitest | `pnpm --filter @dam-hopper/ui test src/api/idle-suspend-client.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts src/components/organisms/HostIdleSuspendStatus.test.tsx src/components/organisms/SettingsIdleSuspendTimingSection.test.tsx src/components/organisms/HostSleepConsentHost.test.tsx src/embed/dam-hopper-app.test.tsx` | **PASS** (7 files, 149/149 tests, 1.68s) |
| 2. TypeScript Typecheck | `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | **PASS** (0 errors, 11.13s) |
| 3. Vitest Browser | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/idle-suspend-settings-status.browser.tsx` | **PASS** (1 file, 17/17 tests, 2.63s) |
| 4. Full `@dam-hopper/ui` Suite | `pnpm --filter @dam-hopper/ui test` | **PASS** (331 files, 2,783/2,783 tests, 24.78s) |

---

## Unresolved Questions
None. Full end-to-end authenticated application visual qualification is scheduled in Phase 06 per plan.
