# Code Review: Phase 03 — Bundled OMP Adapter and Installer

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/agent_status/assets/omp-agent-status.ts` (created, 815 LOC)
  - `server/src/agent_status/integration.rs` (created, 305 LOC)
  - `server/src/agent_status/mod.rs` (modified, +10 LOC)
  - `server/src/main.rs` (modified, +136 LOC)
  - `server/tests/omp-agent-status.test.ts` (created, 481 LOC)
  - `server/tests/agent_status_integration.rs` (created, 260 LOC)
  - `docs/configuration-guide.md` (modified, +29 LOC)
  - `docs/README.md` (modified, +2 LOC)
- Lines of code analyzed: ~2,038 LOC
- Review focus: Security, performance, architecture, YAGNI/KISS/DRY adherence, OMP runtime contract, installer safety.
- Updated plans:
  - `plans/260928-0318-agent-status-omp-first/phase-03-omp-adapter-and-installer.md`
  - `plans/260928-0318-agent-status-omp-first/plan.md`

### Overall Assessment
Score: **9.2 / 10**

Implementation is clean, modular, and tightly aligned with the normative architecture defined in `docs/architecture/agent-status.md` and Phase 03 plan:
- **Zero third-party runtime dependencies**: `omp-agent-status.ts` contains zero imports and executes standalone in Bun using built-in globals.
- **Independent compilation**: Embedded via `include_str!` in Rust server; compilation does not require Bun or OMP.
- **Fail-safe isolation**: Adapter stays dormant if credentials missing, if executed as subagent (`OMPCODE=1`), or if outside interactive UI session (`ctx.hasUI !== true`).
- **Atomic and tamper-resistant installer**: `install_extension` utilizes atomic tempfile persistence (`rename(2)`) with `0600` permissions and refuses to overwrite or delete modified files. Preserves unrelated files in `extensions/`.
- **Early CLI dispatch**: `dam-hopper-server integration omp ...` runs prior to token generation, DB connection, config loading, or server socket binding.
- All 17 Bun tests and 7 Cargo integration/unit tests pass without failure.

---

### Critical Issues
None. Zero breaking regressions, credential leaks, or path traversal vulnerabilities identified.

---

### High Priority Findings (Warnings)

#### 1. Duplicate `turn-ended` and Phantom Revision Increments on Late `agent_end` Events
- **Location**: `server/src/agent_status/assets/omp-agent-status.ts:376-387, 451-483`
- **Impact**: If an `agent_end` callback fires when no turn is active (`!this.isTurnActive && !this.isRetrying && !this.isCompacting`), the debounce timer still invokes `handleSettledEnd()`. Since `this.currentTurnId` is `undefined`, line 468 synthesizes a new UUID (`crypto.randomUUID()`) and emits a redundant `turn-ended` report. While the server reducer's `matches_turn` prevents erroneous attention events, the reducer still processes the report, updates `last_outcome`, and increments the snapshot `revision`.
- **Contract Violation**: Phase 03 Step 4 states: *"Late duplicate ends and retry resolution cannot emit twice."*
- **Recommendation**: Guard `onAgentEnd` against inactive turn state:
  ```typescript
  public onAgentEnd(event: AgentEndEventPayload): void {
    if (!this.isTurnActive && !this.isRetrying && !this.isCompacting) {
      return;
    }
    if (event.willContinue === true) {
      this.cancelSettle();
      return;
    }
    this.cancelSettle();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.handleSettledEnd(event.messages);
    }, this.settleDelayMs);
  }
  ```

#### 2. CRLF Line-Ending Sensitivity in Header Parser
- **Location**: `server/src/agent_status/integration.rs:162-182` (`check_extension_status`)
- **Impact**: Header parsing tracks byte offset using `body_start_idx += line.len() + 1`. In environments with Windows-style CRLF line endings (`\r\n`), `.lines()` strips `\r`, causing the byte counter to be 1 byte short per header line (4 bytes total). Slicing `&existing_content[body_start_idx..]` retains `\r\n\r\n` prefixes in `actual_body`, causing SHA-256 hash mismatch. An outdated file with CRLF endings will be misclassified as `Modified` rather than `Outdated`, causing `install_extension` to fail with `RefusingOverwriteModified` instead of upgrading cleanly.
- **Recommendation**: Locate the body delimiter explicitly:
  ```rust
  let body_start_idx = if let Some(pos) = existing_content.find("\r\n\r\n") {
      pos + 4
  } else if let Some(pos) = existing_content.find("\n\n") {
      pos + 2
  } else {
      existing_content.len()
  };
  ```

---

### Medium Priority Suggestions

#### 1. Indefinite Reconnect Loop on Terminal Server Rejection
- **Location**: `server/src/agent_status/assets/omp-agent-status.ts:591-601`
- **Impact**: When the server rejects a connection with fatal status (e.g. `unsupported protocol version`), `this.ws.close()` triggers `socket.onclose`, which continuously schedules reconnect attempts every 5 seconds.
- **Suggestion**: For unrecoverable rejection reasons (protocol or agent kind mismatch), set an unrecoverable flag to halt reconnects until a new session or environment reload occurs.

#### 2. Sequence Acknowledgment Handling
- **Location**: `server/src/agent_status/assets/omp-agent-status.ts:575-605`
- **Impact**: Server responds with `ReporterAck { kind: "ack", seq }`, but `handleMessage` ignores `ack` payloads.
- **Suggestion**: While TCP loopback and snapshot-on-reconnect make queue replay unnecessary, logging or tracking the highest acknowledged sequence number provides better diagnostic observability.

#### 3. DRY Improvement in `sanitizeSessionId`
- **Location**: `server/src/agent_status/assets/omp-agent-status.ts:155-162`
- **Suggestion**: Extract candidate string first before running regex replacement and slice:
  ```typescript
  export function sanitizeSessionId(rawId: unknown): string {
    if (typeof rawId !== "string" || !rawId.trim()) return "session-unknown";
    const trimmed = rawId.trim();
    const candidate = trimmed.includes("/") || trimmed.includes("\\")
      ? trimmed.split(/[/\\]+/).filter(Boolean).pop() || "session-unknown"
      : trimmed;
    const clean = candidate.replace(/[^\x21-\x7E]/g, "_");
    return clean.slice(0, 128) || "session-unknown";
  }
  ```

---

### Positive Observations
- **Completely Self-Contained Adapter**: Zero imports, zero npm packages; uses only Bun globals (`URL`, `WebSocket`, `crypto.randomUUID()`).
- **Strict Endpoint Verification**: `validateLoopbackWsUrl` ensures loopback host (`127.0.0.1`, `localhost`, `::1`, `[::1]`), `/v1/agent-status` path, and strictly disallows URL query params or credentials, preventing token leaks.
- **Fail-Safe Subagent Protection**: Checks `OMPCODE === "1"` and `ctx.hasUI !== true` immediately to ensure subagents and headless workers never connect.
- **Atomic Durability**: Installer writes through tempfiles within the target directory, issues explicit `sync_all()`, and performs atomic rename (`persist`). File mode defaults to `0600` on Unix.
- **Tamper Protection**: Detects unmanaged or modified files and refuses destructive overwrite or uninstall.
- **Clean CLI Dispatch**: `dam-hopper-server integration omp` bypasses DB, auth token generation, and listener binding.

---

### Metrics
- Type Coverage: 100% (Strict TypeScript in Bun adapter; strongly typed Rust integration module)
- Test Coverage: 17/17 Bun unit tests pass; 6/6 Rust integration tests pass; 1/1 main CLI test passes
- Compiler / Linter Warnings: 0 warnings on newly added files

---

### Unresolved Questions
None.
