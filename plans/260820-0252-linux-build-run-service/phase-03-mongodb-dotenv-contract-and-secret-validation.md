# Phase 03: MongoDB dotenv contract and secret validation

Historical phase document; superseded by the current revalidation plan at
`../260820-0912-revalidation-build-run-service/`.

## Context

The server already loads a working-directory dotenv file through `dotenvy`, but
the systemd working directory is `/home/loidinh` and a generic dotenv file would
import unrelated values into the service. MongoDB is optional and is created
only when both `MONGODB_URI` and `MONGODB_DATABASE` are present. For this quick
verification, the selected dotenv file is copied into a private runtime file;
later release hardening can narrow the imported keys.

## Files

- Modify `deploy/systemd/dam-hopper.service` for an optional private
  `EnvironmentFile` reference, if selected by the final contract.
- Modify `deploy/run-linux-production.sh` to accept an explicit `--env-file`
  (defaulting only when documented), validate it without sourcing arbitrary
  shell, and copy it to a private runtime env file outside `/opt`.
- Add a placeholder-only `deploy/dam-hopper-env-template.example`.
- Update `docs/configuration-guide.md`, `docs/linux-systemd.md`, and
  `docs/linux-nohup.md`; add focused Rust/integration tests only where current
  behavior exposes a defect.

## Implementation

1. Define accepted input as a regular, non-symlink, non-world/group-readable
   dotenv file. Do not source it as shell code. Copy it atomically to
   `/home/loidinh/.config/dam-hopper/server.env` with owner `loidinh`, mode
   `0600`, and a restrictive umask; never print or embed its contents.
2. Require `MONGODB_URI` and `MONGODB_DATABASE` together when Mongo is intended;
   report a partial pair clearly and test the current disabled/error behavior.
3. Reference only the private runtime file from systemd. Keep host/port in the
   unit CLI flags and force `RUST_ENV=production` after environment loading so
   a quick dotenv cannot turn on no-auth. Mark broad dotenv import as quick-only,
   not a release contract.
4. Document precedence and keep server dotenv loading separate from project
   terminal `env_file` loading. Keep MongoDB connection logs to the database
   name only.
5. Add tests/scans proving URI passwords do not appear in parse/DNS/connection
   errors, surfaced diagnostics, journal excerpts, script output, staged files,
   or generated manifests. Schedule key allowlisting and driver-error redaction
   as the follow-up release hardening item.

## Validation

Use placeholder-only fixtures for missing, partial, quoted, malformed, and
valid values; verify permissions and atomic replacement. Run no-auth with
production and Mongo settings to prove fail-closed behavior. Do not require a
live MongoDB for unit tests; use an opt-in integration smoke only when an
operator supplies a safe external URI.

## Exit criteria

The operator can pass a local dotenv file for MongoDB without copying it into
the release tree; the broad quick-import behavior is mode-restricted and
explicitly documented as temporary. Service behavior for absent, complete, and
partial Mongo configuration is tested.

## Unresolved questions

- Confirm the pinned MongoDB driver's error redaction across all connection
  paths before the later release-hardening pass.
