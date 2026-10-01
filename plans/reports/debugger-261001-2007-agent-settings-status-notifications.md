# Diagnostic Report: Agent Settings Status-Only Observation & Notification Restrictions

**Report Path:** `plans/reports/debugger-261001-2007-agent-settings-status-notifications.md`  
**Date:** 2026-10-01  
**Target:** Investigate why after installing hooks for Codex or Claude in Agent Settings, the user sees:
> "Status-Only Observation: Codex native hooks track execution state (working/idle/unknown) only. Turn-ended alerts and attention notifications are not supported in this rollout."
and cannot use notifications for them.

---

## 1. Executive Summary

- **User Issue:** In the Agent Store page under the Agent Settings tab, after installing hooks for Codex or Claude, the user encounters the callout *"Status-Only Observation: Codex native hooks track execution state (working/idle/unknown) only. Turn-ended alerts and attention notifications are not supported in this rollout"* and cannot enable notifications.
- **Root Cause:**
  1. **UI Layout / Visual Confusion:** In `packages/ui/src/components/organisms/AgentSettings.tsx`, OMP, Codex, and Claude Code integrations are rendered sequentially in a single vertical page without sub-tabs. The *"Status-Only Observation"* callout is **statically and unconditionally rendered inside the Codex card** (`AgentSettings.tsx:721-732`). A user installing either Codex or Claude sees this warning prominently in the Codex section on the same screen.
  2. **Codex Notifications Disabled by Architectural Design:** In v0.8.0 (Phases 01–06), DamHopper removed the legacy OSC 9 PTY sequence listener and automatic Codex TUI notification settings writes. Codex CLI 0.158.0 native hooks (`Stop`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `Interrupt`) do not emit reliable turn completion (e.g., `Stop` is only a settle candidate invalidating certainty to `Unknown`) and emit no attention events. Codex is strictly status-only by design. Codex notification switches are hardcoded to `disabled={true}`, backend path verification returns `codex_can_enable: false`, and backend config persistence rejects any attempt to enable Codex notifications.
  3. **Claude Notification Restriction by Design:** Claude Code 2.1.250 hooks support only qualified needs-attention events (`approval`, `question`, `error`). Normal turn-ended notifications are intentionally unsupported because Claude's native `Stop` cannot prove an unobserved continuation will not occur.
  4. **Claude Enablement Blocked by Code Defect:** While Claude was designed to allow qualified attention notifications, the toggle in the UI is permanently disabled with the warning *"Notifications Unavailable for Claude: Claude native integration is not ready (unverified)"*. In `server/src/agent_status/claude_integration.rs:251`, `check_claude_status()` hardcodes `readiness: ManagedReadinessStatus::Unverified` even when installation status is `Current` and settings are verified. In `server/src/api/agent_status.rs:337` and `server/src/api/config.rs:428`, `claude_can_enable` strictly requires `report.readiness == ManagedReadinessStatus::Ready`. Because `ManagedReadinessStatus::Ready` is **never constructed or returned anywhere in the Rust backend for Claude**, `claude_can_enable` is permanently `false`. In unit tests (`AgentSettings.test.tsx`), `mockClaudeReport` was mocked as `readiness: "ready"`, masking this defect.

---

## 2. Technical Analysis

### A. UI Layout & Component Behavior (`AgentSettings.tsx` & `AgentStorePage.tsx`)

1. **Page Structure:**
   - In `packages/ui/src/components/pages/AgentStorePage.tsx`, the tab switcher provides four top-level tabs: `Store`, `Memory Files`, `Agent Settings`, and `Import`.
   - Selecting `Agent Settings` mounts `AgentSettings.tsx` (`packages/ui/src/components/organisms/AgentSettings.tsx`).
   - Inside `AgentSettings.tsx`, all agent configurations are rendered in a single vertical stack:
     - Lines 367–412: Overview Banner & Path Verification trigger
     - Lines 415–633: Section 1 — Oh My Pi (OMP) Integration & Notifications
     - Lines 636–837: Section 2 — Codex Configuration & Status Hooks
     - Lines 840–1062: Section 3 — Claude Code Integration & Notifications
     - Lines 1065–1100: Section 4 — Browser Notification Permissions

