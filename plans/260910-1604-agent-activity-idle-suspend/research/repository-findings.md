# Repository findings and evidence boundary

Date: 2026-09-10. Purpose: source-grounded implementation handoff, not a claim that the enhancement exists.

## Decision provenance

The user selected [configured-agent PTY output plus network activity](../../reports/brainstorm-260910-1604-pty-agent-activity-heuristic.md) after rejecting harness integration, CPU/pressure classification and API gateway approaches. This new enhancement plan is authorized separately from the completed [original terminal idle-suspend plan](../../260824-0312-terminal-idle-suspend/plan.md). The old brainstorm's “planning not authorized” statement describes its historical stage, not the current request.

The [normative design contract](../design-contract.md) resolves that brainstorm's open design choices: raw bytes; TCP4/TCP6 counters; literal startup-owned executable list; 2s sampling, 1s admission budget, 5s freshness ceiling; fail-closed unknown measurements; explicit agent-policy opt-in. These are design decisions, not measurements of production performance.

## Source observations

| Source                                                            | Observed baseline                                                              | Planning consequence                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `server/src/config/schema.rs`, `config/parser.rs`                 | Bounded idle timing with manual TOML writing                                   | Extend schema and writer together, keep timing bounds                                     |
| `server/src/idle_suspend/policy.rs`                               | Immutable startup policy, mutable runtime timing pair                          | Freeze mode/matchers at startup; no matcher mutation endpoint                             |
| `server/src/api/config.rs`, `api/settings.rs`, `api/workspace.rs` | Explicit startup-policy preservation in multiple paths                         | Migrate all overlays, not only initial parsing                                            |
| `server/src/pty/session.rs`                                       | Master/writer/killer stored; current foreground PGID used in termination       | Capture actual child PID for observation; do not reuse PGID as root identity              |
| `server/src/pty/manager.rs`                                       | Raw reader precedes chunk parsing; writer runs under manager mutex             | Add cheap raw sequence at reader boundary and input revision at admission                 |
| `server/src/pty/buffer.rs`                                        | Scrollback tracks total written, separate replay/hydration behavior            | Do not confuse retained/rendered bytes with selected raw-byte evidence                    |
| `server/src/pty/fleet_state.rs`                                   | `is_quiescent` requires zero live/creating/restart and no hard blockers        | Keep legacy predicate; separate agent-policy claim with true live counts                  |
| `server/src/idle_suspend/coordinator.rs`                          | Existing deadline, timing transaction, manual force and single-flight executor | Integrate asynchronous fresh final sample; retain command responsiveness and spent epochs |
| `server/src/api/ws.rs`                                            | `TermWrite` calls manager and logs failures; no terminal-write acknowledgement | Reuse current transport, no new acknowledgement feature                                   |
| `server/src/system/linux/process.rs`                              | Host-oriented process telemetry is not a complete managed ancestry observer    | Do not reuse a top-RSS filtered result as zero-agent proof                                |
| `server/src/port_forward/detector.rs`                             | Listening-port detection, not transport byte observation                       | Reuse useful parsing conventions only, not service/listener activity classification       |
| `packages/ui/src/lib/agent-command-recognizer.ts`                 | Browser command recognizer                                                     | Not authoritative process discovery and not a server regex-list precedent                 |
| `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`  | Existing state/count display                                                   | Add policy/observation explanation without hiding actual live counts                      |

Relevant source must be re-read at implementation time. Existing uncommitted source changes belong to the user; this plan is not permission to overwrite them.

## Existing runtime evidence, not rerun

The approved brainstorm records a disposable same-user Linux loopback experiment using `ss` diagnostically: after send4096/receive2048, the selected established socket exposed `bytes_sent=4096` and `bytes_received=2048`, with process ownership and no sudo. This supports unprivileged TCP byte-counter feasibility on this workstation only.

It does **not** prove direct Rust netlink parsing, child ancestry attribution, availability under service hardening, namespace coverage, UDP support, suspend readiness or runtime overhead. Phases03/04/07 must qualify those with real local processes and direct diagnostic calls. Production code must not spawn `ss`.

## Design tradeoffs to retain

- A quiet agent may be waiting on a provider, computing silently or delaying a retry. Suspending it is an admitted false-idle possibility; there is no “finished thinking” proof.
- Spinner/control bytes and a service sharing an agent PTY can keep the host awake. This is conservative false-busy, not a reason to add text heuristics.
- Service-only shells/servers/listeners no longer block in agent mode. Operators must deliberately choose that behavior.
- TCP counters do not measure UDP/QUIC. Owned unsupported transport blocks observation; known local UNIX IPC does not establish coverage of an external proxy/daemon.
- Polling can miss short-lived or never-observed detached work. Final generation fencing prevents new server-admitted writes/spawns after handoff, not future autonomous kernel activity.
- Observability recovery is not fresh user activity and cannot re-arm a spent automatic attempt.

## Planning checks versus implementation checks

Current deliverable validation checks phase completeness, dependency/ownership consistency, local links and pending status. It does not run application tests or claim behavior changes. Future implementation gates are explicitly listed in each phase and consolidated in Phase07; automated gates must use fake execution and never actually suspend the workstation.

## Unresolved questions

No further product decision is required to begin the bounded implementation. Deployment-specific permissions, kernel TCP_INFO support and blocking-syscall latency remain qualification facts; unsupported environments must remain unavailable rather than silently weaken the policy.
