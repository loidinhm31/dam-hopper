# Final documentation validation

## Outcome

Documentation-only refactor complete. Root README and required overview/PDR/summary/standards/architecture/roadmap updated; deployment guide updated. Existing component integration guide and CSS remain design authority rather than a redundant new guide.

Seven execution-named root documents moved to subject-named architecture references. Six retired plugin specifications consolidated into `docs/archive/retired-plugin-platform.md`; supported Linux cleanup remains in operations. Authentication REST details consolidated in `docs/api/authentication.md`; duplicate root authentication guide and child component index removed.

Development milestone wording and removable research-artifact dependencies removed throughout docs, including dated changelogs. Exactly 38 remaining whole-word Plan/Phase occurrences in six documents describe implemented Workflow entities, labels, or wire identifiers. Real source filenames containing those substrings remain unchanged. No documentation reference to the removable research directory remains; no old execution-named document remains.

## Initial repository inventory

Physical UTF-8 text lines, not language SLOC; credentials, caches, external modules, tests, generated schemas/artifacts, symlinks and lockfiles excluded. Per-directory direct and recursive counts are in `context-261005-1653-docs-inventory.md` and `.json`.

| Implementation/tooling scope | Files | Physical LOC |
|---|---:|---:|
| server | 352 | 128,698 |
| packages | 514 | 119,102 |
| apps | 84 | 30,140 |
| deploy | 22 | 5,224 |
| scripts | 9 | 2,154 |
| .github | 4 | 950 |
| Total implementation/tooling | 985 | 286,268 |

Initial all-eligible-text count: 2,046 files / 411,852 LOC, including historical artifacts counted separately. Source scan is a pre-restructure snapshot, not a regenerated final-tree statistic.

Six source scouts and five LOC-balanced documentation readers examined current source and all initial 78 documents; independent source review corrected mistaken security/platform assumptions before publication. Final factual caveats include standalone port4800 vs release4801/4802, Windows-only SSH forwarding, actual same-origin admission, owner-only MFA permissions, MongoDB environment not independently rejecting no-auth, fixed90day event expiry vs configurable note retention, unavailable host mutations, and release activation service stops (not zero downtime).

## Size checks

Executed `wc -l docs/*.md README.md | sort -rn`; supplemented recursive physical-line counting.

- Final docs: 71 Markdown files / 17,808 lines, down from 78 / 20,267.
- Root README: 99 lines; required below300.
- Largest document: `docs/api/git.md`,760 lines; limit800,40lines headroom.
- No document exceeds800; no split/accept decision needed.

## Link, wording, and command checks

Executed supplemental in-memory Markdown local-file/heading audit across all71 docs plus root README: 434 local links, zero missing files or heading anchors. Baseline had19 missing heading anchors; intermediate missed cutover links were repaired before final validation.

Whole-word lifecycle scan: no development milestone Plan/Phase wording and no removable research-directory paths. Retained38 actual Workflow-domain contexts reviewed in workflow-api.md, workflow-client-state.md, workflow-context-surface.md, CHANGELOG-archive.md, codebase-summary.md and system-architecture.md.

Manifest-backed command check verified117 documented pnpm-script occurrences. Remaining regex candidates were classified by context: pnpm patch is a built-in; pnpm start is an arbitrary project-type preset, not a DamHopper script; removed linux:production/linux:reset aliases are explicitly historical; pnpm10/version prose and 'pnpm available' are not commands. This checks script existence, not execution of build/deploy/test commands.

## Requested validator report

Executed `node .omp/evcrate/scripts/validate-docs.cjs docs/`; exit0, warnings non-blocking.

| Check | Observed result |
|---|---|
| Markdown documents | 71 |
| Internal file links | All resolve |
| Environment keys | 25 occurrence warnings,22 distinct file/key pairs |
| Inline code references | 5 file/symbol warnings,4 distinct symbols |

### Environment warning classification

