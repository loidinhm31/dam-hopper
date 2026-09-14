# Collector CLI contract research

## Decision record and current surfaces

- Approved decision record: `plans/reports/brainstorm-260911-2355-production-idle-suspend-diagnostics.md:9-18,96-145`.
- Existing CLI is Clap-based (`server/src/linux_release/cli.rs:1-21`), with subcommands represented by `Commands` and re-exported from `server/src/linux_release/mod.rs:69-71`; add one `Diagnose` variant, not a second executable.
- Release layout is the path authority (`server/src/linux_release/layout.rs:15-46`); default systemd unit directory is `/etc/systemd/system`. Unit constants are `API_SERVICE_UNIT` and `HELPER_SERVICE_UNIT` (`server/src/linux_release/constants.rs:23-26,52-60`). Do not duplicate paths in CLI code.
- Existing service/status helpers (`server/src/linux_release/status.rs`, `systemd.rs`, `process.rs`) and fixed `journalctl` usage in `server/src/linux_release/health.rs:258-266` are reusable read-only seams. Do not call release mutators.
- Existing idle status is latest-only/watch-published (`brainstorm:20-23`); existing server/helper JSONL readers/audits are bounded, mode `0600`, and `O_NOFOLLOW` (`brainstorm:24-27`). Collector must expose their limitations, not pretend they are history.

## Exact invocation and defaults

Recommended v1 grammar:

```text
dam-hopper diagnose --json
```

- `--json` is required; no positional path, arbitrary command, URL, or source selector in v1. Fixed all-source scope prevents a partial operator request from being mistaken for complete evidence.
- No automatic sudo. Root (`EUID == 0`) means full-scope attempt; non-root still writes a valid partial bundle and marks helper evidence unavailable (`brainstorm:14-16,139-145`).
- Fixed defaults: incident window = trailing 60 minutes ending at collection start; max 10,000 records per audit source; max final serialized bundle = 8 MiB (`brainstorm:137`). Capture effective `startMs`, `endMs`, limits, and truncation in `request`/`bounds`.
- Keep caps non-configurable at the public CLI boundary initially. If existing config later permits tuning, clamp to hard constants and serialize requested/effective values; never accept unbounded values.
- Output destination should be the existing `Layout`-derived local diagnostics directory (under the DamHopper state root), created/permissioned by the installer. A future output-dir option is unnecessary until a concrete operator need exists; a caller-supplied filename is rejected for symlink/path-confusion risk.

## Allowlisted sources and status taxonomy

Source adapters are fixed and independently report `{status, records, bytes, ...}`. Empty-but-readable is `available` with `recordCount: 0`, never `missing`.

1. Protected current idle-suspend status via the existing authenticated API route; latest/non-historical.
2. Server idle-suspend event/audit JSONL; helper audit/event JSONL.
3. Existing bounded redacted backend diagnostics (`server/src/diagnostics/`); never terminal output.
4. Journald for exactly API and helper units, bounded to the incident window.
5. Read-only systemd properties for exactly those units: active/substate, `MainPID`, `ExecMainStatus`, `InvocationID`, boot identity, and start/exit timestamps.
6. Fixed socket/PID/enrollment evidence from existing release layout/config paths, with secret fields excluded.
7. Fixed RTC wakealarm, suspend capability, and inhibitor snapshots.
8. Fixed current `/proc` and netlink qualification probes, labelled non-historical.

Closed status set: `available`, `missing`, `permissionDenied`, `authRequired`, `malformed`, `truncated`, `retentionLimited`, `notHistorical`. `errors[]` carries a typed code and source; no raw command/error detail. Top-level `completeness` is `complete` only when every required historical source was read within bounds; otherwise `partial`. Current status/proc/netlink/RTC/inhibitor snapshots can be `available` but remain `notHistorical` in their source metadata. Rotation, journal retention, malformed lines, dropped events, and a denied source are explicit partial causes (`brainstorm:135-145`).

Suggested requiredness: server and helper semantic/audit streams, API/helper unit state, and selected unit journal are required for a full root bundle; API status and current probes are best-effort. A missing unit on a role that does not install it should be `missing` with `notApplicable` typed context rather than a false incident failure (confirm against role manifest).

## Privilege, process, and API boundaries

- Determine privilege once from EUID; never invoke `sudo`, setuid helpers, or privilege escalation. Non-root helper-audit access maps to `permissionDenied`/`unavailable` (use the closed source status plus typed error), and exit remains partial.
- Files: open only paths resolved from `Layout`/existing config constants; use no-follow, read-only opens; bounded reads; do not compact, repair, rotate, truncate, or rewrite source logs (`brainstorm:98-112`).
- Systemd/journal: use existing typed wrappers where possible. If a subprocess is unavoidable, fixed executable + fixed argv (`systemctl show`, `journalctl -u <two allowlisted units> ... --no-pager --output=json`, `systemd-inhibit --list`), null stdin, locale `C`, timeout, stdout byte cap, and sanitized/discarded stderr. Never shell, interpolate operator input, use `systemctl status` pager output, or run mutating verbs. Preserve command exit as a typed source error only.
- API: fixed loopback/installed API endpoint and existing auth mechanism; bounded response, deadline, no redirects and no external URL. Auth failure is `authRequired`, not a collector fatal error. No network egress beyond the local API call; no upload/AI credential (`brainstorm:17-18,48-50`).
- Existing status/process/systemd functions should be wrapped behind a collector `SourceProvider`/clock/command seam, so production adapters and deterministic fixtures share one contract.

