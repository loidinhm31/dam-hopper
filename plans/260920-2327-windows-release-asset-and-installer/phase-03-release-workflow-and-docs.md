# Phase 03 — Release CI Workflow & Guidance Documentation

## Context links
- Parent: [plan.md](./plan.md)
- Asset/ZIP contract: [Phase 01](./phase-01-asset-schema-and-packaging.md)
- Installer contract: [Phase 02](./phase-02-powershell-installer.md)
- Current workflow: [release-linux.yml](../../.github/workflows/release-linux.yml)
- Current release guide: [Linux publisher/bootstrap](../../docs/linux-release-publisher-bootstrap.md)
- Current manifest boundary: [Linux Manifest v2](../../docs/linux-release-manifest.md)
- User docs: [README](../../README.md), [configuration guide](../../docs/configuration-guide.md)

## Overview
**Priority:** P1  
**Status:** Pending  
**Goal:** Extend the stable release DAG with a Windows MSVC build/package path, attest both platform outputs, publish one exact six-asset release, and document safe Windows installation/configuration without blurring Linux systemd boundaries.

The Linux workflow remains the source of Linux Manifest v2 and migration evidence. Windows jobs produce only the two Windows public assets and never manufacture Linux manager evidence. Package jobs gate themselves by profile; only the final merged publication gate uses `--profile all`.

## Key Insights
- Current `release-linux.yml` has shared metadata validation, Linux Rust/web builds, a package job, four-subject attestation, and a draft-then-undraft publisher. Windows should branch after shared metadata and merge only at packaging/attestation/publication.
- `actions/upload-artifact` bytes, not rebuilt files, must flow into attestation and publication. This avoids digest drift between jobs.
- The combined gate must compose independent Linux and Windows validators. It must not turn the Windows ZIP into a Manifest v2 asset or require Windows migration evidence.
- README installation should be copyable from PowerShell, explain fresh-shell PATH behavior, preserve existing config, and state that the installer does not start the server.

## Requirements
### Functional
1. Add `build-rust-windows` on `windows-latest`; install stable Rust with `x86_64-pc-windows-msvc`, build the release `dam-hopper-server.exe` with the release feature set, verify its version, and upload only the required binary artifact.
2. Add `package-windows-release` after metadata/binary build. Checkout source inputs, download the exact binary artifact, invoke the deterministic packager twice with a fixed epoch, compare bytes/digests, copy `dam-hopper-install.ps1`, run `check-release-assets.mjs --profile windows`, and upload exactly the two Windows assets.
3. Make the Linux package job call `--profile linux` explicitly (or retain the default with an assertion) and upload its existing exact-four artifact under a distinct artifact name.
4. Extend the attestation job to consume both package artifacts and attest all six final subjects: Linux installer/archive/manifest/SBOM plus Windows installer/archive. Keep `id-token: write`/`attestations: write` scoped to that job.
5. Make publication depend on metadata, both package jobs, and attestation; download both immutable artifact bundles into one directory; create/update the draft; run `check-release-assets.mjs --profile all` against local and GitHub remote metadata; undraft only after the combined gate passes.
6. Preserve existing dry-run, protected-environment, stable-tag, and Linux migration-evidence semantics. `all` must pass Linux evidence options to the Linux subvalidator only; Windows contributes no migration record. Do not silently weaken a required Linux gate to make the Windows branch pass.
7. Update README with a Windows latest-release one-liner and explicit `-Version`, `-InstallDir`, `-AddToPath`, `-VerifyAttestation`, `-DryRun`, launch, upgrade, and fresh-shell commands.
8. Update `docs/configuration-guide.md` with Windows install/config paths, quoted drive paths, sample config creation, loopback smoke, PATH behavior, and Linux-only feature boundaries. Update release documentation with the two profiles, six-asset publication set, digest/attestation source, and profile-specific gate commands.

