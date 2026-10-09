# Research Report: Terminal Agents Sidebar Contracts & Harness Integration

**Date:** 2026-10-08  
**Author:** HarnessStatusResearch  
**Scope:** Status contracts, harness lifecycles, Agent Store boundaries, and sidebar mapping  
**Authority:** `docs/architecture/agent-status.md`, `docs/architecture/agent-store-ports-and-browser.md`, `packages/ui/src/api/agent-status-types.ts`

---

## 1. Executive Summary

DamHopper's agent status subsystem is a server-owned, process-memory reducer (`dam-hopper-server`) with zero external database requirements. The traditional terminal sidebar can be cleanly split to display active AI harness sessions alongside terminal tabs. Each live agent row represents strictly **one PTY incarnation** running an admitted harness session. The Agent Store is an artifact distribution catalog and settings surface—not an agent process manager.

---

## 2. Status Vocabulary & Semantic Mapping

Canonical contract states are defined in `packages/ui/src/api/agent-status-types.ts` and `docs/architecture/agent-status.md#C209` (lines 63–73):

| Canonical State (`AgentState`) | Reason / Outcome Metadata | Current UI Badge Label | Recommended Sidebar Label | Lifecycle & Semantics |
| :--- | :--- | :--- | :--- | :--- |
| `working` | `turnId` active | "Running" | **Running** | Active prompt turn, retry, continuation, or context maintenance. |
| `idle` | `lastOutcome?: TurnOutcome` | "Idle" | **Idle** | Agent connected, awaiting user input. Turn completed or interrupted. |
| `blocked` | `reason: "approval"` | "Needs attention" | **Waiting (Approval)** | Awaiting user tool-execution or shell permission. |
| `blocked` | `reason: "question"` | "Needs attention" | **Waiting (Input)** | Awaiting user response to interactive inquiry (`ask` tool). |
| `blocked` | `reason: "error"` | "Needs attention" | **Error** | Terminal agent failure requiring human intervention. |
| `unknown` | `reason?: string` | "Unknown" | **Unknown** | Admission phase, disconnect, missing lease renewal, or unverified hook. |

### Semantic vs Process vs Notification Lifecycle Rules
1. **"Turn ended" is an event, NOT a state:** `AttentionKind = "turn-ended"` is an ephemeral attention event emitted on turn settlement (`docs/architecture/agent-status.md:97`). State transitions immediately to `idle` with `lastOutcome: "ended"`. Sidebar rows must show `Idle`, not a persistent "Turn ended" status.
2. **"Waiting" vs "Blocked":** The reducer state is `blocked`. "Waiting" is purely a UI presentation mapping for `reason: "approval" | "question"`.
3. **"Exited" is PTY lifecycle, NOT agent status:** PTY death/kill revokes the capability and deletes the row via `AgentStatusRemovedPayload` (`docs/architecture/agent-status.md:100,139`). Plain shells and exited PTYs have no status row.
4. **Source State Preservation:** The UI sidebar must retain full source row properties (`state`, `reason`, `lastOutcome`, `source`, `observedAtMs`, `expiresAtMs`). Do not collapse these into lossy custom strings.

---

## 3. Supported Harnesses & Behavioral Matrix

Public `AgentKind` is closed: `"omp" | "codex" | "claude"` (`docs/architecture/agent-status.md:53-61,114`):

| Harness | Ingress Mechanism | Authority & Lease | Capabilities & Limitations |
| :--- | :--- | :--- | :--- |
| **OMP** (18.4.1) | Private loopback WS (`/v1/agent-status`) | `source: "lifecycle"`, 5s heartbeat, 15s lease | Full turn lifecycle, approvals, questions, outcomes. Skips `OMPCODE=1` and nested sessions. |
| **Codex** (0.158.0) | One-shot Unix hook (`/v1/agent-hooks`) | `source: "hook"`, 15s evidence lease | **Status-only.** No blocked state, no alerts. `Stop`/`PermissionRequest` fall back to `unknown`. |
| **Claude Code** (2.1.250) | One-shot Unix hook (`/v1/agent-hooks`) | `source: "hook"`, 15s evidence lease | **Attention-only.** Approval/question/error alerts. Normal `Stop` invalidates to `unknown` (no turn-ended alert). |

---

## 4. Agents Sidebar Row Identity (1 PTY = 1 Agent)

