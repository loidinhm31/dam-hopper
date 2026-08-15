# Phase 07: Windows Verification and Release Gates

## Context links

- [Plan](./plan.md)
- [Phase 01 platform gates](./phase-01-dependency-platform-gates.md)
- [Phase 04 manager/IPC](./phase-04-native-manager-tauri-ipc.md)
- [Phase 05 host adapter](./phase-05-host-context-native-adapter.md)
- [Phase 06 control surface](./phase-06-desktop-control-surface.md)
- [Current CI workflow](../../.github/workflows/ci.yml)
- [Current release workflow](../../.github/workflows/release.yml)

## Overview

- **Priority:** P1
- **Status:** Complete (Windows-only re-scoped acceptance)
- **Effort:** 16h
- **Description:** Prove the Windows implementation, native/package gates, protected evidence workflow, and release boundaries. Cross-platform expansion is deferred to a separate plan.

## Re-scoped acceptance

This phase is complete for Windows desktop only. The accepted scope includes Windows native/static gates, real temporary OpenSSH remote-loopback forwarding, strict redacted evidence validation, same-commit/artifact binding, protected approval binding, WebView2/OpenSSH preflight, no-bundle Tauri compilation, and the unsigned NSIS package profile. Protected packaged-runtime evidence remains a production-release prerequisite, but is an operational gate rather than a blocker to completing this implementation plan. macOS, Linux, Android, iOS, signed updater artifacts, and broader product/security expansion are deferred follow-up scope.

## Key Insights

- Cross-compilation cannot prove OS agents, handles, atomic writes, Tauri ACL, packaged lifecycle, or listener closure. Each support claim needs a native runner.
- Automated package build can pass while packaged runtime evidence remains `manual-pending`; release needs both green for the same commit/artifact.
- Browser/mobile exclusion needs exact call-count assertions, not only hidden navigation.
- Other-local-process access is intentional product risk and must be accepted explicitly. The test proving a second process can connect is not a vulnerability-test failure.
- Existing server port-forward, PTY, Git SSH, HTTP SSH API, and WebSocket transport behavior is protected, not cleanup scope.

## Final Windows-only execution status (2026-08-15T22:39:00+07:00)

- Added a real temporary OpenSSH/remote-loopback forwarding gate, deterministic smoke/evidence validation, the strict twelve-command ACL boundary checks, and a Windows-only native package profile.
- Windows CI now runs Rust formatting, lint, unit tests, the ignored real-OpenSSH gate, no-bundle Tauri compilation, and NSIS packaging independently of the unrelated server test job. Release pre-bundle checks run the same E2E before the desktop matrix, and Windows packaging uses the same explicit profile.
- The base Tauri configuration keeps the updater/relaunch boundary assertion, but the unsigned Windows package profile disables updater artifact creation. This avoids inventing a signing key or endpoint; no updater plugin, capability, restart, or relaunch behavior is enabled.
- WebView2/OpenSSH preflight is automated. Evidence validation enforces the schema shape, exact artifact filename/hash, checked-out and package-run commit, redaction, and approval IDs supplied by the protected environment. Packaged runtime behavior remains `manual-pending` until protected evidence carries release-engineer, security-reviewer, and product-owner approvals.
- macOS, Linux, Android, iOS, signed updater artifacts, and final product/security approval remain deferred and are not claimed by this Windows-only continuation.

### Validation conclusion

- **Pass:** Windows static/native gates, real temporary OpenSSH remote-loopback gate, evidence redaction/schema checks, artifact SHA-256 and package-run commit binding, protected approval-ID binding, WebView2/OpenSSH preflight, no-bundle compilation, and NSIS packaging profile.
- **Manual-pending:** Protected packaged-runtime execution evidence. It must be produced by the named release engineer for the exact package, then independently approved by security and product owners and accepted by `--validate-evidence` in the protected environment.
- **Not validated:** macOS/Linux native gates; Android/iOS exclusion checks; signed/notarized packages or updater artifacts; final product acceptance of local-process exposure; final security acceptance.

### Protected runtime evidence prerequisites

Runtime support cannot be promoted from `manual-pending` until all of the following exist for the same commit and package SHA-256: redacted `evidence.json`, release-engineer execution record, security-reviewer ACL/trust/fixed-target/remediation approval, product-owner acceptance of other-local-process loopback exposure, protected validator pass, and protected source-diff/redaction checks. Build-only, self-attested, missing, stale, wrong-hash, or wrong-commit evidence is not a release pass.

## Windows-only completion scope

