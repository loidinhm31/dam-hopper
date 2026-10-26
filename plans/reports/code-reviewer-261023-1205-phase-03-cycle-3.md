# Code Review — Phase 03 Pinned Tool Provisioning & Resource Controls (Cycle 3)

**Score: 8.5/10** — 0 critical, 3 warnings, 5 suggestions.

## Scope
- `server/src/semantic/{tool_profile,resources,resources/linux,launch,framing,types,mod}.rs`
- `server/src/linux_release/inventory_{path,validation}.rs`
- `deploy/release/{build-release-archive.sh,generate-release-manifest.mjs,semantic-engine/*}`
- tests: `semantic_tool_profile`, `semantic_resources`, `linux_release_manifest`
- Re-ran: `cargo test` tool_profile(11)/resources(8)/linux_release_manifest(12) pass; `cargo test --lib semantic` 14 pass; `node --check` manifest script ok; `rustfmt --check` on Phase 03 files = 0 diffs.
- Not re-run by me: framing(13)/child(11) integration tests (lib semantic run covers part); full 55 count not independently reproduced.

## Cycle 2 fix verification
| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Pin all 4 digests | FIXED (code) | `tool_profile.rs:22-36` 4 consts; `Default` fills all 4 (`:106-115`); `verify_integrity` checks all 4 (`:251-273`). `provenance.json` carries same 4 hashes (node/tsserver/tsls cli/package.json) — string match with consts. |
| 2 | `#[cfg(unix)]` guard | FIXED | `tool_profile.rs:17-18` import, `:222`, `:305` mode checks gated. Library no other `os::unix` use in semantic/. |
| 3 | Formatting churn reverted | FIXED | Diff = 9 tracked files only, all Phase 03. rustfmt diffs remain only in `child.rs`/`reaper.rs` (Phase 02 committed, untouched by this phase → not churn). |
| 4 | SPDX IDs | FIXED | `generate-release-manifest.mjs:441` `SPDXRef-File-${idx}-${sanitized}`; charset `[a-zA-Z0-9.-]` valid per SPDX 2.3. |
| 5 | Tests | PASS (subset reproduced) | see Scope. |

## Critical
None.

## Warnings
1. **package.json pin unverifiable / likely divergent.** Pinned `24e2c4c0…` (const + provenance.json) ≠ sha256 of repo `deploy/release/semantic-engine/package.json` (`1aebb20f…`). Hash appears nowhere else in repo; no assembler produces `lib/semantic-engine/tsls/package.json`. If the staged `tsls/package.json` is copied from the repo template, `verify_integrity` fails closed → engine permanently `DigestMismatch`. Likewise node/cli.mjs/tsserver hashes can't be reproduced here (no artifacts, no lockfile/fetch script). Action: add assembler (or doc) that derives all 4 hashes from the pinned npm tarballs/node tarball; confirm which package.json is hashed.
2. **No consistency guard between Rust consts and `provenance.json`/build script.** Two sources of truth (DRY); drift undetected. `build-release-archive.sh:216-233` checks presence only, no digest verification vs provenance. Add test (read provenance.json, assert == `PINNED_*`) and/or digest check in build script. Also add negative tests for cli.mjs/tsserver/package.json tamper (Cycle 2 item 14 still open; `semantic_tool_profile.rs` helper `digests()` supports it).
3. **Digest coverage is entrypoint-only.** `cli.mjs` imports additional files under `node_modules` (and tsserver loads sibling `lib/*`); only 4 files are hashed at runtime. Whole tree is covered only by manifest inventory sha256 (release-level). Acceptable if the installer verifies inventory before use — confirm (see Q2). Not owner-checked (`mode&0o022` only; no uid==0 check).

## Suggestions
1. `PinnedDigests` + `from_release_root_with_digests` still `pub` (Cycle 2 W12): any caller can weaken pins (`Option` → `None` skips check). Make `pub(crate)`/`#[cfg(test)]`-accessible or non-`Option` fields; integration tests currently require pub — consider `#[doc(hidden)]` or feature gate.
2. `ToolProfileError::IntegrityFailed` Debug-formats absolute paths + hashes (`:57`); map to code enum before any log/API exposure (Cycle 2 W13).
3. `discover()` picks exe-relative root by `node_path.exists()` (`:167`) — attacker-writable prefix could win over `/opt/dam-hopper`; digest check still blocks it, so low. Consider fixed root only.
4. `tests/semantic_tool_profile.rs:8,204` unconditional `os::unix` → Windows test build breaks; gate with `#[cfg(unix)]` for symmetry with lib.
5. SBOM: all non-TS files license "MIT" (`generate-release-manifest.mjs:432`) incl. project's own files; Node runtime `sha256` in provenance is of binary while `source` is the tarball (naming ambiguity) — label as `binarySha256`.

## Positives
- Passive, zero-child integrity; symlink + regular-file + mode checks; fail-closed ordering; streaming 64 KiB hashing.
- cgroup v2 setup requires all controllers, cleans up on failure, pre-exec attach.
- Deterministic archive build, symlink dereference, node 0755 normalisation; manifest validator rejects non-exec/group-writable node and stray files.
- Clean cutover; scope fixes minimal; no churn left.

## Residual (carried, non-blocking, unchanged since Cycle 2)
Resource limit types/consts still lack production consumer (Phase 04 contract); no live `pre_exec` cgroup move test; no fake-cgroup missing-controller test; mid-path symlink not rejected (only final component).

## Unresolved questions
1. Which exact file yields `24e2c4c0…` package.json hash — is the staged `tsls/package.json` the repo template (`1aebb20f…`) or an npm-generated one?
2. Does installer/service verify full inventory sha256 before enabling the engine (covers transitive node_modules)?
3. Who produces the staged `--semantic-engine-dir` (CI job/script) in a later phase, and does it recompute provenance hashes?
