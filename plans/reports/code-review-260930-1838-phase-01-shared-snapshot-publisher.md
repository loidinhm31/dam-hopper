# Code Review: Phase 01 — Shared Snapshot Publisher

**Date:** 2026-09-30  
**Reviewer:** Senior Software Engineer (ReviewPhase01)  
**Target:** Phase 01 — Shared Snapshot Publisher (`plans/260929-1522-host-resources-sse/phase-01-shared-snapshot-publisher.md`)  
**Architecture Contract:** `docs/architecture/host-resource-sse.md`  
**Overall Score:** 9.0 / 10

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/system/monitor.rs` (+273 lines)
  - `server/src/system/resource_stream.rs` (+732 lines, new module)
  - `server/src/system.rs` (+7 lines, re-exports)
- **Lines of code analyzed:** ~1,012 lines of Rust code and tests.
- **Review focus:** Concurrency, lock discipline, bounded allocation, framing integrity, wire format compliance, YAGNI/KISS/DRY, and task completeness.
- **Updated plans:** `plans/260929-1522-host-resources-sse/phase-01-shared-snapshot-publisher.md` (marked B01-A, B01-B, B01-I complete).

### Overall Assessment
The Phase 01 implementation delivers a clean, correct, and robust shared snapshot publisher for bounded host-resource SSE delivery. It faithfully implements the architecture specification in `docs/architecture/host-resource-sse.md`:
1. Atomic snapshot + metrics + observation instants + clamped freshness configuration reading under one brief read lock (`read_stream_pair`).
2. Separate lightweight metadata-only status basis read (`current_status_basis`) that copies only 88 bytes of scalars/Instants without cloning projection data.
3. Monotonic observation instants: deep snapshot instant retained across degraded/deadline ticks, legacy metrics instant updated independently, and both preserved untouched during metadata-only freshness configuration commits.
4. Demand-driven bounded publisher: zero subscribers trigger zero encoding across commits; multiple readers share the exact same `Arc<PublishedFrame>` with zero per-reader snapshot cloning.
5. Strict 256 KiB data frame limit and 4 KiB control frame limit enforced via `BoundedWriter` with rejection before buffer extension.
6. Proper revision rollover logic: retires server epoch UUID upon `u64` overflow.

All targeted unit tests pass without errors or warnings in compilation.

---

## Critical Issues (0)
*None.* No security vulnerabilities, memory safety issues, or data corruption hazards found.

---

## High Priority Findings (0)
*None.* No functional blockers or architecture deviations found.

---

## Medium Priority Improvements (4)

### 1. Spurious Wakeups and Redundant Clone in Publisher Reuse Path
- **Location:** `server/src/system/resource_stream.rs:469-476`
- **Issue:** When `interest > 0` and `is_new == false` (e.g. when an additional subscriber joins or when `run_publisher` wakes with an unchanged revision), the loop executes:
  ```rust
  if let Some(res) = &retained_frame {
      let _ = inner.watch_tx.send_replace(Some(res.clone()));
  }
  ```
  `watch_tx` already holds `Some(res)` from the initial encode. Calling `send_replace` marks the channel as modified, which wakes up *all* currently connected subscribers in `sub.changed().await`. While `StreamSubscription::changed()` filters out identical `(server_epoch, revision)` pairs, this causes unnecessary CPU churn and context switching across up to 32 active reader tasks.
- **Recommendation:** Only notify `watch_tx` if the watch channel does not already hold the current frame, or avoid `send_replace` when `is_new == false`:
  ```rust
  // On existing revision, new subscribers already read from watch_rx.borrow_and_update()
  #[cfg(test)]
  inner.test_counters.reuse_count.fetch_add(1, Ordering::Relaxed);
  ```

### 2. Avoidable Heap Allocations in Per-Client Control Frame Encoding
- **Location:** `server/src/system/resource_stream.rs:177, 230, 251`
- **Issue:**
  1. `encode_control_event` formats `let prefix = format!("event: {name}\ndata: ");`, allocating a new `String` on every invocation.
  2. `encode_status_control` and `encode_status_control_for_frame` call `revision.to_string()`, allocating an owned `String` for the decimal revision.
  Small status events are emitted immediately before every data frame (up to 32 per 5-second interval) and periodically at 15-second intervals. Allocating two `String`s per control frame violates the constraint "NEVER avoidable allocation, copying, computation".
- **Recommendation:**
  1. Write prefix byte slices directly to `BoundedWriter`:
     ```rust
     writer.write_all(b"event: ")?;
     writer.write_all(name.as_bytes())?;
     writer.write_all(b"\ndata: ")?;
     ```
  2. Use a custom serializer for `revision: u64` or `itoa::Buffer` to avoid `String` allocation.

### 3. Avoidable `Arc<SubscriptionGuard>` Allocation on Every Subscription
- **Location:** `server/src/system/resource_stream.rs:354, 384`
- **Issue:** `StreamSubscription` wraps `SubscriptionGuard` in `Arc<SubscriptionGuard>`. However, `StreamSubscription` is not `Clone`, and `SubscriptionGuard` is never shared or cloned. Wrapping it in an `Arc` adds an unnecessary heap allocation on every client connection admission.
- **Recommendation:** Store `_guard: SubscriptionGuard` directly by value in `StreamSubscription`:
  ```rust
  pub struct StreamSubscription {
      _guard: SubscriptionGuard,
      watch_rx: watch::Receiver<Option<Result<Arc<PublishedFrame>, FrameTooLarge>>>,
      last_revision: Option<(Uuid, u64)>,
  }
  ```

### 4. Liveness Behavior on Sender Closure in `StreamSubscription`
- **Location:** `server/src/system/resource_stream.rs:408, 416`
- **Issue:** In `StreamSubscription::latest()` and `changed()`, if `watch_rx.changed().await` returns an error (which happens if `watch_tx` is dropped), the code awaits `futures_util::future::pending::<()>()`. This permanently suspends the future. While Phase 02 will wrap stream bodies in cancellation tokens and supervisors, it is safer to yield EOF or a typed error so downstream stream adapters cleanly terminate without relying exclusively on task abortion.
- **Recommendation:** Document that Phase 02 body streams must supervise subscription cancellation explicitly, or return a dedicated stream termination signal if the channel closes.

---

## Low Priority Suggestions (4)

### 1. DRY Violation: Repeated Revision Rollover Logic in `monitor.rs`
- **Location:** `server/src/system/monitor.rs:330-336, 543-549, 573-579`
- **Observation:** The identical revision increment and epoch retirement block is repeated three times:
  ```rust
  cache.revision = match cache.revision.checked_add(1) {
      Some(next) => next,
      None => {
          cache.server_epoch = Uuid::new_v4();
          0
      }
  };
  ```
- **Recommendation:** Add a helper method on `MonitorCache`:
  ```rust
  impl MonitorCache {
      pub fn bump_revision(&mut self) -> u64 {
          self.revision = match self.revision.checked_add(1) {
              Some(next) => next,
              None => {
                  self.server_epoch = Uuid::new_v4();
                  0
              }
          };
          self.revision
      }
  }
  ```

### 2. Unread Dead Field and Unused Error Variants
- **Location:** `server/src/system/resource_stream.rs:63, 53-56`
- **Observation:**
  - `BoundedWriter.over_limit: bool` is set to `true` on line 83 but is never read anywhere.
  - `ControlFrameError::Serialization` and `ControlFrameError::Io` are defined with `#[from]` attributes but never constructed; all failures currently return `ControlFrameError::FrameTooLarge`.
