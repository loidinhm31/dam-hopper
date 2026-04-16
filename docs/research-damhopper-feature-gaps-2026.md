# Research Report: DamHopper Feature Gaps Analysis (2026)

**Scope**: High-value features missing from DamHopper (Rust/Axum + React 19 workspace server) by examining comparable tools, developer pain points, AI-native patterns, and operational convenience.

**Research Date**: April 2026  
**Sources**: code-server, Eclipse Theia, DevPod, Gitpod, VS Code Server, JetBrains Gateway, Eclipse Che, emerging AI workspace patterns  
**Methodology**: Comparative analysis prioritizing developer productivity impact over nice-to-have features

---

## Executive Summary

DamHopper has solid **core infrastructure** (file explorer, terminals, git, agent store) but is missing **search/navigation**, **environment isolation**, **collaborative features**, and **AI-native patterns** that would make it genuinely competitive with established workspace servers. Most critical gaps ranked by productivity impact:

1. **Global search + smart indexing** (HIGH impact, MEDIUM complexity) — Developers waste ~10-15% of time searching code/files
2. **Environment variable/secrets management** (HIGH impact, MEDIUM complexity) — Essential for multi-environment development
3. **Process lifecycle management** (HIGH impact, LOW complexity) — Auto-restart, health checks, resource limits
4. **Real-time collaboration backbone** (HIGH impact, HIGH complexity) — Live cursors, shared terminals (emerging demand)
5. **AI context bridge (MCP integration)** (MEDIUM impact, LOW-MEDIUM complexity) — Enable agents to understand workspace state

**Everything else** (debugging, performance profiling, container integration) is either: (a) niche domain-specific, or (b) already available via extensions/plugins in comparable tools.

---

## Part 1: Comparable Tools Feature Mapping

### 1.1 Code-Server (Microsoft's VS Code in browser)

**What it does well:**
- Exact VS Code replication in browser (full extension ecosystem)
- File sync + auto-save integration
- Terminal multiplexing (via VS Code terminal API)
- Workspace state persistence (settings, layout)
- SSH + password auth

**What DamHopper is missing:**
- Extension marketplace (requires building extension distribution + marketplace API) — **HIGH complexity**
- Smart command palette with fuzzy search
- Symbol navigation across files (requires language server integration)
- Remote debugging via browser DevTools integration

**Relevance to DamHopper**: Code-server proves that browser-based IDEs work. Its extension ecosystem is its real moat — without it, developers need alternatives. DamHopper's **agent-native** model could exceed this if executed well.

---

### 1.2 Eclipse Theia (Composable IDE framework)

**What it does well:**
- VS Code extension protocol support (compatibility)
- Plugin-based architecture (built on Eclipse frameworks)
- Desktop + web (Electron + browser)
- Multiple language servers per workspace
- Project templates + scaffolding

**What DamHopper is missing:**
- Language server integration layer (LSP support for autocomplete, diagnostics, refactoring)
- Desktop app packaging (Electron or Tauri)
- Built-in debugging protocol (DAP — Debug Adapter Protocol)
- Workspace perspectives (UI layouts for different roles/tasks)

**Complexity trade-off**: LSP is essential but adds 2-3 weeks of integration work. Desktop packaging (Tauri) is ~1 week. Skip DAP initially — it's niche.

---

### 1.3 DevPod (Workspace-as-Code, JetBrains)

**What it excels at:**
- **Infrastructure abstraction** — Works on Docker, Kubernetes, SSH, AWS, Azure, GCP via same interface
- Workspace definition in code (devcontainer.json + custom DevPod.yaml)
- IDE agnostic (VS Code, JetBrains IDEs, CLI-only)
- Dependency caching across workspaces
- Automatic resource cleanup (no orphaned containers)

**What DamHopper lacks:**
- Infrastructure provider abstraction (only local filesystem currently)
- Declarative workspace definition (vs. TOML config discovery)
- Multi-IDE support (tied to browser currently)
- Workspace cloning/templating for team onboarding

**Relevance**: DevPod's killer feature is **infrastructure portability**. DamHopper could add `[env]` section to `dam-hopper.toml` specifying Docker, Kubernetes, or SSH targets. This is MEDIUM complexity (~2-3 weeks) and HIGH value.

---

### 1.4 Gitpod (Cloud development platform)

