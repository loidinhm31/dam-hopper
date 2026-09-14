# Phase 04 — Owned TCP byte observation

## Context links

- [Plan](plan.md), [normative contract](design-contract.md), [repository findings](research/repository-findings.md).
- Prerequisites: [operator policy and shared contracts](phase-01-policy-contracts.md), [PTY root/output seam](phase-02-pty-observation.md), and frozen typed ownership from [process discovery](phase-03-process-discovery.md).
- Consumer and transaction owner: [sampler/coordinator](phase-05-sampler-coordinator.md). Integrated proof: [Phase 07](phase-07-verification.md).
- Existing [port-forward listener detector](../../server/src/port_forward/detector.rs) is not a byte observer and must not be repurposed.
- Linux UAPI references for implementation: `linux/netlink.h`, `linux/sock_diag.h`, `linux/inet_diag.h`, `linux/unix_diag.h`, and `linux/tcp.h`; copy only the minimal ABI constants/offsets needed and test them against byte fixtures.

## Overview

- Date: 2026-09-11.
- Description: classify sockets owned by discovered agent lineages, read IPv4/IPv6 TCP cumulative byte counters through direct unprivileged `NETLINK_SOCK_DIAG`, and prepare identity-safe per-socket activity deltas without exposing process or network details.
- Priority: P2. Estimated implementation effort: 14h.
- Implementation status: DONE (2026-09-11; 100%). Review status: Passed (Cycle 2: `WouldBlock` handling verified, staged dead-code warnings eliminated, privacy boundary verified, and 100% test pass rate).
- Validation: Phase-specific TCP/netlink tests passed 40/40; latest activity suite passed 59/59; full idle-suspend library passed 128/128 and crate-wide tests passed 142/142, with no failures.
- Evidence: [test report](../reports/tester-260911-0313-phase04-tcp-byte-observation.md) · [Cycle 2 code review](../reports/code-review-260911-0738-phase04-tcp-byte-observation-cycle2.md).
- Dependencies: Phase03 supplies a complete `OwnedSocketSet`; Phase05 supplies the sole cooperative worker, common deadline, one full retry, pair commit/abort, invalidation, and epoch semantics. Phase04 performs no suspend or public status action.

## Key Insights

- `/proc/<pid>/fd/* -> socket:[inode]` proves same-sample ownership but inode can be reused. It is join metadata only. Persistent TCP identity is current network namespace plus address family plus the two-word socket diagnostic cookie.
- `/proc/net/tcp`, the existing port detector, host-interface byte totals, and `/proc/<pid>/io` cannot provide attributable application TCP byte deltas. Production must issue `SOCK_DIAG_BY_FAMILY` requests directly; never spawn `ss`, `lsof`, or `netstat`.
- `INET_DIAG_INFO` carries a variable-length native Linux `tcp_info`. The required cumulative values are `tcpi_bytes_received` at bytes `128..136` and `tcpi_bytes_sent` at `200..208` in the stable prefix used by this feature. A response shorter than 208 bytes cannot qualify. Parse slices with checked offsets and native-endian conversion; never cast response memory to a local `struct tcp_info`.
- Socket membership can change between procfs collection and the diagnostic dump. Therefore process and network states are one transaction: both prepare from prior committed state, then both commit or neither does.
- Aggregate totals are unsafe across a changing socket set. Compare each persistent socket key independently. New/retired sockets and a decreasing counter are conservative activity plus a new baseline.
- UDP/QUIC has no authorized counter substitute. An owned INET UDP socket makes the observation `unsupportedTransport`. A positively classified AF_UNIX socket is known local IPC and ignored; traffic delegated through an external daemon or UNIX proxy remains outside the attribution guarantee. An owned inode not classified as TCP, UDP, or AF_UNIX is unavailable.
- Unprivileged access is a deployment prerequisite, not a fallback decision. Failure under service hardening or the target kernel blocks `agent-activity`; it never turns into zero traffic.

## Requirements