2. **The Codex "Status-Only Observation" Callout:**
   - Lines 721–732 in `AgentSettings.tsx`:
     ```tsx
     {/* Status-Only Capability Callout */}
     <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300 flex items-start gap-2">
       <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
       <div className="flex-1">
         <p className="font-semibold text-amber-200">
           Status-Only Observation
         </p>
         <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">
           Codex native hooks track execution state (working/idle/unknown) only. Turn-ended alerts and attention notifications are not supported in this rollout.
         </p>
       </div>
     </div>
     ```
   - **Static Nature:** This element is completely static. It does not inspect `codexReport?.status`, `codexReport?.readiness`, or `verification?.codexCanEnable`. It is permanently rendered in the Codex card regardless of whether hooks are installed or absent.
   - **Notification Switches Disabled:** Lines 780–835 hardcode `disabled={true}` and `checked={false}` for "Enable Codex notifications", "In-app toast" (`disabled={true}`), "Browser popup" (`disabled={true}`), and `TerminalNotificationSoundControls` (`masterEnabled={false}`).

3. **The Claude Code Section:**
   - Lines 925–936 contain Claude's static capability disclosure:
     ```tsx
     {/* Attention-Only Capability Callout */}
     <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-300 flex items-start gap-2">
       <ShieldCheck className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
       <div className="flex-1">
         <p className="font-semibold text-sky-200">
           Qualified Attention Only
         </p>
         <p className="text-[11px] text-sky-300/90 mt-0.5 leading-relaxed">
           Claude Code native hooks report status and qualified attention events (approval requested, question pending, agent error). Normal turn-ended alerts are not supported.
         </p>
       </div>
     </div>
     ```
   - Lines 984–1014 gate the Claude notification toggle behind `verification?.claudeCanEnable`:
     ```tsx
     {!verification?.claudeCanEnable && (
       <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
         <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
         <div>
           <p className="font-semibold text-amber-200">
             Notifications Unavailable for Claude
           </p>
           <p className="text-[11px] text-amber-300/90 mt-0.5">
             {verification?.claudeReason ||
               "Install path and runtime path must match and native hooks must be Ready before notifications can be enabled."}
           </p>
         </div>
       </div>
     )}
     ```
     `Switch` has `disabled={!verification?.claudeCanEnable}`.

---

### B. Backend Path Verification & Readiness Inspection

1. **Path Verification API (`server/src/api/agent_status.rs`):**
   - **OMP (`omp_can_enable`):** Computed at lines 220–248. Checks if configured directory matches notification runtime directory and `check_extension_status` returns `ManagedExtensionStatus::Current`. If both hold, `omp_can_enable: true`.
   - **Codex (`codex_can_enable`):** Computed at lines 267–300.
     - Checks if paths match and `config.toml` or `hooks.json` exists.
     - Even when valid and matching, lines 294–298 hardcode:
       ```rust
       (
           true,
           false, // codex_can_enable is unconditionally false!
           Some("Codex native hooks track status only; terminal alert notifications are not supported in this rollout".to_string()),
       )
       ```
   - **Claude (`claude_can_enable`):** Computed at lines 319–357.
     ```rust
     let settings_file = claude_config_dir_buf.join("settings.json");
     let exists = settings_file.is_file();
     let paths_match = claude_config_dir_buf == claude_notification_dir_buf;
     if !paths_match {
         (exists, false, Some(format!("Configured Claude path ({}) does not match notification runtime path ({})", ...)))
     } else {
         match check_native_integration_status(AgentKind::Claude, &claude_config_dir_buf) {
             Ok(report) => {
                 if report.readiness == ManagedReadinessStatus::Ready {
                     (exists, true, None)
                 } else {
                     (
                         exists,
                         false,
                         Some(format!(
                             "Claude native integration is not ready ({})",
                             report.readiness
                         )),
                     )
                 }
             }
             Err(e) => (exists, false, Some(format!("Failed to verify Claude integration: {e}"))),
         }
     }
     ```

