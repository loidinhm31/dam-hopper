# Brainstorm Decision: Linux Release, Install, and Runtime Architecture

## Decision status

Accepted.

**Architecture name:** **Manifest-Gated Immutable Release with Role-Selected Dual systemd Services**

This is a project decision name, not one canonical industry pattern. It combines immutable release artifacts, manifest-gated installation, role-based deployment, independent systemd supervision, transactional activation, and health-gated rollback.

## Problem statement

Current Linux production requires a repository checkout and local Rust/Node/pnpm build toolchains. Server production uses a source-tree shell workflow. Web production follows different paths. No single published release currently owns CLI, API server, web UI, installation, activation, and rollback.

Required outcome:

- one public publisher for Rust and pnpm outputs;
- prebuilt artifacts; target host does not build;
- one installed `dam-hopper` management CLI;
- host roles: server-only, web-only, or both;
- independent API and web systemd services;
- explicit install and explicit start operations;
- no manual removal/rollback before a normal upgrade;
- automatic previous-release restoration when activation fails;
- Linux first: current Fedora 44 x86_64 host profile;
- server and web versions remain lockstep.

Command spellings such as `dam-hopper install --server` are examples, not accepted API design.

## Accepted scope boundary

### In scope

- Public GitHub Release from a protected SemVer tag.
- One Fedora 44 x86_64 GNU/systemd release profile.
- Current profile baseline observed during brainstorming: glibc 2.43 and systemd 259.
- Prebuilt Rust management CLI, API server, and dedicated web static server.
- Built `apps/web/dist` payload.
- Server-only, web-only, and both host roles.
- Independent systemd services and service accounts/identities.
- Manifest/inventory verification before privileged writes.
- Pending installation, explicit activation, health checks, rollback, and crash recovery.
- Migration from the current marker-backed Linux production install.

### Out of scope

- ARM, musl, macOS, Windows, or non-systemd Linux.
- Claims that Fedora versions older/newer than the tested profile are supported.
- apt/dnf repositories, `.deb`, or `.rpm` as the primary server/web delivery path.
- npm as the production package registry or target runtime.
- Auto-update daemon, fleet management, beta channels, or blue/green deployment.
- Installer-owned TLS, DNS, firewall, Tailscale ACLs, nginx, or Caddy.
- Docker, GitHub Pages, and Tauri release redesign except avoiding release-tag publisher races.
- Automatic rollback of backward-incompatible database or external MongoDB migrations.
- Immediate migration of API execution from `loidinh` to a restricted dedicated account.

## Current process and constraints

### Current source-build flow

1. `pnpm linux:production -- build`
   - runs backend tests;
   - runs `pnpm build:server`, currently `cargo build --release`;
   - validates shell/JSON/unit inputs;
   - stages only `dam-hopper-server`, `dam-hopper.service`, manifest, and nonce.
2. `pnpm linux:production -- install --staging <path>`
   - validates stage, runtime env, owners/modes, units, processes, ports, and SQLite holders;
   - installs `/opt/dam-hopper/bin/dam-hopper-server` and one systemd unit;
   - enables but does not start the service;
   - refuses an existing install root/unit, preventing an in-place normal upgrade.
3. `pnpm linux:production -- start`
   - verifies marker/unit/env/process identity and ports;
   - starts the server on `0.0.0.0:4801`;
   - validates MainPID, executable, account, and listener.
4. `pnpm linux:production -- rollback --confirm`
   - stops/disables the service;
   - removes marker-backed installed assets;
   - preserves user runtime state.

Because install refuses existing assets, operators currently need a destructive/manual rollback-removal step before reinstalling a new locally built version.

### Current web behavior

- The systemd format-2 package does not include web assets.
- The Rust router can serve a SPA from `DAM_HOPPER_WEB_DIR` or `/opt/dam-hopper/web`, but this is not an independent web service.
- Docker builds both Rust and Vite and copies `apps/web/dist` into `/opt/dam-hopper/web`.
- GitHub Pages publishes web only from `main`.
- CI uploads transient server and web artifacts separately.
- Existing tagged release workflow publishes Tauri desktop bundles, not the requested API/web/CLI product release.

### Existing operational inconsistencies to resolve during planning

- Documented reset → build → install sequence conflicts with install refusing the assets reset leaves in place.
- `NoNewPrivileges` documentation conflicts with the actual current unit/runner contract.
- Local production build omits the `vendored` feature used by CI and Docker.
- Some docs claim musl portability although current production output is GNU/glibc.
- Current full reset can remove runtime config required by the unit.
- Current API static fallback conflicts with the accepted independent web service boundary.

## Approaches evaluated

### 1. Custom GitHub Release + Rust orchestrator — accepted

