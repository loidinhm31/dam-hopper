# Configured-Agent Process Discovery

**Status:** Phase 03 implemented 2026-09-11. This page documents the private
Linux process-discovery seam used by the opt-in `agent-activity` idle-suspend
policy. It is not a public API and does not, by itself, claim that an agent is
complete or authorize suspend.

## Source map

| Source | Responsibility |
| --- | --- |
| `server/src/idle_suspend/activity/process.rs` | `ProcessDiscovery`, `ProcessSource`, `LinuxProcSource`, finite command matcher, retained attribution, socket-inode collection, and focused tests |
| `server/src/idle_suspend/activity/mod.rs` | Crate-private result/error types, evidence records, and hard bounds |
| `server/src/idle_suspend/mod.rs` | Keeps `activity` crate-private; no process identities or matcher state are re-exported |
| `server/src/pty/activity.rs` | Shared `ProcessIdentity`, `TerminalIdentity`, `ProcessStat`, `PtyActivitySnapshot`, and the sole `/proc/<pid>/stat` parser |

Phase 03 consumes the qualified PTY roots and atomic output handles from Phase
02. Phase 04 consumes only the prepared `OwnedSocketSet`; Phase 05 owns the
pair-commit, retry, final admission, and authenticated warning projection.

## Observation flow

A sample is prepared as one bounded, read-only pass:

```text
qualified PtyActivitySnapshot
  -> capture live and retained output counters
  -> read observer network namespace
  -> list /proc numeric PIDs once and build stat table + PPID adjacency
  -> validate root identities and merge retained detached lineages
  -> resolve exact root/descendant attribution
  -> classify configured native/interpreted agents
  -> close descendants of recognized agents into relevant identities
  -> revalidate identity while reading image, namespace, and FD metadata
  -> deduplicate socket inodes and derive ProcessSample
```

`prepare_sample` does not mutate the committed discovery state. A successful
`PreparedProcessSample` may be consumed by `commit_sample`; dropping it, a
TCP preparation, or the pair-commit leaves the previous baseline unchanged.
`invalidate` preserves retained identity, terminal, and output-handle ownership
while forcing the next successful pass to report `BaselineEstablished`.

## `ProcessSource` abstraction

`ProcessSource` is a synchronous fake seam consumed by deadline-aware
`prepare_sample`. Its production implementation, `LinuxProcSource`, reads a
configured `/proc` root; tests provide deterministic fixtures without mutating
the host `/proc` tree.

| Method | Procfs evidence |
| --- | --- |
| `list_pids` | Complete numeric process-directory enumeration |
| `read_stat` | Shared `ProcessStat` (`pid`, `ppid`, state, `start_ticks`) |
| `read_exe` | `/proc/<pid>/exe` link target |
| `read_exe_metadata` | Executable device/inode for image identity |
| `read_cmdline` | NUL-tokenized, bounded command line |
| `read_cwd` | CWD used only for relative interpreted entrypoints |
| `read_netns` / `read_thread_netns` | `(device, inode)` network-namespace identity |
| `list_fds` | Complete numeric FD enumeration for one relevant process |
| `read_fd_socket` | Strict `socket:[decimal_inode]` parsing; non-sockets are ignored |

Procfs disappearance caused by normal process/FD close is marked as a
retryable close race. Permission errors, malformed data, incomplete
enumeration, and unstable live identities remain unavailable rather than being
silently dropped.

## Identity and attribution

`ProcessIdentity { pid, start_ticks }` is the only process key. PID alone is
reusable, and foreground process-group IDs are not substituted. The engine
reads the stat table once for ancestry, then verifies a root's exact identity
before walking it. Metadata and FD reads are bracketed by start-tick checks;
a changed second read is an identity race, never a new process attached to an
old PID.

Each qualified root receives one `TerminalIdentity`. A process reachable from
two different managed roots is `identityUncertain`; it is never assigned to
the first root or counted twice. Previously observed relevant identities are
retained by exact identity with their terminal and cloned raw-output `Arc`.
They remain attributable after reparenting or root/session removal while the
identity is alive. Newly observed descendants inherit that terminal and output
handle. A complete later pass retires an identity only after exact exit,
non-running zombie/dead state, or PID reuse is proven.

The manager's live fleet count remains independent: a retained detached
lineage can contribute monitoring evidence without inflating the live PTY
fleet.

## Matching contract

Matching uses Phase 01's borrowed, already-validated literal set; it does not
compile patterns or search arbitrary command text.

- A native executable matches an exact case-sensitive basename or normalized
  absolute `/proc/<pid>/exe` target. Unreadable, deleted, or non-normalizable
  targets are uncertain, not ordinary nonmatches.
- A supported interpreter is classified only by the finite grammar in the
  Phase 03 plan: Node/Node.js, Bun, Python (`python3.N`), and POSIX shell
  launchers (`sh`, `bash`, `dash`, `zsh`, `ksh`). The first deterministic
  entrypoint token is compared to the configured basename or absolute path.
- Relative entrypoints are resolved against that process's `/proc/<pid>/cwd`
  and normalized lexically, without following symlinks. Generic names such as
  `cli.js`, `index.js`, `main.py`, and `__main__.py` require an exact configured
  absolute path.