2. **Native Status Inspection (`server/src/agent_status/claude_integration.rs`):**
   - In `check_claude_status(agent_dir: &Path)`:
     - Checks launcher existence, manifest validity, hash integrity, binary existence, hook registrations in `settings.json`, policy flags (`disableAllHooks`, `allowManagedHooksOnly`), and executable permissions.
     - If all checks pass cleanly, lines 247–261 return:
       ```rust
       // Installed and current; readiness is Unverified until live qualified reporting occurs
       Ok(NativeIntegrationStatusReport {
           agent_kind: AgentKind::Claude,
           status: ManagedInstallationStatus::Current,
           readiness: ManagedReadinessStatus::Unverified, // <-- NEVER sets Ready!
           target_path: launcher_path.clone(),
           launcher_path,
           manifest_path,
           config_path: Some(settings_path),
           version: parsed_ver,
           bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
           content_hash: Some(actual_launcher_hash),
           bundled_hash,
           details: None,
       })
       ```
   - **Defect Verification:** Searching the entire Rust repository for `ManagedReadinessStatus::Ready` reveals it is **only checked** in `agent_status.rs:337` and `config.rs:428`, but **never constructed or returned** anywhere in `server/src/agent_status/`.

3. **Configuration Persistence Gate (`server/src/api/config.rs`):**
   - Lines 345–350:
     ```rust
     if ui.terminal_agent_notifications.agents.codex.enabled {
         return Err(AppError::Config(
             "Cannot enable Codex notifications: Codex provides status only in this rollout".to_string(),
         ));
     }
     ```
   - Lines 428–433:
     ```rust
     if report.readiness != crate::agent_status::ManagedReadinessStatus::Ready {
         return Err(AppError::Config(format!(
             "Cannot enable Claude notifications: native hook installation is not ready ({})",
             report.readiness
         )));
     }
     ```
   - Even if the frontend UI bypassed the disabled toggle, the server would reject saving `{ agents: { claude: { enabled: true } } }` with HTTP 400.

---

### C. Hook Event Capabilities & Notification Delivery

| Capability / Event | Oh My Pi (OMP) | Codex CLI (0.158.0) | Claude Code (2.1.250) |
|---|---|---|---|
| **Transport** | Persistent WebSocket to loopback listener (`/v1/agent-status`) | One-shot Unix domain socket (`/v1/agent-hooks`) | One-shot Unix domain socket (`/v1/agent-hooks`) |
| **Heartbeat / Lease** | 5s heartbeat, 15s lease | No heartbeat; 15s evidence lease per event | No heartbeat; 15s evidence lease per event |
| **Observed States** | `idle`, `working`, `blocked`, `unknown` | `idle`, `working`, `unknown` (`blocked` unsupported) | `idle`, `working`, `blocked`, `unknown` |
| **Turn Settle / Outcome** | Authoritative outcomes (`ended`, `interrupted`, `error`) | `Stop` is settle candidate only (invalidates to `Unknown`); `Interrupt` settles to `idle` with no completion alert | `Stop` is settle candidate only (invalidates to `Unknown`); no native `Interrupt` hook |
| **Attention / Blocker Events** | Tool approvals (`ask`), questions, errors | **None emitted** | `Notification(permission_prompt)` -> approval, `Notification(agent_needs_input)` -> question, `StopFailure` -> error |
| **Turn-Ended Alerts** | Supported (in-app toast, browser popup, sound) | **Unsupported** | **Unsupported** |
| **Notification Dispatcher Filter** (`terminal-agent-notification-integration.ts`) | Delivers `turn-ended` and `needs-attention` | Line 35: Drops all Codex events unconditionally (`if (row.agentKind === "codex") return;`) | Line 52: Drops normal turn-ended (`if (row.agentKind === "claude" && attention.kind !== "needs-attention") return;`) |

---

### D. Architectural Decision History (v0.8.0 Rollout)

1. **Why was OSC 9 Removed for Codex?**
   - In prior releases, DamHopper intercepted OSC 9 terminal escape sequences printed to stdout by Codex CLI and wrote to Codex's configuration files (`tui.notifications`, `notification_method=osc9`, `notification_condition=always`).
   - OSC 9 had severe architectural flaws:
     - Dependent on parsing raw PTY byte streams, causing terminal output corruption and escape sequence leakage.
     - Lacked process identity, terminal incarnation, or ownership fencing.
     - Could not provide semantic status (working vs blocked vs idle); only fired a completion alert.
     - Fired duplicate alerts when sessions resumed or subagents ran.
   - In v0.8.0, DamHopper cut over entirely to process-authenticated native hooks. As documented in `plans/260929-0140-agent-status-codex-claude/design-contract.md §5` and acceptance test scenario `N20`, OSC 9 was cleanly and permanently removed. No fallback was preserved.

