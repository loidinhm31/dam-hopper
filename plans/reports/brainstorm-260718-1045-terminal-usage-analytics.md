# Terminal Usage Analytics Brainstorm

Status: agreed recommendation  
Date: 2026-07-18  
Scope: DamHopper-managed PTYs only

## Problem

Add a server-owned analytics feature for terminal usage and optional AI-agent token usage. Data persists only on the DamHopper server in SQLite. Dashboard must provide useful operational and trend views without storing command text, terminal output, prompts, or responses.

“All Bash usage” cannot truthfully mean every Bash process on the host. MVP means activity visible through DamHopper-launched, shell-integration-enabled PTYs. Host-wide tracking needs profile injection, audit/eBPF, elevated privileges, and platform-specific security work. Out of scope.

## Agreed artifact

- New compact `/usage` page plus small summary teaser on existing dashboard.
- Server-side `telemetry.db`, separate from current `sessions.db`.
- Verified terminal lifecycle facts from existing Bash/Zsh/Fish integration.
- Optional Codex token ingestion through authenticated loopback-only OpenTelemetry.
- Aggregate-only authenticated query API.
- Configurable detail retention. Default: 90 days.
- No MCP server. No extra model calls. No added Codex token consumption.

## Existing architecture findings

DamHopper already has most capture primitives:

- `server/src/pty/shell_integration.rs` selects supported interactive-shell adapters.
- `server/assets/shell-integration/bash.sh`, `zsh.zsh`, `fish.fish` emit nonce-authenticated OSC 633 lifecycle markers.
- `server/src/pty/shell_lifecycle.rs` validates marker order and exposes submitted commands.
- `server/src/pty/manager.rs` processes PTY output before WebSocket fan-out. Correct persistence boundary.
- `server/src/pty/event_sink.rs`, `server/src/api/ws_protocol.rs`, `server/src/api/ws.rs` publish terminal lifecycle/output.
- `server/src/persistence/` already provides SQLite migrations and a bounded persistence worker.
- `packages/ui/src/components/organisms/TerminalPanel.tsx` consumes terminal data/lifecycle.
- `packages/ui/src/components/pages/DashboardPage.tsx`, `lib/navigation.ts`, `embed/dam-hopper-app.tsx` are UI entry points.
- `packages/ui/src/api/{client.ts,queries.ts,ws-transport.ts}` are client/API touchpoints.

Current limitations:

- Bash integration fails closed for ambiguous compound/multiline syntax, substitutions, redirects, incompatible `DEBUG` traps, nested shells, SSH, and unsupported programs.
- Completion lifecycle currently loses a distinct finished state and child-command exit status.
- Existing `sessions.db` persists terminal snapshots and environment JSON. Mixing privacy-scoped telemetry into it would make retention and inspection unclear.
- Existing client command history uses localStorage and exact command text. It is not suitable as the analytics source.
- Existing Codex integration handles terminal notifications, not token accounting.

## Evaluated approaches

### 1. Verified shell lifecycle + SQLite + Codex OTel — recommended

Flow:

```text
Bash/Zsh/Fish markers -> PTY manager -> metadata normalizer -> telemetry worker
Codex OTel events ----> loopback OTLP receiver --------------------|
                                                                 v
                                                          telemetry.db
                                                                 |
                                                         aggregate REST API
                                                                 |
                                                        compact /usage page
```

Pros:

- Extends existing trusted capture path.
- Correct command boundaries for supported cases.
- Exit status/duration feasible by extending completion marker.
- No browser keystroke or screen scraping.
- Codex uses supported structured observability events.
- OTel runs after normal responses; no prompt/tool/model call and no extra tokens.
- Server remains source of truth across browser reconnects.

Cons:

- Coverage incomplete by design; must expose capture quality.
- Codex OTel requires user opt-in and version fixture testing.
- Arbitrary interactive Codex correlation may be approximate when no shared run ID exists.
- Local OTLP receiver adds a small isolated listener and ingestion module.

