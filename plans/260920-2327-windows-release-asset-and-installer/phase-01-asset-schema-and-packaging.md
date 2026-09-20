# Phase 01 — Asset Specification & Packaging Script

## Context links
- Parent: [plan.md](./plan.md)
- Existing gate: [check-release-assets.mjs](../../deploy/release/check-release-assets.mjs)
- Existing packager: [build-release-archive.sh](../../deploy/release/build-release-archive.sh)
- Existing package scripts: [package.json](../../package.json)
- Windows target qualification: [Windows build plan](../260920-1312-windows-server-build-and-verify/plan.md)
- Example input: [fixture config](../../__fixtures__/workspace/dam-hopper.toml), [LICENSE](../../LICENSE), [README](../../README.md)

## Overview
**Priority:** P1  
**Status:** DONE (2026-09-21; 100%)
**Goal:** Define profile-aware release asset contracts and produce a byte-reproducible Windows x86_64 ZIP without changing Linux publication semantics.

The stable Windows profile contains exactly two top-level release assets:
`dam-hopper-install.ps1` and `dam-hopper-vX.Y.Z-windows-x86_64.zip`. The ZIP contains exactly four root regular files: `dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, and `README.md`.

## Key Insights
- Current `check-release-assets.mjs` validates one Linux Manifest v2 contract and its exact four public assets. Appending Windows names to that list would break Linux package tests.
- `--profile linux` must remain the default and retain all current manifest, SBOM, installer-syntax, archive-digest, and migration checks.
- `--profile windows` has no Linux Manifest v2 or migration-evidence requirement. `--profile all` runs both validators against one merged directory and returns the union of six exact public names.
- Windows archive reproducibility requires explicit entry order, UTF-8 names, fixed DOS timestamp derived from `SOURCE_DATE_EPOCH`, fixed compression settings, no host permissions/extra fields, and stable CRC/size fields.

## Requirements
### Functional
1. Parse `--profile linux|windows|all`; reject unknown values; default to `linux` for CLI, package scripts, and existing callers.
2. Linux profile preserves exact four names and current local/remote digest/size checks.
3. Windows profile requires exactly the installer and tag-specific ZIP, non-empty regular files, PowerShell parse success, and matching remote `size`/`sha256[:digest]` metadata.
4. Inspect ZIP central-directory and local-header records with bounded sizes. Require only the four named root regular files; reject directories, links/reparse metadata, duplicate names, absolute paths, `.`/`..`, backslashes, NULs, encrypted entries, unsupported methods, and trailing/hidden members.
5. `all` validates Linux and Windows subsets independently, compares the six-name union remotely, and applies Linux migration evidence only when the existing Linux gate is requested. Passing a Windows profile must never require migration evidence.
6. `build-windows-release-archive.mjs` accepts a normalized `vX.Y.Z` tag plus binary/input/output options, rejects missing or non-regular inputs, and emits the exact archive name.
7. Add package commands for Windows archive creation, Windows/all profile gates, deterministic package-twice verification, and Windows release-script verification without making Linux-only scripts depend on PowerShell.

### Non-functional
- Use Node standard library only unless an existing dependency is proven necessary; do not add a general archive framework.
- Bound archive size, entry count, member names, decompressed bytes, and metadata before allocation/extraction.
- Produce LF/UTF-8 logs and stable, actionable failures; never print arbitrary archive contents or environment secrets.

## Architecture
```text
build-rust-windows output + fixture inputs
                 |
                 v
 build-windows-release-archive.mjs
   deterministic ZIP -> windows asset directory
                 |
                 +--> check profile=windows (two assets + four members)
                 |
 Linux package dir + Windows package dir --merged--> profile=all
                 |                                      |
                 +--> profile=linux (Manifest v2) -------+--> six-name gate