- [x] Windows Rust formatting, clippy, native tests, and ignored real-OpenSSH E2E pass.
- [x] Windows smoke modes cover build-only, runtime preflight, and strict evidence validation.
- [x] Evidence binds schema, redaction, artifact filename/hash, checked-out/package commit, protected IDs, and protected timestamps.
- [x] Windows CI/release pre-bundle gates and the unsigned NSIS package profile are implemented.
- [x] Protected tag-release workflow requires successful same-commit runtime evidence before desktop packaging.
- [x] Protected server, query, WebSocket, browser, and mobile implementation boundaries remain unchanged.

## Deferred cross-platform requirements

The following original requirements remain intentionally deferred and are not part of this Windows-only completion decision.

### Automated gates

- Rust: strict decimal parsing plus numeric 9/10 and 99/100 activation/revision/generation races, stable/process/client identities, A/B/C barriers, independent revisions, all-store containment/atomic faults, retention/purge, inventory TOCTOU, auth, endpoint-first trust/repair, deterministic auto-start/skips, channel cap/idle policy, reconnect, and Tauri shutdown.
- Real temporary OpenSSH plus echo/HTTP service bound on SSH-side `127.0.0.1`: exact approval, bytes, concurrent/long-idle clients, non-loopback target rejection, refusal, disconnect/reconnect, key/algorithm changes, Stop/scope-switch/exit closure. Generated keys only; no path/private bytes/payload in output.
- Tauri ACL: exact equality of 12 names across `AppManifest`, permission TOML, capability inclusion, invoke handler, adapter map, and tests. Main allowed; unauthorized label/remote origin denied; malformed input denied.
- TypeScript/UI: numeric `BigInt` comparison after decimal parsing, A/B/C late results, event-hint exact client epoch/activation/scope identity, manager restart, same-scope reload, observed deletion purge, unavailable known scopes, form default/no-resync, fixed errors, exact trust-repair UI, no secret controls.
- Chromium: desktop host route/nav present; browser/native mobile absent; invoke/listen/REST/WS forwarding counters exactly zero when absent.
- Mobile: Android/iOS Cargo checks and trees contain no SSH/agent/native-handle dependency or forwarding handler/permission exposure.
- Static boundary: no product-source diff under `server/`; explicitly preserve `server/src/port_forward/**`, `server/src/api/port_forward.rs`, `server/src/pty/**`, `server/src/api/ssh.rs`, `server/src/ssh.rs`, `server/src/api/ws.rs`, `packages/ui/src/api/queries.ts`, and `packages/ui/src/api/ws-transport.ts`.

### Deferred native OS matrix

| OS runner | Rust target | Bundle | Required native proof |
|---|---|---|---|
| `windows-latest` | `x86_64-pc-windows-msvc` | `nsis` | approved Windows agent, reparse-safe handle, overwrite, package/runtime |
| `macos-14` | `aarch64-apple-darwin` | `app,dmg` | `SSH_AUTH_SOCK`, no-follow, permissions/overwrite, package/runtime |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `deb,rpm` | `SSH_AUTH_SOCK`, no-follow, `0600`/overwrite, package/runtime |

- Automated jobs install/start isolated agent and private test `sshd`; unavailable fixture fails, never skips.
- macOS runner also checks `aarch64-apple-ios`; Android environment checks `aarch64-linux-android`. Cargo-tree absence is asserted.
- Release adds macOS and runs feature gates before bundle/sign. No runtime support claim until native automated and protected manual evidence pass.

### Packaged evidence ownership and states

- Add `smoke:ssh-forward` modes `--build-only`, `--runtime`, `--validate-evidence`. Build-only can mark automated package `pass`; it cannot mark runtime `pass`.
- Per-OS runtime checks: exact 12-command main ACL/unauthorized denial; numeric 9/10 and 99/100 ordering; wrong-client-epoch hint causes no refetch; reviewed endpoint/fixed remote loopback; unknown exact approval/explicit Start; bytes/long-idle; second local process; key/algorithm hard fail; Tauri-resolved trust path, stopped-app repair refusal while running, contained backup/quarantine/recovery, then unknown approval; same-scope reload one listener; Stop, scope switch, and app exit each make old listener unreachable within 5 seconds; no leaked detail.
- CI owns automated test/build artifacts. Named release engineer runs packaged artifact and uploads `artifacts/native-ssh-forward/<commit>/<os>/evidence.json`. Security reviewer accepts ACL/trust/fixed-target/remediation evidence. Product owner accepts other-local-process exposure and copy.
- Protected `native-ssh-forward-runtime` environment/check remains `manual-pending` until role approvals and `--validate-evidence` bind evidence to exact commit and artifact SHA-256. Missing/build-only/self-attested/wrong-hash evidence is not pass. Release job requires the validated check.
- Evidence may include OS, WebView/runtime version, SSH crate/version, agent backend, commit, artifact hash, boolean checks, reviewer IDs/timestamps. It excludes key IDs/fingerprints/endpoints/paths/usernames/payloads/secrets.
- Product acceptance text: any local desktop process can use `127.0.0.1:<port>`; loopback blocks LAN reachability but gives no local isolation/authentication; SSH encryption starts after the local listener. Rejection blocks v1.
- Assert no runtime updater plugin/capability, Tauri restart/relaunch call, or in-app control. Packaging `createUpdaterArtifacts` does not imply runtime update support. Any future updater gate must first prove coordinator-backed 5-second disposal and old-listener refusal before relaunch on every packaged OS.

