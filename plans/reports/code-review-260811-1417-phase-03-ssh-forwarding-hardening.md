# Phase 03 SSH forwarding hardening — final security/code review

## Code Review Summary

### Scope

- Files reviewed: current `apps/native/src-tauri/src/ssh_forward` tree plus `src/lib.rs` and `src/main.rs`; tracked and untracked Phase 03 source included.
- Lines analyzed: approximately 7,937 across 27 native files, including tests.
- Review focus: Phase 03 transport, authentication, host trust, challenge binding, errors, storage recovery, Windows handle safety, and maintenance lease.
- Excluded: unrelated `.pnpm-store/` and `artifacts/`; Phase 04 manager/12-command IPC remains pending and is listed as follow-up.
- Updated plans: none; user requested review artifact only and no plan/source edits.

### Overall Assessment

Strong hardening baseline and clean local validation. Aggregate connect/auth timeout, Windows algorithm filtering, endpoint-first trust classification, offered-key fingerprint consistency, contained storage recovery, and reparse/hard-link checks are implemented and tested.

Phase 03 is not approved for security sign-off yet. Two high findings remain: challenge scope binding is incomplete, and trust repair is not actually pre-webview. No critical findings.

## Critical Issues

None found.

## High Priority Findings

### H-01 — Host-key challenges omit immutable scope ID

- References: `apps/native/src-tauri/src/ssh_forward/known_hosts.rs:124`, `known_hosts.rs:213`, `known_hosts.rs:220`, `apps/native/src-tauri/src/ssh_forward/model.rs:217`.
- `ChallengeContext` carries only `scope_generation`; the challenge record/DTO does not carry `scope_id`. Repeat/approval matching uses `profile_id` plus numeric context. Profile IDs are only unique inside one stored scope (`store.rs:520`), and scope generations can repeat across scope activation.
- A duplicated profile UUID across scopes can therefore make an old challenge acceptable in another scope when the other context counters match. This violates the required desktop/session/client/activation/scope binding and can approve the held key into the wrong scope.
- Fix: bind canonical `scope_id` in the challenge record and approval context; compare it on issue, repeat, and approve. Add a cross-scope duplicate-profile replay test.

### H-02 — Trust repair starts the normal Tauri runner before repair

- References: `apps/native/src-tauri/src/lib.rs:24`, `lib.rs:27`, `lib.rs:35`, `apps/native/src-tauri/src/main.rs:10`.
- `run_trust_repair` calls `Builder::run(generate_context!())`. With the pinned Tauri 2.11.5 runner, configured windows are created before the `setup` callback; the repair therefore occurs after the main webview can be created/loaded. This is not the required pre-webview maintenance mode.
- The current runner has no SSH invoke handlers, which limits impact, but it still violates the trust-repair isolation boundary and has no runtime proof that webview/plugin lifecycle is absent.
- Fix: use a maintenance-only bootstrap/context with no configured windows/webviews, resolve the Tauri app-config directory through the same platform API, acquire the runtime lease, repair, and exit. Add a packaged/process test proving no webview or normal IPC lifecycle starts.

## Medium Priority Improvements

### M-01 — Expired challenges return `NOT_FOUND`, never `EXPIRED`

- References: `apps/native/src-tauri/src/ssh_forward/known_hosts.rs:265`, `known_hosts.rs:269`, `apps/native/src-tauri/src/ssh_forward/error.rs:162`.
- `approve` removes expired entries before looking up the requested ID, so an expired challenge returns `HOST_KEY_CHALLENGE_NOT_FOUND`; the declared `HOST_KEY_CHALLENGE_EXPIRED` contract is unreachable.
- Fix: identify an expired matching challenge before eviction, return `HOST_KEY_CHALLENGE_EXPIRED`, then clear it. Keep unknown IDs as `NOT_FOUND` and add boundary-time tests.

### M-02 — Persisted trust records do not verify key/algorithm/fingerprint consistency

- References: `apps/native/src-tauri/src/ssh_forward/store.rs:633`, `store.rs:642`, `store.rs:652`; comparison is fully enforced only for offered keys in `apps/native/src-tauri/src/ssh_forward/known_hosts.rs:65`.
- Stored `public_key` is checked for canonical Base64 but is never parsed and recomputed against the stored algorithm and SHA-256 fingerprint. Restore/recovery can therefore preserve an internally inconsistent trust document. Current lookup fails closed for most such records, but the persistence contract is weaker than the approval contract.
- Fix: for records with a key, parse the SSH wire key and require exact algorithm/fingerprint agreement; define an explicit migration/fail-closed rule for legacy `public_key = None` records.

### M-03 — Derived `Debug` can expose the full offered host key

- References: `apps/native/src-tauri/src/ssh_forward/ssh_client.rs:38`, `ssh_client.rs:40`, `apps/native/src-tauri/src/ssh_forward/known_hosts.rs:45`.
- Transport errors contain `OfferedHostKey`, which contains `public_key: Vec<u8>`, and derive `Debug`. Any `{:?}` error logging can emit the complete host public key, contrary to the error/log redaction contract.
- Fix: implement redacted `Debug` or remove key material from transport errors and retain the full key only in the native challenge store.

### M-04 — Keepalive loss is detected after four unanswered probes

