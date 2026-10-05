# Documentation Reader Report: Operations & Plugin Platform

**Date:** 2026-10-05  
**Target Documents:**
1. `docs/worktree-operation.md`
2. `docs/linux-release-publisher-bootstrap.md`
3. `docs/user-guide-multi-server-profiles.md`
4. `docs/plugin-platform-linux.md`
5. `docs/plugin-platform-d00.md`

---

## 1. Document Purposes

### 1.1 `docs/worktree-operation.md`
- Complete lifecycle guide for Git worktrees in DamHopper.
- Covers initial single-project repo registration, worktree creation (CLI & UI), session-scoped UI target switching, active branch workflows, maintenance, safe removal safeguards, and Git API endpoints.

### 1.2 `docs/linux-release-publisher-bootstrap.md`
- Authoritative specification for release publisher DAG (`release-linux.yml`) and non-root Linux bootstrap installer (`dam-hopper-install.sh`).
- Defines release boundaries (exact SemVer tags), 6-asset public release union (Linux systemd + Windows direct-server), reproducible archive packaging with fixed epoch, external Manifest v2 + SBOM generation, multi-profile verification gates, and manager installation flow.

### 1.3 `docs/user-guide-multi-server-profiles.md`
- User guide for the unified workbench architecture supporting multiple concurrent server profiles.
- Details per-profile connection lifecycles, endpoint origin policies, profile-qualified IDE resource addressing (`{ profileId, project, worktreePath }`), federated search/Git isolation, Windows native SSH forwarding scopes, and independent host resource SSE telemetry.

### 1.4 `docs/plugin-platform-linux.md`
- **RETIRED (2026-10-02)** operational and deployment guide for the legacy trusted plugin platform.
- Documented dual-identity security model (API user vs dedicated non-root plugin owner), Unix domain socket IPC (`/run/dam-hopper/plugin-runner.sock`), tmpfiles configuration, filesystem DAC/ACL access scenarios, systemd service hardening, and LAN performance qualification.

### 1.5 `docs/plugin-platform-d00.md`
- **HISTORICAL (retired 2026-10-02)** foundational contract specification for Phase D00 plugin platform.
- Defined Manifest-v1 schema, 4-byte BE length-prefixed JSON-RPC 2.0 framing, opaque sandboxed iframe UI bridge with CSP and transferred `MessagePort`, worker cancellation state machine, and resource budgets.

---

## 2. Key Operational Workflows & Platform Mechanisms

### 2.1 Git Worktree Lifecycle (`docs/worktree-operation.md`)
- **Shared ODB Model:** Worktrees attach to primary repo, sharing Git objects and branch refs; separate checked-out working trees.
- **Single Registration:** Configured once in `dam-hopper.toml` (`[[projects]]`); auto-discovers worktrees via `git worktree list --porcelain`. Worktrees are not registered as standalone projects.
- **Creation Paths:**
  - CLI: `git worktree add [-b <branch>] <path> [<base>]`.
  - UI: Project panel -> "Worktrees" -> "Add Worktree" (specifies path, branch, and base).
- **Session-Scoped Target Selection:** Active worktree selection stored per browser session. Routing affects Explorer, search/replace, Git actions, Monaco editor tabs, and terminal spawning. Resets to project root on browser reload.
- **Server Validation & Safe Teardown:** Server validates worktrees via Git porcelain check; rejects foreign/bare/prunable paths. Removal blocked if worktree owns dirty tabs or active terminals. Falls back to project root on successful removal.
- **Git Worktree API:** `GET /api/git/{project}/worktrees`, `POST /api/git/{project}/worktrees`, `DELETE /api/git/{project}/worktrees`, `POST /api/git/{project}/worktrees/prune`.

### 2.2 Release Publication & Non-Root Bootstrap (`docs/linux-release-publisher-bootstrap.md`)
- **Release Contract:** Immutable tag `vX.Y.Z` synchronized across tag, `server/Cargo.toml`, and `apps/web/package.json`. No mutable `latest` assets.
- **Publisher DAG:** Metadata check -> parallel build jobs (`build-rust`, `build-web`, `build-rust-windows`) -> packaging -> `attest-release` (provenance for 6 subjects) -> `publish-release` (protected `linux-release` environment approval).
- **Public Asset Set (Exact 6 Assets):**
  - Linux (4): `dam-hopper-install.sh`, `dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz`, `release-manifest.json`, `dam-hopper-vX.Y.Z-linux-x86_64-systemd.spdx.json`.
  - Windows (2): `dam-hopper-install.ps1`, `dam-hopper-vX.Y.Z-windows-x86_64.zip`.
