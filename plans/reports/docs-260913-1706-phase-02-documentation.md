# Phase 02 Documentation Review

**Date:** 2026-09-13 17:06
**Scope:** Canonical idle-suspend event writer, identity, sequence, and correlation foundation
**Owner:** Documentation review

## Current state assessment

Phase 02 now has a documented, isolated producer foundation in
`server/src/idle_suspend/event.rs`, re-exported by
`server/src/idle_suspend/mod.rs`. The implementation provides the closed
`IdleSuspendEventEnvelopeV1` model, typed payload validation, boot/process
identity, UUID v4 action correlation, checked producer sequencing, and a
bounded mode-`0600` no-follow synchronized JSONL writer. The coordinator does
not yet construct or emit semantic events; helper-v2 evolution, collection,
bundle output, and rollout remain later phases.

Before this review, the live architecture and design contract described all
runtime diagnostics as planned. That wording was stale for the Phase 02
producer and could imply that the implementation also shipped coordinator
instrumentation or a collector. The updated documentation separates the
implemented foundation from the still-planned end-to-end diagnostics product.

## Changes made

- `docs/system-architecture.md`
  - Marked the Phase 02 canonical event foundation implemented on 2026-09-13.
  - Added the verified event/identity/sequence/correlation/writer behavior and
    explicit no-coordinator-integration boundary.
  - Kept the collector, helper instrumentation, bundle, and rollout contract
    planned for Phases 03–07.
  - Corrected the closing compatibility/rollback status wording.
- `plans/260912-0027-production-idle-suspend-diagnostics/design-contract.md`
  - Updated status from “runtime code not yet changed.”
  - Added a Phase 02 implementation disposition and corrected fixed-path and
    completion wording.
  - Kept the contract’s normative schema, security, privacy, and rollout rules.
- `plans/260912-0027-production-idle-suspend-diagnostics/phase-01-freeze-architecture-contracts.md`
  - Recorded that Phase 02 is complete and changed the next-step/risk language
    to distinguish implemented producer code from future collector work.
- `docs/codebase-summary.md`
  - Regenerated as a concise 161-line summary from the Repomix compaction.
  - Added the current repository shape, idle-suspend module map, Phase 02
    behavior, verification map, and documentation links.
- `docs/project-overview-pdr.md`
  - Added PR-018 for production idle-suspend diagnostics with Phase 01/02
    acceptance state, scope, non-goals, and later-phase gates.
- `docs/code-standards.md`
  - Added canonical event writer rules for closed payloads, identity,
    correlation, sequence consumption, file safety, synchronization, and
    deterministic tests.
- `docs/README.md`
  - Added a discoverable Phase 02 diagnostics status and plan link.
- `docs/terminal-idle-suspend-security.md`
  - Added the separate semantic event stream security and durability rules.
- `docs/configuration-guide.md`
  - Documented that the Phase 02 event path is fixed/internal and has no config
    key or public path override.
- `docs/api-reference.md`
  - Clarified that the existing browser diagnostics export is separate from
    the internal Phase 02 event writer and exposes no new route.
- `docs/linux-systemd.md`
  - Documented that the event stream adds no unit or `StateDirectory=` and is
    not an API/helper startup gate.
- `docs/linux-release-manager.md`
  - Clarified that API runtime provisioning does not create or repair the
    Phase 02 diagnostics parent or event file.

Project Manager separately updated `docs/project-roadmap.md` and
`docs/CHANGELOG.md` with the Phase 02 completion entry; those files were not
edited in this documentation pass.

## Repomix evidence

Ran:

```text
repomix -o ./repomix-output.xml
```

Repomix v1.18.0 reported 1,841 files, 4,022,265 tokens, and 16,575,377
characters. Five security-flagged files were excluded by its scanner. The
compaction remains a read-only analysis aid and is not a source of runtime
truth.

## Validation

The repository-local validator path from the task was absent:

```text
node .omp/evcrate/scripts/validate-docs.cjs docs/
```

The fallback validator was run successfully:

```text
node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/
```

Results: 27 files checked, 259 internal links verified, and no broken internal
links reported. The validator emitted its existing broad warnings (1,056 code
reference warnings and 296 config-key warnings), mostly from historical
changelog and documentation terminology; these are warnings, not failures.
No formatter, linter, project-wide build, or project-wide test suite was run.

## Size metrics

`docs.maxLoc` is 800 lines. The regenerated `docs/codebase-summary.md` is below
that limit. The repository already contains several larger legacy documents,
and this pass added focused sections without a broad content migration:

| File | LOC | Over 800 |
| --- | ---: | ---: |
| `docs/system-architecture.md` | 4,075 | 3,275 |
| `docs/api-reference.md` | 2,285 | 1,485 |
| `docs/code-standards.md` | 1,487 | 687 |
| `docs/frontend-components.md` | 1,244 | 444 |
| `docs/configuration-guide.md` | 1,125 | 325 |
| `docs/project-overview-pdr.md` | 1,170 | 370 |

The remaining docs are at or below 800 lines. Splitting the pre-existing large
files would be a separate navigation-preserving documentation refactor.

## Gaps and recommendations

1. **High:** Implement and document Phase 03 coordinator lifecycle emission;
   do not claim semantic event history until the writer is constructed and
   called at the frozen boundaries.
2. **High:** Keep the design contract and live architecture synchronized when
   helper audit v2, collector correlation, redaction, or bundle output lands.
3. **Medium:** Split the oversized architecture, API, standards,
   configuration, PDR, and frontend documents into topic indexes and linked
   parts while preserving existing anchors. This is intentionally not folded
   into the Phase 02 reference update.
4. **Low:** Add or restore the repository-local `validate-docs.cjs` wrapper so
   the documented validation command works without fallback-path knowledge.

## Unresolved questions

- Should the pre-existing documents over `docs.maxLoc` be split in a dedicated
  documentation refactor, or remain as legacy monoliths for now?
- When Phase 03 provisions/coordinator-wires the semantic stream, will the
  fixed diagnostics-parent ownership table require an implementation-specific
  update, or will the existing release/runtime authority remain unchanged?
