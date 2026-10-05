# Documentation update integration contract

## Scope

Documentation only. No application code, manifests, tests, validators, or runtime configuration changes. `docs/` is the maintained documentation source of truth; root `README.md` is the concise entry point. Recent user changes must be preserved or reconciled against current-source evidence, not overwritten from memory.

## Required outputs

Update root `README.md` (<300 lines), `docs/project-overview-pdr.md`, `docs/codebase-summary.md`, `docs/code-standards.md`, `docs/system-architecture.md`, `docs/project-roadmap.md`, and the documentation index. Evaluate/update existing `docs/deployment-guide.md`. Evaluate design documentation; do not invent design requirements or create a redundant guide without evidence.

Restructure all seven root `phase-*.md` documents into descriptive purpose-based maintained references. Preserve their unique security, ownership, persistence, and operational contracts; remove phase-progress narration from current references. Update every incoming relative link and outgoing relative/source path when moving documents. No redirect stubs or obsolete aliases.

Retired plugin-platform implementation documents are not current architecture. Remove or consolidate obsolete documents based on scout evidence; retain uniquely useful supported cleanup/migration instructions under operations and historical notices in changelogs. Historical verification results must remain labeled historical, never current release proof.

Consolidate duplicated current information by making indexes point to authoritative detail pages. Correct stale configuration, API, component, test, platform, and release claims from source-backed scout findings. Distinguish implemented capabilities from unqualified deployment/performance/platform gates. No speculative roadmap promises.

## Evidence

- Inventory: `plans/reports/context-261005-1653-docs-inventory.json` and `.md`. Counts are physical lines of eligible UTF-8 text, not language SLOC. Credentials/caches/external modules/tests/generated schemas/lockfiles excluded. Historical plans counted separately and are not current-product proof.
- Initial inventory: 2,046 text files, 411,852 LOC; 78 Markdown docs overall; 44 top-level docs, 12,055 LOC.
- Resources at allocation: Linux x64, 16 CPUs, about 13.7 GiB available RAM; pnpm monorepo. Six source scouts and five LOC-balanced documentation readers; no child delegation.
- Baseline local link/anchor audit: `plans/reports/context-261005-1653-docs-links-before.json`: 79 Markdown surfaces including root README, 770 local links, 19 suspected missing heading anchors. Validator does not check anchors, so main agent will supplement.
- Requested validator exists: `.omp/evcrate/scripts/validate-docs.cjs`. It checks file existence, selected environment prefixes against a built-in list and `deploy/server.env.example`, and selected inline `functionName()` references. It does NOT verify all ClassName references, heading anchors, arbitrary config keys, or `.env.example` (which is absent). Preserve these limitations in delivery; do not alter script just to suppress warnings.

## Size and verification

All Markdown files under `docs/` must stay within 800 lines; split meaningful detail sections before reaching the limit. Root README must stay below 300. No build/lint/tests/formatters during parallel work. Main agent runs post-update `wc -l docs/*.md | sort -rn`, requested Node validator, supplemental recursive file/anchor link audit, and manifest-based command reference checks. Return changed/moved/deleted file map, source-backed corrections, size results, and unresolved risks.

## Reports to merge

Source: servercore, serverruntime, advisorrelease, frontendstate, frontendsurface, nativetooling (`scout-261005-1653-<name>.md`). Readers: `scout-261005-1653-docs-reader-1.md` through `-5.md`. Main agent supplies merged findings after reports arrive.

Unresolved questions: none; additional evidence pending scouts.