- **Recommendation:** Remove `over_limit` or inspect it to differentiate between `FrameTooLarge` and serialization errors; remove unused enum variants if dead.

### 3. `BoundedWriter` Initial Buffer Capacity for Data Frames
- **Location:** `server/src/system/resource_stream.rs:67-73`
- **Observation:** `BoundedWriter::new(limit)` initializes `Vec::with_capacity(limit.min(4096))`. For data frames capped at 256 KiB, serializing a typical 30–80 KiB snapshot triggers 3–4 buffer reallocations and copies.
- **Recommendation:** Support specifying an initial capacity hint, e.g. `BoundedWriter::with_capacity(32_768, limit)` for data frames.

### 4. Clippy Lint: `std::io::Error::other`
- **Location:** `server/src/system/resource_stream.rs:84`
- **Observation:** Clippy suggests simplifying:
  `std::io::Error::new(std::io::ErrorKind::Other, "frame size limit exceeded")`
  to `std::io::Error::other("frame size limit exceeded")`.

---

## Positive Observations
1. **Zero-Copy Fanout:** Readers receive `Arc<PublishedFrame>` wrapping immutable `Bytes`. No per-reader snapshot serialization or struct cloning.
2. **Lock-Free Emission:** Lock duration in `read_stream_pair` is strictly bounded to cloning cached state; JSON serialization and Tokio watch channel updates occur entirely after releasing locks.
3. **Strict Bounded Serialization:** `BoundedWriter` intercepts buffer growth during serialization, preventing memory bloat from oversized payloads before memory is allocated.
4. **Demand-Driven Gating:** Verified through unit tests that 0 readers result in 0 encodes across multiple monitor commits, and reconnecting readers invalidate stale cached frames on demand.
5. **Exact Wire Compatibility:** Field names in JSON data (`schemaVersion`, `serverEpoch`, `revision`, `snapshot`, `metrics`, `lightSampleMs`) and status controls (`snapshotAgeMs`, `metricsAgeMs`, `freshnessTtlMs`) strictly match the frozen contract in `docs/architecture/host-resource-sse.md`.

---

## Metrics
- **Type Coverage:** 100% strongly typed Rust.
- **Test Results:**
  - `cargo test --manifest-path server/Cargo.toml --lib system::monitor::tests`: 13 passed, 0 failed (0.44s).
  - `cargo test --manifest-path server/Cargo.toml --lib system::resource_stream::tests`: 6 passed, 0 failed (0.38s).
- **Compiler Warnings:** 0 warnings from `cargo check`.
- **Clippy Issues:** 1 minor warning in new code (`io_other_error` in `resource_stream.rs:84`), 0 in `monitor.rs`.

---

## Recommended Actions
1. Remove `Arc` wrapping around `SubscriptionGuard` in `StreamSubscription` to eliminate an allocation per subscriber.
2. Optimize control frame prefix writing in `encode_control_event` by writing byte slices directly instead of calling `format!`.
3. Eliminate redundant `watch_tx.send_replace()` in `run_publisher` when `is_new == false` to prevent spurious wakeups across concurrent streams.
4. Consolidate revision increment logic into `MonitorCache::bump_revision()` to satisfy DRY.
5. Clean up dead field `over_limit` in `BoundedWriter` and apply clippy's `Error::other` suggestion.

---

## Unresolved Questions
1. In `HostResourceMonitor::run()`, `snapshot_observed_at` is set to `Instant::now()` inside `update()` after `sample_legacy()` completes. If `sample_legacy()` were ever delayed, this stamps the observation instant ~1ms after collection completion rather than at collection termination. Is this minute difference acceptable, or should `snapshot_observed_at` be captured directly in `run()` upon `collection` completion? (Current behavior is acceptable for wire freshness calculation).
