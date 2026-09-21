# Code Review: Phase 03 — Release CI Workflow & Guidance Documentation

**Date:** 2026-09-21  
**Reviewer:** Phase03Reviewer-3 (Senior Software Engineer)  
**Status:** Approved  
**Score:** 9.8/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `.github/workflows/release-linux.yml`
  - `tests/deploy/linux-release-package-twice.sh`
  - `package.json`
  - `README.md`
  - `docs/configuration-guide.md`
  - `docs/linux-release-publisher-bootstrap.md`
  - `docs/linux-release-manifest.md`
- **Lines of code analyzed:** ~2,885 lines across 7 files (~290 lines modified/added).
- **Review focus:** Release CI workflow DAG, GitHub Actions permissions, Windows release packaging & attestation, profile gate separation, contract alignment, user & publisher guidance docs.
- **Updated plans:**
  - `plans/260920-2327-windows-release-asset-and-installer/plan.md` (Updated to COMPLETED, 3/3 phases complete, 100%)
  - `plans/260920-2327-windows-release-asset-and-installer/phase-03-release-workflow-and-docs.md` (Updated to COMPLETED, 100%)

---

### Overall Assessment
Code quality, security hardening, and documentation clarity are exemplary. The changes cleanly extend the release pipeline to support Windows x86_64 MSVC direct-server distribution alongside the existing Linux systemd profile:
- Least-privilege permissions strictly enforced in CI (`contents: read` default; `id-token: write` and `attestations: write` scoped solely to `attest-release`; `contents: write` scoped solely to `publish-release`).
- Complete profile isolation maintained: Linux exact-four asset contract and Windows exact-two asset contract validate independently; final publication combines both under `--profile all` for an exact six-asset verified gate.
- Manifest v2 boundary strictly preserved: `release-manifest.json` describes only Linux runtime components with zero Windows schema pollution.
- Deterministic reproducibility guaranteed: fixed epoch (`SOURCE_DATE_EPOCH=1700000000`), byte-by-byte sequence equality verified on both platforms.
- Non-admin, zero-service, no-auto-start contract maintained for Windows installer and documented accurately.

---

### Critical Issues
*None.*

---

### High Priority Findings
*None.*

---

### Medium Priority Improvements
*None.*

---

### Low Priority Suggestions
1. **Redundant pnpm setup in `package-windows-release` job:**
   - In `.github/workflows/release-linux.yml` lines 231-233, `pnpm/action-setup@v4` is included in the `package-windows-release` job. However, the job runs `powershell ... tests/deploy/windows-release-package-twice.ps1`, which invokes `node` directly on standard-library scripts (`build-windows-release-archive.mjs` and `check-release-assets.mjs`), with no dependencies on `pnpm`.
   - *Impact:* Minor runtime overhead (~2-5 seconds) on Windows runner.
   - *Recommendation:* Remove the `pnpm/action-setup@v4` step from `package-windows-release` in a future cleanup.

---

### Positive Observations
1. **Strict Least-Privilege CI Security:**
   - Workflow-level default `permissions: contents: read`.
   - Build jobs (`build-rust`, `build-rust-windows`, `build-web`) and packaging jobs (`package-release`, `package-windows-release`) inherit read-only access.
   - `attest-release` restricts elevated permissions to `id-token: write` and `attestations: write`.
   - `publish-release` gates `contents: write` behind environment protection (`environment: linux-release`) and non-dry-run tag filters.
2. **Deterministic Byte-for-Byte Packaging:**
   - Linux uses GNU tar with fixed mtime, sorted entries, and zeroed uid/gid.
   - Windows packager uses Node.js standard libraries only (no third-party zip deps), fixed DOS timestamps from epoch, deterministic sort, and zero trailing bytes.
   - Both package-twice harnesses verify byte sequence equality and SHA-256 identity across independent runs.
3. **Immutability and Remote Verification:**
   - Publication creates a draft, queries GitHub API for asset state (`uploaded`), positive sizes, and SHA-256 equality against local files, and undrafts only after verification passes.
4. **Comprehensive Guidance Documentation:**
   - `README.md` provides copyable PowerShell one-liner, explicit parameter examples, fresh-shell PATH notice, non-admin contract, and manual launch instructions.
   - `docs/configuration-guide.md` details directory layout, TOML escaping for Windows drive/UNC paths, config preservation on upgrade, and a 4-step loopback smoke procedure.
   - `docs/linux-release-manifest.md` explicitly documents the external boundary of Windows assets relative to Manifest v2.

---

### Recommended Actions
1. **Proceed to Repository-Wide Validation:**
   - Run full repository validation suites when orchestrating release rehearsal.
2. **Optional CI Optimization:**
   - Omit `pnpm/action-setup@v4` from `package-windows-release` in future workflow tidy-up.

---

### Metrics
- **Type Coverage:** N/A (Scripts are pure ESM JavaScript with Node.js standard libraries and strict validation).
- **Test Coverage:**
  - `windows-release-asset-gate.test.mjs`: 23/23 assertions passing (100%).
  - `windows-release-package-twice.ps1`: Deterministic verification passing (byte-for-byte match).
  - `windows-release-install.ps1`: 14/14 integration scenarios passing (100%).
- **Linting & Syntax Issues:** 0 (Verified via `release:verify` and `release:verify-windows`).

---

### Validation Commands and Results
- `pnpm release:verify-windows`: **PASS** (Node syntax check and PowerShell parser check for all deployment scripts).
- `pnpm release:windows-gate-test`: **PASS** (23/23 assertions verified).
- `pnpm release:windows-package-twice`: **PASS** (Byte-for-byte reproducibility verified, Run 1 & 2 SHA-256 `474c01b1...` identical, altered epoch produces divergent hash, Windows profile asset gate passed).
- `pnpm release:windows-installer-test`: **PASS** (14/14 integration tests passed: clean install, upgrade config preservation, -Latest resolution, -DryRun, tampered digest, size mismatch, traversal rejection, extra/missing member rejection, invalid parameters, -AddToPath idempotence, HTTP rejection, binary lock handling).
- `node deploy/release/check-version-alignment.mjs v0.4.2`: **PASS** (Version alignment verified: `v0.4.2 (0.4.2)`).
- `pnpm release:verify`: **PASS** (Version alignment, shell syntax checks, and generator/checker/packager syntax validation all passed).

---

### Unresolved Questions
*None.*