### Deferred cross-platform validation commands

```powershell
pnpm install --frozen-lockfile
cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/native/src-tauri/Cargo.toml
cargo test --manifest-path apps/native/src-tauri/Cargo.toml updater_relaunch_remains_blocked
cargo test --manifest-path apps/native/src-tauri/Cargo.toml --test ssh_forward_e2e -- --ignored --nocapture
cargo tree --manifest-path apps/native/src-tauri/Cargo.toml --target aarch64-linux-android
cargo check --manifest-path apps/native/src-tauri/Cargo.toml --target aarch64-linux-android
pnpm --filter @dam-hopper/native test
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
pnpm --filter @dam-hopper/native build
pnpm --filter @dam-hopper/native exec tauri build --no-bundle
pnpm --filter @dam-hopper/native smoke:ssh-forward -- --build-only
pnpm --filter @dam-hopper/native smoke:ssh-forward -- --runtime
pnpm --filter @dam-hopper/native smoke:ssh-forward -- --validate-evidence
pnpm lint
$base = git merge-base HEAD origin/main
git diff --exit-code $base -- server
git diff --exit-code $base -- packages/ui/src/api/queries.ts packages/ui/src/api/ws-transport.ts
```

On macOS also run `cargo tree/check --target aarch64-apple-ios`. Native bundle commands:

```text
Windows: pnpm --filter @dam-hopper/native run tauri:build:windows
macOS:   pnpm --filter @dam-hopper/native exec tauri build --bundles app,dmg
Linux:   pnpm --filter @dam-hopper/native exec tauri build --bundles deb,rpm
```

## Architecture

```text
contract/A-B-C tests -> real sshd remote-loopback E2E -> 12-command ACL/mobile tests
  -> UI zero-call tests -> native package build PASS
  -> release engineer runtime evidence MANUAL-PENDING
  -> security + product approvals + validator PASS
  -> protected source-diff gate -> release
```

