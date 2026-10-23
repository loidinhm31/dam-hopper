# Code Review — Phase 03 Pinned Tool Provisioning and Resource Controls (Cycle 2)

Plan: `plans/260901-1000-lsp-server-integration/phase-03-pinned-tool-provisioning-and-resource-controls.md`
Date: 2026-10-23 | Reviewer: CodeReviewerPhase03Cycle2 | Mode: read-only (no code/plan edits; only this report written)
Prior: `plans/reports/code-reviewer-261023-1118-phase-03-pinned-tool-provisioning-and-resource-controls.md` (4.5/10)

## Score: 6.0 / 10

Real progress: C1, C4, C5 code-level fixed; most W fixed. Not closable: C2 only half-fixed (3 of 4 executed artifacts have NO digest pin in production path), C3 only presence-checks (no assembler/lock/CI wiring), new Windows-CI compile risk, 188-file unrelated rustfmt churn. Phase todo list still unmet (offline install/update/rollback never exercised). Keep plan status Pending/In-Progress.

## Scope
- Files: `server/src/semantic/{tool_profile,resources,resources/linux,launch,framing,types,child,reaper,mod}.rs`, `server/src/linux_release/{inventory_path,inventory_validation}.rs`, `server/tests/{semantic_tool_profile,semantic_resources,linux_release_manifest}.rs`, `deploy/release/{build-release-archive.sh,generate-release-manifest.mjs,semantic-engine/*}`, `.github/workflows/{pr-quality-gate,release-linux}.yml`, `deploy/systemd/*`, `dam-hopper-install.sh` (grep).
- Focus: security, perf, architecture, YAGNI/KISS/DRY; Cycle 1 C1-C5/W1-W13 remediation.
- Updated plans: none (plan ownership = Main/PM).

## Cycle 1 remediation matrix

| ID | Status | Evidence |
|---|---|---|
| C1 env override | FIXED | `tool_profile.rs:148-163` no env read; test `test_discover_does_not_inspect_environment_variables`. Residual: exe-relative root guess chosen by `node_path.exists()` only (low). |
| C2 integrity | PARTIAL | existence/regular/symlink(final comp)/`mode&0o022` now cover node, cli.mjs, tsserver.js, package.json. **Digests: only node.** `PinnedDigests::default()` → other three `None` (`tool_profile.rs:93-102`); `verify_integrity` skips them (`:243-259`). No owner check. See Critical 1. |
| C3 packaging tuple | PARTIAL | `build-release-archive.sh:216-232` checks presence of node, tsls/package.json, cli.mjs, tsserver.js. No digest vs `provenance.json`, no lockfile, no assembler, no CI/installer wiring (grep `semantic` in `.github`, installer, systemd = 0 hits). |
| C4 hard needs all 3 controllers + cleanup + session id | FIXED (code) | `linux.rs configure_cgroup_limits` returns `ControllerMissing`; `try_setup_cgroup` `remove_dir` on failure; session-id charset validated; `/proc/self/cgroup` missing entry fails closed. Gaps: no fake-tree test for missing controller/cleanup; no read-back. |
| C5 pre-exec containment | IMPLEMENTED | `launch.rs:134-148` `pre_exec` writes `cgroup.procs`; `attach_to_launch_spec`. Only path-assignment unit-tested; never run live; no production caller; see W3/W4. |
| Const dedupe | FIXED | framing/types/launch import `resources::*`. |
| rustfmt | FIXED but see W1 | `cargo fmt --check` rc clean (re-run by reviewer). |
| Inventory validation | MOSTLY | role Server, `mode&0o022`, unknown `lib/*` rejected (`inventory_validation.rs:195-218`). Tuple completeness still not enforced. |
| db/test.db test | FIXED | `inventory_path.rs:81-82` both assertions present. |
| provenance dynamic + unique SPDX | PARTIAL | idx added (unique) but `_` is invalid in SPDXID; silent fallbacks; see W6. |
| 55/55 tests | CONFIRMED | Reviewer re-ran 3 integration targets: 12+8+11 pass. Tester: 55/55 x2. |

W status: W1 PARTIAL (consts migrated; unused limits/errors remain) · W2 MOSTLY (`Serialize`-only, fields still `pub` but inert) · W3 OPEN · W4 PARTIAL · W5 OPEN · W6 OPEN/PARTIAL · W7 PARTIAL · W8 FIXED · W9 PARTIAL · W10 MOSTLY FIXED · W11 FIXED (stub removed) · W12 DEFERRED (no readiness type) · W13 FIXED.