1. **Strict 1:1 Mapping:** The registry keys rows by `(terminalId, incarnation)` (`docs/architecture/agent-status.md:49,89-93`). One PTY incarnation allows exactly **one** active reporter.
2. **Subagents are Explicitly Rejected:** Hook callbacks with `agent_id` or `agent_type` are discarded (`docs/architecture/agent-status.md:333-337`). Nested CLI processes are rejected by `/proc` ancestry checks.
3. **Sidebar Representation:** Each sidebar Agent row represents an **active agent session bound to a specific terminal PTY tab**. Clicking an agent row focuses/navigates to that terminal PTY.
4. **Plain Shell Filter:** Terminals running standard shells (bash/zsh) without an active agent do not appear in the Agents sidebar section.

---

## 5. Agent Store vs Live Sessions Boundary

- **Catalog vs Runtime:** `AgentStorePage` manages file artifacts (prompts, skills), project memory drafts, and host health checks (`docs/architecture/agent-store-ports-and-browser.md:10-29`). Catalog artifacts are static files, **not running processes**.
- **Agent Settings Tab:** Agent Store contains the "Agent Settings" tab (`docs/architecture/agent-status.md:220-229`), configuring harness binary paths (`agentDir`, `codexDir`, `claudeDir`) and inspecting:
  - **Installation State:** `absent | current | outdated | modified` (managed launcher/hook files).
  - **Runtime Readiness:** `ready | unavailable | platform-unqualified` (OS qualification, hook trust).
- **Sidebar Integration Link:** The sidebar should provide an "Agent Store" entry point (navigation link to `/agent-store`), positioned distinctly as a link/footer/action, completely separate from the list of running agent sessions.

---

## 6. Freshness, Leases, and Visibility

1. **Independent of Notifications:** Live session badges and sidebar presence are driven by `AgentStatusSnapshotV1` and live WS events, completely independent of `terminalAgentNotifications` toggle preferences (`docs/architecture/agent-status.md:218,222`).
2. **Silent Baseline on Reconnect:** Initial snapshot `GET /api/agent-status/v1/snapshot` or reconnects establish a silent baseline without firing false alerts (`docs/architecture/agent-status.md:98,214`).
3. **Lease Expiry:** If an agent hangs or exits without hook notification, the 15s lease expires and server transitions state to `unknown` (`docs/architecture/agent-status.md:82,331`).
4. **Profile Scope:** Rows are scoped by `ConnectionRef { profileId, generation }`. Disconnecting a profile removes or marks agents unavailable (`docs/architecture/agent-store-ports-and-browser.md:12,42`).

---

## 7. Custom / Arbitrary Agent Limitations

- DamHopper does **not** perform VT output scraping, terminal heuristics, or generic OSC 9 parsing (`docs/architecture/agent-status.md:18,21`).
- Arbitrary custom CLI agents (e.g. Aider, Cline) will **not** appear in the Agents sidebar unless a qualified reporter/hook adapter is explicitly added to `dam-hopper-server`.

---

## 8. Concrete Reusable Contracts

- **Types & Enums:** Import directly from `packages/ui/src/api/agent-status-types.ts`:
  `AgentKind`, `AgentState`, `BlockedReason`, `TurnOutcome`, `TerminalAgentStatusRow`, `AgentStatusSnapshotV1`.
- **State Store:** Consume the existing profile-scoped agent status watcher in `packages/ui/src/embed/dam-hopper-app.tsx` and query clients.
- **Backend Infrastructure:** Use existing `GET /api/agent-status/v1/snapshot` and WS pushes (`agent-status:changed`, `removed`, `invalidated`). No new database, table, or daemon required.

---

## 9. Unresolved Questions

1. **Grouped vs Flat Sidebar Layout:** Should the Agents section sit above terminal tabs, in an accordion group, or in a split toggle (Tabs vs Agents)?
2. **Codex/Claude Unknown Ambiguity:** Since Codex and Claude native `Stop` events intentionally transition to `unknown` (due to CLI hook limitations), should the UI display "Idle / Awaiting input" for hook agents after a grace period, or strictly honor the contract's "Unknown" badge?
3. **Empty State:** When no PTY is running an agent, should the Agents section show "No active agents" with an "Open Agent Store" shortcut, or collapse entirely?