# Documentation Review Report — Phase 07 Linux Runner Retirement

- **Date:** 2026-10-02
- **Scope:** `docs/linux-systemd.md` only
- **Status:** Documentation review and synchronization completed. This is a docs status report, not a claim of durable project closeout.

## Current State Assessment

The Linux guide’s service table already listed recovery, helper, API, and web units, but nearby role descriptions, filesystem inventory, install examples, activation/rollback instructions, and helper-group guidance still described the retired plugin runner and its shared group as active. Section 12 also showed a tarball where the installer expects a bundle directory and used the server JWT signing secret as an API bearer token.

## Changes Made

- Synchronized Sections 3–4 with the four managed unit types and their role availability. Removed runner service/tmpfiles entries and documented the current runtime tmpfiles file and rendered API group.
- Removed obsolete plugin-owner/admin options from the server-install example. Updated activation, rollback, and recovery descriptions to reflect helper/API/web behavior and the helper’s warning-only startup failure.
- Updated the idle-suspend socket/group description to use the rendered API group rather than the retired plugin group.
- Corrected Section 12’s bundle operand to a directory containing `release-manifest.json` and its archive. Replaced the `server-token` bearer example with an MFA-issued session token and linked the Authentication API reference.
- Clarified the uninstall prerequisite check and made post-removal checks account for absent history directories and an inactive optional helper socket.
- No sealed plan, roadmap, prior receipt, or other documentation file was edited.

## Evidence and Verification

- `server/src/linux_release/constants.rs:76–82` defines the managed set as API, web, recovery, and helper; `server/tests/linux_release_native_phase07.rs:16–22` asserts the runner is excluded.
- `deploy/systemd/` service templates and `deploy/tmpfiles.d/dam-hopper-runtime.conf.in` confirm the current unit and API-group runtime contracts.
- `server/src/linux_release/cli.rs:84–102` defines `--bundle` and fresh-install role requirements; `server/src/linux_release/stage_transaction.rs:101–106` resolves the archive beneath the supplied bundle directory.
- `server/src/api/advisor.rs:33–40` verifies the Advisor status handler; `docs/authentication-api.md:7–11` distinguishes the MFA session bearer token from the server signing secret.
- `deploy/remove-plugin-platform.sh:35–39,144–169,184–193,231–264` confirms dry-run-by-default, native-unit prerequisites, mutation locking, allowlisted removal, and protection of history/shared-runtime paths.
- Attempted scoped smoke: `bash deploy/remove-plugin-platform.sh --scope system` returned exit 1 at the prerequisite because this host’s `/etc/systemd/system/dam-hopper-api.service` still references `dam-hopper-plugin-runner.conf`. The full dry-run did not complete; default mode was read-only and no changes were made. The Phase 07 tester report separately records the removal integration journey passing its dry-run, prerequisite, apply, history-preservation, and idempotence checks (`plans/reports/tester-261002-1530-phase-07-linux-runner-validation.md`).
- The repository lookup for `**/validate-docs.cjs` found no validator script, so the prescribed docs validator could not be run. No project-wide test/build/lint suite was run for this docs-only assignment.

## Gaps and Recommendations

- `docs/linux-systemd.md` remains **933 LOC**, above the 800-LOC target. Splitting it requires authorization for additional documentation paths; no files outside the authorized target were created.
- Before applying manual removal on the currently observed host, deploy and activate a native release so the installed API/helper units pass the script’s legacy tmpfiles/group prerequisite.
- Broader docs, codebase-summary refresh, and changelog synchronization were intentionally not attempted because this assignment authorized only `docs/linux-systemd.md`.

## Metrics

- Authorized product docs reviewed/updated: **1**.
- Sections synchronized: service roles/filesystem (3–4), installation/activation (5), rollback/recovery (7), helper runtime permissions (11), and retirement runbook (12).
- Overall repository documentation coverage and update cadence: **not measured**; outside this scoped review.

## Unresolved Questions

None within the authorized scope.
