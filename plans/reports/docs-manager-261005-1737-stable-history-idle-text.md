# Stable History, Idle-Suspend, and Activity Documentation Report

## Executive Summary

- **Assignment Scope:** Owned exclusively 8 documentation files:
  - `docs/CHANGELOG-archive.md`
  - `docs/archive/retired-plugin-platform.md`
  - `docs/agent-activity-automatic-admission.md`
  - `docs/agent-activity-process-discovery.md`
  - `docs/idle-suspend-status-ui.md`
  - `docs/pty-activity-observation.md`
  - `docs/tcp-activity-observation.md`
  - `docs/terminal-idle-suspend-security.md`
- **Goal:** Thoroughly eliminate all numbered development 'phase', 'plan', and `plans/` terminology across owned documents, replacing developmental labels with canonical subsystem names ('PTY evidence', 'process discovery', 'TCP observer', 'transactional sampler', 'helper execution', 'managed service enrollment', 'status decoder', 'diagnostics', 'verification').
- **Integrity & Constraints:** Retained exact security bounds, privacy/TOCTOU constraints, canary gates, qualified-version/date boundaries, and historical validation metrics. Preserved genuine runtime Workflow entity terms (`Plan`, `Phase`, `Task`) in changelog entries. Removed orphan boilerplate ("Historical plan archived/source unavailable") and obsolete execution progress narrations. Ensured all files remain strictly under the 800 LOC limit.

## Subsystem Refactoring & Technical Invariants

1. **Subsystem Wording Cutover:**
   - **PTY Evidence:** Replaced "Phase 02" references with "PTY evidence seam" and "PTY evidence observation". Maintained private, content-free capture, raw read counters, saturating `u64::MAX`, and input admission revision gates.
   - **Process Discovery:** Replaced "Phase 03" references with "process discovery". Preserved 256 live roots, 8,192 scanned processes, 1,024 relevant processes, 4,096 FDs, 8,192 socket inodes, and 16 KiB command line bounds, exact `(pid, start_ticks)` attribution, finite interpreter grammar, and fail-closed handling.
   - **TCP Observer:** Replaced "Phase 04" references with "TCP observer". Preserved unprivileged `NETLINK_SOCK_DIAG` socket diagnostics, 208-byte `tcp_info` prefix checks, persistent namespace/family/cookie keying, and transactional prepare/commit.
   - **Transactional Sampler & Automatic Admission:** Replaced "Phase 05" references with "transactional sampler" and "automatic admission". Preserved dedicated joinable sampler thread, manager-locked admission gates, generation fences, quiet deadline expiry, and opaque final admission tickets.
   - **Protected Status Decoder & Browser UI:** Replaced "Phase 06" references with "status decoder" and protected status presentation. Preserved version-1 authenticated no-store DTO, fail-closed decoder normalization, 32-entry bounded PID/safe-identity examples, and `armDeadlineMs` countdown.
   - **Helper Execution & Managed Service Enrollment:** Replaced "Phase 01" / "Phase 03" / "Phase 04" privileged helper references with "helper execution", "managed service enrollment", and "helper execution audit v2". Preserved `SO_PEERCRED` checks, systemd MainPID verification, `0640` PID file umask, and exclusive `rtc0` ownership.
   - **Integrated Qualification & Canary Verification:** Replaced "Phase 07" / "Phase 08" references with "integrated qualification" and "canary verification". Maintained the operational requirement that real-host automatic suspend canary remains an Operations-supervised deployment gate with host qualification, exclusive RTC ownership, and bounded wake.

2. **Changelog Archive Sanitization:**
   - Stripped all orphan "Historical plan archived" and "Historical plan source unavailable" text.
   - Refactored development milestone labels (`Phases 01–04`, `Phases 01–03`, `Phase 07`, `Phase 04`, `Phase 03`, `Phase 02`, `Phase 6`) into descriptive technical features.
   - Rephrased protocol wording (`3-phase WebSocket write protocol` -> `Three-step WebSocket write protocol`).
   - Rephrased unreleased milestone tag (`Unreleased (before Phase 01)` -> `Unreleased (Initial Development)`).
   - Preserved only true Workflow runtime entities (`Plan`, `Phase`, `Task` models and hierarchy).

3. **Retired Plugin Platform Archive:**
   - Replaced development labels `Phase D00` through `Phase D05` with concise functional descriptors (`SDK foundation`, `Package manifest`, `Socket protocol`, `Isolated UI bridge`, `Host management endpoints`).

