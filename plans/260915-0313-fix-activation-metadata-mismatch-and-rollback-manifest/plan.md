---
title: "Fix activation metadata mismatch and rollback manifest compatibility"
description: "Restore safe v0.2.0-to-v0.3.1 upgrades by narrowly tightening the legacy API state directory and dual-reading installed Manifest v1 during rollback."
status: in_progress
priority: P2
effort: 8.5h
branch: main
tags: [bugfix, backend, linux-release, rollback, security, infra]
created: 2026-09-15
---

# Fix activation metadata mismatch and rollback manifest compatibility

## Objective

Fix the two-stage upgrade failure without weakening new-release validation:

1. Safely migrate only the known legacy `/var/lib/dam-hopper` mode `0755` to current `0700`, after descriptor-based type and UID:GID validation.
2. Keep external/candidate publication strict Manifest v2, while allowing already-installed active/previous releases to read validated Manifest v1 for start, rollback, recovery, and retention.
3. Rebuild `v0.3.1` from the fixed commit by deleting and recreating the tag.

Diagnostic source: [`../reports/debugger-260915-0251-activation-metadata-mismatch-rollback-failure.md`](../reports/debugger-260915-0251-activation-metadata-mismatch-rollback-failure.md).

## Architecture and root cause

### Failure chain

```text
v0.2.0 host
├─ /var/lib/dam-hopper = directory, API UID:GID, 0755
│  └─ created by systemd StateDirectory/default umask
└─ installed release-manifest.json = schemaVersion 1
   └─ services.api.identity = "root"

v0.3.1 manager activation
├─ api_runtime::ensure_dir requires exact 0700
│  └─ rejects known 0755 upgrade state before API start
└─ automatic rollback validates active v0.2.0 with v2-only parser
   ├─ deny_unknown_fields rejects services.api.identity
   └─ schema validator would reject schemaVersion 1 next
      └─ activation + rollback failure => RECOVERY_REQUIRED
```

### Design boundaries

- **Write contract stays v2.** Publisher, acquisition, `validate`, and new bundle staging continue accepting/emitting only `schemaVersion: 2`. No JSON Schema or generator relaxation.
- **Read compatibility is provenance-scoped.** Installed immutable release views referenced by manager state may validate schema `1` or `2`. Arbitrary downloaded manifests may not.
- **Legacy `services.api.identity` is compatibility data only.** It never supplies runtime UID/GID. Final installed API unit `User=`/`Group=` remains sole identity authority.
- **Permission migration is exact and one-way.** Only `/var/lib/dam-hopper`, only genuine directory, only expected UID:GID, only `0755 -> 0700`. No `chown`, recursive repair, alternate mode normalization, file repair, or symlink following.
- **Descriptor remains authority.** Validate opened directory with `fstat`, run existing `fchmod` syscall seam, then `fstat` exact `0700` before descending.
- **Intentional partial persistence.** If a later provisioning step fails, retain the successful `0700` tightening. It is safe, idempotent, and not a call-created object eligible for cleanup.

## Scope

### Files to modify during implementation

| Phase | Absolute path | Change |
| --- | --- | --- |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/manifest.rs` | Optional legacy API identity field; strict and installed-release parsing entrypoints |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/manifest_validation.rs` | Current-v2 vs installed-v1/v2 schema policy; schema-aware API identity invariant |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/activate_preflight.rs` | Use installed-release compatibility parser for hash-bound managed views |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/rollback.rs` | Parse recorded previous release with installed-release policy before restaging |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/retention.rs` | Validate installed v1/v2 views before safe retention deletion |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/tests/linux_release_manifest.rs` | v1 compatibility fixture and v2 emission assertions |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/tests/linux_release_manifest_errors.rs` | Preserve strict-v2 rejection and unknown-field behavior |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/tests/common/release_fixtures.rs` | Set v2 `ApiServiceContract.identity` to `None` |
| 1 | `/mnt/data/ws/sharing/dam-hopper/server/tests/linux_release_unit_policy.rs` | Set v2 `ApiServiceContract.identity` to `None` |
| 2 | `/mnt/data/ws/sharing/dam-hopper/server/src/linux_release/api_runtime.rs` | Exact legacy state-root mode tightening and focused fake-syscall tests |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/linux-release-manifest.md` | Document strict v2 write boundary plus installed v1 read compatibility |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/linux-release-manager.md` | Document v1 active/previous rollback behavior |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/linux-release-runtime-provisioning.md` | Document the sole refusal-policy exception: owned state root `0755 -> 0700` |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/linux-systemd.md` | Add upgrade/rollback behavior and operator verification |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/code-standards.md` | Reconcile manifest and runtime identity invariants |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/codebase-summary.md` | Reconcile high-level release compatibility boundary |
| 3 | `/mnt/data/ws/sharing/dam-hopper/docs/CHANGELOG.md` | Record upgrade and rollback fix |

