# Implementation Plan: Move API Configuration to User Home Directory

**Plan ID:** `260905-1425-move-config-to-api-home`  
**Date:** 2026-09-05  
**Branch:** `develop`  
**Issue:** `move config to @API_HOME@/.config/dam-hopper/dam-hopper.toml --advice`  

---

## 1. Context & Motivation

In previous security hardening changes, `dam-hopper-api.service` was switched from running as `root:root` to running as an unprivileged service user (`@API_USER@:@API_GROUP@`, e.g. `loidinh:loidinh`).
However, `ExecStart` in `deploy/systemd/dam-hopper-api.service.in` remained hardcoded to:
```
--config /etc/dam-hopper/dam-hopper.toml
```
Because `/etc/dam-hopper` is owned by `root:root (0755)` and `dam-hopper.toml` is owned by `root:root (0644)`, atomic writes on `PUT /api/config` attempt to create a `.dam-hopper-tmp-*.tmp` file in `/etc/dam-hopper` and fail with `Permission denied (os error 13)`.

According to the architecture specifications (`docs/configuration-guide.md`, `docs/system-architecture.md`), the canonical user config path is `~/.config/dam-hopper/dam-hopper.toml`. Moving the service configuration path to `@API_HOME@/.config/dam-hopper/dam-hopper.toml` aligns with the unprivileged service user model and Linux FHS standards.

---

## 2. Changes Required

### Phase 1: Unit Template & Policy Enforcement
1. **`deploy/systemd/dam-hopper-api.service.in`:**
   - Update `ExecStart`:
     `ExecStart=@RELEASE_ROOT@/bin/dam-hopper-server --config @API_HOME@/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`
2. **`server/src/linux_release/unit_policy.rs`:**
   - Update `validate_api_unit_policy` to assert `ExecStart`:
     `{}/bin/dam-hopper-server --config {}/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`
     using `ctx.release_root.display()` and `ctx.api_home`.

### Phase 2: Activation & Config Seeding
1. **`server/src/linux_release/activate.rs`:**
   - In `ensure_user_config_ownership`:
     - Ensure directory `{target}/.config/dam-hopper` exists.
     - If `{target}/.config/dam-hopper/dam-hopper.toml` does not exist:
       - If `/etc/dam-hopper/dam-hopper.toml` exists, copy it over (preserving existing projects).
       - Else, initialize with `[workspace]\nname = "default"\n`.
     - Set permissions (`0600` on `dam-hopper.toml`, `0700` on dir) and recursive `chown` to `uid:gid`.

### Phase 3: Verification & Live System Reconciliation
1. **`server/tests/linux_release_unit_policy.rs`:**
   - Add/update assertions to verify rendered `ExecStart` contains `--config /var/lib/dam-hopper/.config/dam-hopper/dam-hopper.toml` for default context, and `--config /home/loidinh/.config/dam-hopper/dam-hopper.toml` for custom identity context.
2. Run `cargo test --test linux_release_unit_policy` and other related tests.
3. Update live host configuration:
   - Ensure `/home/loidinh/.config/dam-hopper/dam-hopper.toml` exists with current `/etc/dam-hopper/dam-hopper.toml` content (owned by `loidinh:loidinh 0600`).
   - Update `/etc/systemd/system/dam-hopper-api.service` ExecStart to `--config /home/loidinh/.config/dam-hopper/dam-hopper.toml`.
   - Reload systemd and restart `dam-hopper-api.service`.
   - Test `PUT /api/config` via curl to verify 200 OK and successful atomic update.
4. Execute `~/.evcrate/bin/evcrate-advisor` checkpoint `review:hard-fix`.
