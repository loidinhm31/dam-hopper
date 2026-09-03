# Phase 02 — Rust CLI and Safe Acquisition/Staging

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 contract](./phase-01-contract-version-manifest.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [Publisher research](./research/researcher-01-release-publisher.md)
- [Current production runner](../../deploy/run-linux-production.sh)
- [Rust entry point](../../server/src/main.rs)

## Overview

- **Date:** 2026-09-03
- **Description:** Add the Linux manager CLI, immutable release fetch, attestation verification, host checks, and root-only role projection without starting services.
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Effort:** 18h

## Key Insights

- Target hosts need no repository, Node, pnpm, Cargo, or Rust. Public GitHub plus `curl`, `gh`, archive tools, and systemd are the v1 bootstrap prerequisites.
- Attestation-first overrides the research proposal for a detached Ed25519 signature. Checksums protect integrity only after the attested manifest establishes expected digests.
- Downloading as root expands network and parser risk. Acquisition must finish as the invoking user; privileged code copies already verified bytes to a root-only same-filesystem stage and re-verifies them.
- `tar::Archive::unpack` is too permissive. Extraction must walk entries and accept only manifest-declared regular files/directories.

## Requirements

### Functional

- Exact CLI grammar:
  - `dam-hopper fetch (--version vX.Y.Z | --latest) --output DIR`
  - `sudo dam-hopper install --bundle DIR [--role server|web|both] [--api-url URL] [--allow-web-origin ORIGIN ...]`
  - `sudo dam-hopper role set ROLE --bundle DIR [--api-url URL] [--allow-web-origin ORIGIN ...]`
  - `sudo dam-hopper activate`, `dam-hopper status [--json]`, `sudo dam-hopper rollback`, `sudo dam-hopper recover`, `dam-hopper version`.
- `fetch` resolves `--latest` once to an exact stable tag, downloads that tag's manifest/archive, and verifies GitHub attestations for both plus manifest/archive digest agreement.
- Fresh install requires explicit role. Upgrade inherits recorded role and URL/origin config; `install --role` cannot silently change it. `role set` is the only role-change path.
- Fresh web/both requires an exact HTTP(S) API URL. Allowed web origins are exact HTTP(S) origins with no path/query/fragment/userinfo; wildcard forbidden.
- Install creates one pending candidate only. It never switches `active`, stops/starts/enables units, opens ports, or removes the current release.

### Non-functional

- Manager refuses non-Linux, non-x86_64, non-Fedora-44, glibc below 2.43, systemd below 259, missing system manager, or wrong EUID for each command.
- User cache is mode `0700`; files are `0600`, opened no-follow/create-new. Root staging is mode `0700` under `/opt/dam-hopper/.staging` on the release filesystem.
- One nonblocking root deployment lock serializes install, role change, activate, rollback, recovery, and garbage collection.
- Network operations have bounded redirects, connect/read deadlines, response sizes, and GitHub-only HTTPS endpoints.

## Architecture

`fetch` uses GitHub's public release API only to resolve a tag and asset URLs. It persists `release-manifest.json`, the one `.tar.gz`, and an acquisition record containing exact tag, repository, subject digests, and verification time. `gh attestation verify FILE --repo loidinhm31/dam-hopper` is mandatory for manifest and archive. The record is diagnostic; privileged install repeats attestation verification and never trusts the record alone.

Privileged install performs: validate root-owned executable and sanitized environment → lock → re-open bundle paths without following links → invoke root-owned `gh` with a minimal environment and exact repository → stream-copy to root staging while hashing → compare source pre/post identity and length → validate manifest → enumerate tar entries → create only manifest-declared selected-role paths → hash/size/mode/set-equality verification → atomically rename candidate to `/opt/dam-hopper/releases/<tag>/<role>` → durably write `pending.json`.

The CLI binary remains a thin parser/dispatcher. Focused modules own GitHub acquisition, host profile, archive inspection, staging, layout, and command privilege policy.

## Related Code Files

### Create

- `server/src/bin/dam-hopper.rs` — thin manager executable.
- `server/src/linux_release/cli.rs` — Clap grammar and incompatible-argument rules.
- `server/src/linux_release/acquire.rs` — exact-tag GitHub fetch, limits, and redirects.
- `server/src/linux_release/attestation.rs` — constrained `gh attestation verify` execution.
- `server/src/linux_release/platform.rs` — Fedora/arch/glibc/systemd checks.
- `server/src/linux_release/archive.rs` — entry inspection and selected-role extraction.
- `server/src/linux_release/layout.rs` — canonical `/opt`, `/etc`, `/var/lib`, and test-root paths.
- `server/src/linux_release/stage.rs` — safe copy, root stage, role projection, and pending handoff.
- `server/src/linux_release/host_config.rs` — role/API URL/origin validation and persistence model.
- `server/tests/linux_release_cli.rs` — command grammar/privilege tests.
- `server/tests/linux_release_archive.rs` — real tar traversal, duplicate, link, device, mode, and inventory tests.
- `server/tests/linux_release_acquisition.rs` — bounded local HTTP transport tests; attestation subprocess contract remains separately exercised with real `gh` in Phase 08.

### Modify

- `server/Cargo.toml` — declare `dam-hopper` binary and minimal archive/SemVer dependencies.
- `server/src/lib.rs` — export focused release modules.
- `server/src/linux_release/mod.rs` — compose acquisition/staging surface.

### Delete

- None in this phase; legacy runner remains until Phase 07 migration proof.

## Implementation Steps

1. Implement Clap enums/subcommands and require user EUID for `fetch`, root EUID for mutation, and read-only status for either.
2. Parse `/etc/os-release`, architecture, `gnu_get_libc_version`, `systemd --version`, and system-manager availability; return distinct unsupported-profile diagnostics.
3. Implement exact-tag URL construction and bounded `--latest` resolution. Reject prereleases, redirects away from `github.com`/`objects.githubusercontent.com`, duplicate/missing assets, and tag drift.
4. Run `gh attestation verify` without a shell, with fixed argv, closed stdin, clean locale/path, bounded output, and no inherited GitHub token. Verify subjects match the bytes being installed.
5. Copy bundle inputs into root-only staging using no-follow opens; hash during copy and compare source metadata before/after to detect replacement/truncation.
6. Enumerate gzip/tar entries before write. Require exact manifest set for selected role; reject duplicate headers, links, sparse/special entries, PAX path overrides, excessive expansion, wrong modes, and extra bytes.
7. Extract only to the transaction stage. Because every ancestor is newly created root-owned `0700`, reject any pre-existing target and verify with `symlink_metadata` before final rename.
8. Persist pending candidate metadata only after directory and parent `fsync`; keep current service untouched.
9. Add real archive fixtures generated inside tests; no source-text assertions or mock filesystem.
10. Plan compile proof: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`.
11. Submit to `evcrate-code-reviewer`, fix all blocking findings, rerun compile proof, and require terminal approval.

## Todo List

- [ ] Add exact CLI grammar and privilege matrix.
- [ ] Add host-profile and URL/origin validation.
- [ ] Add bounded GitHub acquisition and mandatory attestation verification.
- [ ] Add root-safe copy, archive inspection, role projection, and pending persistence.
- [ ] Add malicious archive and acquisition boundary tests.
- [ ] Run compile check and pass scoped reviewer gate.

## Success Criteria

- `fetch` with either exact version or latest produces one exact-tag verified bundle; redirects, oversized responses, missing assets, prereleases, and wrong attestations fail.
- Before first privileged write, both release-manifest and archive attestations report valid subjects for the expected repository.
- Server/web/both staging trees equal manifest common+role sets byte-for-byte; server-only contains no web binary/assets/unit/sysusers data, web-only contains no API binary/unit.
- Every tested traversal, absolute path, duplicate, link, device, FIFO, mode drift, digest drift, decompression bomb bound, and source TOCTOU attempt leaves no pending state.
- Upgrade install leaves active PID, executable, listeners, health versions, unit enablement, and active pointer unchanged.
- Compile check exits `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **GitHub/attestation outage:** Fail before sudo; keep current service. No checksum-only fallback.
- **`gh` availability:** Make it an explicit Fedora profile prerequisite and preflight it before downloads.
- **Archive parser mistakes:** Exact inventory, regular-file-only model, expansion bounds, and root-private stage reduce attack surface.
- **Root/user TOCTOU:** Root copies open files, hashes them, checks metadata, and re-verifies attestation on copied bytes.
- **CLI bloat from server crate:** Keep binary-specific modules and measure release size; do not split a new workspace until evidence requires it.

## Security Considerations

- Never use `curl | sudo sh`, shell interpolation, mutable branch assets, checksum-only authenticity, or inherited credentials in root verification.
- Reject proxy variables and custom certificate roots in the privileged verifier; public GitHub trust uses host CA policy explicitly documented for Fedora.
- `status --json` emits versions/states only, not filesystem content, env, tokens, or arbitrary command output.
- Error cleanup removes only the current transaction's verified staging directory and never follows links.

## Next Steps

Phase 03 provides the web binary/assets consumed by role projection. Phase 04 installs validated unit and identity inputs. Unresolved questions: none.
