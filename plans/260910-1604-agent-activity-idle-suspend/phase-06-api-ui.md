# Phase 06 — Protected activity status and browser UI

## Context links

- [Plan](plan.md), [normative design contract](design-contract.md), [repository findings](research/repository-findings.md).
- Runtime prerequisite: [Phase 05 sampler/coordinator](phase-05-sampler-coordinator.md). Configuration prerequisite: [Phase 01 policy](phase-01-policy-contracts.md).
- Backend status and route surfaces: [`server/src/idle_suspend/status.rs`](../../server/src/idle_suspend/status.rs), [`server/src/api/idle_suspend.rs`](../../server/src/api/idle_suspend.rs), [`server/src/api/tests.rs`](../../server/src/api/tests.rs).
- Client and display surfaces: [`packages/ui/src/api/client.ts`](../../packages/ui/src/api/client.ts), [`packages/ui/src/api/queries.ts`](../../packages/ui/src/api/queries.ts), [`packages/ui/src/hooks/use-sse.ts`](../../packages/ui/src/hooks/use-sse.ts), [`packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`](../../packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx).
- Existing manual-action surfaces to preserve: [`ForceSleepDialog.tsx`](../../packages/ui/src/components/organisms/ForceSleepDialog.tsx), [`force-sleep-dialog-utils.ts`](../../packages/ui/src/lib/force-sleep-dialog-utils.ts).
- Evidence owners: existing [`HostIdleSuspendStatus.test.tsx`](../../packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx), existing Chromium [`idle-suspend-settings-status.browser.tsx`](../../packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx), and Phase 07 integrated qualification.

## Overview

- Date: 2026-09-10.
- Description: consume the frozen additive status DTO, reject malformed new-server data, normalize only genuine old-server omission, and render honest aggregate activity state without changing manual force authority.
- Priority: P2. Estimated implementation effort: 10h.
- Implementation status: DONE (2026-09-11). Review status: Passed (Score: 9.7/10).
- Progress: 100% (20/20 implementation steps; 13/13 todo items).
- Dependencies: Phase 05 owns `status.rs`, all backend DTO constructors, the API disabled/not-started fallback constructor, meaningful status revision publication, and runtime semantics. This phase owns client decoding, view behavior, API serialization regressions, component tests, and real-browser regressions.

## Key Insights

- `api.system.idleSuspendStatus()` currently trusts a generic transport cast. TypeScript generics do not validate server JSON. Compatibility must be an explicit boundary decoder, not optional chaining scattered through the view.
- Old-server compatibility is narrow: both additive fields absent from an otherwise valid v1 payload means legacy `empty-fleet` plus `activity: null`. One field absent, malformed fields, an invalid base payload, or a failed request is not an old server and must remain an error.
- `activity.measurementState` describes observer validity; coordinator `state` describes scheduling/handoff/outcome. Neither implies the other. Unknown counts must render as unknown, never `0`.
- `armDeadlineMs` remains the sole countdown. `sampledAtMs` and `lastActivityAtMs` are display-only wall timestamps and must never drive client-side eligibility or a second countdown.
- Existing live/creating/restarting counts and `ForceSleepDialog` determine manual confirmation. Recognized-agent counts are informational and must never replace or reduce those actual fleet counts.
- The status view currently has no deadline display and only a generated-at timestamp. Adding a small local display tick is sufficient; no polling loop, store, endpoint, or status heartbeat is needed.
- Phase 01's browser `DamHopperConfig` shape is intentionally a narrowed workspace/project editor payload, not a full startup server config. Do not add `automaticPolicy` or `agentExecutables` to that narrowed mutation type and accidentally give the UI matcher authority. If implementation discovers another genuinely full startup-config DTO, add the two read fields there together; add no editor.

## Requirements

### Frozen client contract

