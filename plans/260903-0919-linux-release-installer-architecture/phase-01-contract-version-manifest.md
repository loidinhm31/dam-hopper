# Phase 01 — Contract, Version, and Manifest

## Context Links

- [Parent plan](./plan.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [Publisher research](./research/researcher-01-release-publisher.md)
- [System architecture](../../docs/system-architecture.md)
- [Rust package metadata](../../server/Cargo.toml)
- [Web package metadata](../../apps/web/package.json)

## Overview

- **Date:** 2026-09-03
- **Description:** Establish one strict release identity and machine-verifiable archive contract before installer behavior exists.
- **Priority:** P1
- **Implementation status:** Completed 2026-09-03 16:07:45 +07:00
- **Review status:** Passed
- **Effort:** 10h

## Key Insights

- The accepted one-archive decision overrides the publisher report's split archives and `.tar.xz` preference.
- The protected `vX.Y.Z` tag is release authority; checked-in Cargo and web package versions are mirrors that must match, not independent channels.
- Current format-2 `key=value` marker proves four local bytes only. It cannot represent profile, role, inventory, provenance, health, or rollback compatibility.
- A JSON Schema is useful at the publisher boundary, but Rust `serde` types with `deny_unknown_fields` remain the runtime parser. Both must describe the same schema version.

## Requirements

### Functional

- Define schema version `1`; reject absent, duplicate, unknown, ill-typed, or non-canonical fields.
- Require release tag, SemVer, 40-hex commit SHA, profile, archive metadata, four lockstep component versions, exact inventory, service contracts, and rollback declaration.
- Use one archive name: `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`.
- Inventory every directory and regular file. Files carry role set, octal mode, byte size, and lowercase SHA-256; directories carry role set and mode. Links and special entries are not representable.
- Roles are `common`, `server`, and `web`; `both` is the union, never a separately versioned component.
- Reject versions unless tag=`v{version}` and CLI/API/web-host/web-assets versions all equal `{version}`.

### Non-functional

- Canonical JSON is UTF-8, LF-terminated, deterministic key/order output, no credentials, mutable URLs, timestamps, or `latest` pointer.
- Parser limits: manifest ≤1 MiB, inventory ≤20,000 entries, path ≤255 bytes, no duplicate normalized paths.
- Existing source files stay below repository code-size guidance by splitting parsing, validation, and version logic.

## Architecture

Manifest v1 fields:

```text
schemaVersion: 1
release: {tag, version, commitSha}
profile: {id, osId, osVersion, arch, target, glibcMin, systemdMin}
archive: {name, size, sha256}
components: {cli, api, webHost, webAssets} -> {version}
inventory[]: {path, kind, roles[], mode, size?, sha256?}
services: api/web -> {unitName, identity, bindHost, port, healthPath}
rollback: {previousReleaseCompatible: true, stateCompatibility: "n-1"}
```

Fixed values: profile `fedora44-x86_64-systemd`; `fedora`/`44`; `x86_64`; `x86_64-unknown-linux-gnu`; glibc `2.43`; systemd minimum `259`; API `root` (per owner direction for MVP in parent plan, overriding initial `loidinh`), `0.0.0.0:4801`, `/api/health`; web `dam-hopper-web`, `0.0.0.0:4802`, `/__dam-hopper/health`.

Release views live at `/opt/dam-hopper/releases/<tag>/<role>/`. This refines the conceptual layout so a server-only host does not retain web bytes and an explicit same-version role change can create a new immutable view without mutating the old one.

## Related Code Files

### Create

- `deploy/release/release-manifest.schema.json` — publisher-facing strict schema.
- `server/src/linux_release/mod.rs` — focused release module exports.
- `server/src/linux_release/error.rs` — typed validation errors without secret/path dumps.
- `server/src/linux_release/version.rs` — tag/SemVer/component equality rules.
- `server/src/linux_release/manifest.rs` — strict types and cross-field validation.
- `server/src/linux_release/inventory.rs` — normalized path, role, mode, size, and digest checks.
- `server/tests/linux_release_manifest.rs` — public contract cases.

### Modify

- `server/src/lib.rs` — export `linux_release` on supported builds/tests.
- `server/Cargo.toml` — add only required SemVer/archive dependencies and declare manager/web binaries when their files land.
- `apps/web/package.json` — retain checked-in version mirror used by tag drift gate.

### Delete

- None.

## Implementation Steps

1. Define constants for schema/profile/ports/health paths in one Rust module; publisher generation imports the same serialized contract through the manager validation command rather than duplicating acceptance logic.
2. Implement strict SemVer and `v`-tag validation. Reject prerelease/build metadata for the stable v1 channel.
3. Model manifest types with `camelCase`, `deny_unknown_fields`, bounded deserialization input, and post-parse cross-field validation.
4. Normalize inventory paths as forward-slash relative UTF-8. Reject empty/dot components, `..`, absolute paths, NUL, backslash, repeated separators, duplicates, links, devices, sockets, FIFOs, and roleless entries.
5. Enforce exact required paths: three binaries, `web/` payload, two unit templates, web sysusers input, and license/notices. Validate each required path's role and mode.
6. Add the equivalent JSON Schema with `additionalProperties: false`, enums, formats/patterns, and upper bounds.
7. Add table-driven tests for valid server/web/both projections and every cross-field drift class, including mixed component versions and undeclared inventory.
8. Plan compile proof: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`.
9. Submit this phase to `evcrate-code-reviewer`; resolve every blocking finding, rerun the compile check, and require terminal approval before Phase 02 consumers rely on the types.

## Todo List

- [x] Add strict manifest/version/inventory types.
- [x] Add JSON Schema and parity cases.
- [x] Enforce profile, version, role, service, and rollback invariants.
- [x] Add bounded malformed-input tests.
- [x] Run listed compile check after implementation.
- [x] Pass scoped reviewer gate.

## Success Criteria

- One valid fixture round-trips without semantic change and validates against Rust plus JSON Schema.
- 100% of tested unknown fields, mixed versions, duplicate paths, unsafe paths, unsupported targets, wrong service values, and missing role inventory fail before extraction.
- Generated server/web/both projections contain exactly common + selected role paths; both has one version across all components.
- Manifest input over 1 MiB or 20,000 inventory entries is rejected with bounded diagnostics.
- Compile command exits `0`; reviewer reports no unresolved P1/P2 findings.

## Risk Assessment

- **Schema duplication drift:** Make Rust validator authoritative and add schema parity fixtures in CI.
- **Over-constrained future formats:** Version the schema; reject rather than guess, and require a new migration plan for v2.
- **Role/path ambiguity:** Enumerate required paths and compute set equality, not prefix-only membership.
- **Cargo/web version drift:** Fail the tag workflow before build artifacts upload.

## Security Considerations

- The manifest is metadata, not trust by itself; Phase 06 attests manifest and archive.
- Strict sizes/counts prevent memory and CPU abuse before privilege.
- Inventory cannot express symlinks or special files, eliminating those extraction classes by construction.
- Diagnostics name manifest fields and normalized relative paths only; never echo headers, credentials, or arbitrary file content.

## Next Steps

Phase 01 contract, version, and manifest types and validation are implemented, verified by tests, and approved by code review. Phase 02 is ready to consume these types for acquisition and safe staging. Phase 03 consumes component version and health constants. Unresolved questions: none.
