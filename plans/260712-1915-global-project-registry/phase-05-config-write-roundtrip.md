# Phase 05 - Config Write Roundtrip

## Context links

- Parent plan: [plan](./plan.md)
- Depends on: [phase-02](./phase-02-parser-absolute-paths.md)
- Related: [phase-04](./phase-04-api-state-adjustments.md)
- Feeds: [phase-06](./phase-06-tests-windows-docs.md)

## Overview

Date: 2026-07-12
Description: Preserve clean absolute project paths when writing registry TOML.
Priority: P1
Implementation status: Pending
Review status: Not reviewed
Effort: 2h

## Key Insights

- [server/src/config/parser.rs](../../server/src/config/parser.rs) `project_to_toml()` currently uses `pathdiff` for every project.
- [server/src/api/config.rs](../../server/src/api/config.rs) `relativize_project_paths()` also forces absolute JSON project paths into relative TOML paths before writing.
- For a global registry under the user's config directory, most real project paths will be outside `config_dir`; writing `../../..` chains is unreadable and brittle.

## Requirements

- Preserve absolute project paths when projects are outside the registry directory.
- Keep relative paths for projects inside the registry directory or local workspace configs.
- Keep `read -> write -> read` idempotent for mixed relative/absolute configs.
- Avoid rewriting Windows absolute paths into invalid or surprising forms.
- Do not change non-path config field serialization.

## Architecture

Add a shared helper for TOML path formatting:

```rust
fn project_path_for_toml(abs: &Path, config_dir: &Path) -> String
```

Decision rule:

- If `pathdiff::diff_paths(abs, config_dir)` returns a relative path that does not start with `..`, write that relative path.
- Otherwise write the absolute path.
- Normalize relative TOML paths to forward slashes; preserve absolute native strings.

Use the same rule in `project_to_toml()` and API JSON-to-TOML writing.

## Related code files

- [server/src/config/parser.rs](../../server/src/config/parser.rs)
- [server/src/api/config.rs](../../server/src/api/config.rs)
- [server/src/config/tests.rs](../../server/src/config/tests.rs)
- [server/src/api/tests.rs](../../server/src/api/tests.rs)

## Implementation Steps

1. Add helper function near `project_to_toml()` or in a small config path utility module.
2. Replace direct `pathdiff` logic in `project_to_toml()`.
3. Update `relativize_project_paths()` to keep outside-config absolute paths absolute.
4. Add parser roundtrip tests.
5. Add API config update test for absolute project paths.
6. Verify local workspace configs still write short relative paths.

## Todo list

- [ ] Add project path formatting helper.
- [ ] Update config writer.
- [ ] Update API config writer.
- [ ] Add roundtrip tests.
- [ ] Run focused config/API tests.

## Success Criteria

- Global registry write keeps `C:/Users/.../project` or equivalent absolute path clean.
- Local project under config dir still writes `./project` or `project` rather than an absolute path.
- API config updates do not produce long `../../../../` chains for outside projects.
- Roundtrip tests pass on supported platforms.

## Risk Assessment

- Medium UX risk: preserving native Windows backslashes in absolute TOML strings requires correct TOML escaping.
- Low compatibility risk for local configs if the inside-config rule is implemented correctly.
- Medium duplication risk if parser and API writers use separate rules; prefer one helper.

## Security Considerations

- This is serialization only; do not perform filesystem access in the formatting helper.
- Do not normalize away `..` here; parser validation remains the gate for unsafe paths.

## Next steps

- Phase 06 validates full read/write/restart behavior and updates docs.