1. Linux production uses `socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK, NETLINK_SOCK_DIAG)`, binds `sockaddr_nl` with kernel-assigned port ID and no groups, obtains that port ID, and sends direct `SOCK_DIAG_BY_FAMILY` dump requests to kernel port ID zero. Use existing `libc = "0.2"`; add no shell command or general netlink framework.
2. Walk a fixed classification order—TCP/IPv4, TCP/IPv6, UDP/IPv4, UDP/IPv6, AF_UNIX—and stop once every owned inode is resolved. Each INET step is a complete current-namespace dump for that family/protocol; request `INET_DIAG_INFO` only for TCP using `idiag_ext = 1 << (INET_DIAG_INFO - 1)` and request all states. Issue AF_UNIX `unix_diag_req` only for still-unresolved inodes, with no names, paths, peer lists or memory attributes. Conditional stopping avoids unrelated dumps without weakening classification because socket inodes are unique within the namespace.
3. Use a fresh nonzero netlink sequence for each request. Require sender port ID zero, matching sequence, valid `nlmsg_pid`, a complete multipart stream ending in matching `NLMSG_DONE`, and no `NLM_F_DUMP_INTR`. Treat a nonzero `NLMSG_ERROR`, `ENOBUFS`, sender/sequence mismatch, unexpected response type, missing `NLMSG_DONE`, malformed alignment or datagram truncation as unavailable.
4. Receive nonblocking and wait with the remaining monotonic deadline. Check cancellation/deadline between requests and receives. The one-second value is an acceptance deadline: a response completing after it returns `scanTimeout` and cannot commit. It is not a promise that the kernel will cancel a stalled syscall.
5. Bound total bytes received across every dump in one prepared network sample to 16 MiB. Determine each netlink datagram's full length with bounded `MSG_PEEK | MSG_TRUNC`, reject a datagram exceeding remaining capacity, then receive it without `MSG_TRUNC`. A fully terminated multipart response totaling exactly 16 MiB may qualify. If the budget is exhausted before `NLMSG_DONE` or the next datagram exceeds remaining capacity, return `ScanLimit`; if the receive reports `MSG_TRUNC`/loss despite sizing, return `SocketDiagnostics`. Never accept a partial result.
6. Parse netlink headers and aligned attributes from byte slices using checked addition and 4-byte alignment. Validate minimum fixed payload lengths before field access and skip bounded alignment padding without interpreting its bytes. Do not use an unaligned/raw struct cast, transmute, unchecked pointer arithmetic, or the build host's `size_of::<tcp_info>()` as a wire-length requirement.
7. For each `inet_diag_msg`, read family, state, two-word cookie and `idiag_inode` from the fixed UAPI prefix. Ignore unowned records after validating their framing. An owned inode larger than the diagnostic ABI's `u32` inode field is unrepresentable and returns `socketDiagnostics`; never truncate it.
8. For an owned non-listening TCP record, require exactly one well-framed `INET_DIAG_INFO` attribute with at least the 208-byte required prefix. Parse `tcpi_bytes_received` from offset 128 and `tcpi_bytes_sent` from offset 200 using `u64::from_ne_bytes`; longer kernel structs are accepted. Missing, duplicate, short or malformed info is unavailable. TCP listener state alone is classified then ignored and needs no byte baseline.
9. Reject `INET_DIAG_NOCOOKIE` (`[u32::MAX; 2]`) for every owned measured TCP socket. Build private `SocketKey { namespace, family, cookie_words }`; protocol is implicitly TCP. Addresses, ports, UID, queues and congestion data are neither retained nor logged.
10. Require each typed owned inode to resolve exactly once to one supported classification. Duplicate/conflicting records are malformed. An owned UDP/IPv4 or UDP/IPv6 record returns `unsupportedTransport` while present. A positively resolved AF_UNIX record is removed from the unclassified set and ignored. Any inode left unresolved after all required dumps returns `socketDiagnostics`, because it may be a close race or an unsupported socket family.
11. Re-read `/proc/thread-self/ns/net` identity immediately before diagnostic collection and after the final dump using the same `(device,inode)` representation as Phase03. Both must equal `OwnedSocketSet.namespace`. Mismatch returns `namespaceMismatch`; never call `setns`, enter a child namespace, or merge records across namespaces.
12. Deduplicate ownership in Phase03 by typed inode, then deduplicate diagnostic TCP records by `SocketKey`. Shared FDs/processes cannot multiply activity. Inode remains optional comparison metadata in the baseline only to conservatively detect key/inode replacement; it is never the persistent key.
13. `TcpObserver::prepare_sample(&self, ...)` compares a complete current map with only the prior committed map and builds scratch next state. First success and first success after `invalidate()` yield `NetworkChange::BaselineEstablished`. With a valid baseline: any sent or received increase, new key, retired key, key joined to a different inode, or counter decrease yields `Activity`; an identical key set with identical counters yields `Unchanged`.
14. Never sum current sockets then subtract an old aggregate. Never allow one socket's decrease/retirement to cancel another socket's increase. Counter decrease is activity and replaces that socket's baseline; it is not negative traffic or a zero delta.
15. Empty complete `OwnedSocketSet.inodes` prepares a valid empty TCP baseline without opening netlink. It does not inspect unrelated sockets. Any incomplete Phase03 ownership result never reaches Phase04 as an empty set.
16. `commit_sample` is infallible and consumes prepared next state. Dropping `PreparedNetworkSample` is abort. Phase05 prepares process, then TCP from `PreparedProcessSample::sample().owned_sockets`, rechecks cancellation/deadline/request/fleet/input/activity fences, and commits both back-to-back only on full success. A TCP failure must not advance process retention; a process failure must not advance TCP counters.
17. `invalidate()` marks the TCP baseline invalid without inventing a delta. Phase05 invokes both observer invalidations after retry-exhausted unavailable/late samples and after handoff/resume. The next complete sample is `BaselineEstablished`, forcing a full quiet window but not genuine network activity. Recovery, resume, helper release and rediscovery cannot increment epoch activity revision or grant a new epoch after an automatic attempt was spent.
18. Mark `retryable_close_race = true` only when an owned inode collected from a validated relevant FD set is absent from every complete TCP/UDP/UNIX dump, the expected signature of a socket closing between procfs and diagnostics. Phase05 may retry the entire Phase03+04 pipeline once, inside the original one-second deadline; an unsupported family that repeats remains unavailable on the second pass. `NLM_F_DUMP_INTR`, permission, ABI, malformed, overflow, unsupported transport, namespace and response-loss errors are nonretryable. No internal full retry, deadline extension or second retry.
19. Production collection is read-only and unprivileged. It must not destroy sockets, install a BPF filter, request privileged diagnostic extensions, inspect payload/TLS plaintext, connect to peers, signal processes, invoke external APIs, suspend the host or modify network state.
20. All symbols remain private or `pub(crate)` inside the server. Cookies, inodes, namespaces, addresses, ports, counters and raw diagnostic bytes never enter public status, WebSocket hints, logs, audits or formatted errors. Phase05 alone projects attributable PID and qualified safe identity into the authenticated/no-store measurement warning.
21. Consume Phase03's common `FailureContext` and `OwnedSocketInode { inode, representative_owner, has_additional_owners }` without a second ownership model. Deduplicate/filter by `inode`, not equality of the entire ownership record.
22. Owned UDP or an attributable diagnostic failure returns implicated owned inode records from this preparation, bounded by the existing 8,192 socket cap. Global access/framing/deadline failures carry no invented owner. No extra socket/process enumeration, privilege or deadline extension is permitted for reporting.
23. Phase05 joins implicated inode records to the same uncommitted process preparation before abort. Representative mapping marks known additional owners as truncated warning examples; it never weakens full collection completeness or advances either baseline.