1. Add client unions `IdleSuspendAutomaticPolicy = "empty-fleet" | "agent-activity"`, `IdleSuspendActivityMeasurementState = "initializing" | "available" | "unavailable"`, and the exact closed `IdleSuspendActivityReasonCode` union: `recentInput`, `recentOutput`, `recentNetwork`, `agentChanged`, `lifecycleBusy`, `quiet`, `procAccess`, `scanLimit`, `scanTimeout`, `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`, `staleObservation`, `identityUncertain`, `counterOverflow`, `reconciling`, `epochSpent`.
2. Add required normalized `automaticPolicy` and `activity` to `IdleSuspendStatusV1`. Agent activity requires measurement state/reason, nullable counts/timestamps, literal `networkCoverage: "tcp4-tcp6"` and required nullable `measurementWarning` with the exact shape below; empty-fleet requires null activity.
3. Keep the server's version at `1`; these are additive v1 fields. Do not create a second endpoint or client version.
4. Replace the status method's unchecked generic cast with one decoder operating on `unknown`. Validate the existing required v1 fields, closed coordinator state, fleet object/counts/flags, optional nullable fields, new policy, activity shape, finite safe nonnegative integer domains, and policy/activity relationship.
5. Normalize old server only when an otherwise valid base v1 object has both own properties `automaticPolicy` and `activity` absent. Return a fresh normalized object with `automaticPolicy: "empty-fleet"` and `activity: null`; do not mutate transport-owned JSON.
6. Reject as malformed when exactly one additive property is absent, either is `undefined` but present, policy is unknown, empty-fleet carries a non-null activity object, agent-activity lacks an object, any enum/literal is unknown, or numeric/nullability constraints fail. Rejection must make the React Query an error; it must not fabricate zero agents or quiet.
7. Preserve transport failures and authentication failures unchanged. Never catch a rejected GET and substitute legacy status. Existing `Cache-Control: no-store` and protected route behavior remain server authority.
8. The sole process-detail display exception is the authenticated/no-store measurement warning's bounded PID and safe executable identity. Never expose matcher lists, command arguments, terminal/session/root/start/socket identities, addresses, terminal bytes, counters, tokens, env or per-terminal activity.

### Status UI behavior

9. Extend `HostIdleSuspendStatus` in place. Show selected automatic policy, coordinator state, actual fleet counts, measurement state/reason, recognized agent count or “Unknown,” monitored terminal count or “Unknown,” and TCP4/TCP6 coverage when activity mode is selected.
10. Empty-fleet and normalized old-server status show legacy empty-fleet semantics with no invented observer counts. The component may label it “Legacy empty-fleet” or equivalent, but must not imply an observation failure.
11. Initializing and unavailable activity never render “quiet,” “idle,” zero agents, or an automatic-ready message. Available quiet remains a candidate awaiting final fresh sampling and admission, not proof of completed work.
12. Present a persistent, accessible heuristic warning in agent mode: silence does not prove agent completion; measurement covers attributable TCP4/TCP6 only; service-only terminals may still be suspended. Exact prose can be concise, but all three facts must remain perceivable without hover.
13. Map reason codes to concise operator-facing labels/descriptions. Keep mapping exhaustive in one client-side table or function; unknown/malformed codes are rejected by the decoder rather than printed raw.
14. If `armDeadlineMs` is non-null, render the sole countdown derived from it with at most one-second display ticks and clamp at zero. Share the timer with warning elapsed duration as specified below; clear it when neither display needs it. Wall-clock movement is display drift only, never eligibility or another activity deadline.
15. Treat `sampledAtMs` and `lastActivityAtMs` as optional display facts. Invalid dates cannot reach the view through the decoder. Do not use `timestampMs` or sample cadence as a claim freshness check in the browser.
16. Preserve state badges, timing pair, capability, `detail`, touch target/accessibility, and actual fleet counts. Do not replace useful coordinator status with activity-only UI.
17. Preserve force button behavior: automatic `enabled = false` alone does not disable manual force; `handedOff`, actual `handoffActive`, `closing`, `disposing`, and mutation pending still disable it. Agent policy/counts never bypass confirmation.
18. Preserve `ForceSleepDialog` active count as `liveCount + creatingCount + restartPendingCount`. Never substitute `recognizedAgentCount`, `monitoredTerminalCount`, or an activity reason. Preserve force flag, refreshed 409 counts, renewed explicit confirmation, indefinite/timed wake choice, and one POST/no automatic retry.
19. Add no matcher list, matcher editor, per-terminal activity controls, policy toggle, dry-run control, or new mutation route. Startup policy/list remain operator-owned and restart-required.