## Changed Files Inventory

### 1. `docs/CHANGELOG-archive.md` (539 LOC)
- Replaced development phase progress narration at line 19 with rollout status.
- Replaced "Phase 07" observer qualification references with integrated verification work.
- Removed pending phase progression boilerplate from PTY, process discovery, TCP, and helper validation entries.
- Rephrased CLI deployment setup heading and validation to remove phase milestone numbers.
- Maintained genuine runtime Workflow entities (`Plan`, `Phase`, `Task` items, hierarchy, and context surface) across 8 specific lines.
- Replaced "Phase 03 review reports" with "Workflow service review reports", "Targeted Phase 04 UI tests" with "Targeted workflow client UI tests", and "Phase 05 / Phase 07" with "workflow surface / subsequent integration".
- Removed phase labels from Explorer tree store, editor view state persistence, SSH Windows gate, host restoration alerts, embedded browser, and worktree target lifecycle.
- Removed all orphan "Historical plan archived/source unavailable" statements.
- Rephrased "3-phase WebSocket write protocol" to "Three-step WebSocket write protocol".
- Updated "Unreleased (before Phase 01)" to "Unreleased (Initial Development)".

### 2. `docs/archive/retired-plugin-platform.md` (58 LOC)
- Refactored `Phase D00`–`Phase D05` labels in section 2.1 into concise functionality descriptors.
- Zero phase/plan occurrences remain.

### 3. `docs/agent-activity-automatic-admission.md` (321 LOC)
- Updated Status line to "Integrated qualification complete (2026-09-11)".
- Replaced "Phase 05 consumer" with "transactional sampler consumer".
- Renamed heading `## Phase 07 integrated qualification` to `## Integrated qualification` and updated introductory sentence.
- Zero phase/plan occurrences remain.

### 4. `docs/agent-activity-process-discovery.md` (215 LOC)
- Replaced Phase 02/03/04/05 flow text with "PTY evidence observation", "process discovery", "TCP observer", and "transactional sampler and admission layer".
- Replaced "Phase 01's borrowed, already-validated literal set" with "borrowed, already-validated literal set".
- Replaced "Phase 03 plan" with "process discovery specification".
- Replaced "part of this phase" with "part of process discovery".
- Replaced "Focused implementation commands from the phase plan" with "Focused implementation commands for process discovery".
- Zero phase/plan occurrences remain.

### 5. `docs/idle-suspend-status-ui.md` (168 LOC)
- Updated Status to "Integrated qualification complete (2026-09-11)".
- Updated Implementation Scope to remove Phase 06 label.
- Refactored verification headings: "Phase 06 targeted proof" -> "Status decoder targeted proof", "Phase 07 integrated qualification" -> "Integrated qualification".
- Zero phase/plan occurrences remain.

### 6. `docs/pty-activity-observation.md` (262 LOC)
- Updated Status to "PTY evidence seam implemented 2026-09-11".
- Replaced Phase 02/03/04/05 flow text with "PTY evidence seam", "process discovery", "TCP observer", and "transactional sampler".
- Replaced Phase 02 writer serialization, reporting phases, and verification references with "PTY evidence seam" and "PTY evidence report".
- Zero phase/plan occurrences remain.

### 7. `docs/tcp-activity-observation.md` (236 LOC)
- Updated Status to "TCP observer implemented 2026-09-11".
- Replaced Phase 03/04/05 references in namespace fencing, observation flow, and diagram with "process discovery", "TCP observer", and "transactional sampler".
- Updated related documentation links to refer to automatic admission guide, process discovery roots, PTY evidence root, and transactional sampler.
- Zero phase/plan occurrences remain.

### 8. `docs/terminal-idle-suspend-security.md` (587 LOC)
- Replaced "manual force-sleep plan" and "Phase 01 through Phase 08" overview text with "manual force-sleep implementation" and "idle-suspend subsystems".
- Refactored headings across semantic event writer, helper execution audit v2, execution domain safeguards, managed service enrollment PID, force-suspend coordinator status, PTY evidence observation, process discovery, TCP observer, CLI helper approval gates, release-manager integration, transactional sampler admission, protected status decoder, integrated qualification, and canary verification boundaries.
- Preserved exact code test file path `server/tests/idle_suspend_phase07.rs` as required for real source symbol/file names.
- Zero whole-word phase/plan occurrences remain outside the literal test filename.