## Architecture

Private module layout:

```text
server/src/idle_suspend/activity/mod.rs       # Phase03 owner: common errors/types + module declarations
server/src/idle_suspend/activity/process.rs   # Phase03 typed OwnedSocketSet producer
server/src/idle_suspend/activity/tcp.rs       # observer, classification, baseline comparison, fake seam/tests
server/src/idle_suspend/activity/netlink.rs   # Linux direct NETLINK_SOCK_DIAG transport/framing
server/src/idle_suspend/activity/tcp_info.rs  # bounded INET_DIAG_INFO/tcp_info byte parser
```

Phase04 supplies these module declarations to the Phase03 owner and does not concurrently edit `activity/mod.rs`:

```rust
mod netlink;
mod tcp_info;
pub(crate) mod tcp;
```

Frozen crate-private interface:

```rust
pub(crate) struct TcpObserver<D = LinuxSocketDiagnostics> {
    diagnostics: D,
    committed: TcpBaselineState,
}

impl<D: SocketDiagnosticsSource> TcpObserver<D> {
    pub(crate) fn prepare_sample(
        &self,
        owned: &OwnedSocketSet,
        deadline: Instant,
    ) -> Result<PreparedNetworkSample, ActivityUnavailable>;

    pub(crate) fn commit_sample(
        &mut self,
        prepared: PreparedNetworkSample,
    ) -> NetworkSample;

    pub(crate) fn invalidate(&mut self);
}

pub(crate) struct PreparedNetworkSample {
    sample: NetworkSample,
    next_state: TcpBaselineState,
}

impl PreparedNetworkSample {
    pub(crate) fn sample(&self) -> &NetworkSample;
}

pub(crate) struct NetworkSample {
    pub(crate) change: NetworkChange,
}

pub(crate) enum NetworkChange {
    BaselineEstablished,
    Unchanged,
    Activity,
}
```

