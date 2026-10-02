# Documentation Review Report — Phase 08 Evcrate Plugin Integration and Release Asset Removal

- **Date:** 2026-10-02
- **Scope:** Documentation status across Dam-Hopper and Evcrate; onboarding/configuration check; Phase 08 synchronization gaps.
- **Status:** Review complete. This report is the only edited file. Product documentation, sealed plans, roadmaps, progress files, and prior receipts were not changed.

## Current State Assessment

Phase 08 removes Evcrate's plugin package/runtime, bridge/provider, plugin packaging workflow and tests, and renames the shared data contract to `advisor-data-api`. The Phase 08 reviewer records 22,000+ lines removed across 122 Evcrate files, the seven general release assets preserved, and a 9.6/10 review. The tester report records 2,627 passes, zero failures, 24 Windows-gated skips, and a successful Evcrate build. These are source reports, not tests rerun for this documentation-only assignment.

The documentation sets are broad but have not been synchronized to this phase. Inventory: **56 Dam-Hopper Markdown files (about 23,860 LOC)** and **13 Evcrate Markdown files (9,501 LOC)**, **69 files / 33,361 LOC combined**. Both repositories have overview/PDR, architecture, standards, roadmap, changelog, and codebase-summary documents. Phase 08 documentation status is **incomplete in both repositories**: the current docs still describe retired plugin flows, old code paths, or the state before native migration Phase 08.

### Dam-Hopper

- `docs/CHANGELOG.md` has 2026-10-02 entries for native migration Phases 01–04, but Phase 01 still says `scripts/test-native-advisor-parity.mjs` must be removed before Phase 08; there is no native-migration Phase 08 entry.
- `docs/architecture/native-advisor.md` still says Phases 06–09 retirement/qualification are pending and names the deleted parity script as the current fixture checker. Its plugin/deployment cutover list remains written as future work.
- Onboarding `README.md` Sections “Plugin Runner & Workspace Permissions” and “Configuring Global Owner History Source” still instruct setting ACLs for `dam-hopper-plugin-runner`, `--plugin-owner-user`, and Settings → Plugin Management. The current installer explicitly says `--plugin-owner-user` is deprecated and ignored (`deploy/release/dam-hopper-install.sh:77–79`), so these instructions are misleading.
- `docs/configuration/server-configuration.md` still documents `DAM_HOPPER_PLUGIN_ADMINS_FILE`, the plugin administrator allowlist, and runner configuration; the runtime key was not found in the current server source search. `docs/codebase-summary.md`, PDR, system architecture, API reference, and README navigation also retain plugin platform material. The docs landing page presents several Trusted Plugin Platform guides as feature/reference docs rather than clearly historical records.
- Release/operator guides still contain plugin-runner details. Preserve only the migration/cleanup and legacy-state information that is still operationally required; relabel or remove retired setup and active-contract claims.

### Evcrate

- The plugin UI and worker guides are absent from `docs/`, but `README.md:272` still links to deleted `docs/advisor-plugin-ui.md`.
- `docs/codebase-summary.md` (generated from a 2026-09-30 compaction; marked updated 2026-10-01) still lists `plugin/`, `advisor-plugin` release archives, the old contract API, plugin build/release steps, and the `dam-hopper-port-provider`. It predates Phase 08.
- `docs/code-standards.md`, `docs/project-overview-pdr.md`, and `docs/all-project-advisor-history.md` still name `src/protocol/advisor-plugin-data-api.ts` and deleted schema/worker/bridge paths. The current source inventory contains `src/protocol/advisor-data-api.ts` and no old-named module.
- `docs/system-architecture.md` still describes the plugin SDK/UI build and plugin archives in its release workflow and describes the retired Dam-Hopper Advisor Plugin integration as current. `docs/project-roadmap.md` and PDR status remain based on the pre-Phase 08 state. `docs/project-changelog.md` is marked updated 2026-10-01 and has no 2026-10-02 Native Advisor migration Phase 08 entry; its Phase 08 entry is the distinct 2026-09-30 standalone-navigation work.
- The Evcrate validator confirms the stale-link issue. Its 2026-10-02 run checked 12 files and reported **74 broken internal links**, **107 code-reference warnings**, and **90 config-key warnings**; representative broken links point to the deleted advisor-plugin UI/worker docs. The validator is warn-only and uses a simple uppercase-token-to-`.env.example` check, so the 107/90 warning totals are not counts of confirmed source defects. Many code/config warnings are historical API names, enum/status tokens, or non-environment identifiers.

## Onboarding, API Keys, Environment Variables, and Config

