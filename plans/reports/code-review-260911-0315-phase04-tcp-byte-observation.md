# Code Review Report: Phase 04 — Owned TCP Byte Observation

- Date: 2026-09-11
- Reviewer: Phase04Reviewer-3
- Score: 9.3/10
- Plan: `plans/260910-1604-agent-activity-idle-suspend/phase-04-tcp-observation.md`
- Target: `server` crate (`dam-hopper-server`)

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/idle_suspend/activity/mod.rs` (module declarations, network namespace identity helper)
  - `server/src/idle_suspend/activity/tcp_info.rs` (bounded `tcp_info` prefix parser)
  - `server/src/idle_suspend/activity/netlink.rs` (direct unprivileged `NETLINK_SOCK_DIAG` transport and framing)
  - `server/src/idle_suspend/activity/tcp.rs` (`TcpObserver`, differential state machine, diagnostic classifier, live integration test)
- Lines of code analyzed: ~2,600 LOC
- Review focus: Linux netlink UAPI adherence, binary parser bounds safety, nonblocking socket I/O, privacy boundary enforcement (zero inode/cookie/netns leak in logs), differential activity state transitions, YAGNI/KISS/DRY.
- Updated plans: `plans/260910-1604-agent-activity-idle-suspend/phase-04-tcp-observation.md`

### Overall Assessment
Implementation strictly adheres to normative contracts in `phase-04-tcp-observation.md`. UAPI structs and constants (`inet_diag_req_v2`, `unix_diag_req`, `inet_diag_msg`, `unix_diag_msg`, `tcp_info`) match Linux kernel byte layouts and alignments exactly. Prefix counter parsing validates `>= 208` bytes with native-endian `u64` conversions without unsafe C-struct casting. Nonblocking netlink receive enforces a 16 MiB global response budget using `MSG_PEEK | MSG_TRUNC` sizing and respects the acceptance deadline via poll. `TcpObserver` guarantees transactional staging (`prepare_sample` pure read-only, abort on drop, infallible `commit_sample`) and per-socket counter comparisons.

During review, two critical issues were uncovered and immediately resolved in-place:
1. **Critical Netlink Response Port ID Mismatch**: In `netlink.rs`, datagram header validation erroneously checked `nlmsg_pid != 0`. On Linux, the kernel sets `nlmsg_pid` in responses to the receiving socket's assigned port ID (`port_id != 0`). Every diagnostic dump against the live Linux kernel failed with `SocketDiagnostics`. Fixed by passing the bound socket's `port_id` to `parse_netlink_datagram` and verifying matching PID. Added a regression test against live Linux kernel sockets (`test_real_linux_socket_diagnostics_against_kernel`).
2. **Privacy Boundary Violation in Tracing**: `tcp.rs` printed raw inode numbers and network namespace device/inode tuples into `tracing::debug!`. Sanitized all logging messages to remove private identifiers, fulfilling strict privacy constraints.

All 59 unit tests across `idle_suspend::activity` now pass cleanly (100% pass rate).

---

## Critical Issues (Found and Fixed)

1. **Netlink Header `nlmsg_pid` Kernel Response Mismatch (`netlink.rs:294`) [FIXED]**:
   - **Problem**: `parse_netlink_datagram` rejected any datagram where `nlmsg_pid != 0` under the assumption that `nlmsg_pid` represented the kernel sender ID.
   - **Impact**: In Linux Netlink (`NETLINK_SOCK_DIAG`), the kernel addresses replies to the requesting socket by setting `nlmsghdr.nlmsg_pid` to the recipient socket's bound port ID (`bound_addr.nl_pid`), which is an ephemeral non-zero integer. Consequently, all production socket dumps failed immediately upon receiving the first datagram from the kernel.
   - **Resolution**: Updated `parse_netlink_datagram` to accept `expected_pid: u32` (`nl_socket.port_id()`). Verified fix with a live loopback socket test against the Linux kernel (`test_real_linux_socket_diagnostics_against_kernel`).

2. **Leaking Inodes and Namespaces in Debug Tracing (`tcp.rs:200, 224, 295, 313, 411`) [FIXED]**:
   - **Problem**: `tracing::debug!` statements logged `{inode_u32}`, `{item.inode}`, `{current_ns:?}`, and `{final_ns:?}`.
   - **Impact**: Violated explicit privacy boundary: *"Cookies, inodes, namespaces, addresses, ports, counters and raw diagnostic bytes never enter public status, WebSocket hints, logs, audits or formatted errors."*
   - **Resolution**: Removed raw inode and namespace tuples from format strings. Replaced with generic diagnostic labels (e.g. `Initial thread namespace mismatch with owned sockets`, `Owned socket inode exceeds u32::MAX representable diagnostic limit`).

---

## Warnings (Should Fix)

1. **Handling of `WouldBlock` during actual receive (`netlink.rs:860`)**:
   - **Issue**: In `NetlinkSocket::receive_datagram`, after `poll_socket(libc::POLLIN)` succeeds and datagram size is peeked, if the second `libc::recv` (without `MSG_PEEK`) returns `EWOULDBLOCK` / `EAGAIN` (rare edge case on overloaded kernel), it is treated as a hard failure (`SocketDiagnostics`) rather than retrying the poll loop.
   - **Impact**: Potential transient failure if kernel socket buffer state changes between peek and recv.
   - **Recommendation**: In `receive_datagram`, handle `ErrorKind::WouldBlock` on the second recv by continuing the loop.

2. **Target OS Conditional Compilation for Netlink Code (`netlink.rs`)**:
   - **Issue**: `NetlinkSocket` and associated Linux socket diagnostic calls rely on `libc::AF_NETLINK` and Linux UAPI constants, which only compile on Linux.
   - **Impact**: Non-Linux platforms (macOS/Windows developer machines) will fail compilation without target OS guards.
   - **Recommendation**: Ensure `netlink.rs` has `#[cfg(target_os = "linux")]` or provide stub implementations for non-Linux platforms as done in `process.rs` and `mod.rs`.

