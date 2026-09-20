# Phase 01 — Path and config normalization

## Context links

- Parent: [plan.md](./plan.md)
- Scout: [Windows codebase locations](../reports/scout-260919-2248-windows-codebase-locations.md)
- Architecture: [system architecture](../../docs/system-architecture.md), [configuration guide](../../docs/configuration-guide.md)
- Existing safe pattern: `server/src/fs/sandbox.rs:8-21,165-189`
- Existing target identity: `server/src/workspace_target.rs:562-706`

## Overview

**Priority:** P1  
**Status:** DONE (2026-09-20 16:18:03 +07:00; 100%; 2.5/2.5h)
**Goal:** Make config loading/writing and workspace-target comparisons stable on Windows without changing the registry schema or filesystem authorization contract.

The current config parser uses `Path::canonicalize()` at `server/src/config/parser.rs:35-42` and `249-255`; Windows may return `\\?\` paths. The existing sandbox already uses `dunce::canonicalize` to remove that representation, while `workspace_target::target_path_identity` already normalizes separators, strips extended drive/UNC prefixes, and lowercases Windows identities (`server/src/workspace_target.rs:631-649`). This phase applies those conventions consistently at config boundaries and removes hand-built invalid Windows TOML from tests.

## Key Insights

- Canonical paths are compared, stored in session metadata, and used as sandbox roots; a prefix mismatch can look like a different worktree or cause a valid cwd to be rejected.
- TOML basic strings treat backslashes as escapes. Interpolating `Path::display()` into `path="..."` is invalid for Windows paths containing `\U`, `\t`, or similar sequences (`server/src/config/tests.rs:291-305,371-385,400-414,443-457`).
- `project_path_for_toml` already converts relative paths to `/` (`parser.rs:465-479`), but terminal cwd serialization still calls `to_string_lossy()` without slash normalization (`parser.rs:535-560`).
- Absolute paths must remain absolute and semantically unchanged. Let `toml::to_string_pretty` own TOML escaping; do not manually add backslashes or strip meaningful UNC server/share components.
- `target_path_identity` is the single comparison contract for case-insensitive Windows paths, mixed separators, and `\\?\UNC\...` aliases. Do not introduce a second normalizer in API handlers.
- Additional path-identity consumers use `std::path::Path::canonicalize`: disk selection (`server/src/system.rs:230-242`) and agent import/symlink checks (`server/src/agent_store/importer.rs:63-123`, `server/src/agent_store/distributor.rs:488-506`). They need the same `dunce` representation boundary or an explicit shared identity comparison.

## Requirements

### Functional

1. Read and write config paths through `dunce::canonicalize` with the current fallback behavior for a not-yet-created file.
2. Remove Windows extended prefixes at the canonicalization boundary (`\\?\C:\...` → `C:\...`; `\\?\UNC\server\share\...` → `\\server\share\...`) without changing the underlying path.
3. Serialize relative registry paths and terminal cwd values with forward slashes; serialize absolute values through the TOML serializer so backslashes are escaped correctly.
4. Preserve relative-to-config resolution, absolute project support, env-file/terminal-cwd traversal rejection, and `config_path` identity.
5. Keep workspace target matching/relative-path derivation stable for mixed slash, case, and extended UNC aliases.
6. Audit disk/workspace and agent-store path identity consumers so Windows canonical paths cannot diverge only because of a `\\?\` prefix.

### Non-functional

- Reuse existing `dunce` and `target_path_identity`; no new path crate or global path rewrite.
- Keep path values as `Path`/`PathBuf` until the documented TOML/JSON boundary.
- No schema, API field, or migration change.
- Add deterministic tests for Windows-only behavior; keep POSIX behavior and literal POSIX backslashes unchanged.

## Architecture

```text
config file -> dunce canonical config path -> config directory
           -> resolve project paths -> AppState/sandbox roots
           -> TOML value tree -> toml::to_string_pretty -> atomic write

terminal/worktree request -> WorkspaceTargetResolver
                         -> dunce canonical existing path
                         -> target_path_identity (slash + UNC + case)
                         -> containment/relative comparison
