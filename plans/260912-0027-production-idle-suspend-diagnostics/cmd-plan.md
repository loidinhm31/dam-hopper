# Command entry: production idle-suspend diagnostics

Implement from [plan.md](plan.md), using [design-contract.md](design-contract.md) as the normative architecture contract. Execute Phases [01](phase-01-freeze-architecture-contracts.md) → [02](phase-02-canonical-event-foundation.md) → [03](phase-03-server-coordinator-instrumentation.md) → [04](phase-04-helper-milestone-enrichment.md) → [05](phase-05-bundle-correlation-engine.md) → [06](phase-06-linux-cli-integration.md) → [07](phase-07-security-verification-rollout.md) in order.

Outcome: `dam-hopper diagnose --json` creates one bounded, redacted, atomic local JSON bundle; stdout contains only its absolute path. Root attempts full evidence. Non-root never escalates and returns a valid explicit partial bundle when helper evidence is inaccessible.

Hard boundaries: planning contract only until Phase 01 approval; no observer daemon, telemetry/UI/upload, external credentials, terminal content, arbitrary command/path/source option, public cap tuning, new unit, or default suspend-policy change.

Unresolved questions: none; contract-gate failures return to Phase 01.
