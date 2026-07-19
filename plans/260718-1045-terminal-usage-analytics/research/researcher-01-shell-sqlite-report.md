# Terminal Usage Analytics: Shell Lifecycle, SQLite, Privacy

## Recommendation

Build server-owned analytics for DamHopper-managed PTYs only. Validated OSC 633 lifecycle events are authoritative; xterm input is transport/UI data, not a command log. Persist normalized command-run facts through one bounded SQLite writer, query through separate WAL read connections, and expose aggregate APIs. Add AI token telemetry through explicit versioned adapters, never terminal-output scraping.

Hard truth: “all Bash usage” is impossible from DamHopper. Scope is commands in shells launched and instrumented by its PTY manager. External terminals, non-interactive scripts, uninstrumented child shells/SSH, and programs that suppress hooks remain unseen.

## OSC 633 capture

- `server/src/pty/shell_lifecycle.rs` already parses lifecycle markers, validates nonce/order/exact command, bounds command size, and removes markers from visible output. Extend this typed event stream; do not duplicate parsing in xterm.
- `server/src/pty/shell_integration.rs` is the shell-specific injection seam; `server/src/pty/manager.rs` is the session correlation seam; `server/src/pty/event_sink.rs` remains UI broadcast, not durable analytics.
- Use `A` prompt start, `B` prompt end, `E` exact interpreted command + nonce, `C` pre-execution, `D` completion + exit code. VS Code documents `A,B,E,C,D` as rich ordering and says `E` enables reliable exact command capture.
- xterm keystrokes cannot reconstruct readline/history editing, multiline input, paste, aliases/functions, completion, or shell rewriting. PTY output sees shell-emitted facts and works with multiple attached browsers.
- Record server UTC plus per-session monotonic timestamps. Derive prompt/edit dwell (`B→C`), execution (`C→D`), and idle time separately. Terminal-open duration is not active work.