## Exception Inventory

The following 8 lines in `docs/CHANGELOG-archive.md` contain occurrences of `Plan` or `Phase` that are retained exclusively as genuine runtime Workflow entity terms:

1. **Line 73:** `- **Plan item notes and editing.** Restored selected Plan item note rendering...`  
   *Reason:* Refers to the `Plan item` entity in the DamHopper Workflow data model.
2. **Line 122:** `Plan/Phase/Task items, manual sessions, terminal/agent resource links,`  
   *Reason:* Exact domain entity hierarchy types (`Plan`, `Phase`, `Task`) defined in the workflow tracking domain.
3. **Line 129:** `transitions, and the Plan-first hierarchy (Plan root → Phase → Task, with`  
   *Reason:* Exact runtime Workflow entity hierarchy definition.
4. **Line 130:** `standalone or Plan-level tasks).`  
   *Reason:* Refers to `Plan-level` tasks in the runtime Workflow hierarchy.
5. **Line 142:** `overview/history, Plan-first item CRUD, manual session lifecycle,`  
   *Reason:* Refers to `Plan-first item` CRUD operations in the Workflow REST API.
6. **Line 167:** `observation endpoint was added. Direct Plan sessions do not synthesize`  
   *Reason:* Refers to direct `Plan sessions` in the Workflow service runtime.
7. **Line 168:** `Phase/Task children.`  
   *Reason:* Refers to `Phase/Task` child items under a Plan in the Workflow runtime.
8. **Line 173:** `- **Responsive workflow context surface.** Added the Plan-first ambient context ribbon, responsive desktop deck, mobile segmented safe-area sheet, optional Phase/Task capture...`  
   *Reason:* Refers to the runtime UI surface capturing `Plan-first` and `Phase/Task` entities.

Literal source filename exception in `docs/terminal-idle-suspend-security.md`:
- **Line 566:** `server/tests/idle_suspend_phase07.rs`  
  *Reason:* Exact Rust integration test file path in the repository; source paths containing substrings must not be altered.

## Heading Rename Map Sent to Main

