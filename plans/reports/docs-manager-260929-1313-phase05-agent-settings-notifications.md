# Documentation Update Report — Phase 05 Agent Settings and Notification Ownership

## Current State Assessment

Phase 05 documentation now describes Agent Settings as the owner of per-profile OMP, Codex, and Claude paths and native hook management, with installation and readiness shown separately. It records Codex as status-only, Claude as qualified needs-attention-only, OMP behavior as unchanged, and Codex OSC 9 handling and automatic TUI notification-setting writes as removed. Phase 06 live native-provider qualification remains pending; no live-provider qualification is claimed here.

The current 2026-09-29 changelog and roadmap entries record Phase 05 completion, 2,383 passing tests, and a 9.2/10 review. The changelog explicitly marks the 2026-09-28 Codex `config.toml` alert gate as historical and superseded.

## Changes Made

- Updated `docs/architecture/agent-status.md` with completed Phase 05 status, notification policy, Agent Settings path eligibility, hook readiness, and the remaining Phase 06 qualification boundary.
- Updated `docs/configuration-guide.md` with version-2 notification policy and migration behavior, profile-owned Agent Settings paths, install/readiness distinction, and Codex/Claude notification eligibility.
- Split server-owned settings and deployment material from the project/UI guide into `docs/configuration/server-configuration.md`; added `docs/configuration/index.md` as navigation. Repaired relative links in the moved file and redirected inbound section links to their new location.
- Updated `docs/api-reference.md` to distinguish the qualified OMP-first track from the completed Codex/Claude settings cutover and pending native-provider qualification.
- Updated `docs/code-standards.md`, `docs/system-architecture.md`, `docs/frontend-components.md`, `docs/frontend-components/terminal-and-ide.md`, and `docs/ws-protocol-guide.md` to describe semantic status/attention delivery and remove obsolete claims that terminal output or OSC 9 owns Codex notification delivery.
- Updated `docs/codebase-summary.md` from the generated `repomix-output.xml` compaction, and refreshed `docs/README.md` discovery/navigation. Added Phase 05 requirements and acceptance criteria to `docs/project-overview-pdr.md`. Updated cross-references in `docs/phase-01-auth-state-cryptography-and-policy.md` and `docs/architecture/plugin-platform-d05.md` to target the split server configuration guide.
- The project-manager-owned changelog and roadmap were left to their owner; their current Phase 05 entries and historical-gate clarification were checked.

## Gaps Identified

- Phase 06 live Linux/native-provider lifecycle qualification is still pending. Documentation preserves that qualification boundary.
- The documentation validator reports warn-only code-reference and environment/config-key heuristics. Its full-doc scan reported 1,445 code-reference and 339 config-key warnings; scoped scans reported additional warnings in the nested architecture, frontend-components, and configuration directories. These heuristic warnings are not broken-link findings, but deserve separate triage against source and the appropriate configuration references.
- Several pre-existing guides remain above the 800-LOC target and merit separate topic splits: `docs/system-architecture.md` (5,363 LOC), `docs/code-standards.md` (2,481), `docs/api-reference.md` (2,700), and `docs/project-overview-pdr.md` (2,200). This Phase 05 update split the configuration guide without broad unrelated restructures.
- Repository-wide documentation coverage and historical update frequency are not tracked by a canonical inventory, so no defensible global percentage or cadence can be reported.

## Recommendations

1. Complete Phase 06 live provider qualification before describing Codex/Claude lifecycle behavior as runtime-qualified.
2. Triage documentation-validator code/config warnings separately; retain source-backed detail and avoid adding project-specific names to `.env.example` solely to quiet the heuristic.
3. Split the remaining oversized architecture, standards, API, and PDR guides into topic files with stable navigation and repaired inbound links.
4. Establish a documentation inventory if a repository-wide coverage percentage or update-frequency metric is required.

## Metrics and Validation

- Documentation files updated or created: 15 (13 existing documents updated; two configuration navigation/reference files added). Generated compaction: `repomix-output.xml` packed 2,401 files; 5 suspicious files were excluded. `docs/codebase-summary.md` is 798 LOC.
- Configuration split sizes: `docs/configuration-guide.md` 708 LOC; `docs/configuration/server-configuration.md` 767 LOC; `docs/configuration/index.md` 10 LOC. `docs/architecture/agent-status.md` is 409 LOC.
- `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/` checked 42 top-level docs and reported 764 working internal links. Scoped validation checked 10 nested docs (`docs/configuration`, `docs/architecture`, and `docs/frontend-components`) and reported 74 working internal links (838 across the scans). No broken internal file links were reported.
- The scoped validator warnings include code-reference and configuration-key heuristics; the full scan is warn-only. Phase 05-specific source paths, behavior, and links were reviewed against the implementation and current architecture documentation.
- No project-wide code tests, builds, or linters were run for this documentation-only change. Phase 05’s 2,383-test result is cited from the current changelog, not rerun here.
