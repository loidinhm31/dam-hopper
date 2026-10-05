# Documentation source validation

## Code Review Summary

### Scope

Read `context-261005-1653-docs-synthesis.md` and its update contract; applied directly loaded `code-review` skill's evidence-first review guidance. Documentation-only assignment. No application/config/test/validator edits; no delegation, builds, tests, lint, formatting, or validator execution.

Primary source scopes reviewed: `server/src/config/schema.rs`; `server/src/main.rs`; `server/src/api/{auth,auth_mfa}.rs`; `server/src/host_actions/service.rs`; `server/src/workflow/{mod,service,observation}.rs`; `server/src/workflow/store/mod.rs`; `server/src/api/workflow/{item,note,session}.rs`; `apps/native/src-tauri/src/lib.rs`; all three files in `apps/native/src-tauri/capabilities/`; `deploy/server.env.example`; `server/src/linux_release/{constants,unit_policy,stage_transaction}.rs`.

Supporting evidence: `server/src/state.rs`, `server/src/auth/secret.rs`, host-actions helper client, release stage-units/runtime-cleanup/unit/layout modules, root package manifest, web/native/extension Vite and bootstrap sources, native smoke script, agent-status declarations/extension, and documentation validator source. Read selected ranges; full LOC/type/test coverage not measured. Documentation environment search covered `docs/**/*.md` and root `README.md`; declaration searches limited to identified source/config/tooling files, excluding secret/env files, cache directories, and test-file searches. `deploy/server.env.example` explicitly permitted.

Updated plans: none; no given implementation plan and no plan editing assigned. Only this report written. DocsReorganizer owns documentation integration. Documentation paths/line numbers below describe observations during concurrent restructuring, not a final post-integration audit.

### Overall assessment

Synthesis's principal runtime corrections are supported by current source. Two additional security/configuration documentation overclaims were found: MongoDB environment variables do not themselves reject `--no-auth`, and MFA key permission enforcement is owner-only, not exact mode `0600`. All factual corrections sent immediately to DocsReorganizer, who acknowledged integration. Actual product limitations must remain explicit; no application fixes implied.

## Claim verdicts and exact source evidence