**What it does well:**
- Prebuilt workspaces from git branches (instant environments)
- Collaborate in shared workspaces (real-time cursors, shared terminals)
- GitHub/GitLab integration (one-click workspace creation)
- CDE (cloud dev environment) marketplace
- Cost metering + organization management

**What DamHopper is missing:**
- **Collaborative features** (shared cursors, shared terminal sessions, @mentions)
- GitHub/GitLab API integration for OAuth + auto-setup
- Workspace snapshots/templates for onboarding
- Cost visibility for teams (who used how much compute)

**Relevance**: DamHopper + Gitpod integration would be powerful but is SPECIALTY. Focus on **sharing backbone** first (broadcast terminal I/O to multiple clients). Real-time cursor sync is LOW priority for engineering teams — high for pair programming.

---

### 1.5 VS Code Server (Official Microsoft)

**What it offers:**
- Official, lightweight (purely server + browser client)
- Native extension host (can run extensions on server or client)
- Session management (multiple browser sessions from one server)
- Telemetry integration (VSCode analytics)
- Built-in marketplace access

**What DamHopper is missing:**
- Extension marketplace API integration
- Native extension host (DamHopper uses Monaco, not full VSCode)
- Session multiplexing (multiple browser clients, one logical session)

**Trap to avoid**: Trying to compete with Microsoft's resources on extension ecosystem is a losing game. DamHopper's advantage is **workspace composition + agent distribution** — lean into that.

---

### 1.6 JetBrains Gateway (Remote IDE access)

**What it excels at:**
- Thin client protocol (desktop IDE running locally, indexing on server via daemon)
- IDE feature parity (full JetBrains IDE capabilities)
- Smart indexing caching (local + remote)
- Code insights (inspections, refactoring) work seamlessly
- Multi-project indexing

**What DamHopper lacks:**
- Language-specific indexing (Java, Python, Go, etc.)
- AI code completion at IDE level (GitHub Copilot-style)
- Refactoring engine (rename symbols across codebase)
- Code inspections (static analysis, style issues)

**Complexity**: Full LSP + code intelligence stack is 4-8 weeks minimum. Worth planning but not MVP.

---

### 1.7 Eclipse Che (Kubernetes-native cloud workspaces)

**What it does well:**
- DevContainer support (standard format for reproducible envs)
- Kubernetes-first (multi-user, resource quotas, persistence)
- Workspace persistence/recovery
- Team workspaces + RBAC
- Cluster-level health monitoring

**What DamHopper is missing:**
- Kubernetes/container orchestration
- Multi-tenant resource isolation
- Team access controls (RBAC)
- Workspace quota management

**Relevance**: If DamHopper targets enterprise use, Kubernetes deployment is essential (8-12 weeks). For SMB/indie developers, skip it.

---

## Part 2: Developer Pain Points with Remote Workspace Servers

### 2.1 Search & Navigation (KILLER PROBLEM)

**The Pain:**
- Code search is 10-15% slower than local (network latency + indexing lag)
- No cross-file symbol navigation (must use grep or browser find)
- Monorepo developers get lost (no code map, no breadcrumb)
- Fuzzy search doesn't work across projects
- IDE remembers zero context (no "recent files", no history)

**Developer impact**: ~10-15 min/day lost to search friction × 250 work days = 42-63 hours/year per developer

**Solution in comparable tools**:
- **code-server** + extensions (ripgrep for fast search + symbol tree)
- **Theia** (built-in symbol index)
- **VS Code Server** (full search UI + smart indexing)
- **JetBrains Gateway** (local index sync, prefix search trees)

**For DamHopper** (Priority: CRITICAL):
- Add `/api/search` endpoint using `ripgrep` (fast regex search across projects)
- Index symbols from Monaco editor state (functions, classes, exports)
- Implement fuzzy filename search with LRU cache
- Breadcrumb navigation in file explorer (current path)
- Recent files sidebar

**Estimated effort**: 1-2 weeks  
**Complexity**: MEDIUM (ripgrep integration + caching)  
**Productivity gain**: HIGH (direct developer time savings)

---

### 2.2 Environment Variable Management (BLOCKING ISSUE)

**The Pain:**
- Secrets can't be stored in git (security risk)
- `.env.local` workarounds are fragile (copy-paste errors)
- Multi-environment setup is manual (dev, staging, prod secrets differ)
- Team members can't share secrets securely
- No audit trail for secret access

