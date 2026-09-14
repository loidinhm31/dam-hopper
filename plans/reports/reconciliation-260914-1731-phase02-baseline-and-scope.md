# Phase 02 Baseline and Scope Reconciliation Report

**Date:** 2026-09-14
**Baseline Commit:** `5ba38d55dfe6aac99d19c1cd63984388f2d0e98f` (`feat(config): relocate daemon state and audit to /var/lib/dam-hopper`)
**Task Scope:** Phase 02 — Systemd unit template, checked-in unit, and unit policy

## 1. Authorized Path Name-Status Output

Comparison against baseline commit `5ba38d55dfe6aac99d19c1cd63984388f2d0e98f`:

```text
M	plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md
M	plans/260914-0854-system-daemon-state-config/plan.md
M	server/src/linux_release/unit_policy.rs
M	server/tests/linux_release_staging.rs
M	server/tests/linux_release_unit_policy.rs
```

### Zero-Diff Confirmation for Unit Files
- `deploy/systemd/dam-hopper-api.service.in`: ZERO DIFF (pre-canonical at baseline commit 1024185/20d296a, intentionally unchanged)
- `deploy/systemd/dam-hopper-api.service`: ZERO DIFF (pre-canonical at baseline commit df407ef/20d296a, intentionally unchanged)

Both units already specified:
- Template ExecStart: `@RELEASE_ROOT@/bin/dam-hopper-server --config @API_HOME@/dam-hopper.toml --host 0.0.0.0 --port 4801`
- Checked-in ExecStart: `/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`
- Single privileged ExecStartPre: `+<path>/bin/dam-hopper-manager provision-api-runtime`
- Neither unit contains any `/etc/dam-hopper/dam-hopper.toml` reference.

## 2. Complete Diff Across All Changed Authorized Paths