`SocketDiagnosticsSource`, `LinuxSocketDiagnostics`, `TcpBaselineState`, `SocketKey`, `TcpFamily`, `TcpCounters`, diagnostic records and UAPI parser types remain private to the activity module. `SocketKey` contains `NetworkNamespaceIdentity`, an enum restricted to IPv4/IPv6, and `[u32; 2]` cookie words. A baseline value contains sent/received `u64` counters and the same-sample join inode only for replacement detection. `NetworkSample` intentionally carries no identities or byte counts.

Common error contract, defined by Phase03 in `activity/mod.rs` and consumed without adding a second error type:

```rust
pub(crate) struct ActivityUnavailable {
    pub(crate) reason: ActivityUnavailableReason,
    pub(crate) retryable_close_race: bool,
    pub(crate) context: FailureContext,
}

pub(crate) enum ActivityUnavailableReason {
    ProcAccess,
    ScanLimit,
    ScanTimeout,
    SocketDiagnostics,
    UnsupportedTransport,
    NamespaceMismatch,
    IdentityUncertain,
    CounterOverflow,
}
```

Error mapping is closed: netlink/socket/ABI/framing/unclassified failures use `SocketDiagnostics`; owned UDP uses `UnsupportedTransport`; namespace change uses `NamespaceMismatch`; total response overflow uses `ScanLimit`; deadline uses `ScanTimeout`. Error display must be generic and contain no raw kernel record or private identifier.

End-to-end data and commit flow:

```text
Committed process + TCP states
  -> ProcessDiscovery::prepare_sample (no mutation)
  -> typed OwnedSocketSet(namespace, sorted unique inodes)
  -> revalidate observing-thread namespace
  -> direct TCP4/TCP6 + UDP4/UDP6 diagnostics; AF_UNIX if needed
  -> complete inode classification + TCP_INFO parse
  -> per-SocketKey comparison in scratch state
  -> PreparedNetworkSample
  -> worker rechecks deadline/cancellation/request and revision fences
  -> infallible process commit + TCP commit, back-to-back
  -> Phase05 combines ProcessChange/NetworkChange/raw output/input
```

