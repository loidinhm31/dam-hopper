---
title: "Native Terminal Logging & Diagnostics"
description: "Implement structured terminal behavior logging, diagnostic ring buffer, and owner-scoped diagnostic inspection in native-app, mirroring the web app version without leaking terminal text or secrets."
status: completed
priority: P2
effort: "Four phases"
branch: feat/android-native-app
tags: [android, native-app, terminal, logging, diagnostics]
created: 2026-10-18
---

# Native Terminal Logging & Diagnostics Plan
Date: 261018
Slug: native-terminal-logging

## Summary of Accomplishments

1. **KMP Core Logging & Diagnostics Engine (`native-app/shared/.../core/logging/`)**:
   - `LogLevel`: Leveled severity ranks (`DEBUG`, `INFO`, `WARN`, `ERROR`, `NONE`).
   - `LogModels`: `LogEntry`, `DiagnosticEntry`, `DiagnosticManifest`, and `DiagnosticSnapshot` models with `@Serializable` support.
   - `Redactor`: Secret scrubbing for Bearer tokens, URLs (`?token=`), key-value credentials, sensitive map keys, and throwable details; string truncation at 1000 characters.
   - `DiagnosticRingBuffer`: Thread-safe, bounded by max entry count (default 500) and max byte ceiling (default 256 KB) with rate-limiting on repetitive events and owner/session filtering.
   - `PrintLogSink` & `AppLogger`: Global coordinator with non-throwing sink dispatch, deterministic test clock injection, and snapshot retrieval.

2. **Terminal Pipeline Instrumentation**:
   - `TerminalSessionController`: Emits owner-scoped diagnostics (`stream_gap_detected`, `buffer_replay`, `buffer_replay_complete`, `stream_chunk_dropped_stale_incarnation`, `stream_newer_incarnation_detected`, `broadcast_lagged`, `terminal.exit`, `process.restarted`, `terminal.input_dropped`, `terminal.resize`). Strictly records byte counts, offsets, and drop reasons—never keystrokes or terminal output text.
   - `WsConnection`: Emits `connecting`, `status:connected`, `status:disconnected`, `ws.parse_error` (with prefix preview), and `ws.error`.
   - `TerminalRepository`: Emits `terminal.create`, `terminal.create_failed`, and `terminal.attach`.

3. **Terminal UI Integration**:
   - `ProjectTerminalScreen`: Emits `terminal.session_selected`, `terminal.attach_succeeded`, `terminal.attach_failed`, `terminal.buffer_fetched`, and `terminal.local_buffer_cleared`.
   - Added in-app `Diag` button in top navigation bar opening `TerminalDiagnosticsDialog` with real-time event list, "Copy JSON" (copies diagnostic snapshot to Android clipboard), and "Clear" actions.

4. **Automated Verification**:
   - `RedactorTest`: Tested Bearer tokens, URL queries, key-value secrets, map keys, oversized strings, and throwables.
   - `DiagnosticRingBufferTest`: Tested maxEntries eviction, maxBytes eviction, rate-limiting, and profile/session filtering.
   - `TerminalSessionControllerLoggingTest`: Tested stream gaps, buffer replay, input drop reasons, exits, and verified zero payload content leakage.
   - Gradle tasks `:shared:jvmTest` and `:androidApp:testDebugUnitTest` executed with `--rerun-tasks` and passed 100%.

## Test Evidence
- `:shared:jvmTest --rerun-tasks`: 8 actionable tasks executed; all 200+ tests passed.
- `:androidApp:testDebugUnitTest --rerun-tasks`: 36 actionable tasks executed; all 54 tests passed.