- **Reproducible Archive Packaging:** `build-release-archive.sh` packages binaries, systemd units, tmpfiles, sysusers, license, web dist. GNU tar, POSIX format, sorted names, zeroed uid/gid, deleted atime/ctime PAX records, `SOURCE_DATE_EPOCH=1700000000`, `gzip -n -9`. Built twice; requires identical SHA-256.
- **Manifest v2 & Deep Validation:** `generate-release-manifest.mjs` outputs `release-manifest.json` outside archive (avoids digest cycle). Rust manager runs deep archive validation via `validate_manifest_and_archive`.
- **Asset Gates:** `check-release-assets.mjs` validates filenames, SHA-256 digests, and manifest structure. `--profile all` enforces the exact 6-asset set. Migration mode validates 1..1024 manager targets, 24h validity, production env, rollback manifest integrity.
- **Bootstrap Installer Workflow:** `dam-hopper-install.sh` downloads manifest + archive to mode-0700 temp dir, verifies SHA-256 and optional attestation, extracts `dam-hopper-manager`, invokes `sudo dam-hopper install --bundle ... --role ...`, traps cleanup, and leaves installation in `PENDING` state (never auto-starts services).

### 2.3 Multi-Server Workbench Architecture (`docs/user-guide-multi-server-profiles.md`)
- **Concurrent Profile Runtimes:** Single browser shell maintains multiple independent server runtimes. Requires server `workbenchProtocol: 2`.
- **Host Origin Security:** Web and Windows native desktop support approved cross-origin HTTP(S). Non-Windows native hosts strictly require exact same-origin profiles (unsupported hosts marked `Unsupported` without silent fallback).
- **Storage & Token Isolation:** Profiles saved in `localStorage` (`damhopper_server_profiles`); auth tokens in `damhopper_profile_auth_v2_<profileId>`. Changing URL or auth type invalidates token and tears down media client namespace. Logout purges namespaced media sessions and tokens.
- **Qualified IDE Addressing:** Fully qualified tuple `{ profileId, project, worktreePath }` binds Monaco models/tabs, file tree, watchers, search matches, and Git actions. Dirty tabs on one target never block edits on another.
- **Federated Operations:**
  - Workspace search covers "Project target" or "All connected profiles" (max 500 results).
  - Bulk Git fetch/pull partitioned per profile and executed sequentially to prevent SSH passphrase retry leakage.
- **Windows Native SSH Forwarding:** Profile-scoped `NativeScopeRef`. Concurrently forwards ports on 127.0.0.1 without ID collisions.
- **Host Resource Telemetry:** Independent SSE stream per profile; REST polling fallback (15s snapshot, 5s metrics). Pauses on hidden pages. Switching profiles synchronously fences SSE/REST caches.

### 2.4 Legacy Linux Plugin Platform (`docs/plugin-platform-linux.md` - Retired)
- **Privilege Separation:** API ran as `dam-hopper`; plugin runner ran as non-root `@ADVISOR_OWNER_USER@` (default `dam-hopper-plugin-runner`). Non-root UID validation, distinct from API and web identities, safe home directory checks.
- **Unix Domain Socket:** `/run/dam-hopper/plugin-runner.sock` mode `0660`, owner `<plugin-owner-user>:dam-hopper-plugins`. API joined group via `SupplementaryGroups=dam-hopper-plugins`.
- **State Directory:** `/var/lib/dam-hopper-plugin-runner` mode `0700`.
- **Filesystem Traversal Scenarios:** Developer workstation Scenario A (runner ran as developer login to read mode `0700` repos) vs Scenario B (POSIX ACLs via `setfacl`).
- **Settings UI Integration:** Global Owner History Source configuration pinned via SHA-256 of absolute path.
- **Hardening:** Strict systemd isolation (`ProtectSystem=strict`, `ProtectHome=read-only`, `NoNewPrivileges=true`, `PrivateTmp=true`, cgroups 1G memory / 64 tasks).

