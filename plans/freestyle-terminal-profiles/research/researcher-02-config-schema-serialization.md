# Research: Config Schema & TOML Serialization

## Key Findings

### Current Schema
- `commands: z.record(z.string()).optional()` = `Record<string, string>`
- No metadata per command (no cwd, no description, no name)
- ApiProjectSchema mirrors same structure for IPC validation

### TOML Serialization
- Commands passed AS-IS to smol-toml stringify (no transform)
- On-disk format: `[projects.commands]` with `key = "value"` pairs
- smol-toml supports nested objects: `[projects.commands.key]` syntax

### CONFIG_UPDATE_PROJECT IPC
- Shallow merge: `{ ...existing, ...patch }` — replaces entire `commands` object
- Validates via ApiProjectSchema before write
- Atomic write via temp file + rename

### Design Decision: New Top-Level Section vs Extending commands

**Option A: Extend `commands` to accept objects** (breaking change)
- Requires dual-acceptance schema (string | object) for backward compat
- Complicates existing command resolution in CommandService
- TOML format change: `key = "string"` → `[projects.commands.key] command = "..." cwd = "..."`

**Option B: New workspace-level `[[terminals]]` array** (additive, non-breaking)
- Separate from project-level commands
- Workspace-scoped: not tied to any single project
- Clean TOML: `[[terminals]]` with name, command, cwd fields
- No backward compat concerns
- Better matches "freestyle" concept (arbitrary paths, not project-bound)

**Recommendation: Option B** — cleaner separation, no migration needed, better UX model
