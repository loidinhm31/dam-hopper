# Phase 03 Documentation Update

## Current State Assessment

Phase 03 process discovery is implemented and reviewed. The private
`ProcessDiscovery<S>` engine now has a documented `ProcessSource`/`LinuxProcSource`
seam, exact identity-safe lineage attribution, finite executable matching,
namespace-qualified socket ownership, and explicit completeness bounds. Public
API and automatic suspend-claim documentation correctly remains deferred to
later TCP/sampler phases.

## Changes Made

- Added `docs/agent-activity-process-discovery.md` as the canonical implementation
  guide: source methods, observation flow, identity/reparenting rules, matcher
  grammar, bounds, failure evidence, privacy limits, and verification commands.
- Updated README, PTY observation, system architecture, code standards, PDR,
  configuration, API reference, security, roadmap, changelog, and codebase
  summary references to reflect Phase 03.
- Added the new guide to documentation navigation and codebase/module maps.
- Regenerated `repomix-output.xml` and refreshed `docs/codebase-summary.md` with
  Repomix v1.18.0 statistics.

## Gaps Identified

- TCP observation, sampler/coordinator integration, protected warning/status
  projection, and automatic `agent-activity` eligibility remain future phases.
- Existing large documents (`system-architecture.md`, `api-reference.md`,
  `code-standards.md`, and related files) predate the 800-line target; the new
  canonical guide is modular and 209 lines, while `codebase-summary.md` remains
  797 lines.

## Recommendations

1. Update the canonical guide and cross-references when Phase 04 freezes its
   typed socket-counter contract.
2. Re-run documentation validation after Phase 05 integrates the final claim
   and warning DTO; keep private evidence boundaries explicit.
3. Split the pre-existing oversized reference documents at their next major
   edit rather than expanding them indefinitely.

## Metrics

- Repomix: 1,790 files, 3,798,285 tokens, 15,533,295 characters; five
  security-flagged files excluded.
- Focused command
  `cargo test --manifest-path server/Cargo.toml idle_suspend::activity::process::tests`:
  18/18 passed.
- Process-discovery filter
  `cargo test --manifest-path server/Cargo.toml process_discovery`: completed
  without failures.
- Documentation validator fallback
  `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`: 221 internal
  links verified; broad existing heuristics reported 956 code-reference and
  242 config-key warnings.

## Unresolved Questions

- None blocking Phase 03 documentation. The repository validator's warning
  counts are broad heuristic findings (including newly documented trait/type
  names); those names were verified directly against the source and all
  internal links passed.
