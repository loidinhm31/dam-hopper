# Phase 01 — Freeze wire types and executable contract vectors

Priority: P2. Status: completed. Owner: **Contract owner (sequential prerequisite)**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

Read contracts.md S1–S12 and all three evidence reports. Current ApiClient exposes owner+transport; Rust snake_case modules, TypeScript feature-only DTOs. Installed OMP lifecycle source is applicable18.13.3, not a runtime qualification receipt.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. Freeze exact endpoints, prepared/activation/receipt failure transitions, root authority, retained-terminal expiry and current-revision semantics before independent consumers. DTOs are real types/decoders/constants, no fake service methods.

## Architecture and boundaries

Freeze modifies lib.rs and creates a types-only session_changes/mod.rs declaring types.rs plus cfg(test) types_tests.rs; Rust vector tests compile/run now without the engine. Engine later modifies lib.rs/mod.rs through the existing hard dependency. Feature-only TS schema is consumed by client/adapter tests. Wire fixtures are read-only to every later task. No global ownership.ts or semantic status schema extension.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `freeze-session-contract` — Contract owner (sequential prerequisite)

- Modify `/home/loidinh/WS/dam-hopper/server/src/lib.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/mod.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/types.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/types_tests.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-types.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/api/session-changes-types.test.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/tests/fixtures/session-changes-wire.json` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `freeze-session-contract`

1. Register the real types-only module in lib.rs/mod.rs and add runnable Rust types_tests.rs using shared vectors, including a contract_round_trip_smoke test; no service stubs or dead-code suppression. Translate every DTO/error/resource constant in contracts S1–S9 into serde-compatible Rust definitions and bounded TS discriminated-union decoder. Keep producer wire self-contained for bundled standalone adapter; no production import from UI into server asset.
2. Create shared valid/invalid JSON vectors for prepared/existing/activation/receipt/fail/settled, capture-vs-lookup lifecycle eligibility, selector/status/coverage, empty-vs-absent detail, revision >2^53, stale revision, identity mismatch, private fromNow lookup/adoption, historical absence provenance/root budgets and unsupported content. Include valid fromNow ready/incomplete, invalid fromNow+received/sessionStart-ready+notApplicable/null-ready, and truncated namespace-proof vectors. Record cross-field invariants: sessionStart ready/incomplete requires received; fromNow ready/incomplete requires notApplicable, with no first-turn claim; invalid cross-origin combinations rejected, no capture for resume/persisted/unknown initial identity, no complete original after gap, fromNow origin explicit. Include explicit control-only mapping from existing semantic ended/interrupted/error/unknown outcomes; semantic schema unchanged.
3. Exercise decoder vector tests in future verification; successful local Rust/TS compile, vector tests, executable contract smoke and independent review gate evidence-backed completion before engine/adapter/client work. Confirm no new dependency, flag, listener or scheduler needed; unresolved secure-read or liveness feasibility stops downstream scheduling.

Success criteria: Compiling types-only Rust/TS contract unit and shared positive/negative vectors agree on origin-qualified acknowledgment, bounded root/absence provenance and fromNow lookup/adoption. Consumers can work from exact types without pending TS schema; no runtime stubs, deployed claims or mutation capabilities.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "freeze-session-contract",
    "title": "Implement frozen DTOs, bounds and wire vectors",
    "blocked_by": [],
    "allowed_files": [
      "server/src/lib.rs",
      "server/src/session_changes/mod.rs",
      "server/src/session_changes/types.rs",
      "server/src/session_changes/types_tests.rs",
      "packages/ui/src/api/session-changes-types.ts",
      "packages/ui/src/api/session-changes-types.test.ts",
      "server/tests/fixtures/session-changes-wire.json"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "Compiling types-only Rust/TS contract unit and shared positive/negative vectors agree on origin-qualified acknowledgment, bounded root/absence provenance and fromNow lookup/adoption.",
      "Consumers can work from exact types without pending TS schema; no runtime stubs, deployed claims or mutation capabilities."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib; pnpm --filter @dam-hopper/ui build.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::types_tests; pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-types.test.ts.",
      "Local smoke before completion: Execute contract_round_trip_smoke in types_tests.rs plus TS vector round-trip scenario; real serialization/decoding, no service/engine descendant.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:freeze-session-contract --> Implement frozen DTOs, bounds and wire vectors

## Verification and evidence

All prerequisite checks **completed and verified**:
- `cargo check --manifest-path server/Cargo.toml --lib`: Clean pass.
- `cargo test --manifest-path server/Cargo.toml --lib session_changes::types_tests`: 5 passed, 0 failed (`test_fixture_parses`, `test_valid_prepare_request`, `test_valid_prepared_receipt`, `test_invalid_status_invariants`, `test_valid_status_invariants`, `test_valid_lookup_result_discriminated`, `contract_round_trip_smoke`).
- `pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-types.test.ts`: Passed.
- Wire vectors in `server/tests/fixtures/session-changes-wire.json` and TypeScript types in `session-changes-types.ts` verified and frozen.

### `freeze-session-contract` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib; pnpm --filter @dam-hopper/ui build.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::types_tests; pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-types.test.ts.
- Local smoke before completion: Execute contract_round_trip_smoke in types_tests.rs plus TS vector round-trip scenario; real serialization/decoding, no service/engine descendant.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

Protocol mistake propagates widely. Freeze output first; no consumer starts while contract owner revises. Only synthetic bytes/IDs in fixtures; no secrets or absolute user paths. Rollback removes unconsumed types/vectors; no live runtime or database effects.

## Next gate

Gate G1: **PASSED**. Compiling registered Rust/TS types, valid/invalid origin/provenance/adoption vectors, local contract smoke and independent review evidenced.

## Unresolved questions

None. Phase 01 completed.
