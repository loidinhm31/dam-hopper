# CLI Workspace/Config Path Resolution Patterns

**Date:** 2026-03-22 | **Scope:** Industry patterns for workspace resolution in CLI tools

---

## 1. Priority Ordering (Industry Consensus)

| Priority    | Mechanism            | Examples                                       |
| ----------- | -------------------- | ---------------------------------------------- |
| 1 (highest) | CLI flag             | `--git-dir`, `--manifest-path`, `--kubeconfig` |
| 2           | Environment variable | `GIT_DIR`, `KUBECONFIG`, `CARGO_MANIFEST_PATH` |
| 3           | CWD walk-up          | git `.git`, cargo `Cargo.toml`, nx `nx.json`   |
| 4 (lowest)  | Global default       | `~/.kube/config`, `~/.config/<tool>`           |

**Key nuance:** Git disables walk-up entirely when `GIT_DIR` is set (treats it as absolute anchor). Cargo always walks up regardless. kubectl skips walk-up entirely and goes straight to `~/.kube/config` if env var absent.

**Recommendation for dev-hub:** flag → `DEV_HUB_WORKSPACE` env var → CWD walk-up → `~/.config/dev-hub/config.toml`

---

## 2. Environment Variable Naming

Standard: `UPPERCASE_TOOL_CONTEXT` — matches tool/module scope.

| Tool               | Env Var                    |
| ------------------ | -------------------------- |
| git                | `GIT_DIR`, `GIT_WORK_TREE` |
| kubectl            | `KUBECONFIG`               |
| cargo              | `CARGO_MANIFEST_PATH`      |
| helm               | `HELM_KUBECONTEXT`         |
| dev-hub (proposed) | `DEV_HUB_WORKSPACE`        |

---

## 3. Commander.js: Global Options & Subcommands

**Core limitation:** Global options on `program` MUST appear before the subcommand:

```bash
dev-hub --workspace /path status   # ✓ works
dev-hub status --workspace /path   # ✗ fails — Commander stops parsing at subcommand boundary
```

**Solutions:**

1. **`program.enablePositionalOptions()` + `.passThroughOptions()`** on subcommands — still requires flag before subcommand
2. **Add option to each subcommand** — redundant but intuitive UX; combine with global via `optsWithGlobals()`
3. **Env var + global flag hybrid** — most tools do this; env var covers the "after" case implicitly
4. **Pre-parse `process.argv`** — strip `--workspace` before Commander sees it (fragile, not recommended)

**Best practice:** Accept both global flag (before subcommand) AND env var. Users who want to set workspace per-session use `export DEV_HUB_WORKSPACE=/path`.

---

## 4. XDG Base Directory Spec

```
Primary:  $XDG_CONFIG_HOME/dev-hub/config.toml  (defaults to ~/.config/dev-hub/config.toml)
System:   $XDG_CONFIG_DIRS/dev-hub/config.toml  (defaults to /etc/xdg/dev-hub/config.toml)
```

Global config format (proposed):

```toml
[defaults]
workspace = "/path/to/my/workspace"
```

Node.js pattern: `process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')`

---

## 5. Workspace Root Detection (Monorepo Tools)

| Tool      | Detection Strategy                                                    |
| --------- | --------------------------------------------------------------------- |
| turborepo | Walks up from CWD to find `turbo.json` (v1) or `turbo/config.ts` (v2) |
| nx        | `workspaceRoot` computed from package.json walk-up                    |
| lerna     | `lerna.json` walk-up from CWD                                         |
| cargo     | `Cargo.toml` with `[workspace]` section, walks up                     |

**Common pattern:** Walk up until home dir or filesystem root, stop at first match.

---

## Key Recommendations

1. Use `DEV_HUB_WORKSPACE` (directory OR file path)
2. Support `--workspace` before subcommand (global flag) — document this clearly
3. XDG global config as lowest-priority fallback
4. Env var eliminates the "must precede subcommand" UX friction
5. Normalize path early (resolve relative → absolute, file → dirname)