### Non-functional
- Keep build/package jobs read-only; retain `contents: write` only in `publish-release` and attestation permissions only where required.
- Use pinned action major versions already used by the workflow, frozen dependencies where applicable, fixed `SOURCE_DATE_EPOCH`, and no source rebuild between gate/attestation/publication.
- Documentation must distinguish direct Windows server operation from Linux systemd roles, manager migration, and unsupported Windows service management.

## Architecture
```text
vX.Y.Z / manual tag
        |
        v
validate-metadata (shared version/tag)
      /                         \
     v                           v
build-rust + build-web       build-rust-windows
     |                           |
     v                           v
package-release (linux)      package-windows-release
  profile=linux                 profile=windows
      \                         /
       v                       v
       attest-release (six immutable subjects)
                       |
                       v
publish-release (merge artifacts -> profile=all local/remote gate -> undraft)
```

Publication is still a draft-first transaction. The release directory is the only input to the final gate; no job reconstructs bytes from source after attestation.

## Related code files
### Modify
- `.github/workflows/release-linux.yml` — Windows build/package jobs, distinct artifacts, six-subject attestation, merged publication and `--profile all` gate.
- `README.md` — Windows one-liner, manual installer and server commands, options/limitations.
- `docs/configuration-guide.md` — Windows release/configuration/runbook and smoke checklist links.
- `docs/linux-release-publisher-bootstrap.md` — cross-platform asset table, DAG, profile gates, Windows bootstrap section.
- `docs/linux-release-manifest.md` — explicit Linux-only Manifest v2 boundary and Windows digest/ZIP pointer (do not add Windows fields to the schema).

### Create/consume
- `deploy/release/build-windows-release-archive.mjs` and `deploy/release/dam-hopper-install.ps1` from Phases 01/02.
- `deploy/release/check-release-assets.mjs` profile CLI from Phase 01.
- `package.json` Windows package/verification scripts from Phase 01/02.

### Verify/retain
- Existing Linux package, attestation, protected-environment, and migration-evidence fixtures; do not rename Linux public assets or role docs.

## Preflight Contract
- Confirm Phase 01/02 contracts are complete before editing workflow/docs; run from repository root with `gh`, Node/pnpm, and a Windows-capable CI runner available.
- Use a stable `vX.Y.Z` tag and exact Cargo/web version alignment; manual dry-run must exercise package/attestation gates without undrafting.
- Keep package outputs isolated by platform, use a fixed epoch, and merge only downloaded artifact bytes.
- Treat `profile=linux` and `profile=windows` as independent required checks; `profile=all` is the final union check, not a replacement for either package gate.
- Record actual workflow gate results and asset names/digests; do not claim Windows attestation or live installation from YAML inspection alone.

## Implementation Steps
1. Extend workflow metadata outputs only as needed for the shared tag/version; keep existing SemVer validation and version-alignment check unchanged.
2. Add `build-rust-windows` with checkout, stable MSVC target, cache, serial/reproducible release build, `dam-hopper-server.exe --version`, and a one-day binary artifact upload.
3. Add `package-windows-release` on `windows-latest`: setup Node/pnpm, download binary, invoke archive script twice with `SOURCE_DATE_EPOCH`, compare `Get-FileHash`/size, stage the PS1, and run the Windows profile gate.
4. Rename Linux artifact output only if necessary to avoid collisions; update downstream download names and add explicit `--profile linux` to the Linux package gate.
5. Merge both artifact bundles in `attest-release`. Use six explicit `subject-path` entries and least-privilege provenance permissions. Fail if any expected subject is absent.
6. Update `publish-release` dependencies and download steps. Stage a single `artifacts/final`, upload all files to the draft, query its release ID, then run the checker with `--profile all`, repository/tag selectors, and the existing Linux migration-gate flags/approval policy.
7. Keep stale-draft cleanup and `dry_run` behavior explicit. A dry run can build/package/attest and run local checks but must not undraft or write the public release.
8. Add README PowerShell quickstart. Prefer a one-liner that downloads the installer to a temp path, invokes `-Latest -AddToPath`, and removes/retains the script intentionally; then show exact-version and custom-directory commands.
9. Add manual server launch examples using `--config "$env:LOCALAPPDATA\Programs\dam-hopper\dam-hopper.toml"`, loopback/no-auth smoke guidance for development only, and a note to open a new shell after PATH changes.
10. Expand configuration/release docs with archive member/public asset tables, API digest versus optional manifest source, `gh attestation verify`, profile commands, rollback/update behavior (binary replacement, config preservation), and explicit Linux-only migration/systemd boundaries.
11. Run YAML/action syntax checks available in the repository, focused Node/PowerShell gates, and a workflow dry run or controlled tag rehearsal. Verify docs links and command shells before final review.
12. Review final asset directory and permissions; ensure no generated artifact, token, local path, or unverified test result is committed.

