# Backend, Configuration, and Documentation Retirement Strategy

Baseline: worktree commit `abba947c` (post-merge `origin/main`).

## 1. Native Backend Service & State Deletion Obligations
- **State (`server/src/state.rs`)**:
  - Delete `advisor_service: Arc<crate::advisor::AdvisorService>` (line 137) and `advisor_settings_lock: Arc<tokio::sync::Mutex<()>>` (line 139) from `AppState`.
  - In `AppState::new()`, delete constructor initialization for `advisor_service` and `advisor_settings_lock` (lines 430-433).
  - Delete `AppState::with_advisor_service()` method (lines 438-444).
  - Clean up any unused imports (`crate::advisor`, etc.).
- **Server Module & Routes (`server/src/lib.rs`, `server/src/api/mod.rs`)**:
  - Remove `pub mod advisor;` from `server/src/lib.rs` and delete entire `server/src/advisor/` module tree.
  - Remove `pub mod advisor;` and route mounting (`/api/advisor/*`) from `server/src/api/mod.rs` and delete `server/src/api/advisor.rs`.
  - Delete all advisor unit/integration test files in `server/tests/`.

## 2. Server Configuration & Replacement Guard
- **Configuration Schema (`server/src/config/schema.rs`)**:
  - Remove `pub advisor: AdvisorConfig` field from `ServerConfig` (line 670).
  - Remove `self.advisor.validate()?;` from `ServerConfig::validate()` (line 697).
  - Remove `advisor: AdvisorConfig::default()` from `ServerConfig::default()` (line 713).
  - Delete struct `AdvisorConfig` and `impl AdvisorConfig` (lines 718-729).
- **Protected Config Replacement Guard (`server/src/config/replacement.rs`)**:
  - Delete lines 20-24 (`candidate.server.advisor != current.server.advisor` check).
  - Config replacement validation preserves existing checks for `idle_suspend` and `telemetry` only.
- **Legacy `[server.advisor]` Behavior**:
  - Clean cutover: no compatibility shim, no deprecated alias, no runtime migration warning.
  - Rely on standard Serde/TOML parser behavior for unmapped keys (ignore or error per parser settings).

## 3. Documentation Retirement & Preservation Strategy
- **Dedicated Advisor Docs (Delete Completely)**:
  - `docs/architecture/native-advisor.md` (fully native advisor architecture).
  - `docs/configuration/advisor.md` (advisor configuration details).
  - DO NOT add deprecation notices, tombstones, or replacement pages.
- **Mixed Documentation (`docs/api/advisor-and-workflow.md`)**:
  - Delete Section 1: "Native Evcrate Advisor API" (lines 4-42), including `/api/advisor/*` endpoints table, query filters, pagination, and error codes.
  - Preserve Section 2: "Workflow Tracking Service and REST API" (lines 43-74) verbatim, including `/api/workflow/*` endpoints, replay keys, CAS optimistic locking, terminal-link state rules, and SQLite session integration.
  - Update top-level title and header in `docs/api/advisor-and-workflow.md` (or rename to workflow API if referenced) without leaving legacy notices.
- **Cross-Referenced Architecture & Summary Docs**:
  - Excise Advisor passages/links from `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/api-reference.md`, and root `README.md`.
  - Preserve newly merged idle-suspend consent / client presence behavior intact.

## 4. Security & Data Ownership
- **External Data Files**:
  - History source `$HOME/.evcrate/advisor-history` and policy file `$HOME/.evcrate/advisor-routing.json` are owned by external Evcrate/OMP processes.
  - NEVER delete, move, or modify external `$HOME/.evcrate/*` files during retirement. DamHopper was strictly a consumer/UI inspector.
- **Operational Harness vs Feature Code**:
  - Strict boundary: DamHopper web UI, REST routes, and server Rust code (`server/src/advisor`, `server/src/api/advisor.rs`) are feature code to delete.
  - External harness files (`.omp/evcrate/*`, `.omp/skills/*`, `~/.omp/agent/*`) are operational orchestration tools and must remain untouched.

## Unresolved Questions
1. Should `docs/api/advisor-and-workflow.md` be renamed to `docs/api/workflow.md` with links updated across `docs/api-reference.md`, or kept at its current filename with advisor sections excised?
2. Does `DamHopperConfigRaw` / `config::loader` have strict `deny_unknown_fields` that would reject existing user configs containing `[server.advisor]`, or does it ignore unknown keys?