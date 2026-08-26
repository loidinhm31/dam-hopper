# Research: Phase 04 Config API & Reload Semantics

**Date:** 2026-07-13  
**Scope:** Global config registry patterns, reload APIs, state invalidation, legacy field handling  
**Sources:** 5 authoritative references (git-config, XDG basedir, phase-04 code, state.rs, workspace API)

---

## Key Findings

### 1. Config Path Reporting (Authoritative Source)

**Git Model** (per git-config docs):
- Multiple scopes: system, global (XDG_CONFIG_HOME), local, worktree, command-line
- Each operation reports `--show-origin` to indicate which file supplied the value
- Latest value wins in scope-precedence order (command > worktree > local > global > system)

**DamHopper Requirement:**
- Single active registry (`config_path`) at runtime
- API must report `configPath` explicitly in workspace/status responses
- ✅ **Already implemented** in phase-04: both `get_status()` and `get_workspace()` return `configPath` field

**Recommendation:**
- Keep both `root` (legacy) and `configPath` (authoritative) in workspace responses
- CLI: `--show-config-path` flag for tools that need source attribution
- WebSocket push event `workspace:config_changed` on switch to notify clients

---

### 2. Legacy Field Compatibility (Root Field)

**Challenge:** `workspace.root` historically means "workspace parent directory" (sandbox root). After global registry refactor, it becomes ambiguous (config dir vs first project root).

**Git's Approach:**
- Deprecates fields but never removes (14+ years backward compatibility)
- Old field value becomes "informational" not "structural"
- Conditional includes and config scoping replace field-based logic

**DamHopper Implementation:**
- ✅ **Current approach** (phase-04): Keep `workspace_dir` behind Arc<RwLock>; return as `root` in JSON
- ✅ Rename semantic: `root` = "legacy workspace home" not "sandbox boundary"
- ⚠️ **Risk:** Frontend code may rely on `root` for path traversal; audit before release

**Concrete Recommendation:**
1. Document `root` field as deprecated in API schema (e.g., OpenAPI/TypeSpec comment)
2. Add client-side deprecation notice: "Use `configPath` for registry location"
3. Audit frontend: [packages/ui/src/api/client.ts](../../packages/ui/src/api/client.ts) for `root` usage → migrate to `configPath`

---

### 3. Config File vs Directory Switching

**XDG Pattern** (specs):
- `$XDG_CONFIG_HOME` is a directory; specific config files are *within* it
- Apps search for files in order: XDG_CONFIG_HOME > /etc/xdg
- No single "switching" concept; instead config is stateless & searched each invocation

**Git Pattern** (git-config docs):
- `git config --file <path>` accepts explicit file (not directory)
- `git config --local/--global/--system` accepts implied scope (inferred directory)
- **Never mixes:** can't say "use directory but find config inside it"

**DamHopper Current Code** (api/workspace.rs):
- ✅ `POST /api/workspace/init { path }` accepts directory → discovers local `dam-hopper.toml`
- ✅ Phase 04 requirement: `workspace:switch { path }` should accept **config file path** in addition to directory
- New logic: if `path` has `.toml` suffix → load directly; else treat as directory & search for `dam-hopper.toml`

**Implementation (sketch):**
```rust
let config_path = if body.path.ends_with(".toml") {
    PathBuf::from(&body.path)
} else {
    PathBuf::from(&body.path).join("dam-hopper.toml")
};
let cfg = load_workspace_config_from_file(&config_path)?;
// Then reinit sandbox from cfg.projects[].path
```

**Risk:** Symlink attacks if config file path is not normalized; use `canonicalize()` before load.

---

### 4. Rebuilding Derived Security State After Reload

**The Core Issue:**
After config reload (e.g., switching registries), file sandbox & per-project roots must be **atomically updated**. If not, requests could slip through old sandbox boundaries.

**Patterns Found:**

**Git (no direct parallel):**
- Git has no "runtime state" to invalidate; every command re-reads config from disk
- No long-lived sessions → no reload issue

**Kubernetes (closest real-world example):**
- When config changes, controllers invalidate derived state (watches, authorizers, etc.)
- Atomic CAS (Compare-And-Swap) pattern: read config version, lock, re-read, update state, unlock

