# Runtime identity authority research

## Scope and methodology

Inspected the supplied repository evidence for release constants, strict manifest parsing/validation, unit rendering exports and staging tests, activation-time identity mutation, preflight/health identity resolution, and historical architecture decisions. Findings below are **observed** unless marked **recommendation**.

## Current identity values and data flow

1. **Manifest contract**
   - `ServiceContract.identity` is a required string in the strict manifest model (`server/src/linux_release/manifest.rs:69-73`).
   - `API_SERVICE_IDENTITY` is documented as the API “Systemd execution user” and equals `"root"`; a separate `DEFAULT_API_SERVICE_USER` equals `"dam-hopper"` (`server/src/linux_release/constants.rs:23-30`).
   - `validate_services` requires `services.api.identity == API_SERVICE_IDENTITY`, so every accepted schema-v1 release currently declares API identity `"root"` (`server/src/linux_release/manifest_validation.rs:121-137`).
   - Validation occurs during acquisition (`server/src/linux_release/acquire.rs:84-96`) and again during activation preflight (`server/src/linux_release/activate_preflight.rs:172-194`).

2. **Host/runtime configuration**
   - `HostConfig.service_user` is the optional host-specific API user; newly constructed configurations leave it unset (`server/src/linux_release/host_config.rs:67-85`).
   - CLI install/start surfaces describe `--service-user` as non-root (`server/src/linux_release/cli.rs:93-96`, `server/src/linux_release/cli.rs:140-146`).
   - `resolve_service_user` verifies explicit/default selections and reports that root is forbidden (`server/src/linux_release/account.rs:148-155`, `server/src/linux_release/account.rs:185-211`).
   - `verify_api_service_account` rejects both UID 0 and the name `"root"` (`server/src/linux_release/account.rs:95-107`).

3. **Rendering and activation**
   - The rendering API exports `TOKEN_API_USER`, `TOKEN_API_GROUP`, `UnitRenderContext`, and `render_api_unit`, demonstrating that API user/group are render inputs (`server/src/linux_release/mod.rs:139-141`).
   - Activation chooses CLI `service_user` before `HostConfig.service_user`, resolves and verifies it, then derives the group from the account’s primary GID (`server/src/linux_release/activate.rs:100-114`, `server/src/linux_release/activate.rs:155-165`).
   - For a pending candidate, the selected user is persisted to host config and the staged API unit is rewritten before preflight (`server/src/linux_release/activate.rs:169-172`, `server/src/linux_release/activate.rs:185-189`).
   - `update_unit_service_identity` replaces or inserts concrete `User=` and `Group=` directives (`server/src/linux_release/activate.rs:583-609`, `server/src/linux_release/activate.rs:626-633`).
   - The ordinary active-start path can similarly rewrite the installed unit, reload systemd, and then start the API (`server/src/linux_release/activate.rs:115-135`).

4. **Live-process checking**
   - Health checks compare the running process against expected UID and GID and fail fatally on mismatch (`server/src/linux_release/health.rs:71-85`).
   - Current preflight identity resolution first consults `HostConfig.service_user` (`server/src/linux_release/activate_preflight.rs:398-401`) and later can parse `User=` from a unit (`server/src/linux_release/activate_preflight.rs:423-427`). Thus the final rendered unit is not yet the sole source used to derive health expectations.

## `API_SERVICE_IDENTITY` callsites and contradictions

### Exhaustive value-bearing references in the supplied search

| Location | Current effect |
|---|---|
| `server/src/linux_release/constants.rs:25-28` | Defines root manifest/runtime identity alongside a non-root default. |
| `server/src/linux_release/manifest_validation.rs:131-136` | Rejects every API manifest identity other than `"root"`. |
| `server/tests/linux_release_manifest.rs:128-134` | Valid-manifest fixture inherits `"root"` through the constant. |
| `server/tests/linux_release_unit_policy.rs:225-232` | Staging/policy fixture inherits `"root"`. |
| `server/tests/common/release_fixtures.rs:201-205` | Shared release fixture inherits `"root"`. |

No supplied renderer or activation excerpt references `API_SERVICE_IDENTITY`; runtime selection instead uses `service_user` and concrete account data.

### Contradictions