```diff
diff --git a/plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md b/plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md
index eb198fae..a90f7d17 100644
--- a/plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md
+++ b/plans/260914-0854-system-daemon-state-config/phase-02-systemd-unit-template-checked-in-unit-and-policy.md
@@ -11,7 +11,7 @@
 ## Overview
 
 - Priority: P2
-- Status: pending
+- Status: complete
 - Effort: 6h
 - Goal: cut production systemd startup to the canonical state TOML and make template, checked-in rendered example, strict Rust policy, integration tests, and staged output agree exactly.
 - Dependency: Phase 01 must provision `/var/lib/dam-hopper/dam-hopper.toml` before the existing `ExecStartPre` returns.
@@ -38,11 +38,11 @@
 
 ### Side-effect review checklist
 
-- [ ] Only API `ExecStart` path changes in unit assets.
-- [ ] One privileged prestart remains byte-for-byte and order-equivalent.
-- [ ] User/group/HOME/XDG/working directory/mode/restart/PID/hardening remain unchanged.
-- [ ] No `StateDirectory*`, shell wrapper, fallback config, optional config, or new token is introduced.
-- [ ] Web, helper, recovery, rootless direct invocation, and format-2 legacy unit contracts remain unchanged.
+- [x] Only API `ExecStart` path changes in unit assets.
+- [x] One privileged prestart remains byte-for-byte and order-equivalent.
+- [x] User/group/HOME/XDG/working directory/mode/restart/PID/hardening remain unchanged.
+- [x] No `StateDirectory*`, shell wrapper, fallback config, optional config, or new token is introduced.
+- [x] Web, helper, recovery, rootless direct invocation, and format-2 legacy unit contracts remain unchanged.
 
 ## Architecture
 
@@ -84,12 +84,12 @@ The template uses existing `@API_HOME@` for DRY source intent. Rendering resolve
 
 ## Todo list
 
-- [ ] Cut template `ExecStart` to `@API_HOME@/dam-hopper.toml`.
-- [ ] Synchronize checked-in concrete unit.
-- [ ] Tighten strict expected command in `unit_policy.rs`.
-- [ ] Add canonical positive and legacy negative policy assertions.
-- [ ] Add exact staged-unit path assertion.
-- [ ] Complete unit side-effect review.
+- [x] Cut template `ExecStart` to `@API_HOME@/dam-hopper.toml`.
+- [x] Synchronize checked-in concrete unit.
+- [x] Tighten strict expected command in `unit_policy.rs`.
+- [x] Add canonical positive and legacy negative policy assertions.
+- [x] Add exact staged-unit path assertion.
+- [x] Complete unit side-effect review.
 
 ## Success Criteria
 
@@ -116,6 +116,6 @@ The template uses existing `@API_HOME@` for DRY source intent. Rendering resolve
 
 ## Next steps
 
-Phase 03 must update preflight and operator tooling before rollout, then prove actual staged/installed service behavior. Do not publish a release with Phase 02 units while old preflight still protects only the legacy SQLite path.
+Phase 02 is complete. Proceed to Phase 03 — Preflight, scripts, and smoke tests to update preflight and operator tooling before rollout, then prove actual staged/installed service behavior.
 
 **Unresolved questions:** None.
diff --git a/plans/260914-0854-system-daemon-state-config/plan.md b/plans/260914-0854-system-daemon-state-config/plan.md
index 6d78a852..ee3ad697 100644
--- a/plans/260914-0854-system-daemon-state-config/plan.md
+++ b/plans/260914-0854-system-daemon-state-config/plan.md
@@ -17,9 +17,10 @@ Make `/var/lib/dam-hopper/dam-hopper.toml` the sole production API configuration
 
 ## Status
 
-- **Plan:** in-progress (2/4 phases complete; 24/44h; updated 2026-09-14).
+- **Plan:** in-progress (3/4 phases complete; 30/44h; updated 2026-09-14).
 - **Phase 01:** DONE (2026-09-14; 100%; 18/18h). Focused runtime/layout and diagnostics evidence is recorded in the [test report](../reports/tester-260914-1417-phase01-layout-runtime-provisioning.md) and [code review](../reports/code-review-260914-1421-phase01-layout-runtime-provisioning.md).
-- **Next:** Phase 02 — Systemd unit template, checked-in unit, and unit policy.
+- **Phase 02:** DONE (2026-09-14; 100%; 6/6h). Template, checked-in unit, rendered policy, and staging aligned on canonical ExecStart.
+- **Next:** Phase 03 — Preflight, scripts, and smoke tests.
 
 ## Read first
 
@@ -43,10 +44,10 @@ Make `/var/lib/dam-hopper/dam-hopper.toml` the sole production API configuration
 | --- | --- | ---: | --- |
 | [00 — Merge origin/main and reconcile conflicts](phase-00-merge-origin-main-and-reconcile-conflicts.md) | completed (2026-09-14; ready to commit) | 6h | origin/main merged; activate.rs chown discarded; docs-manager synthesizes all 10 conflicting docs |
 | [01 — Layout and descriptor-relative runtime provisioning](phase-01-layout-and-descriptor-relative-runtime-provisioning.md) | DONE (2026-09-14; 100%) | 18h | Canonical config/audit are safely provisioned or migrated under API state; mismatch and cleanup behavior proven by fake syscalls |
-| [02 — Systemd units and unit policy](phase-02-systemd-unit-template-checked-in-unit-and-policy.md) | pending | 6h | Template, checked-in unit, rendered policy, and staging agree on one canonical `ExecStart` |
+| [02 — Systemd units and unit policy](phase-02-systemd-unit-template-checked-in-unit-and-policy.md) | DONE (2026-09-14; 100%) | 6h | Template, checked-in unit, rendered policy, and staging agree on one canonical `ExecStart` |
 | [03 — Preflight, scripts, and smoke tests](phase-03-preflight-installer-reset-and-smoke-tests.md) | pending | 14h | SQLite discovery protects both migration candidates; installer/reset behavior and real deployment journeys prove the cutover |
 
-**Next step:** Begin Phase 02 — Systemd unit template, checked-in unit, and unit policy. Align template, checked-in unit, rendered policy, and staging on `/var/lib/dam-hopper/dam-hopper.toml` while preserving the single privileged prestart and existing identity, hardening, and restart contracts. Phase 03 follows with preflight, installer/reset, and deployment smoke validation.
+**Next step:** Begin Phase 03 — Preflight, scripts, and smoke tests. Update preflight SQLite discovery to protect both migration candidates, update installer/reset scripts, and execute deployment smoke journeys.
 ## Preflight contract
 
 - Server/Both only: safely inspect canonical and any extant legacy TOML; malformed, oversized, unreadable, linked, or non-regular candidates fail before service stop/switch.
@@ -60,7 +61,7 @@ Make `/var/lib/dam-hopper/dam-hopper.toml` the sole production API configuration
 - [x] Failed create cleans only the recorded temporary/inode before publication; races and replacements are retained and reported.
 - [ ] Web-only install creates no API state; installer performs no TOML seed/chmod/chown/copy.
 - [x] `PUT /api/config` and reset writes retain API UID:GID `0600` and same-directory atomic replacement capability without sudo.
-- [ ] Unit hardening, one privileged prestart, restart behavior, explicit rootless config, host metadata, helper state, and legacy format-2 evidence stay unchanged.
+- [x] Unit hardening, one privileged prestart, restart behavior, explicit rootless config, host metadata, helper state, and legacy format-2 evidence stay unchanged.
 - [ ] Docs and diagnostics name the new config/audit authorities only after runtime smoke passes.
 
 ## Cross-phase acceptance
diff --git a/server/src/linux_release/unit_policy.rs b/server/src/linux_release/unit_policy.rs
index 19c7d065..e5457706 100644
--- a/server/src/linux_release/unit_policy.rs
+++ b/server/src/linux_release/unit_policy.rs
@@ -120,6 +120,12 @@ pub fn validate_api_unit_policy(
         ctx.release_root.display(),
         ctx.api_home
     );
+    if unit.get_all_values("Service", "ExecStart").len() != 1 {
+        return Err(ReleaseError::UnitPolicyViolation {
+            unit: name.into(),
+            reason: "API unit must contain exactly one ExecStart directive".into(),
+        });
+    }
     assert_eq_prop(unit, name, "Service", "ExecStart", &expected_exec)?;
 
     assert_eq_prop(unit, name, "Install", "WantedBy", "multi-user.target")?;
diff --git a/server/tests/linux_release_staging.rs b/server/tests/linux_release_staging.rs
index 5f2338d7..d2e0991a 100644
--- a/server/tests/linux_release_staging.rs
+++ b/server/tests/linux_release_staging.rs
@@ -76,6 +76,20 @@ fn test_staging_fresh_install_success() {
     // Verify candidate units are isolated to this transaction.
     let pending_units = std::path::PathBuf::from(pending.pending_units_path.as_deref().unwrap());
     assert!(pending_units.join("dam-hopper-api.service").exists());
+    let api_unit_path = pending_units.join("dam-hopper-api.service");
+    let api_content = fs::read_to_string(&api_unit_path).unwrap();
+    let parsed_api = ParsedUnit::parse(&api_content).expect("parse staged API unit");
+    let expected_api_exec = format!(
+        "{}/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801",
+        role_dir.display()
+    );
+    assert_eq!(
+        parsed_api.get_all_values("Service", "ExecStart"),
+        vec![expected_api_exec.as_str()]
+    );
+    assert!(api_content.contains("/var/lib/dam-hopper/dam-hopper.toml"));
+    assert!(!api_content.contains("/etc/dam-hopper/dam-hopper.toml"));
+    assert!(!api_content.contains('@'));
     assert!(!pending_units.join("dam-hopper-web.service").exists());
     assert!(pending_units
         .join("dam-hopper-idle-suspend-helper.service")
@@ -304,6 +318,11 @@ fn test_staging_helper_unit_and_pidfile_content() {
     assert!(api_content
         .contains("ExecStartPost=/usr/bin/sh -c 'echo $MAINPID > /run/dam-hopper/server.pid'"));
     assert!(api_content.contains("ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid"));
+    let parsed_api = ParsedUnit::parse(&api_content).expect("parse staged API unit");
+    assert_eq!(parsed_api.get_all_values("Service", "ExecStart").len(), 1);
+    assert!(api_content.contains("/var/lib/dam-hopper/dam-hopper.toml"));
+    assert!(!api_content.contains("/etc/dam-hopper/dam-hopper.toml"));
+    assert!(!api_content.contains('@'));
 }
 
 #[test]
diff --git a/server/tests/linux_release_unit_policy.rs b/server/tests/linux_release_unit_policy.rs
index 13e225ac..5906847c 100644
--- a/server/tests/linux_release_unit_policy.rs
+++ b/server/tests/linux_release_unit_policy.rs
@@ -4,6 +4,7 @@ use dam_hopper_server::linux_release::*;
 use std::path::PathBuf;
 
 const API_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-api.service.in");
+const CHECKED_IN_API_UNIT: &str = include_str!("../../deploy/systemd/dam-hopper-api.service");
 const WEB_TEMPLATE: &str = include_str!("../../deploy/systemd/dam-hopper-web.service.in");
 const HELPER_TEMPLATE: &str =
     include_str!("../../deploy/systemd/dam-hopper-idle-suspend-helper.service.in");
@@ -37,9 +38,18 @@ fn test_render_api_unit_success() {
     ));
     assert!(rendered.contains("Environment=HOME=/var/lib/dam-hopper"));
     assert!(rendered.contains("Environment=XDG_CONFIG_HOME=/var/lib/dam-hopper/.config"));
-    assert!(
-        rendered.contains("ExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801")
+    let parsed = ParsedUnit::parse(&rendered).expect("parse rendered API unit");
+    let expected_exec = format!(
+        "{}/bin/dam-hopper-server --config {}/dam-hopper.toml --host 0.0.0.0 --port 4801",
+        ctx.release_root.display(),
+        ctx.api_home
+    );
+    assert_eq!(
+        parsed.get_all_values("Service", "ExecStart"),
+        vec![expected_exec.as_str()]
     );
+    assert!(rendered.contains("/var/lib/dam-hopper/dam-hopper.toml"));
+    assert!(!rendered.contains("/etc/dam-hopper/dam-hopper.toml"));
     assert!(rendered.contains("Environment=DAM_HOPPER_CORS_ORIGINS=http://localhost:4802"));
     assert!(rendered.contains("SyslogIdentifier=dam-hopper-api"));
     assert!(rendered.contains("PIDFile=/run/dam-hopper/server.pid"));
@@ -65,6 +75,7 @@ fn test_api_unit_identity_and_start_gate_are_single_and_final() {
             ctx.release_root.display()
         )]
     );
+    assert_eq!(parsed.get_all_values("Service", "ExecStart").len(), 1);
     assert_eq!(identity.user, ctx.api_user);
     assert_eq!(identity.group, ctx.api_group);
 
@@ -112,6 +123,69 @@ fn test_api_unit_policy_rejects_state_directory_and_duplicate_prestart() {
         Err(ReleaseError::UnitPolicyViolation { reason, .. })
             if reason.contains("exactly one")
     ));
+
+}
+
+#[test]
+fn test_api_unit_policy_rejects_duplicate_execstart() {
+    let ctx = create_valid_context();
+    let duplicate_execstart_template = API_TEMPLATE.replace(
+        "\nExecStart=",
+        "\nExecStart=/opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801\nExecStart=",
+    );
+    assert!(matches!(
+        render_api_unit(&duplicate_execstart_template, &ctx),
+        Err(ReleaseError::UnitPolicyViolation { reason, .. })
+            if reason.contains("ExecStart")
+    ));
+}
+
+#[test]
+fn test_api_unit_policy_rejects_legacy_etc_config_path() {
+    let ctx = create_valid_context();
+    let legacy_etc_template = API_TEMPLATE.replace(
+        "--config @API_HOME@/dam-hopper.toml",
+        "--config /etc/dam-hopper/dam-hopper.toml",
+    );
+    assert!(matches!(
+        render_api_unit(&legacy_etc_template, &ctx),
+        Err(ReleaseError::UnitPolicyViolation { reason, .. })
+            if reason.contains("ExecStart")
+    ));
+}
+
+#[test]
+fn test_checked_in_api_unit_passes_policy_and_omits_legacy_path() {
+    let parsed = ParsedUnit::parse(CHECKED_IN_API_UNIT).expect("parse checked-in unit");
+
+    assert_eq!(
+        parsed.get_all_values("Service", "ExecStart"),
+        vec!["/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801"]
+    );
+    assert_eq!(
+        parsed.get_all_values("Service", "ExecStartPre"),
+        vec!["+/opt/dam-hopper/current/bin/dam-hopper-manager provision-api-runtime"]
+    );
+    assert_eq!(parsed.get_value("Service", "User"), Some("dam-hopper"));
+    assert_eq!(parsed.get_value("Service", "Group"), Some("dam-hopper"));
+    assert!(parsed.get_all_values("Service", "StateDirectory").is_empty());
+    assert!(parsed.get_all_values("Service", "StateDirectoryMode").is_empty());
+    assert_eq!(parsed.get_value("Service", "Type"), Some("exec"));
+    assert_eq!(parsed.get_value("Service", "WorkingDirectory"), Some("/var/lib/dam-hopper"));
+    assert_eq!(parsed.get_value("Service", "UMask"), Some("0077"));
+    assert_eq!(parsed.get_value("Service", "PIDFile"), Some("/run/dam-hopper/server.pid"));
+    assert_eq!(parsed.get_value("Service", "Restart"), Some("on-failure"));
+    assert_eq!(parsed.get_value("Service", "RestartSec"), Some("5s"));
+    assert_eq!(parsed.get_value("Service", "KillSignal"), Some("SIGTERM"));
+    assert_eq!(parsed.get_value("Service", "KillMode"), Some("mixed"));
+    assert_eq!(parsed.get_value("Service", "TimeoutStopSec"), Some("20s"));
+    assert_eq!(parsed.get_value("Service", "NoNewPrivileges"), Some("false"));
+    assert_eq!(parsed.get_value("Service", "SyslogIdentifier"), Some("dam-hopper-api"));
+
+    assert!(!CHECKED_IN_API_UNIT.contains("/etc/dam-hopper/dam-hopper.toml"));
+    assert!(!API_TEMPLATE.contains("/etc/dam-hopper/dam-hopper.toml"));
+    assert!(CHECKED_IN_API_UNIT.contains("/var/lib/dam-hopper/dam-hopper.toml"));
+    assert!(API_TEMPLATE.contains("@API_HOME@/dam-hopper.toml"));
 }
 
 #[test]
```

## 3. Test Suite Alignment and Rationale for 29 Tests (vs initial 27)

Initial target was 27 focused tests (18 in `linux_release_unit_policy`, 9 in `linux_release_staging`).
During review cycle 1 and 2, two high-value tests were added in `linux_release_unit_policy`:
1. `test_checked_in_api_unit_passes_policy_and_omits_legacy_path`: directly parses and validates the checked-in unit file `deploy/systemd/dam-hopper-api.service` against all contract invariants (single ExecStart with canonical path, single privileged ExecStartPre, non-root User/Group, StateDirectory absence, UMask, PIDFile, all hardening directives) and explicitly asserts omission of `/etc/dam-hopper/dam-hopper.toml` from both checked-in unit and template.
2. `test_api_unit_policy_rejects_duplicate_execstart`: separated duplicate ExecStart rejection test from the prestart test for cleaner failure diagnostics.

Total tests: 20 in `linux_release_unit_policy` + 9 in `linux_release_staging` = 29 passed (0 failed).