An error, timeout, stale request or cancellation drops both preparations. After an optional retry ends unavailable/late, Phase05 invalidates both comparison baselines while Phase03 preserves detached lineage and raw-output handles. A preparation stale solely because a known newer input/fleet event arrived is dropped; that newer event owns the activity/fence transition. Last committed maps are never current evidence after published unavailability. The next successful end-to-end observation establishes a baseline and resets quiet; it does not become phantom network activity or a new post-attempt epoch.

## Related code files

Create:

- `server/src/idle_suspend/activity/tcp.rs`: `TcpObserver`, prepared/commit state, per-socket comparison, diagnostic classification, fake source and focused tests.
- `server/src/idle_suspend/activity/netlink.rs`: Linux socket lifecycle, request encoding, nonblocking deadline-aware send/receive, bounded multipart parser and classification records.
- `server/src/idle_suspend/activity/tcp_info.rs`: checked TCP_INFO prefix parser and byte-fixture tests.

Coordinate, do not edit concurrently:

- `server/src/idle_suspend/activity/mod.rs`: Phase03 owner adds declarations and common types exactly as frozen above; Phase05 becomes owner after Phase03/04 handoff.
- `server/src/idle_suspend/activity/process.rs`: consumes no Phase04 internals; produces only typed `OwnedSocketSet`.

Inspect, do not repurpose:

- `server/src/port_forward/detector.rs`: existing `/proc/net/tcp*` listener poll remains independent. Do not route activity through it or change listener behavior.
- `server/Cargo.toml`: reuse existing `libc`; no new dependency is planned.
- `server/src/idle_suspend/coordinator.rs` and `server/src/idle_suspend/tests.rs`: Phase05 owns worker/retry/epoch integration and scripted cross-observer tests.
- `server/tests/idle_suspend.rs`: Phase07 owns the public ignored live smoke after production integration.

No status DTO, API route, client, UI, helper protocol, persistence, service unit or external command changes belong to Phase04. No file is deleted.

## Implementation Steps