- **Manifest versus executable policy:** accepted manifests must say root, while all supported CLI/account paths explicitly reject root (`server/src/linux_release/manifest_validation.rs:131-137`; `server/src/linux_release/account.rs:95-107`).
- **Two defaults:** constants declare `"dam-hopper"` as the default, while interactive resolution embeds the same name as a string rather than visibly using that constant (`server/src/linux_release/constants.rs:27-28`; `server/src/linux_release/account.rs:185-187`).
- **Manifest versus rendered unit:** a host-selected custom non-root user rewrites `User=`/`Group=`, but the candidate manifest remains validated against root. Manifest metadata therefore cannot describe the resulting unit (`server/src/linux_release/activate.rs:155-189`; `server/src/linux_release/manifest_validation.rs:131-137`).
- **Authority ambiguity:** health expectations prefer host config before inspecting the unit, contrary to a unit-only authority model (`server/src/linux_release/activate_preflight.rs:398-401`, `server/src/linux_release/activate_preflight.rs:423-427`).
- **Fail-open active rewrite:** ordinary startup performs unit reading, rewriting, writing, and daemon reload through nested `if let Ok` operations; failures are discarded before API start (`server/src/linux_release/activate.rs:115-135`). A previously installed root unit can therefore remain effective.
- **Conditional reconciliation:** ordinary startup only enters identity resolution when an input exists or stdin is a terminal (`server/src/linux_release/activate.rs:100-109`); otherwise it can start the existing unit without a fresh non-root check.
- **Tests conceal the conflict:** fixtures obtain identity from the constant, so changing the constant changes expected manifests without proving rendered `User=`/`Group=`. The staging test only proves unit-file presence (`server/tests/linux_release_unit_policy.rs:248-263`).
- **Architecture has already superseded root:** current architecture says rendered service-account identity is sole authority, defaults to `dam-hopper:dam-hopper`, and treats the manifest label as legacy metadata (`docs/system-architecture.md:497-501`). Earlier review reports explicitly accepted root as an MVP residual risk (`plans/reports/code-review-260903-2025-phase-04-role-aware-systemd-ownership.md:43-44`; `plans/reports/code-reviewer-260903-1545-phase-01-contract-version-manifest.md:59-60`).
- **Collateral root assumption:** `~` SQLite-path preflight includes `/root` independently of the rendered API identity (`server/src/linux_release/activate_preflight.rs:87-95`). This is not an `API_SERVICE_IDENTITY` callsite but is stale identity-sensitive behavior.
- Legacy format-2’s fixed `loidinh` unit contract is separate migration evidence, not a root alias for current releases (`server/src/linux_release/legacy_format2_unit.rs:58-62`).

## Clean-cutover options

| Option | Change | Advantages | Problems/risks |
|---|---|---|---|
| A. Change constant to `"dam-hopper"` | Keep fixed manifest equality and update fixtures. | Smallest diff; rejects old root manifests. | Custom host identities still contradict the manifest; constant remains a competing authority. |
| B. Keep API manifest identity as legacy metadata | Remove fixed equality, reject empty/root metadata, and enforce only rendered unit identity. | Preserves schema-v1 shape and allows custom users. | Stale labels remain confusing; metadata/unit disagreement needs separate applicability handling described by architecture. |
| C. Remove API identity from the next manifest schema | Preserve web identity separately, delete the API constant and fixed validation, and validate concrete rendered `User=`/`Group=`. | One unambiguous authority; no root alias; supports default and custom identities equally. | Deliberate schema/release compatibility break; every schema-v1 artifact must be regenerated. |

## Recommendation: option C

Make the final rendered `dam-hopper-api.service` pair `User=`/`Group=` the **only runtime identity representation**.

Exact migration/removal steps:

1. In `server/src/linux_release/constants.rs`, remove `API_SERVICE_IDENTITY`; retain `DEFAULT_API_SERVICE_USER` solely as selection input and ensure resolution uses it rather than a duplicated literal.
2. Increment `SCHEMA_VERSION` from 1 (`server/src/linux_release/constants.rs:3-4`).
3. In `server/src/linux_release/manifest.rs`, revise `ServicesMeta`/`ServiceContract` so API metadata no longer has an identity field while the web contract retains its fixed identity. Strict unknown-field handling already makes the cutover explicit (`server/src/linux_release/manifest.rs:9-12`).
4. In `server/src/linux_release/manifest_validation.rs::validate_services`, remove the API equality branch at lines 131-137; retain API unit, bind, port, and health checks and the independent web identity check (`server/src/linux_release/manifest_validation.rs:123-160`, `server/src/linux_release/manifest_validation.rs:172-177`).
5. In `server/src/linux_release/unit.rs`, make `UnitRenderContext` and `render_api_unit` emit the already-resolved non-root user and primary group; reject root or incomplete identity through existing account/unit-policy error paths.
6. In `server/src/linux_release/stage_units.rs`, pass the resolved default/custom identity into `stage_candidate_units_for_release_with_render_root_and_config` before unit hashing and preflight.
7. In `server/src/linux_release/activate.rs`, eliminate late/best-effort identity correction through `update_unit_service_identity`; activation must install only a unit already rendered and validated for its final identity.
8. In `server/src/linux_release/activate_preflight.rs::build_candidate_health_targets`, derive API UID/GID from the final parsed unit, not host-config-first fallback. `HostConfig.service_user` remains provisioning input, not runtime authority.
9. Update all three fixture callsites listed above. Schema-v1/root manifests must fail cleanly rather than being translated to a hidden non-root alias.
10. Keep legacy format-2 inspection isolated; do not reinterpret its `loidinh` evidence as current schema identity.

## Provisioning interface boundary

The activation layer must invoke one fail-closed pre-start provisioning boundary **after the final unit’s concrete non-root `User=`/`Group=` have been parsed and resolved, but before every `systemctl_start(API_SERVICE_UNIT)`**. The visible ordinary-start edge is `server/src/linux_release/activate.rs:131-135`.

That boundary receives `Layout` plus the unit-derived UID/GID and guarantees, idempotently:

- `/etc/dam-hopper/idle-suspend-audit.jsonl` exists before API start, is API-owned, and has mode `0600`;
- API state parent directories are API-owned with mode `0700`;
- any provisioning or identity mismatch aborts startup.

Filesystem mechanics belong behind that interface and are outside this report; observer, upload, policy, and Phase 02 work remain excluded.

## Focused observable tests

Use existing test modules and fixtures; do not retain root-valued compatibility expectations.

1. **Manifest cutover:** extend `server/tests/linux_release_manifest.rs` around `test_valid_manifest_roundtrip` (`server/tests/linux_release_manifest.rs:151-156`) to prove schema-v2 round-trip without API identity and rejection of schema-v1/root-bearing input.
2. **Default rendering:** in `server/tests/linux_release_unit_policy.rs`, stage with no custom user and assert the rendered API unit contains exactly `User=dam-hopper` and `Group=dam-hopper`, with no root directive.
3. **Custom rendering:** stage with a verified custom non-root account and assert exact concrete `User=` plus its primary `Group=` survive staging, installation, and parsing.
4. **Mismatch rejection:** independently alter rendered `User=` and `Group=` away from the selected context; each candidate must fail unit policy/preflight before install or start with `UnitPolicyViolation`, not be silently rewritten.
5. **Root rejection:** exercise explicit `"root"`, a UID-0 alias, `User=root`, and `Group=root`; each must fail. Existing account behavior already rejects name and UID (`server/src/linux_release/account.rs:95-107`).
6. **Health authority:** prove expected UID/GID come from the parsed final unit and that differing process evidence is fatal, matching existing health semantics (`server/src/linux_release/health.rs:77-85`).
7. **Pre-start ordering:** make the provisioning boundary fail and observe that no API start command occurs; on success, observe the boundary completes before API start.
8. **Regression guard:** repository search and fixture assertions must show no `API_SERVICE_IDENTITY` symbol and no current API unit/manifest root alias.

## Compatibility and security risks

- Option C intentionally rejects all schema-v1 release manifests; coordinated release regeneration is required because current schema version is 1 (`server/src/linux_release/constants.rs:3-4`).
- Accepting root temporarily, silently mapping it to `dam-hopper`, or preserving it in fixtures would mask unsigned runtime-policy changes and retain the historical full-host-compromise risk.
- Custom users may have primary groups whose names differ from the username; tests and rendering must use the GID-derived group already computed by activation (`server/src/linux_release/activate.rs:162-165`).
- Removing late rewriting changes rollback/hash behavior positively but requires units to be finalized before hashes are persisted; otherwise candidate hashes and installed content can diverge.
- Startup and health must fail when a unit identity cannot be resolved. Falling back to host config, username-as-group, or root would recreate multiple authorities.

## Unresolved questions
None