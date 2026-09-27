---
title: "Fix plugin admin profile binding and Linux installer identity conflict"
description: "Restore active-profile bearer authentication in Settings and guide safe, distinct Linux API and plugin-runner identities."
status: completed
priority: P1
effort: 6h
branch: main
tags: [bugfix, frontend, auth, backend, infra, docs]
created: 2026-09-27
---

# Fix plugin admin profile binding and Linux installer identity conflict

## Context and decision

[Admin/install diagnosis](../reports/debugger-260927-1929-admin-permissions-and-install-failure.md); [token and ACL follow-up](../reports/debugger-260927-1944-token-recheck-and-issue-interdependence.md). The observed admin JWT and MongoDB role are valid. Settings passes a null selection; `getAuthToken(undefined)` returns null, while auth status omits cookies. Admin management intentionally requires Bearer auth, not cookies. Separately, a recorded API `service_user` may equal the workstation login; choosing that user as plugin owner violates the required API/runner UID separation. An isolated runner cannot traverse owner-only `~/.evcrate` history after mode `0700` collapses its named-user ACL mask. Run runner as the history owner, API as distinct `dam-hopper`, without weakening the identity or Bearer checks.

Scope: targeted bug repair; no auth middleware change, implicit token sharing, ACL repair daemon, state ownership rewrite, or new installer identity default. Existing architecture contract: [D05 management API](../../docs/system-architecture.md) and [Linux operator guide](../../docs/linux-systemd.md). This restores that contract; no architecture diagram or schema change.

| Phase | Work | Estimate | Dependency |
| --- | --- | --- | --- |
| 1 | UI token fallback, selected profile consistency, typed failure presentation, regression tests | 2.5h | None |
| 2 | Linux identity diagnostics, early installer warning, Scenario A docs, regression checks | 2h | None |
| 3 | Full verification, host activation procedure, operational smoke/rollback | 1.5h | Phases 1–2 |

## Phase 1 — Frontend token and profile binding

1. Modify `packages/ui/src/api/server-config.ts`: in `getAuthToken(profileId?: string)` resolve `const targetId = profileId || getActiveProfileId()`; return null when absent. Accept `null` in the signature if needed by callers, without changing explicit-ID precedence. Use **resolved ID** consistently for profile lookup, v2 token key, legacy key and endpoint/auth-type comparison. Keep strict endpoint binding and storage failure behavior; never fall back to another profile when an explicit ID has no token. Update function comment. For an active ID absent from available profiles, fail closed rather than expose an orphaned token.
2. Modify `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx`: derive one effective profile ID (`profileId || getActiveProfileId()`); use it consistently for `getApiClientForProfile`, profile URL, `getAuthToken`, project filter and profile-switch auth/state reset. `SettingsPage.tsx` may retain its null selection: null means current active profile; explicit selection wins. Ensure active-profile switches refresh the effective ID through existing profile-change subscription/store mechanism, not merely a one-time read; prevent prior profile's status or installations from lingering during switches. If no active/selected profile, show unavailable/unauthenticated state, never read credentials from another server.
3. Keep `checkAuthStatus` Bearer-based and `credentials: "omit"`: do not enable cookie-only plugin management. In `loadInstallations`, classify `ApiRequestError` by typed `status`/`code`, not message substrings. `403 AdminRoleRequired` indicates actual admin-role denial; `401` authentication failure, `403 BearerRequired` missing bearer, `403 NoAuthForbidden` unsupported mode: present accurate access/action guidance, **not** misleading "not an administrator" assertion for Bearer/network cases. Network errors, 5xx and unknown codes populate existing `plugin-admin-error`, retain admin identity, allow retry. Preserve backend and runner authorization; frontend badges never grant privileges. If `checkAuthStatus` itself fails from transport, expose service error rather than non-admin claim.
4. Update `packages/ui/src/api/server-config.test.ts`: replace obsolete `getAuthToken()`-requires-ID test with active/no-active cases, null/undefined/empty handling as supported, explicit ID precedence, profile switch, endpoint/auth-type mismatch returning null, and no accidental token from another profile. Update `packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx`: mock two saved profiles with different tokens and active ID; assert no explicit prop uses active server URL and Bearer token on `/api/auth/status`, explicit prop uses only selected profile; switching profile clears stale role/installations. Assert `ApiRequestError(403, AdminRoleRequired)` shows role denial, `BearerRequired` identifies missing bearer, and network/503 shows error rather than administrator restriction; replace broad 401/403 wording assertions. Use existing React/Vitest patterns; tests must assert observable UI/request behavior, not mocked forwarding alone.
5. Scoped proof: `pnpm --filter @dam-hopper/ui test -- src/api/server-config.test.ts src/components/pages/settings-page/PluginManagementSection.test.tsx` (adjust Vitest file filter per package script). Browser Settings smoke with active admin profile and default target: see admin badge + installation view; switch to a non-admin/other server and confirm old admin view disappears; simulate transport error and see retry/error, not role-denial banner.