A custom GitHub Actions publisher builds Rust and pnpm outputs, validates one release manifest, and publishes one immutable public release. A Rust CLI manages host installation and activation.

**Pros**

- One version, publisher, manifest, and trust boundary.
- No Node, pnpm, Cargo, or repository checkout on target.
- Preserves valuable current safety checks.
- Supports app-aware health and rollback.
- Precisely supports server/web/both host roles.

**Cons**

- Project owns privileged installer correctness.
- Requires safe archive extraction, durable transaction state, service recovery, and release security maintenance.
- Adds a deliberately small Rust web-serving binary.

### 2. Native `.deb`/`.rpm` packages — deferred

Split native packages could let apt/dnf own installed files, dependencies, users, and units.

**Pros**

- Standard package database, signing, uninstall, and distro integration.
- Natural server/web package split and optional metapackage.

**Cons**

- Creates package specs, repositories, signing, and distro-specific test matrices immediately.
- Package-manager downgrade is not application health rollback.
- Package scriptlets complicate the required install-without-start behavior.
- Poor fit for the current single-host Fedora-first scope and home-based API state.

Use only when native repository integration becomes a product requirement.

### 3. npm-centered publication — rejected

An npm package could install a JavaScript wrapper or download native archives.

**Pros**

- Familiar to current pnpm contributors.
- Easy command discovery for Node users.

**Cons**

- Makes Node/npm production prerequisites.
- Adds a second registry and trust/version channel.
- Still requires native archives and custom privileged systemd logic.
- Does not solve static web runtime ownership or transactional rollback.

npm may later expose a thin convenience launcher. It must not become authoritative publication.

## Final architecture

### Central publisher

One GitHub Actions workflow is authoritative for a protected tag `vX.Y.Z`:

```text
protected tag
  ├─ build Rust CLI/API/web-host for Fedora 44 x86_64 GNU
  ├─ pnpm build → apps/web/dist
  ├─ assemble exact archive inventory
  ├─ generate release-manifest.json
  ├─ verify versions, hashes, modes, units, and host profile
  ├─ generate attestations/SBOM
  └─ publish complete immutable public GitHub Release
```

“Central publisher” means one release workflow and GitHub Release. Cargo and pnpm remain build tools; neither Cargo registry nor npm registry is the product publisher.

Existing Tauri publication must feed the same coordinator or use a non-conflicting release boundary. Two workflows must not race to create or mutate the same tag release.

### Release assets

Minimum public release:

1. `dam-hopper-install.sh`
   - bootstrap only;
   - detects the supported Fedora 44 x86_64/systemd profile;
   - resolves `latest` once to an exact immutable tag or accepts an exact version;
   - downloads and verifies before privilege;
   - never uses `curl | sudo sh`.
2. `dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz`
   - `bin/dam-hopper`;
   - `bin/dam-hopper-server`;
   - `bin/dam-hopper-web`;
   - `web/` from `apps/web/dist`;
   - API and web unit templates;
   - required license/notices.
3. `release-manifest.json`
   - schema version, tag, SemVer, commit SHA, and profile ID;
   - equal CLI/API/web versions;
   - archive byte size and SHA-256;
   - exact internal inventory, modes, sizes, and hashes;
   - unit names, expected identities, ports, and health paths;
   - rollback compatibility declaration.
4. GitHub artifact attestations and SBOM.

One archive is intentional. With one host profile and lockstep releases, separate archives create partial-download and mismatch states without useful independence. The CLI installs only files required by the selected host role.

### Host roles

| Role | Installed runtime | Activated service |
|---|---|---|
| Server | CLI, API binary, API unit | API on `0.0.0.0:4801` |
| Web | CLI, web binary, SPA, web unit | UI on `0.0.0.0:4802` |
| Both | All payloads and both units | API `:4801` + UI `:4802` |

Role selection controls what a host owns. It does not permit mixed versions.

- Server-only and web-only hosts upgrade their installed role.
- Both-role hosts upgrade API and web as one transaction.
- A partial upgrade that would produce new web + old API, or the reverse, is rejected.
- Changing role is an explicit host configuration operation, not an incidental version upgrade.

### `apps/web` serving confirmation

`apps/web` remains the UI implementation. Publisher executes its normal Vite production build. `dam-hopper-web` serves that generated `dist` tree.

Required web-host surface:

- static `GET` and `HEAD`;
- SPA `index.html` fallback only for non-file browser routes;
- correct MIME handling;
- conservative cache for `index.html` and version/health metadata;
- immutable cache for content-hashed assets;
- exact versioned health endpoint, e.g. `/__dam-hopper/health`;
- graceful SIGTERM;
- no upload, write API, directory listing, proxy, admin API, runtime JS execution, or Node dependency.