### 2.5 Legacy Plugin Contracts & Opaque Bridge (`docs/plugin-platform-d00.md` - Historical)
- **Manifest-v1:** Plugin ID, SemVer version, host range, capability declarations, backend/UI entrypoints (`mode: "opaque-srcdoc"`), and full file inventory with SHA-256 digests.
- **Framing Protocol:** 4-byte BE length prefix + JSON-RPC 2.0 UTF-8 body. Ceilings: 16 MiB payload, 64 KiB control frame, 64 MiB aggregate buffer.
- **Opaque UI Bridge (v1.0.0):** Strict CSP injection (`default-src 'none'`), `sandbox="allow-scripts"` (no `allow-same-origin`), one-use `MessagePort` transfer with nonce handshake (`host.bootstrap`, `frame.ready`, `frame.portAck`).
- **Cancellation State Machine:** `WorkerCancellationTracker` with cooperative checks (`isCancelled`) and supervisor process-kill escalation upon timeout.

---

## 3. Areas Needing Update, Retirement, or Synchronization

### 3.1 `docs/worktree-operation.md`
1. **Multi-Server Target Qualification Gap:** Document describes single-server configuration (`~/.config/dam-hopper/dam-hopper.toml`) and `/api/git/{project}/worktrees` without addressing the multi-profile qualified target tuple `{ profileId, project, worktreePath }` used across the workbench.
2. **Hardcoded Paths:** References machine-specific paths (`/mnt/data/ws/sharing/dam-hopper`, `/home/loidinh/WS/...`); should use generic placeholder paths.
3. **Native Advisor Scoping:** Document does not specify whether Native Advisor scans worktree roots or project roots for history and evaluation files.

### 3.2 `docs/linux-release-publisher-bootstrap.md`
1. **Historical Version & Milestone Artifacts:** References milestone dates from September 2026 (Phase 03/Phase 06 approval) and sample tag `v0.2.0`; needs alignment with current release baseline.
2. **Target glibc vs Builder Contract:** Disparity remains noted between manifest contract (Linux/glibc 2.39/systemd 245) and builder environment (`ubuntu-latest`).
3. **Windows S13 Runtime Qualification:** Document maintains that Windows direct-server package does not claim native/Tauri S13 runtime qualification.
4. **Installer Flag Alignment:** Verify bootstrap script grammar eliminates deprecated plugin-related flags (`--plugin-owner-user`, `--plugin-admin-subject`).

### 3.3 `docs/user-guide-multi-server-profiles.md`
1. **Stale References to Plugin Platform in Settings:**
   - Section *Page endpoint resolution* references: `Settings (/settings): Server administration (... and plugin management)...`. Plugin management was completely deleted from Settings.
   - Section *Page endpoint resolution* references: `Workspace Advisor (/workspace): The EVCrate Advisor plugin (evcrate.advisor) is integrated directly...`. Needs update to **Native Advisor** (`/api/advisor/*`, `NativeAdvisorProvider`, `AdvisorPanel`).
2. **Phase-Oriented Nomenclature:** Content organized around historical development phases (Phase 02, Phase 03, Phase 08, Phase 09) rather than evergreen feature documentation.
3. **Windows Native S13 Qualification Block:** Retains note that S13 remains blocked pending Windows hardware/runtime evidence.

### 3.4 `docs/plugin-platform-linux.md`
1. **Retirement Status:** Already flagged `RETIRED (2026-10-02)`. Daemon `dam-hopper-plugin-runner`, socket `/run/dam-hopper/plugin-runner.sock`, tmpfiles rules, runner state dir, and flags were excised.
2. **Action Needed:** Move to an explicit archive location (`docs/historical/`) or maintain as historical migration reference. Audit remaining docs to ensure none link to this guide for active operator tasks.

### 3.5 `docs/plugin-platform-d00.md`
1. **Historical Status:** Already flagged `HISTORICAL (retired 2026-10-02)`. `@dam-hopper/plugin-sdk`, `server/src/plugins`, and iframe bridge were superseded by in-tree native advisor implementation (`server/src/advisor/`).
2. **Action Needed:** Retain for contract migration evidence only. Ensure all architecture documentation points to native advisor interfaces instead of D00–D05 plugin specs.

---

## 4. Unresolved Questions
1. Should `docs/plugin-platform-linux.md` and `docs/plugin-platform-d00.md` (and related `docs/architecture/plugin-platform-d*.md` files) be moved into a dedicated `docs/archive/` or `docs/historical/` directory to prevent LLM/operator confusion?
2. Does the Native Advisor history scanner support per-worktree history paths (`$WORKTREE/.evcrate/advisor-history`), or is it strictly pinned to the user home directory (`$HOME/.evcrate/advisor-history`) and primary workspace project root?
3. What is the current qualification status of Windows desktop native S13 (Tauri 2 native SSH/WebView2/DPAPI) relative to the direct-server Windows release?