| Claim | Verdict | Evidence and required wording |
| --- | --- | --- |
| Standalone API defaults to port 4801 | **False** | `server/src/main.rs:43-49`: standalone binds `0.0.0.0:4800`; `DAM_HOPPER_PORT`/`DAM_HOPPER_HOST` override defaults. Explicit examples using 4801 are not intrinsically wrong. |
| Systemd release API/web ports are 4801/4802 | **Confirmed** | `server/src/linux_release/constants.rs:31-53`; exact rendered-command enforcement in `unit_policy.rs:151-162,267-274`. Dedicated web binary default independently declared at `server/src/bin/dam-hopper-web.rs:21-27`. |
| Ordinary source dev uses API4803/web5173 | **Confirmed with qualification** | Root `package.json:14,16-18` sets API4803 and CORS5173; `apps/web/vite.config.ts:14-20,36-40` defaults its proxy to API4803. Web Vite config has no explicit port, so 5173 is Vite's normal default, not this repository's strict-port guarantee. Native Vite is separately fixed to1420 with HMR1421 (`apps/native/vite.config.ts:33-42`). Watch script explicitly differs:4801, no binary selector (`package.json:18`). |
| Root server dev scripts are safe loopback-only | **False** | `package.json:16-17` uses `--host 0.0.0.0 --no-auth`. Loopback is an operator requirement, not enforced by those scripts. README's explicit loopback command/warning (`README.md:50-60` at review) correctly distinguishes this. |
| MFA step-up challenge requires Bearer-only authentication | **False** | `server/src/api/auth_mfa.rs:1011-1036` calls shared extractor; `auth.rs:139-158` prefers a parseable, case-sensitive `Bearer ` header and otherwise falls back to cookie; cookie name is `damhopper-auth` (`auth.rs:28`). Public MFA route is registered at `router.rs:67`. A supplied parseable but invalid Bearer token takes precedence; it does not retry the cookie after decoding fails. Non-Bearer/unparseable headers do not prevent cookie fallback. |
| `server.workflow_event_retention_days` controls event expiry | **False; schema-only setting currently** | Accepted/defaulted/validated at `schema.rs:652-656,672-674,685-686`; store receives only SQLite connection (`main.rs:762-765`, `workflow/store/mod.rs:17-24`). Manual event constructors hardcode90days: `api/workflow/item.rs:26-46`, `note.rs:25-46`, `session.rs:30-50`. Observation expiry uses constant90days (`workflow/mod.rs:52-53`, `observation.rs:477-493`). Service retains config but these constructors do not consume its event-retention field. |
| All workflow retention configuration is inert | **False** | Deleted-note setting is consumed by `workflow/service.rs:222-241`. Expired-event and deleted-note purges use batches500, yielding between batches (`service.rs:234-251`); startup/daily scheduling at `main.rs:794-816`. `docs/workflow-api.md:598-602` already correctly documents event-retention limitation. Do not broaden it to deleted-note retention. |
| Host-action approval endpoints mean supported host mutations | **False** | Production construction at `state.rs:274-279` calls `HostActionService::new`; `host_actions/service.rs:48-64` installs `UnavailableExecutor` and always advertises `available:false`, reasons `noAuth`/`reauthUnavailable`/`helperNotEnrolled`. Executor always returns unavailable (`host_actions/helper_client.rs:26-32`). Approval protocol can exist without supported mutation execution. |
| Native SSH forwarding works on Linux because module/UI is desktop-shared | **False** | Module compilation is desktop-scoped (`apps/native/src-tauri/src/lib.rs:4-5`), but SSH commands and manager creation are Windows-scoped (`lib.rs:91-122,139-150`); non-Windows handler contains only debug/browser commands (`lib.rs:124-135`). `capabilities/ssh-forward.json:5-7` grants Windows only. UI host factory independently returns null unless Windows (`apps/native/src/native-ssh-forward-host.ts:1496-1502`). |
| Native Browser Debug has the same Windows-only restriction | **False** | `capabilities/browser-debug.json:5-7` permits Windows/Linux; browser handlers exist on non-Windows desktop (`lib.rs:124-135`). Native UI predicate permits Windows/Linux and marks non-Windows experimental (`apps/native/src/native-browser-debug-host.ts:648-662`). Source support is not runtime qualification; no packaged/Linux/Windows qualification run performed here. Default capability (`capabilities/default.json:5-10`) does not grant SSH forwarding. |
| Retained runner constants mean current release stages runner units | **False** | Runner names/paths remain at `linux_release/constants.rs:63-74`, but `ALL_SERVICE_UNITS` excludes runner (`constants.rs:76-82`). Native stage rejects runner components/services and plugin-runner or bin/node inventory (`stage_transaction.rs:88-99`). Actual staging renders recovery/API/helper/runtime-tmpfiles/web, not runner (`stage_units.rs:218-280`). API policy forbids supplementary groups (`unit_policy.rs:29-33`). |
| Retired runner references are necessarily stale everywhere | **False** | Compatibility/cleanup references are legitimate: stopped runtime cleanup specifically checks runner and its socket (`linux_release/runtime_cleanup.rs:1-40`); runner tmpfiles path remains at `layout.rs:225-226`. These identifiers prove retained retirement compatibility, not live runner functionality; not every retained constant was proved to have an active consumer. Historical dated changelog references should remain historical. |
| `--no-auth` aborts whenever either MongoDB env key is set | **False; genuine documentation overclaim** | `main.rs:730-735` sets `db=None` before considering MongoDB env under no-auth. `state.rs:282-289` checks `db.is_some()`, not env presence. Production indicators do reject no-auth (`state.rs:291-299`). `docs/deployment-guide.md:232` asserted an env mutual-exclusion guarantee not supplied by this startup path. |
| MFA key startup requires exact Unix mode0600 | **False; recommend0600, enforce owner-only** | `server/src/auth/secret.rs:59-74` rejects symlink/nonregular files and group/world bits via `mode & 0o077 != 0`, then reads content. Does not compare mode to0600; a readable0400 file is not rejected by this permission check. Production authenticated key requirement is real (`state.rs:369-379`); env example recommendation is `deploy/server.env.example:9-15`. Deployment/systemd/newly moved auth docs overstated exact permission enforcement. |

## Genuine documentation warnings

### Critical issues

None established by this documentation-only source audit. No broader application security/qualification conclusion claimed.

### High-priority findings