### API exposure and status-event regressions

20. In `server/src/api/tests.rs`, assert protected GET serializes the exact additive fields for empty-fleet, enabled agent activity, and disabled-but-observing agent activity. Disabled agent mode must remain coordinator `state: "disabled"`, `armDeadlineMs: null`, yet expose live initializing/available/unavailable activity.
21. Assert the coordinator-not-started fallback produced by Phase 05 is contract-complete: empty-fleet returns `activity: null`; agent policy returns a non-quiet object (initializing/reconciling) with unknown counts. It must never infer zero from absence of a coordinator.
22. Preserve cookie/Bearer protection and `Cache-Control: no-store`. Additive status does not weaken auth, CORS/origin behavior for mutations, or cache policy.
23. Assert JSON contains only the allowed warning process projection, not command arguments, matcher lists or private terminal/root/start/socket material. Use explicit forbidden fixture keys/values; no source-text tests. Logs/audits/WebSocket hints must exclude PID and safe identity too.
24. Keep existing `host:idleSuspendChanged` revision-hint + GET refetch flow. No activity payload enters the event. Phase 05 library tests own heartbeat suppression; API/UI tests prove a meaningful hint causes one refetch and a same-revision/live GET can carry fresher display timestamps.
25. Do not expose an activity mutation or policy mutation through `client.ts`, query hooks, WebSocket dispatch, settings, or force dialog.
26. Require `measurementWarning: null` for available measurement and a non-null object for initializing/unavailable. Missing/undefined warning on new agent status is malformed, not old-server compatibility. Initial/not-started reason is `reconciling`; disabled agent mode still displays warnings.
27. Validate warning's closed reason union, nonnegative safe integer epoch-ms `blockedSinceMs` within supported date range, boolean `processesTruncated`, and at most 32 entries sorted by unique positive safe integer PID. Identity is null or a nonempty string of at most 256 UTF-8 bytes without control characters. Never accept command-line fallback or echo malformed payloads in errors.
28. Render a distinct accessible measurement-blocked warning with reason, continuous blocked duration and PID/safe identity examples. Null identity shows “Identity unavailable”; empty examples say attribution is unavailable, never no blockers. Truncation labels examples as incomplete without inventing a total. Render text, not HTML, links, shell commands or remediation controls.
29. Reuse one local display clock while either `armDeadlineMs` or a warning exists; at most one-second ticks, clamp negative elapsed duration to zero, clear on unmount or removal of both. Warning duration is elapsed time, not a second countdown or eligibility decision. Cause/PID changes retain duration from server onset; available recovery removes the warning. No duration-driven GET, event, query invalidation or persistence.
30. Preserve the 900-second default and explicit startup opt-in; warnings introduce no settings or policy editor. The persistent heuristic notice and measurement warning serve different purposes and remain separately perceivable at narrow widths.

## Architecture

### Additive DTO after client normalization