---

## Suggestions (Nice to Have)

1. **Compiler `dead_code` warnings on staged Phase 05 constants**:
   - Constants like `NLM_F_MULTI`, `NLMSGERR_SIZE`, `INET_DIAG_REQ_V2_SIZE`, `UNIX_DIAG_REQ_SIZE`, and methods `with_limit`, `TcpObserver::new` currently generate 11 `dead_code` warnings.
   - These are legitimate staged interfaces awaiting Phase 05 integration. Add `#[allow(dead_code)]` to silence compiler noise until Phase 05 lands.

2. **Buffer Allocation Optimization in Netlink Receive**:
   - `receive_datagram` executes `buf.resize(datagram_len, 0)` per datagram.
   - Passing a preallocated reusable buffer capacity across the loop would reduce memory allocator pressure when handling large dumps.

---

## Positive Observations

- **100% Verified UAPI Offsets**: Byte offsets for `tcpi_bytes_received` (128..136), `tcpi_bytes_sent` (200..208), `inet_diag_msg` (cookie at 44, inode at 68), and `unix_diag_msg` (inode at 4) match the Linux kernel headers byte-for-byte.
- **Fail-Closed Binary Parsing**: Checked slice arithmetic and 4-byte alignment boundaries prevent buffer out-of-bounds reads and panics on truncated or malformed netlink packets.
- **Strict Sentinel Bounds**: Hard 16 MiB global response budget across dumps enforced via `MSG_PEEK | MSG_TRUNC` sizing. Responses exceeding capacity fail with `ScanLimit`.
- **Differential Activity Model**: Per-socket comparison ensures opposing traffic increases and decreases on different sockets never cancel out. Sockets in `TCP_LISTEN` state are classified and excluded from traffic baselines.
- **Robust Invalidation & Staging**: `prepare_sample` is purely read-only; dropping a prepared sample aborts without mutating committed state; `invalidate` marks validity false to force `BaselineEstablished` on next observation without false activity.

---

## Validation Commands & Results

1. `cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::tcp_info::tests`:
   - 4 passed, 0 failed (0.00s)
2. `cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::netlink::tests`:
   - 20 passed, 0 failed (0.00s)
3. `cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::tcp::tests`:
   - 17 passed, 0 failed (0.00s), including live kernel integration regression test
4. `cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity`:
   - 59 passed, 0 failed (0.22s)

---

## Reviewed Files

- `server/src/idle_suspend/activity/mod.rs`
- `server/src/idle_suspend/activity/tcp_info.rs`
- `server/src/idle_suspend/activity/netlink.rs`
- `server/src/idle_suspend/activity/tcp.rs`

---

## Unresolved Questions

1. Will deployed target host environments with custom seccomp or SELinux profiles permit unprivileged `AF_NETLINK` `NETLINK_SOCK_DIAG` socket creation without `CAP_NET_ADMIN`? (The design specifies that hosts restricting this must report `SocketDiagnostics` and fail opt-in eligibility safely).