### 2. PTY input/output and TUI parsing — rejected

Pros:

- Minimal shell configuration.
- Appears quick for demos.

Cons:

- `xterm.onData` sees editing, paste, control sequences, IME, history navigation, passwords, and TUI input—not executed commands.
- Screen text changes across Codex/xterm versions.
- Multiline commands, aliases, nested shells, SSH, alternate buffers, and reconnect replay break attribution.
- High secret-leak risk.
- Cannot offer defensible exactly-once records.

### 3. Host audit/eBPF/profile collector — rejected for MVP

Pros:

- Broader process coverage outside DamHopper.

Cons:

- Privileged, Linux-specific or shell-profile-invasive.
- Process `exec` events do not equal interactive command lines or shell builtins.
- Captures sensitive argv and affects operators outside DamHopper.
- Does not solve Codex token attribution.
- Excess scope and operational risk.

### 4. Read Codex local session files — fallback only

Pros:

- No listener.
- No model-token overhead.

Cons:

- Codex documentation states transcript format is not a stable hook interface.
- Partial writes, rotations, multiple versions, replay, and dedupe need defensive parsing.
- Files may contain prompts/responses even if only counters are extracted.
- Local-only coverage; cloud or other Codex surfaces may be absent.

Keep as an explicit future/import adapter, not automatic MVP ingestion.

## Recommended design

### Capture contract

Persist facts only after server-side nonce validation. Never derive executed commands from browser input.

Extend shell completion marker with exit status. Create stable identity from PTY session, generation, and lifecycle sequence. Write before WebSocket broadcast so reconnect or fan-out lag cannot affect analytics.

Every terminal/run record carries:

- `capture_source`: shell integration, PTY lifecycle, Codex OTel.
- `capture_quality`: `rich`, `partial`, `unavailable`.
- `integration_version`.
- Stable event ID/dedupe key.

Unsupported activity stays visible as missing coverage. Never infer or fabricate it.

### Command privacy pipeline

Raw command exists only transiently in memory for classification. Persist:

- Allowlisted executable family: `git`, `build`, `test`, `package`, `dev-server`, `filesystem`, `network`, `agent`, `other`.
- Allowlisted executable name when recognized.
- Argument count.
- Keyed HMAC fingerprint for repeat counting.
- Project ID, shell kind, timestamps, duration, exit status, capture quality.

Never persist:

- Full or heuristically redacted command text.
- Arguments.
- Environment values.
- Working-directory string; use server project identity.
- PTY input/output for telemetry.
- AI prompt, response, tool arguments, or tool output.

Use keyed HMAC, not plain command hash, to reduce offline dictionary recovery. Rotate key only with an explicit migration/reset because rotation breaks historical repeat grouping.

### SQLite boundary

Use separate `telemetry.db` with mode `0600`.

Suggested logical tables:

- `terminal_runs`: run/session/project/shell/generation/start/end/exit/capture quality.
- `command_events`: run/sequence/category/executable/arg count/HMAC/submitted/finished/duration/status/source.
- `agent_runs`: provider/provider session/conversation/terminal/project/model/start/end/status/source quality.
- `agent_usage_events`: provider event ID/time/input/cached-input/output/reasoning tokens/cumulative-vs-delta/source version.
- `telemetry_health`: dropped/coalesced/rejected/invalid events and last purge/checkpoint.

Start with indexed event tables and on-demand aggregation. Avoid rollup tables until representative query tests show need. Suggested indexes: timestamp, project, category/status, provider/model, run ID, unique source event ID.

Use bounded non-blocking writes, WAL, busy timeout, batched transactions, separate read connection. SQLite failure must increment health counters and never block PTY input/output.

### Retention

Default:

- Detail events: 90 days.
- Daily aggregates: longer configurable window; unlimited acceptable because no command text exists.
- Purge: scheduled server task plus startup catch-up.

Config must allow later change:

- Lowering detail retention purges newly expired rows on next run.
- Raising retention affects future preservation only; deleted detail cannot be restored.
- “Delete telemetry” removes all event/aggregate records and resets fingerprints.
- Per-project exclusion and global pause supported.

### Codex integration

Use optional OTLP/HTTP receiver on a separate loopback-only socket:

- Bind `127.0.0.1`, never wildcard/LAN.
- Random bearer secret generated server-side.
- Disabled by default.
- Allowlist event names and fields.
- Reject prompt/output fields even if upstream config enables them.
- Deduplicate by provider event/conversation identity.
- Validate cumulative versus delta counters; never blindly sum snapshots.
- Store unavailable rather than zero when events are missing.

Codex OTel can emit conversation metadata and token counts on `response.completed`. Export is asynchronous and does not create an MCP/tool/model request. Therefore extra model token use: zero.

Correlation order:

1. Explicit provider session/conversation ID mapped to terminal run.
2. Server-launched process/run association if available.
3. Project plus bounded time-window inference, labeled approximate.
4. Otherwise unassociated Codex usage, still queryable.

Do not estimate subscription cost. API cost estimation, if ever added, needs a versioned price table and explicit estimate label.

### Dashboard information architecture

Use `/usage`; keep operational dashboard focused. Add one teaser card on `/` linking to usage.

Compact top navigation across all pages:

- Smaller label font and icon size.
- Reduced horizontal gap/padding.
- Hide lower-priority labels at narrow widths.
- Overflow low-priority destinations into `More` when required.
- Preserve accessible names/tooltips and minimum touch targets.

Usage page filters:

- Range: 24h, 7d, 30d, custom.
- Project.
- Shell/capture quality.
- Command category.
- Agent/provider/model.

MVP cards/visuals:

- Terminal runs, commands, capture coverage.
- Success/failure/unknown counts.
- Command duration p50/p95 and long-running count.
- Category/project/time heatmap.
- Repeat fingerprint frequency.
- Session concurrency, restarts, reconnect/drop health.
- Codex turns completed/failed/interrupted.
- Input/cached-input/output/reasoning tokens.
- Cache ratio and token trend.
- Token-data coverage/availability.

Use lightweight accessible SVG/CSS charts initially. No chart dependency unless interaction or density proves it necessary.

### Metrics deliberately excluded

Do not label any metric “productivity.” Avoid:

- Keystrokes or output bytes as work.
- Commands/hour as developer quality.
- Failures as poor performance.
- Silence as idle/non-work.
- Tokens per success as causal improvement.
- Command duration as effort; it includes network waits and long-running servers.
- Estimated subscription cost.

Keep terminal activity, terminal health, and AI usage as separate metric groups. Correlation is descriptive only.

## Scope boundaries

In scope:

- DamHopper-launched supported interactive Bash/Zsh/Fish sessions.
- Session lifecycle and validated command metadata.
- Server-only SQLite telemetry.
- Aggregate authenticated APIs.
- Dedicated compact usage UI.
- Optional local Codex OTel adapter.
- Retention, pause, exclusion, delete, coverage indicators.

Out of scope:

- Host-wide Bash/process auditing.
- External terminals, nested shells, SSH internals, remote hosts.
- Raw commands, argv, env, stdout/stderr, prompts, responses.
- MCP integration.
- Automatic Codex transcript/session-file scraping.
- Multi-provider AI adapters in MVP.
- Cost/billing truth.
- Team performance or productivity scoring.

## Likely touchpoints

Server:

- `server/src/pty/shell_integration.rs`
- `server/src/pty/shell_lifecycle.rs`
- `server/src/pty/manager.rs`
- `server/assets/shell-integration/{bash.sh,zsh.zsh,fish.fish}`
- `server/src/pty/event_sink.rs`
- `server/src/api/ws_protocol.rs`
- `server/src/api/router.rs`, `server/src/api/mod.rs`, new focused usage API module
- `server/src/state.rs`
- `server/src/config/schema.rs`
- New focused telemetry store/worker/migrations, not mixed into session persistence semantics
- `server/src/main.rs` startup/shutdown/purge wiring