```ts
export type IdleSuspendAutomaticPolicy = "empty-fleet" | "agent-activity";

export type IdleSuspendActivityReasonCode =
  | "recentInput"
  | "recentOutput"
  | "recentNetwork"
  | "agentChanged"
  | "lifecycleBusy"
  | "quiet"
  | "procAccess"
  | "scanLimit"
  | "scanTimeout"
  | "socketDiagnostics"
  | "unsupportedTransport"
  | "namespaceMismatch"
  | "staleObservation"
  | "identityUncertain"
  | "counterOverflow"
  | "reconciling"
  | "epochSpent";

export interface IdleSuspendActivityStatusV1 {
  measurementState: "initializing" | "available" | "unavailable";
  reasonCode: IdleSuspendActivityReasonCode | null;
  recognizedAgentCount: number | null;
  monitoredTerminalCount: number | null;
  sampledAtMs: number | null;
  lastActivityAtMs: number | null;
  networkCoverage: "tcp4-tcp6";
  measurementWarning: IdleSuspendMeasurementWarningV1 | null;
}

export interface IdleSuspendMeasurementWarningV1 {
  reasonCode:
    | "procAccess"
    | "scanLimit"
    | "scanTimeout"
    | "socketDiagnostics"
    | "unsupportedTransport"
    | "namespaceMismatch"
    | "staleObservation"
    | "identityUncertain"
    | "counterOverflow"
    | "reconciling";
  blockedSinceMs: number;
  processes: Array<{ pid: number; executableIdentity: string | null }>;
  processesTruncated: boolean;
}

export interface IdleSuspendStatusV1 {
  // existing v1 fields unchanged
  automaticPolicy: IdleSuspendAutomaticPolicy;
  activity: IdleSuspendActivityStatusV1 | null;
}
```

The server wire contract requires both fields. Only the decoder output treats them as always present because it performs the one allowed old-server normalization.

### Decode and presentation flow

```text
protected GET /api/system/idle-suspend/v1/status
  -> transport returns unknown or rejects
  -> decodeIdleSuspendStatusV1
       ├─ valid new v1 -> exact normalized object
       ├─ valid base v1 + both additive keys absent -> legacy empty-fleet/null
       └─ malformed/partial/fetch error -> reject; React Query error
  -> HostIdleSuspendStatus
       ├─ coordinator state + actual fleet + timing/manual action
       ├─ policy + aggregate activity validity/reason/counts
       ├─ sole armDeadlineMs display countdown
       └─ visible heuristic/TCP-only warning
```

A WebSocket `host:idleSuspendChanged` message remains a revision-only invalidation hint. `use-sse.ts` invalidates the existing query key; the GET remains authoritative. There is no 2-second browser poll or activity event payload.

### Compatibility decision

Chosen: strict decoder with one explicit two-key omission branch. Rejected alternatives:

- Optional fields throughout components: spreads ambiguous fallback logic and easily converts unknown to zero.
- Catch-all legacy fallback: hides failed fetches, auth failures, partial deploys, and malformed new-server responses.
- Version bump/new endpoint: unnecessary for additive backward-compatible server fields; duplicates protected status authority.

## Related code files

Create only if the decoder needs an isolated pure regression surface:

- `packages/ui/src/api/idle-suspend-client.test.ts`: new narrow decoder tests for new payload, exact old-server omission, partial/malformed payload, and no fallback on rejected request. There is no existing `packages/ui/src/api/client.test.ts`; do not claim or create that generic file.

Modify:

- `packages/ui/src/api/client.ts`: exact activity/policy types, strict decoder/normalizer, and `api.system.idleSuspendStatus()` unknown-to-decoded boundary.
- `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`: policy/activity/count/coverage/warning/countdown display; preserve existing coordinator/manual action.
- `packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx`: focused accessible rendering and manual-button regressions.
- `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`: actual Chromium new/old/error/activity/countdown/manual scenarios.
- `server/src/api/tests.rs`: additive protected route, disabled-observer, fallback, no-store/auth/privacy serialization regressions. Production backend DTO changes remain Phase 05-owned.
- `packages/ui/src/api/ws-transport.test.ts`: only if needed to prove the existing route propagates raw success/rejection without a fallback. Do not duplicate pure decoder cases here.
- Existing full startup-config TypeScript declarations, only if implementation finds a true full server config representation. Current `DamHopperConfig` is narrowed to workspace/projects and must remain so.

Inspect, normally unchanged:

- `packages/ui/src/api/queries.ts`: existing query and `retry: false` mutation behavior are sufficient.
- `packages/ui/src/hooks/use-sse.ts`: existing validated revision hint invalidates the exact status query key.
- `packages/ui/src/components/organisms/ForceSleepDialog.tsx`, `packages/ui/src/lib/force-sleep-dialog-utils.ts`, and their tests: regression targets, not activity-display owners.
- `server/src/idle_suspend/status.rs` and `server/src/api/idle_suspend.rs`: Phase 05-owned production DTO and constructor work; Phase 06 does not edit them.

No file deletion. No new endpoint, query store, telemetry, matcher editor, policy mutation, persistence schema, helper protocol, or per-terminal status component.

## Implementation Steps

1. Receive Phase 05's final serialized DTO examples and reason enums. Freeze casing/nullability before editing TypeScript. Reject any implementation drift by correcting the owning phase, not by adding client aliases.
2. In `client.ts`, define exact public types beside existing idle-suspend types, including the bounded measurement warning. Do not import backend-generated types or add a schema library for this decoder.
3. Factor small local guards for plain object, closed strings, nullable nonnegative safe integers, fleet snapshot, outcome, and activity object. Validate observable contract rather than every harmless unknown additive property; preserve forward-compatible extra keys while rejecting wrong required fields.
4. Implement `decodeIdleSuspendStatusV1(value: unknown)`. Validate base v1 first. Use own-property checks for the two additive fields. Normalize only when both are absent; reject XOR absence and malformed/policy-inconsistent pairs.
5. Change only `api.system.idleSuspendStatus` to invoke `unknown` and pass the response through the decoder. Let transport/auth/network rejection propagate. Produce one actionable invalid-response error without echoing server payload or secrets.
6. Add `idle-suspend-client.test.ts` if isolated decoder tests are clearer than extending a nearby existing API test. Cover valid new agent state, valid new empty-fleet, valid old omission, one-key omission, malformed enum/count/timestamp/coverage/policy relationship, and rejected fetch. Avoid tests that merely restate interfaces.
7. Extend `HostIdleSuspendStatus` with an exhaustive reason presentation helper. Render policy and activity independently from coordinator state. Use semantic labels/`aria-live` only for genuinely changing countdown/status content; avoid announcing the entire card every second.
8. Add one shared one-second display clock while a deadline or measurement warning exists. Compute the sole deadline countdown and separately elapsed blocked duration, clamp at zero, clear on cleanup, and never write eligibility/query state from the timer.
9. Add the visible heuristic warning and TCP4/TCP6 coverage. Show unknown counts literally. Keep available/quiet wording conditional and cautious; final-check remains visible through the existing coordinator badge.
10. Preserve all existing fleet/timing/capability/detail/manual button behavior. Explicitly review disabled agent-policy state: observer facts display, no countdown, force action stays available unless existing lifecycle/handoff/pending gates block it.
11. Review `ForceSleepDialog` and `getActiveSessionCount`; no activity field may enter force computation. Add a regression only if component changes could plausibly route recognized counts into manual confirmation. Keep exact one mutation call and conflict re-confirmation.
12. Add backend API tests against the Axum router for exact camelCase fields, policy/null relationship, disabled observer, coordinator-not-started fallback, auth/no-store, nullable unknown counts, and prohibited private data. Consume Phase 05 constructors; do not reconstruct a second status model in the handler.
13. Keep event behavior unchanged in the client. Add/adjust `use-sse` or transport tests only for meaningful revision refetch behavior that is not already covered. No heartbeat event payload, status polling, or timestamp-driven invalidation.
14. Extend `HostIdleSuspendStatus.test.tsx` with behavior cases: empty-fleet/legacy; agent initializing; available with counts; unavailable with unknown counts; quiet/epoch spent; sole deadline; disabled-but-observing; error. Assert accessible labels/facts, not CSS classes or incidental sentence punctuation.
15. Extend the existing Chromium file. In real Chromium, render new-server states, old-server-normalized state, malformed/fetch-error state, active deadline, and manual dialog under agent mode. Exercise pointer and keyboard interaction. Assert real fleet confirmation and exactly one force mutation remain unchanged.
16. Review browser layout at narrow and normal widths using the actual rendered surface. Ensure warning, unknown labels, countdown, and force action are not clipped, hover-only, color-only, or inaccessible. A static markup snapshot is not acceptance proof.
17. Hand Phase 07 exact commands and scenario names. Phase 07 runs integrated backend/UI gates once and uses the public status with a real observer; private scripted observer injection never moves into an external integration test.
18. After browser smoke proof, remove only disposable screenshots/fixture scripts. Keep the narrow decoder test and behavior/browser regressions because they defend compatibility and safety contracts.
19. Decode warning nullability, reason, timestamp, entry count/order/PID domains, UTF-8 identity bound/control rejection and truncation. Keep absent nested warning an error on new agent status; preserve only the existing two-top-level-fields-absent legacy normalization.
20. Exercise actual Chromium warning transitions: known PID/identity, null identity, global empty examples, truncated list, changing cause/PID with continuous duration, recovery removal and disabled observation. Include narrow layout/keyboard/accessibility and prove timer ticks make no requests or force-count changes.

