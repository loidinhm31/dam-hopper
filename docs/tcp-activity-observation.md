# Owned TCP Byte Observation

**Status:** Phase 04 implemented 2026-09-11. This page documents the private,
read-only Linux socket-diagnostics seam used by the configured-agent
`agent-activity` idle-suspend policy. It does not expose a REST/WebSocket API,
make an automatic suspend decision, or authorize a handoff.

## Source map

| Source | Contract |
| --- | --- |
| `server/src/idle_suspend/activity/tcp_info.rs` | Bounded `tcp_info` prefix parser for cumulative receive/send counters |
| `server/src/idle_suspend/activity/netlink.rs` | Unprivileged `NETLINK_SOCK_DIAG` requests, bounded transport, and multipart parser |
| `server/src/idle_suspend/activity/tcp.rs` | `SocketDiagnosticsSource`, Linux implementation, transactional observer, and baseline comparison |
| `server/src/idle_suspend/activity/mod.rs` | Private activity exports, hard bounds, and `NetworkNamespaceIdentity::current_thread()` |
| `server/src/idle_suspend/activity/*` tests | Parser, framing, deadline/budget, namespace, race, and baseline regressions |

`activity::process` and `activity::tcp` are crate-private module exports;
`activity::netlink` and `activity::tcp_info` remain private implementation
modules. No activity type or diagnostic transport is public API. The shared
`NetworkNamespaceIdentity::current_thread()` helper reads the observing
thread's namespace identity for both Phase 03 ownership and Phase 04 fencing.

Phase 03 produces the `OwnedSocketSet` consumed here. Phase 05 combines this
prepared network result with PTY and process evidence in the transactional
sampler, then performs warning projection and final handoff admission.

## Observation flow

A TCP sample is prepared as one bounded, read-only operation:

```text
Phase 03 OwnedSocketSet + observing namespace
  -> verify current thread network namespace
  -> open one fresh nonblocking NETLINK_SOCK_DIAG socket
  -> dump TCP/IPv4 and TCP/IPv6 records
  -> if needed, dump UDP/IPv4, UDP/IPv6, then AF_UNIX records
  -> parse only owned inodes and their INET_DIAG_INFO attributes
  -> verify the thread namespace again
  -> compare current SocketKey/counter map with committed baseline
  -> return PreparedNetworkSample; commit separately
```

The diagnostics source never opens an owned descriptor, changes namespaces,
executes a process, sends traffic, or writes host state. It only asks the
kernel for current diagnostic records and classifies the observation as
available or unavailable.

## `tcp_info` prefix contract

`INET_DIAG_INFO` carries a native `tcp_info` byte payload. The parser reads a
stable prefix without depending on the local libc structure layout:

| Field | Byte range | Decode |
| --- | ---: | --- |
| `tcpi_bytes_received` | `128..136` | native-endian `u64` |
| `tcpi_bytes_sent` | `200..208` | native-endian `u64` |

`TCP_INFO_REQUIRED_PREFIX_BYTES` is `208`. A shorter attribute returns
`TcpInfoParseError::TooShort`; no counters are guessed. A payload longer than
208 bytes is accepted and trailing kernel extension fields are ignored. The
implementation checks slices and uses `try_into` plus `u64::from_ne_bytes`;
it never casts raw bytes to `libc::tcp_info`, reads unbounded offsets, or uses
`size_of::<libc::tcp_info>()` as a protocol requirement. The parse error records
only lengths, not raw kernel bytes.

## Netlink transport and wire contract

### Socket and requests

`NetlinkSocket::open` creates an unprivileged Linux
`AF_NETLINK`/`SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK` socket with protocol
`NETLINK_SOCK_DIAG`. It binds with a kernel-assigned port ID and retains that
ID for sender validation. No elevated capability or process-descriptor access
is required.

Each dump uses `SOCK_DIAG_BY_FAMILY`, `NLM_F_REQUEST | NLM_F_DUMP`, a nonzero
sequence number, and kernel sender PID `0`. Requests are encoded explicitly
with checked byte offsets rather than local struct casts:

- TCP/IPv4 and TCP/IPv6 use `inet_diag_req_v2`, request all TCP states, and
  request the `INET_DIAG_INFO` extension.
- UDP/IPv4 and UDP/IPv6 use the same request shape without TCP information;
  seeing an owned UDP inode reports `unsupportedTransport`.
- AF_UNIX uses `unix_diag_req` to resolve an owned inode that was not found in
  the TCP/UDP dumps.

The source runs TCP/IPv4 first, then TCP/IPv6. UDP and Unix dumps run only
while owned inodes remain unresolved, reducing work without treating an
empty TCP result as complete prematurely.

### Deadlines and response budget

Send and receive operations call `poll(2)` on the nonblocking socket with a
monotonic `Instant` deadline. Remaining time is recalculated before each poll;
interrupted polls and interrupted/nonblocking syscalls retry while the
original deadline remains valid. Expiration returns `scanTimeout`; poll or
socket failures return `socketDiagnostics`.

`receive_datagram` first peeks with `MSG_PEEK | MSG_TRUNC` to obtain the full
kernel datagram size, checks that size against the remaining global response
budget, allocates exactly that size, then receives the datagram without
`MSG_TRUNC`. The default `MAX_NETLINK_RESPONSE_BYTES_LIMIT` is 16 MiB across
all dumps in one sample. A datagram that exceeds the remaining budget returns
`scanLimit` before allocation; the total is incremented only after an exact
receive.

### Multipart parsing

`parse_netlink_datagram` walks every aligned message in a datagram and
validates:

- complete `nlmsghdr`, in-range length, and 4-byte alignment;
- expected sequence and the socket's port ID as the sender PID;
- recognized message types and dump-specific payload lengths;
- nested attribute lengths and 4-byte alignment.