1. Remove the false MongoDB-env/no-auth startup-rejection guarantee. Keep production rejection and explicit loopback/network warnings. Operators must not rely on shell MongoDB variables to protect an exposed no-auth instance.
2. Retain the hardcoded90day event-expiry limitation and unavailable host-action boundary wherever describing supported runtime behavior. Schema acceptance/approval protocols are insufficient evidence of operational capability.

### Medium-priority improvements

1. Canonical MFA endpoint documentation must describe actual Bearer/cookie admission, not a purported Bearer-only contract or an implementation-fix requirement (`docs/api/authentication.md:59` at review). DocsReorganizer acknowledged correction.
2. Distinguish recommended `chmod600` from enforced owner-only Unix permissions. Keep malformed/unreadable/symlink/nonregular rejection claims backed by loader evidence.
3. Remove plugin administrator/runner configuration from maintained environment documentation (`docs/configuration/server-environment-auth.md:47,118-121` at review); preserve dated `docs/CHANGELOG.md:120` as history. Retired architecture occurrences are being consolidated by DocsReorganizer.

### Low-priority suggestions

No style-only recommendations. Do not modify validator or valid documentation merely to reduce its warning count.

## Documented environment-key inventory

Allowlist status is a static comparison to `.omp/evcrate/scripts/validate-docs.cjs:34-47`, not validator execution. That source's env scan (`:89-97`) recognizes selected prefixes without checking whether a mention is active configuration, history, template, or wildcard. Its allowlist includes the four keys in `deploy/server.env.example:6-18`; that example does not add the missing keys below.

`Listed` = present in validator built-in/example set. `Missing` = real supported/injected/tooling key absent there, hence a source-backed false-positive warning if mentioned.

| Documented key | Current source declaration/use | Allowlist | Documentation context |
| --- | --- | --- | --- |
| `DAM_HOPPER_CONFIG` | `server/src/main.rs:36` | Listed | Environment table; configuration guide |
| `DAM_HOPPER_WORKSPACE` | `server/src/main.rs:40` | Listed | Environment table; legacy workspace override |
| `DAM_HOPPER_PORT` | `server/src/main.rs:44` | **Missing** | Environment table; nohup port override |
| `DAM_HOPPER_HOST` | `server/src/main.rs:48` | **Missing** | Environment table; nohup bind override |
| `DAM_HOPPER_CORS_ORIGINS` | `server/src/main.rs:56`; `deploy/server.env.example:18` | Listed | Environment/deployment/origin-policy guides |
| `DAM_HOPPER_NO_AUTH` | `server/src/main.rs:60` | Listed | Environment table; development bypass |
| `DAM_HOPPER_WEB_DIR` | `server/src/main.rs:64` | **Missing** | Environment table; explicit combined serving |
| `DAM_HOPPER_WEB_ROOT` | `server/src/bin/dam-hopper-web.rs:18` | Listed | Environment table; dedicated web-host deployment |
| `DAM_HOPPER_WEB_HOST` | `server/src/bin/dam-hopper-web.rs:22` | Listed | Environment table |
| `DAM_HOPPER_WEB_PORT` | `server/src/bin/dam-hopper-web.rs:26` | Listed | Environment table |
| `DAM_HOPPER_WEB_RUNTIME_CONFIG` | `server/src/bin/dam-hopper-web.rs:30` | **Missing** | Environment table |
| `DAM_HOPPER_WEB_RELEASE_VERSION` | `server/src/bin/dam-hopper-web.rs:34` | **Missing** | Environment table |
| `MONGODB_URI` | `server/src/main.rs:733`; env example`:6` | Listed | Environment/deployment/systemd/nohup docs |
| `MONGODB_DATABASE` | `server/src/main.rs:734`; env example`:7` | Listed | Environment docs; terminal-env example also uses it as a child override |
| `DAM_HOPPER_MFA_KEY_FILE` | `server/src/state.rs:369`; env example`:15` | Listed | Auth/environment/deployment/systemd docs |
| `DAM_HOPPER_IDLE_SUSPEND_SOCKET` | `server/src/main.rs:876-878` | **Missing** | `docs/linux-systemd/idle-suspend-runbook.md:43` |
| `DAM_HOPPER_AGENT_STATUS_URL` | `server/src/agent_status/types.rs:35`; assets/omp-agent-status.ts`:711` | **Missing** | `docs/architecture/agent-status.md:145,163`; injected child credential, not operator secret to persist |
| `DAM_HOPPER_AGENT_STATUS_TOKEN` | `server/src/agent_status/types.rs:38`; assets/omp-agent-status.ts`:712` | **Missing** | Same agent-status scope; secret value not inspected |
| `DAM_HOPPER_NATIVE_SMOKE_EVIDENCE` | `apps/native/scripts/smoke-browser-debug.mjs:14-18` | **Missing** | `docs/native-browser-debug-support.md:90`; tooling evidence path, not server config |
| `VITE_DAM_HOPPER_LOG_LEVEL` | `apps/web/src/main.tsx:22-26`; native/main.tsx`:88-93` | **Missing** | Environment table; web/native build-time logger input |
| `VITE_DAM_HOPPER_SERVER_URL` | `apps/web/vite.config.ts:14-20` | Listed | Environment/publisher docs; dev proxy override, nonempty value rejected on production build |
| `VITE_DAM_HOPPER_EXTENSION_PARENT_ORIGINS` | `apps/browser-extension/vite.config.ts:13-20` | **Missing** | Configuration guide, environment table, platform/system-services docs; extension build input |
| `VITE_DAM_HOPPER_NATIVE_BROWSER_DEBUG` | `apps/native/src/main.tsx:127-139`; native-browser-debug-host.ts`:644-645` | **Missing** | `docs/native-browser-debug-support.md:113`; strings0/false disable host |
| `DAM_HOPPER_PLUGIN_ADMINS_FILE` | No current declaration in reviewed API CLI/native staging scopes; former runner retired as above | Missing; **not current env configuration** | Genuine stale active-table claim; dated changelog occurrence is valid historical provenance |
| `DAM_HOPPER_STATE_DIR` | Historical `@DAM_HOPPER_STATE_DIR@` replacement token; current supported unit tokens are `server/src/linux_release/unit.rs:13-30` and exclude it | Missing; **not an env key** | Former `docs/architecture/plugin-platform-d02.md:262`; template/history classification, not an unknown current env setting |

