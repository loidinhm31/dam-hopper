# Phase 01 — Resolver and Precedence Matrix

Priority P2 · Status pending · Effort 3h

## Context and requirements
- [Canonical decisions and acceptance](./plan.md), [approved report](../reports/brainstorm-261028-2330-sqlite-default-backend-selection.md).
- Existing selection/path/error code: `server/src/auth/config.rs:1-163`; tests `:165-371`; re-export `server/src/auth/mod.rs:14`.
- Existing parser returns bool and conflates automatic with explicit false. Preserve these as three states. Existing `Mongo` unit variant forces startup to re-read unvalidated env; resolved config should carry validated credentials.
- No environment mutation, I/O, Mongo connection, or database creation in the pure resolver. Existing collision method remains I/O-aware and separate.

## Architecture and exact interface
Modify existing `AuthBackendConfig` in place, no compatibility shim:
- `Mongo { uri: String, database: String }` carries validated trimmed configuration.
- `Sqlite { path: PathBuf, explicit: bool }` distinguishes forced SQLite from automatic default for startup logs; no separate backend variable or unnecessary abstraction.
- `resolve(lite_mode: Option<&OsStr>, sqlite_path: Option<&OsStr>, mongodb_uri: Option<&OsStr>, mongodb_database: Option<&OsStr>, context: &PathContext<'_>) -> Result<Self, AuthConfigError>`.
- `from_env()` retains zero-argument API; snapshots all four env inputs once and forwards them. `main.rs` does not inject another independent set of environment reads.
- `parse_lite_mode` returns `Result<Option<bool>, AuthConfigError>`: `None` automatic; `Some(true/false)` explicit selection.
- Add variable-specific error variants for incomplete and malformed Mongo configuration. Error text never includes URI values, passwords, or credentials. Do not derive unredacted Debug for credential-bearing config; implement redacted Debug if needed by assertions.

## Task: resolve-auth-backend
1. Update module/variant docs and add Mongo environment constants beside existing constants; remove old statements that absence selects Mongo or prohibits configuration-based selection.
2. Parse selector first; invalid/non-Unicode selector fails regardless of Mongo inputs. Explicit true resolves only SQLite path and ignores even malformed/non-Unicode Mongo input.
3. Otherwise classify each Mongo input as unset, configured nonblank UTF-8, or malformed set value. Empty/whitespace/non-Unicode values are errors, never silently converted to absent. Trim only outer whitespace; do not rewrite URI/database contents.
4. Both configured → Mongo. Both unset with automatic selector → default SQLite. Every other combination → actionable fatal configuration error. Explicit false never selects SQLite.
5. Diagnostic guidance: set BOTH Mongo variables, or genuinely unset BOTH for default SQLite, or explicitly choose true. False-without-config guidance must acknowledge that false intentionally enforces Mongo.
6. Resolve SQLite path only on SQLite branches. Preserve existing default config directory, `~/`, CWD-relative, empty override, unsupported URI/memory paths, and collision checks. Mongo ignores an invalid SQLite override.
7. Migrate every constructor/pattern in this file and `auth/mod.rs` only if re-export changes are actually needed; phase 02 owns `main.rs` callsite migration. Do not leave old API wrappers. These dependent phases land as one coherent change before verification.
8. Replace obsolete default-Mongo assertions with table-driven matrix tests, keeping existing path/collision tests. Assert selected payload/provenance and structured error variants, not just text.

## Unit coverage matrix
- Selector: unset, empty, whitespace, true/false/1/0, mixed case and padded valid values; invalid strings and Unix non-Unicode values.
- Mongo pairs: unset/unset; valid/valid; each partial direction; empty and whitespace in either/both variables; non-Unicode in either variable (Unix).
- Explicit true across all Mongo combinations, including malformed URI and non-Unicode inputs; explicit false + missing/blank is always error.
- Automatic valid Mongo ignores unsupported SQLite override; automatic unset Mongo validates it.
- Default path, empty override, XDG-equivalent injected `PathContext`, tilde/CWD forms, no HOME, unsupported path forms, same-file/hard-link session and telemetry collisions.
- Error and Debug output do not disclose a sentinel credential embedded in Mongo URI. URI syntax/connectivity validation belongs to driver/startup, not a duplicate parser here.

## Files and ownership
Modify `server/src/auth/config.rs`; conditionally modify its existing re-export in `server/src/auth/mod.rs`. No files created/deleted. The phase 01 implementer exclusively owns these files until handoff.

## Risks, security, rollback
- Largest risk: accidental unset/blank conflation, especially dotenv `MONGODB_URI=`. Preserve original presence before trimming and cover both directions.
- Secret-bearing enum Debug becomes a new leak unless redacted. Never log the resolved config wholesale.
- Allocations are startup-only; move owned credentials into startup, do not clone URI/database during dispatch. Path helper remains reused, not copied.
- Rollback coordinated with phase 02; restore prior signatures/tests together, never leave mixed enum shapes. No stored data changes.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "resolve-auth-backend",
    "title": "Implement pure tri-state backend selection and precedence tests",
    "blocked_by": [],
    "allowed_files": ["server/src/auth/config.rs", "server/src/auth/mod.rs"],
    "constraints": ["Use the final matrix in plan.md; only genuinely unset Mongo variables allow default SQLite.", "Keep existing path and collision behavior; no schema, adapter, crypto, or runtime lock changes.", "Explicit true ignores all Mongo input; redact credential-bearing diagnostics and Debug.", "Do not run checks mid-flight; coordinator verifies coherent dependent changes once assembled."],
    "acceptance": ["All selector/Mongo combinations resolve according to the final matrix with payload and SQLite provenance.", "from_env snapshots all backend inputs once; all local constructors and existing path tests use the new interface.", "Malformed configuration errors name offending variables without exposing values."],
    "verification": ["After phase 02 lands, coordinator runs cargo test --manifest-path server/Cargo.toml --lib auth::config::tests and records matrix/path/error outcomes.", "Coordinator reviews error and Debug output against sentinel Mongo credentials; no environment-dependent unit cases."]
  }
]
```

- [ ] <!-- evcrate-task:resolve-auth-backend --> Implement resolver and unit matrix

## Handoff
Phase 02 consumes the exact enum/signature above. Successful authoring is not a passing unit-test result. Escalate any additional writable file before editing it.