### Explicit non-goals

- Do not change `RELEASE_MANIFEST_SCHEMA_VERSION`; current release schema remains `2`.
- Do not add API identity back to publisher schema or generated v2 JSON.
- Do not accept Manifest v1 in acquisition, public validation, or new bundle staging.
- Do not treat manifest `identity` as account/runtime authority.
- Do not accept schema `0`, `3`, or arbitrary future versions.
- Do not loosen `deny_unknown_fields` beyond the single known legacy API field.
- Do not repair wrong ownership, wrong type, symlinks, special files, nested directory modes, canonical config, or audit metadata.
- Do not change manager-state schema, systemd unit templates, API ports, health policy, or rollback state machine transitions.

## Phase 1 — Manifest backward compatibility and rollback support [COMPLETED]

**Effort:** 3.5h  
**Outcome:** v1 active/previous manifests parse through installed-release paths; external/new candidates remain strict v2. (Verified by linux_release_manifest and linux_release_manifest_errors tests).

### 1.1 Model the known legacy field without restoring authority

In `server/src/linux_release/manifest.rs`, change only `ApiServiceContract`:

```rust
pub struct ApiServiceContract {
    pub unit_name: String,
    /// Manifest v1 read compatibility only. Never runtime identity authority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
    pub bind_host: String,
    pub port: u16,
    pub health_path: String,
}
```

Required follow-through:

- Add `identity: None` to all v2 Rust struct literals in:
  - `server/tests/linux_release_manifest.rs`
  - `server/tests/common/release_fixtures.rs`
  - `server/tests/linux_release_unit_policy.rs`
- Keep current publisher output unchanged: `None` omits the field.
- Do not modify `deploy/release/release-manifest.schema.json` or release generator; v2 still forbids API `identity`.

### 1.2 Split strict parsing from installed-release compatibility

Refactor `ReleaseManifest` parsing to share payload-size and Serde decoding once, then choose invariant policy:

```rust
pub fn parse_and_validate(raw: &[u8]) -> Result<Self, ReleaseError>;

pub fn parse_and_validate_installed_release(
    raw: &[u8],
) -> Result<Self, ReleaseError>;
```

Behavior:

| Entrypoint | Accepted schema | API identity |
| --- | --- | --- |
| `parse_and_validate` | exactly `2` | must be absent |
| `parse_and_validate_installed_release` | `1` or `2` | v1 requires legacy `"root"`; v2 requires absent |

Implementation shape in `manifest_validation.rs`:

- Preserve `validate_manifest_invariants(&ReleaseManifest)` as strict-v2 behavior.
- Add a narrowly named installed-release validator.
- Share all non-schema validation through one private helper; no duplicated profile/archive/component/inventory/service/rollback logic.
- For schema 1, recognize `services.api.identity == Some("root")` only as the old signed/hashed manifest contract. Never return or pass it to account resolution.
- For schema 2, reject `Some(_)` with `ServiceContractMismatch` (expected `absent`) so v2 remains semantically strict even though Serde knows the compatibility field.
- Continue rejecting every other unknown field through `deny_unknown_fields`.
- Keep unsupported schema errors on the existing `InvalidSchemaVersion` path; do not broaden the error model for this fix.

### 1.3 Route only installed-release consumers through dual-read

- `activate_preflight.rs`: use `parse_and_validate_installed_release` inside shared managed-view preflight.
  - Safe because the manifest is under the managed releases root, ownership-checked, and bound to `PendingCandidateRecord.manifest_sha256` before parsing.
  - This covers ordinary active start, post-switch validation, automatic rollback restoration, boot recovery, and manual rollback activation.
- `rollback.rs::stage_previous_release_candidate`: use installed-release parser before staging recorded `state.previous`.
  - Keep tag/version, manifest digest, and archive digest equality checks unchanged.
