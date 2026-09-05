# Research Report: GitHub Release publisher and artifact boundary

- **Date:** 2026-09-03
- **Scope:** central GitHub Actions publisher, Linux artifacts, manifest/attestation/bootstrap, version authority, Cargo + pnpm coordination, and the existing release-workflow conflict.
- **Accepted target:** one Fedora 44 x86_64 profile (`x86_64-unknown-linux-gnu`, glibc 2.43, systemd 259); public immutable Release; server/web roles (`server`, `web`, `both`); API `4801`, web `4802`; lockstep versions; pending install followed by explicit health-gated activation/rollback. Service lifecycle mechanics remain outside this report.

## Decision

Use one **custom, tag-driven GitHub Actions publisher** as the only owner of the stable `vX.Y.Z` Release. GitHub Releases are tag-based and carry public assets ([about Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)); a protected tag is the release input. Separate Rust and pnpm jobs build in parallel, a packaging job creates final archives plus machine-readable metadata, and a gated publish job verifies completeness before publishing an immutable Release. Keep the custom bootstrap/installer boundary: generic archive installers cannot express this product's host roles, separate API/web artifacts, or release metadata contract.

Use tar archives (one documented format, preferably `.tar.xz`) rather than `.deb`/`.rpm` for the first profile. Publish the installer, CLI/server/web archives, service assets, `release-manifest.json`, `SHA256SUMS`, and a detached manifest signature. GitHub artifact attestations supplement the signature with workflow provenance; checksums alone detect corruption, not a compromised publisher.

## Repository evidence and constraints

