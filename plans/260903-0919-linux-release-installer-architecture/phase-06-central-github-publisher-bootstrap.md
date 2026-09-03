# Phase 06 — Central GitHub Publisher and Bootstrap

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 manifest](./phase-01-contract-version-manifest.md)
- [Phase 02 manager](./phase-02-rust-cli-safe-acquisition-staging.md)
- [Phase 03 web host](./phase-03-web-host-runtime-origin-health.md)
- [Publisher research](./research/researcher-01-release-publisher.md)
- [Current desktop release workflow](../../.github/workflows/release.yml)
- [Current CI workflow](../../.github/workflows/ci.yml)

## Overview

- **Date:** 2026-09-03
- **Description:** Build Cargo and pnpm outputs once from a protected tag, assemble one reproducible Fedora archive, attest it, and publish one complete immutable public Release with a non-root bootstrap.
- **Priority:** P1
- **Implementation status:** DONE 2026-09-04 01:05:00 +07:00
- **Review status:** PASSED Review Cycle 2 (Score 9.5/10, report: `plans/reports/code-review-260904-0115-phase-06-central-github-publisher-bootstrap.md`)
- **Progress:** 100% (12/12 implementation steps; 7/7 todo items)

## Key Insights

- Current `release.yml` lets Tauri own `v*` draft Releases. A second stable publisher would race. Give desktop a distinct `desktop-v*` namespace and make one new workflow sole owner of stable `vX.Y.Z`.
- CI's Ubuntu binary is evidence only, not the Fedora 44/glibc 2.43 product profile. Stable output must build in a digest-pinned Fedora 44 environment.
- Publication must be all-or-nothing: final bytes first, attest exact subjects, upload to a draft, verify asset set, then publish once under an environment approval gate.
- Installer is bootstrap only. It ends at pending install and never hides activation behind a flag.

## Requirements

### Functional

- Stable workflow triggers only exact `vMAJOR.MINOR.PATCH` tags and manual dry-run/package verification; stable publish requires protected tag and `linux-release` environment approval.
- Desktop workflow triggers `desktop-v*`/manual only and cannot create or mutate stable `v*` Releases.
- Build exactly `dam-hopper`, `dam-hopper-server`, and `dam-hopper-web` with release profile, explicit `x86_64-unknown-linux-gnu`, `vendored`, Rust 1.97.1, Fedora 44 image digest, Node 20, pnpm 9, and frozen lockfile.
- Build `apps/web/dist` with exact release version and normal browser-extension staging.
- Assemble deterministic `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz` containing only manifest-declared binaries, selected-role source inventory, `web/`, templates, sysusers input, license, and notices.
- Public assets: `dam-hopper-install.sh`, one archive, `release-manifest.json`, and SPDX JSON SBOM. GitHub artifact attestations cover all four final subjects; the manifest declares the archive and internal inventory.
- Reject tag/Cargo/web/compiled-health drift, wrong target/ELF/interpreter/glibc floor, dirty/unexpected inventory, nondeterministic rebuild mismatch, and missing attestations before publish.
- Bootstrap grammar mirrors manager install options: `dam-hopper-install.sh (--version vX.Y.Z | --latest) --role ROLE [--api-url URL] [--allow-web-origin ORIGIN ...]`.
- Bootstrap downloads as caller, verifies installer provenance instructions, manifest/archive attestations and digest, extracts only the verified manager to mode-0700 temp, then invokes manager install via interactive sudo. It never activates.

### Non-functional

- Every third-party Action in touched release workflows is pinned to a full commit SHA; build jobs have read-only contents, attestation job has only `id-token:write`/`attestations:write`, final publish alone has `contents:write`.
- `GITHUB_TOKEN` is not passed to build scripts or artifacts. Secrets, env files, runtime config, caches, and source archives are excluded.
- `SOURCE_DATE_EPOCH` derives from tagged commit; tar order, uid/gid, modes, gzip timestamp, locale, and timezone are fixed.
- Release immutability repository setting and protected-tag rules are required external gates, queried/recorded before first stable publish.

## Architecture

Workflow DAG:

```text
validate tag/version/profile
  ├─ rust (Fedora 44 digest) ─┐
  └─ web (Node20/pnpm9) ──────┤
                              ├─ assemble twice + compare
                              ├─ schema/inventory/ELF/glibc/SBOM gates
                              ├─ attest installer/archive/manifest/SBOM
                              └─ draft upload → exact asset verification
                                  → environment approval → public immutable release
```

`build-release-archive.sh` normalizes modes/order and writes archive only. `generate-release-manifest.mjs` hashes staged inputs and emits deterministic JSON. The Rust manager validates the generated manifest and archive, preventing a second permissive validator. `check-release-assets.mjs` compares release API assets by exact name/size/digest before publication.

Attestation is the v1 authenticity boundary. Do not add detached Ed25519 keys, npm publication, native packages, multi-architecture matrices, or automatic updater channels.

## Related Code Files

### Create

- `.github/workflows/release-linux.yml` — sole stable `vX.Y.Z` publisher.
- `deploy/release/build-release-archive.sh` — deterministic one-archive assembly.
- `deploy/release/generate-release-manifest.mjs` — manifest generation from exact staged bytes.
- `deploy/release/check-release-assets.mjs` — pre-publication exact asset gate.
- `deploy/release/dam-hopper-install.sh` — published non-root bootstrap source.
- `server/tests/linux_release_publisher_contract.rs` — manager validation of publisher fixtures.

