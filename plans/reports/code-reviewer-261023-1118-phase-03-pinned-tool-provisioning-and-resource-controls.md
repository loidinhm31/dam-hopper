# Code Review — Phase 03 Pinned Tool Provisioning and Resource Controls

Plan: `plans/260901-1000-lsp-server-integration/phase-03-pinned-tool-provisioning-and-resource-controls.md`
Date: 2026-10-23 | Reviewer: CodeReviewerPhase03 | Mode: read-only review (no plan/code edits)

## Score: 4.5 / 10

Foundations present (inventory role plumbing, constants, passive node check, cgroup scaffold). Plan acceptance NOT met: tuple never provisioned by CI/installer, integrity covers 1 of N executed artifacts, env var can select engine root, "hard" mode can report limits never applied, central limits not consumed by any production code. Phase should stay Pending/In-Progress, not Done.

## Scope
- Files: 13 listed in assignment (+ plan, tester report, `.github/workflows/release-linux.yml`, `dam-hopper-install.sh` grep, `framing.rs`/`types.rs`/`launch.rs`/`child.rs` consumer cross-check).
- ~1.3k LOC new/changed. Focus: security, perf, architecture, YAGNI/KISS/DRY.

## Critical Issues

1. **Env var selects executable root** — `tool_profile.rs:117-124` `discover()` honours `DAM_HOPPER_SEMANTIC_ENGINE_ROOT` (comment: "test harness"). Plan: env/flag/host file cannot select another executable/package tree. Production `pub fn`; only `path.exists()` gated. Since only node is hashed (see 2), attacker-controlled env ⇒ arbitrary JS under pinned node. Fix: delete env branch; tests use `from_release_root`. Also drop exe-relative guess or verify; resolve release root from one fixed owner (layout/`/opt/dam-hopper/current`-style) only.
2. **Integrity covers only `node` digest** — `verify_integrity` (`tool_profile.rs:175-244`) checks existence/regular-file for `cli.mjs`, `tsserver.js`, `package.json` but NO digest, no ownership/mode (group/world-writable), no package-tree check. These files are what node executes. Plan Req 3 + Todo "tamper entrypoint/package" unmet; no tamper test for them. `provenance.json` sha512 `integrity` values are consumed by nothing (no code/test/script reads the file). Fix: verify against release `release-manifest.json` inventory sha256 for every `lib/semantic-engine/**` file (or at minimum node + cli.mjs + tsserver.js + package.json + lock) and reject non-root-owned / `mode & 0o022` entries.
3. **Tuple never provisioned end-to-end** — `build-release-archive.sh:216-225` just `cp -rL` an arbitrary `--semantic-engine-dir` (only checks `node` exists). No verification of node sha vs provenance, no presence checks for `tsls/` tree, no lockfile (deploy/release/semantic-engine has only `package.json` + `provenance.json`; no `package-lock.json`/integrity-verified install step, no node tarball digest — only extracted-binary digest). `.github/workflows/release-linux.yml` and `dam-hopper-install.sh` contain zero semantic-engine wiring (grep), so real releases omit the engine while the SBOM/validators claim support. No assembler script ⇒ "reproducible cached/offline assembly" (Impl step 2) and install/update/rollback qualification (step 5, Todo 1/3) not done. `cp -rL` also silently inlines host files if staged dir contains symlinks to outside; build input must be digest-verified first.
4. **`Hard` mode can claim limits never applied** — `resources/linux.rs:266-289` `configure_cgroup_limits` skips each of memory.max/cpu.max/pids.max when the file is absent (`if exists`), then `try_setup_cgroup` returns `ResourceMode::Hard{memory_max_bytes,…}` unconditionally. A new child cgroup only has those files when the controller is enabled in parent `cgroup.subtree_control`; code never enables/verifies it (and cgroup v2 no-internal-process rule blocks enabling it in the daemon's own populated cgroup). Result: false `hard` report with no RSS/CPU/pid ceiling — violates "use `hard` only for the complete control set". Fix: require all three files present + read back values; else cleanup + `PortableOnly` with precise per-control facts. Prefer a delegated leaf sibling cgroup, not a child under the daemon's own cgroup.
5. **No pre-exec/pre-serve containment** — module doc claims "Attachment in pre-exec … zero-race" but only post-hoc `attach_pid(pid)` exists; nothing spawns into the cgroup (`CLONE_INTO_CGROUP`/pre_exec write of `cgroup.procs`, or `cgroup.kill` verification). Descendants forked before attach escape the limits. Plan Req "apply to complete tree before admitting semantic work" unmet. Also no production caller of `LinuxResourceController`/`ChildCgroupScope`/`SemanticToolProfile`/`ResourcePolicy` (grep: only own file + tests) — dead code.

## Warnings

1. **Central limits not enforced/consumed (DRY + plan Req 6)** — duplicate constants remain: `framing.rs:6,9` (`MAX_HEADER_SIZE`,`MAX_BODY_SIZE`), `types.rs:5-9` (`MAX_QUEUE_COUNT`, `MAX_QUEUE_BYTES`, `MAX_STDERR_RING_BYTES`, `GRACEFUL_SHUTDOWN_TIMEOUT`), `launch.rs:77` literal `256`. `resources.rs` re-declares same values (two sources of truth; no test ties them). `ResourceLimitError::{TooManyDocuments,SessionOverlayExceeded,GlobalOverlayExceeded,InFlightQueueFull}` are never constructed; only doc/frame/header validators exist; no reservations/aggregate-cap accounting, rate limiter, or restart-policy types (restart/rate constants unused). Migrate consumers to `resources` consts and delete duplicates, or remove unused items (YAGNI).
2. **`ResourcePolicy` caller-mutable and serde `Deserialize`** (`resources.rs:127-149`) — all `pub` fields + `Deserialize` allows enlarging; plan: "callers cannot enlarge". Validators ignore the struct (use globals), so a mutated policy has no effect yet looks authoritative. Make fields private/`Serialize`-only (publish identity), validators `&self` or free fns.
3. **Symlink handling incomplete** (`tool_profile.rs:258-275`) — only final path component inspected; intermediate dir symlink (`tsls/node_modules -> /elsewhere`) undetected. Archive has no links (`cp -rL`), so simplest correct rule: reject ANY symlink on the path (use `O_NOFOLLOW`/walk components or compare `canonicalize()` of whole path to `root.canonicalize()`). `starts_with(&self.release_root)` also compares canonical vs non-canonical root ⇒ false reject if root path itself contains a link.
4. **Test-only knob in prod API** — `with_expected_node_sha256(None)` (`tool_profile.rs:143`) disables the digest on a public builder; `expected_node_sha256: Option`. Make the digest non-optional; test harness should build matching fixture bytes + compute digest.
5. **Perf: full node hash on every `create_launch_spec`** — ~100 MB SHA-256 per call (16 KiB buffer) each session start / ON. Cache result per release root keyed by (dev,ino,size,mtime) or hash once at startup off the async executor; use larger buffer. Also check→hash→exec TOCTOU (acceptable under stated threat model; document).
6. **SBOM/license fidelity** (`generate-release-manifest.mjs:334-435`) — versions/URLs hard-coded (DRY vs `provenance.json`; will drift); engine "present" = any `lib/semantic-engine/` path, not exact tuple; transitive node_modules files all labelled `licenseConcluded: "MIT"` except 2 package prefixes (false license claims; plan: all transitive packages/licenses/NOTICES); no `checksums` on the 3 engine packages, no relationships for transitive packages. Read provenance.json, fail generation if tuple mismatch/incomplete. Existing `SPDXRef-File-` sanitizer collides (`a/b-c` vs `a-b/c`) — thousands of node_modules paths raise the risk; add uniqueness assertion (SPDX invalid on dup IDs).
7. **Rust validator asymmetric with JS role assignment** (`inventory_validation.rs:195-211`) — JS rejects unknown `lib/*`, Rust accepts any non-`semantic-engine` `lib/…` (falls through) and does not require tuple completeness (node + cli.mjs + tsserver + package.json + lock) when any engine entry exists, does not check `lib` dir role, does not reject group/world-writable or setuid modes. Plan: "accept only approved server-role tuple paths". Tests only add 3 entries (none for web-only omission, partial tuple, writable mode, unknown `lib/x`).
8. **Test regression** `inventory_path.rs:81` replaced `db/test.db` assertion with `.tsbuildinfo` — `.db` coverage lost; keep both. Global `.tsbuildinfo` denylist is workaround for payload hygiene; scope it to the staged engine or strip at assembly.
9. **cgroup hygiene** (`linux.rs`) — `session_id` unvalidated in path (`dam-hopper-semantic-{id}`; reject `/`, `..`, non-`[A-Za-z0-9-]`); `cleanup`/`Drop` `rmdir` ignores EBUSY with live members and never uses `cgroup.kill`/verifies empty ⇒ leaked cgroups/helpers; empty `/proc/self/cgroup` fallback silently targets root cgroup base (outside daemon service) — fail closed instead; `memory.swap.max` not set (swap bypasses 768 MiB); `exists()`-then-write TOCTOU irrelevant but silent-skip is the real bug (Critical 4).
10. **Telemetry leak** — `ResourceMode::Hard.cgroup_path` is `Serialize`; `PortableOnly.reason` embeds error text with filesystem paths (`PermissionDenied(PathBuf)` Display). Plan Security: never expose private paths in capability telemetry. Use enum reason codes + per-control booleans (applied/unavailable), keep path internal. `Deserialize` unnecessary.
11. **Non-Linux stub** (`resources.rs:223-247`) duplicates `ResourceMode` for a platform plan says gets no scaffold (YAGNI); stub also differs in shape from Linux enum (no `Hard` variant) so cross-platform consumers can't match exhaustively.
12. **Passive vs protocol-qualified split not modelled** — only `ToolIntegrityStatus`; no `integrity-valid`/`protocol-qualified`/`missing-tool`/`incompatible` readiness type (Todo 4). OK to defer to Phase 04 but then Todo stays open.
13. **Formatting**: `rustfmt --check` reports 28 diffs across the 5 new Rust files (double blank lines `tool_profile.rs:162-163,214-215`, out-of-order step comments "5." before "4." at 209/216, stray import ordering). Clippy on `--tests`: no warnings in phase files.

## Suggestions
- Link constants to provenance with a test: `include_str!("../../../deploy/release/semantic-engine/provenance.json")` ⇒ assert `PINNED_NODE_SHA256` equals; prevents drift (hash duplicated in provenance.json, docs, Rust, now).
- Generator: single `loadProvenance()` feeding SPDX + build-script validation (node sha, TS/TSLS `integrity` vs `npm ci --ignore-scripts` lock result).
- Rename `provenance.json` `$schema`/`title` fields — it is data, not a schema; `package.json` bundle license "Apache-2.0" vs project MIT: confirm intent.
- Add tests: tamper `cli.mjs`/`tsserver.js`, mid-path symlink, group-writable file, `discover()` ignoring env, hard-mode fixture on a fake cgroup tree (tempdir w/ controller files) asserting absent controller ⇒ `PortableOnly`, session-id traversal, partial-setup cleanup, web-only projection omits `lib/semantic-engine`, build-script smoke (deterministic archive hash twice).
- Use one `Duration`-based policy struct from constants (derive ms from consts as done) and remove `v8_max_old_space_mb` duplicate in `launch.rs`.
- Doc: record in plan which Phase 01 gate (G1 layout `lib/semantic-engine/tsls/node_modules/...`) the layout matches; plan states no unselected path invented.

## Positive Observations
- Archive builder deref + normalized perms/mtime + sorted list keeps determinism; `lib` role assignment `server`-only so web-only omission follows existing projection.
- Node executable-bit validation added to Rust inventory; clear error variants; passive checks genuinely spawn zero children.
- Graceful degrade path in `prepare_child_scope` removes partial dir on config failure and never panics; limits sensible and documented (pids 64 for libuv/V8 threads).
- Constants well-documented; test asserts exact Phase 01 values.
- No custom command/profile/registry; Java/Rust explicitly unsupported.
- Clippy clean for phase files.

## Plan Todo Status (observed)
- [ ] Stage exact immutable tuple — partial (pass-through flag; no CI, no verification)
- [ ] Hashes/licenses/lock/provenance + SBOM relationships — partial (provenance.json only, no lock, hard-coded SBOM)
- [ ] Strict inventory/role projection + offline install/update/rollback — inventory partial; install/update/rollback untested
- [ ] Passive integrity vs protocol probe — passive partial (node-only digest); no probe/readiness type
- [ ] Enforce Phase 01 limits — encoded, not enforced/consumed
- [ ] Hard controls + portable fallback — scaffold with false-hard defect; no tree attach; no consumer
- [ ] No custom command/profile/workspace resolution — violated by env root override

## Reviewed Files
`deploy/release/semantic-engine/{package.json,provenance.json}`, `deploy/release/build-release-archive.sh`, `deploy/release/generate-release-manifest.mjs`, `server/src/linux_release/{inventory_path.rs,inventory_validation.rs}`, `server/src/semantic/{tool_profile.rs,resources.rs,resources/linux.rs,mod.rs}`, `server/tests/{semantic_tool_profile.rs,semantic_resources.rs,linux_release_manifest.rs}`; cross-checked `framing.rs`, `types.rs`, `launch.rs`, `child.rs`, `release-manifest.schema.json`, `release-linux.yml`, `dam-hopper-install.sh`.

## Validation Commands / Results
- `git status`/`git diff` — scope confirmed (6 modified, 7 new paths).
- `cargo clippy --tests --offline` (server) — completed; no warnings from phase-03 files (pre-existing warnings elsewhere).
- `rustfmt --check --edition 2021` on 5 new Rust files — 28 diffs (FAIL formatting).
- Tester report `plans/reports/tester-261023-1113-phase-03-pinned-tool-provisioning-and-resource-controls.md`: 49/49 pass (semantic_tool_profile 9, semantic_resources 6, linux_release_manifest 10, lib semantic:: 13, semantic_child_process 11). Not re-run by reviewer; passing tests do not exercise issues above (no digest-tamper, hard-mode, env-override, packaging tests).
- No JS/shell packaging run (no engine payload in repo; `build-release-archive.sh`/generator not executed).

## Recommended Actions (priority)
1. Remove env-based `discover()` override; single fixed release-root resolution.
2. Verify all executed artifacts (inventory sha256 + owner/mode + no symlinks) before launch spec; add tamper tests.
3. Fix hard mode: require/verify all controllers or report PortableOnly with per-control facts; attach before exec; kill/verify empty on teardown; validate session id.
4. Add real assembler (locked `npm ci --ignore-scripts`, node tarball digest) + CI/installer wiring + lock file; drive SBOM from provenance; unique SPDXIDs, accurate transitive licenses.
5. Make Rust validator enforce exact tuple/mode; restore `.db` test.
6. Migrate framing/types/launch to `resources` constants; implement or delete unused limits/errors; make policy immutable/non-deserializable.
7. Cache node digest; `cargo fmt`.
8. Keep plan status Pending until offline install/update/rollback evidence exists.

## Unresolved Questions
- Is Node `v24.16.0` + TSLS `6.0.2` bundle (do TSLS 6.x deps get vendored/bundled or need transitive install) the G1-selected tuple? Lock/transitive license set unknown.
- Intended release-root resolution for the daemon (`/opt/dam-hopper/current`? exe-relative?) — which layout owner defines it?
- Should releases for server/both REQUIRE the engine (schema flag) or stay optional until Phase 06 enables semantics?
- Is cgroup delegation (`Delegate=` in `dam-hopper-api.service.in`) planned in this phase? Template untouched; hard mode currently cannot work under the daemon's own populated cgroup.
- Was tester report run against current working tree (no timestamps tied to commit)?
