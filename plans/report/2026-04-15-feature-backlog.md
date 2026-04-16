# DamHopper Feature Backlog Report

> Research conducted: 2026-04-15
> Scope: High-value features for convenient workspace management via server
> Methodology: Codebase analysis + comparable tool research (code-server, Theia, DevPod, Gitpod, VS Code Server, JetBrains Gateway)

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Tier 1: Critical — Daily Workflow Blockers](#tier-1-critical--daily-workflow-blockers)
3. [Tier 2: High Value — Productivity Multipliers](#tier-2-high-value--productivity-multipliers)
4. [Tier 3: Medium Value — Differentiation](#tier-3-medium-value--differentiation)
5. [Tier 4: Low Priority — Defer](#tier-4-low-priority--defer)
6. [Anti-Features — Do NOT Build](#anti-features--do-not-build)
7. [Execution Roadmap](#execution-roadmap)
8. [Unresolved Questions](#unresolved-questions)

---

## Current State Assessment

**What DamHopper already does well:**

| Feature | Status | Quality |
|---------|--------|---------|
| Workspace TOML config | ✅ Complete | Solid — auto-discovery, hot-reload |
| PTY terminal sessions | ✅ Complete | Good — per-project, stdin/stdout, kill |
| Git operations | ✅ Complete | Comprehensive — clone/push/pull/diff/stage/conflicts/merge |
| File explorer + tree | ✅ Complete | Good — live sync via file watcher |
| Monaco editor + save | ✅ Complete | Excellent — tabs, mtime OCC, binary streaming |
| Text search | ✅ Complete | Good — .gitignore-aware, workspace-wide, ignore crate |
| Agent store | ✅ Complete | Unique — symlink distribution, health checks, import |
| Auth | ✅ Complete | Secure — bearer token, constant-time comparison |

**What Phase 05 is adding:** Create/delete/move/rename file operations.

**The gap:** DamHopper is an IDE-like shell that can view, edit, search, and git. But daily workspace management has pain points beyond editing files.

---

## Tier 1: Critical — Daily Workflow Blockers

These features save 10-20 min/day and remove friction that makes users fall back to their local IDE.

### F-01: Process Lifecycle Management (Auto-Restart + Status)

**Problem:** PTY sessions crash silently. No visibility into which services are running. Developer must manually notice, navigate to terminal tab, restart. This is the #1 annoyance when running multiple services.

**What to build:**
- `process:status` API — enumerate running PTY sessions with PID, CPU, memory, uptime
- Exit code tracking — when a PTY exits, record code + timestamp
- Auto-restart policy per project — `restart = "on-failure"` or `restart = "always"` in TOML
- Restart backoff — exponential with max 30s to prevent crash loops
- WS push event: `process:exited { id, code, willRestart, restartIn }`
- UI: traffic-light status dots on project cards (green/yellow/red)

**Complexity:** LOW (2-3 days) — PtySessionManager already tracks sessions; add exit observer + respawn logic.

**Evidence:** Docker, systemd, PM2, Kubernetes — every process manager has this. DevPod and Gitpod both surface service health prominently.

**TOML config:**
```toml
[[projects]]
name = "api"
type = "maven"
run_command = "mvn spring-boot:run"
restart = "on-failure"     # "never" | "on-failure" | "always"
restart_max_retries = 5
health_check_url = "http://localhost:8080/actuator/health"
```

---

### F-02: Bulk Command Orchestration (Start All / Stop All / Build All)

**Problem:** With 5-10 projects, starting/stopping each service individually is tedious. Developer wants "start the whole stack" in one click.

**What to build:**
- `POST /api/workspace/start` — spawn run_command for all (or tagged) projects, respecting dependency order
- `POST /api/workspace/stop` — graceful stop all running PTY sessions
- `POST /api/workspace/build` — concurrent build of all (or tagged) projects
- Tag-based filtering: `POST /api/workspace/start?tags=backend`
- Dependency graph (optional v2): `depends_on = ["database"]` in TOML
- WS event stream for aggregate progress
- UI: "Start All" / "Stop All" buttons on dashboard; per-project toggle

**Complexity:** LOW-MEDIUM (3-5 days) — PTY spawn already works; orchestration is the new part.

**Evidence:** docker-compose up/down is the gold standard. Every developer expects this for multi-service setups.

**TOML config:**
```toml
[[projects]]
name = "database"
type = "custom"
run_command = "docker-compose up -d postgres"
tags = ["infra"]

[[projects]]
name = "api"
type = "maven"
depends_on = ["database"]
tags = ["backend"]
```

---

### F-03: Environment Variable Viewer/Editor

**Problem:** `.env` files are scattered, hard to compare across projects, easy to misconfigure. DamHopper already parses `env_file` in TOML but doesn't expose the values in any useful way.

**What to build:**
- `GET /api/projects/:name/env` — parse and return env vars (keys only by default, values with `?reveal=true`)
- `PUT /api/projects/:name/env` — update env file atomically (mtime-guarded like file writes)
- UI: table view of env vars per project with edit-in-place
- Diff view: compare env vars across projects (e.g., API vs Worker)
- Mask secrets by default (show `****` unless user clicks reveal)
- Validation: warn on common mistakes (missing quotes, trailing spaces, duplicate keys)

**Complexity:** LOW (2-3 days) — env_file path already resolved in config; parsing `.env` format is trivial.

**Evidence:** DevPod has vault abstraction. Gitpod has env var management UI. Every PaaS (Railway, Render, Vercel) prominently features env management because it's universally painful.

---

### F-04: Command Palette / Quick Actions

**Problem:** Navigating between features (terminal, files, git, search) requires mouse clicks through the sidebar. Power users want keyboard shortcuts and a command palette like VS Code's `Ctrl+Shift+P`.

**What to build:**
- `Ctrl+Shift+P` command palette (modal with fuzzy search)
- Register all actions: open file, switch project, start terminal, git status, search, etc.
- BM25-scored command registry already exists server-side (`commands/registry.rs`) — expose to UI
- Recently-used commands float to top
- Keybinding customization (optional v2)

**Complexity:** LOW (2-3 days) — CommandRegistry with BM25 search exists. Just need UI modal + keyboard handler.

**Evidence:** VS Code, JetBrains, Sublime — every serious editor has this. It's table stakes for keyboard-driven workflows.

---

## Tier 2: High Value — Productivity Multipliers

These features don't block daily work but significantly improve the experience and differentiate DamHopper.

### F-05: Agent Execution API (`/api/pty/exec`)

**Problem:** AI agents (Claude, Gemini) running inside the workspace need to execute commands and get results. Currently they'd have to go through terminal:spawn + terminal:write + parse output, which is fragile.

**What to build:**
- `POST /api/pty/exec` — fire-and-forget or wait-for-exit command execution
- Request: `{ project, command, timeout_ms?, env? }`
- Response (sync): `{ exitCode, stdout, stderr, durationMs }`
- Response (async): `{ sessionId }` (reuse existing PTY streaming)
- Max execution time with auto-kill (default 60s)
- Sandbox: same project path constraints as PTY spawn
- Rate limiting per token (prevent runaway agents)

**Complexity:** LOW (1-2 days) — PtySessionManager.spawn() already handles command execution; just add collect-output-and-return semantics.

**Why it matters:** This is the bridge between "workspace viewer" and "workspace API that agents operate on." MCP servers, Claude Code, etc. all need this.

---

### F-06: Project Dashboard with Aggregate Status

**Problem:** The current DashboardPage exists but needs to surface operational state at a glance — which projects are running, last build status, git branch, uncommitted changes.

**What to build:**
- Per-project card showing:
  - Service status: running/stopped/crashed (from F-01)
  - Current git branch + dirty/clean indicator
  - Last build result (success/fail/not-run)
  - Port(s) if known (from run_command or health_check_url)
- Workspace-level summary bar: "3/5 services running, 2 projects with uncommitted changes"
- Quick actions from each card: start/stop, open terminal, open files, git pull
- Auto-refresh via WS events (no polling)

**Complexity:** MEDIUM (4-5 days) — Aggregates data from PTY manager, git service, config.

**Evidence:** Portainer, Lens (Kubernetes), Docker Desktop — operational dashboards are critical for multi-service setups.

---

### F-07: File Upload via Drag-and-Drop

**Problem:** UploadDropzone.tsx exists but may not be wired to the full write pipeline. Uploading config files, assets, or patches into projects is common.

**What to build (verify existing state first):**
- Drag file from OS → drop on file tree → upload to project directory
- Progress bar for large files (reuse binary streaming protocol)
- Multi-file upload
- Conflict detection (file exists → overwrite/skip/rename)

**Complexity:** LOW if UploadDropzone is mostly done; MEDIUM if wiring needed.

---

### F-08: Terminal Session Persistence + Reconnect

**Problem:** If WebSocket disconnects (network hiccup, laptop sleep), terminal sessions survive server-side but UI loses scrollback. Reconnection requires re-reading the buffer.

**What to build:**
- Server: retain N bytes of scrollback per session (configurable, default 100KB)
- On WS reconnect: client sends `terminal:attach { id }` → server replays buffer
- UI: auto-reconnect with "Reconnecting..." indicator
- Session list survives browser refresh (server tracks sessions, client re-attaches)

**Complexity:** MEDIUM (3-4 days) — Broadcast channels don't retain history; need ring buffer per session.

**Evidence:** tmux, screen, Mosh — session persistence is expected for remote terminals.

---

### F-09: Git Commit + Branch Management UI

**Problem:** DamHopper has diff/stage/unstage/discard API but no commit creation endpoint or branch management UI. Developer still needs external git client for committing.

**What to build:**
- `POST /api/git/:project/commit` — `{ message, amend? }`
- `GET /api/git/:project/branches` — local + remote branches
- `POST /api/git/:project/checkout` — switch branch (with stash option)
- `POST /api/git/:project/branch` — create new branch
- UI: commit dialog (staged changes summary → message → commit)
- UI: branch picker dropdown in git panel

**Complexity:** MEDIUM (4-5 days) — git2 supports all of this; mainly UI work.

**Evidence:** Every git GUI has this. Without commit, the diff/stage workflow is incomplete.

---

### F-10: Log Aggregation / Unified Output View

**Problem:** With multiple services running, logs are scattered across terminal tabs. Debugging cross-service issues means switching between tabs.

**What to build:**
- Unified log stream: merge output from all running PTY sessions with project-name prefix and color coding
- Filter by project, severity (if logs follow a pattern), text search
- Timestamp injection (optional, configurable)
- WS channel: `logs:subscribe { projects?: string[] }` → merged stream
- UI: dedicated "Logs" tab with multi-project filter checkboxes

**Complexity:** MEDIUM (4-5 days) — Tap into existing broadcast channels, merge + tag.

**Evidence:** Kubernetes logs (stern), Docker Compose logs, Loki — aggregated logs are essential for multi-service debugging.

---

## Tier 3: Medium Value — Differentiation

### F-11: DamHopper as MCP Server

**Problem:** AI agents (Claude, Cursor, Windsurf) use MCP to discover and call tools. If DamHopper exposes its capabilities as an MCP server, any AI agent can operate the workspace: read files, run commands, check git status, search code.

**What to build:**
- MCP server endpoint (stdio or HTTP transport)
- Expose tools: `workspace.list_projects`, `fs.read`, `fs.search`, `git.status`, `pty.exec`, `git.diff`
- Expose resources: workspace config, project list, running sessions
- Auth: reuse existing bearer token

**Complexity:** MEDIUM (5-7 days) — MCP spec is well-defined; mapping existing API to MCP tools is mechanical.

**Why it matters:** This is the killer differentiator. No other workspace manager exposes itself as an MCP server. Any AI agent could manage your dev environment remotely.

---

### F-12: Workspace Templates / Snapshots

**Problem:** Setting up a new developer or a new feature branch involves: clone repos, configure env files, install dependencies, start services. This can take 30-60 minutes.

**What to build:**
- `POST /api/workspace/snapshot` — capture current workspace state (config + env vars + git branches)
- `POST /api/workspace/restore` — apply snapshot to set up fresh environment
- Template library: save named snapshots ("sprint-42-setup", "clean-slate")
- Export as shareable TOML+env bundle

**Complexity:** MEDIUM (4-5 days)

---

### F-13: Notification System (WebSocket Events Bar)

**Problem:** Background events (build finished, git push failed, PTY crashed) go unnoticed unless user happens to be looking at the right tab.

**What to build:**
- In-app notification toast system
- Events: build success/failure, PTY exit, git operation complete, file conflict
- Notification center: history of recent events
- Optional: browser notifications (Notification API) for background tabs
- Sound alert option for critical events

**Complexity:** LOW (2-3 days) — WS events already exist; just need client-side toast + history.

---

### F-14: Multi-Terminal Layout (Split Panes)

**Problem:** Current terminal panel shows one terminal at a time with tab switching. Developers often want to see 2-3 terminals side-by-side (e.g., server output + build + test runner).

**What to build:**
- Split terminal view: horizontal/vertical splits
- Drag-and-drop tabs to create splits
- Configurable layout persistence (saved in localStorage)
- Keyboard shortcuts: Ctrl+\ to split, Ctrl+Tab to switch

**Complexity:** MEDIUM (3-4 days) — react-resizable-panels already used in IDE shell; extend to terminal area.

---

### F-15: Port Forwarding / Service Discovery

**Problem:** Running services expose ports locally on the server machine. When accessing DamHopper remotely, those ports aren't directly reachable from the browser.

**What to build:**
- Auto-detect listening ports from running PTY sessions (parse output for common patterns: "Listening on :8080")
- `GET /api/ports` — list detected ports with associated project
- Reverse proxy: `/proxy/:port/*` → forward to localhost:port (Axum middleware)
- UI: "Open in Browser" button per detected port

**Complexity:** MEDIUM-HIGH (5-7 days) — Port detection is heuristic; proxy is straightforward with Axum.

**Evidence:** Gitpod, Codespaces, code-server all have port forwarding. This is a MUST for remote server use.

---

## Tier 4: Low Priority — Defer

| Feature | Why Defer | Revisit When |
|---------|-----------|-------------|
| LSP integration | 4-8 weeks for marginal gain; Monaco has basic syntax highlighting | Users complain about autocomplete |
| Extensions marketplace | Can't compete with VS Code ecosystem | Never (let VS Code do this) |
| Desktop app (Electron) | Browser-first is fine; Electron adds maintenance | Market feedback demands it |
| Multi-tenant / RBAC | Only if enterprise SaaS | Enterprise customers appear |
| Kubernetes integration | Overkill for target user | Enterprise/cloud deployment needed |
| Database browser | Separate concern; use pgAdmin/DBeaver | Users explicitly request |
| Code review / PR UI | GitHub + GitLab do this well | Tight SCM integration planned |

---

## Anti-Features — Do NOT Build

1. **Custom code completion** — Users install Copilot/Codeium. Don't reinvent.
2. **Chat/messaging** — Use Slack/Discord. DamHopper is a workspace tool, not a communication tool.
3. **CI/CD pipeline** — Use GitHub Actions/Jenkins. Workspace tool shouldn't own deployment.
4. **Cloud hosting** — Stay self-hosted. Cloud adds massive complexity and compliance burden.
5. **Theme marketplace** — Tailwind already handles this. Ship 2-3 themes max.

---

## Execution Roadmap

### Sprint A (Weeks 1-3): Foundation Features

| Feature | Days | Dependencies |
|---------|------|--------------|
| F-01: Process lifecycle management | 3 | None |
| F-02: Bulk start/stop/build | 4 | F-01 (status) |
| F-13: Notification toasts | 2 | None |
| F-04: Command palette | 3 | None |
| **Total** | **12 days** | |

### Sprint B (Weeks 4-6): Complete Git + Environment

| Feature | Days | Dependencies |
|---------|------|--------------|
| F-09: Git commit + branch UI | 5 | None |
| F-03: Env var viewer/editor | 3 | None |
| F-05: Agent exec API | 2 | None |
| F-08: Terminal reconnect | 3 | None |
| **Total** | **13 days** | |

### Sprint C (Weeks 7-10): Multipliers

| Feature | Days | Dependencies |
|---------|------|--------------|
| F-06: Project dashboard | 5 | F-01 |
| F-10: Log aggregation | 5 | F-01 |
| F-15: Port forwarding | 6 | None |
| **Total** | **16 days** | |

### Sprint D (Weeks 11-14): Differentiation

| Feature | Days | Dependencies |
|---------|------|--------------|
| F-11: MCP server | 7 | F-05 |
| F-14: Split terminal panes | 4 | None |
| F-12: Workspace snapshots | 4 | F-03 |
| **Total** | **15 days** | |

---

## Priority Matrix (Impact vs Effort)

```
          HIGH IMPACT
              │
    F-01 ●    │    ● F-02
    F-04 ●    │    ● F-15
    F-05 ●    │    ● F-06
    F-13 ●    │    ● F-09
              │    ● F-11
 LOW EFFORT ──┼── HIGH EFFORT
              │
    F-07 ●    │    ● F-12
    F-03 ●    │    ● F-10
              │    ● F-14
              │    ● F-08
              │
          LOW IMPACT
```

**Quadrant 1 (TOP-LEFT): Do First** — F-01, F-04, F-05, F-13
**Quadrant 2 (TOP-RIGHT): Plan Carefully** — F-02, F-06, F-09, F-11, F-15
**Quadrant 3 (BOTTOM-LEFT): Quick Wins** — F-03, F-07
**Quadrant 4 (BOTTOM-RIGHT): Schedule Later** — F-08, F-10, F-12, F-14

---

## Unresolved Questions

1. **F-15 Port Forwarding:** Should this be a transparent reverse proxy or require explicit config in TOML? Transparent is more magical but harder to secure.
2. **F-11 MCP Server:** stdio transport (for local Claude Code) or HTTP transport (for remote agents)? Likely need both.
3. **F-01 Auto-Restart:** Should crashed services restart automatically by default, or require explicit `restart = "on-failure"` in TOML? Default-off is safer.
4. **F-10 Log Aggregation:** Should DamHopper parse log levels (INFO/WARN/ERROR), or treat all output as opaque text? Parsing adds value but fragile across languages.
5. **Terminal scrollback budget:** How much buffer per session? 100KB is ~2000 lines. Enough? Should it be configurable per project?