```

The ZIP writer owns reproducibility; the asset checker owns publication policy. The checker should expose small profile-specific validators internally rather than one unconditional expected-name list.

## Related code files
### Modify
- `deploy/release/check-release-assets.mjs` — profile parser, expected sets, Linux/Windows validators, ZIP contract, profile composition.
- `package.json` — Windows packaging and verification scripts; retain existing Linux script behavior.

### Create
- `deploy/release/build-windows-release-archive.mjs` — deterministic ZIP writer and CLI.
- `tests/deploy/windows-release-package-twice.ps1` (or an equivalent existing-shell harness) — two-build byte comparison and profile gate fixture.

### Verify/retain
- `.github/workflows/release-linux.yml` consumes the new script in Phase 03.
- `__fixtures__/workspace/dam-hopper.toml`, `LICENSE`, and `README.md` remain source inputs; do not package runtime configs, tokens, `.env`, databases, or build output accidentally.

## Preflight Contract
- Build/test from repository root with Node 20+; Windows binary target is `x86_64-pc-windows-msvc`.
- Use a fixed tag and `SOURCE_DATE_EPOCH`; stage inputs in private temporary directories and delete them on success/failure.
- Confirm Linux package-twice and release asset checks still run with no `--profile` argument.
- Ensure `pwsh` is installed on every runner that invokes Windows/all profile syntax checks; missing parser is a release failure, not a skip.
- Keep migration evidence handling Linux-only; do not invent a Windows Manifest v2 or manager-state record.

## Implementation Steps
1. Extract the current Linux expected-name and local/remote digest logic behind explicit `linux` profile functions; preserve error wording where practical.
2. Add profile parsing/usage text and a profile-to-asset-contract map. Reject `--migration-evidence`/required migration mode for `windows`; allow `all` to pass Linux evidence to the existing gate once.
3. Implement bounded ZIP inspection: parse EOCD/central directory, enforce limits and exact member names, verify regular-file attributes and local-header offsets, inflate supported entries, and compare declared/uncompressed sizes and CRCs.
4. Add Windows local validation for PowerShell syntax (PowerShell AST parser), ZIP contract, non-empty files, and local SHA-256/size records. Reuse remote metadata comparison for both profiles.
5. Make `all` call Linux and Windows local validators on the same directory, merge digest maps, and check the six-name remote union without applying Windows migration semantics.
6. Implement packager argument parsing and tag normalization. Default binary to the Windows Cargo release output but require an explicit path in CI; default input files to the checked-in fixture, `LICENSE`, and root `README.md`.
7. Stage four files under root names, reject links/non-regular inputs, normalize bytes/entry order/timestamps, write a deterministic ZIP, then read it back through the same contract assumptions and print size/digest.
8. Add package scripts such as `release:windows-archive`, `release:windows-check-assets`, `release:windows-package-twice`, and `release:verify-windows`; keep `release:verify` Linux-safe and add Node syntax coverage for the new `.mjs`.
9. Add positive/negative fixtures for missing assets, extra assets, wrong tag, empty files, malformed PS1, traversal/duplicate/link ZIP members, CRC mismatch, non-deterministic rebuilds, and profile/migration combinations.
10. Run focused profile gates and package-twice checks before Phase 02 consumes the exact names and member contract.

## Todo list
- [x] Add profile CLI and preserve Linux default behavior — DONE (2026-09-21).
- [x] Implement Windows exact-two gate and four-member ZIP inspection — DONE (2026-09-21).
- [x] Implement deterministic ZIP writer with normalized metadata — DONE (2026-09-21).
- [x] Add package scripts and package-twice harness — DONE (2026-09-21).
- [x] Add malformed-asset/profile regression fixtures — DONE (2026-09-21).

## Success Criteria
- `node deploy/release/check-release-assets.mjs --tag vX.Y.Z --dir <linux-dir>` still requires exactly four Linux assets.
- `--profile windows` accepts only the two Windows assets and rejects every unsafe ZIP member; `--profile all` accepts only the six-name union.
- Two packager runs with identical inputs and epoch have identical bytes and SHA-256; changed inputs change the digest.
- Local and GitHub-style remote metadata checks agree on every asset's positive size and lowercase SHA-256.
- `node -c` and PowerShell parser checks pass for release scripts; focused negative fixtures fail closed.

## Risk Assessment
- **ZIP format errors:** Use round-trip inspection, fixed compression, CRC/size checks, and a small fixture corpus.
- **Runner tool drift:** Pin Node/pnpm in workflow and fail clearly when `pwsh` or required archive support is absent.
- **Profile regression:** Keep Linux validator isolated, run Linux package-twice unchanged, and make `all` a composition rather than a replacement.
- **Timestamp/platform variance:** Convert epoch to ZIP's representable UTC DOS timestamp and document the chosen normalization.

## Security Considerations
- Never trust ZIP paths, external attributes, compression ratios, or declared sizes; enforce canonical root-only members and bounded decompression.
- Do not follow symlinks/reparse points while reading source inputs or extracting test fixtures.
- Restrict accepted tags, output paths, and remote metadata types; compare full lowercase digests and exact byte sizes.
- Keep Linux migration evidence and manager inventory out of Windows assets; do not broaden release trust claims.

## Side-Effect Review Checklist
- [x] Existing Linux exact-four tests pass without flags.
- [x] Linux Manifest v2/SBOM/migration checks are unchanged except profile dispatch.
- [x] Windows package output contains no `.env`, token, database, generated target tree, or secret.
- [x] Temporary staging and fixture directories are removed even after validation failure.
- [x] No global Git, PATH, or user configuration is touched by packaging tests.

## Next steps
Phase 01 is complete and ready for [Phase 02](./phase-02-powershell-installer.md) — PowerShell installer and harness. Phase 03 must consume the same Windows archive name and run profile-specific gates before the combined publication gate.

## Unresolved Questions
None blocking. The Node standard-library ZIP decoder and deterministic packager are selected and validated; Phase 02 can consume the finalized asset names and profile contracts.