No build-only or skipped check can be promoted to runtime-supported.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\tests\ssh_forward_e2e.rs` - real temporary OpenSSH/remote-loopback suite.
- `G:\ws\sharing\dam-hopper\apps\native\scripts\smoke-ssh-forward.mjs` - build/runtime/evidence validator.
- `G:\ws\sharing\dam-hopper\apps\native\test-fixtures\ssh-forward\evidence.schema.json` - non-secret evidence schema.
- `G:\ws\sharing\dam-hopper\.github\workflows\native-ssh-forward-runtime-evidence.yml` - protected manual evidence validation.

### Modify

- `G:\ws\sharing\dam-hopper\apps\native\package.json` - native tests/smoke scripts.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.toml` - test-only dependencies.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.lock` - locked tests.
- `G:\ws\sharing\dam-hopper\.github\workflows\ci.yml` - three-OS automated, mobile-tree, UI, boundary gates.
- `G:\ws\sharing\dam-hopper\.github\workflows\release.yml` - macOS, pre-bundle gates, protected evidence dependency.

### Delete

- None.

## Implementation Steps

1. Build external `sshd` harness with temporary config/keys and in-process remote-loopback target; redact and always dispose children/temp data.
2. Add endpoint/trust/idle/non-loopback, all-store link/reparse/component-swap, stopped-app repair/backup/recovery, and Stop/switch/exit listener reachability E2E.
3. Run randomized A/B/C barriers plus deterministic numeric 9/10 and 99/100 boundaries, exact hint-context filters, reload/process restart, auto-start/skipped, retention/purge, and close/exit/BrowserDebug coordination tests.
4. Add ACL equality harness for exact 12 names and unauthorized/remote/mobile denial.
5. Complete native/UI/Chromium suites; absent browser/Android/iOS paths assert every forwarding call counter zero.
6. Implement smoke/evidence schema and protected workflow with commit/artifact/role binding and manual-pending state; assert runtime updater/relaunch remains absent.
7. Extend native CI for OpenSSH/agents/platform libraries/mobile checks and upload redacted package artifacts.
8. Add macOS release; require all automated jobs and same-commit validated runtime evidence.
9. Record product loopback-risk acceptance and security fixed-target/ACL/trust acceptance before release candidate.
10. Run protected diffs; remove any unauthorized server/PTY/SSH/WS/query change without reverting unrelated user work.
11. Scan artifacts/logs for secrets, paths, endpoints, usernames, labels/IDs/fingerprints, payload, and source chains.

## Deferred expansion todo list

- [ ] Rust fmt/clippy/unit/real-SSH/A-B-C tests pass.
- [ ] Numeric counter boundaries and exact event-hint context tests pass.
- [ ] Every native store and trust-repair path passes link/reparse/component-swap tests.
- [ ] Exact 12-command ACL equality and unauthorized denial pass.
- [ ] Android/iOS trees/checks exclude forwarding dependencies/handlers.
- [ ] Native adapter/UI/Chromium zero-call suites pass.
- [ ] Tauri no-bundle and all OS bundles pass.
- [ ] Stop/switch/exit listener closure and reload preservation pass.
- [ ] Runtime updater/relaunch remains absent; metadata-only updater artifacts are not misreported.
- [ ] Automated package state passes; runtime evidence separately passes all three OSes.
- [ ] Release engineer/security/product approvals recorded.
- [ ] Other-local-process risk accepted; remote target remains `127.0.0.1` only.
- [ ] Protected source diff and redaction scans pass.

## Windows-only success criteria

- Windows native tests, temporary OpenSSH E2E, smoke/build checks, lint, formatting, no-bundle compilation, and NSIS packaging pass.
- Evidence validation fails closed for missing, malformed, stale, wrong-hash, wrong-commit, unbound-role, or prohibited-value evidence.
- Windows CI is independent of unrelated root/server failures; protected server/query/WebSocket boundaries remain unchanged.
- No runtime updater plugin/capability or restart/relaunch behavior is enabled.

## Deferred expansion success criteria

- All exact commands and native bundles exit 0; mobile trees contain no accepted SSH crate.
- Three automated native jobs run without skips; protected runtime evidence does not pass until validated.
- Same-scope reload retains one listener; Stop, scope switch, and app exit each close it within 5 seconds.
- Wrong client epoch/token/scope hints cause zero refetch; numeric 9/10 and 99/100 fixtures select the larger counter.
- Runtime trust repair resolves the documented platform root, refuses while app lock is held, preserves/restores protected backup, and returns only through unknown approval.
- A separate local process succeeds before Stop and fails after Stop, proving both accepted exposure and disposal.
- Browser/native mobile expose no route/nav and zero invoke/listen/REST/WS forwarding calls.
- Diff gates prove no product-source server/query/WS implementation or removal of existing server port-forward/PTY/SSH behavior.

## Risk Assessment

- **OpenSSH variance:** Explicit version/install and no skip.
- **GUI automation gap:** Hash-bound protected human evidence; automated layers remain independent.
- **Manual evidence mislabeled pass:** Protected environment separates automated pass/manual-pending/runtime pass.
- **Signing unavailable on PR:** Unsigned no-bundle/runtime proof on PR; signed/notarized release only with existing secrets.
- **Flaky ports/timing:** OS-assigned fixture ports, readiness probes, bounded deadlines, deterministic barriers.

## Security Considerations

- Test identities are generated per job, confined to temp, never uploaded.
- Evidence excludes actual endpoint/fingerprint/key identity despite public nature.
- Capability inspection shows only exact app permission; no shell/general filesystem/HTTP plugin added.
- Loopback exposure and remote-target restriction are explicit release decisions, not implicit defaults.

## Next steps

- This Windows-only plan is complete. Produce protected runtime evidence and configure the three approval roles before a production tag release.
- Create a separate plan before adding macOS, Linux, Android, iOS, signed updater artifacts, or new local-client authentication claims.
- Any IPv6/non-loopback target, remote/SOCKS, password/keychain, or local-client auth work needs a new threat-model plan.

### Deferred operational questions

- Named release engineer, security reviewer, product owner, and protected-environment policy must be configured before release candidate.
- Final Windows agent support wording and macOS signing/notarization claim depend on Phase 01/07 evidence.
