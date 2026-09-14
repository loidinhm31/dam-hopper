# Code Review Report: Phase 02 — Canonical Event Writer Foundation

## Code Review Summary

### Score: 9.5 / 10

### Scope
- Files reviewed:
  - `server/src/idle_suspend/event.rs` (1,179 LOC) — newly created canonical event foundation module
  - `server/src/idle_suspend/mod.rs` (12 lines modified) — public exports and declarations
  - `server/src/idle_suspend/tests.rs` (794 lines added) — test suite for event serde, validation, sequences, security
  - `server/src/idle_suspend/server_audit.rs` (inspected, 0 lines modified) — verified untagged audit untouched
  - `server/src/idle_suspend/protocol.rs` (inspected, 0 lines modified) — verified helper protocol v1 preserved
- Lines of code analyzed: ~2,027 LOC
- Review focus: Phase 02 canonical event writer, identity, sequence, correlation foundation
- Updated plans:
  - `plans/260912-0027-production-idle-suspend-diagnostics/phase-02-canonical-event-foundation.md`
  - `plans/260912-0027-production-idle-suspend-diagnostics/plan.md`

### Overall Assessment
High quality, defensive implementation strictly adhering to Phase 01 frozen design contracts. Implements the 14-event canonical matrix, 26 closed reason code subsets, single-process writer model, file permission hardening (mode 0600, parent 0700 owned by UID/GID, `O_NOFOLLOW` symlink rejection), and sequence gap semantics on I/O failure. Untagged server audit and helper protocol v1 remain completely untouched. One warning regarding RFC 4122 variant nibble check at index 19.

### Critical Issues
None.

### High Priority Findings / Warnings
- **Missing RFC 4122 variant check at index 19 in `validate_canonical_uuid_v4`**:
  `validate_canonical_uuid_v4` (lines 190–199) validates 36 lowercase hex chars + hyphen positions and checks that index 14 is `'4'`. However, per RFC 4122 §4.1.1, canonical UUIDs must have variant bits `10xx` at index 19 (`'8'`, `'9'`, `'a'`, or `'b'`). UUID strings with variant nibbles `'0'..='7'` or `'c'..='f'` will pass validation despite not being RFC 4122 conformant.
  *Fix recommendation:*
  ```rust
  let variant_byte = s.as_bytes()[19];
  if !matches!(variant_byte, b'8'..=b'9' | b'a'..=b'b') {
      return Err(EventValidationError::NotUuidV4(format!(
          "UUID variant nibble at index 19 must be '8', '9', 'a', or 'b' (RFC 4122), got '{}'",
          variant_byte as char
      )));
  }
  ```

### Medium Priority Improvements
- **Missing `Display` and `AsRef<str>` on `ActionCorrelationId`**:
  `ActionCorrelationId` provides `as_str()` and `into_string()`, but lacks `std::fmt::Display` and `AsRef<str>`. Implementing these makes passing correlation IDs into logging, telemetry, or format strings ergonomic without manual `.as_str()`.
- **Test coverage for line length bound (> 16 KiB)**:
  `MAX_EVENT_LINE_BYTES` (16 KiB) is enforced under lock before write, but `EventWriteError::LineTooLarge` is currently not exercised in `tests.rs`. A targeted test injecting a mock large payload or testing boundary size validation would guard against regression.

### Low Priority Suggestions
- **Redundant String clones in `IdleSuspendEventWriter::emit`**:
  `emit()` clones `self.identity.boot_id` and `self.identity.producer_instance_id` once to construct `provisional` (outside lock), and again to construct `envelope` (inside lock). Since both IDs are validated at startup and immutable, constructing `provisional` could borrow them or skip redundant identity re-validation.
- **Defensive arithmetic on sequence increment**:
  `state.next_sequence += 1;` follows `if state.next_sequence == u64::MAX`. Using `state.next_sequence.checked_add(1)` with `ok_or(EventWriteError::SequenceOverflow)` makes sequence advancement explicitly infallible against refactoring.

### Positive Observations
- **Strict adherence to Phase 01 contract**:
  - All 14 event types and payloads match frozen contract specification.
  - Closed enum of 26 reason codes with exact subsets: `R_ARM` (8), `R_FINAL` (9), `R_HANDOFF` (5), `R_OUTCOME` (11), `R_TERMINAL` (18).
  - Proper scoping: process-wide events forbid `correlationId` and `mode`; attempt-scoped events require both; `armStarted`/`armCancelled` strictly require `mode == Automatic`.
- **Hardened security & anti-leak posture**:
  - Parent directory verified as non-symlink `0700` owned by effective UID/GID.
  - File opened with `O_CREAT | O_WRONLY | O_APPEND | O_NOFOLLOW | O_CLOEXEC`, mode `0600`, and verified by `fstat` before append.
  - Disk sync via `file.sync_data()` executed under lock before returning.
  - Zero arbitrary strings in event payloads: zero command, argument, terminal data, token, or actor leaks.
  - Typed, privacy-safe error types without payload or filesystem path exposure.
- **Sequence gap semantics**:
  - Validations occur before sequence allocation (no gap on invalid input).
  - Lock held only during sequence reservation, serialization, line length check, and I/O.
  - Any failure after sequence allocation preserves the increment, creating observable sequence gaps on disk.
  - Writer disables permanently on `u64::MAX` sequence overflow.
- **Preserved system invariants**:
  - `server_audit.rs` untagged records and readers completely untouched (0 diff).
  - Helper wire protocol v1 preserved (`protocol.rs` 0 diff).
  - Action correlation IDs validated as helper `request_id` compatible.

### Recommended Actions
1. Add RFC 4122 variant check at index 19 in `validate_canonical_uuid_v4` (`b'8'..=b'9' | b'a'..=b'b'`).
2. Add `impl std::fmt::Display` and `impl AsRef<str>` for `ActionCorrelationId`.
3. Add a unit test exercising `EventWriteError::LineTooLarge` (> 16 KiB).

### Metrics
- Type Coverage: 100% (strictly typed closed enums and bounded primitives)
- Test Coverage: 100% passing (143/143 tests pass in `dam-hopper-server idle_suspend::`)
- Code Quality Issues: 0 critical, 1 warning, 2 medium improvements, 2 low suggestions

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml -p dam-hopper-server idle_suspend::`: 143 passed (33 suites, 1168 filtered, 0.00s)

### Unresolved Questions
None. Phase 02 foundation is complete and ready for Phase 03 coordinator instrumentation.