- [`package.json`](../../../package.json#L11-L28) has separate `pnpm build` (web) and `pnpm build:server` (Cargo) scripts; root is private, has no version, and requires Node >=20 / pnpm >=9.
- [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml#L1-L6) includes `apps/*` and `packages/*`; `pnpm-lock.yaml` uses lockfile v9. Release installs must use `pnpm install --frozen-lockfile`.
- [`server/Cargo.toml`](../../../server/Cargo.toml#L1-L25) exposes only `dam-hopper-server` at version `0.1.0`; its `vendored` feature is explicitly documented for portable CI binaries. The release profile strips, enables LTO, and uses one codegen unit ([`#L169-L173`](../../../server/Cargo.toml#L169-L173)).
- [`apps/web/package.json`](../../../apps/web/package.json#L1-L13) is private at `0.1.0`; its prebuild stages the browser extension and output is Vite `dist`.
- [`apps/web/vite.config.ts`](../../../apps/web/vite.config.ts#L12-L28) rejects `VITE_DAM_HOPPER_SERVER_URL` during production builds and defines built output as same-origin. This conflicts with a separately served web role on `4802` unless runtime API-origin configuration (or an explicit build-time contract) is added.
- [`server/src/main.rs`](../../../server/src/main.rs#L35-L53) defaults to `0.0.0.0:4800` and accepts exact CORS origins. Release units must explicitly select API `4801`; do not inherit the development `dev:server:no-auth` use of `4802`.
- [`server/src/api/settings.rs`](../../../server/src/api/settings.rs#L83-L91) exposes unauthenticated `/api/health` with the compiled Cargo version. [`server/src/api/router.rs`](../../../server/src/api/router.rs#L432-L446) still has an optional static SPA fallback and CORS allowlist; separate web hosting must define compatibility rather than silently relying on it.
- [`docs/linux-systemd.md`](../../../docs/linux-systemd.md#L1-L8) and [#L89-L103](../../../docs/linux-systemd.md#L89-L103) define the current production asset as backend-only on `4801`; current release packaging must not mistake that repository runner for the future two-service artifact set.
- [`.github/workflows/release.yml`](../../../.github/workflows/release.yml#L1-L20) is a Tauri desktop workflow: `v*` tags, PR/manual triggers, a Windows gate, Linux/Windows matrix, and `tauri-action` draft publishing ([#L98-L124](../../../.github/workflows/release.yml#L98-L124), [#L184-L200](../../../.github/workflows/release.yml#L184-L200)). It is not a safe concurrent publisher for server/web assets.
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml#L29-L49) already builds Linux Rust with `--features vendored`; its web job uses Node 20/pnpm 9 and uploads `apps/web/dist` ([web job](../../../.github/workflows/ci.yml#L80-L107)). This is reusable convention, not a release manifest or immutable publication.

## Publisher, artifacts, and manifest

1. **Trigger and authority:** accept only a protected, SemVer `vX.Y.Z` tag. Checkout the tagged commit; reject tag/version drift before any upload. Build jobs have read-only contents permission. Only the final publish job gets `contents: write` and an environment/reviewer gate.
2. **Build profile:** pin a Fedora 44 x86_64 runner/container, Rust target `x86_64-unknown-linux-gnu`, Node 20, pnpm 9, and the lockfile. Build the server with the documented vendored feature. Record the measured minimum glibc symbol requirement; the Rust target's documented glibc floor is not proof for this profile ([Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html#tier-1-with-host-tools)).
3. **Final assets:**
   - `dam-hopper-cli-vX.Y.Z-linux-x86_64-unknown-linux-gnu.tar.xz` (or the bootstrap/orchestrator binary once it exists);
   - `dam-hopper-server-vX.Y.Z-linux-x86_64-unknown-linux-gnu.tar.xz`;
   - `dam-hopper-web-vX.Y.Z-linux-x86_64-unknown-linux-gnu.tar.xz` containing `dist` and web service metadata (static bytes are architecture-neutral but profile-labeled for one matrix row);
   - versioned API/web service assets, either inside the component archives or as explicitly named files;
   - `dam-hopper-install.sh`, `release-manifest.json`, `SHA256SUMS`, and `release-manifest.json`'s detached signature.
   Keep user config, credentials, project trees, SQLite/runtime state, and generated host state out of all archives. Do not treat GitHub-generated source archives as product artifacts.
4. **Manifest:** use a versioned schema with `release_version`, exact `tag`, commit SHA, profile ID, target triple, measured `min_glibc`, `min_systemd`, supported host roles, API/web ports, and a component array containing archive name, component version, byte size, SHA-256, and service-asset names. Assert CLI/server/web versions are equal before signing. Include no secrets or mutable `latest` pointer.
5. **Integrity/provenance:** generate `SHA256SUMS` after final archive creation; attest the final archives and manifest with `actions/attest@v4` using `id-token: write`, `attestations: write`, and `contents: read` ([GitHub workflow](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)). Enable GitHub immutable releases so tag, commit, and assets cannot be replaced ([immutable releases](https://docs.github.com/en/repositories/releasing-projects-on-github/immutable-releases)). Pin every third-party Action to a full commit SHA ([secure use](https://docs.github.com/en/actions/reference/security/secure-use)).
6. **Bootstrap:** `dam-hopper-install.sh` accepts an exact version (recommended) or resolves a channel once to an exact tag, downloads only that tag's manifest/assets over HTTPS, verifies the detached manifest signature with an embedded rotatable Ed25519 public key, then verifies every archive digest before extraction. It must never execute mutable `main`/`latest` content and should record selected tag/digests for later recovery. GitHub attestation verification remains a documented `gh attestation verify`/offline option, not an assumed runtime dependency. The script bootstraps the exact CLI/orchestrator; the repository currently has no such Cargo binary, an implementation prerequisite.

The release order is therefore: protected tag → parallel Cargo/pnpm builds → archive/manifest/checksum generation → signature + GitHub attestations → draft Release upload → name/size/digest/lockstep completeness check → reviewer approval → immutable public publish. The installer then consumes artifacts; pending install and explicit health-gated activation/rollback are the downstream contract.

## Version and build coordination

Make the tag the sole release authority; do not use npm dist-tags or a mutable `latest` Release as rollback identity. CI must fail on drift between the tag, server Cargo metadata, web metadata, generated health/version metadata, and manifest. Current server/web/native declarations are all `0.1.0`, while root metadata is private and unversioned. Adopt either a checked-in version mirror consumed by both ecosystems or a deterministic tag-driven generation step, but never let CI silently publish a mixed version.

Run Cargo and pnpm in separate jobs from the same checkout/tag and release-version environment; upload only immutable intermediate outputs to the packaging job. Use `pnpm install --frozen-lockfile`, the web package's normal prebuild, and `pnpm --filter @dam-hopper/web build`; use an explicit release Cargo command equivalent to `cargo build --release --features vendored --target x86_64-unknown-linux-gnu`. The current `pnpm build:server` omits both the feature and target, so it is not by itself the release contract. Package only after both outputs and their generated version metadata pass checks.

## Existing workflow conflict

Do not let two workflows create or publish the same `vX.Y.Z` Release. Recommended cutover: reserve `v*` for the central server/web publisher and move the Tauri desktop workflow to a distinct tag namespace (for example `desktop-v*`) or make it artifact-only/manual. Alternative: fold desktop jobs into one dependency graph that uploads before the single publish gate, at the cost of coupling Windows runtime evidence and desktop packaging to the Linux release. Preserve desktop distribution intentionally; do not leave the current Windows gate and `contents: write` PR/manual paths racing the new publisher.

## Alternatives and tradeoffs

| Option | Exact tradeoff | Recommendation |
|---|---|---|
| **Custom GitHub Actions** | Highest control over one manifest, pnpm + Cargo, one profile, host roles, and bootstrap trust. Owns reproducibility, action pinning, signing keys, and maintenance. | **Use.** |
| **cargo-dist** | Strong Rust archives/checksums/target matrix, min-glibc knobs, extra artifacts, and attestation hooks ([workspace](https://raw.githubusercontent.com/axodotdev/cargo-dist/main/book/src/workspaces/workspace-guide.md), [config](https://raw.githubusercontent.com/axodotdev/cargo-dist/main/book/src/reference/config.md), [checksums](https://raw.githubusercontent.com/axodotdev/cargo-dist/main/book/src/artifacts/checksums.md)). Its shell installer cannot run custom install logic, needs common download/archive tools, and discards archive contents except the binary ([installer](https://raw.githubusercontent.com/axodotdev/cargo-dist/main/book/src/installers/shell.md)); it does not model a pnpm SPA or two independent services. | Optional Rust build/checksum stage only; do not use its installer/publisher as the deployment boundary. |
| **Native Fedora/Debian packages** | Package-manager upgrades, distro signing, users, unit placement, and dependencies are better integrated ([Fedora systemd packaging](https://docs.fedoraproject.org/en-US/packaging-guidelines/Systemd/), [Debian policy](https://www.debian.org/doc/debian-policy/ch-opersys.html)). Requires specs, repositories/signing, distro matrices, maintainer scripts, and package-manager lifecycle semantics; current Tauri `.deb`/`.rpm` outputs are desktop artifacts, not server/web packages. | Defer until distro integration is a stated requirement. |
| **npm wrapper/publisher** | `npx`/global CLI UX and dist-tags are convenient ([dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/)); npm provenance is useful ([trusted publishers](https://docs.npmjs.com/trusted-publishers/), [provenance](https://docs.npmjs.com/generating-provenance-statements)). Adds a second registry/trust/channel boundary, cannot own server/web service lifecycle, and current npm trusted publishing requires newer Node/npm than this repo's Node >=20 baseline. | Do not publish server/web through npm. Optionally publish a thin CLI wrapper only after GitHub assets exist. |

## Unresolved questions

1. Is the bootstrap target a new Rust CLI package/binary, or does the shell script remain the only orchestrator? Current Cargo metadata exposes only `dam-hopper-server`.
2. What serves `apps/web/dist` on `4802`, what runtime API-origin mechanism replaces the current same-origin-only build, and what web health/version endpoint is authoritative?
3. Should service assets be embedded in component archives or published as separate release assets, and what are their final names?
4. Is the version mirror a committed `VERSION` source or tag-driven generation, and must the native desktop package share the service release version?
5. What measured glibc policy should Fedora 44 artifacts advertise, and is a Fedora 44 builder/container mandatory versus an older-compatible builder?
6. Is detached Ed25519 verification mandatory for no-`gh` bootstrap, and how are public-key rotation and offline GitHub attestation roots maintained?
7. Should desktop assets share the public service Release, or use the distinct tag namespace recommended above?
