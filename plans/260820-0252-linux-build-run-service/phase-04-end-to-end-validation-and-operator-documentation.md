# Phase 04: End-to-end validation and operator documentation

Historical phase document; superseded by the current revalidation plan at
`../260820-0912-revalidation-build-run-service/`.

## Context

Repository checks prove scripts, artifacts, unit content, and secret scans;
sudo/systemd checks prove installed ownership and runtime behavior. The two
evidence classes must remain separate, especially after the earlier live
quick-verification setup.

## Files

- Update `docs/linux-systemd.md`, `docs/linux-nohup.md`,
  `docs/configuration-guide.md`, `README.md`, and `docs/system-architecture.md`
  only if the canonical contract changes.
- Create a redacted validation report under `plans/reports/` using the current
  report naming convention.

## Implementation and validation steps

1. Run `bash -n` and fixture tests for both scripts; run `pnpm build:server`,
   production web build, `pnpm test`, `pnpm lint`, and `systemd-analyze verify`.
2. Inspect staged inventory, hashes, modes, ownership, absence of dotenv/secrets,
   executable binary, web index, direct `ExecStart`, no-auth guard, loopback,
   and service user.
3. With sudo, record redacted before/after `systemctl show`, enable/active state,
   MainPID/effective UID/GID, listener, health/auth responses, journal startup,
   normal SIGTERM shutdown, and controlled restart behavior.
4. Run the clean reset and fresh build/run on the host only after reviewing the
   exact quarantine targets. Recheck preserved config/token/OPAQUE/SQLite/project
   paths and ownership; do not delete unrelated Docker containers or Mongo data.
5. Rehearse rollback only against the verified fresh-install marker and record
   that the service, port, database ownership, and installed assets are gone or
   quarantined while user state remains.

## Exit criteria

Docs provide copy/paste commands, clearly label sudo-only evidence, include the
dotenv/MongoDB contract, and state whether host acceptance and rollback are
complete, failed, or not run. The plan is complete only when all required
repository and administrator evidence passes.

## Unresolved questions

- Define the operator/evidence retention location and whether a live Mongo smoke
  is required for this quick verification.
