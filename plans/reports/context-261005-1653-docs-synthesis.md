# Merged codebase and documentation audit

## Evidence and report inputs

Read the integration contract first: `context-261005-1653-docs-update-contract.md` (same report directory).

Detailed source scout reports:
- `scout-261005-1653-servercore.md`: entry/config/auth/REST/WS/FS/crypto/Git/web host.
- `scout-261005-1653-serverruntime.md`: PTY/agent ingress/idle suspend/system/host actions/telemetry/SSH/tunnels.
- `scout-261005-1653-advisorrelease.md`: native Advisor, workflow/persistence, Agent Store, release/CI/deployment. Includes follow-up resolving retention wiring.
- `scout-261005-1653-frontendstate.md`: transports, ownership/query/store/replay/crypto; corrected stale patch and SSE path claims.
- `scout-261005-1653-frontendsurface.md`: components/advisor/routes/styles/web/extension/test runner configs.
- `scout-261005-1653-nativetooling.md`: desktop IPC, Windows-only SSH forwarding, browser-debug platform limitations, release commands.

Documentation readers: `scout-261005-1653-docs-reader-1.md` through `-5.md`; cover all 44 root documents plus nested API/architecture/configuration/frontend/systemd documents. Treat their suspicious claims as unverified until resolved by code evidence. Full inventories: `context-261005-1653-docs-inventory.json` and `.md`.

## Integration decisions

1. Preserve current recently updated root overview/PDR/standards/architecture/roadmap. Update with concrete source evidence rather than rebuilding blindly.
2. Rename seven phase files by subject and place under `docs/architecture/`. Suggested canonical targets:
   - phase-01 -> `authentication-state-and-cryptography.md`
   - phase-03 -> `workbench-files-editor-and-git.md`
   - phase-04 -> `terminal-continuity-and-workflow.md`
   - phase-05 -> `agent-store-ports-and-browser.md`
   - phase-06 -> `preferences-settings-and-host-resources.md`
   - phase-07 -> `media-isolation-and-encryption.md`
   - phase-08 -> `native-ssh-forwarding.md`
   Consistent purpose-based targets are authoritative; migrate links and relative code/plan paths, no aliases.
3. Consolidate six retired plugin-platform docs into one concise `docs/archive/retired-plugin-platform.md` historical retirement record, preserving unique design provenance only if useful. Delete superseded individual documents (obsolete by cutover and in scope). Keep supported Linux removal runbook in operations, linked from archive; don't preserve thousands of lines of dead API/runner specs as maintained architecture.
4. Remove active plugin administrator env vars, runner RPC/config and runner staged-unit claims from `configuration/server-environment-auth.md`, release manager and other current docs. Constants retained solely for cleanup are migration evidence, not live features.
5. Consolidate auth REST spec into `docs/api/authentication.md`; replace all incoming links and remove redundant root `authentication-api.md`. Keep WS root guide as wire authority with child API overview link, not duplicate deep specs. Keep root workflow API as deep domain authority with concise child index links. Remove redundant `docs/frontend-components/index.md` after root frontend-components index covers all children; migrate references.
6. Keep deployment guide current. Design guidance belongs to existing `frontend-components/platform-integrations.md` plus `packages/ui/src/index.css`; improve discoverability rather than invent a new design guide.
7. Repair 19 baseline heading-link defects using `context-261005-1653-docs-links-before.json`; do not rewrite historical changelog facts, but link maintenance is allowed. Use descriptive headings in maintained technical docs rather than phase progress.

## Confirmed corrections and current boundaries

- Standalone server main.rs defaults `0.0.0.0:4800`; systemd release API4801/web4802; dev API4803/Vite5173. Never call 4801 standalone default. Root dev scripts bind all interfaces with no-auth; preserve explicit loopback safe setup and warn, do not change scripts.
- Node>=20/pnpm>=10; package commands from root and package manifests. `pnpm check` is build web + native + lint + server tests, not a standalone TS check. `dev:server:watch` has no binary selector despite multi-bin crate: do not claim verified operational command.
- POST /api/auth/mfa/challenge accepts Bearer header OR `damhopper-auth` cookie when header absent; not Bearer-only. See servercore report, auth_mfa.rs::challenge/auth.rs::extract_token_and_mechanism/router.rs public MFA registration.
- `server.workflow_event_retention_days` exists in schema but is NOT passed into WorkflowStore/event constructors; current events use hardcoded `DEFAULT_EVENT_RETENTION_DAYS=90`. Document actual limitation, no implementation.
- Host actions use `HostActionService::new` -> `UnavailableExecutor`; capabilities always `available:false`, reason noAuth/reauthUnavailable/helperNotEnrolled. Approval protocol existence does not mean actions are usable. Main directly verified service.rs:47-64.
- Canonical SSE endpoint `/api/system/resources/v1/events`, bounded shared data/status frames and 32-global/4-subject admission; deployed proxy/performance/native gates remain explicit where unqualified.
- Native SSH forwarding is Windows-only (cfg(windows), capability gating); Linux native browser debug exists with WebKitGTK runtime qualification gaps. Do not infer cross-platform forwarding from shared UI.
- Native Advisor is in-process Rust plus native React subtree; default-off/admin-only/no-auth denied; HOME history and routing CAS. Retired runner/SDK/plugin routes are not current; Agent Store is independent current functionality.
- Git direct ODB rewrite/squash + local CAS + explicit exact-OID leased publication; no automatic force push. Profile/generation tuples and incarnation fence all consumer work.
- Only compose-refs Radix patch exists, not a react-slot patch. Preserve the compose-refs patch invariant in standards. Current Heavy Blur is blur(16px) saturate(180%) with rgba(148,163,184,0.12), not historical values.
- UI canonical export is embed/dam-hopper-app.tsx; packages/ui/src/index.ts does not exist.
- compare-servers.sh still exists but targets retired Node packages/server; describe obsolete tooling, do not delete source script. Extension manifest version0.2.0 vs package0.10.2 is an observed mismatch: do not fix in documentation task or invent requirement to synchronize independent extension version without evidence.
- Build-before-Cargo browser-bridge requirements from native build.rs/report must be accurately included in native source setup, with distro-correct prerequisites rather than Debian package names labeled Fedora.

## Validation boundaries

Main runs requested existing validator and supplements local links/anchors, recursive 800-line cap, root README<300 and documented pnpm script existence. Validator only does existence, limited env-prefix/built-in allowlist checks plus deploy/server.env.example, and functionName() substring search. It does not check ClassName or all env variables. Warnings nonblocking; resolve genuine current-doc defects, disclose verified source-backed false positives. Do not change validator/application files.

## Remaining unknowns

No user decisions required. Performance/proxy/platform qualification gaps remain factual gates, not documentation blockers. Scout reports sometimes include speculative unresolved questions; do not expand implementation scope to solve them.

## Independent evidence review corrections

Read `reviewer-261005-1653-docs-source-validation.md` as higher-quality follow-up to initial scout claims. Startup `main.rs` skips MongoDB initialization under no-auth; `AppState` checks `db.is_some()`, not presence of MongoDB environment keys. Production indicators reject no-auth, but MongoDB environment presence alone does not. Do not document a nonexistent protection. MFA key loader enforces regular nonsymlink owner-only Unix permissions (no group/world bits); exact0600 is recommended, not exact enforced mode equality. Parseable Bearer header takes precedence; absent, non-Bearer or unparseable header permits cookie fallback. Twelve legitimate documented environment keys are absent from validator's limited allowlist and may produce source-backed false-positive warnings.