Inventory: **23 concrete current keys**, including server CLI/runtime, web/native/extension build input, injected child credentials, and smoke tooling. **12** are missing from validator allowlist; keep their legitimate documentation. Two additional concrete-looking tokens are retired configuration/template provenance, not current keys. Wildcard `MONGODB_*` (`docs/linux-systemd.md:125` at review) is also not a concrete key; validator can capture its `MONGODB_` prefix and warn. Explicitly spelling `MONGODB_URI`/`MONGODB_DATABASE` is a clarity improvement, not an application fix.

### Positive observations

- Runtime boundaries enforced independently in native Rust handlers, Tauri platform capabilities, and UI host factory.
- Release staging explicitly rejects plugin-bearing candidates; compatibility names cannot accidentally prove current provisioning.
- Workflow documentation already calls out unused custom event retention rather than claiming schema support equals behavior.
- Actual production no-auth/MFA prerequisite checks fail closed for their documented supported conditions.

### Recommended actions

1. Integrate the source-backed corrections above; DocsReorganizer has acknowledged factual messages, but final landing is owned by that peer/main.
2. Main runs requested documentation validator and supplemental link/anchor/line-limit checks after restructure. Interpret the12 real-key allowlist misses, template/wildcard matches, and historical plugin key correctly; do not alter validator.
3. Preserve runtime/proxy/performance/native qualification gaps as unknown; this report does not close them.

### Metrics

- Type coverage: not measured; no application type changes.
- Test coverage: not measured; no tests run.
- Lint/validator issue counts: not exercised. Twelve unique current-key omissions established statically, not12 executed warnings; occurrences/final wording determine actual warning count.
- Verification performed: current-source range reads, targeted searches, and static declaration/allowlist comparison only.

## Unresolved questions

None requiring user decisions. Final document integration/validator results and platform/deployment qualification remain outside this child assignment. The unused event-retention setting and unavailable host mutations remain actual implementation limitations, not documentation-task defects to implement here.

## Focused post-restructure read-only review

Main requested a follow-up against actual updated `README.md`, `docs/api/authentication.md`, `docs/architecture/authentication-state-and-cryptography.md`, `docs/architecture/native-ssh-forwarding.md`, `docs/deployment-guide.md`, `docs/system-architecture.md`, and `docs/configuration/server-environment-auth.md`. No docs edits or executable validation performed. Review occurred while DocsReorganizer continued corrections; findings below are read-time evidence, not a final clean bill.