Twelve real keys are omitted from the validator allowlist but confirmed in source: `DAM_HOPPER_PORT`, `DAM_HOPPER_HOST`, `DAM_HOPPER_WEB_DIR`, `DAM_HOPPER_WEB_RUNTIME_CONFIG`, `DAM_HOPPER_WEB_RELEASE_VERSION`, `DAM_HOPPER_IDLE_SUSPEND_SOCKET`, `DAM_HOPPER_AGENT_STATUS_URL`, `DAM_HOPPER_AGENT_STATUS_TOKEN`, `DAM_HOPPER_NATIVE_SMOKE_EVIDENCE`, `VITE_DAM_HOPPER_LOG_LEVEL`, `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS`, `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG`.

Two additional token types are not current configuration defects: `DAM_HOPPER_PLUGIN_ADMINS_FILE` is explicitly retired historical provenance; `MONGODB_` is a regex match from wildcard prose. Values of credentials were never inspected.

Observed file/key warning pairs:
- CHANGELOG.md: DAM_HOPPER_PLUGIN_ADMINS_FILE.
- api/system-services.md: VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS.
- architecture/agent-status.md: DAM_HOPPER_AGENT_STATUS_URL, DAM_HOPPER_AGENT_STATUS_TOKEN.
- configuration/server-deployment.md: DAM_HOPPER_PORT.
- configuration/server-environment-auth.md: DAM_HOPPER_PORT, DAM_HOPPER_HOST, DAM_HOPPER_WEB_DIR, DAM_HOPPER_WEB_RUNTIME_CONFIG, DAM_HOPPER_WEB_RELEASE_VERSION, VITE_DAM_HOPPER_LOG_LEVEL, VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS, DAM_HOPPER_PLUGIN_ADMINS_FILE.
- configuration-guide.md: VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS.
- frontend-components/platform-integrations.md: VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS.
- linux-nohup.md: DAM_HOPPER_WEB_DIR, DAM_HOPPER_HOST, DAM_HOPPER_PORT.
- linux-systemd/idle-suspend-runbook.md: DAM_HOPPER_IDLE_SUSPEND_SOCKET.
- linux-systemd.md: MONGODB_.
- native-browser-debug-support.md: DAM_HOPPER_NATIVE_SMOKE_EVIDENCE, VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG.

### Function warning classification

- CHANGELOG-archive.md: onProcessRestarted().
- api/transport-and-events.md: onTerminalBuffer().
- testing.md: readPolicyFile().
- ws-protocol-guide.md: terminalAttach(), onTerminalBuffer().

Methods exist in packages/ui/src/api/transport.ts and ws-transport.ts; readPolicyFile exists in packages/ui/e2e/fixtures/application-services.ts, outside validator source scope. The genuine incorrect remote_addr() listener reference found during validation was fixed to actual listener/address semantics.

### Validator limits

Validator checks file existence, selected environment prefixes against built-in/example allowlist, and selected function-name substrings. It does not independently verify every ClassName, heading anchor, arbitrary configuration key, or source symbol. Supplemental heading and source checks were performed; no claim of exhaustive semantic validation. Validator unchanged.

## Evidence artifacts

- `context-261005-1737-docs-final-audit.json`: recursive sizes, links, actual Workflow word contexts and manifest command matches.
- `reviewer-261005-1653-docs-source-validation.md`: exact current-source evidence and corrected overclaims.
- `docs-manager-261005-1653-docs-restructure.md`: primary move/consolidation map; final measured counts in this validation report supersede earlier intermediate counts.
- Stable API/feature/release/history writer reports named `docs-manager-261005-1737-*.md`.

No application implementation, builds, application tests, release activation, platform qualification or visual acceptance was performed or claimed. Documentation validators and structural checks are the exercised surface.

Unresolved questions: none requiring a user decision. Existing platform, proxy, canary and performance qualification gates remain documented.