**DamHopper Phase 04 Implementation** (per code audit):
- ✅ `reload_config()` in `api/config.rs` calls `state.fs.reinit_sandbox(project_roots_from_config(...))`
- ✅ `FsSubsystem::reinit_sandbox()` atomically replaces `allowed_roots` map
- ✅ SSH credential key scope switched from `workspace_dir` to `config_path` to avoid collision

**Remaining Gaps:**
1. ⚠️ Agent store path still tied to initial workspace_dir (noted in code: "Phase 06 follow-up")
2. ⚠️ File watchers (`FsWatcherManager`) attach one watcher per root but not re-initialized on switch
3. ✅ Port forward manager (`PortForwardManager`) operates per PTY, not per workspace → safe

**Concrete Recommendations:**

1. **Add State Version Watermark:**
   ```rust
   pub struct AppState {
       config_version: Arc<AtomicU64>,
       // ...
   }
   // Increment on every successful reload
   reload_config() -> { 
       config_version.fetch_add(1, Ordering::SeqCst);
       reinit_sandbox(...);
   }
   ```
   
2. **Validate Sandbox Before File Ops:**
   Every file API should check that `stored_config_version == current_config_version` before resolving paths.

3. **File Watcher Update Strategy:**
   - Option A (conservative): Stop old watchers, start new ones on switch
   - Option B (incremental): If new roots ⊂ old roots, leave existing; add new ones
   - Recommend **A** for safety (simpler, prevents stale events)

---

### 5. Reload Semantics Across Scenarios

**Scenario 1: `/api/config` PUT (full config replace)**
- Parse JSON → serialize to TOML → atomic write → reload from disk
- ✅ Current code does this correctly
- Verify: atomicity guaranteed by `atomic_write()` utility

**Scenario 2: `/api/workspace:switch { path }` (config file path)**
- Load config from specified path → reload state
- ✅ Phase 04 handles this; must normalize path first

**Scenario 3: `/api/workspace/init { path }` (directory init)**
- Discover or create config → load → initialize fresh state
- ✅ Existing behavior; now ensure sandbox is initialized

**Scenario 4: Concurrent requests during reload**
- Two clients call workspace:switch simultaneously
- Problem: race condition on config RwLock
- Current code: first acquires write lock, second waits. ✅ Correct
- But: verify no deadlock between fs.reinit_sandbox() and in-flight file requests

**Risk Mitigation:**
- Use versioned requests: clients send `config_version` in file API requests
- Server rejects if versions mismatch → client refetches workspace/status and retries

---

## Recommendations for Implementation

| Concern | Recommendation | Priority | Effort |
|---------|---|--|--|
| Report `configPath` in API | ✅ Done in phase-04 | - | 0 |
| Mark `root` field deprecated | Add OpenAPI comment; update docs | P2 | 1h |
| Support config file switching | Allow `.toml` suffix in switch { path } | P1 | 2h |
| Prevent state skew | Add config_version watermark + validation | P1 | 3h |
| File watcher re-init on switch | Stop/restart watchers during reload | P1 | 2h |
| Audit frontend `root` usage | Grep packages/ui; migrate to `configPath` | P1 | 1h |

---

## Risks & Edge Cases

1. **Windows UNC Paths:** `\\?\C:\path\to\dam-hopper.toml` — ensure `ends_with(".toml")` works cross-platform
2. **Symlink Attack:** Config file path must be canonicalized before use; untrusted clients can point to `/etc/shadow`
3. **Stale Clients:** Browser tabs holding old session may use outdated `root` path; add version header to workspace API responses
4. **Agent Store Inconsistency:** Phase 06 TODO; document that agent store is not updated on workspace:switch

---

## Unresolved for Phase 05+

- **Agent Store Rebasing:** When workspace switches, should .dam-hopper/agent-store/ rebase to new registry? (Likely: no; per-instance storage only)
- **Multi-root Watcher Limits:** Is there a max count on concurrent file watchers? Document for large multi-project configs
- **Credential Scope Edge Case:** If user switches config twice, SSH credentials keyed to config_v1 are orphaned. GC strategy?

---

**Status:** Research complete. Phase-04 implementation is structurally sound; focus Phase-05 on atomicity guarantees and client robustness.