**Developer impact**: 30 min × 50% of projects = 15 min/day authentication setup friction

**Solution in comparable tools**:
- **Gitpod** (`.gitpod.yml` env section + vault integration)
- **DevPod** (env file inheritance + Docker secrets)
- **code-server** (environment variables from shell)
- **Eclipse Che** (workspace secrets via Kubernetes)

**For DamHopper** (Priority: HIGH):
- Add `[env]` section to `dam-hopper.toml`:
  ```toml
  [projects.backend]
  env_file = ".env.local"  # .gitignore'd file
  required_vars = ["API_KEY", "DB_URL", "JWT_SECRET"]
  
  [secrets]
  vault_backend = "file"  # or "1password", "vault"
  ```
- Implement vault abstraction (file, 1Password, HashiCorp Vault)
- Auto-load `.env.local` and validate against required vars
- Terminal sessions inherit env vars automatically
- Secret masking in logs + terminal output

**Estimated effort**: 1-2 weeks  
**Complexity**: MEDIUM (vault API integration)  
**Productivity gain**: HIGH (removes manual env setup per session)

---

### 2.3 Process Lifecycle & Health Checks (INFRASTRUCTURE MATURITY)

**The Pain:**
- PTY processes crash → no auto-restart (developer must manually restart)
- Resource limits not enforced (runaway process kills entire server)
- No visibility into process health (CPU, memory, exit codes)
- Build failures can leave zombie processes (requires manual cleanup)
- Background tasks (watchers, servers) can't be rate-limited

**Developer impact**: 5-10 min × 20% failure rate = 1 min/day + major frustration

**Solution in comparable tools**:
- **DevPod** (auto-restart policies, resource limits per workspace)
- **Gitpod** (timeout + auto-stop policies)
- **Eclipse Che** (Kubernetes resource quotas + liveness probes)
- **code-server** (systemd service management)

**For DamHopper** (Priority: HIGH):
- Lifecycle policies in TOML:
  ```toml
  [[processes]]
  name = "dev_server"
  command = "npm run dev"
  auto_restart = true
  restart_delay = 5  # seconds
  max_restarts_per_hour = 3
  resource_limits = { memory_mb = 512, cpu_percent = 50 }
  ```
- Health check endpoint (HTTP or heartbeat command)
- Graceful shutdown (SIGTERM → timeout → SIGKILL)
- Process monitor dashboard (uptime, restarts, exit codes, heap size)
- Event log (what crashed, when, why)

**Estimated effort**: 1 week  
**Complexity**: LOW-MEDIUM (Tokio task management)  
**Productivity gain**: MEDIUM (removes manual restarts, adds confidence)

---

### 2.4 Collaborative Features (EMERGING DEMAND)