Web-only is useful: browser profiles can point the UI at a remote API. The remote API must allow the exact web origin for HTTP CORS and WebSocket origin checks.

### Services and ownership

- `dam-hopper-api.service`
  - system-wide unit;
  - initially preserves `User=loidinh` because API PTY/build/project/SSH access currently depends on that identity and home;
  - never runs as root;
  - preserves existing config/state paths during the first Fedora profile cutover.
- `dam-hopper-web.service`
  - system-wide unit;
  - fixed unprivileged `dam-hopper-web` identity;
  - read-only access to selected static assets only;
  - cannot read API env, tokens, SQLite, projects, repositories, or `/home/loidinh`.

Units have independent cgroups, restart policy, logs, ports, and health. They should not use `Requires=` to couple failures. The CLI coordinates release activation; systemd only supervises committed processes.

Direct ports are accepted for v1:

- legacy `4800` remains a forbidden conflict;
- API: `0.0.0.0:4801`;
- web: `0.0.0.0:4802`;
- firewall/Tailscale and exact CORS/WebSocket allowlists own exposure;
- packaged TLS/reverse proxy is out of scope.

### Filesystem/state boundary

Conceptual layout:

```text
/opt/dam-hopper/
  releases/vX.Y.Z/          root-owned immutable payload
  current -> releases/...   active release pointer
  .staging/                 root-only non-executable candidate area

/usr/local/bin/dam-hopper   root-owned management CLI
/etc/systemd/system/
  dam-hopper-api.service
  dam-hopper-web.service
/var/lib/dam-hopper-manager/
  active, previous, pending, journal, recovery metadata

/home/loidinh/.config/dam-hopper/
  host config, env, token, SQLite, and existing API runtime state
```

Publisher owns bytes. CLI/root owns safe extraction, release selection, units, and transaction records. systemd owns process lifecycle. Application state remains outside release trees.

### Install/start/rollback semantics

Exact command syntax remains a planning decision. Observable behavior is accepted.

#### Install

- resolve an exact public release version;
- download as invoking user;
- verify manifest/archive/attestation before sudo;
- acquire root deployment lock;
- reject unsupported host, unsafe archive entries, unexpected inventory, owner/mode/hash drift, foreign processes/listeners, and ambiguous legacy state;
- extract to root-only staging and atomically retain immutable candidate release;
- validate candidate units with systemd tooling;
- record candidate as pending;
- install only selected role files;
- do not switch active release, stop current services, start candidate, or enable a fresh first install.

Existing healthy services continue running during upgrade installation.

#### Start

- if no pending release, starts/verifies the committed selected role similarly to current `linux:production start`;
- if pending exists, enters the activation transaction;
- validates current and candidate manifests, services, accounts, processes, ports, and SQLite ownership;
- stops known old selected units and proves cgroups/listeners are clear;
- durably records old/candidate transaction state;
- atomically switches active release;
- starts selected candidate unit(s);
- verifies MainPID/executable/account/listener and exact API/web health versions through a stability window;
- commits and enables only after success.

#### Automatic rollback

On candidate start or health failure:

- stop candidate unit(s);
- prove candidate cgroups/listeners are clear;
- restore previous release pointer and applicable units/CLI state;
- restart previous selected unit(s);
- verify previous exact versions and health;
- preserve failed candidate and reason for diagnosis;
- report rollback success only if old health succeeds.

If previous restoration fails, enter `RECOVERY_REQUIRED` and remain fail-closed. First-install failure restores “no active release” and disabled/stopped units.

This rollback covers immutable release assets, pointer, unit selection, and process version. It does **not** magically roll back arbitrary SQLite or MongoDB schema changes. Lockstep releases must remain backward-compatible with state written by the immediately previous supported release. Breaking migrations require a separate maintenance design.

### Crash recovery

Minimal durable progression:

```text
ABSENT|ACTIVE(old)
  → STAGED
  → PENDING
  → QUIESCED
  → SWITCHED
  → PROBING
  → COMMITTED
```

- Crash before switch: old release remains active.
- Crash after switch but before commit: recover conservatively to old release.
- Crash after durable commit: keep candidate and repair convenience pointers.
- Pointer/journal/version disagreement: fail closed; never guess or delete the only known-good release.
- Retain active plus one previous known-good release. Garbage collection never removes active, previous, pending, staged, or journal-referenced releases.

## Security considerations