1. Confirm Phase03's final `OwnedSocketSet`, `OwnedSocketInode`, `NetworkNamespaceIdentity`, common error and prepare/commit definitions. Give the three Phase04 module declarations to the Phase03 owner; do not create a competing module root or error enum.
2. Add a compact private UAPI constants/encoder layer in `netlink.rs`: `NETLINK_SOCK_DIAG`, `SOCK_DIAG_BY_FAMILY`, netlink request/dump flags, `NLMSG_*`, `NLM_F_DUMP_INTR`, `INET_DIAG_INFO`, `INET_DIAG_NOCOOKIE`, TCP listen state and 4-byte alignment. Encode zeroed `inet_diag_req_v2`/`unix_diag_req` request payloads explicitly and test exact lengths/fields.
3. Implement `LinuxSocketDiagnostics` with one fresh CLOEXEC/nonblocking netlink socket per prepared sample. Bind no groups, read the assigned port ID, use monotonic sequence numbers within the sample, target kernel PID zero and close by RAII on every path.
4. Implement deadline-aware send/receive around `poll`/equivalent and nonblocking syscalls. Retry a syscall interrupted by `EINTR` only after checking cancellation/deadline; this is not an end-to-end retry. Convert deadline exhaustion to `ScanTimeout`, receive loss/truncation to nonretryable `SocketDiagnostics`.
5. Implement the global response-byte budget. Peek each datagram's real size without consuming it, verify it fits the remaining 16 MiB, grow/reuse one bounded buffer, receive the exact datagram and reject `MSG_TRUNC`. Count headers, payload and padding actually received across all dumps. Exact complete limit succeeds; limit plus one or completion beyond the bound fails.
6. Parse every datagram as aligned netlink messages. Require matching sender/sequence, safe `nlmsg_len`, known response type, bounded alignment and a terminal `NLMSG_DONE`. Ignore padding contents; reject lengths whose aligned extent exceeds the datagram, `NLMSG_ERROR`, interrupted/missing completion and records appearing after completion. Do not accept whatever records happened to arrive before an error.
7. Parse `inet_diag_msg` fixed fields and aligned attributes with checked slices. Filter by owned inode value only after record framing is proven; owner metadata is not part of socket equality. Skip addresses/ports without retaining them. Detect duplicate owned inode/classification or duplicate TCP cookie keys.
8. Implement `tcp_info::parse_counters(bytes)`: require length at least 208, load exactly offsets 128 and 200 with native-endian `u64`, ignore supported trailing extension bytes, and return a closed parser error with no input bytes. Never instantiate or dereference `libc::tcp_info`.
9. Run TCP4 and TCP6 dumps with `INET_DIAG_INFO`. Classify joined listener records and exclude them from baselines. For other joined TCP records, require valid cookie and counters and produce a private key/value. Do not count connection existence or queue sizes as traffic.
10. Continue in fixed order with UDP4 then UDP6 only while owned inodes remain unresolved. A joined UDP record is `UnsupportedTransport`; finish validating that dump's framing, then fail without pretending TCP covers it. Stop subsequent family dumps once all owned inodes have a unique classification.
11. If owned inodes remain unresolved, run AF_UNIX diagnostics with `udiag_show = 0`. Remove positively joined UNIX records as intentionally ignored. Any remaining or conflicting owned inode is `SocketDiagnostics`; mark retryable only when the full evidence identifies expected close/dump churn.
12. Validate current-thread network namespace before request creation and after all dumps. The source must not cache namespace identity across samples or call `setns`.
13. Implement `TcpObserver::prepare_sample` as a pure comparison against committed state. Use one current map keyed by namespace/family/cookie. Detect increases, set membership changes, inode replacement and decreases before selecting `Activity`; do not aggregate counters.
14. Implement consuming, infallible `commit_sample` and baseline-preserving abort-by-drop. `invalidate()` sets baseline validity false without discarding the map as identity history. Phase05 invokes it after retry-exhausted unavailable/late samples and handoff/resume. First complete preparation afterward reports `BaselineEstablished` regardless of current socket count.
15. Add pure parser/source tests with an injected smaller response budget and synthetic multipart datagrams. Add state tests with typed diagnostic records; no test needs privileged access, remote network, actual agents or public private-ID fields.
16. Add Phase05 library integration cases for process-success/TCP-failure abort, one full retry, late result, invalidate/recovery and spent epoch. These remain `server/src/idle_suspend` library tests because external integration crates cannot access crate-private observer types.
17. Reserve the one real-host end-to-end path for Phase07's ignored `server/tests/idle_suspend.rs::activity_live_linux_pty_tcp_smoke`. It must use a managed test child and loopback peer, production proc/netlink observer, public status and a panic/recording `FakeExecutor`; it must not expose private symbols or invoke suspend.
18. Hand Phase05 `TcpObserver`, prepared samples, changes and the common error carrying private failure context. Preserve implicated ownership records for warning projection before process preparation is dropped. Hand Phase07 parser filters and live-smoke prerequisites; availability requires complete direct-netlink qualification in the target service context.
19. Prove owned UDP yields current representative process evidence, global diagnostic failure yields none, and shared ownership reports omission without inventing an exhaustive blocker count. Error display/debug remains generic and neither observer commits on failure.

## Todo list

- [x] Consume Phase03 typed namespace/inode ownership without redoing discovery.
- [x] Encode direct unprivileged TCP4/TCP6 and UDP4/UDP6 socket-diag requests.
- [x] Add conditional AF_UNIX classification for remaining owned inodes.
- [x] Implement bounded nonblocking multipart netlink receive and deadline checks.
- [x] Parse netlink framing and required TCP_INFO prefix without raw casts.
- [x] Require cookie/family/namespace persistent socket identity.
- [x] Reject UDP, unknown family, missing metadata and namespace mismatch.
- [x] Compare sent/received counters per socket; ignore TCP listeners.
- [x] Prepare/commit transactionally with process discovery and abort on any failure.
- [x] Preserve spent epoch across invalidation/recovery; no phantom activity.
- [x] Prove bounded parsers, socket-set transitions and retry classification.
- [x] Qualify future real managed-PTY/loopback path through public status/FakeExecutor.
- [x] Return bounded attributable failure ownership without extra scans or private error formatting.