## Todo list

- [x] Freeze additive DTO casing, enum, and nullability with Phase 05.
- [x] Add strict new-server decoding and exact old-server normalization.
- [x] Keep malformed/partial/fetch failures as errors, never zero/quiet.
- [x] Render policy, validity, reason, counts, coverage, and one countdown.
- [x] Add visible heuristic and TCP-only limitations.
- [x] Preserve actual fleet counts and manual force behavior.
- [x] Keep matcher configuration out of UI/API mutation surfaces.
- [x] Add protected API/no-store/privacy regressions.
- [x] Add focused component and actual Chromium behavior coverage.
- [x] Verify disabled agent mode observes only and has no automatic countdown.
- [x] Remove disposable browser artifacts after proof.
- [x] Validate required warning shape and fail malformed new-server warnings.
- [x] Render safe blocker examples and continuous duration without polling or new authority.

## Success Criteria

- A valid new-server status decodes only with exact policy/activity relationships. Unknown numeric values are nullable and render “Unknown,” never zero.
- An otherwise valid old-server v1 payload with both additive properties omitted renders legacy empty-fleet semantics. Partial omission, malformed new data, auth/network failure, and invalid base payload render unavailable/error instead of fallback.
- Agent mode visibly separates coordinator state from activity validity, shows recognized/monitored counts, reason, and `tcp4-tcp6`, and never calls quiet “finished.”
- `armDeadlineMs` is the only countdown. Display ticks cause no API calls, status revisions, or eligibility decisions and stop on unmount.
- Disabled agent mode can display observation status while remaining `disabled` with no deadline and zero automatic executor authority.
- Live/creating/restarting counts remain the numbers in the card and manual confirmation. Recognized counts cannot reduce confirmation; manual indefinite/timed selection, force flag, 409 refresh/re-confirmation, one POST/no retry, and handoff disablement remain intact.
- Authenticated/no-store JSON includes required warning fields and only permitted PID/safe identity examples. No arguments, matcher lists, terminal/session/root/start/socket IDs, addresses, tokens, env, output or counters leak; log/audit/WS captures exclude process warning details.
- Unchanged sample heartbeats do not produce WebSocket hint/refetch noise; meaningful revision hints still refetch the existing protected GET.
- Existing component test covers semantic states. Actual Chromium proves visible/accessibility behavior and manual interaction; static server rendering alone is insufficient.
- No matcher UI, policy mutation, per-terminal controls, new endpoint, new telemetry, or alternate client store ships.
- Known, unknown and truncated warning examples render honestly; cause/PID changes preserve duration, complete recovery removes warning, and disabled/not-started cases remain conservative. Missing/malformed new warning data errors rather than silently downgrading.

