# Real auth cutoff harness repair

## Causal findings

- `3900ms` was measured after child initialization, not against the watcher's actual five-second cadence. The writer times out a send after two seconds; it then signals reader cancellation. Reader teardown aborts the auth watcher. Consequently the flood can close the socket before live-auth verification produces cutoff telemetry. Exact timing of the reported failed run remains unobserved; this source-level race is removed from qualification setup.
- A fixed ~3MiB flood and small receive buffer did not establish an outstanding server send. Global telemetry clear + last-record selection also allowed cross-test clearing/misattribution; the first apparent successful trigger was not reliable connection-specific evidence.
- SQLite uses WAL. An external `BEGIN IMMEDIATE` does not stop SELECTs, while two sequential busy writes release the connection mutex between operations. They cannot guarantee the watcher's full two-second lookup deadline.

## Changes

- `semantic_ws.rs`: replace global telemetry ring/clear interface with opt-in bounded observations. Local Opened observation carries a Weak presence-registry handle; subsequent events correlate exact opaque server connection ID. No wire change, auth identifiers, payload logging, artificial sleeps, or per-message allocations without a subscriber.
- Observe actual `send()` future Pending, per-send completion/drop, live-check start/success, admission revocation, reap completion, cancellation, cutoff telemetry, and connection retirement. RAII completion covers aborted sends.
- Harness waits for an observed healthy live check and its scheduled next tick. Real 1MiB echoed unsupported-method responses saturate the unread TCP socket; require a send interval Pending for at least100ms and still outstanding in observations at admission cutoff. Requests remain below queue/rate-burst limits; client never reads after initialization.
- SQLite timeout: separate bounded helper process acquires POSIX exclusive locks over all five WAL SHM reader slots (123–127). Helper acknowledges acquisition. Watcher's own real SELECT must produce exact two-second timeout telemetry. Release locks, reap helper, then require a fresh AuthStore read to drain/recover. No mutex-acquiring competing probe.
- Source grounding: Cargo.lock selects rusqlite0.31/libsqlite3-sys0.28. The bundled Unix VFS asserts these lock offsets; WAL read retry policy outlasts the outer two-second deadline. Runtime VFS qualification remains required.
- Mongo timeout: owned TCP proxy with real blocked-byte evidence and notification-based release; no failCommand. Explicit proxy client/store avoids process-global URI mutation. Both fixture auth handles/router use Mongo. Reject unsupported nonplain/nonloopback URI forms.
- Keep production five-second recheck and two-second lookup untouched. Qualification reap/cancel limit is six seconds. Require both zero active sessions and zero active trees.
- Each case has a40s cooperative watchdog, finite events/aggregate samples, and secret-free JSON evidence emitted by Drop on success or failure. Retain terminal events to avoid consuming them before a later waiter. Proxy/helper cleanup is guarded.

## Validation handoff

No builds, tests, linters, formatters, or smoke checks executed, as assigned. Parent should compile/run `server/tests/semantic_ws_auth_containment.rs` once with `TEST_MONGODB_URI=mongodb://127.0.0.1:36121`, an external process timeout, and captured `--nocapture` output. Inspect every SQLite/Mongo trigger's `semantic_auth_case` record. The ignored helper test is subprocess-only and explicitly invoked by the mandatory SQLite matrix; no matrix case is skipped. Include the target integration file in final delivery even if it is currently untracked.

## Remaining qualification risks / unresolved questions

- Runtime must establish selected SQLite VFS behavior and clean post-release recovery; source evidence is not execution evidence.
- Actual socket capacity and scheduling must permit sustained overlap. Harness fails rather than pretending saturation when overlap cannot be established.
- Outstanding observed send intervals are direct future-poll evidence, not an atomic kernel TCP-state snapshot. Cross-task observations cannot establish nanosecond-level ordering inside a ready poll.
- Cooperative watchdog does not bound arbitrary blocking runtime shutdown/destructors; retain the parent's external process timeout.
