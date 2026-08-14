# Task for code-reviewer

Environment: Windows 11, CWD G:/ws/sharing/dam-hopper, timezone Asia/Bangkok. Perform the one final independent acceptance review for Phase 05 SSH forwarding host/context/native adapter. Do not edit files or plan docs. Inspect current working tree and specifically verify: (1) hook consumes adapter event.snapshot without duplicate snapshot IPC while preserving fallback hosts, (2) strict DTO/error/timestamp/context validation, (3) stale activation/command response gates and no mutation replay after MANAGER_SESSION_MISMATCH, (4) hint freshness/coalescing, (5) scope deletion deactivation-before-purge and unavailable inventory behavior, (6) Windows-only factory/capability behavior, (7) Rust IPC/error parity and tests. Validation already observed: UI 169 files/981 tests pass, native 2 files/17 tests pass, UI/native builds pass, lint 0 errors/0 warnings after test cleanup, cargo fmt/check/clippy -D warnings pass, git diff --check pass. Root pnpm test has unrelated existing Rust windows_by_handle E0658; Phase 04 native runtime remains blocked by STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139. Return terminal score, critical findings, warnings, files reviewed, validation, recommendation, residual risks, unresolved questions last.

## Subagent: code-reviewer
ID: evcrate-node-0-efdfbdf2-1d3d-4895-b01f-e374a20f5f5f | CWD: G:/ws/sharing/dam-hopper

## Context
- Plan: none
- Reports: G:\ws\sharing\dam-hopper\plans\reports
- Paths: G:\ws\sharing\dam-hopper\plans/ | G:\ws\sharing\dam-hopper\docs/

## Rules
- Reports → G:\ws\sharing\dam-hopper\plans\reports
- YAGNI / KISS / DRY
- Concise, list unresolved Qs at end

## Naming
- Report: G:\ws\sharing\dam-hopper\plans\reports\code-reviewer-260813-2044-{slug}.md
- Plan dir: G:\ws\sharing\dam-hopper\plans\260813-2044-{slug}/

Active workflow root: C:\Users\loidi\.pi\agent\evcrate\workflows

Active config root: C:\Users\loidi\.pi

Active resource root: C:\Users\loidi\.pi\agent\evcrate