- `retention.rs`: use installed-release parser for managed historical views, allowing a no-longer-referenced v1 view to pass validation before deletion.
- Keep these strict-v2 call sites unchanged:
  - `acquire.rs`
  - `stage_transaction.rs`
  - `manifest.rs::validate_manifest_and_archive`
  - CLI/public validation and publisher contract tests

This avoids state-schema changes or a rollback-only flag in `PendingCandidateRecord`.

### 1.4 Tests

In `server/tests/linux_release_manifest.rs`:

1. Add a v1 fixture derived from the valid manifest JSON:
   - set `schemaVersion` to `1`;
   - insert `services.api.identity: "root"`;
   - retain otherwise valid v0.2.0 fields.
2. Assert strict parser rejects it with `InvalidSchemaVersion { expected: 2, got: 1 }`.
3. Assert installed-release parser accepts it and preserves `identity == Some("root")` as inert compatibility data.
4. Assert valid v2 round trip has `identity == None` and serialized `services.api` does not contain `identity`.
5. Assert schema `0` and `3` remain rejected by installed-release parser.

In `server/tests/linux_release_manifest_errors.rs`:

1. Update `test_reject_removed_api_identity`: a schema-2 manifest containing API identity must still fail, now as `ServiceContractMismatch`, not necessarily Serde unknown-field failure.
2. Add v1 wrong/missing identity cases; compatible parser rejects both.
3. Keep generic unknown root/nested fields rejected by Serde.

Rollback/preflight regression:

- Add a focused case to `server/tests/linux_release_state_machine.rs` (or existing preflight test location if fixture reuse is cleaner) that writes a hash-bound v1 manifest into a managed active/previous release view and proves installed preflight reaches success rather than JSON/schema failure.
- Preserve strict staging proof: feeding the same v1 bytes to public/new-bundle validation still fails.
- Prefer filesystem fixtures and existing manager-state records; do not invoke real host systemd.

### Phase 1 acceptance

- Exact v0.2.0-shaped manifest parses only through installed-release policy.
- Automatic rollback's `validate_active_preflight` no longer fails on `identity` or schema `1`.
- Manual rollback can restage and activate a recorded v1 previous release.
- New release acquisition/staging and `dam-hopper validate` remain v2-only.
- Manifest identity never reaches unit parsing, account lookup, provisioning, or health target construction.

## Phase 2 — API runtime state directory permission reconciliation [COMPLETED]

**Effort:** 2.5h  
**Outcome:** clean installs create `0700`; valid v0.2.0 state roots tighten from `0755` to `0700`; all other mismatches still refuse. (Verified by api_runtime::tests).

### 2.1 Add narrow existing-directory mode policy

In `server/src/linux_release/api_runtime.rs`, add a private allocation-free policy such as:

```rust
#[derive(Clone, Copy)]
enum ExistingDirModePolicy {
    Exact,
    TightenFrom(u32),
}
```

Extend `ensure_dir` with this policy:

- `/var` and `/var/lib`: `Exact` at `0755`.
- `/var/lib/dam-hopper`: `TightenFrom(0o755)` toward `API_DIR_MODE` (`0700`).
- `.config` and `.config/dam-hopper`: `Exact` at `0700`.

Do not generalize into arbitrary migration tables or recursive repair.

### 2.2 Reconcile through the opened descriptor

For an existing `/var/lib/dam-hopper`:

1. `stat_at(..., AT_SYMLINK_NOFOLLOW)` must report directory, expected UID, expected GID, and mode either `0700` or exactly `0755`.
2. Open using existing `open_dir_at` (`O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`).
3. `fstat` the opened descriptor. Recheck genuine directory, expected owner/group, and allowed current mode. This check is authoritative against path replacement between `stat_at` and open.
4. If descriptor mode remains `0755`, call existing `RuntimeSyscalls::chmod`; production implementation already maps this to `libc::fchmod`.
5. `fstat` again and run exact existing `validate(..., mode=0700)` before opening children.
6. If another actor already tightened it to `0700`, continue without mutation.
7. Map failure to fixed path `/var/lib/dam-hopper` and fixed operation text such as `tighten directory mode`.

Refuse before `fchmod` when:

- object is symlink/non-directory/special;
- UID or GID differs;
- mode differs from both `0700` and `0755`;
- opened descriptor metadata differs from the allowed pre-open result.

Never call `chown` for a pre-existing object. Never add the tightened directory to creation cleanup.