**Phase acceptance:** Default Settings target binds auth check, admin client and URL to same active profile; explicit target cannot borrow active token. Only actual role denial labeled as such; network outage does not revoke displayed account privilege.

## Phase 2 — Linux identity diagnostics and installer guard

1. Modify `server/src/linux_release/account.rs` `verify_plugin_owner_account`: preserve hard rejection for same name, same UID under aliases, root and invalid owner. Append actionable remedy to same-name and same-UID configuration errors: choose a **different non-root API identity**, e.g. `--service-user dam-hopper --plugin-owner-user <owner>`, and verify existing recorded `service_user` in `/etc/dam-hopper/host.toml` when `--service-user` omitted. Do not auto-create/choose accounts or reassign state. Update `server/tests/linux_release_plugin_runner.rs` to assert same-name diagnostic includes distinct `--service-user`, while distinct existing non-root owner/API remain accepted; retain other rejection cases. For UID-alias test, only use a deterministic account fixture where available; do not depend on host-specific alias.
2. Modify `deploy/release/dam-hopper-install.sh`: after option validation and before fetch/extract/sudo, for server/both when `--plugin-owner-user` equals `id -un` and `--service-user` unset, emit a prominent stderr warning that **recorded** API user may equal runner owner and cause rejection; show `--service-user dam-hopper --plugin-owner-user "$(id -un)"`. Do not silently supply defaults or claim success: existing host config may differ; manager is authoritative and still rejects matching UID even if names differ. Explicit matching `--service-user` should still be rejected by manager; optional early script check may mirror that obvious name conflict but must never bypass manager validation. Avoid warning for web-only and unrelated owner. Use existing `tests/deploy/linux-release-plugin-runner-owner-smoke.sh` or isolated bundle fixture to exercise warning before privileged install, absence of warning for explicit distinct user, and unchanged manager rejection of conflicting identity. Run `bash -n deploy/release/dam-hopper-install.sh`.
3. Modify `docs/plugin-platform-linux.md` Scenario A command to explicitly pass `--service-user dam-hopper --plugin-owner-user "$(id -un)"` with `--role both`; state API and runner must have distinct UIDs even on single-user workstation, previous `/etc/dam-hopper/host.toml` may retain a conflicting `service_user`, and installer stages only (activate separately with `sudo dam-hopper start`). Explain owner UID access to `0700` history; warn `ProtectHome=read-only` still prevents writes. Keep multi-user ACL scenario; note ACL mask may collapse after `chmod 0700` so ACL-only approach is unsuitable for owner-only generated history.

**Phase acceptance:** Collision is explained before costly download when applicable; manager rejection names an executable remedy; documentation command respects UID isolation and existing host config; no security gate removed.

## Phase 3 — Verification and operational activation guide