## Success Criteria

Keep focused regressions for these observable contracts:

- Valid little- or big-endian host fixtures parse `tcpi_bytes_received` at 128 and `tcpi_bytes_sent` at 200. A 208-byte prefix and longer extension qualify; 207 bytes, duplicate/missing info and malformed attributes fail closed.
- Multipart parsing rejects short/overflowing `nlmsg_len`, aligned extents beyond the datagram, wrong sender/sequence, nonzero `NLMSG_ERROR`, `NLM_F_DUMP_INTR`, `ENOBUFS`, `MSG_TRUNC`, missing `NLMSG_DONE` and trailing records after completion; bounded alignment padding contents are ignored.
- With a smaller injected parser limit, a complete response exactly at limit qualifies; one byte over or an exactly-at-limit response without `NLMSG_DONE` is unavailable. Production constant remains 16 MiB.
- One owned TCP4 and one owned TCP6 non-listener produce distinct namespace/family/cookie keys. Invalid no-cookie, unrepresentable inode, duplicate key or conflicting inode classification is unavailable.
- TCP listener-only ownership is classified but creates no counter baseline/activity. An unowned listener or connection is irrelevant.
- Owned UDP4/UDP6 yields `unsupportedTransport`; known owned AF_UNIX is ignored; a remaining packet/netlink/unknown-family inode yields `socketDiagnostics` rather than zero TCP traffic.
- Same socket set and same counters is `Unchanged`. Either directional increase is `Activity`. New socket, retired socket, decreased counter or same key joined to a new inode is `Activity` plus replacement baseline.
- Two sockets whose aggregate totals cancel still produce activity. Shared ownership of one socket produces one key and one comparison.
- Namespace mismatch before or after collection is unavailable. No test or production path enters another namespace.
- TCP prepare failure leaves both last TCP baseline and Phase03 prepared state uncommitted. Retrying once can commit one coherent pair; a second expected race remains unavailable.
- Construction, invalidate and unavailable recovery yield `BaselineEstablished`, not network activity. Phase05 proves they restart quiet without rearming a spent epoch.
- Deadline expiry or completion after the one-second acceptance deadline cannot claim; cancellation drops preparation. The worker remains single, cooperative, joined before PTY teardown and never detached.
- Protected warning status may contain only current attributable PID and Phase03-qualified safe identity. No status/log/audit/WS hint contains cookies, inodes, namespaces, addresses, ports, counters, start ticks, terminal identities or raw netlink content; logs/audits/hints also exclude warning process details.
- Owned UDP and attributable missing-info failures retain same-preparation ownership for warning projection before abort. Global failures show no fabricated process. Shared owners remain one inode comparison and explicitly mark omitted examples.

Future focused commands from repository root:

```sh
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::tcp::tests
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::netlink::tests
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity::tcp_info::tests
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity
```

The implementation owner must ensure filters execute named tests; zero tests is failure. Do not run these during parallel implementation. Phase07 runs the canonical real path explicitly:

```sh
cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
```

`activity_live_linux_pty_tcp_smoke` stays in `server/tests/idle_suspend.rs`, starts the integration test executable in a guarded test-child mode under a real managed PTY, opens fixture-owned IPv4/IPv6 loopback sockets, exchanges known bytes, and observes through public coordinator/status with `FakeExecutor`. Internal scripted observer tests stay library tests. The smoke must close/reap only fixture resources and assert zero suspend requests; it never uses private symbol exposure, `ss`, root, model APIs, RTC or actual suspend.

## Risk Assessment

