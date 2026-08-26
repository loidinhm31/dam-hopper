# Phase 02 - Parser: Absolute Project Paths

## Context links

- Parent plan: [plan](./plan.md)
- Depends on: [phase-01](./phase-01-global-registry-path.md)
- Feeds: [phase-03](./phase-03-per-project-sandbox.md), [phase-05](./phase-05-config-write-roundtrip.md)
- Research: [config registry research](./research/researcher-01-config-registry.md)

## Overview

Date: 2026-07-12
Description: Let `projects[].path` be absolute or relative while keeping supporting paths strict.
Priority: P1
Implementation status: Completed
Review status: Approved (8.5/10)
Effort: 2h

## Key Insights

- [server/src/config/parser.rs](../../server/src/config/parser.rs) currently calls `validate_relative_path()` on `projects.path`, which blocks absolute registry entries.
- `env_file` should remain relative and traversal-free because it is intended to be project-local.
- `ProjectConfig.path` is already an in-memory string that callers treat as absolute; this phase changes how it is resolved, not the public shape.

## Requirements

- Allow absolute `projects[].path` values.
- Continue rejecting `..` components in both absolute and relative project paths.
- Continue rejecting absolute or traversal-containing `env_file` values.
- Relative project paths still resolve against the config file directory.
- Do not require project directories to exist during parse unless current behavior already does.

## Architecture

Split validation intent:

- `validate_project_path(raw, field)`: absolute allowed, parent-dir components rejected.
- `validate_relative_path(raw, field)`: absolute rejected, parent-dir components rejected. Keep for `env_file`.

Resolution becomes:

```rust
let raw_path = Path::new(&raw.path);
let abs_project_path = if raw_path.is_absolute() {
    raw_path.to_path_buf()
} else {
    config_dir.join(&raw.path)
};
```

## Related code files

- [server/src/config/parser.rs](../../server/src/config/parser.rs)
- [server/src/config/schema.rs](../../server/src/config/schema.rs)
- [server/src/config/tests.rs](../../server/src/config/tests.rs)
- [__fixtures__/workspace/dam-hopper.toml](../../__fixtures__/workspace/dam-hopper.toml)

## Implementation Steps

1. Add `validate_project_path()` in `parser.rs`.
2. Replace only the `projects.path` validator call; leave `env_file` unchanged.
3. Update `resolve_project()` to preserve absolute paths and join only relative paths.
4. Rename or rewrite the existing absolute-path rejection test into acceptance tests.
5. Add Windows-only tests for native drive-letter paths behind `#[cfg(windows)]` and platform-neutral tests for forward-slash absolute paths where applicable.

## Completion Summary

**Test Results:** `cargo test config::tests -j 1` => 55/55 passed
**Code Review:** Final score 8.5/10, approved by user after 3 review cycles
**Implementation Date:** 2026-07-12

**What Was Delivered:**
- ✅ `validate_project_path()` added, allows absolute + relative paths
- ✅ `..` traversal rejected in both absolute and relative project paths
- ✅ `env_file` remains relative-only and traversal-free (no change)
- ✅ Terminal profile `cwd` validated as relative-only and traversal-free
- ✅ Relative paths resolve cleanly against config dir without redundant `./`
- ✅ Parser tests updated and passing for Windows drive-letter + Unix absolute paths

## Success Criteria — All Met

- ✅ TOML with `path = "C:/Users/f2s2/Downloads/dam-hopper"` loads on Windows
- ✅ TOML with `path = "/home/user/project"` loads on Unix
- ✅ TOML with `path = "./local-project"` still resolves against `config_dir`
- ✅ `env_file = "/etc/secrets"` still fails validation
- ✅ Any project or env path with `..` components fails validation

## Optional Follow-ups

User noted optional improvements beyond Phase 02 core scope:
1. Add Windows edge-case coverage for drive-relative and UNC path handling
2. Refactor to normalize relative paths at parse time (vs. resolution time)

## Risk Assessment

- Low code risk: narrow parser change.
- Medium portability risk: Windows paths parsed on non-Windows hosts are not absolute to Rust. Tests should be platform-aware rather than pretending cross-host path semantics work.
- Compatibility risk: existing test names and error messages may need adjustment.

## Security Considerations

- This phase does not grant filesystem access. It only permits the registry to name absolute roots.
- Do not relax `env_file`; secrets should remain project-relative and non-traversing.

## Next steps

- Implement Phase 03 immediately after parser support; parser-only support would let terminals and project APIs diverge from file APIs.