Primary reference: [VS Code shell integration and OSC 633](https://code.visualstudio.com/docs/terminal/shell-integration#_supported-escape-sequences).

## Bash/Zsh/Fish limitations

- Bash hooks can conflict with custom/array `PROMPT_COMMAND`, `DEBUG` traps, compound syntax, and plugins. Zsh `preexec`/`precmd` can be reordered/replaced by frameworks. Fish event hooks differ by version; older Fish may miss the environment injection path.
- Automatic injection is known to miss subshells, regular SSH, complex startup setups, and old Fish. Store `integration_quality = rich | basic | none`, shell/version, matched lifecycle percentage, and unmatched/out-of-order counts.
- Fail closed: unverified `E` is never stored as a command. Missing `D` ends as `unknown`, `interrupted`, or `session_lost`, never success. Forged OSC in process output must fail nonce/state validation.
- Phase 1: supported interactive Bash/Zsh/Fish already recognized by injection. Out: system-wide audit, eBPF/process tracing, script internals, stdout retention, exact cost calculation.

## Minimal data model

- `terminal_sessions`: stable id, project id, shell/version, start/end, integration quality, end reason. Avoid absolute cwd; map to project plus optional repo-relative path.
- `command_runs`: id, session id, sequence, start/end/duration, exit code/outcome, category, command fingerprint, optional safe display label, capture quality. Unique `(server_instance_id, session_id, sequence)` provides idempotency.
- `agent_runs`: session/command correlation, provider/agent/version, source schema version, input/output/cached/reasoning tokens (nullable), tool calls, duration, outcome, confidence. Missing values stay null, not zero.
- YAGNI: no immutable raw-event warehouse initially. Retain command facts plus small ingestion-health counters; add sampled diagnostics only after demonstrated need.

## Dashboard metrics

- Usage: commands/day, active execution minutes, prompt/edit minutes, idle minutes, active sessions, hourly heatmap, project/shell breakdown.
- Outcomes: success/failure/cancel/unknown rate, p50/p95 duration, slow-command share, repeat/retry clusters, category/fingerprint frequency.
- Agent: tokens by type, tokens/successful run, tokens/active minute, tool calls/run, agent failure/retry rate, command-to-agent linkage rate. Defer cost because pricing/version attribution changes independently.
- Trust: rich/basic/none share, valid-`E` rate, unmatched marker rate, queue depth/drops, ingest lag, SQLite busy/retry count, purge age, last successful checkpoint.

## SQLite writer/read design

- Reuse the existing `rusqlite` dependency in `server/Cargo.toml` and server persistence patterns. Prefer a separate analytics DB or strictly isolated tables/migrations so diagnostic/session retention cannot accidentally delete analytics.
- One dedicated blocking writer owns one connection. Tokio producers use bounded `mpsc`; batch up to 100 events or 250 ms in a short transaction. On prolonged pressure, wait briefly then count a visible dropped event; never freeze PTY output indefinitely.
- Enable `journal_mode=WAL`, `synchronous=NORMAL`, foreign keys, and per-connection `busy_timeout` (start 5 s). Use separate read-only connections and short queries. WAL permits readers with a writer, but SQLite still has one writer.
- Keep transactions short; use `BEGIN IMMEDIATE` only within the writer when needed. Run rusqlite on the dedicated blocking context, not an async worker. Keep the DB on local disk: WAL does not work over network filesystems.
- Let automatic checkpointing handle ordinary load; monitor WAL size. Periodically run `wal_checkpoint(PASSIVE)`; use `TRUNCATE` only at low activity/after large purge because checkpoints can stall on long readers.
- Configurable retention, recommended 90 days. Daily purge in 10k-row transactions using indexed time and bounded row-id subqueries; delete agent runs, commands, then sessions. Checkpoint after purge. Skip auto-vacuum in MVP; file size may not immediately shrink.
- Startup: migrations in one transaction, clear open/integrity errors, DB mode `0600`, and no silent delete/recreate on corruption.

Primary references: [WAL/concurrency/checkpointing](https://www.sqlite.org/wal.html), [busy timeout](https://www.sqlite.org/pragma.html#pragma_busy_timeout), [transactions](https://www.sqlite.org/lang_transaction.html), [checkpoint modes](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).

## HMAC privacy

- Default: no plaintext command/raw argv. Fingerprint `HMAC-SHA-256(key, "cmd:v1\\0" || conservative_normalized_command)` with a random server-only 32-byte key stored separately from the DB. Domain/version prefix prevents cross-purpose reuse.
- HMAC enables stable equality when DB and key are not both stolen. It does not prevent dictionary attacks after key compromise; rotation breaks longitudinal equality unless key epochs are explicit. Reference: [RFC 2104](https://www.rfc-editor.org/rfc/rfc2104).
- Store low-cardinality category (`git`, `build`, `test`, `package`, `agent`, `shell`, `other`) and optional executable label only if policy permits. Redaction is defense-in-depth; secrets can occur in flags, env assignments, URLs, and pasted scripts.
- Make analytics an explicit local-admin setting, with retention control, purge-now, and export preview. Never transmit these analytics off-server.

## AI agent token integration

- Define a versioned `AgentUsageAdapter`. Prefer structured event/JSON output from each agent invocation, correlated by PTY session + command sequence + adapter run id. A Codex adapter is one implementation, not the schema.
- Output scraping is low-confidence fallback only: formats change, can be localized, and may omit cached/reasoning tokens. Never infer tokens from text bytes.
- Persist only numeric/enum facts. Do not store prompts, responses, tool arguments, or raw agent JSON without separate diagnostic consent.

## Exact touchpoints

- Extend: `server/src/pty/shell_lifecycle.rs`, `server/src/pty/shell_integration.rs`, `server/src/pty/manager.rs`, `server/src/state.rs`, `server/src/api/router.rs`; touch `server/src/api/ws_protocol.rs` only for live invalidation.
- Add: `server/src/analytics/mod.rs`, `event.rs`, `writer.rs`, `store.rs`, `queries.rs`, `retention.rs`, `privacy.rs`, `agent-usage.rs`, plus a migration aligned to the repo’s current migration convention.
- API: `server/src/api/analytics.rs`; validate bounded dates/buckets/filters, return aggregates only, inherit protected router auth.
- UI: `packages/ui/src`; add lazy analytics route, typed client/query hooks, summary/quality charts, filters, empty/degraded states. Do not stream each command to browsers.
- Tests: extend `server/src/pty/tests.rs`; add analytics store/query/retention tests and authenticated API tests.

## Fault and test strategy

- Parser tables/properties: every byte split, BEL/ST, escaped semicolon/newline, bad nonce, forged output marker, reordered/duplicate/missing A-E-C-D, oversized command, alternate screen.
- Real PTYs per Bash/Zsh/Fish: simple/multiline/pipeline/history, Ctrl-C, nonzero exit, shell death mid-command, nested shell, custom prompt/plugin. Assert visible output unchanged and quality honestly downgraded.
- SQLite: many readers during batches, forced `SQLITE_BUSY`, saturated queue, writer panic/restart, process kill between commits, read-only/full disk, bad migration, corrupt copy, large purge with readers, WAL growth.
- Privacy: scan DB/API for raw commands, secrets, absolute cwd, prompts, agent content; same key/message stable, different key/domain differs; key rotation behavior explicit.
- API/UI: empty DB, UTC/DST boundaries, query limits, retention cutoff, null token fields, partial integration, auth, large-range rejection.

## Acceptance criteria

- Each validated managed-shell lifecycle creates exactly one idempotent command row with correct outcome/timing; incomplete integration is visible.
- Analytics load cannot freeze PTYs; queue loss is measurable. Concurrent dashboard reads do not lose writes in the agreed test profile.
- Restart/crash preserves committed batches; migrations repeat safely; retention removes expired rows and reports status.
- Default DB/API contain no plaintext command, cwd, prompt, agent content, or tool argument.
- Default dashboard aggregate p95 target: under 200 ms at 1M command rows on representative hardware.

## Unresolved questions

1. Analytics opt-in, opt-out, or always-on for this local server?
2. Need exact top-command labels, or categories/fingerprints only?
3. Retention default: 30, 90, or unlimited days; need purge-now UI?
4. Which Codex mode/version is authoritative for structured tokens; other agents in phase 1?
5. Separate analytics DB or shared DB with existing session/diagnostic persistence?
6. First dashboard goal: productivity trends, failure diagnosis, or AI efficiency?