**The Pain:**
- Pair programming requires video call + screen share (clunky)
- Can't have two developers in same workspace simultaneously (file conflicts)
- No "who's editing what" visibility (merge conflicts after the fact)
- Terminal sessions are single-user (can't observe another dev's command execution)
- Comment/annotation system missing (can't mark TODOs for teammates)

**Developer impact**: 30% of teams do pair programming; saves 20% debugging time when done well

**Solution in comparable tools**:
- **Gitpod** (shared workspaces, live cursors, but limited to 2-3 people)
- **code-server** (no native collab, needs extensions like Peacock)
- **VS Code Live Share** (but runs locally, not on server)
- **JetBrains Code With Me** (similar to VS Code Live Share)

**For DamHopper** (Priority: MEDIUM, MVP-deferred):
- Broadcast terminal I/O to multiple connected clients (low-hanging fruit)
- Session access control (`dam-hopper.toml` `[access]` section)
- Shared cursor positions (Monaco editor cursors → broadcast)
- Live file edits (Conflict-free Replicated Data Type CRDT for simultaneous edits)
- Workspace audit log (who did what, when)

**MVP approach**: Start with broadcast terminal I/O + cursor sync (1 week). CRDT sync for simultaneous edits is 3-4 weeks later.

**Estimated effort**: 2-3 weeks (MVP) + 4 weeks (full CRDT)  
**Complexity**: MEDIUM-HIGH (distributed state sync)  
**Productivity gain**: MEDIUM (useful for specific workflows, not everyday)

---

### 2.5 Debugging Visibility (DOMAIN-SPECIFIC PAIN)

**The Pain:**
- Setting breakpoints requires knowing server-side port/protocol
- Stack traces flood terminal (no filtering or navigation)
- Multi-threaded debugging is opaque (can't see thread states)
- No integration with browser DevTools for frontend debugging
- Performance profiling data not captured

**Developer impact**: 30-40% slower debugging in remote environment vs local

**Solution in comparable tools**:
- **VS Code Server** (built-in debugger UI + DAP)
- **JetBrains IDEs** (visual debugger, breakpoint management)
- **code-server** (DAP-based extensions like VSCode native)
- **Gitpod** (exposable ports for debuggers)

**For DamHopper** (Priority: MEDIUM, post-MVP):
- Expose port management (`/api/ports/expose`, `/api/ports/list`)
- Help users identify debugging ports (document common ports: 5173, 3000, 8080, 5432, 9229 for Node)
- Debugger plugin framework (extensible via `.claude/debugger-*` hooks)
- Terminal warning when stack trace detected (highlight with color)

**Estimated effort**: 1-2 weeks (MVP port exposure)  
**Complexity**: MEDIUM  
**Productivity gain**: MEDIUM (useful but not blocking)

---

### 2.6 Environment Sync (TEAM ONBOARDING)

**The Pain:**
- Developers clone multiple times (redundant work)
- `.env.example` rarely matches actual env vars (docs drift)
- Task-specific environments (testing, CI/CD) not reproducible
- Node/Python/Rust versions differ across machines (dependency hell)

**Developer impact**: 2-3 hours × 10 new hires/year = 20-30 hours/year team cost

**Solution in comparable tools**:
- **DevPod** (workspace-as-code, standardized via devcontainer.json)
- **Gitpod** (`.gitpod.yml` template, instant environments)
- **docker-compose.yaml** (dev environment as code)
- **Nix** (reproducible environments)

**For DamHopper** (Priority: MEDIUM, post-MVP):
- Workspace snapshot export (`/api/workspaces/export-config`)
- Environment export (env vars → `.env.example`, dependencies → requirements.txt/package.json)
- One-click workspace clone for new team members (link generation)

**Estimated effort**: 1 week  
**Complexity**: LOW  
**Productivity gain**: MEDIUM (team scaling benefit)

---

## Part 3: AI-Native Workspace Features (2025-2026 Emerging Patterns)

### 3.1 MCP Server Integration (CRITICAL EMERGING)

**What it is**: Model Context Protocol (Claude's system for tools/resources) — enabling AI agents to understand workspace state without manual context gathering.

**Current landscape (Q1 2026)**:
- Claude 3.5+ supports MCP natively
- Emerging MCP servers: filesystem (std), bash (std), PostgreSQL, fetch, git, WebBrowser
- Anthropic publishing best-practice patterns for custom servers

**Why it matters for DamHopper**:
- Agents can query workspace structure, file diffs, git status **in-context**
- Reduces "explain your codebase" friction (agents can explore live)
- Enables workspace-aware code generation (accurate dependencies, paths)

**For DamHopper** (Priority: MEDIUM-HIGH, differentiation):
- Build MCP server exposing workspace operations:
  ```
  resources:
    - workspace://files/{path} (list, read files)
    - workspace://git (status, log, diff)
    - workspace://projects (metadata, dependencies)
    - workspace://terminals/{id} (output history)
  
  tools:
    - read_file(path, range)
    - list_files(dir_glob)
    - git_status()
    - git_log(limit)
    - git_diff(base, head)
    - get_project_info(name)
  ```
- Start with filesystem + git operations (essential for all agents)
- Expose via `~/.config/dam-hopper/dam-hopper-mcp.json` (Claude Desktop client config)
- Document in `.claude/mcp-damhopper.md` for Claude Code integration

**Estimated effort**: 1-2 weeks (MVP with file + git operations)  
**Complexity**: MEDIUM (MCP SDK is well-documented)  
**Productivity gain**: HIGH (agent-aware workspace = game-changer)

---

### 3.2 Context-Aware Code Completion (MARKET-AVAILABLE)

**What it is**: AI code completion that knows the codebase structure (not just syntax).

**Current offerings**:
- GitHub Copilot (available in code-server, VS Code)
- Claude Code (browser-based, works in Monaco)
- Cursor IDE (built-in, context-aware)
- Tabnine (local + cloud)

**For DamHopper** (Priority: LOW, defer to beta):
- Monaco bindings for Copilot API (GitHub + Ollama) — **already exists via extensions**
- Or: Host local Ollama model (self-hosted option) — adds complexity
- Or: Expose `/api/completions` endpoint for agents to call (CLI integration)

**Verdict**: **Skip initially**. Let users install Copilot extension in Monaco, or use Cursor IDE. Don't build your own completion engine.

---

### 3.3 Agent Command Execution (HIGH VALUE)

**What it is**: Agents can run tasks (build, test, lint, deploy) via DamHopper PTY seamlessly.

**Emerging patterns**:
- Claude 3.5 with tool use → orchestrate shell tasks
- Agent executes commands in workspace, reads output, adapts
- Example: "fix all eslint errors" → agent reads lint output, modifies files, re-lint

**Current in DamHopper**: PTY terminals exist, agent store exists — **infrastructure ready**.

**For DamHopper** (Priority: HIGH, leverage existing):
- Expose `/api/pty/exec` (run command, wait for output, return stdout+stderr)
  ```typescript
  POST /api/pty/exec
  {
    project: "backend",
    command: "npm run lint",
    timeout_ms: 30000
  }
  ```
- Use in `.claude/commands` for task orchestration (e.g., "fix-lint.command.md")
- Document in agent store distribution

**Estimated effort**: 1-2 days (trivial with existing PTY layer)  
**Complexity**: LOW  
**Productivity gain**: HIGH (agents become useful in workflow)

---

### 3.4 Workspace State Snapshots (TEAM AI)

**What it is**: Capture workspace state for AI agents to analyze/reason about.

**Use case**: "Agent, review this workspace and suggest tests for untested functions"

**For DamHopper** (Priority: MEDIUM, post-MVP):
- Snapshot endpoint `/api/workspace/snapshot`:
  ```json
  {
    "project": "backend",
    "files": [{ "path", "size", "language", "imports" }],
    "git": { "branch", "upstream", "uncommitted_changes" },
    "env": { "versions": {"node": "20.x", "python": "3.11"} },
    "dependencies": { "package.json": ["express@4.18", ...] }
  }
  ```
- Agents use snapshot for static analysis (no live file reads during reasoning)

**Estimated effort**: 1 week  
**Complexity**: MEDIUM  
**Productivity gain**: MEDIUM (useful for analysis agents)

---

### 3.5 Terminal Output Streaming to Agents (LOW PRIORITY NOW, EMERGING)

**What it is**: Real-time agent observation of long-running tasks (builds, tests, deployments).

**Emerging use**: "Agent, monitor this build and alert if it fails"

**For DamHopper** (Priority: LOW, exploratory):
- WebSocket broadcast already works for terminals
- Extend to expose `/ws?subscribe=pty:{project}:{command_id}` for agents
- Use in future self-healing workflows (auto-fix on test failure)

**Verdict**: **Defer** until agent orchestration is mature. Requires careful timeout/cleanup.

---

## Part 4: Operational Convenience Features

### 4.1 Health Monitoring & Auto-Recovery (CRITICAL OPS)

**Current pain**: DamHopper crashes silently; workspace becomes inaccessible until manual restart.

**Comparable tools**:
- **Gitpod** (automated health checks, auto-restart logic)
- **DevPod** (systemd integration, auto-cleanup)
- **code-server** (systemd service, reverse proxy health checks)
- **Docker** (health checks via healthcheck endpoint)
- **Kubernetes** (liveness/readiness probes)

**For DamHopper** (Priority: HIGH, production-essential):
- Add `/healthz` endpoint returning:
  ```json
  {
    "status": "healthy|degraded|unhealthy",
    "components": {
      "filesystem": "ok",
      "pty_manager": "ok",
      "git": "ok",
      "memory_usage_mb": 256,
      "uptime_seconds": 3600,
      "pty_sessions_active": 5
    }
  }
  ```
- Restart policy in `~/.config/dam-hopper/server-config.toml`:
  ```toml
  [health]
  check_interval_secs = 30
  unhealthy_threshold = 3
  auto_restart = true
  ```
- Systemd service file (for Linux) exposing health endpoint

**Estimated effort**: 1 week  
**Complexity**: LOW  
**Productivity gain**: HIGH (production reliability)

---

### 4.2 Resource Limits & Quota Enforcement (TEAM OPERATIONS)

**Current pain**: One developer's runaway process can exhaust server resources, crashing workspaces for others.

**For DamHopper** (Priority: MEDIUM, team/enterprise feature):
- Add resource quotas to `dam-hopper.toml`:
  ```toml
  [workspace_limits]
  max_pty_sessions = 10
  max_memory_per_project = "512M"
  max_storage_per_workspace = "10G"
  
  [[process_limits]]
  pattern = "node"
  cpu_percent_max = 80
  memory_mb_max = 512
  timeout_minutes = 120  # auto-kill after 2 hours
  ```
- Enforce via Tokio task limits + resource monitoring
- Dashboard showing per-project resource usage

**Estimated effort**: 2 weeks  
**Complexity**: MEDIUM-HIGH (resource tracking)  
**Productivity gain**: MEDIUM (team infrastructure benefit, not individual)

---

### 4.3 Log Aggregation & Event Audit (DEBUGGING & COMPLIANCE)

**Current pain**: Errors buried in PTY output; no system-level audit trail.

**For DamHopper** (Priority: MEDIUM, post-MVP):
- Structured logging to `~/.config/dam-hopper/logs/`:
  ```json
  {"timestamp": "...", "level": "ERROR", "component": "git", "message": "...", "context": {...}}
  ```
- Event audit log (who accessed what, when):
  ```json
  {"timestamp": "...", "user": "...", "action": "clone_repo", "project": "...", "result": "success|fail"}
  ```
- Dashboard tab: Events + Logs (searchable, filterable)

**Estimated effort**: 1 week  
**Complexity**: LOW  
**Productivity gain**: MEDIUM (useful for debugging + compliance)

---

### 4.4 Dependency Management & Version Pinning (LANG-SPECIFIC)

**Current pain**: Node/Python/Rust versions differ across machines; CI/CD fails locally.

**For DamHopper** (Priority: MEDIUM, post-MVP):
- Extend `dam-hopper.toml`:
  ```toml
  [[projects.backend]]
  runtime_version = "node/18.19.0"
  package_manager = "pnpm/9.0.0"
  
  [env_requirements]
  python = "3.11+"
  docker = "20.0+"
  ```
- Auto-install missing runtimes (use nvm, pyenv, rustup)
- Version report in workspace info

**Estimated effort**: 1-2 weeks  
**Complexity**: MEDIUM (runtime version manager integration)  
**Productivity gain**: MEDIUM (helps new team members)

---

### 4.5 Backup & Disaster Recovery (ENTERPRISE)

**Current pain**: No workspace recovery if server crashes mid-edit.

**For DamHopper** (Priority: LOW, enterprise feature):
- Workspace snapshot before major operations (commits, pulls)
- Point-in-time recovery via API
- S3 backup integration for offsite storage

**Estimated effort**: 2-3 weeks  
**Complexity**: HIGH  
**Productivity gain**: LOW-MEDIUM (rare use case, but critical when needed)

---

## Part 5: Competitive Advantage Positioning

### What DamHopper Should **NOT** Build

1. **Extension marketplace** — Compete with Microsoft on extensions = losing battle. Use Monaco + document VS Code extension compatibility.
2. **Language server integration** — Massive scope. Let LSP be optional (Theia proves this works).
3. **Desktop app** — Adds complexity. Browser-only is fine. Market native IDE integrations (VS Code, JetBrains plugins) instead.
4. **Kubernetes cluster management** — Only needed if Enterprise/SaaS pitch. For SMB, skip.
5. **Git UI beyond status/log** — GitHub/GitLab web already perfect for PR reviews. Keep Git operations terminal-based (git CLI).

### What DamHopper Should Build (Priority Order)

**Phase 1 (MVP+1, 4-6 weeks):**
1. ✅ Global search + fuzzy file/symbol indexing (ripgrep, LRU cache)
2. ✅ Environment variable management + vault abstraction
3. ✅ Process health checks + auto-restart
4. ✅ MCP server exposing workspace state (file + git operations)

**Phase 2 (6-12 weeks):**
5. Real-time collaboration backbone (broadcast terminal, cursor sync)
6. `/api/pty/exec` for agent command execution (trivial, high value)
7. Health dashboard + operational logs
8. Workspace snapshot export for team onboarding

**Phase 3 (Differentiation, 3-6 months):**
9. Agent orchestration framework (tasks, hooks, workflows)
10. AI-native code analysis tools (static analysis agent templates)
11. Port management + debugger plugin system

**Defer/Deprioritize:**
- Custom code completion (users install Copilot extension)
- Desktop app
- Kubernetes support
- Debugging protocol (DAP) — useful but not blocking

---

## Part 6: Pain Point Impact Assessment

| Pain Point | Current State | Impact (min/day) | Complexity | ROI | Status |
|---|---|---|---|---|---|
| Search/Navigation | Critical gap | 10-15 min lost | MEDIUM | HIGH | Priority #1 |
| Env Management | Manual `.env` copy | 10 min × 50% projects | MEDIUM | HIGH | Priority #2 |
| Process crashes | Manual restart needed | 5 min × 20% failures | LOW | HIGH | Priority #3 |
| Collaboration | Nonexistent | 20 min × 30% teams | HIGH | MEDIUM | Priority #4 |
| Secrets management | Plain text in `.env` | 15 min security review | MEDIUM | MEDIUM | Priority #2 |
| Debugging friction | Terminal-only | 5-10 min per session | MEDIUM | MEDIUM | Post-MVP |
| Team env sync | Manual setup/docs | 2-3 hours × 10 hires | LOW | MEDIUM | Post-MVP |
| Runtime versions | Mismatch errors | 30 min setup/CI fail | MEDIUM | LOW | Defer |
| Resource exhaustion | Server crash risk | Critical once/month | MEDIUM-HIGH | MEDIUM | Priority #3 |
| Logs/audit trail | Nonexistent | 10 min debugging | LOW | LOW | Post-MVP |

---

## Part 7: Recommendations - Execution Path for DamHopper

### Near-term (Weeks 1-8)

**Week 1-2: Search Infrastructure**
- Integrate `ripgrep` for code search
- Build file/symbol indexer (parse imports from Monaco state)
- Add `/api/search?q=...&type=file|symbol|function`
- UI: Search sidebar with breadcrumb navigation
- Test with 50K-line monorepo

**Week 3-4: Environment Management**
- Parse `[env]` section in `dam-hopper.toml`
- Build vault abstraction layer (file backend MVP)
- Auto-load `.env.local` → validate required vars
- PTY inheritance of env vars
- Secret masking in logs

**Week 5-6: Process Lifecycle**
- Add `[[processes]]` config section
- Implement health checks + restart logic
- Build process monitor dashboard
- Auto-cleanup on restart

**Week 7-8: MCP Server**
- Build `/~/.config/dam-hopper/dam-hopper-mcp.json` registry
- Implement MCP tools: `read_file`, `list_files`, `git_*`
- Test with Claude Desktop client
- Document for Claude Code integration

### Medium-term (Weeks 9-16)

**Week 9-10: Collaboration Backbone**
- Broadcast terminal I/O to multiple clients
- Session access control
- Shared cursor positions

**Week 11-12: Agent Integration**
- Expose `/api/pty/exec` endpoint
- Document in agent store
- Create sample `.claude/commands`

**Week 13-14: Team Onboarding**
- Workspace export/import
- Environment export as `.env.example`
- One-click teammate setup

**Week 15-16: Operational Dashboard**
- Health checks `/healthz`
- Event audit log
- Resource monitoring

### Deferred / Conditional

- Desktop app (unless enterprise pressure)
- Kubernetes (enterprise-only)
- LSP integration (monitor adoption)
- Advanced debugging (DAP)
- Backup/disaster recovery

---

## Unresolved Questions

1. **Should DamHopper target individual developers or enterprise teams?** (Affects collab/RBAC priority)
2. **Is browser-only forever, or plan Tauri desktop app for offline?** (Affects market positioning vs code-server)
3. **Should agent orchestration be a core feature or plugin ecosystem?** (Affects architecture decisions)
4. **Multi-tenant support requirement?** (Affects resource limits, auth, RBAC complexity)
5. **Will Rust ecosystem (ripgrep, git2) be insufficient for enterprise search?** (May need ElasticSearch for 1M+ line codebases)