2. **Why are Turn-Ended Notifications Unsupported for Codex and Claude Hooks?**
   - The native `Stop` hook in Codex and Claude does not guarantee that the turn is finished. Subagent tasks, tool continuations, or background reasoning can follow.
   - Emitting an alert on `Stop` would generate false completion notifications for work that was continuing.
   - DamHopper's core invariant is: *"No false completion from silence, reconnect, stale epoch, root shutdown, unsupported outcomes, missed events or crashes"* (`docs/architecture/agent-status.md:247`).
   - Therefore, `Stop` invalidates the active turn to `Unknown` instead of emitting completion attention.

---

## 3. Root Cause Synthesis

The user experience where notifications are disabled and the "Status-Only Observation" callout appears is caused by a combination of:

1. **Static UI Callout in Codex Card (UI Clarity Issue):**
   - The message observed by the user belongs exclusively to the Codex card in `AgentSettings.tsx:726-730`.
   - Because the Agent Settings page displays OMP, Codex, and Claude stacked in a single vertical column, a user who just installed Claude hooks reads the amber Codex banner immediately adjacent to Claude settings and concludes it applies to Claude or both agents.

2. **Codex Notifications Restricted by Design (Intentional Architecture):**
   - Codex CLI 0.158.0 native hooks track execution state only. They do not emit attention events or reliable turn-ended outcomes.
   - Disabling Codex notification switches (`disabled={true}`, `checked={false}`, `codex_can_enable = false`) is the deliberate, qualified design in v0.8.0.

3. **Claude Turn-Ended Notifications Restricted by Design (Intentional Architecture):**
   - Claude Code 2.1.250 hooks do not support normal turn-ended completion alerts. Only qualified attention events (approvals, questions, errors) are delivered.

4. **Claude Notification Toggle Blocked by Code Defect (Bug in Readiness State Machine):**
   - Claude was designed to allow users to enable qualified attention notifications.
   - However, `check_claude_status` in `server/src/agent_status/claude_integration.rs:251` returns `ManagedReadinessStatus::Unverified` even when the installation is fully configured, verified, and executable.
   - `get_agent_paths_verification` in `server/src/api/agent_status.rs:337` demands `report.readiness == ManagedReadinessStatus::Ready`.
   - Because `Ready` is never returned or assigned anywhere in the backend for Claude, `claude_can_enable` evaluates to `false` with reason `"Claude native integration is not ready (unverified)"`.
   - This keeps the Claude notification toggle permanently disabled.

---

## 4. Actionable Recommendations

### Recommendation 1: Fix Claude Readiness Status in `claude_integration.rs` (Code Fix)
- In `server/src/agent_status/claude_integration.rs`:
  - When the launcher script exists, manifest hash matches, DamHopper binary is valid, all required hooks are registered in `settings.json`, no policy flags disable hooks, and the launcher is executable, transition `readiness` to `ManagedReadinessStatus::Ready` (instead of leaving it as `Unverified`).
  - Alternatively, if `Ready` is intended to require an initial live handshake, implement an in-memory or persisted flag recorded upon first accepted hook ingress from that installation directory. (Note: currently, OMP extension status does not require a live handshake to become `can_enable: true`, only verified file installation).
- This will allow `server/src/api/agent_status.rs` to compute `claude_can_enable: true` and unlock the Claude notification policy switches in the UI.

### Recommendation 2: Improve UI Visual Hierarchy in `AgentSettings.tsx` (UI/UX Fix)
- Separate the OMP, Codex, and Claude integrations into distinct tabs or sub-navigation (e.g. `[Oh My Pi | Codex | Claude Code]`) within the Agent Settings view, or add clear visual demarcation and explicit provider headings.
- Clarify the Codex callout header to read: `"Codex Status-Only Observation"` so users do not mistake it for a global or Claude notification limitation.
- Ensure the feedback banners (`codexFeedback`, `claudeFeedback`) scroll into view or appear directly next to the action buttons.

### Recommendation 3: Align Unit Tests with Real Backend Behavior (Test Suite Fix)
- In `packages/ui/src/components/organisms/AgentSettings.test.tsx`, `mockClaudeReport` was manually given `readiness: "ready"`, masking the backend defect.
- Add an end-to-end integration test asserting `get_agent_paths_verification` returns `claude_can_enable: true` following a successful `install_claude()` call.

---

## 5. Unresolved Questions

- None. All behavior traces, backend code paths, frontend components, and rollout documentation align with the findings above.