### 2.3 Runtime tests in existing `api_runtime.rs` test module

1. **Clean install:** retain `missing_paths_are_created_with_final_metadata...`; assert state root is created `0700`.
2. **Known upgrade:** pre-existing state root with expected owner and `0755` succeeds, records exactly one descriptor `chmod`, ends `0700`, and leaves nested config/audit bytes and inodes unchanged.
3. **Idempotency:** second call after tightening has no mutating syscall.
4. **Narrow scope:** `0755` on `.config` or `.config/dam-hopper` still returns metadata mismatch with no mutation.
5. **Wrong identity/type:** state root `0755` with wrong UID, wrong GID, symlink, or non-directory returns mismatch and records no `chmod`/starter.
6. **Wrong mode:** `0777`, `0770`, `0750`, `0711`, and `0701` remain refused; do not use bitmask acceptance.
7. **Race:** pre-open `0755` followed by descriptor metadata becoming wrong refuses before mutation; pre-open `0755` followed by descriptor `0700` succeeds without `chmod`.
8. **`fchmod` failure:** return typed API runtime I/O error, leave API starter unreachable, keep mode observable as `0755`.
9. **Postcondition drift:** if post-`fchmod` `fstat` is not exact `0700`, return metadata mismatch.
10. Update old `operator_repair_followed_by_rerun...` expectation: `0755` is now auto-tightened; use another unsupported mode to preserve explicit-refusal coverage.

### Phase 2 acceptance

- New state root: API UID:GID, genuine directory, `0700`.
- Exact legacy state root: same inode/owner, mode tightened `0755 -> 0700` before child traversal and API start.
- Existing valid `0700`: read-only rerun.
- Every other pre-existing mismatch: refused without repair.
- No symlink target, wrong-owner object, config file, audit file, or nested path is modified.

## Phase 3 — Testing, documentation, and release verification [COMPLETED]

**Effort:** 2h  
**Outcome:** focused regression evidence passes (110 tests across 7 suites); current docs describe the narrow compatibility exceptions.

### 3.1 Focused commands

Run from repository root. Actual Cargo package is `dam-hopper-server` (not `dam-hopper`):

```bash
cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_manifest
cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_manifest_errors
cargo test --manifest-path server/Cargo.toml --package dam-hopper-server linux_release::api_runtime::tests
cargo test --manifest-path server/Cargo.toml --package dam-hopper-server --test linux_release_state_machine
```

Regression-neighbor suites:

```bash
cargo test --manifest-path server/Cargo.toml --package dam-hopper-server \
  --test linux_release_staging \
  --test linux_release_unit_policy \
  --test linux_release_ownership
```

Release boundary checks before retagging:

```bash
node deploy/release/check-version-alignment.mjs v0.3.1
pnpm release:verify
```

If repository policy requires formatting/checks, run once after all edits, not during parallel implementation:

```bash
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo check --manifest-path server/Cargo.toml --package dam-hopper-server
```

### 3.2 Required behavioral matrix

| Scenario | Expected result |
| --- | --- |
| New external Manifest v2, no API identity | Accepted |
| New external Manifest v1 with legacy identity | Rejected |
| Installed active/previous Manifest v1 with `identity: "root"` | Accepted for managed start/rollback/recovery/retention |
| Installed Manifest v1 missing/wrong identity | Rejected |
| Installed Manifest v2 with API identity | Rejected |
| Any unknown non-compatibility field | Rejected |
| State root absent | Created API UID:GID `0700` |
| State root expected UID:GID `0755` | Same directory tightened to `0700`; start may proceed |
| State root wrong owner/type or unsupported mode | Refused; no mutation/start |
| Candidate activation fails after tightening | Active v1 preflight parses; rollback can continue instead of schema failure |

### 3.3 Documentation reconciliation

Current docs state v2-only dual-read is prohibited and all pre-existing mode mismatches refuse. Update them after tests pass:

- Say current/published manifests remain v2-only.
- Say the v2 manager may read exact v1 installed active/previous manifests for rollback continuity.
- Say legacy API identity is validated as inert historical data, never runtime authority.
- Replace absolute refusal wording with the one explicit upgrade migration: owned genuine `/var/lib/dam-hopper` `0755 -> 0700`.
- Keep publisher migration evidence/checker v2-only; do not imply schema-v1 release publication is supported.
- Add changelog entry referencing prevention of `RECOVERY_REQUIRED` during v0.2.0 upgrade rollback.