```

`dunce::canonicalize` is used only where an existing filesystem identity is required. Lexical target checks continue to use `normalize_target_path` and `target_path_identity` so removed worktrees remain addressable for cleanup. Serialization normalizes syntax but never changes authorization roots.

## Related code files

### Modify

- `server/src/config/parser.rs:15-56,234-262,465-560` — canonical config path helper; TOML path and terminal-cwd serialization.
- `server/src/config/tests.rs:290-516,580-685` — valid Windows TOML fixtures, slash/UNC/round-trip assertions.
- `server/src/workspace_target.rs:562-706` — reuse/clarify canonicalization and target identity; add only missing regression coverage.
- `server/tests/workspace_targets.rs:74-167` — compare target paths through the platform identity contract rather than raw display strings.
- `server/src/system.rs:230-242` — use the same Windows-safe canonical representation for workspace disk selection.
- `server/src/agent_store/importer.rs:63-123` — use Windows-safe canonical source/selected paths while retaining traversal checks.
- `server/src/agent_store/distributor.rs:488-506` — compare existing symlink targets through the Windows-safe canonical representation.

### Reuse/reference only

- `server/src/fs/sandbox.rs:8-21,165-189` — established `dunce` boundary and containment behavior.
- `server/src/git/cli_fallback.rs:246-294` — existing `dunce` worktree matching pattern.
- `server/src/fs/ops.rs:840-845` — existing forward-slash relative API path convention.

### Create/delete

- No new production file; no file deletion.

## Preflight Contract

- Before editing, capture the current parser/workspace-target test baseline and confirm the target is Windows MSVC.
- Do not use `std::fs::canonicalize` for a value later compared with a user-facing Windows path unless it is immediately passed through the same identity normalizer.
- Keep all test config paths TOML-valid; use a serializer or literal TOML strings, never raw `display()` interpolation into a basic string.
- A missing config file may fall back lexically; an existing path must use `dunce::canonicalize` and retain the current error/fallback semantics.

## Implementation Steps

1. Add a small parser-local canonicalization helper (or reuse the existing module convention) that calls `dunce::canonicalize` and falls back to the supplied path. Use it in `parse_config_str_at_path` and `write_config`; keep `atomic_write` and config-directory selection unchanged.
2. Audit `system::select_workspace_disk` and agent-store importer/distributor path comparisons. Replace representation-sensitive `std::fs::canonicalize` calls with `dunce::canonicalize` where an existing path is required; retain lexical fallback, `..` rejection, and symlink containment behavior.
3. Audit `project_path_for_toml` and terminal cwd serialization. Keep relative paths `/`-normalized; convert terminal relative cwd separators to `/`; pass absolute strings as `toml::Value::String` to `toml::to_string_pretty` rather than hand-escaping.
4. Preserve UNC semantics explicitly: normalize only the extended prefix, not the server/share or drive. Ensure `PathBuf` comparisons use `target_path_identity` and not display-string equality.
5. Add/adjust config fixture helpers. On Windows, construct TOML through `toml::Value`/serialization or use literal strings; assert read/write round trips for drive paths, mixed separators, and verbatim drive/UNC aliases. Keep traversal and absolute env-file/cwd rejection tests cross-platform with valid input.
6. Add target resolver and disk-selection regressions for mixed separator/case and `\\?\UNC\SERVER\SHARE\Project` aliases. Assert `target_path_relative` returns a stable slash-neutral relative path, disk selection still picks the owning mount, and containment never crosses a sibling root.
7. Review all callers of `write_config`, workspace target serialization, and agent-store path checks for assumptions about a `\\?\` prefix; update only call-site assertions that should use the identity helper.

## Todo list

- [x] Replace parser `canonicalize()` calls with the `dunce` boundary.
- [x] Audit system disk selection and agent-store path comparisons.
- [x] Normalize terminal relative cwd separators before TOML serialization.
- [x] Remove raw Windows path interpolation from config tests.
- [x] Cover extended drive and UNC paths, case changes, and mixed separators.
- [x] Normalize integration target assertions with `target_path_identity`.
- [x] Confirm POSIX literal backslashes remain unchanged on non-Windows.

## Success Criteria

- Windows config read/write round trips preserve every project path and emit valid TOML.
- No persisted or returned canonical path unexpectedly contains a `\\?\` prefix unless explicitly supplied as an input contract.
- Relative TOML paths use `/`; absolute TOML paths remain absolute and parse back to the same `PathBuf`.
- Workspace-target tests pass for root, worktree, mixed separators, case aliases, and extended UNC aliases.
- Traversal, sibling-root, symlink, and missing-target rejection behavior is unchanged.

Validation: run the focused parser and workspace-target tests on Windows first; Phase 03 owns the full suite. Run the equivalent Linux focused tests later to prove no POSIX regression.

## Risk Assessment

- **Prefix stripping too broad:** Could turn a literal filename into a different path. Mitigate by recognizing only exact extended drive/UNC prefixes and testing server/share preservation.
- **Serializer/test mismatch:** A test could pass with a hand-built string while production writes via TOML. Mitigate by serializing test values through the same `toml` API.
- **Case folding on non-Windows:** Could weaken POSIX identity. Keep all lowercasing and slash conversion inside `cfg(windows)`.
- **Removed worktree behavior:** Over-eager canonicalization can reject cleanup paths. Keep lexical normalization and identity fallback in `workspace_target.rs`.

## Security Considerations

- Path normalization is not authorization. Continue validating `..`, canonicalizing existing paths, and checking `target_path_is_within` against the authorized root.
- Do not allow UNC normalization to bypass a project root or convert a foreign share into a local path.
- Preserve symlink/reparse-point checks in `WorkspaceSandbox`; `dunce` is only a representation fix.
- Keep atomic config writes and current file permissions; never log full secrets or untrusted path contents beyond existing error messages.

## Side-Effect Review Checklist

- [x] `config_path` remains the authoritative file and is still resolved relative to the loaded registry.
- [x] `env_file` and terminal `cwd` remain project-relative and reject absolute/traversal input.
- [x] API/JSON paths retain their existing separator contract; only TOML relative syntax changes.
- [x] Linux path identity remains case-sensitive and does not treat `\\` as `/`.
- [x] No generated TOML, temp directory, or test log remains after focused tests.

## Next steps

Phase 01 DONE (2026-09-20 16:18:03 +07:00; review 9.2/10). Hand the normalized path contract to Phase 02. Phase 02 must use the same target identity helper for integration assertions and must not reintroduce raw path-string comparisons. Phase 03 records round-trip examples in Windows documentation.
