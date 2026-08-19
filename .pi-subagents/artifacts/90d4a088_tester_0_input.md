# Task for tester

Environment: Windows 11, CWD G:/ws/sharing/dam-hopper, timezone Asia/Bangkok. Validate Phase 05 native SSH forwarding host/context adapter only; do not edit files or plan docs. Run the mandatory focused and full checks as practical: pnpm --filter @dam-hopper/ui test, pnpm --filter @dam-hopper/native test, pnpm --filter @dam-hopper/ui build, pnpm --filter @dam-hopper/native build, pnpm lint, git diff --check. Rust static checks if feasible: cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml --check, cargo check, clippy -D warnings. Distinguish Phase 04 Windows runtime blocker (0xc0000139) and do not chase it. Report exact commands/results, changed files (should be none), residual risks, unresolved questions last.

## Subagent: tester
ID: evcrate-node-0-3e78039d-ecfa-4524-8f77-3c095888908f | CWD: G:/ws/sharing/dam-hopper

## Context
- Plan: none
- Reports: G:\ws\sharing\dam-hopper\plans\reports
- Paths: G:\ws\sharing\dam-hopper\plans/ | G:\ws\sharing\dam-hopper\docs/

## Rules
- Reports → G:\ws\sharing\dam-hopper\plans\reports
- YAGNI / KISS / DRY
- Concise, list unresolved Qs at end

## Naming
- Report: G:\ws\sharing\dam-hopper\plans\reports\tester-260813-2039-{slug}.md
- Plan dir: G:\ws\sharing\dam-hopper\plans\260813-2039-{slug}/

Active workflow root: C:\Users\loidi\.pi\agent\evcrate\workflows

Active config root: C:\Users\loidi\.pi

Active resource root: C:\Users\loidi\.pi\agent\evcrate