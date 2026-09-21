# Codebase Summary: Release and Deployment

This detail page is derived from `repomix-output.xml` and the focused release-source files. It keeps the main codebase summary below the documentation size target while preserving release architecture and phase boundaries.

## Linux release and deployment

`server/src/linux_release/` owns manifest validation, role projection, unit
staging, systemd lifecycle, health, rollback, recovery, and release evidence.
Systemd templates define API, helper, web, and recovery services. The API
runtime identity is taken from the finalized unit's `User=`/`Group=` pair;
release tooling refuses unsafe path ownership or symlink substitutions rather
than repairing them. The helper remains root-owned and uses a restricted Unix
socket with peer credentials.

### Phase 01–02 Windows direct-server release and installer

`deploy/release/build-windows-release-archive.mjs` emits a deterministic
`dam-hopper-vX.Y.Z-windows-x86_64.zip` containing exactly
`dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, and `README.md`.
The Windows publication set adds exactly `dam-hopper-install.ps1`, for two
assets total. `check-release-assets.mjs` defaults to Linux and supports
`--profile windows` or `--profile all`; the latter requires the exact six-asset
Linux+Windows union. ZIP structure/CRC/EOCD and PowerShell syntax are checked
without executing the installer. The package-twice PowerShell harness proves
same-epoch byte reproducibility and changed-epoch digest variation.

`deploy/release/dam-hopper-install.ps1` is the non-admin Windows bootstrap. It
accepts exactly one of `-Version vX.Y.Z` or `-Latest`, plus `-InstallDir`,
`-AddToPath`, `-VerifyAttestation`, and `-DryRun`. It verifies release metadata,
asset size, and SHA-256 before bounded four-member extraction; preserves an
existing `dam-hopper.toml`; optionally updates only User PATH; and never starts
the server. The focused `tests/deploy/windows-release-install.ps1` harness uses
`windows-release-install-fixture.mjs` and reports 14/14 integration scenarios,
including upgrade/config preservation, dry-run, digest/size and archive safety
failures, invalid arguments, endpoint-security rejection, PATH idempotence, and teardown.

This is a direct-server package, not a systemd or Manifest v2 release. See
[Windows Release Asset Packaging](./windows-release-packaging.md) for the
asset contract, installer grammar, and operator/test commands.

### Phase 03 cross-platform Release CI and guidance

`.github/workflows/release-linux.yml` branches after shared metadata validation:
Linux builds/package under `--profile linux`; Windows builds
`x86_64-pc-windows-msvc` and packages under `--profile windows`. Immutable
artifact bundles flow into `attest-release`, which attests the four Linux
subjects plus the Windows installer and ZIP. `publish-release` merges those
bytes, checks the exact six-asset union with `--profile all` against local and
GitHub metadata, and undrafts only behind the protected `linux-release`
environment. Dry runs stop before publication.

The focused local `release:windows-gate-test` script exercises the profile-aware
asset contract without executing the installer or contacting a production
release. The package-twice and installer fixtures remain separate
reproducibility and live-installation boundaries.

### Phase 00 merge boundary (2026-09-14)

The merge reconciliation kept refusal-based descriptor provisioning and
excluded recursive string-path `chown`, while incorporating the workflow and
Explorer HTML preview surfaces. The API unit renders
`--config /var/lib/dam-hopper/dam-hopper.toml`; the merge boundary is complete.

### Phase 01 runtime-state boundary (2026-09-14)

`server/src/linux_release/api_runtime.rs` now provisions the descriptor-relative
API state root, canonical `/var/lib/dam-hopper/dam-hopper.toml`, and server
`/var/lib/dam-hopper/idle-suspend-audit.jsonl`. A validated legacy
`/etc/dam-hopper/dam-hopper.toml` is an optional exact-byte, copy-once source
only when canonical state is absent. Staging uses an exclusive no-follow
temporary sibling and Linux `renameat2(RENAME_NOREPLACE)`; mismatches, unsafe
legacy state, races, and post-publication failures remain refusal/reporting
boundaries. See [Linux API Runtime State Provisioning](./linux-release-runtime-provisioning.md).

### Phase 02 systemd unit/policy boundary (2026-09-14)

`deploy/systemd/dam-hopper-api.service.in` renders
`--config @API_HOME@/dam-hopper.toml`; the checked-in unit resolves that
operand to `/var/lib/dam-hopper/dam-hopper.toml` and must stay synchronized
with the production-default rendering. `validate_api_unit_policy` requires
exactly one canonical `ExecStart` and one zero-operand privileged
`provision-api-runtime` prestart. Staging renders, parses, and policy-checks
the same unit; duplicate directives, legacy/alternate paths, and extra
arguments fail closed. Focused unit-policy/staging evidence records 29/29.

### Phase 03 preflight, installer, and reset boundary (2026-09-14)

`activate_preflight.rs` gates SQLite holder checks only for `server`/`both`
roles. It inspects canonical `/var/lib/dam-hopper/dam-hopper.toml` first and
the extant `/etc/dam-hopper/dam-hopper.toml` migration source second, using
no-follow regular-file descriptors, a 64 KiB bound, UTF-8/TOML parsing, and
fixed API `HOME`/working-directory path semantics. Unsafe presence fails closed;
missing is the only absence state. Missing keys use the schema default for that
config; when both TOMLs are absent, the canonical default is included. Results
retain the migration-window `/etc/dam-hopper/sessions.db` fallback, with
stable-deduplicated DB, `-wal`, and `-shm` holder checks without filesystem mutation.

The Linux bootstrap installer stages release-manager bytes only. It does not
create, copy, chmod, chown, or repair daemon TOML; first `server`/`both` start
invokes the runtime provisioner, while `web` remains API-state-free. The reset
tool defaults to the canonical config, refuses unsafe metadata, and performs a
same-directory atomic replacement as the exact API identity, preserving
`0600` ownership/mode and parseable TOML. Dry-run is observation-only; helper
units, audits, and foreign RTC alarms remain preserved. Clean-install,
security, and reset smoke journeys pin these boundaries.
