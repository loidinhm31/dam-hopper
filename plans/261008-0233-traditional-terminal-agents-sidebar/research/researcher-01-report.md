# Research Report: Herdr Agent Navigation UX & Projects/Agents Split

**Date:** 2026-10-08  
**Author:** HerdrAgentUX Researcher  
**Target Reference:** [herdrdev/herdr](https://github.com/herdrdev/herdr) (v0.9.3)  
**Primary Sources:** [herdr.dev/docs/concepts](https://herdr.dev/docs/concepts/), [herdr.dev/docs/agents](https://herdr.dev/docs/agents/), [herdr.dev/docs/configuration](https://herdr.dev/docs/configuration/)  
**License:** Apache License 2.0 (Verified via GitHub repository & badges; safe for conceptual architectural patterns without code reuse)

---

## 1. Executive Summary
Herdr is an Apache-2.0 Rust workspace/terminal manager decoupling client presentation from a persistent background server. It manages real terminals (PTYs) and elevates AI coding agents to first-class workspace entities via screen-buffer heuristics and socket/CLI reporting.

## 2. Herdr Core UX & Architecture Patterns

### A. Sidebar Grouping & Hierarchy
- **Hierarchy:** Server Session -> Workspaces (Projects/repos) -> Tabs (layouts/views) -> Panes (PTYs / Agents).
- **Worktree Subgroups:** Worktrees branch under parent project workspaces, nesting child checkouts while retaining independent pane sets.
- **Rollup Indicators:** Sidebar badges roll upward hierarchically: a `blocked` or `working` agent inside a pane bubbles to tab and workspace rows so operators instantly spot which project requires attention.

### B. Session & Target Identity
- **Persistence:** Named server sessions (`herdr session attach <name>`) outlive client disconnects; state persists in background server.
- **Addressing:** Panes (`w1:p1`), persistent terminal IDs, or friendly agent aliases (`herdr agent rename w1:p1 reviewer`).
- **Client vs. Server Separation:** Client owns UI themes, navigation focus, and local "seen" badges. Server owns PTYs, process detection, and semantic agent states.

### C. Harness Support Spectrum
1. **Harness-agnostic Screen Scraping ("Supported by Herdr"):** Reads live bottom buffer via regex manifests (`distribution/agent-detection/*.toml` for Claude, Codex, Cursor, Devin, Grok, etc.) with automatic remote updates.
2. **Explicit Agent Integration ("Supported by the Agent"):** Agents self-report state via socket/CLI (`herdr pane report-agent --state <state>`).
3. **Environment Wrappers:** Supports sandbox variables (`HERDR_AGENT=<agent>`, `HERDR_PROCESS_DETECTION=child-groups`) for containerized/fenced CLIs.

### D. Agent State Model: `idle` vs `done` vs `task success`
- **State Table:**
  - `blocked`: Agent halted waiting for approval, permission prompt, or human input.
  - `working`: Agent actively running/executing turns.
  - `done`: Agent finished turn, **unseen** by current client.
  - `idle`: Agent finished turn/waiting and **seen** by current client.
  - `unknown`: Ambiguous classification (fallback default for Codex; others default to `idle`).
- **Crucial Distinction:** `done` and `idle` track **client attention / turn completion**, *not* workflow/task success. Neither state reflects whether tests passed or the prompt achieved its goal. Both indicate "ready for operator input."
- **Client Badge Isolation:** Viewing a finished agent in Client A transitions `done` -> `idle` locally without clearing Client B's `done` badge.

### E. Attention, Permissions, & Audio Alerts
- **Strict Blocked Trigger:** Strict match on bottom-buffer permission/prompt UI. Non-matching fallbacks drop to `idle` (or `unknown`) to prevent phantom blockers.
- **Alerts:** Distinct event sounds (`request.mp3` for attention/permission blocked, `done.mp3` for completion).

### F. Navigation, Focus, & Disconnection
- **Modes:** Terminal Mode (normal input), Prefix Mode (`ctrl+b`), Navigate Mode (`w` persistent navigation surface).
- **Direct Focus / Attach:** Operators can attach full UI or directly bind to a single agent (`herdr agent attach <target> [--takeover]`).
- **Disconnection & Headless Fallback:** Detach via `ctrl+b q`. Server maintains virtual terminal (default 120x40) so background processes continue unaffected.

## 3. Recommended Projects + Agents Sidebar Split
For traditional terminal integration (without Herdr vendor coupling):
1. **Two-Tier Primary Sidebar Navigation:**
   - **Section 1: Projects (Top / Main):** Project workspaces, directory roots, git branches/worktrees, and traditional shell sessions. Shows rolled-up attention pips.
   - **Section 2: Active Agents (Dedicated Drawer/Sub-panel):** Cross-project agent roster listing all active AI harness sessions.
2. **Agent Roster Row Attributes:**
   - Agent Name / Harness Type (e.g. `claude-code`, `codex`, `omp`).
   - Project affiliation tag/badge.
   - Status Indicator: Distinct badges for `Working` (spinner/blue), `Needs Attention` (amber/red exclamation), `Done / Unseen` (green dot/badge), and `Idle` (muted).
   - Display summary token (e.g. `indexing`, `running tests`).
3. **Focus Interaction Model:** Clicking an agent navigates directly to that terminal tab/pane and auto-marks `done` as `seen` for the local client.

## 4. Choices Requiring User Validation
1. **Sidebar Layout Division:** Fixed vertical split (Projects top, Agents bottom) vs collapsible accordion sections vs tabbed sidebar switcher (Projects tab vs Agents tab).
2. **Agent Listing Scope:** Flat list of all agents across all projects vs agents nested under their respective projects vs a filtered toggle ("Show All Agents" vs "This Project Only").
3. **Turn Completion vs Task Success Semantics:** Confirm whether UI status badge indicates conversational readiness (`idle`/`ready`) or if backend workflow outcomes (`success`/`failure` exit codes) should be distinguished in the badge.
4. **Attention Cue Preferences:** Visual-only status badges vs audio chime notifications (`request`/`done`) upon state transitions.

## 5. Licensing & Reuse Notes
- Herdr source is licensed under **Apache 2.0**.
- Recommended adoption is architectural/conceptual (clean-room UX design); no vendor code, binaries, or TOML configs are copied. Apache 2.0 permits reference and clean implementation without license obligations.

## 6. Unresolved Questions
1. Does the existing traditional terminal backend already emit structured hook events (lifecycle/status) from harnesses, or is screen-scraping required for non-integrated CLIs?
2. Should non-agent standard shell terminals be completely excluded from the Agents section, or can any terminal be manually tagged as an agent session?
3. How should multi-client instances (e.g., remote vs local UI) synchronize the `seen`/`unseen` status of completed agent turns?
