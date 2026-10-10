# Phase 05 Documentation Report — Host Resources Status & Always-Mounted Consent UI

- **Date:** 2026-10-11
- **Phase:** `Phase 05 — Host Resources status and always-mounted consent UI`
- **Status:** Complete

## Updated Documentation Files

1. `docs/idle-suspend-status-ui.md` (316 LOC, <800 maxLoc)
   - Documented `agent-free` policy UI contract on `GET /api/system/idle-suspend/v1/status` and `POST /api/system/idle-suspend/v1/consent/decision` (`credentials: "omit"` on `WsTransport`).
   - Recorded strict client decoders: `decodeAgentFreeStatus`, `decodeClientPresenceStatus`, `decodeConsentStatus`, `decodeConsentDecisionResponse`, and `decodeIdleSuspendStatusV1` policy/projection invariants plus narrow old-server normalization.
   - Documented `host:idleSuspendChanged` (`use-sse.ts`) invalidating ambient and owner-qualified `profileQueryKey(owner, "system", "idle-suspend", "v1", "status")` queries.
   - Documented `HostIdleSuspendStatus` `Agent Free (>3h)` policy label, **Semantic Agent-Free Eligibility** card (`phase`, `inventoryState`, `Idle / Blocked` and `Working / Unknown` counts, `Public clients`, `>10,800s (3h)` threshold, live `eligibleAtMs`/`deferredUntilMs`/`consent.expiresAtMs` countdowns, consent summary, and managed-terminals-only scope notice).
   - Documented `SettingsIdleSuspendTimingSection` fixed `10800`s (3h) `readOnly`/`disabled` quiet period under `agent-free` policy with mutable `wakeAfterSeconds`.
   - Documented `HostSleepConsentHost`, `HostSleepConsentDialog`, and `useHostSleepConsent`: single root mount in `DamHopperApp`, per-socket `host:uiConnection` capability receipt gating, multi-profile queue ordering and `server-instance:${serverEpoch}:${requestId}` alias deduplication, first-valid-answer-wins host-wide semantics, immediate final safety checks on approve, pending Escape/outside/close `deny` submission vs settled local close without POST, `409` conflict / `503` uncertainty reconciliation, and Cognito Mode isolation.

2. `docs/frontend-components/host-and-usage.md` (305 LOC, <800 maxLoc)
   - Updated `Terminal idle-suspend status and sleep consent UI` section with `agent-free` decoding, `HostIdleSuspendStatus` semantic eligibility/presence/consent card, `SettingsIdleSuspendTimingSection` 10,800s read-only quiet period, and `HostSleepConsentHost`/`HostSleepConsentDialog` multi-profile queueing and `serverEpoch` + UUID `requestId` alias deduplication.

3. `docs/user-guide-multi-server-profiles.md` (367 LOC, <800 maxLoc)
   - Updated `Host resources and health delivery across profiles` (`Privileged host actions and automatic sleep consent`) with multi-profile `HostSleepConsentHost`/`HostSleepConsentDialog` queueing (`Host 1 of N`), `server-instance:${serverEpoch}:${requestId}` alias deduplication (`Aliases:`), per-socket `host:uiConnection` capability requirement, first-valid-answer-wins semantics, and Cognito Mode suppression.

## Verification Recommended for Main Agent

- `node .omp/evcrate/scripts/validate-docs.cjs docs/`

## Unresolved Questions

- None.