### Phase 3 acceptance

- Focused suites and release verification pass.
- No v2 manifest output includes API identity.
- Test evidence covers both original errors and negative security boundaries.
- Documentation no longer contradicts runtime behavior.

## Phase 4 — Recreate Git tag `v0.3.1` [PENDING DEPLOYMENT]

**Effort:** 0.5h  
**Dependency:** Phases 1–3 merged, committed, pushed, and release gates green.

### Preconditions

1. Confirm version mirrors remain `0.3.1` and `check-version-alignment.mjs v0.3.1` passes.
2. Confirm intended fix commit is on the remote release branch and working tree has no uncommitted release changes.
3. Record old and new commit SHAs for audit/release notes.
4. Confirm authorization to rewrite remote `v0.3.1`; notify consumers because immutable tag expectations are being intentionally overridden.
5. Do not use `--force`; delete then create to produce a new tag push event.

### Required command sequence

Run at the intended fix commit:

```bash
git tag -d v0.3.1
git push origin :refs/tags/v0.3.1
git tag v0.3.1
git push origin v0.3.1
```

`release-linux.yml` listens to pushed `v*` tags. The recreated tag triggers version validation, Rust/web builds, deterministic packaging, attestations, stale release cleanup, and publication.

### Post-push verification

```bash
git rev-parse HEAD
git rev-parse 'v0.3.1^{commit}'
git ls-remote --tags origin refs/tags/v0.3.1
```

Then verify in GitHub Actions:

- `Release Linux (x86_64)` run uses the new fix SHA.
- `validate-metadata`, `build-rust`, `build-web`, `package-release`, `attest-release`, and `publish-release` succeed.
- Published `v0.3.1` has exactly installer, archive, manifest, and SBOM assets from the new run.
- Downloaded `release-manifest.json` remains schema `2` and omits `services.api.identity`.
- Archive contains manager binary built from the new fix SHA.

### Phase 4 acceptance

- Local and remote `v0.3.1` resolve to the intended fix commit.
- New tag push triggered `release-linux.yml`.
- New release assets/attestations published successfully; no stale old-build asset remains.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Global v1 acceptance reopens obsolete publication path | Separate strict external parser from installed-release parser; keep acquisition/staging/CLI validation strict v2 |
| Legacy identity becomes second runtime authority | Validate only as inert v1 historical field; never feed account, unit, health, or provisioning code |
| `0755` repair masks hostile object | Require exact directory type and expected UID:GID twice, through no-follow opened descriptor, before exact-mode `fchmod` |
| Broad mode repair weakens refusal contract | Permit one exact path and transition only; reject every other mode/path mismatch |
| TOCTOU between path stat and chmod | Revalidate opened descriptor with `fstat`; mutate descriptor, not path; exact post-`fchmod` `fstat` |
| Cleanup attempts to undo safe migration | Do not record pre-existing tightened directory as created; document one-way idempotent behavior |
| Manual rollback fails later candidate preflight | Installed managed preflight uses compatibility policy for hash-bound v1/v2 views |
| Retention becomes stuck on historical v1 release | Use installed-release policy before deletion while preserving ownership/digest checks |
| Tag rewrite publishes wrong commit | Require pushed fix commit, compare local/remote tag SHAs, and verify workflow SHA before approving release |
| Existing release assets survive tag rewrite | Confirm publish job stale-release cleanup succeeds and inspect exact four final assets |

## Definition of done

- Both diagnostic failures have direct regression coverage.
- v0.2.0-shaped installed manifest works for automatic and manual rollback paths.
- v2-only external release boundary remains intact.
- `/var/lib/dam-hopper` safely tightens only from valid owned `0755` to `0700`.
- Wrong object/owner/mode remains fail-closed.
- Focused tests, release checks, and docs complete.
- `v0.3.1` recreated on fix commit and Linux release workflow succeeds.


## Next Steps

1. Commit and push the verified changes for Phases 1–3.
2. Obtain confirmation/authorization to recreate `v0.3.1` tag on remote origin.
3. Execute Phase 4 tag recreation commands to trigger `release-linux.yml` CI release pipeline.
4. Verify published release assets, attestations, and SHA alignments.
## Unresolved questions

1. Does repository/tag protection and the `linux-release` environment allow the release owner to delete/recreate `v0.3.1`, or is administrator approval required?