## Bundle, atomic output, and process semantics

Top-level JSON follows the approved sections: `bundleSchemaVersion`, `generatedAtMs`, `collectorVersion`, `request`, `completeness`, `bounds`, `host`, `idleStatus`, `events`, `serverAudit`, `helperAudit`, `diagnosticEvents`, `journald`, `systemd`, `currentHostProbes`, `correlations`, `privacy`, `errors` (`brainstorm:114-135`). Event, bundle, and helper protocol schemas remain separately versioned.

- Add a collector-only `bundleId`/run identity if useful; never use it as an action `correlationId`. Existing action correlation is one globally unique value from candidate creation through helper completion, and helper wire request ID must be identical (`brainstorm:58-70`).
- Read all sources first, serialize a bounded valid JSON document, then create a temp file in the final directory with exclusive/no-follow semantics and mode `0600`; flush/sync, atomically rename to the final generated name, then sync the directory. Never expose a partially written final name. If destination setup/write/rename/sync fails, no path is printed and exit `1`.
- Stdout is exactly one absolute final path plus newline on successful write, including partial bundles; no progress, JSON, warnings, or command output. Diagnostics go to stderr, bounded and human-readable; stderr must not contain secrets/raw source data. Exit `0` = valid bundle and all required sources complete; exit `2` = valid bundle but any unavailable, malformed, rotated/retention-limited, dropped, or truncated source; exit `1` = cannot safely write a valid bundle (`brainstorm:139-145`).
- Collector itself never changes RTC, suspend, service, audit, config, or source state (`brainstorm:184-195`).

## Correlation, ordering, and redaction

- Join only exact `correlationId`; preserve `bootId`/producer instance, producer-local monotonic sequence, timestamp, mode, revisions, and source offset. Sort deterministically by `(timestampMs, producerInstance, sequence, sourceName, sourceOffset)` after parsing.
- Emit `correlations.chains`, `orphans`, `sequenceGaps`, and `restartBoundaries`. Orphan helper intent/completion, server dispatch without helper outcome, duplicate/unknown IDs, producer boot changes, audit rotation, malformed records, and sequence gaps are evidence discontinuities—not “no activity” and not inferred root causes. Legacy `epoch-N` automatic IDs are not globally safe; classify old records as unjoinable unless the new producer schema supplies a stable ID (`brainstorm:28,186-194,197-203`).
- Serialize only typed semantic records/closed reason codes. Exclude process argv, environment, terminal/PTY bytes, tokens, credentials, raw IPC frames, socket/IP addresses, inhibitor identity, raw helper/systemd/journal detail, and unbounded stderr (`brainstorm:85-94,157-163`). Journal `MESSAGE` should be mapped to an allowlisted reason/code or omitted; cap every string and nested record. Apply one shared redactor before bundle serialization, including source errors and metadata.

## Alternatives rejected and risks

- Rejected observer daemon: duplicate authoritative state machine, lifecycle/permission/upgrade burden, cannot recover unrecorded transitions (`brainstorm:40-46`).
- Rejected continuous telemetry/upload: privacy, credentials, prompt-injection, compliance, storage, and network dependency; not incident reconstruction.
- Insufficient API-only export: API can be unavailable and is latest-only; retain API as optional source.
- Rejected arbitrary shell/operator commands and broad journal dumps: injection, non-determinism, unbounded bytes, private workload leakage.
- Main risks: helper audit unreadable without root; event-write latency/volume; service restarts and rotated logs; malformed legacy records; redaction regressions. Mitigate with semantic-only producer events, bounded append/write paths outside safety locks where safe, explicit source statuses, IDs + boot/sequence data, and shared redaction (`brainstorm:197-203`).

## Deterministic/live validation seams and phase boundary

- Deterministic fixtures: fake clock/window, in-memory or tempdir source files, malformed/rotated/permission fixtures, cap tests, source-status matrix, redaction corpus, correlation orphan/gap/restart cases, and atomic mode/path/stdout assertions.
- Fake command runner asserts exact executable/argv, no shell, locale, timeout, byte cap, and exit mapping; fake API asserts fixed local endpoint, auth-required behavior, bounded body, and no external request. EUID seam proves non-root never attempts sudo and root path includes helper evidence.
- One live smoke only after fixtures: run against an isolated/read-only layout, inspect emitted path, mode, valid JSON, no service/RTC mutation, stdout-only-path, and non-root partial behavior.
- Recommended phase boundary: first freeze separately versioned event/protocol/bundle schemas, source allowlist/status taxonomy, redaction and bounds; then instrument producer action paths; only then land CLI adapters + atomic writer. Do not make collector semantics depend on an observer or heuristic classifier.

## Unresolved questions

- Confirm the installer-created `Layout` diagnostics directory and exact server/helper audit filenames; do not invent parallel paths.
- Confirm role-aware required-source matrix (`server` versus non-server roles) and whether absent helper unit is `notApplicable` or partial.
- Confirm existing protected-status route/auth client and whether local API auth can be performed without exposing credentials in process args/environment.
- Confirm whether any operator demand justifies bounded `--since`/output-dir options; default recommendation remains no public tuning.
- Confirm hard upper bound policy if caps later become configurable; current v1 defaults are fixed 60m/10,000 records/8 MiB.
