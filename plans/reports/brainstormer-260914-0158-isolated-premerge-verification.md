# Isolated pre-merge verification — recommendation

Status: recommendation documented; user approval and implementation-plan decision pending. No runner implemented or VM booted.

## Problem

Verify this worktree's idle-suspend and diagnostics features without modifying the workstation's services, RTC, credentials or production state. Separate source/test success, installed-system qualification and physical suspend qualification.

The previous release-verification verdict was overstated: default Rust tests aborted, the full browser suite failed, native packaging failed, lint passed only after rule weakening, and packaging reused existing binaries. These are not resolved by an isolated runner; it must expose them honestly. The earlier QA report must not be treated as release approval.

## Recommended decision

Use a local QEMU/KVM runner with disposable Fedora 44 builder and runtime VMs, run sequentially. Containers are optional future acceleration, not a prerequisite. Do not implement multiple virtualization backends.

- Rootless Podman/Docker: useful dependency/build isolation; shared host kernel and container-specific service/permission environment prevent full system qualification.
- Distrobox: reject for this boundary. Host integration, including home and integration sockets, conflicts with the isolation objective.
- QEMU/KVM: independent guest kernel, systemd, users, filesystems and reboot lifecycle. Best match for installed-system verification; virtual devices do not prove physical RTC/firmware behavior.

## Proposed artifact

One entry point: `scripts/verify-premerge-isolated.sh`, supported by narrowly scoped guest scenario scripts under existing deployment-test conventions.

Each run exports a private uniquely named evidence directory containing `result.json`, sanitized logs, diagnostic bundles and a human-readable summary. Record candidate commit/tree or dirty-snapshot digest, base revision, guest image digest, kernel/toolchain versions, exact commands, archive digest and per-gate pass/fail/blocked results.

Never overwrite existing final release assets or automatically edit source, disable checks, install host packages, merge branches or publish releases.

## Source and execution contract

1. Capture immutable source input. Committed resolved merge candidates qualify for merge evidence. Explicit dirty snapshots support development only; label them non-release evidence and exclude credentials/build outputs.
2. Boot a pinned builder image with a new writable overlay. Build all release binaries and web assets with locked dependencies; do not reuse worktree target/dist binaries.
3. Run required existing tests, lint and packaging checks. Record concurrency and environment. Diagnostic reruns cannot erase original failures.
4. Transfer the exact checked archive into a separate clean runtime VM. Developer packages/caches must not hide runtime dependencies.
5. Run guest installation, service identity/config persistence, permissions, lifecycle/reboot, upgrade/rollback, API, observer and diagnostic scenarios.
6. Export evidence before destroying disks. Required unavailable measurements or missing prerequisites are blocked, never passed.

Host orchestration owns reboot/reset and resumption of scenarios. A guest shell cannot reliably resume after resetting its own disk or rebooting. Preserve existing assertions but reconcile their lifecycle with this boundary.

## Scope

In: local Linux runner, Fedora 44 qualification, freshly built release archive, real guest systemd and identities, both feature suites, existing deployment scenarios, deterministic fake-executor admission tests, read-only diagnostics checks.

Out: CI wiring initially; physical suspend/wake; automatic host changes; real model APIs/agent credentials; arbitrary distro matrix; automatic defect repairs; alternative virtualization backends; native desktop release qualification.

Default gate never requests real suspend. A separately invoked guest suspend experiment would need explicit approval and amendment of the existing safety contract. Hardware suspend remains an Operations gate regardless of VM results.

## Acceptance criteria

- All required gates pass for the recorded candidate and exact archive; no hidden skipped tests or relaxed rules.
- Clean installation and upgrade/rollback preserve guest-owned configuration/state.
- API and helper run under intended identities and deployed hardening; root-only success is insufficient.
- Agent output/TCP activity/input and unknown/stale observations obey existing admission contracts.
- Diagnostics preserve privacy, correlation, bounds, role handling, output modes and source non-mutation.
- Guest reset/reboot failures yield bounded host-side failure evidence.
- No host home, D-Bus, container socket, RTC or block-device passthrough; no writable source mount. QEMU runs unprivileged; privileged actions stay in guest.
- Controlled guest networking and local synthetic workloads; no model API calls.

## Existing touchpoints and findings

- `tests/deploy/linux-release-common.sh`: mock release bundles use shell binaries; not installed-runtime proof.
- `tests/deploy/linux-release-protected-runtime.sh`: existing root-owned reset/crash/reboot/migration-hook contract; orchestration drivers were not found in searched scripts/workflows.
- `tests/deploy/linux-release-rootless-smoke.sh`: real binary smoke but automatic selection can use stale release/debug outputs. Runner must supply explicit candidate paths.
- `scripts/verify-idle-suspend-boundary.sh`, server idle-suspend/diagnostics suites, and `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`: reuse existing safety and behavior coverage.
- `deploy/release/build-release-archive.sh`, manifest generator and asset validator: reuse exact packaging path.
- `.github/workflows/release-linux.yml:85–93`: artifact upload omits idle-suspend helper, while archive builder requires it at lines 124–127. Clean workflow-equivalent packaging must expose this mismatch.
- Existing qualification contract keeps real suspend outside automation: `plans/260910-1604-agent-activity-idle-suspend/phase-07-verification.md:19–41`.

## Feasibility and constraints

Observed `/dev/kvm` exists with read/write permission. QEMU/libvirt executables were not found on PATH; Podman, Docker and Distrobox were found. KVM operation, guest image provisioning, available disk capacity and scenario runtime are not verified.

Initial resource proposal: one VM at a time, 4 vCPUs and 6–8 GiB RAM. This is a starting configuration, not a measured requirement. Require disk-space and virtualization preflight before runs; no silent fallback to a weaker container gate.

## Next steps

Confirm this recommendation, then create a detailed implementation plan covering host/guest orchestration, evidence schema and existing-test reuse. No plan command invoked yet.

## Sources

- https://distrobox.it/#security-implications
- https://www.qemu.org/docs/master/system/images.html

## Unresolved decisions

- User approval of recommended local-first, QEMU-only, no-suspend scope.
- Whether to proceed to an implementation plan.
