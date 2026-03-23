---
parent: plan.md
phase: "03"
status: done
priority: P2
effort: 1h
depends_on: phase-01
---

# Phase 03: Global XDG Config

## Context

- Parent: [plan.md](./plan.md)
- Depends on: Phase 01 (`loadWorkspace()` chain must exist first)
- XDG spec: `$XDG_CONFIG_HOME/dev-hub/config.toml` (default: `~/.config/dev-hub/config.toml`)

## Overview

Add a lowest-priority fallback: a global user config file that persists a default
workspace path. Enables zero-argument dev-hub invocations to always resolve the
correct workspace without setting env vars.

**Status:** done | **Review:** unreviewed | **Date:** 2026-03-22

## Key Insights

- XDG spec: `XDG_CONFIG_HOME` env var defaults to `~/.config`
- Global config is a **separate TOML from `dev-hub.toml`** — holds meta-config (defaults),
  not workspace project definitions
- `readGlobalConfig()` belongs in `@dev-hub/core` so both CLI and server can consume it
- `[defaults] workspace` value = directory or file path, same normalisation applies
- Deferred intentionally — env var (Phase 01) covers CI/scripted use; XDG is quality-of-life

## Requirements

1. New `packages/core/src/config/global.ts`:
   - `globalConfigPath()` — returns resolved XDG path
   - `readGlobalConfig()` — parses global TOML; returns `null` if absent (never throws)
   - `GlobalConfig` type: `{ defaults?: { workspace?: string } }`
2. Integrate into `loadWorkspace()` as step 4 (after walk-up returns null)
3. Export `readGlobalConfig`, `globalConfigPath`, `GlobalConfig` from `@dev-hub/core`
4. Optional: `dev-hub config set workspace <path>` command
5. Tests mocking `XDG_CONFIG_HOME`

## Architecture

### New `packages/core/src/config/global.ts`

```typescript
import { join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";

export interface GlobalConfig {
  defaults?: { workspace?: string };
}

export function globalConfigPath(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgHome, "dev-hub", "config.toml");
}

export async function readGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const raw = await readFile(globalConfigPath(), "utf-8");
    return parse(raw) as GlobalConfig;
  } catch {
    return null; // absent or unreadable — not an error
  }
}
```

### Integration in `loadWorkspace()` (Step 4 — after walk-up fails)

```typescript
// Step 4: XDG fallback (only if walk-up found nothing)
if (!configPath) {
  const globalCfg = await readGlobalConfig();
  if (globalCfg?.defaults?.workspace) {
    cwd = resolve(globalCfg.defaults.workspace);
    // Re-apply stat normalisation then retry findConfigFile(cwd)
  }
}
```

### Optional `dev-hub config set workspace <path>`

New file: `packages/cli/src/commands/config.ts`
Writes `[defaults]\nworkspace = "<path>"\n` to `globalConfigPath()` atomically.

## Related Code Files

- `packages/core/src/config/global.ts` (new)
- `packages/core/src/config/index.ts` — add exports
- `packages/core/src/index.ts` — re-export `GlobalConfig`, `readGlobalConfig`, `globalConfigPath`
- `packages/cli/src/utils/workspace.ts` — add Step 4
- `packages/cli/src/commands/config.ts` (new, optional)
- `packages/cli/src/index.ts` — register config command (optional)

## Implementation Steps

1. Create `packages/core/src/config/global.ts`
2. Export from `packages/core/src/config/index.ts` and `packages/core/src/index.ts`
3. In `loadWorkspace()`: add Step 4 after walk-up null case
4. (Optional) Create `packages/cli/src/commands/config.ts` with `config set workspace`
5. Add tests:
   - Mock `XDG_CONFIG_HOME` via env var pointing at temp dir
   - Write temp global config; verify `loadWorkspace()` uses it as fallback
   - Verify env var (`DEV_HUB_WORKSPACE`) still overrides global config
   - Verify missing global config is silently ignored

## Todo

- [x] Create `packages/core/src/config/global.ts`
- [x] Export from core index files
- [x] Integrate into `loadWorkspace()` as Step 4
- [x] (Optional) Create `dev-hub config set workspace` command
- [x] Add XDG tests

## Success Criteria

- `~/.config/dev-hub/config.toml` with `[defaults] workspace = "/path"` causes bare
  `dev-hub status` (from unrelated dir) to load that workspace
- `XDG_CONFIG_HOME=/custom/path` is respected
- Missing global config is silently ignored
- `DEV_HUB_WORKSPACE` env var still overrides global config

## Risk Assessment

- **Low** — global config is read-only during resolution; no mutation of workspace config
- **Low** — silent ignore of absent file prevents startup failures on fresh installs

## Security Considerations

- Path from global config goes through same `resolve()` + stat normalisation
- Global config file should not be created with world-write permissions (mode 0o600)
- Warn if `defaults.workspace` points to a non-existent directory

## Next Steps

→ Plan complete. All phases implemented = full layered workspace resolution.