### Corrections observed landed

- Standalone4800/systemd4801+4802/dev4803 ports and explicit root dev-script network warning: README`:36-40,61-71`; architecture`:32-36`.
- MFA challenge admits Bearer or cookie with fallback when no parseable Bearer header: auth API`:135`.
- MFA owner-only permission test and chmod600 recommendation: auth architecture`:61`, deployment`:70`, environment auth`:75-77`.
- Host mutations explicitly unavailable and event expiry hardcoded90days: system architecture`:84,91`.
- Native forwarding Windows-only handler/capability boundary and20 active SSH commands: native forwarding`:8,60-74`; architecture`:82-83`. Source commands `lib.rs:102-121` indeed number20, not former21.
- Former plugin administrator key moved out of active configuration into explicitly inactive history: environment auth`:106-110`. Source-verified runtime/build keys retained.
- Native Browser Bridge build prerequisite and distro-specific Linux header names included: deployment`:189-191`; native `build.rs:9,27-33` requires the asset.

### Missed/new overclaims reported immediately

| Updated location at read time | Finding | Exact evidence / correction |
| --- | --- | --- |
| `docs/api/authentication.md:69` | Still says no-auth rejected “when MongoDB is configured” | `main.rs:730-735` skips DB under no-auth; `state.rs:282-299` checks actual `db.is_some()` and production indicators. Remove env-configuration rejection implication. Deployment`:234` now correctly names the actual db guard. |
| `README.md:46` | “zero-downtime health gates” unsupported | `linux_release/activate.rs:319-331` stops managed active services/helper socket before further activation. Say transactional activation/health stability gates, not zero downtime. |
| `README.md:13`; `docs/system-architecture.md:83` | Adds enforced loopback condition to native same-origin restriction | `apps/native/src/native-server-url.ts:11-20` and `packages/ui/src/api/server-config.ts:777-789` compare exact origins; neither checks loopback for profile admission. Shared helper's loopback check at`:417-441` serves local-port shortcut classification, not admission. Say exact same-origin. |
| `docs/system-architecture.md:84` | Reason presented only as helperNotEnrolled | `host_actions/service.rs:52-64` selects noAuth/reauthUnavailable/helperNotEnrolled. Keep all applicable reasons, availability always false. |
| `docs/system-architecture.md:91` | Seven-day deleted-note grace described as fixed | `workflow/service.rs:226-241` consumes configured note-retention days. Seven is default (`config/schema.rs:675-677`), unlike hardcoded event90days. |
| `docs/architecture/native-ssh-forwarding.md:132-133` | Windows matrix switched from explicit release gate to unqualified Supported | Windows implementation is established by source; packaged/runtime qualification is not proved by registration. Existing `docs/native-browser-debug-support.md:9-12` still explicitly records Windows S13 blocked pending packaged WebView2/DPAPI/SSH-scope/Browser evidence. Preserve/link that gate; Linux runtime-unverified wording already retained. |
| `docs/deployment-guide.md:18` | Named distro/version floors imply support/qualification beyond source checks | Current profile is generic Linux (`constants.rs:15,19-21`) with glibc2.39/systemd245 minima (`:27-29`); `platform.rs:65-72` requires nonempty OS ID, not named version floors. List actual runtime requirements; source acceptance is not a distribution qualification result. |
| `README.md:30`; deployment`:188` | Universal Rust1.97.1+ minimum not established | Inspected Cargo package sections declare edition but no rust-version (`server/Cargo.toml:1-17`, native Cargo`:1-10`); release workflows use stable (`release.yml:28,97`; `release-linux.yml:66,105`). `Dockerfile:3-5` pins container builder1.97.1 while comment identifies dependency MSRV1.95. Describe stable toolchain/container pin, not inferred universal source/native minimum. |

DocsReorganizer acknowledged reconciliation of same-origin, activation/health, note-retention, host-action reasons, and deployment runtime requirements. Remaining follow-up items were also sent with evidence; Main received missed-correction alert. Final post-edit validation remains Main's responsibility.

Unresolved questions: none requiring user decisions. Corrective findings above are integration actions, not requests for application implementation or evidence fabricated by running tests.
