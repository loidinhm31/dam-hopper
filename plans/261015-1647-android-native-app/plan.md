---
title: "Android-first native workbench in native-app"
description: "Build a native Android TERMINAL/Traditional workbench with one panel-navigation row, no floating buttons, and explicit HTML/Mermaid preview exceptions."
status: in-progress
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, auth]
created: 2026-10-15
---

# Android Native App — Implementation Plan

**Planning only; no app implementation.** Root: `native-app/`; Kotlin/Compose shared state + native Android widgets. Remote existing Rust server. Android10+/minSdk29, ARM64 device+x86_64 emulator, signed private APK. No Tauri/WebView/browser engine or local PTY/Git/agents.

User approved all current non-browser workbench families. Embedded interactive HTML and rendered Mermaid browser previews alone are deferred for this release; remaining editor/language/diff/merge/blame/encrypted-save parity stays mandatory. Desktop implementation/Play/browser debug/local SSH forwarding are excluded; existing web/Tauri hosts remain.

**Workspace restriction:** TERMINAL mode + Traditional terminal only; no IDE/Runtime mode or mode switchers. All included panels use one horizontally scrollable, single-line button row; no floating buttons/FABs or second navigation surface.

## Workspace and handoff

- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-android-native-app`; branch above. Base: `d897a91f76a07ec819a50ffc2756cb69327b2fe3` (server0.13.2/protocol2 baseline). Original checkout changes untouched.
- [User decisions](./research/decision-context.md) · [proposed architecture](../../docs/architecture/android-native-client.md) · [scope/acceptance ledger](./scope-and-acceptance.md).
- [Contracts/modules](./contracts-and-modules.md) · [execution guide and dependency graph](./execution-guide.md) · [Android research](./research/android-platform-research.md) · [extended contracts](./research/extended-workbench-contracts.md).
- Phase 01 completed 2026-10-15 19:51:53 +07:00; Phase 02 pending. Native dependency/editor-service/crypto gates precede dependent implementation. Pass this explicit plan path to later agents; active-plan helper could not persist without EVCRATE_SESSION_ID.

## Phases

| # | Phase | Status | Progress | Depends on |
| --- | --- | --- | --- | --- |
| 01 | [Scope baseline and contract freeze](./phase-01-scope-baseline-and-contract-freeze.md) | completed (2026-10-15 19:51 +07:00) | 100% | — |
| 02 | [Gradle KMP Android foundation](./phase-02-gradle-kmp-android-foundation.md) | pending | 0% | 01 |
| 03 | [Contracts ownership and live transport](./phase-03-contracts-ownership-and-live-transport.md) | pending | 0% | 02 |
| 04 | [Profiles authentication MFA and credential vault](./phase-04-profiles-auth-mfa-and-credential-vault.md) | pending | 0% | 03 |
| 05 | [Native terminal editor and crypto proof gates](./phase-05-native-terminal-editor-and-crypto-proof-gates.md) | pending | 0% | 04 |
| 06 | [TERMINAL Traditional shell projects and configuration](./phase-06-adaptive-shell-projects-worktrees-and-config.md) | pending | 0% | 04 |
| 07 | [Terminal sessions replay input and agents](./phase-07-terminal-sessions-replay-input-and-agents.md) | pending | 0% | 05, 06 |
| 08 | [Filesystem watchers search and replace](./phase-08-filesystem-watchers-search-and-replace.md) | pending | 0% | 06 |
| 09 | [Native editor language services and safe saves](./phase-09-native-editor-language-services-and-safe-saves.md) | pending | 0% | 05, 08 |
| 10 | [Native diff merge and blame](./phase-10-native-diff-merge-and-blame.md) | pending | 0% | 09 |
| 11 | [Encrypted transfers media and Android storage](./phase-11-encrypted-transfers-media-and-storage.md) | pending | 0% | 05, 09 |
| 12 | [Complete Git and safe history workflows](./phase-12-complete-git-and-safe-history-workflows.md) | pending | 0% | 06, 10 |
| 13 | [Workflow tracking and project plans](./phase-13-workflow-tracking-and-project-plans.md) | pending | 0% | 07, 09 |
| 14 | [Agent Store imports and memory](./phase-14-agent-store-imports-and-memory.md) | pending | 0% | 09 |
| 15 | [Host resources fleet and usage](./phase-15-host-resources-fleet-and-usage.md) | pending | 0% | 06 |
| 16 | [Ports tunnels idle consent and host controls](./phase-16-ports-tunnels-idle-consent-and-host-controls.md) | pending | 0% | 06 |
| 17 | [Preferences privacy notifications and lifecycle](./phase-17-preferences-privacy-notifications-and-lifecycle.md) | pending | 0% | 07, 11, 13, 14, 15, 16 |
| 18 | [Integrated device security and performance qualification](./phase-18-integrated-device-security-and-performance-qualification.md) | pending | 0% | 12, 17 |
| 19 | [Signed APK release and operational handoff](./phase-19-signed-apk-release-and-operational-handoff.md) | pending | 0% | 18 |

## Release gates

- **A /01–02:** complete source/behavior/device/server ledger and reproducible compatible toolchain/app launch.
- **B /05:** actual native terminal/IME/replay, retained editor/language-service path and exact OPAQUE ABI/interop proof. No fake fallback or silent parity reduction.
- **C /18:** every included ledger row passes real authenticated-server/native-device acceptance, security/ABI/performance and human visual review.
- **D /19:** signed release install/upgrade, licenses/provenance/docs and unchanged existing-product safety gates.

## Unresolved decisions and stop rules

Exact dependency pins/licenses, native JSON/TS realization, crypto ABI proof and named-hardware budgets are Phase01–05 deliverables, not presumed facts. Failed retained requirements block dependents/release until design resolution or explicit user scope change. No new server LSP/render service/updater/privileged executor assumed. Future browser-preview parity and Linux/Windows releases need separate decisions.

## Validation Summary

**Validated:** 2026-10-15. **Questions asked:** 4. [Binding answers](./validation-answers.md).
- TERMINAL + Traditional only; one panel-navigation row; no floating buttons or alternative modes.
- Row docked at top below server/project header; icon + short text buttons; horizontal scrolling, no wrapping/More menu.
- Row stays visible while software keyboard is open.
- One content area on phones, tablets and foldables; selected panel replaces terminal visually while controllers/sessions stay alive. No wide-screen terminal/panel docking.
- [x] Record scope restriction and presentation decisions in plan/design/acceptance artifacts.
- [ ] Resolve Phase01–05 dependency/language-service/crypto/device gates before dependent implementation; no implementation started.

## Phase 01 Completion Record

- **Completed:** 2026-10-15 19:51:53 +07:00
- **Status:** 100% complete
- **Validation:** User-approved review score 9.5/10; 4/4 test suites passed per assignment record. Documentation baseline and contract freeze completed; no native runtime qualification claimed.
- **Deliverables:** Baseline documentation and contract freeze recorded in `docs/android-native-acceptance.md`, `native-app/README.md`, and `docs/system-architecture.md`.
- **Handoff:** Phase 01 scope baseline and contract freeze complete. Phase 02 (Gradle KMP Android foundation) is pending and unblocked for project setup.
