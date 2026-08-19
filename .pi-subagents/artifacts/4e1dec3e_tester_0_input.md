# Task for tester

Analyze the remaining Phase 04 acceptance gaps and propose the smallest real Rust tests that can run on this Windows host. Focus on proving (a) a manager-owned loopback listener becomes unreachable after stop/dispose within 5 seconds, and (b) shutdown coordinator close/exit handling is one-shot and bounded without requiring a real WebView. Inspect existing tests and Tauri 2.11.5 APIs. Do not edit files. Environment: Windows 11 x64, Rust/Cargo stable 1.96, cwd G:\ws\sharing\dam-hopper, branch features/ssh-port-forwarding-control. Return concrete test design and limitations.

## Subagent: tester
ID: evcrate-node-0-e477ea9b-e693-41e6-ad4e-c2cb15720ba3 | CWD: G:/ws/sharing/dam-hopper

## Context
- Plan: none
- Reports: G:\ws\sharing\dam-hopper\plans\reports
- Paths: G:\ws\sharing\dam-hopper\plans/ | G:\ws\sharing\dam-hopper\docs/

## Rules
- Reports → G:\ws\sharing\dam-hopper\plans\reports
- YAGNI / KISS / DRY
- Concise, list unresolved Qs at end

## Naming
- Report: G:\ws\sharing\dam-hopper\plans\reports\tester-260814-1002-{slug}.md
- Plan dir: G:\ws\sharing\dam-hopper\plans\260814-1002-{slug}/

Active workflow root: C:\Users\loidi\.pi\agent\evcrate\workflows

Active config root: C:\Users\loidi\.pi

Active resource root: C:\Users\loidi\.pi\agent\evcrate