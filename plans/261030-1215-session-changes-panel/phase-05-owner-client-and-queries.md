# Phase 05 — Implement owner-bound transport and revision-safe queries

Priority: P2. Status: completed. Owner: **Feature client owner**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

contracts S3,S5,S7,S9; UI evidence and client.ts:3849-3851, connections.ts:663-695, ws-transport.ts:2973-3037. Transport invoke maps named channels to authenticated REST; no generic client request exists.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. Use feature-only client bound to captured ApiClient owner and transport. Fence profile/generation/incarnation/session/root/epoch/baseline/revision and request ordering; no ambient API, local persistence or HEAD query reuse.

## Architecture and boundaries

Add only five feature channel mappings in existing ws-transport; no new required transport operation/ApiClient methods/global ownership types. Query keys use profileQueryKey, exact source identity and decimal revision comparator.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `query-session-changes` — Feature client owner

- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.ts` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.test.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-client.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-client.test.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-queries.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-queries.test.tsx` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `query-session-changes`

1. Implement typed feature client using captured ApiClient.transport.invoke and literal S9 channels; extend endpoint mapping only. Encode IDs safely, retain auth/abort/timeout semantics and typed code/currentRevision errors; feature requests use no-store cache mode where transport permits per-channel policy.
2. Decode exact S3 origin-qualified states: fromNow ready/incomplete uses notApplicable and no first-turn claim, original sessionStart requires received; reject cross-origin receipt fabrication. Expose absenceProofComplete/provenanceEntries and per-row originalProvenance honestly. Expose status/retained selector, explicit from-now, refresh, page and detail operations with schema validation and owner check before/after await. Wrong generation rejected even if request succeeds on old server.
3. Build feature query keys with complete identity and pinned revision; compare decimal revisions correctly above2^53. Stale status/list/detail promises cannot overwrite newer selection or revision. Typed refreshRequired invalidates old view rather than combining counts/content.
4. Coalesce visible invalidations/manual refresh; hidden state performs no source polling. Open/reconnect always authoritative reconciliation. Purge source cache on close/owner invalidation; abort in-flight work and never store source in browser persistence.
5. Add transport URL/auth/error/abort tests and client/query tests across two profiles, generation rollover, identical terminal IDs, session/root swaps, lost settled hints, old status races, pagination, unsupported details, ignored-to-eligible unknown/null provenance, truncated proof and from-now user-only intent with valid notApplicable/invalid received combinations.

Success criteria: AC4/5: every request and result is fenced to exact owner and revision; unavailable/missing differs from empty diff. Independent client ready after frozen TS types; no producer authority granted to browser project fields or mutating Git API reuse. Origin-qualified status decoding accepts legitimate fromNow notApplicable and rejects invalid combinations; historical absence/coverage never inferred from eligible-list completeness.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "query-session-changes",
    "title": "Add feature client channels decoders and bounded query state",
    "blocked_by": [
      "freeze-session-contract"
    ],
    "allowed_files": [
      "packages/ui/src/api/ws-transport.ts",
      "packages/ui/src/api/ws-transport.test.ts",
      "packages/ui/src/api/session-changes-client.ts",
      "packages/ui/src/api/session-changes-client.test.ts",
      "packages/ui/src/api/session-changes-queries.ts",
      "packages/ui/src/api/session-changes-queries.test.tsx"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC4/5: every request and result is fenced to exact owner and revision; unavailable/missing differs from empty diff.",
      "Independent client ready after frozen TS types; no producer authority granted to browser project fields or mutating Git API reuse.",
      "Origin-qualified status decoding accepts legitimate fromNow notApplicable and rejects invalid combinations; historical absence/coverage never inferred from eligible-list completeness."
    ],
    "verification": [
      "Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build.",
      "Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/api/ws-transport.test.ts.",
      "Local smoke before completion: Exercise captured owner transport request/response with two profiles, fromNow notApplicable and absenceUnknown metadata plus stale revision; unfinished server may be a boundary double, not claimed live API.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:query-session-changes --> Add feature client channels decoders and bounded query state

## Verification and evidence

All prerequisite checks **completed and verified**:
- `pnpm --filter @dam-hopper/ui build`: Clean compilation.
- `pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/api/ws-transport.test.ts`: Passed.
- Transport channel invocation, decimal revision fencing, and query cache isolation verified.
- Carried hardening items recorded: forwarding `rootId` through client query parameters.

### `query-session-changes` local completion gate

- Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build.
- Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/api/ws-transport.test.ts.
- Local smoke before completion: Exercise captured owner transport request/response with two profiles, fromNow notApplicable and absenceUnknown metadata plus stale revision; unfinished server may be a boundary double, not claimed live API.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

Only this owner edits ws-transport during client work; conflict-resolver concurrent transport work must be serialized. Abort does not revoke server original; close purges UI bytes only. Rollback removes feature channels/client/query modules together, leaves existing API/transport intact.

## Next gate

Gate G5: **PASSED**. Client channels, types decoders, and query hooks verified with clean build and passing tests.

## Unresolved questions

None. Phase 05 completed; carried hardening items tracked in plan.md.