- Protected tag and minimal release-job permissions.
- Draft release assembled completely before publication.
- Immutable GitHub Release and artifact attestations.
- Third-party Actions pinned to immutable revisions.
- HTTPS plus SHA-256 prevents corruption but checksum alone is not an independent authenticity boundary.
- Verification completes before any privileged write.
- No network pipe receives root privileges.
- Archive extraction rejects absolute paths, traversal, device entries, and unapproved links.
- Root-only deployment lock, staging, and transaction journal.
- Exact inventory, owners, modes, units, executable paths, service accounts, cgroups, listeners, and health versions.
- Web service receives no API secrets or mutable application state.
- API remains non-root, but retaining `loidinh` is an acknowledged weaker boundary required by current PTY/project behavior.

## Likely repository touchpoints

Planning must inspect and coordinate changes across:

- `package.json` build/release scripts;
- `server/Cargo.toml` binary and version definitions;
- `server/src/main.rs` CLI/server entrypoint boundaries;
- `server/src/api/router.rs` current SPA fallback and CORS;
- `server/src/api/settings.rs` API health/version;
- `apps/web/vite.config.ts` production output/runtime configuration;
- `packages/ui/src/api/server-config.ts` profile/server URL behavior;
- `packages/ui/src/api/ws-transport.ts` WebSocket origins;
- `deploy/run-linux-production.sh` safety invariants and legacy migration;
- `deploy/reset-linux-production.sh` runtime-state boundaries;
- `deploy/systemd/dam-hopper.service` legacy unit;
- `tests/deploy/linux-production-fixtures.sh` deployment contract tests;
- `.github/workflows/ci.yml` transient artifacts;
- `.github/workflows/release.yml` current Tauri publisher;
- `.github/workflows/deploy-pages.yml` separate Pages channel;
- `Dockerfile` existing combined server/web packaging;
- `README.md` and Linux/deployment/architecture/configuration/code-standard/roadmap/changelog docs.

## Success metrics and acceptance criteria

1. Public immutable `vX.Y.Z` Release contains only the declared installer, payload, manifest, attestations, SBOM, and required notices; tag, commit, and all component versions agree.
2. Manifest target, archive digest, exact inventory, modes, unit hashes, and attestations verify before privileged writes.
3. Clean Fedora 44 x86_64/systemd host installs without repository checkout, Node, pnpm, Rust, Cargo, or local build.
4. Server-only install stages only server role; web-only stages web host + `apps/web/dist`; both stages both. No role can produce a mixed-version both-host.
5. Fresh install leaves selected units inactive/disabled, opens no production port, and reports one pending version.
6. Upgrade install leaves the old committed services and exact health/version unchanged until explicit activation.
7. Start preserves the current safety behavior: rejects foreign processes, occupied `4800/4801/4802`, unexpected units/accounts/paths, malformed inventory, version mismatch, and conflicting SQLite holders.
8. Successful activation runs selected service(s) under expected non-root identities from one exact release and returns matching health versions.
9. Web serves built `apps/web/dist`, supports SPA routes, uses correct cache behavior, and cannot read/write API secrets/state/projects.
10. API and web process failures remain independently supervised; neither failure kills the other process.
11. Candidate executable, unit, port, API health, web health, and early-crash failures restore and verify the previous release automatically.
12. Persistent API config/state paths and ownership do not change during successful upgrade or rollback.
13. Crash injection at transaction boundaries produces deterministic old, rolled-back, committed, or recovery-required state—never guessed success.
14. Reboot before first explicit activation starts nothing; reboot after successful activation starts the committed selected role.
15. Current known format-2 install can be taken over or restored without invoking destructive runtime reset; unknown/legacy-drifted state fails closed.

## External references

- GitHub Releases: <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>
- GitHub immutable releases: <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
- GitHub artifact attestations: <https://docs.github.com/en/actions/concepts/security/artifact-attestations>
- GitHub Actions hardening: <https://docs.github.com/en/actions/reference/security/secure-use>
- `dist`/cargo-dist release model: <https://axodotdev.github.io/cargo-dist/book/introduction.html>
- npm package metadata: <https://docs.npmjs.com/cli/v11/configuring-npm/package-json/>
- systemd service semantics: <https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html>
- systemd unit semantics: <https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html>
- Debian maintainer scripts and failure recovery: <https://www.debian.org/doc/debian-policy/ch-maintainerscripts.html>
- Rust platform support: <https://doc.rust-lang.org/rustc/platform-support.html>

## Next dependency

A detailed implementation plan should turn this accepted contract into phased file ownership, release manifest schema, CLI command grammar, migration sequence, failure-injection tests, documentation cutover, and release acceptance gates. It must not reopen accepted architecture without new evidence.

## Unresolved questions

None blocking architecture consensus.

Implementation planning must choose exact CLI grammar, health stability duration, release retention count beyond one previous version, and whether production release verification requires GitHub attestation tooling alone or an additional detached signing key.