`NLMSG_DONE` closes one multipart dump. A negative optional completion code is
an error. `NLMSG_ERROR` accepts only a zero error code. `NLM_F_DUMP_INTR`,
`NLMSG_OVERRUN`, trailing data after `NLMSG_DONE`, sequence/PID mismatches,
truncated records, duplicate TCP information attributes, malformed
`INET_DIAG_INFO`, and unexpected message types all fail with
`socketDiagnostics`; they never become a partial quiet result.

Unowned records still have framing and alignment checked, but their attributes
are not interpreted. Owned TCP records must provide exactly one valid
`INET_DIAG_INFO` payload and a usable diagnostic cookie. Listening sockets
resolve the owned inode without producing a persistent TCP baseline entry.
`INET_DIAG_NOCOOKIE` is unavailable rather than a stable identity.

## Linux source and namespace contract

`LinuxSocketDiagnostics` implements `SocketDiagnosticsSource` with a default
16 MiB response limit. Before opening the socket, it compares the supplied
`OwnedSocketSet.namespace` with `NetworkNamespaceIdentity::current_thread()`.
After the final dump, it performs the same comparison again. A mismatch at
either boundary returns `namespaceMismatch`; the collection is not accepted.

On Linux, `current_thread()` reads metadata for
`/proc/thread-self/ns/net`, falling back to `/proc/self/ns/net` when the
thread-specific path is unavailable. The identity is the filesystem device
and inode pair. Non-Linux builds return `procAccess` because this observer is
Linux-specific.

Owned socket inodes are checked for `u32` representability before querying the
kernel. TCP/UDP diagnostic records expose a 32-bit inode, so a larger owned
inode is a socket-diagnostics failure with bounded implicated-socket evidence.
Every owned inode must be resolved by the applicable dumps. An inode still
unresolved after all applicable dumps is reported as `socketDiagnostics` with
`retryable_close_race = true`; missing or corrupt data for a record that was
returned is not silently reclassified as a close race.

## Observer and baseline contract

`SocketDiagnosticsSource` is the synchronous test seam:

```rust
fn diagnose_sockets(
    &self,
    owned_sockets: &OwnedSocketSet,
    deadline: Instant,
) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable>;
```

`SocketKey` contains the network namespace, address family, and the two-word
`inet_diag` cookie. It intentionally excludes the inode because Linux can
reuse an inode after close. The inode is retained as `join_inode` metadata to
detect key replacement/reuse while comparing samples.

`TcpObserver::prepare_sample` is read-only and transactional. It obtains the
current map, builds a candidate baseline, and returns a
`PreparedNetworkSample`; dropping that value leaves the committed baseline
unchanged. `commit_sample` advances the baseline only after the caller accepts
the complete sample. `invalidate` marks the baseline invalid while retaining
historical socket identity for diagnostics; the next successful sample reports
`BaselineEstablished`.

| Result | Meaning |
| --- | --- |
| `BaselineEstablished` | First successful sample or first sample after invalidation |
| `Unchanged` | Same `SocketKey` set, same join inode for each key, and identical sent/received counters |
| `Activity` | Any new/retired key, inode replacement, counter increase, or counter reset/decrease |

Comparison is per persistent socket. It does not sum counters across sockets,
so a close/new-socket transition cannot cancel an active socket's byte delta.
A failed preparation cannot advance state or produce `Unchanged`.

## Failure, privacy, and limits

The seam returns the closed `ActivityUnavailableReason` values already shared by
activity discovery, including `scanTimeout`, `scanLimit`, `socketDiagnostics`,
`unsupportedTransport`, `namespaceMismatch`, and `procAccess`. Failure
contexts retain only bounded implicated owned-process/socket evidence. Raw
netlink datagrams, command lines, arguments, terminal bytes, credentials,
addresses, and payloads are not retained, serialized, or exposed publicly.

The 16 MiB response budget is global to the sample, not per datagram or per
family. Netlink framing is validated before filtering, and no truncated or
interrupted multipart stream can qualify as quiet. This observer is a polling
heuristic: traffic or a short-lived socket can begin and end between samples;
TCP counters do not prove that an agent will not resume work after the sample.

## Verification coverage

The focused module tests cover exact and extended `tcp_info` prefixes,
short-prefix rejection and native-endian decoding; request field encoding;
netlink sequence/PID/type/length/alignment validation; multipart completion,
interruption, and error handling; datagram budget behavior; TCP/UDP/Unix
ownership filtering; namespace checks; close-race classification; and
baseline establishment, unchanged samples, activity deltas, key changes,
inode reuse, invalidation, and transactional commit behavior.

No production suspend, RTC mutation, socket mutation, or privileged operation
is part of these tests. The [Phase 05 admission guide](./agent-activity-automatic-admission.md)
documents how this result joins PTY/process evidence under a generation-fenced
final claim.

## Related documentation

- [Configured-Agent Process Discovery](./agent-activity-process-discovery.md) —
  Phase 03 roots, attribution, namespace-qualified socket ownership, and
  `OwnedSocketSet` input.
- [PTY Activity Observation](./pty-activity-observation.md) — Phase 02 root,
  output, input, snapshot, and watcher evidence.
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md) —
  fail-closed privacy and deployment policy.
- [System Architecture](./system-architecture.md) — subsystem data flow.
- [Agent Activity Automatic Admission](./agent-activity-automatic-admission.md) —
  Phase 05 pair transaction, final claim, coordinator, and status projection.

## Unresolved questions

None requiring a product decision. Kernel support, procfs visibility, and
observer latency remain deployment qualification prerequisites; the Phase 05
sampler and final handoff contract are documented in
[Agent Activity Automatic Admission](./agent-activity-automatic-admission.md).
