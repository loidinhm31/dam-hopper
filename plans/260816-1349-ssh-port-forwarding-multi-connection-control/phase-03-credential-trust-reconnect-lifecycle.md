# Phase 03: Credential vault, trust, and reconnect lifecycle

## Context Links

- [Plan](./plan.md)
- [Phase 02](./phase-02-native-established-connection-registry.md)
- [Security design research](./research/researcher-02-security-multi-connection-design-report.md)
- [Revised architecture decision](./reports/advisor-architecture-decision.md)
- [Vault lifecycle architecture](../../docs/system-architecture.md#planned-established-connection-forwarding-model)
- Baseline symbols: `LoadedPassword`, `LoadedPasswordCleanup`, `load_key`, `load_password`, `approve_host`, `connect_session`, `reconnect_session` in `manager.rs`; `load_safe_key` in `credentials/windows.rs`; `SshSession::connect` in `ssh_client.rs`.

## Overview

- Date: 2026-08-16
- Description: Save successful Windows SSH passwords/passphrases for a fixed 30 days while keeping host trust authoritative and live secrets short-lived.
- Priority: P2
- Implementation status: Complete 2026-08-17
- Review status: Complete 2026-08-17 — approved Windows credential/security review

## Key Insights

- Current native forwarding lacks secure credential persistence; `credentials/windows.rs` only accesses the OpenSSH agent and contained `.ssh` keys.
- Persist only password and encrypted-key passphrase input. Never persist decrypted private keys; agent and unencrypted-key modes have no secret to save.
- Windows Credential Manager protects at rest for the logged-in user but has no autonomous TTL. `expiresAt` is enforced before every use; physical deletion occurs on next app-controlled read/startup sweep or explicit cleanup.
- Trust and credential retention are independent. Host-key change retains the vault entry but blocks authentication until explicit trust repair/approval.
- Fast port toggles still use the live `SshSession`; they never read the vault or prompt.

## Requirements

- After successful password or encrypted-key authentication, save the entered secret when `rememberForDays=30` (UI default on). Wrong credentials never create or overwrite a vault entry.
- Fixed TTL: `expiresAt = successfulSaveAt + 30 days`. Silent reads, reconnects, app restarts, and successful use of an already-saved credential do not extend it. A successful user-entered replacement starts a new 30-day term.
- Vault identity: opaque versioned target derived from app ID + scope ID + connection profile ID + canonical endpoint + SSH user + auth mode/key ID. Never include the plaintext endpoint, username, key label/path, password, or passphrase in the target name.
- Versioned credential blob: credential kind, secret, `createdAt`, `expiresAt`, and rejection metadata. Bound secret/blob sizes; reject malformed, unknown-version, wrong-identity, or future-skewed values.
- Disconnect, scope switch, host-key change, manager/client invalidation, app shutdown, and force-close clear live sessions/decrypted keys/passwords/memory leases but retain the unexpired vault entry.
- Explicit Forget, connection-profile delete, scope purge, or expiry deletes the matching vault entry before reporting success. Identity-changing profile edit deletes the old identity entry only after the profile update commits and never rebinds it to the new identity.
- Host trust is verified before a retrieved secret can be sent. Unknown/changed host keys return the existing challenge/block without consuming, deleting, or exposing the saved credential.
- Terminal `AUTH_FAILED` quarantines automatic reuse of the saved entry. Keep it until replacement/Forget/expiry, show safe rejected status, and require explicit replacement or retry; never loop silently.
- Vault unavailability/write failure does not tear down a successful live connection. Return safe `notSaved` metadata/error and warn that a later app restart will prompt.
- Snapshots expose only `none | saved | rejected | expired | unavailable`, fixed `expiresAt`, and auth kind. No secret, target name, vault account, credential attempt ID, or native error detail.

## Architecture

`CredentialAttempt -> trust-verified SSH auth -> live CredentialLease + Windows Credential Manager entry -> fixed 30-day logical expiry`.

- Add a small `CredentialVault` trait with `save`, `load`, `forget`, `forget_scope`, and `sweep_expired`, plus injected clock and fake implementation for deterministic tests.
- Windows implementation calls Credential Manager APIs directly (`CredWriteW`, `CredReadW`, `CredDeleteW`, bounded prefix enumeration, `CredFree`) with user-bound local-machine persistence. No subprocess, DPAPI side file, shell, or general filesystem capability.
- Add the narrow `windows` crate credential feature under `cfg(windows)` only. Mobile/non-Windows dependency and generated-handler trees remain SSH-vault-free.
- Split SSH setup so endpoint host-key verification completes before vault secret authentication. Retrieved secrets become `Zeroizing` values and are dropped after deriving the live password/decrypted-key lease.
- Vault target prefix contains an opaque scope digest so scope purge can enumerate only DamHopper SSH-forward entries for that scope.
- Windows Credential Manager same-user-process access is an accepted residual risk and must be stated in UI/docs.

## Related Code Files

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_vault.rs` — **create**: vault trait, versioned blob/metadata, opaque target derivation, fixed TTL, clock, redacted errors.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_vault\windows.rs` — **create**: bounded Win32 Credential Manager adapter and safe allocation/freeing.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_lease.rs` — **create**: memory-only exact identity/attempt/lease types and zeroizing drop behavior.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\manager.rs` — **modify**: vault lookup/save/quarantine/forget/sweep, trust-first connect, retention/deletion boundaries, reconnect.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\connection_runtime.rs` — **modify**: memory lease ownership, reconnect behavior, terminal cleanup without vault deletion.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\known_hosts.rs` — **modify**: connection/generation challenge context and trust-first vault-use gate.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credentials.rs` — **modify**: decrypt selected safe key from zeroizing vault/staged passphrase without persisting decrypted key.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\ssh_client.rs` — **modify**: separate verified transport establishment from authentication; return exact verified host identity.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` — **modify**: remember request and safe credential-status metadata.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\error.rs` — **modify**: stable vault unavailable/corrupt/expired/rejected/delete-failed errors without native detail.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` — **modify**: register private vault/lease modules.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.toml` — **modify**: add only the required Windows credential API feature.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.lock` — **modify**: lock any resulting feature/dependency resolution.

## Implementation Steps

1. Define credential identity, fixed 30-day policy, versioned blob, redacted errors, injected clock, and fake vault. Cap target/blob/secret lengths and deny unknown fields.
2. Implement opaque target derivation and a scope-specific prefix. Collision-test canonical endpoint/user/auth distinctions without exposing their values.
3. Implement Windows Credential Manager RAII wrappers. Copy returned blobs into `Zeroizing`, always call `CredFree`, reject invalid types/persistence, and never log Win32 detail containing target/blob data.
4. Refactor SSH connect into trust-verified transport then authentication. Do not read/send a vault secret until endpoint-first known-host validation succeeds.
5. Replace profile-scoped credential caches with exact staged attempts. `loadKey`/`loadPassword` carry fixed remember intent; successful auth writes/replaces the vault entry, while failed auth preserves the prior entry.
6. On Connect/reconnect, prefer the current memory lease, then an unexpired non-rejected exact vault entry, then return `AUTH_REQUIRED`. Keep forwarding rule operations entirely outside this path.
7. Enforce fixed expiry on every load and startup/open-client sweep. Expired data is never returned; deletion failure remains a safe cleanup warning, not permission to use it.
8. Separate `clear_live_secrets` from `forget_saved_credential`. Disconnect/scope switch/trust change/shutdown call only the former; profile delete/scope purge/Forget call the latter and fail closed if deletion cannot complete.
9. On terminal auth failure, mark the vault entry rejected without extending TTL. A successful newly entered credential atomically replaces it and starts a new term.
10. Add metadata to authoritative snapshots/events-as-hints and stable UI errors. Never expose target names, usernames, secret bytes, or raw Windows errors.
11. Test fixed times (just before/at/after 30 days), restart retention, trust-change blocking, scope switching, shutdown, rejected credential behavior, replacement, Forget/delete/purge, vault corruption/unavailability, and zeroization paths.

## Todo List

- [x] Add vault abstraction, clock, opaque identity, and versioned blob.
- [x] Implement direct Windows Credential Manager adapter.
- [x] Split trust verification from credential authentication.
- [x] Persist only after successful auth for fixed 30 days.
- [x] Separate live-secret cleanup from vault retention/deletion.
- [x] Add safe status, Forget, rejection, expiry, and sweep behavior. Snapshot metadata remains deferred to Phase 4.
- [x] Pass Windows vault lifecycle and secret-absence tests.

Phase 3 completion is recorded on 2026-08-17. Phase 4 remains responsible for Tauri/TypeScript snapshot metadata compatibility; no Phase 4 snapshot contract work is claimed here.

## Success Criteria

- Successful password/passphrase can reconnect after disconnect, scope round-trip, or app restart for 30 days without another prompt.
- Host-key change retains the entry but sends no credential until explicit repair/approval; forwarding remains blocked meanwhile.
- Shutdown leaves no live secret/session while the Windows vault entry remains usable until fixed expiry.
- Silent use never extends `expiresAt`; at/after expiry no credential is returned, and app-controlled cleanup deletes it.
- Terminal auth rejection never loops; successful replacement works and restarts the 30-day term.
- Forget, profile delete, and scope purge remove matching vault entries and cannot report false success.
- No secret appears outside Windows Credential Manager or transient zeroizing memory: none in TOML, snapshot, event, error, log, fixture output, evidence, browser storage, or IPC response.

## Risk Assessment

- **Critical — trust bypass leaks password to changed host:** verify host key before vault read/auth; packaged changed-key test.
- **Critical — cross-identity reuse:** opaque target includes exact scope/profile/endpoint/user/auth identity; validate again after read.
- **High — Credential Manager lacks native TTL:** fixed logical expiry checked before use; opportunistic physical deletion and documented rollback/uninstall limitation.
- **High — same-user process can access vault:** accepted Windows vault boundary; minimize metadata/target disclosure and document it.
- **High — rejected credential retry loop:** persistent rejected flag plus explicit replacement/retry action.
- **Medium — vault failure after successful auth:** preserve live session, expose safe not-saved state, never claim retention succeeded.

## Security Considerations

- Use Windows Credential Manager only; no custom encryption, DPAPI side file, subprocess, shell, or broad Tauri permission.
- Save only after SSH authentication success; wrong input never overwrites a valid entry.
- Keep endpoint-first trust store as sole durable host-key authority. Credential retention grants no trust.
- Use fixed 30-day expiry, not sliding renewal. Show exact expiry and explicit Forget.
- Profile deletion/scope purge are destructive credential operations and require authoritative native completion.

## Next Steps

- Phase 04 exposes safe remember/status/Forget contracts and synchronizes the expanded Windows-only command allowlist.
- Phase 05 adds default-on “Remember for 30 days,” expiry/status, rejected replacement, and Forget UX.
- Phase 06 must qualify the real packaged Windows vault lifecycle without using developer credentials.

## Unresolved Questions

None.
