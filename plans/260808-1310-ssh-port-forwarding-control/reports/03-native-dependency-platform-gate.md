# Phase 01 Native Dependency and Platform Gate

Date: 2026-08-09
Branch: `features/ssh-port-forwarding-control`
Decision: **NO-GO — Phase 02 is blocked pending native runner evidence and storage primitive proofs.**

## Scope

This gate validates the desktop-only dependency graph, the Tauri ACL boundary, and the
minimum API evidence needed before implementing forwarding, persistence, credentials, or
trust. It does not implement SSH forwarding behavior.

## Candidate dependency

The pinned candidate is:

```toml
russh = { version = "=0.62.5", default-features = false, features = ["ring"] }
```

The selected crypto backend is `ring 0.17.14`. RSA support is intentionally excluded:
the candidate's exact RSA release has an unfixed timing-side-channel advisory, while
the plan does not require RSA and still leaves the Phase 03 host-key algorithm allowlist
to be pinned. Cargo reports Rust 1.85 as the minimum for `russh` and the current
repository toolchain is Rust 1.96.0.

The reviewed SSH closure includes `russh-cryptovec 0.62.0`, `russh-util 0.52.0`,
`ssh-key 0.7.0-rc.11`, `ssh-encoding 0.3.0`, `ssh-cipher 0.3.0`, `ring 0.17.14`,
and Windows-only `pageant 0.2.1`. Reported licenses are Apache-2.0, MIT OR Apache-2.0,
Apache-2.0 OR MIT, or Apache-2.0 AND ISC. The `-rc` key package requires security-owner
and advisory review before release approval.

## API and protocol evidence

`russh 0.62.5` source and API documentation provide the required primitives:

- `client::Handler::check_server_key` runs during the initial key exchange and rejects
  keys by default, so endpoint-first exact-key verification can happen before auth.
- `Handle::channel_open_direct_tcpip` opens a local-forwarding channel.
- `Handle::authenticate_publickey_with` delegates signatures to an SSH-agent signer.
- `AgentClient::connect_uds`/`connect_env` cover Unix agent sockets.
- `AgentClient::connect_named_pipe` covers a Windows SSH-agent named pipe.
- `AgentClient::connect_pageant` exists on Windows, but Pageant is not accepted for v1
  until a runner proves its protocol and product support decision is recorded.
- `send_keepalive`, `close`, `disconnect`, and bounded async operations provide hooks
  for the planned keepalive and shutdown policy.

These are compile/API proofs only. They do not prove host-key policy, authentication,
cancellation, cleanup, or agent behavior at runtime.

## Implemented gates

- `build.rs` keeps browser-debug asset embedding and uses `AppManifest::commands` for
  exactly 12 desktop commands. Android/iOS builds receive no SSH command manifest.
- `permissions/ssh-forward.toml` allows exactly the 12 planned snake_case commands.
- `capabilities/ssh-forward.json` grants only `ssh-forward` to `main` on Linux, macOS,
  and Windows; it adds no `core:event`, shell, filesystem, HTTP, opener, or remote URL
  permission. Existing `default.json` still supplies the merged `core:default` baseline.
- `src/ssh_forward/mod.rs` provides the desktop main-window label seam and structured
  manifest tests. The command names are shared with `build.rs` through one source list;
  later handlers must call the seam for every command.
- `Cargo.toml` puts `russh` and direct Tokio support under Windows/macOS/Linux target
  dependencies. The forwarding module remains `cfg(desktop)` and mobile has no host
  fallback.

## Validation evidence

| Gate | Result | Evidence |
|---|---|---|
| Desktop formatting | PASS | `cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml -- --check` |
| Windows desktop compile | PASS | `cargo check --manifest-path apps/native/src-tauri/Cargo.toml` |
| Native unit tests | PASS | 17 passed, 0 failed |
| Windows SSH dependency path | PASS | `cargo tree --target x86_64-pc-windows-msvc -p russh` shows the pinned closure |
| Android SSH exclusion | PASS | `cargo tree --target aarch64-linux-android` has no `russh`, `ring`, `pageant`, or `ssh-key` package |
| Android compile | PASS | `cargo check --target aarch64-linux-android` |
| iOS dependency resolution/exclusion | PASS | `cargo tree --target aarch64-apple-ios` resolves without SSH packages |
| iOS compile | BLOCKED | Native iOS compilation is not runnable on this Windows host; macOS/Xcode (`xcrun`/clang plus the iOS target) is required |
| macOS/Linux desktop compile/runtime | NOT RUN | Requires native CI runners |
| Unix/Windows agent runtime | NOT PROVEN | Requires Linux/macOS sockets and Windows OpenSSH named-pipe runner tests |
| no-follow/reparse-safe storage | NOT PROVEN | No Phase 01 contained-handle/atomic-replace implementation or native race harness exists yet |
| advisory/license automation | PASS WITH WARNINGS | `cargo audit --file apps/native/src-tauri/Cargo.lock` found 0 vulnerabilities and 18 allowed warnings after `plist 1.10.0`/`quick-xml 0.41.0`; `cargo-deny` license automation remains unavailable |

## Go/no-go rationale

The ACL and dependency exclusion changes are safe to carry forward as a feasibility
spike. Phase 02 must not start because mandatory platform and storage gates remain
unproven and the selected SSH closure contains a release-candidate key package. The
audit is clean for vulnerabilities, but its 18 unmaintained/unsound warnings still
need release-owner review. RSA remains explicitly unsupported by this candidate until
a safe maintained SSH/key stack is approved.
No subprocess `ssh -L` fallback, path-based key access, Pageant fallback, or weakened
trust/storage rule is authorized by this result.

Generated per-command files under `permissions/autogenerated/` are Tauri build output;
the repository ignores that directory and only the reviewed `ssh-forward.toml` is
intended for source control.

## Required follow-up before Phase 02

1. Run the same commit on Windows, Linux, and macOS runners with generated temporary
   identities only; prove OpenSSH agent signing, host-key rejection, direct-tcpip,
   keepalive, cancellation, and clean close.
2. Add deterministic Unix no-follow and Windows reparse-safe contained-handle tests for
   every profile/trust/meta operation, backup/quarantine, and tombstone purge.
3. Add crash/fault tests for same-directory atomic replacement, protected backups,
   cleanup, permissions (`0600` on Unix), and runtime/maintenance locking.
4. Install the repository-approved license tooling, review every transitive license and
   the 18 audit warnings, and obtain security approval for the `-rc` key package and
   the non-RSA compatibility decision.
5. Run iOS compilation in its native macOS CI environment and attach hash-bound runner
   evidence before changing this decision to GO.

## Unresolved questions

- Which exact Windows OpenSSH named-pipe discovery policy is supported in the packaged app?
- Is Pageant excluded permanently, or will a named product/security owner accept it after runtime proof?
- Is non-RSA authentication acceptable for v1, or must a later SSH/key stack add safe RSA support?
- Which named owners provide the protected macOS/Linux/iOS runtime and storage-race evidence?