- **Dam-Hopper server setup:** Root `README.md` documents production authenticated mode with `RUST_ENV=production`, `MONGODB_URI`, `MONGODB_DATABASE`, and `DAM_HOPPER_MFA_KEY_FILE`; `deploy/server.env.example` additionally shows `DAM_HOPPER_CORS_ORIGINS`. It documents a 32-byte MFA key file with owner-only `0600` permissions. The example URI is loopback and the key is a file path, not a committed key value. `docs/authentication-api.md` correctly distinguishes the server's JWT signing-secret file from the session bearer token returned after MFA. No first-party API-key onboarding requirement appears in the reviewed server setup.
- **Project command environment:** `docs/configuration-guide.md` documents project-local `env_file` and the `DAM_HOPPER_CONFIG` / `DAM_HOPPER_WORKSPACE` startup overrides. Keep this separate from server authentication secrets and remove the retired plugin-admin key/runner configuration from the server reference.
- **Evcrate setup:** `README.md` documents Node `>=22.19.0`, package installation/build, and user-owned `$HOME/.evcrate/advisor-routing.json` containing backend/model routing; it does not document an API-key setup step. Source confirms `EVCRATE_HOME` and `EVCRATE_STATE_HOME` path overrides and a bounded child-process environment allowlist (`src/cli/process-runner.ts`), which does not include provider API-key variables. Provider credential provisioning is not explained in the onboarding page and should be described only if Evcrate itself owns that setup; otherwise link to the relevant provider CLI setup rather than suggesting an Evcrate API-key field.
- A root `../evcrate/.env.example` exists. Its secret-like contents were not displayed or copied into this report. No private `.env` was opened. The Evcrate validator reads `.env.example` names only for its config-key comparison; its warnings need manual classification.

## Changes Made

- Wrote this scoped status report at the authorized destination.
- No product-document edits or Repomix regeneration were performed: only this report path was authorized. The existing Dam-Hopper `repomix-output.xml` was observed as an older artifact (listed four hours before this review); existing codebase summaries therefore cannot be treated as post-Phase 08 summaries.

## Gaps Identified and Recommendations

1. **High — Correct end-user setup now.** Remove the retired plugin-runner ACL/owner-history instructions from Dam-Hopper `README.md`; keep a concise native Advisor setup reference to `docs/configuration/advisor.md`. Remove the obsolete plugin-admin environment key and section from `docs/configuration/server-configuration.md` after confirming any legacy migration-only requirement.
2. **High — Reconcile native migration documentation.** Update `docs/architecture/native-advisor.md`, Dam-Hopper `docs/CHANGELOG.md`, PDR/roadmap, and codebase summary for Phase 08: the parity script is gone, native Rust tests replace it, and Phase 09 qualification remains distinct. Preserve phase history without describing deleted code as current.
3. **High — Remove Evcrate dead links and current-state claims.** Update Evcrate README navigation; codebase summary; standards; system architecture; PDR/roadmap; and cross-repository history contract. Rename references to `advisor-data-api.ts`, remove deleted plugin build/assets/runtime claims, and label retained E00–E05/runner/bridge evidence as historical where it remains useful.
4. **Medium — Revalidate links/config examples.** The Evcrate validator is available at `.evcrate/source/.claude/scripts/validate-docs.cjs` (the injected `.omp/evcrate/scripts/validate-docs.cjs` path is absent). Its run is useful for link discovery but its config-key matching is noisy. No Dam-Hopper docs validator was found at the prescribed path; its `deploy/server.env.example` must be considered when checking runtime configuration.
5. **Medium — Address size limits in separately authorized work.** With an 800-LOC target, Dam-Hopper docs include `system-architecture.md` (5,520), `api-reference.md` (2,931), `code-standards.md` (2,490), `project-overview-pdr.md` (2,202), `project-roadmap.md` (1,104), and `linux-systemd.md` (933). Evcrate `system-architecture.md` (810) and `project-changelog.md` (802) also exceed the target. No split was made because only this report path was authorized.

## Evidence and Verification

- Reviewed both complete `docs/` inventories, repo onboarding/readme sections, current Phase 08 reviewer/tester reports, native Advisor documentation, configuration references, Evcrate protocol source inventory, runtime environment declarations, and release installer option handling.
- Ran `node .evcrate/source/.claude/scripts/validate-docs.cjs docs/` from the Evcrate repository. It exited successfully in warn-only mode and emitted the issue counts above. The validator source documents that it checks code references, Markdown links, and variables against `.env.example` and always exits 0.
- No Dam-Hopper project-wide tests/build/lint, full docs-validator suite, or live release test was run. No secret values were included in output.

## Metrics

- Documentation inventory: 56 Dam-Hopper files; 13 Evcrate files; 69 total; 33,361 LOC.
- Phase 08 documentation synchronization: **incomplete**; dead links and pre-cutover implementation/release claims remain in both repos.
- Evcrate validator: 12 files checked; 492 internal links reported working and 74 flagged; other warnings are described above.
- Update cadence: Dam-Hopper changelog current through 2026-10-02 for other features, but missing this migration's Phase 08 entry; Evcrate current changelog metadata is 2026-10-01, before Phase 08.
- Documentation coverage percentage: not measured; no requirement-to-document traceability matrix exists in the reviewed docs.

## Unresolved Questions

None requiring a decision for this report. The product-document corrections require authorization for paths beyond the assigned report destination.