## Todo list
- [ ] Add Windows build and package jobs with explicit target/artifact paths.
- [ ] Add platform-specific profile gates and merged six-asset final gate.
- [ ] Attest all six subjects with least-privilege permissions.
- [ ] Preserve dry-run/protected Linux migration semantics.
- [ ] Publish README/configuration/release guidance and verify links/commands.
- [ ] Complete workflow rehearsal and side-effect review.

## Success Criteria
- A stable-tag workflow builds `dam-hopper-server.exe`, emits a deterministic Windows ZIP plus installer, and passes `profile=windows` independently.
- Linux package validation remains exact-four and passes unchanged; final merged release contains exactly six non-empty assets with local/remote size and digest equality.
- Attestation covers every published subject before undraft; Windows is never asked for Linux Manifest v2 or migration evidence.
- Dry-run/manual dispatch cannot publish; protected environment and Linux migration controls remain effective.
- README and docs provide copyable PowerShell installation, upgrade, config, attestation, dry-run, and loopback commands with honest platform boundaries.

## Risk Assessment
- **Runner/action differences:** Pin/setup Node, pnpm, Rust target, and PowerShell explicitly; make missing tools fatal.
- **Artifact path collisions:** Use distinct artifact names and clean merge directory; assert expected six names before release upload.
- **Attestation/publication race:** Publish only downloaded attested bytes and gate GitHub remote metadata before undraft.
- **Migration gate coupling:** Keep profile dispatch and Linux evidence flags explicit; add a regression fixture proving Windows-only checks do not invoke migration code.
- **Documentation drift:** Link exact script/flag names and rerun command snippets against the harness after installer changes.

## Security Considerations
- Build/package jobs require no `contents: write`; publication is draft-first and protected. Attestation identity permissions remain isolated.
- Final gate compares remote asset names, positive sizes, and SHA-256 digests; reject extra/missing/duplicate assets before undraft.
- Keep the public Windows installer non-admin, digest-first, safe-extraction, and no-auto-start contract visible in docs; warn that fetching/running a script remains a trust decision.
- Never document `--no-auth` as production operation; loopback-only smoke is the boundary. Do not imply Windows has systemd, Linux migration, or suspend support.

## Side-Effect Review Checklist
- [ ] Linux workflow jobs, asset names, Manifest v2, and evidence semantics remain intact.
- [ ] Windows package artifacts are isolated, deterministic, and contain no runtime secrets.
- [ ] Attestation subjects exactly match the six final files.
- [ ] Combined gate runs before `gh release edit --draft=false` and honors dry-run/protected environment.
- [ ] Documentation paths, command examples, and option names match implementation.
- [ ] No generated release bytes, credentials, local machine paths, or temporary logs are committed.

## Next steps
After implementation, run the main agent's project-wide validation and a controlled release rehearsal. Capture real workflow/installer evidence separately from plan assumptions; update release docs only with observed results.

## Unresolved Questions
None blocking. Decide whether to keep the existing document filename `linux-release-publisher-bootstrap.md` for the now cross-platform publisher or add a later neutral alias; do not create a duplicate guide in this change.
