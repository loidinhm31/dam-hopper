# Code Review Report — Phase 01: Contract, Version, and Manifest

**Date:** 2026-09-03  
**Reviewer:** Phase01Reviewer (Senior Staff Engineer)  
**Score:** 9.5 / 10  
**Status:** Approved (Passes Phase 01 Review Gate)  

---

## 1. Scope

- **Reviewed Files:**
  - `server/Cargo.toml`
  - `server/src/lib.rs`
  - `server/src/linux_release/mod.rs`
  - `server/src/linux_release/constants.rs`
  - `server/src/linux_release/error.rs`
  - `server/src/linux_release/version.rs`
  - `server/src/linux_release/inventory.rs`
  - `server/src/linux_release/inventory_path.rs`
  - `server/src/linux_release/inventory_validation.rs`
  - `server/src/linux_release/manifest.rs`
  - `server/src/linux_release/manifest_validation.rs`
  - `deploy/release/release-manifest.schema.json`
  - `server/tests/linux_release_manifest.rs`
  - `server/tests/linux_release_manifest_errors.rs`
- **Updated Plan:**
  - `plans/260903-0919-linux-release-installer-architecture/phase-01-contract-version-manifest.md`
- **Total Lines Analyzed:** ~1,354 LOC across 14 files.

---

## 2. Validation Commands & Results

| Command | Status | Output / Timing |
|---|---|---|
| `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored` | PASS | Exit 0, 0.26s, 0 warnings |
| `cargo test --manifest-path server/Cargo.toml --test linux_release_manifest --test linux_release_manifest_errors` | PASS | 20 passed (2 suites), 0.35s |
| `cargo test --manifest-path server/Cargo.toml linux_release` | PASS | 10 passed (14 suites, 896 filtered), 0.40s |

Combined test coverage spans round-trip serialization, role projections, bounds checks, schema invariants, path normalization, duplicate detection, and security exclusions.

---

## 3. Overall Assessment

Implementation exhibits high engineering quality:
- **Architectural Clarity & Modularity:** Cleanly decoupled into submodules (`constants`, `error`, `version`, `inventory`, `inventory_path`, `inventory_validation`, `manifest`, `manifest_validation`).
- **File Size Management:** Every code file strictly obeys repository constraint (< 200 lines). Largest is `manifest_validation.rs` at 197 lines.
- **KISS / YAGNI / DRY:** Added only one minimal dependency (`semver = "1"`). No bloated abstraction layers.
- **Defensive Engineering:** Strict bounds enforced before parsing (max payload 1 MiB, max 20,000 inventory items, max 255-byte path lengths, no path traversals, no duplicate entries, disallowed runtime/secret files).

---

## 4. Critical Issues

*None blocking.*

**Security Context Observation (Design Requirement):**
- Per owner directive documented in parent plan (`plan.md` lines 61-62), `API_SERVICE_IDENTITY` is configured as `"root"`. While strictly compliant with the parent plan decision, running the API service as root expands the blast radius if an API or PTY vulnerability occurs. The web host service remains isolated under the dedicated unprivileged `dam-hopper-web` account.

---

## 5. Warnings

1. **Git Line-Ending Diff Churn in Cargo Files:**
   - `server/Cargo.lock` and `server/Cargo.toml` in git HEAD use Windows CRLF line endings. Editing or invoking `cargo` on Linux converted line endings to LF, causing a 5,336-line diff in `Cargo.lock` despite only adding `semver = "1"`.
   - *Fix:* Ensure `.gitattributes` normalizes line endings or preserve CRLF when committing Cargo files to keep commits focused.
2. **Schema vs Serde Mode Deserializer Divergence:**
   - `deploy/release/release-manifest.schema.json` requires `"mode": { "type": "integer", "minimum": 0, "maximum": 4095 }`.
   - `server/src/linux_release/inventory.rs` accepts both `Int(u32)` and `Str(String)` (e.g. `"0o755"`).
   - While convenient in Rust, string modes would fail schema validation at the publisher boundary. Integer mode should remain the canonical representation.

---

## 6. Suggestions

1. **Service Unit & Config Permissions Validation:**
   - `inventory_validation.rs` verifies executable permissions (`mode & 0o111 != 0`) for the 3 binary targets, but does not verify non-executable permissions (`mode == 0o644` or `mode & 0o111 == 0`) for unit files (`dam-hopper-api.service`, `dam-hopper-web.service`) or `dam-hopper-web.conf`. Adding explicit checks will prevent packaging executable systemd unit files.
2. **Inventory Role Uniqueness:**
   - The JSON schema enforces `"uniqueItems": true` on `roles`. Rust parses `roles: Vec<ReleaseRole>` without verifying duplicate roles (e.g., `["server", "server"]`). Adding a deduplication or uniqueness check in `validate_inventory` aligns Rust with JSON schema.
3. **Expand Disallowed Secrets Filter:**
   - `inventory_path::check_disallowed_files` rejects `.env*`, `server.env`, `dam-hopper.toml`, and `.sqlite*`. Consider expanding pattern matching to reject private key files (`*.key`, `*.pem`, `id_rsa`, `id_ed25519`).
4. **Web Payload Directory Type Assertion:**
   - When tracking required path `"web"`, ensure `entry.kind == EntryKind::Dir` and that child assets under `web/` have role `Web`.

---

## 7. Plan Completeness & Next Steps

- All 6 TODO tasks in `phase-01-contract-version-manifest.md` are completed.
- Plan status updated to `Implementation: Completed`, `Review: Passed`.
- No lingering TODO / FIXME markers in code.
- Phase 02 (Rust CLI safe acquisition and staging) is unblocked and ready to consume these types.

---

## 8. Unresolved Questions

None.