- **Kernel ABI drift or short TCP_INFO:** bounded prefix parsing accepts safe extensions and rejects missing required counters. Target kernel failure blocks opt-in; no zero fallback.
- **False quiet from dump loss:** sequence/sender checks, multipart completion, `DUMP_INTR`, `ENOBUFS`, datagram sizing and global cap turn loss into nonretryable unavailable; they are never mislabeled as a close race.
- **Ownership close race or unknown family:** one complete process-plus-network retry may recover an inode missing from every supported dump. A repeated miss stays unavailable; partial internal retry or silently dropping it would mix time slices.
- **Cookie/inode reuse:** namespace/family/cookie is persistent identity; inode replacement and counter decrease conservatively count as activity and establish a new baseline.
- **Host with many unrelated sockets:** records are streamed and only owned matches retained, but every byte still counts toward 16 MiB and one second. Exceeding either blocks agent policy instead of truncating.
- **False busy from descendants:** traffic from every retained agent descendant intentionally qualifies, including helper services. Shared ownership is deduplicated, not ignored.
- **False idle through unsupported transport/delegation:** direct owned UDP blocks availability. Known local UNIX IPC is ignored, so an external UNIX proxy/daemon is an explicit blind spot disclosed to operators.
- **Shutdown delayed by kernel syscall:** nonblocking netlink and cooperative checks bound normal behavior, not every kernel stall. Phase05 joins the worker before PTY teardown; target-host stalls block rollout, never justify detaching it.
- **Privacy leak during diagnostics:** retain only keys/counters privately and emit closed generic errors. Debug formatting of raw records is prohibited.

## Security Considerations

- Expected service account needs unprivileged `NETLINK_SOCK_DIAG` access and readable same-UID procfs ownership/namespace metadata. SELinux, seccomp, containers, `ProtectProc`, `RestrictAddressFamilies`, socket-diagnostic policy or kernel configuration may deny it. Denial is `unavailable` and a deployment qualification failure.
- Open only `AF_NETLINK/NETLINK_SOCK_DIAG`; use dump/read operations, never `SOCK_DESTROY`, BPF storage, marks, cgroup IDs or privileged extensions. Do not request or retain socket addresses.
- Never call `setns`, inspect another namespace, broaden to host-interface traffic, or infer ownership by UID/port/address. Same namespace identity must be proven before and after collection.
- TLS remains opaque; only kernel cumulative byte counts are read. No payload, token, hostname, remote endpoint or command data is captured.
- Response lengths, alignments, offsets and arithmetic are attacker-influenced kernel-facing input boundaries. Use checked slice operations and bounded allocation; malformed input cannot panic, over-read or allocate past 16 MiB.
- Activity observation never changes sockets/processes, invokes the helper, weakens API authentication or blocks normal PTY use. Failure only denies automatic `agent-activity` eligibility.
- Keep kernel/private IDs out of formatted errors, tracing, audits, WebSocket hints and qualification artifacts. The authenticated/no-store warning's PID and safe executable identity are the only public process-detail exception; public network coverage remains literal `tcp4-tcp6`.

## Next steps

Phase05 instantiates one `ProcessDiscovery` and one `TcpObserver` on the sole cooperative worker. It performs process prepare, TCP prepare, fence/deadline check and infallible pair commit; retries that whole sequence once only for `retryable_close_race`. It combines committed process/network changes with retained raw-output handles and input/lifecycle evidence, starts the observer even when `agent-activity` has `enabled = false`, and keeps the disabled coordinator unable to arm or execute. Phase07 then proves the private parsers in library tests and the real production path via public status/FakeExecutor in canonical ignored `activity_live_linux_pty_tcp_smoke`.

## Unresolved questions

- Target kernels and deployed service hardening may not expose the required TCP_INFO fields or permit unprivileged socket diagnostics within the acceptance deadline. This is a measured rollout prerequisite, not an implementation alternative; affected hosts remain unavailable.
- Workloads may delegate through UDP/QUIC, AF_UNIX proxies or another namespace. Current behavior is fixed: owned UDP/namespace mismatch blocks; known local UNIX IPC is ignored and its external delegation remains outside coverage. Broader transport support requires a separate reviewed contract.
- `docs/development-rules.md`, required by the planning skill, is absent in this checkout. Repository `AGENTS.md`, `docs/code-standards.md`, existing Rust conventions and the normative contract govern this phase; no substitute policy was invented.
