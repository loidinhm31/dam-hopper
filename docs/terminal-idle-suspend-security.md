# Terminal Idle Suspend — Security and Threat Model

## Overview

Terminal Idle Suspend introduces server-authoritative, opt-in Linux suspend with RTC wake when all managed PTY sessions have remained quiet for a bounded duration. This document establishes the security invariants, threat model, approval requirements, and audit policies for Phase 01 through Phase 05.

## Security Invariants

1. **Startup Ownership**: Feature enablement (`enabled`), helper enrollment (`enrollment_reference`), and capability mode (`capability_selection`) are captured immutably at server startup from the canonical registry configuration. They cannot be enabled, disabled, or re-enrolled via workspace switch, config reload, full config replacement (`PUT /api/config`), or settings import.
2. **No Unrestricted Sudo or Shell Execution**: The server binary never invokes `sudo`, shell pipelines, arbitrary command strings, or user-supplied executable paths. Execution in Phase 03 is restricted to a dedicated root-owned helper over a local socket with a fixed, strictly validated protocol.
3. **Dedicated Narrow Timing Authority**: Browser actors cannot trigger, cancel, or override suspend operations. Authenticated actors can only tune the bounded quiet period and wake delay pair via `PATCH /api/system/idle-suspend/v1/timing`.
4. **No-Auth Mode Rejection**: The timing mutation endpoint explicitly rejects `--no-auth` / development mode (`403 idleSuspendTimingDisabledNoAuth`) to prevent unauthenticated timing tampering on untrusted local networks.
5. **Fail-Closed by Default**: Unsupported platforms, unconfigured helper enrollment, sleep inhibitors, missing RTC alarms, or audit/persistence failures prevent suspend entirely without automatic retries.

## Threat Analysis and Mitigations

| Threat | Impact | Mitigation |
|---|---|---|
| **Arbitrary Command Escalation** | Critical | No shell or command execution. Fixed request payload `SuspendWithRtcWakeRequest { request_id, wake_after_seconds }` only. |
| **Tampering via Full Config (`PUT /api/config`)** | High | `preserve_and_reject_idle_suspend_mutation` preserves current settings and rejects any client-supplied delta. |
| **Workspace Switch Hijack** | High | Canonical startup registry path is captured at boot; workspace switches preserve immutable startup policy. |
| **Timing Bounds Abuse / DoS** | Medium | Strict bounded integer ranges: `quiet_period_seconds` [60, 86400], `wake_after_seconds` [60, 86400]. Rejects float, zero, negative, and overflow values. |
| **Audit Log Tampering / Leakage** | Medium | Server-private mode-0600 JSONL audit log with `libc::O_NOFOLLOW`. Excludes credentials, auth tokens, command strings, environment variables, and terminal contents. |
| **Fleet Activity Race Condition** | High | Serialized coordinator command queue. Pre-handoff checks require zero live/creating PTYs and an unadvanced fleet generation. |

## Audit Retention and Path Policy

- **Path**: Located at `idle-suspend-audit.jsonl` adjacent to the canonical server configuration directory.
- **Permissions**: Created with mode `0600` (read/write by server process owner only), opened with `O_NOFOLLOW` on Unix.
- **Retention**: Bounded to the most recent 10,000 records.
- **Audited Events**:
  - `admitted`: Timing update validated and admitted before disk write.
  - `committed`: Timing update persisted atomically to the canonical registry file.
  - `persistence_failed`: Atomic replacement failed; runtime state retained.
  - `rejected_handoff_in_progress`: Timing change rejected due to active suspend handoff (409).
  - `rejected_disabled`: Timing change rejected because feature is disabled at startup.

## Approval Gates for Privileged Execution (Phase 03)

Implementation of Phase 03 (privileged systemd helper and unit enrollment) remains **strictly blocked** until explicit operator and security-owner sign-off:
- Review of systemd service unit hardening (`NoNewPrivileges=yes`, `ProtectSystem=strict`).
- Review of Unix domain socket permissions and peer credentials verification (`SO_PEERCRED`).
- Final sign-off on host inhibitor policies and RTC alarm support matrix.
