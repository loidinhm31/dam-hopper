# Phase 02 — PowerShell Bootstrap Installer

## Context links
- Parent: [plan.md](./plan.md)
- Asset contract: [Phase 01](./phase-01-asset-schema-and-packaging.md)
- Linux analogue: [dam-hopper-install.sh](../../deploy/release/dam-hopper-install.sh)
- Windows server commands: [README Windows qualification](../../README.md:168-193)
- Cross-platform config rules: [configuration guide](../../docs/configuration-guide.md:1-63)
- Existing release test style: [Linux clean-install harness](../../tests/deploy/linux-release-clean-install.sh)

## Overview
**Priority:** P1  
**Status:** Pending  
**Goal:** Add a non-admin `deploy/release/dam-hopper-install.ps1` that resolves an exact/latest stable release, authenticates its metadata, safely installs the server into the current user's LocalAppData, and leaves activation to the user.

The default destination is `%LOCALAPPDATA%\Programs\dam-hopper`; only
`bin\dam-hopper-server.exe` is on the optional User PATH. The installer copies
release notices and the example config beside the binary and creates
`dam-hopper.toml` only when that file does not already exist.

## Key Insights
- The Linux installer downloads a manifest/archive, verifies a declared digest, optionally verifies GitHub attestations, extracts minimally, and never starts services. Windows should retain those trust and activation boundaries without `sudo`/systemd concepts.
- A GitHub release asset's `digest` (`sha256:<hex>`) and `size` are the public Windows integrity authority. A resolver may consume a release manifest entry when a controlled mirror supplies one, but must fail closed if neither source provides a valid digest; never trust a checksum bundled only inside the unverified ZIP.
- `Expand-Archive` alone is insufficient for an untrusted archive because path normalization can hide traversal/link behavior. Enumerate and validate entries before writing, then copy only the four expected members into a private staging directory.
- Existing user configuration is valuable state. Never overwrite `dam-hopper.toml`; a rerun may replace the binary and immutable notices while preserving the user's registry.

## Requirements
### Functional
1. Define PowerShell parameters: `-Version <tag>` or `-Latest` (exactly one), `-InstallDir` (absolute path, default `%LOCALAPPDATA%\Programs\dam-hopper`), `-AddToPath`, `-VerifyAttestation`, and `-DryRun`; include `-?` help and reject unknown/conflicting values.
2. Validate stable `vMAJOR.MINOR.PATCH` tags and repository owner/name from a safe default or validated `GITHUB_REPOSITORY` override. Resolve `-Latest` through GitHub's latest-release API; resolve `-Version` through the tag endpoint.
3. Require the exact `dam-hopper-vX.Y.Z-windows-x86_64.zip` asset, `state=uploaded`, positive metadata size, and a lowercase SHA-256 digest from the release asset metadata (or an explicitly supported release-manifest source). Download only over HTTPS to a private temporary file and compare size plus `Get-FileHash` before installation.
4. With `-VerifyAttestation`, require `gh` and verify the downloaded Windows ZIP (and the bootstrap asset when downloaded for that check) against the repository; any failed/missing attestation aborts before install.
5. Validate and extract only root `dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, and `README.md`; reject traversal, directories, links/reparse metadata, duplicates, unsupported/encrypted members, and oversized content.
6. Stage atomically under a private sibling directory, copy the executable to `<InstallDir>\bin`, copy notices/example to `<InstallDir>`, and create `<InstallDir>\dam-hopper.toml` from the example only when absent. Do not execute the binary or automatically bind a port.
7. `-AddToPath` updates only the current user's `Path`, compares normalized paths case-insensitively, avoids duplicates, preserves existing entries, and updates the current process with a clear “open a new shell” message. It must not require elevation or touch Machine PATH.
8. `-DryRun` may resolve metadata and verify a temporary download/archive, but must not create/replace install files, create config, mutate PATH, or start a process; report intended actions and cleanup.
9. Add a Windows PowerShell harness covering install, upgrade/config preservation, dry-run, digest/metadata mismatch, unsafe archive, attestation-missing, invalid arguments, and cleanup.

### Non-functional
- Target Windows PowerShell 5.1-compatible syntax where practical; avoid requiring a package manager, Rust, Node, or Administrator rights on the end-user machine.
- Use bounded HTTP timeouts, response/file size limits, explicit TLS/HTTPS URLs, and deterministic temporary cleanup in `try/finally`.
- Keep user-visible errors actionable but do not echo authorization headers, tokens, arbitrary archive contents, or local secrets.

## Architecture
```text
-Version/-Latest + validated repo
              |
              v
 GitHub release metadata (tag, exact asset, size, digest)
              |
              v
 private download -> SHA-256/size -> optional gh attestation
              |
              v
 bounded ZIP inspection -> private staging tree
              |
              +--> DryRun: report + cleanup
              |
              +--> normal: atomic bin/notices/config -> optional User PATH