## Critical Issues

1. **Production integrity pins only `node`; JS payload executed unpinned** — `tool_profile.rs:86-102,243-259`. cli.mjs/tsserver.js/package.json digests default `None`, so `discover()`/`from_release_root()` never hash them. Nothing in repo supplies those digests (`provenance.json` carries npm tarball sha512 only; nothing reads it). A same-uid/group-writable-parent tamper of `cli.mjs` passes. Also whole `node_modules/**` (vscode-languageserver, typescript/lib/*.js loaded by tsserver) unchecked; parent-dir mode/ownership unchecked. Plan Req 3/Todo "tamper entrypoint/package" unmet; tests tamper only node digest (`test_digest_verification_tamper_detection`). Fix: make digests non-optional; source them from the release `release-manifest.json` inventory (sha256 for every `lib/semantic-engine/**` file, already generated) or embed a build-generated digest table; verify all files in tuple + owner (root/server uid) + parent dir `0o022`. Add tamper tests for each of the 3 artifacts + default-profile test.
2. **Windows CI compile break (likely)** — `semantic/mod.rs:6` registers `tool_profile` unconditionally; `tool_profile.rs:17` `use std::os::unix::fs::PermissionsExt;` ungated, plus `.mode()` calls. `pr-quality-gate.yml:185-203` job `server_windows` runs `cargo test --no-run` and `cargo check --all-targets` on windows-latest. Test files are `#![cfg(target_os="linux")]` (ok), lib module is not. Reviewer could not cross-compile (mingw/libz-sys missing) → **[INFERENCE]** high confidence from language rules. Fix: `#[cfg(target_os = "linux")] pub mod tool_profile;` (plan: no Windows semantic scaffold) or cfg-gate mode checks; consistent with `resources/linux.rs` gating.

## Warnings

1. **Unrelated rustfmt churn** — `git diff --shortstat`: 188 files, +14080/−11318 (+4845/−2083 ignoring whitespace; import reorders/line joins) across api/, auth/, config/, agent_status/, examples/, tests/ etc. HEAD is not rustfmt-clean (verified on `HEAD:server/src/api/auth_mfa.rs`). Cycle-1 scope was 6 modified files. Violates "no restyling unrelated code", inflates review/merge-conflict surface. Fix: restore unrelated files to HEAD; keep fmt only on phase files (`semantic/*`, new tests, touched linux_release files).
2. **Hard mode practically unreachable, unqualified** — live probe: daemon cgroup `/system.slice/dam-hopper-api.service` is root-owned, `mkdir` → EACCES ⇒ always PortableOnly in default install. `dam-hopper-api.service.in` has no `Delegate=`; code never touches `cgroup.subtree_control`. **[INFERENCE]** cgroup v2 no-internal-process rule means even with `Delegate=yes` controllers cannot be enabled while daemon PID lives in that cgroup unless it relocates to a sub-cgroup. Plan step 7 (qualify delegated/nondelegated) not done; no real-kernel test. Honest fallback is good; document hard mode as not-yet-available or add delegated sub-cgroup design.
3. **`Hard` reported before containment proven** — `try_setup_cgroup` returns `ResourceMode::Hard` after writing limits; actual attach occurs later in `pre_exec`; failure → `spawn` error, no fallback to PortableOnly path. Define state transition in owner (Phase 04) or return a `Prepared` handle that becomes `Hard` only after spawn success.
4. **`pre_exec` not async-signal-safe** — `launch.rs:141-148` allocates post-fork (`format!`, `OpenOptions::open` CString). Prefer opening `cgroup.procs` fd before spawn and `libc::write(fd, b"0\n")` in closure (writing `0` = self; drops `getpid`/format). Also `with_cgroup_procs_path` is `#[doc(hidden)] pub` yet `cgroup_procs_path` field is `pub` — callers can redirect arbitrary file writes in child pre-exec; make field private.
5. **cgroup teardown racy/unverified** — `linux.rs ChildCgroupScope::cleanup`: writes `cgroup.kill` then immediately `remove_dir` (async kill ⇒ EBUSY), error dropped in `Drop`; no bounded wait on `cgroup.events populated 0`; no retry; `active=false` set before attempt. No production caller wires scope to `SemanticChildOwner` teardown (dead code until Phase 04). `memory.swap.max` not set (swap bypasses 768 MiB); no read-back of written limits.
6. **SBOM generator** (`generate-release-manifest.mjs:360-445`): (a) SPDXID uses `_` — SPDX 2.3 idstring allows only `[A-Za-z0-9.-]`; old `-` was valid ⇒ regression, invalid SBOM; (b) `catch {}` + `|| "5.9.3"` fallbacks silently invent versions if `provenance.json` missing/corrupt — fail closed; (c) no cross-check inventory `lib/semantic-engine/node` sha256 == provenance node sha256; (d) all transitive `node_modules` files labelled `MIT` except 2 prefixes (false license claims), no transitive packages/relationships; (e) `hasSemanticEngine` = any path prefix, not tuple completeness.
7. **No assembler / lock / CI wiring** — `deploy/release/semantic-engine/` has only `package.json` + `provenance.json` (no lockfile ⇒ transitive deps unpinned; plan step 2 "reject ranges/lock"). `release-linux.yml`, installer, systemd untouched ⇒ real releases omit engine; plan Todos 1-3 and Success Criteria 1 (fresh install/update/rollback with tuple) unmet; no offline install/update/rollback test. `PINNED_NODE_SHA256` duplicated in Rust + provenance.json + docs with no linking test (`include_str!` assertion).
8. **Rust inventory validator** doesn't require tuple completeness (any single `lib/semantic-engine/x` entry accepted; node + cli.mjs + tsserver.js + package.json not required together); setuid/sticky bits not rejected (`& 0o022` only). No web-only omission / partial-tuple tests.
9. **Symlink check final component only** (`tool_profile.rs check_regular_file`) — `tsls/node_modules -> /elsewhere` undetected; prior W3 unchanged. Walk components with `symlink_metadata` or compare `canonicalize()` of file to `release_root.canonicalize().join(rel)`.
10. **Perf** — `create_launch_spec` re-hashes ~100 MB node every call (64 KiB buffer, sync, on caller thread). Cache per (dev, ino, size, mtime) or hash once at startup via `spawn_blocking`; raise buffer.
11. **Limits mostly encoded not enforced** — `ResourceLimitError::{TooManyDocuments,SessionOverlayExceeded,GlobalOverlayExceeded,InFlightQueueFull}`, rate/restart/idle/doc-count/tree constants and `ResourcePolicy` have no production consumer (YAGNI/dead) — acceptable as Phase 04 contract only if plan todo "enforce" stays open. `ResourcePolicy` fields still `pub`; validators are associated fns ignoring `self`.
12. **Public digest injection** — `from_release_root_with_digests` + `pub PinnedDigests` lets any in-crate caller supply digests (prior test-knob W4). Restrict to `pub(crate)`/`#[cfg(test)]` or make production constructor the only path.
13. **Path leakage** — `ToolProfileError::IntegrityFailed(ToolIntegrityStatus)` formats with `{:?}` incl. absolute paths/expected hashes; plan Security forbids exposing executable/private paths in telemetry. Map to code enums before any API/log exposure.
14. **Test gaps** — no test: tamper cli.mjs/tsserver.js/package.json digest; mid-path symlink; missing-controller on fake cgroup tree (+child dir removed); `pre_exec` actually moving a process; web-only projection omits engine; build script smoke (deterministic archive twice).

## Suggestions
- `provenance.json`: drop `$schema`/`title` (data, not schema); add per-file sha256 table or lock hash; confirm bundle `package.json` license `Apache-2.0` vs project MIT intent.
- Single `loadProvenance()` in generator feeding SPDX + archive-script validation (`node scripts/verify-engine.mjs` called from build-release-archive.sh).
- Scope `.tsbuildinfo` denylist to staged engine/assembly step instead of global inventory denylist (low).
- Report per-control facts (`memory/cpu/pids applied|unavailable`) in `PortableOnly` instead of free-text reason.
- Remove `v8_max_old_space_mb` duplication between `ResourcePolicy` and `BundledLaunchSpec` (single const already; make spec read policy).
- Add `memory.swap.max`/`memory.oom.group=1` to the hard-control set once qualified.
- Revisit 50% CPU quota vs 30 s startup deadline under throttle during Phase 09.

## Positive Observations
- C1 fix clean; env test meaningful. Session-id allowlist and fail-closed `/proc/self/cgroup` handling solid.
- `PortableOnly` fallback never panics, never leaks child dir on config failure; telemetry no longer serializes cgroup path or raw error text.
- Constants centralized and consumed by framing/types/launch (DRY achieved for those).
- Rust inventory validator now role/mode/unknown-path strict; `.db` test restored.
- Archive builder determinism preserved (`cp -rL`, normalized modes/mtimes, sorted list, `lib` dirs included).
- Unique SPDX file IDs via index; no custom command/profile/registry; Java/Rust explicitly unsupported.
- 55/55 tests; clippy shows no new warnings in phase files (only pre-existing collapsible-if elsewhere).

## Plan Todo Status (observed)
- [ ] Stage exact immutable tuple via release owner — partial (flag + presence checks; no CI/assembler/lock)
- [ ] Hashes/licenses/lock/provenance + SBOM relationships — partial (3 packages, no lock, coarse licenses)
- [ ] Strict inventory/role projection + offline install/update/rollback — inventory mostly; install/update/rollback unexercised
- [ ] Passive integrity vs protocol probe — passive partial (node digest only); no readiness type
- [ ] Enforce Phase 01 limits — encoded + framing consumers; admission/rate/overlay unenforced
- [ ] Hard controls + portable fallback — code complete for setup/attach; unqualified, unwired, unreachable in default unit
- [x] No custom command/profile/workspace selection — env override removed

## Recommended Actions (priority)
1. Pin + verify digests for all executed tuple artifacts from release inventory; owner/parent-dir checks; tamper tests (Critical 1, W9).
2. Gate `tool_profile` to Linux; confirm `cargo check --all-targets` on Windows CI (Critical 2).
3. Revert unrelated rustfmt churn (W1).
4. Fail-closed provenance loading, valid SPDXIDs (`-` not `_`), node sha cross-check, license accuracy (W6).
5. Add assembler + lockfile + CI/installer wiring + install/update/rollback test, or explicitly re-scope plan todos (W7).
6. Harden pre_exec (pre-opened fd, write `0`), make `cgroup_procs_path` private; add bounded `cgroup.events` wait on cleanup (W4, W5).
7. Decide delegation design (`Delegate=`/sub-cgroup) or document hard mode as unavailable (W2).
8. Cache node digest; add missing tests (W10, W14).

## Metrics
- Tests: reviewer re-ran `semantic_tool_profile` 11/11, `semantic_resources` 8/8, `linux_release_manifest` 12/12 (pass; counts per tester list). Tester: 55/55 over 5 targets, twice.
- Type coverage: n/a (Rust). Linting: `cargo fmt --check` clean; clippy (`--tests --offline`) 0 new warnings in phase files.
- Not run: Windows cross-check (toolchain C deps missing), packaging scripts, live cgroup hard-mode (daemon cgroup EACCES), install/update/rollback.

## Validation Commands / Results
- `git status`, `git diff --shortstat` (+ `-w`): 188 files modified, mostly formatting.
- `cargo fmt --check` (server): no diff.
- `cargo clippy --offline --tests -q`: no warnings in `semantic/*`, `semantic_*` tests; pre-existing elsewhere.
- `cargo test --offline --test semantic_tool_profile --test semantic_resources --test linux_release_manifest`: 11/8/12 pass.
- `cargo check --offline --lib --target x86_64-pc-windows-gnu`: failed on `libz-sys` build script (env), inconclusive.
- Live probe: `mkdir` in own cgroup `/sys/fs/cgroup/system.slice/dam-hopper-api.service` → Permission denied (probe dir not created).

## Unresolved Questions
1. Will releases for server/both REQUIRE the engine (schema flag) or stay optional until Phase 06? Current optional + no CI wiring ⇒ engine silently absent.
2. Source of truth for cli.mjs/tsserver.js/package.json digests: release inventory at runtime, or generated digest table at assembly?
3. Is `Delegate=yes` + daemon-relocating sub-cgroup planned in this phase, or is hard mode intentionally deferred?
4. Should rustfmt-wide reformat be a separate chore commit (and does main have it pending), or reverted from this change?
5. Does Windows CI (`server_windows`) currently pass with this working tree?