### Modify

- `.github/workflows/release.yml` — rename display purpose, change tag namespace to `desktop-v*`, remove stable-release ownership/race, minimize permissions, and pin touched Actions.
- `.github/workflows/ci.yml` — compile all three Rust binaries and validate release scripts/schema without publishing.
- `package.json` — add focused local release-package/check scripts; remove none until Phase 07.
- `apps/web/package.json` — enforce tag mirror version in workflow.
- `server/Cargo.toml` — ensure all component binaries share the package version and vendored release feature.
- `deploy/release/release-manifest.schema.json` — final public asset/internal inventory contract.
- `server/src/linux_release/manifest.rs` — expose deterministic validation command path used by packaging gate.

### Delete

- None.

## Implementation Steps

1. Move desktop tag ownership to exact `desktop-v*`; ensure PR/manual jobs cannot publish and no desktop job has stable `v*` write access.
2. Add stable tag/version gate comparing ref, Cargo package, web package, and compiled `--version`/health metadata before any publish permission exists.
3. Build Rust in a digest-pinned Fedora 44 environment with explicit toolchain/target/features; record `file`, ELF dynamic dependencies, and measured GLIBC symbol maximum as bounded evidence.
4. Install pnpm dependencies frozen and build web with release version; reject host-specific API URL in dist.
5. Stage exact archive inventory. Normalize and assemble twice in clean directories; SHA-256 outputs must match.
6. Generate schema-valid manifest after final archive bytes exist. Resolve the archive digest circularity by keeping `release-manifest.json` external, never inside the archive.
7. Generate SPDX SBOM for Rust, JavaScript lockfile, binaries, and archive inventory; scan artifact names/content for prohibited env/key/credential material.
8. Have the built manager validate manifest/archive/role projections. Attest installer, archive, manifest, and SBOM with GitHub's supported attestation Action.
9. Create/upload a draft release, query it back, and require exact four-asset name/size/digest set. Publish only after protected environment approval and immutable-release setting check.
10. Implement bootstrap with strict flags, 0700 temp/trap, exact tag resolution, bounded downloads, mandatory `gh attestation verify`, checksum check, exact manager extraction, interactive sudo, and no activate/start option.
11. Plan compile/static proofs: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`; `pnpm --filter @dam-hopper/web build`; `bash -n deploy/release/build-release-archive.sh deploy/release/dam-hopper-install.sh`; Node manifest/asset check commands in dry-run mode.
12. Submit to `evcrate-code-reviewer`; fix blocking supply-chain/workflow findings and rerun proofs before approval.

## Todo List

- [x] Isolate desktop and stable tag namespaces.
- [x] Add least-privileged stable publisher DAG (fix GHA tag glob pattern `v*`).
- [x] Add deterministic archive/manifest/SBOM generation (fix `tar --format=posix`, `--no-recursion`, intermediate directory exclusion in `build-release-archive.sh`).
- [x] Add attestation and exact draft completeness gates.
- [x] Add bootstrap that ends pending without root network fetch.
- [x] Add publisher contract tests and compile/static checks.
- [x] Pass scoped reviewer gate (resolve 4 critical packaging and workflow issues).

## Success Criteria

- One protected stable tag produces one public immutable Release with exactly the four declared assets; names, sizes, digests, tag, commit, and versions agree.
- Rebuilding from the same checkout/profile yields identical archive and manifest SHA-256 values.
- `gh attestation verify` succeeds for all four subjects against the exact repository; missing/wrong provenance prevents publish and install.
- ELF/profile checks prove x86_64 GNU output built on Fedora 44 and no GLIBC requirement above 2.43.
- A clean Fedora host bootstrap requires no checkout, Node, pnpm, Rust, Cargo, npm registry, or local build and leaves one pending role with zero started/enabled app units.
- Desktop workflow cannot observe `vX.Y.Z`; stable workflow cannot publish `desktop-vX.Y.Z`.
- Compile/static commands exit `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **GitHub immutable-release feature availability:** Treat repository setting as a go/no-go prerequisite; do not emulate mutability with conventions.
- **Fedora container provenance:** Pin image digest and record it; runtime systemd evidence remains Phase 08 protected-host work.
- **Nondeterministic Vite/Rust bytes:** Compare clean rebuilds; block release rather than weaken reproducibility claim.
- **Tauri workflow breakage:** Keep desktop manual/namespace path and test dry-run separately, without coupling it to Linux service publication.
- **Action compromise:** Full-SHA pins, minimal permissions, no secrets in build jobs, environment approval.

## Security Considerations

- Protected tag and immutable public release prevent after-the-fact asset/tag replacement.
- Checksums do not replace attestations. There is no permissive offline or checksum-only bootstrap fallback.
- Draft remains private-to-workflow until complete; partial public releases are forbidden.
- GitHub-generated source archives are not product assets and are never consumed by installer.

## Next Steps

1. All 4 critical packaging and workflow defects from Review Cycle 1 resolved and verified.
2. 24/24 Rust integration contract tests and syntax/alignment verification suites passing.
3. Proceed to Phase 07: Format 2 Migration and Runner Retirement (`phase-07-format-2-migration-runner-retirement.md`).