```

All writes are user-scoped. The final executable is invoked later by the user with an explicit `--config <InstallDir>\dam-hopper.toml`; the installer is not a service manager.

## Related code files
### Create
- `deploy/release/dam-hopper-install.ps1` — bootstrap parameter contract, API/download/digest/attestation flow, safe extraction, config/PATH writes.
- `tests/deploy/windows-release-install.ps1` — local fixture server/client harness and cleanup assertions.

### Modify
- `package.json` — expose the focused Windows installer harness/verification command from Phase 01.
- `deploy/release/check-release-assets.mjs` — consumed for the same ZIP contract; no second incompatible asset schema.
- `README.md` and `docs/configuration-guide.md` — Phase 03 documents user-facing invocation and config path.

### Verify/retain
- `deploy/release/build-windows-release-archive.mjs` supplies the exact four member names.
- `server/src/config/global.rs` and existing Windows path tests define config semantics; do not silently change server path resolution in this installer phase.

## Preflight Contract
- Run harnesses on a disposable Windows runner with PowerShell 5.1 and/or `pwsh`, Node 20+, and no Administrator assumption.
- Use a loopback-only local fixture HTTP server with synthetic release metadata and fake non-executable bytes; never hit a real production release during negative tests.
- Snapshot and restore User PATH in a `finally` block; use unique temp install roots and assert no child processes remain.
- Keep fixture credentials absent; set only a test repository/API base through a documented test-only environment override, not a new public installer flag.
- Verify the archive before any destination write and verify `-DryRun` leaves destination, config, and PATH byte-for-byte unchanged.

## Implementation Steps
1. Add a strict parameter block and validation helpers. Enforce exactly one of `Version`/`Latest`, normalize the tag, validate `InstallDir` as absolute, and reject unsafe repository/API overrides.
2. Add API helpers for latest/tag release lookup. Require HTTPS, bounded response bytes, exact tag identity, exact asset name, uploaded state, positive size, and a `sha256` digest; normalize optional `sha256:` prefixes and reject non-lowercase/invalid lengths.
3. Add download helpers using a private random temp directory, bounded timeouts, status checks, and post-download byte-size/hash comparison. Keep the ZIP and metadata in the same temp scope.
4. Implement optional manifest digest resolution only for an explicitly available release metadata/manifest source; prefer GitHub asset metadata and fail closed when sources disagree or are absent. Do not add a checksum file to the two-asset Windows profile.
5. Implement optional `gh attestation verify` calls after digest verification and before extraction. Verify the ZIP; download/verify `dam-hopper-install.ps1` as a second subject when the flag is requested, and fail if `gh` or either attestation is unavailable.
6. Implement a bounded ZIP enumerator using .NET compression APIs plus explicit central-directory/member checks. Validate root names, regular-file attributes, no links, path canonicalization, compressed/uncompressed limits, CRC, and exact four-member equality before extraction.
7. Extract each validated member into a private stage without honoring archive paths. Copy `dam-hopper-server.exe`, notices, and example TOML to the stage; preserve the destination config if it exists; reject an existing destination that is a file/symlink/reparse point where a directory is required.
8. Commit the stage with directory creation and replace operations that do not expose a partially copied executable. Keep old binary until the new file is verified; clean failed stage and leave prior installation/config untouched.
9. Implement opt-in User PATH update with separator-aware exact matching, canonical full path, duplicate elimination only for the new entry, environment length checks, `SetEnvironmentVariable(..., User)`, and current-process PATH update. Do not modify Machine PATH or unrelated entries.
10. Add `-DryRun` branches before every mutating operation and a final summary showing version, install path, binary path, config path, digest, and whether PATH was changed. Never claim installation when no write occurred.
11. Build the harness fixture server, run positive install/upgrade/dry-run cases, tamper metadata/archive cases, invalid flags, traversal/link cases, and teardown checks. Restore User PATH even when the child installer fails.
12. Add `release:windows-installer-test`/`release:verify-windows` package entry points and document that a fresh shell is required after PATH changes.

## Todo list
- [ ] Implement strict parameter and tag/repository validation.
- [ ] Implement metadata/manifest digest resolution and bounded download.
- [ ] Implement optional attestation verification.
- [ ] Implement safe ZIP inspection/extraction and atomic user-scoped install.
- [ ] Implement config-preserving sample creation and User PATH update.
- [ ] Add local fixture harness, tamper cases, and cleanup assertions.

## Success Criteria
- `-Version vX.Y.Z` and `-Latest` resolve only the intended stable Windows asset; conflicts and malformed tags fail before download.
- A valid archive installs the binary and notices under the requested directory, creates a sample config only once, and succeeds without elevation.
- Hash/size, metadata, attestation, ZIP traversal/link, and malformed-release failures leave no partial install and no PATH/config mutation.
- `-AddToPath` is idempotent and User-scoped; `-DryRun` performs no persistent side effect.
- Harness passes on Windows PowerShell/pwsh with all temporary files, servers, processes, and PATH changes cleaned.

## Risk Assessment
- **GitHub API schema/rate limits:** Bound requests, use exact endpoints/headers, surface rate-limit failures, and never fall back to unverified bytes.
- **PowerShell version differences:** Keep syntax 5.1-compatible, use .NET APIs available on supported Windows, and parse/test under both `powershell` and `pwsh` where available.
- **Archive extraction races:** Inspect then stage in a private directory, reject reparse points, and commit via controlled file operations.
- **PATH corruption:** Compare one normalized entry, preserve all unrelated entries, enforce length limits, and restore it in tests.
- **Interrupted upgrade:** Keep prior binary/config until staged replacement is complete; cleanup in `finally`.

## Security Considerations
- HTTPS-only GitHub API/download URLs and validated owner/name/tag prevent URL injection or repository confusion.
- Digest verification is mandatory; attestation is additive but fatal when requested. No same-archive checksum is trusted as an authority.
- No archive member is executed; only the expected `.exe` is copied, and no archive path is used as a destination without canonical containment.
- Installer runs as the invoking user, writes only the chosen User PATH/install/config locations, and never elevates or starts an unauthenticated server.
- Config creation uses a safe example with no credentials; existing user configuration is preserved and no `.env`/token/database file is accepted.

## Side-Effect Review Checklist
- [ ] Normal install writes only the selected install directory and optional User PATH.
- [ ] Existing `dam-hopper.toml` remains byte-identical on upgrade.
- [ ] Dry-run performs no persistent file, PATH, process, or registry mutation.
- [ ] Failed digest/attestation/archive checks leave no partial install.
- [ ] Harness restores PATH and removes temp roots/fixture server/processes.

## Next steps
Give Phase 03 the installer command grammar, exact download URL, config path, and attestation behavior for README/release documentation. Keep Windows installation separate from Linux roles/systemd activation.

## Unresolved Questions
None blocking. Confirm during implementation whether the supported end-user floor is Windows PowerShell 5.1 alone or PowerShell 7; the script should remain 5.1-compatible unless the repository explicitly narrows support.
