# Phase 05 — Operator Documentation and Release Notes

## Context links
[Plan](./plan.md) · [Contracts](./contracts.md) · [Environment/recovery runbook](../../docs/configuration/server-environment-auth.md) · [Architecture](../../docs/architecture/authentication-state-and-cryptography.md)
Dependency: [Phase 04](./phase-04-auth-parity-qualification.md) runtime proof. No documentation may describe planned code as shipped before that gate.

## Overview
Date: 2026-10-07. Priority: P2. Effort: 2h. Implementation: complete. Review: complete.
Document .env lite-mode selection, safe first account approval, MFA/operator recovery and consistent SQLite backup; retain MongoDB default instructions.

## Key Insights
- Tracked deploy/server.env.example is safe to update; actual repository .env contains operator configuration and must not be copied/printed/rewritten.
- Lite means removing Mongo service requirement, not a smaller binary, no-auth or weakened MFA.
- Registered users remain disabled until operator approval; without explicit local SQL procedure a fresh database is unusable operationally.
- SQLite WAL requires consistent backup handling; MFA key must be backed up separately.

## Requirements
- Concrete env examples, defaults, accepted boolean values, dotenv precedence, path resolution and restart behavior.
- Distinguish fresh independent state from data migration. Switching backend does not transfer accounts or bypass account checks.
- Document production MFA key and JWT signing secret separately; no secret material in examples/reports.
- Preserve existing Mongo operator runbook; add SQLite equivalent using immutable ID + expected version.
- Validated deployment limit: one server process per auth file on local storage; no shared network-file/multi-server support claim. Separate deployments use separate configured auth files.
- Validated operational defaults: global config-directory `auth.db` when path absent/empty; checked local SQL approval, admin assignment and MFA recovery, no admin CLI/API.

## Architecture
Configuration/operations docs describe the shipped backend-neutral service; architecture proposal becomes maintained current contract only after qualification. Local operator access controls account approval/role assignment/recovery, not HTTP endpoints or first-user promotion.

## Related code files
Modify documentation/examples:
- `deploy/server.env.example`: commented lite-mode opt-in and path; default Mongo config stays default; MFA key applies to both.
- `docs/configuration/server-environment-auth.md`: env table, Mongo vs lite settings, precedence/path defaults, account approval, SQLite conditional MFA reset, backup guidance.
- `docs/configuration/server-deployment.md`: lite single-host deployment and private persistent auth directory, service `.env`/EnvironmentFile examples; no release artifact change.
- `docs/api/authentication.md`: storage-neutral wording, registration approval guidance, exact no-auth vs configured-store semantics; wire examples unchanged.
- `docs/architecture/authentication-state-and-cryptography.md`: promote proposed section only after proof, adapter ownership/schema/startup invariants; update module table and generalize DB wording.
- `docs/codebase-summary.md`, `docs/system-architecture.md`: concise auth backend inventory/storage boundary updates only, no unrelated diagram churn.
- `docs/CHANGELOG.md`: feature entry with selected SQLite lite mode and preserved Mongo default; no version bump unless separately requested.
- Plan reports: final qualification results and intentionally unqualified platforms.
Intentionally unchanged: real `.env`, secrets, README-wide restructuring, frontend config, release version manifests.

## Implementation Steps
1. Add safe .env example: `DAM_HOPPER_LITE_MODE=true`, optional absolute `DAM_HOPPER_AUTH_SQLITE_PATH`, existing required-production MFA key; explain absence/empty/false chooses Mongo.
2. Describe real dotenv precedence (non-overwrite) and relative path startup CWD, HOME expansion, global default auth.db; differentiate from sessions.db and telemetry.db.
3. Provide concrete registration -> denied pending approval -> local account lookup -> conditional enable/admin SQL. Use immutable verified ID and observed auth_version; verify exactly one changed row before commit. Never auto-enable/promote all rows or first HTTP registrant.
4. Add lost-authenticator SQLite reset transaction: compare immutable ID and expected version, increment version, NULL entire confirmed MFA and attempt fields/count; preserve password/role/enablement. Check affected row exactly one, otherwise rollback and re-read. Explain sessions/challenges invalidated by version, not deletion requirement.
5. Document no recovery-code feature and no public admin reset API. Local operator identity verification needed; key loss requires existing reset/re-enrollment procedure, not silent replacement.
6. Explain consistent SQLite `.backup`/checkpoint-backed backup of auth DB, private directory/WAL/SHM, separately backed-up MFA key and JWT signing secret. Restoration preserves account/session versions; backend switch/rollback reconnects original independent store.
7. Document production valid DB + key requirement; lite unavailable DB aborts; no-auth remains dev-only and never a lite-mode synonym.
   Include the one-server-per-local-auth-file limit and distinct-file setup for separate deployments; concurrent operator connections do not imply supported multi-server sharing.
8. Update architecture/inventory/CHANGELOG from exercised results only; mark Windows runtime limit if untested. Remove proposed-only claim once implementation truly matches.
9. Follow repository doc validation conventions and check relative links/size; remove transient smoke scripts, leave only meaningful regressions and reports.

## Todo list
- [x] Safe environment/deployment examples.
- [x] First-account approval and administrator assignment SQL.
- [x] Conditional MFA recovery and backup procedure.
- [x] Current architecture/inventory and changelog.
- [x] Documentation validation and final evidence report.

## Success Criteria
- Operator can deploy authenticated lite mode with .env, no Mongo service, private auth file and correct key.
- Fresh account approval/admin setup works exactly as documented; recovery preserves unrelated user fields and invalidates old versions.
- Default Mongo deployment instructions continue to work unchanged; no accidental default SQLite adoption.
- No secrets copied into worktree/plans/docs; no code/docs claim unsupported recovery codes, Argon2 change, automatic admin or lite-only binary.
- Relative links resolve; architecture specifies current behavior, not proposed behavior after feature completion.

## Risk Assessment
Mislabeling lite as no-auth, unworkable account bootstrap, live-WAL backup loss, outdated Mongo-only key wording. Mitigate with exact procedures exercised in Phase 04 and retained safe defaults.

## Security Considerations
Owner-private storage and key files, out-of-band identity verification, conditional local SQL, no public bootstrap/reset surface, no credential-bearing example logs. SQL checks require rollback on non-match before any claim of recovery.

## Next steps
All five phases (01–05) complete with qualification receipts and operator documentation in place. Feature ready for final handoff and release integration. Commit/push and release not part of current review scope.