```text
agent-activity-automatic-admission.md: ## Phase 07 integrated qualification -> ## Integrated qualification (#integrated-qualification)
idle-suspend-status-ui.md: Phase 06 targeted proof (all passed): -> Status decoder targeted proof (all passed):
idle-suspend-status-ui.md: Phase 07 integrated qualification (all passed): -> Integrated qualification (all passed):
terminal-idle-suspend-security.md: ### Phases 02–03 canonical semantic event writer and coordinator emission -> ### Canonical semantic event writer and coordinator emission (#canonical-semantic-event-writer-and-coordinator-emission)
terminal-idle-suspend-security.md: ### Phase 04 helper audit v2 and milestone ordering (2026-09-13) -> ### Helper execution audit v2 and milestone ordering (2026-09-13) (#helper-execution-audit-v2-and-milestone-ordering-2026-09-13)
terminal-idle-suspend-security.md: ### Phase 01 execution-domain safeguards -> ### Helper execution domain safeguards (#helper-execution-domain-safeguards)
terminal-idle-suspend-security.md: ### Phase 01 status (2026-09-06) -> ### Helper execution status (2026-09-06) (#helper-execution-status-2026-09-06)
terminal-idle-suspend-security.md: ### Phase 01 systemd PID enrollment and runtime permissions — DONE (2026-09-09) -> ### Managed service enrollment PID and runtime permissions — DONE (2026-09-09) (#managed-service-enrollment-pid-and-runtime-permissions--done-2026-09-09)
terminal-idle-suspend-security.md: ### Phase 02 status (2026-09-06) -> ### Force-suspend coordinator status (2026-09-06) (#force-suspend-coordinator-status-2026-09-06)
terminal-idle-suspend-security.md: ### Configured-agent PTY observation — Phase 02 (2026-09-11) -> ### Configured-agent PTY evidence observation (2026-09-11) (#configured-agent-pty-evidence-observation-2026-09-11)
terminal-idle-suspend-security.md: ### Configured-agent process discovery — Phase 03 (2026-09-11) -> ### Configured-agent process discovery (2026-09-11) (#configured-agent-process-discovery-2026-09-11)
terminal-idle-suspend-security.md: ### Configured-agent owned TCP observation — Phase 04 (2026-09-11) -> ### Configured-agent owned TCP observer (2026-09-11) (#configured-agent-owned-tcp-observer-2026-09-11)
terminal-idle-suspend-security.md: ## Approval Gates for Privileged Execution (Production CLI Phase 03) — Approved (2026-09-05) -> ## Approval Gates for Privileged Execution (Production CLI helper execution) — Approved (2026-09-05) (#approval-gates-for-privileged-execution-production-cli-helper-execution--approved-2026-09-05)
terminal-idle-suspend-security.md: ### Release-manager staging integration (Phase 02) -> ### Release-manager staging integration (#release-manager-staging-integration)
terminal-idle-suspend-security.md: ### Release-manager lifecycle integration (Production CLI Phase 03, 2026-09-10) -> ### Release-manager lifecycle integration (managed service enrollment, 2026-09-10) (#release-manager-lifecycle-integration-managed-service-enrollment-2026-09-10)
terminal-idle-suspend-security.md: ### Configured-agent automatic admission Phase 05 status (2026-09-11) -> ### Configured-agent transactional sampler automatic admission status (2026-09-11) (#configured-agent-transactional-sampler-automatic-admission-status-2026-09-11)
terminal-idle-suspend-security.md: ### Protected status and browser UI Phase 06 (2026-09-11) -> ### Protected status decoder and browser UI (2026-09-11) (#protected-status-decoder-and-browser-ui-2026-09-11)
terminal-idle-suspend-security.md: ### Configured-agent activity integrated qualification and host gate — Phase 07 (2026-09-11) -> ### Configured-agent activity integrated qualification and host gate (2026-09-11) (#configured-agent-activity-integrated-qualification-and-host-gate-2026-09-11)
terminal-idle-suspend-security.md: ### Configured-agent observation security, privacy, and canary boundaries — Phase 08 (2026-09-11) -> ### Configured-agent observation security, privacy, and canary boundaries (2026-09-11) (#configured-agent-observation-security-privacy-and-canary-boundaries-2026-09-11)
terminal-idle-suspend-security.md: ### Production idle-suspend diagnostics security, privacy, and AI-attachment boundaries — Phase 07 (2026-09-14) -> ### Production idle-suspend diagnostics security, privacy, and AI-attachment boundaries (2026-09-14) (#production-idle-suspend-diagnostics-security-privacy-and-ai-attachment-boundaries-2026-09-14)
CHANGELOG-archive.md: #### Unreleased (before Phase 01) -> #### Unreleased (Initial Development)
```

## Physical Line Count Verification

| File | Physical LOC | Limit | Status |
| --- | ---: | ---: | --- |
| `docs/CHANGELOG-archive.md` | 539 | 800 | OK |
| `docs/archive/retired-plugin-platform.md` | 58 | 800 | OK |
| `docs/agent-activity-automatic-admission.md` | 321 | 800 | OK |
| `docs/agent-activity-process-discovery.md` | 215 | 800 | OK |
| `docs/idle-suspend-status-ui.md` | 168 | 800 | OK |
| `docs/pty-activity-observation.md` | 262 | 800 | OK |
| `docs/tcp-activity-observation.md` | 236 | 800 | OK |
| `docs/terminal-idle-suspend-security.md` | 587 | 800 | OK |

All 8 files strictly comply with the 800 LOC cap.

## Verification & Grep Evidence

Execution of whole-word case-insensitive search for `\b(phases?|plans?)\b|plans/` across all 8 assigned files confirms:
- `docs/archive/retired-plugin-platform.md`: 0 matches
- `docs/agent-activity-automatic-admission.md`: 0 matches
- `docs/agent-activity-process-discovery.md`: 0 matches
- `docs/idle-suspend-status-ui.md`: 0 matches
- `docs/pty-activity-observation.md`: 0 matches
- `docs/tcp-activity-observation.md`: 0 matches
- `docs/terminal-idle-suspend-security.md`: 0 matches (excluding genuine test filename `server/tests/idle_suspend_phase07.rs`)
- `docs/CHANGELOG-archive.md`: Exactly 8 lines matching, each verifying as a genuine runtime Workflow model entity (`Plan`, `Phase`, `Task` items, hierarchy, and context surface).

Zero links or inline path dependencies on `plans/` exist in any owned document.

## Unresolved Questions

None. Operational prerequisites for the configured-agent automatic-suspend canary (host qualification, exclusive RTC ownership, system sleep inhibitor clearance, and physical/out-of-band power-cycle access) remain documented as deployment gates.
