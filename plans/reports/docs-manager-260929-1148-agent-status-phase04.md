# Documentation Update Report — Phase 04 Native Event Adapters

## Current State Assessment

Phase 04 Codex/Claude adapters are documented as implemented from static provider event inventories; live native lifecycle behavior remains unqualified. Phase 05 Settings/notification cutover and Phase 06 Linux live qualification remain pending.

## Changes Made

- Updated `docs/architecture/agent-status.md` with adapter allowlists, private ingress normalization and identity checks, privacy bounds, Codex/Claude mappings, continuation/Stop behavior, parallel blocker correlation, and subagent rejection.
- Updated the `docs/README.md` agent-status entry so the new native-adapter material is discoverable.

## Gaps Identified

- No live native Codex or Claude turns have been qualified; documented target versions are not runtime compatibility promises.
- Settings/notification cutover and provider live qualification remain tracked gates, not delivered behavior.
- Documentation coverage percentage and update frequency are not measured by this scoped change.

## Recommendations

1. Complete the Phase 05 settings and notification cutover, including legacy Codex OSC 9 removal.
2. Use Phase 06 to qualify real provider callbacks, continuation, Escape gaps, parallel blockers, subagent isolation, and user-hook coexistence before claiming live readiness.

## Metrics and Validation

- Updated files: 2. `agent-status.md`: 411 LOC; `README.md`: 473 LOC (both under the 800-LOC target).
- Documentation validator: 42 files scanned; 759 internal links reported working. Scoped architecture scan: 49 internal links working; no broken links reported.
- The validator emitted warn-only code-reference/config-key heuristics (109/61 in the scoped architecture scan; 1,461/372 across `docs/`). The new adapter names, implementation paths, and plan links were checked against source and plan files; remaining heuristics were not treated as proof of missing symbols or configuration.
- The repository-local `.omp/evcrate/scripts/validate-docs.cjs` was absent; validation used the available `~/.omp/agent/evcrate/scripts/validate-docs.cjs`.
- No code tests or builds were run for this documentation-only change.