- References: `apps/native/src-tauri/src/ssh_forward/ssh_client.rs:29`, `ssh_client.rs:33`, `ssh_client.rs:156`.
- `KEEPALIVE_MAX` is set to 3, but russh 0.62.5 increments its counter and closes when `alive_timeouts > keepalive_max`; the configured session consequently tolerates a fourth unanswered keepalive. Phase 03 requires loss after three.
- Fix: align the configured value with the pinned dependency semantics or own the counter; add a three-probe behavioral test.

### M-05 — The serialized error enum is broader than the fixed Phase 03 table

- References: `apps/native/src-tauri/src/ssh_forward/error.rs:52`, `error.rs:62`, `error.rs:192`.
- Legacy Phase 02 variants remain serializable (`INVALID_COUNTER`, `INVALID_TIMESTAMP`, `INVALID_PROFILE`, `IDENTITY_CORRUPT`, `STALE_CLIENT`, `STORAGE_UNAVAILABLE`) and map to a generic message. The fixed Phase 03 code/message set is therefore not exact, and there is no TypeScript mirror test yet.
- Phase 04 handlers are pending, so no active IPC regression is claimed. Before registering commands, keep compatibility variants internal or explicitly map them to the Phase 03 table and add exact Rust/TypeScript code/message/retryability fixtures.

## Low Priority Suggestions

### L-01 — Deferred Unix agent inventory does not filter before its cap

- Reference: `apps/native/src-tauri/src/ssh_forward/credentials/unix.rs:19`.
- The Unix adapter takes the first 64 identities without supported-algorithm filtering. It is currently excluded by the Windows-only `ssh_forward` module gate, so this is not a Windows Phase 03 regression; fix before any Unix enablement.

## Phase 04 / Follow-up Items (not Phase 03 regressions)

- The store API can be opened/recovered without holding the feature runtime lease (`apps/native/src-tauri/src/ssh_forward/store.rs:240`), while repair acquires it separately (`trust_repair.rs:122`). Current native bootstrap holds the lease (`lib.rs:63`), but Phase 04 manager construction must retain that lease for the complete active/staged runtime and prove maintenance cannot race a live manager.
- The Phase 04 manager, exact 12-command IPC handlers, activation ordering, shutdown coordinator, event filtering, and lifecycle tests are intentionally pending per `plans/260808-1310-ssh-port-forwarding-control/phase-04-native-manager-tauri-ipc.md`; their absence is not counted as a Phase 03 implementation regression.
- Existing updater configuration is outside this diff; Phase 04’s explicit no-runtime-updater/relaunch gate remains unresolved and should stay a follow-up.

## Positive Observations

- `ssh_client.rs:161` wraps connect and authentication in one 15-second `with_deadline`; the regression test at `ssh_client.rs:358` proves one aggregate deadline.
- Windows agent authentication filters supported algorithms before the 64-identity cap (`ssh_client.rs:180`, `credentials/windows.rs:38`); safe-key inventory filters before its 64-record cap (`credentials/windows.rs:120`).
- Endpoint-first classification is correct: exact endpoint + algorithm + key trusts; same-algorithm key changes and new algorithms are hard failures (`known_hosts.rs:165`).
- Offered keys are parsed and their algorithm/fingerprint are recomputed before acceptance (`known_hosts.rs:52`); IPC approval uses the held native key, not client-supplied key material (`known_hosts.rs:302`).
- Root backup/quarantine recovery is handle-contained, checksum/scope-validated, revision-monotonic, and covered by crash/fault tests (`store.rs:1700`, `store.rs:1741`, `store.rs:3041`).
- Windows handles reject reparse points and files with multiple hard links (`windows_storage_probe/windows_storage_handle.rs:43`); retained handles are revalidated before reads/deletes (`windows_storage_probe/windows_storage_identity.rs:53`).
- Current bootstrap acquires the feature runtime lease before normal native operation (`lib.rs:63`), and stopped-app repair acquires it before opening the typed store (`trust_repair.rs:122`).

## Recommended Actions

1. Close H-01 with explicit scope-ID challenge binding and replay tests.
2. Replace H-02 with a genuinely no-window/pre-webview maintenance bootstrap and packaged proof.
3. Close M-01 through M-04 before Phase 03 sign-off; add exact persisted-key validation and redacted error-debug tests.
4. Decide the legacy error-code compatibility policy and add the Rust/TypeScript exact-table fixture before Phase 04 IPC registration.
5. In Phase 04, make manager lease ownership structural and add a cross-process maintenance-versus-live-runtime race test.

## Metrics

- Type coverage: not measured; native TypeScript `tsc --noEmit` passed.
- Tests: `cargo test --locked --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward` — 95 passed, 1 ignored agent-gate test, 0 failed.
- Build: `cargo build --locked --manifest-path apps/native/src-tauri/Cargo.toml` — passed.
- Clippy: `cargo clippy --locked --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings` — 0 issues.
- ESLint: `pnpm lint` — 0 issues.

## Approval Disposition

**Phase 03: Request changes / not approved for security sign-off.** No critical issue found, but H-01 and H-02 are high-priority boundary failures. Phase 03 can be reconsidered after both are closed and the medium contract items are either fixed or explicitly accepted with tests.

### Unresolved Questions

- What exact maintenance-only Tauri context/config will provide `app_config_dir()` without creating the configured main webview?
- Will Phase 04 guarantee globally unique profile IDs, or must scope ID remain an explicit challenge field regardless? The latter is required for defense in depth.