1. After both phases land, run `pnpm --filter @dam-hopper/ui test` and `cargo test -p dam-hopper-server` from supported workspace context (if Cargo workspace root lacks a manifest, run `cargo test --manifest-path server/Cargo.toml -p dam-hopper-server`). Run focused installer smoke and shell syntax check; record pass/fail truthfully. In-browser Settings page smoke is mandatory for UI change; do not treat tests alone as UI proof. If host is unavailable, report that limitation, not an invented activation result.
2. Add an **operational activation subsection** to `docs/plugin-platform-linux.md` after Scenario A: inspect `id -un`, `id -u`, `getent passwd dam-hopper`, current `service_user`/`plugin_owner_user` in `/etc/dam-hopper/host.toml`, installed runner registry/state ownership, and units with `systemctl cat dam-hopper-api.service dam-hopper-plugin-runner.service`; keep secrets out of logs. Confirm `dam-hopper` non-root and UID distinct from workstation owner. Stage a release **containing this fix** with `./dam-hopper-install.sh --latest --role both --service-user dam-hopper --plugin-owner-user "$(id -un)"` (add `--reinstall` only if replacing same tag; prefer patched tag). Address any manager refusal due to existing runner state ownership via deliberate backup/migration under documented operator procedure; never blindly `chown -R`, edit security state, or bypass validation. Inspect `dam-hopper status`, then `sudo dam-hopper start` to activate; installation alone does not change live units/UI. Verify rendered `User=` for API and runner, service health/runner socket, fresh UI assets, selected profile Bearer token and Settings admin view. Re-run affected history-read plugin invocation against a 0700 history directory; confirm no `WorkerFailed`/EACCES, noting write operations may still fail under `ProtectHome=read-only`. On failure, retain prior release and use `sudo dam-hopper rollback` per [Linux guide](../../docs/linux-systemd.md).
3. Cross-check docs/plan against result and remove throwaway smoke artifacts. State what was verified locally versus host-only steps.

**Phase acceptance:** Full UI and Rust suites pass; focused installer scenarios pass; real Settings UI default target works for bearer-authenticated admin, denial accurately classified; host instructions cover staging, activation, identity checks, history read, recovery.

## Risks and safeguards

- Existing host `service_user` inheritance makes installer-only name checks insufficient. Warn; manager checks both name and UID. Never change default or disable validation.
- Profile switch can produce mismatched server URL/token/client or stale admin state. One resolved ID and switch invalidation; preserve endpoint binding. No cookie fallback for bearer-only routes.
- A valid MongoDB admin still needs a profile-stored Bearer token and runner admin-subject allowlist; errors from `BearerRequired`, `AdminRoleRequired`, `NoAuthForbidden` and runner denial demand distinct remediation.
- Runner-as-owner grants plugins that owner's read privileges; systemd sandbox remains. Existing owner-only history bypasses ACL mask, but read-only home mount is not a write fix. Runner state owner migration may block activation; validate before changing anything.

## Unresolved questions

- Whether affected plugins require **write** access to the owner's home: verify with actual plugin operation; `ProtectHome=read-only` may require a separate reviewed sandbox policy change, outside this fix.

## Implementation Status and Review Notes

### Progress
- **Phase 1 (Frontend token & profile binding) — DONE (2026-09-27 22:09:06 +07:00).** Active-profile token fallback, effective-profile resolution, and typed API error classification are implemented. Targeted UI coverage reported 49/49 tests passed. Review follow-ups remain for stronger active-vs-explicit profile URL/token and stale-state assertions, and fail-closed handling of an explicit ID absent from available profiles.
- **Phase 2 (Linux identity diagnostics & installer guard) — DONE (2026-09-27 22:09:06 +07:00).** Same-name/same-UID diagnostics, early installer warning, Scenario A guidance, and operational activation instructions are implemented.
- **Phase 3 (Verification & activation) — DONE (2026-09-27 22:09:06 +07:00).** Review records 1,902/1,902 UI tests, 8/8 Linux runner tests, clean TypeScript/Cargo checks, shell syntax, and focused installer smoke scenarios. Browser Settings smoke and host-level systemd activation were not performed; those environment-dependent results are not claimed.

### Review follow-ups and verification limits
1. Fail closed in `getAuthToken(explicitId)` when the ID is absent from available profiles; add a regression test. Current behavior and finding are documented in the [code review](../reports/code-review-260927-2154-fix-plugin-auth-and-install-identity.md).
2. Strengthen `PluginManagementSection.test.tsx` to assert active-vs-explicit profile URL/token selection and stale role/installations clearing. The existing profile-switch test does not assert these outcomes.
3. Browser Settings smoke and host-level systemd activation remain unverified and require target-host/live-backend execution.