UI:

- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/lib/navigation.ts`
- `packages/ui/src/components/pages/DashboardPage.tsx`
- New focused usage page/components
- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/queries.ts`
- `packages/ui/src/api/ws-transport.ts`

No per-event WebSocket stream needed. Prefer aggregated REST reads plus optional low-rate `usage:changed` invalidation.

## Acceptance criteria

1. Exactly-once records for supported validated shell lifecycle events across reconnect/replay.
2. Exit status and duration present when integration supports them.
3. Unsupported, ambiguous, nested, or incompatible cases report partial/unavailable coverage.
4. Direct database inspection finds no raw commands, arguments, cwd strings, env values, PTY output, prompts, or responses.
5. Secret fixtures including inline keys, bearer tokens, URLs, exports, and credentials never reach telemetry rows or logs.
6. Locked, full, or slow SQLite cannot degrade PTY responsiveness; dropped/coalesced telemetry is counted.
7. Codex telemetry listener is loopback-only, authenticated, optional, and rejects non-allowlisted content.
8. Codex OTel fixture ingestion records correct token fields without double-counting cumulative/replayed events.
9. Missing Codex telemetry renders unavailable, never zero.
10. 24h/7d/30d/project/category/coverage filters return correct aggregates.
11. Representative aggregate queries complete under 200 ms at 100k events on supported development hardware.
12. Default 90-day purge, changed-retention behavior, per-project exclusion, global pause, and delete-all work.
13. UI supports loading, empty, partial-coverage, error, and narrow-screen states with accessible chart summaries.
14. Existing terminal lifecycle, replay, IME, screen-reader, and responsive behavior remains unchanged.

## Risks and mitigations

- Bash lifecycle gaps: expose coverage; do not compensate with input scraping.
- Marker spoofing: retain nonce validation; version marker schema.
- Secret leakage during classification: bounded in-memory transform; no raw logs; adversarial fixtures.
- SQLite backpressure: bounded worker, batch/coalesce, WAL, drop counters, health view.
- OTel version drift: allowlisted decoder, fixture matrix, source version, fail closed.
- Approximate Codex correlation: store confidence and show it in UI.
- Navigation clutter: compact global nav and responsive overflow.
- Misuse as employee scoring: avoid productivity language and raw-user leaderboards.

## Success metrics

- Capture coverage visible for 100% of managed terminal runs.
- Rich lifecycle coverage measured, never assumed.
- Zero raw-secret fixtures persisted.
- Zero PTY latency regression under locked/full telemetry DB fault tests.
- No duplicate command or token events after reconnect/restart/replay tests.
- Usage page aggregate response target met at 100k-event fixture.
- Codex token availability shown accurately for configured versus unconfigured sessions.

## Dependencies and next steps

1. Create detailed implementation plan with terminal telemetry and Codex adapter as separate delivery gates.
2. Specify OSC completion extension and cross-shell fixture matrix.
3. Specify telemetry config, retention semantics, HMAC key lifecycle, and local OTLP auth.
4. Define schema/API DTOs and aggregate query fixtures before UI work.
5. Define compact navigation behavior at desktop/tablet/mobile breakpoints.
6. Validate Codex OTel payloads from pinned supported CLI versions before enabling UI token cards.

## References

- [Codex advanced configuration: observability and telemetry](https://developers.openai.com/codex/config-advanced/#metrics)
- [Codex app-server protocol and token usage events](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [VS Code terminal shell integration / OSC 633](https://code.visualstudio.com/docs/terminal/shell-integration)
- [GNU Bash reference manual](https://www.gnu.org/s/bash/manual/bash.html)
- [SQLite write-ahead logging](https://www.sqlite.org/wal.html)

## Unresolved questions

- None blocking brainstorm consensus.
- Planning should decide exact long-term aggregate retention window.
- Planning should benchmark on-disk size before deciding whether rollup tables are needed.
