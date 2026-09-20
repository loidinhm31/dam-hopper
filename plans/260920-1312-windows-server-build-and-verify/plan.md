---
title: "Windows dam-hopper-server build and verification"
description: "Normalize Windows paths, make the Rust test harness platform-safe, and qualify dam-hopper-server build, startup, and documentation on MSVC."
status: in-progress
priority: P1
effort: 9h
branch: main
tags: [bugfix, backend, rust, windows, testing, docs]
created: 2026-09-20
---

# Windows dam-hopper-server build and verification

## Overview

Make the already-target-gated `dam-hopper-server` implementation reproducible on Windows 11 MSVC. Normalize path identity and TOML round-trips, remove POSIX assumptions from cross-platform tests, gate host-specific tests, then run a full Windows build/test/startup gate and document the supported commands. Linux release, sysfs, procfs, systemd, and Unix-shell behavior remain unchanged.

Primary evidence:

- [Scout inventory](../reports/scout-260919-2248-windows-codebase-locations.md): exact callers, path helpers, PTY assumptions, and platform-sensitive tests.
- [Windows compiler diagnosis](../reports/debugger-260919-2248-windows-build-errors.md): original 180-error failure boundary.
- [Windows verification](../reports/tester-260919-2248-windows-test-report.md): current targeted proof (127 passed, 2 ignored), but not a full-suite gate.
- [Code review](../reports/code-reviewer-260919-2248-windows-fix-review.md): confirms build/startup behavior and remaining cross-platform test/script risks.

## Status

- **Plan:** IN PROGRESS (2/3 phases complete; 67%; updated 2026-09-20 17:15:00 +07:00).
- **Phase 01:** DONE (2026-09-20 16:18:03 +07:00; 100%; 2.5/2.5h). Focused Windows MSVC path/config tests passed 128/128; code review approved 9.2/10 with warnings recorded in the review report.
- **Phase 02:** DONE (2026-09-20 17:15:00 +07:00; 100%; 3.5/3.5h). Test harness and platform gating verified; 978 passed, 0 failed, 3 ignored; code review approved 9.5/10. See the [tester report](../reports/tester-260920-1707-phase02-windows-test-harness.md) and [code review](../reports/code-review-260920-1710-phase02-test-harness-and-platform-gating.md).
- **Phase 03:** Pending — server build, verification, and documentation.


## Preflight Contract

1. Target `x86_64-pc-windows-msvc`, Windows 11; use real `cmd.exe`/PowerShell, not Bash-only syntax.
2. Preserve API/serde/TOML field names, workspace-target authorization, PTY lifecycle, Linux release/idle-suspend semantics, and fail-closed non-Linux behavior.
3. Treat `dunce::canonicalize` plus one path-identity normalizer as the only comparison/serialization boundary; never broaden sandbox containment.
4. Scope Git line-ending configuration to temporary test repositories; never mutate user/global Git config.
5. Run Windows tests serially (`cargo test ... -j 1`); Linux sysfs/block-device/diagnostic tests remain `cfg(target_os = "linux")` and are not counted as Windows evidence.
6. Record command, target, pass/fail/ignored counts, health response, and cleanup; no `tee`, scratch logs, secrets, or host-power operations.

## Phases

| # | Phase | Goal | Status | Effort |
|---|---|---|---|---:|
| 01 | [Path and config normalization](./phase-01-path-and-config-normalization.md) | Canonical Windows paths, UNC handling, valid TOML, slash-stable target identity | DONE (2026-09-20 16:18:03 +07:00; 100%) | 2.5h |
| 02 | [Test harness and platform gating](./phase-02-test-harness-and-platform-gating.md) | Cmd-safe PTY tests, CRLF-stable Git tests, Linux-only gates, path assertions | DONE (2026-09-20 17:15:00 +07:00; 100%) | 3.5h |
| 03 | [Server build, verification, and documentation](./phase-03-server-build-and-verification.md) | Default binary, full Windows qualification, live health smoke, docs | Pending | 3h |

## Side-Effect Review Checklist

- [x] Linux implementation files and Linux-only assertions unchanged except explicit gates.
- [x] Config writes preserve project meaning, reject traversal, and retain absolute paths.
- [x] Test shell/Git changes are test-only and temporary-resource scoped.
- [x] Windows never binds Unix helper sockets, probes sysfs, or attempts suspend.
- [ ] Startup smoke uses loopback/no-auth only and terminates the child cleanly.
- [ ] Documentation reports only observed Windows evidence; ignored Linux tests stay visible.
- [ ] No generated logs, credentials, or build artifacts added to the tree.

## Dependencies and unresolved questions

Phase 01 precedes Phase 02; Phase 03 consumes both. No product decision is blocking. Future native Windows host metrics or suspend support remains out of scope; Windows reports explicit unsupported/unavailable behavior.