Future focused commands from repository root, after Phase 05/06 changes integrate:

```sh
cargo test --manifest-path server/Cargo.toml --lib api::tests::idle_suspend
pnpm --filter @dam-hopper/ui test -- idle-suspend-client.test.ts HostIdleSuspendStatus.test.tsx ForceSleepDialog.test.tsx
pnpm --filter @dam-hopper/ui test:browser -- idle-suspend-settings-status.browser.tsx
```

The implementation owner must verify each filter executes at least one intended test. The browser command uses the repository's `packages/ui/vitest.browser.config.ts` Playwright/Chromium provider and is the required actual-surface proof. Phase 07 owns aggregate commands and authenticated disabled-policy UAT; no validation command has been run by this planning phase.

## Risk Assessment

| Risk                                              | Impact                    | Mitigation                                                                                 |
| ------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| Optional chaining turns unknown into zero         | Critical false confidence | Normalize once at strict decoder; nullable counts render “Unknown”                         |
| Catch-all compatibility hides outage/auth failure | High                      | Old fallback only when both own properties are absent from valid base v1                   |
| Coordinator and measurement states conflated      | High                      | Separate labeled rows; explicit initializing/unavailable/quiet semantics                   |
| Browser invents a second deadline                 | High                      | Only `armDeadlineMs`; sample timestamps display-only                                       |
| Countdown timer causes request/event churn        | Medium                    | Local 1s display tick; no query invalidation or status mutation                            |
| Recognized count weakens manual confirmation      | Critical                  | Force dialog continues summing actual fleet counts only                                    |
| Warning hidden on small screen/hover              | High                      | Persistent accessible text; Chromium narrow-width review                                   |
| Client accepts privacy-bearing data               | High                      | Bounded warning-only identity projection, generic errors and negative serialization checks |
| Broad config type accidentally exposes matchers   | High                      | Preserve narrowed `DamHopperConfig`; no editor/mutation route                              |
| Tests assert static text rather than behavior     | Medium                    | Accessible state/count/error/manual assertions plus Chromium interaction                   |

## Security Considerations

- Protected GET authentication and `Cache-Control: no-store` remain unchanged. The browser does not persist status or activity payload in local storage.
- Decoder errors must not stringify the rejected payload; it may contain unexpected private material. Report a generic invalid-response error.
- Only protected warning UI exposes PID and qualified safe identity as escaped text, including its accessible labels. No command arguments, matcher lists, private terminal/root/start/socket IDs, addresses, output or tokens. Do not put warning details in console logs, analytics, local storage or exported reports; qualification artifacts use synthetic/redacted identities.
- Activity mode is a heuristic, not an authorization boundary. Browser status cannot admit automatic or manual handoff; server claim remains authoritative.
- Manual force retains existing enabled-account, auth, origin, audit, helper, lifecycle and explicit-confirmation gates. Automatic policy must never route through or relax the forced claim.
- A stale browser can show an old state. Server rejects input/create/restart and duplicate/manual handoff according to current manager state; UI disablement is convenience, never safety authority.

## Next steps

1. Phase 07 consumes the frozen decoder and view and proves public status through real observer/API paths, not injected private observer types.
2. Run actual Chromium status/manual tests and a separate authenticated disabled-policy browser UAT with automatic execution impossible.
3. Phase 08 documents exact payload, unknown/legacy semantics, heuristic limits, no matcher UI, and observation-only rollout only after evidence exists.

## Unresolved questions

- No product choice blocks implementation. A genuine full startup-config TypeScript DTO was not found in the current UI search; if one appears during implementation, mirror `automaticPolicy`/`agentExecutables` there as read/config data without adding matcher UI. Do not widen the existing workspace/project-only `DamHopperConfig` speculatively.
- Exact compact reason prose and countdown formatting need UI review in real Chromium, but enum mapping, warning facts, unknown handling, and sole-deadline behavior are fixed.