- Eval/print/module/package-script ambiguity, unknown flags, missing values,
  stdin forms, and unknown wrapper syntax are unclassifiable and return
  `identityUncertain`. Shell `-c` command strings are not searched; a separately
  spawned descendant must be discovered.
- A matched agent makes all currently reachable descendants relevant. Nested
  matches are deduplicated for both agent count and socket ownership.

The private `ProcessImageKey` stores executable device/inode plus the selected
entrypoint token, not raw arguments. Relevant creation, validated exit,
matching/attribution transitions, and image changes produce `ProcessChange::Activity`.
The first successful sample after startup or invalidation produces
`BaselineEstablished`; an exact repeat produces `Unchanged`.

## Hard bounds and completeness

Bounds are enforced with complete enumeration or a sentinel/`limit + 1`
observation. Exact-at-limit input may qualify; one extra item, truncated input,
iterator error, or a missed deadline returns `ActivityUnavailable` instead of
a partial or top-N result.

| Measurement | Limit | Failure when exceeded or incomplete |
| --- | ---: | --- |
| Managed PTY roots | 256 | `scanLimit` or root identity unavailable |
| Numeric `/proc` entries per pass | 8,192 | `scanLimit` |
| Relevant matched-agent/descendant identities | 1,024 | `scanLimit` |
| Command-line bytes per candidate | 16 KiB (reads at most 16 KiB + 1) | `scanLimit`/unavailable; never prefix-match a truncation |
| FDs per relevant process | 4,096 | `scanLimit` |
| Unique owned socket inodes | 8,192 | `scanLimit` |
| Safe warning identity | 256 UTF-8 bytes | omit identity (`None`), never fall back to argv |

A complete zero-agent result is valid only after roots, process table,
ancestry, candidate classification, identity checks, iterators, and deadline
all qualify. When no relevant process exists, the engine returns an empty
`OwnedSocketSet` without enumerating unrelated process FDs.

## Prepared result and failure evidence

`ProcessSample` contains:

- `recognized_agent_count`, counting unique live matching identities;
- sorted, deduplicated `MonitoredTerminalEvidence`, including retained
  detached terminals and the counter sequence captured before procfs work;
- `OwnedSocketSet`, scoped to the observing network namespace and sorted by
  inode; and
- sorted, deduplicated current `process_evidence`, capped at 1,024 entries,
  each with a `ProcessIdentity` and optional validated safe executable
  identity.

Each owned inode stores one deterministic `representative_owner` (lowest PID,
then start ticks) and `has_additional_owners`. Representative ownership is a
diagnostic projection; eligibility considers every relevant owner.

Failures use the closed `ActivityUnavailableReason` set (`procAccess`,
`scanLimit`, `scanTimeout`, `socketDiagnostics`, `unsupportedTransport`,
`namespaceMismatch`, `staleObservation`, `identityUncertain`,
`counterOverflow`, or `reconciling`). `FailureContext` includes only processes
directly implicated by the current failure; host-wide scan/timeout/ancestry
failures leave it empty. Phase 03 leaves implicated socket evidence empty for
Phase 04 to populate.

## Privacy, safety, and limitations

The discovery engine is read-only. It does not signal, suspend, kill, attach,
open another process's descriptors, invoke a shell/API, or change namespaces.
All relevant processes must share the observing thread's network namespace.
Raw command lines, arguments, environment, CWD, unmatched paths, socket
identifiers, start ticks, and terminal identities stay private and transient.
Only a qualified PID plus one bounded safe executable identity may cross the
later authenticated/no-store warning seam; no enrichment pass is allowed.

The observer is a polling heuristic. A descendant that is created and exits
between polls may be missed. Silent API waits or detached computation can be
suspended, while descendant services or mixed PTY noise can keep the host busy.
Procfs permissions, `hidepid`/`ProtectProc`, LSM policy, container masking, and
kernel support are qualification prerequisites; failures remain unavailable.
No CPU detector, hooks, cgroups, eBPF, process freezing, or provider/API proxy
is part of this phase.

## Verification

Focused implementation commands from the phase plan are:

```sh
cargo test --manifest-path server/Cargo.toml idle_suspend::activity::process::tests
cargo test --manifest-path server/Cargo.toml process_discovery
```
In this checkout, the focused module filter passes **18/18** process-discovery
tests; the broader idle-suspend and PTY suites remain integration-gate evidence.

The tests exercise the parser, finite interpreter grammar, fake-proc bounds,
identity races, namespace and FD handling, retention/reparenting, safe warning
identity, representative socket ownership, and transactional prepare/commit
behavior. Integrated TCP observation, coordinator admission, public status,
and host-suspend qualification belong to later phases.

## Related documentation

- [PTY Activity Observation](./pty-activity-observation.md) — Phase 02 root and
  raw-output/input evidence consumed here.
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md) —
  privacy and fail-closed deployment policy.
- [System Architecture](./system-architecture.md) — subsystem data flow.
- [Phase 03 plan](../plans/260910-1604-agent-activity-idle-suspend/phase-03-process-discovery.md)
  — normative bounds and frozen interpreter grammar.
