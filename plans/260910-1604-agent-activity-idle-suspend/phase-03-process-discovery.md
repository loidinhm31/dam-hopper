# Phase 03 — Bounded process discovery and agent attribution

## Context links

- [Plan](plan.md), [normative contract](design-contract.md), [repository findings](research/repository-findings.md).
- Prerequisites: [operator policy and shared contracts](phase-01-policy-contracts.md), [PTY root/output/input seam](phase-02-pty-observation.md).
- Consumer: [TCP observation](phase-04-tcp-observation.md); integration owner: [sampler/coordinator](phase-05-sampler-coordinator.md).
- Existing patterns to inspect, not duplicate: [Linux process telemetry](../../server/src/system/linux/process.rs), [PTY manager](../../server/src/pty/manager.rs), [live PTY session](../../server/src/pty/session.rs), [process-holder procfs traversal](../../server/src/linux_release/process_holders.rs).
- Approved rationale: [PTY plus configured-agent network activity](../reports/brainstorm-260910-1604-pty-agent-activity-heuristic.md).

## Overview

- Date: 2026-09-10.
- Description: discover configured agent processes and their socket-owning descendants from qualified managed PTY roots, with bounded identity-safe procfs traversal and retained attribution across reparenting.
- Priority: P2. Estimated implementation effort: 14h.
- Implementation status: DONE (2026-09-11). Review status: Complete (Score: 9.0/10; see plans/reports/code-review-260911-0237-phase-03-process-discovery.md).
- Progress: 100% (13/13 todo items; 18/18 latest focused process-discovery tests passed).
- Dependencies: Phase01 provides the immutable, already-compiled executable set; Phase02 provides qualified root identities, fleet snapshots, raw-output handles and the sole shared process-stat parser. Phase04 consumes this phase's typed owned-socket preparation and representative-owner evidence. Phase05 owns the all-or-nothing process-plus-TCP commit and the authenticated warning projection.

## Key Insights

- `server/src/system/linux/process.rs` is host telemetry: it scans at most 4,096 PIDs, ranks by RSS, retains only 20, and reads command summaries only after ranking. It cannot prove absence of an agent under a managed PTY. Reuse its bounded-read/error-classification style where useful, not its inventory result or top-RSS policy.
- `LiveSession` currently has master/writer/killer ownership, while `process_group_leader()` is used for termination and means the current foreground PGID. Phase02 therefore captures `Child::process_id()` and qualifies `(pid,start_ticks)`; discovery must never substitute PGID.
- Linux PID alone is reusable. Every candidate and every relevant FD read needs the same start time before and after inspection. A mismatched second read means an identity race, never a new process attached to the old identity.
- One `/proc/<pid>/stat` read supplies PID state, PPID and start ticks. Phase02 owns its parser and identity reader in `server/src/pty/activity.rs`; this phase imports them. A second parser would create inconsistent PID-reuse behavior.
- Agent matching is command-structure matching, not substring search. A native executable can match its real executable. An interpreter can match only one deterministically located entrypoint token. Unknown interpreter/wrapper syntax may hide a configured entrypoint, so it makes the attributable sample unavailable.
- Reparenting breaks a fresh ancestry walk. State must retain already-observed matched agents and descendants by `ProcessIdentity -> RetainedAttribution` while identities remain alive. Each attribution also owns its `TerminalIdentity` and cloned raw-output `Arc<AtomicU64>`, so root/session removal cannot sever output continuity for a surviving detached lineage.
- `/proc/<pid>/fd/* -> socket:[inode]` supplies a same-sample typed join key only. Phase04 replaces inode with diagnostic cookie/family/namespace before retaining TCP counters.
- Warning evidence must reuse this same bounded pass. Qualify one safe executable/entrypoint identity while preparing each relevant process, store it once, and map every deduplicated socket inode to a deterministic representative owner. No reporting path may trigger another `cmdline` read, continue a timed-out scan, or weaken completeness.
- Observation limitations are not safety claims: a complete pass can say zero recognized agents; an incomplete pass can say only unavailable. Neither means semantic work is finished.

## Requirements

1. Linux-only discovery starts from every root in one bounded `PtyActivitySnapshot`. A complete snapshot with exactly 256 roots may qualify; a 257th root or incomplete snapshot is `scanLimit`. An unqualified root, duplicate terminal identity, duplicate root identity with conflicting terminal ownership, or changed root identity makes the whole activity measurement unavailable.
2. Scan `/proc` once per pass and build one in-memory `ProcessIdentity -> ProcessStat` table plus PPID adjacency. Enumerate through one sentinel: a complete scan containing exactly 8,192 numeric process directories may qualify; observing an 8,193rd entry, losing iterator completeness, or truncating at the cap returns `scanLimit`. Never select a top-N subset.
3. Reuse Phase02 `pty::activity::{ProcessIdentity, ProcessStat, TerminalIdentity, PtyActivitySnapshot, read_process_stat}`. `read_process_stat` must safely parse a parenthesized `comm` containing spaces or `)` and expose PID, PPID, state and start ticks. This phase owns no alternate parser.
4. Walk each qualified root by exact identity. A numeric PID whose start ticks differ is not that root. A root that disappears or changes during a pass is an expected identity/read race eligible for the one end-to-end retry in Phase05; after retry it is unavailable, never a zero-agent result.
5. Attribute reachable processes to one terminal. If an identity is reachable from multiple managed roots, or retained attribution conflicts with current reachability, return `identityUncertain`; do not arbitrarily choose the first root or count the process twice.
6. Read `/proc/<pid>/exe`, `cmdline` and, only when needed for a relative entrypoint, `cwd` for attributable processes only. Read start ticks before and after those fields. Raw command lines, arguments, environment, cwd and unmatched executable paths remain transient private inputs and never enter logs, audits, WebSocket hints, persistence or status. A PID and one qualified safe executable identity may leave this module only through the private warning-evidence seam for Phase05's authenticated, no-store warning.
7. Bound each command line to 16 KiB including NUL separators by reading at most 16 KiB + 1. Oversize, malformed NUL layout, invalid candidate UTF-8, permission denial or a supported interpreter whose entrypoint cannot be determined makes the sample unavailable. Do not truncate and match a prefix.
8. Native matching uses the real `/proc/<pid>/exe` target: exact case-sensitive basename for a basename entry or exact normalized absolute path for an absolute entry. A `" (deleted)"` executable target, unreadable link or non-normalizable target is uncertain, not an ordinary nonmatch.
9. Interpreted matching uses the actual script/entrypoint token selected by the finite grammar below. Compare a basename rule to the exact entrypoint basename; compare an absolute rule to an absolute entrypoint or a relative entrypoint resolved against `/proc/<pid>/cwd` and lexically normalized. Never search later arguments.
10. Generic entrypoint basenames such as `cli.js`, `index.js`, `main.py` and `__main__.py` cannot satisfy a basename matcher; they require an exact configured absolute path. Phase01 already rejects generic interpreters as configured agents.
11. `bash -c 'codex'` and equivalent shell command strings never match their string content. Treat this known command-string form as a nonmatching wrapper and discover a separately spawned descendant. The interval before that child exists is covered only by create/input quiet reset and later polls.
12. `node -e`, `node --eval`, `node -p`, `python -c`, `python -m`, Bun eval/print forms and unknown interpreter/wrapper flags are unclassifiable attributable commands. Return `identityUncertain`; never call them ordinary services and never scan their later arguments.
13. Once a process matches, the recognized agent and all currently reachable descendants are relevant. A complete set of exactly 1,024 retained/current relevant identities may qualify; discovering a 1,025th or otherwise proving the set incomplete returns `scanLimit`. Deduplicate a process reached through nested matched agents.
14. Retain each observed relevant identity's terminal attribution and cloned raw-output counter handle while its exact `(pid,start_ticks)` is present, even if it reparents or the PTY root/session exits. At the start of every preparation, read all live-root plus retained-detached handles before procfs work and carry that `sample_start_sequence`; `u64::MAX` is `counterOverflow`. Remove lineage only after a complete pass validates absence, PID reuse, or non-running zombie/dead state. Never clear lineage or its handle merely because the terminal is absent from the latest live-root map.
15. Newly spawned descendants of a retained relevant identity inherit its terminal attribution and output handle. A never-observed descendant that detaches between 2-second polls remains an admitted heuristic blind spot. Do not add hooks, cgroups, eBPF, CPU inspection or process freezing to close it.
16. Track a minimal private `ProcessImageKey`, not raw argv: executable file device/inode plus the classified interpreter entrypoint identity when applicable. A relevant identity's exec/image change is qualifying `ProcessChange::Activity`; an image that cannot be requalified is unavailable. Matching status changes, relevant process creation and validated exit are also activity.
17. For each relevant process, enumerate through one sentinel: exactly 4,096 complete FD entries may qualify, but a 4,097th or incomplete iteration returns `scanLimit`. Strictly parse only `socket:[decimal_inode]` links, rejecting zero/overflow/malformed socket links. Deduplicate shared socket ownership by inode. Each `OwnedSocketInode` retains the lowest-PID owning `ProcessIdentity` as `representative_owner` and sets `has_additional_owners` when any other relevant process owns it; a PID tie is ordered by `start_ticks`. Exactly 8,192 unique owned inodes/references may qualify; an 8,193rd or incomplete set fails. Eligibility still considers every relevant owner; representative ownership is diagnostic projection only.
18. Validate each relevant process's start ticks before and after FD and namespace reads. FD close/read disappearance is a typed retryable close race. Permission errors or a still-live identity whose metadata cannot be read are unavailable; do not silently drop its possible sockets.
19. Resolve network namespace identity from namespace-handle metadata `(device,inode)`, using the observing thread's `/proc/thread-self/ns/net` and each relevant `/proc/<pid>/ns/net`. Every relevant identity must be in that same namespace. Mismatch is `namespaceMismatch`; inaccessible ownership is `procAccess`.
20. A valid zero-agent result requires: all roots qualified; complete process table; unambiguous ancestry; all attributable interpreter candidates classifiable; identity checks stable; every bounded iterator exhausted at or below its limit; and deadline intact. When zero agents are valid, return an empty typed `OwnedSocketSet` without scanning unrelated process FDs.
21. Discovery is read-only. It must not signal, suspend, kill, attach, inject, open another process's descriptors, invoke a model/API, shell out to `ps`, or change process/network namespaces.
22. One shared monotonic acceptance deadline is passed from Phase05. This is a cooperative deadline checked before and during directory, candidate, descendant and FD loops; it does not promise cancellation of a kernel-stalled procfs syscall. A late result is `scanTimeout` and cannot be committed.
23. During the ordinary executable/entrypoint classification already required for matching and image identity, derive at most one `safe_executable_identity: Option<String>` for each current relevant `ProcessIdentity`. Use the validated native executable basename or validated script/entrypoint basename; only a configured absolute-path rule may retain its exact validated path when needed to distinguish a generic entrypoint. Require valid UTF-8, at most 256 bytes and no control characters. Unknown or unsafe qualification is `None`, never `argv[0]`, a raw cmdline token, shell command string or truncated fallback.
24. `ProcessSample.process_evidence` contains the current relevant identities sorted and deduplicated by `(pid,start_ticks)`, bounded by the existing 1,024-relevant-process limit; it stores each safe identity exactly once. This is same-sample join evidence, not a public inventory. It is discarded with an aborted preparation and never reconstructed from committed or stale state after a failure.
25. Every `ActivityUnavailable` carries bounded `FailureContext`. A verified process-attributable failure may add `BlockingProcessEvidence { process, safe_executable_identity }`; permission denial may name the stable positive PID with `None`. Evidence includes only processes directly implicated by the current failure. Global incomplete ancestry, host-wide scan limit/timeout and unknown attribution leave `processes` empty; they never label every agent or invent a PID. The collection remains bounded by the existing 1,024 relevant-process cap and deadline—no enrichment pass, extra privilege, or delayed failure.
26. Phase03 leaves `FailureContext.implicated_owned_inodes` empty; Phase04 fills that field only for directly implicated owned sockets. Reporting bounds never relax root/process/relevant/FD/socket completeness: overflow or timeout still makes measurement unavailable, even if Phase05 can display only 32 examples.

Finite interpreter grammar, frozen for this feature:

| Real executable basename                   | Deterministic pre-entrypoint forms                                                                                                                                                                                                                                                                                                                                                                                                                             | Explicitly unclassifiable or nonmatching forms                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`, `nodejs`                           | Optional valueless `--enable-source-maps`, `--no-deprecation`, `--no-warnings`, `--trace-deprecation`, `--trace-warnings`, `--preserve-symlinks`, `--preserve-symlinks-main`; value flags `-r`/`--require`, `--import`, `--loader`/`--experimental-loader`, `--conditions` as separate value or `--name=value`; inspector flags `--inspect`, `--inspect-brk`, `--inspect-wait` with optional `=value`; `--` ends options; first remaining token is entrypoint. | Eval/print forms `-e`, `--eval`, `-p`, `--print`; missing flag values; unknown flags; no entrypoint.                                                                                                 |
| `bun`                                      | Same direct-script rule after optional `--`; `run` accepted only when its next token is path-like and resolves to the actual configured script path; valueless `--silent`, `--bun`, `--smol`; value flags `--cwd`, `--config` separate or `=value`.                                                                                                                                                                                                            | Eval/print; `x`/`bunx`; test/package-manager subcommands; bare `bun run <package-script>`; unknown flags/subcommands; missing entrypoint.                                                            |
| `python`, `python3`, versioned `python3.N` | Valueless `-B`, `-E`, `-I`, `-O`, `-OO`, `-P`, `-q`, `-s`, `-S`, `-u`, `-v`; value flags `-W` and `-X` in joined or separate form; `--` ends options; first remaining token is entrypoint.                                                                                                                                                                                                                                                                     | `-c`, `-m`, stdin `-`, unknown/combined flags outside this table, missing values or entrypoint.                                                                                                      |
| `sh`, `bash`, `dash`, `zsh`, `ksh`         | Known valueless shell flags may be combined from `e`, `f`, `i`, `l`, `n`, `u`, `v`, `x`; `-o` consumes one value; `--` ends options; first remaining path token is script entrypoint. No entrypoint means an ordinary interactive shell.                                                                                                                                                                                                                       | Any flag group containing `c` is a known command-string wrapper and its string is ignored, not matched; `-s` reads stdin and is nonmatching; unknown flags or missing `-o` value are unclassifiable. |

Do not broaden this table during implementation merely to make a fixture pass. A new launcher grammar is a contract revision with ambiguity tests.

## Architecture

Private module layout:

```text
server/src/pty/activity.rs                    # Phase02 IDs, ProcessStat parser, PTY snapshot
server/src/idle_suspend/activity/mod.rs       # shared private observation contracts
server/src/idle_suspend/activity/process.rs   # stateful discovery, matcher, procfs source
server/src/idle_suspend/activity/tcp.rs       # Phase04 consumer of OwnedSocketSet
```

Concrete interfaces:

```rust
// Defined and compiled once by Phase01 in idle_suspend/policy.rs.
use crate::idle_suspend::policy::AgentExecutableSet;

pub(crate) struct ProcessDiscovery<S = LinuxProcSource> {
    source: S,
    committed: ProcessDiscoveryState,
}

impl<S: ProcessSource> ProcessDiscovery<S> {
    pub(crate) fn prepare_sample(
        &self,
        pty: &PtyActivitySnapshot,
        agents: &AgentExecutableSet,
        deadline: Instant,
    ) -> Result<PreparedProcessSample, ActivityUnavailable>;

    pub(crate) fn commit_sample(
        &mut self,
        prepared: PreparedProcessSample,
    ) -> ProcessSample;

    pub(crate) fn invalidate(&mut self);
}

pub(crate) struct PreparedProcessSample {
    sample: ProcessSample,
    next_state: ProcessDiscoveryState,
}

impl PreparedProcessSample {
    pub(crate) fn sample(&self) -> &ProcessSample;
}

pub(crate) struct ProcessSample {
    pub(crate) recognized_agent_count: usize,
    pub(crate) monitored_terminals: Vec<MonitoredTerminalEvidence>, // sorted, unique
    pub(crate) owned_sockets: OwnedSocketSet,
    pub(crate) process_evidence: Vec<BlockingProcessEvidence>, // sorted, unique, len <= 1024
    pub(crate) change: ProcessChange,
}

pub(crate) struct MonitoredTerminalEvidence {
    pub(crate) terminal: TerminalIdentity,
    pub(crate) output_sequence: Arc<AtomicU64>,
    pub(crate) sample_start_sequence: u64,
}

impl ProcessSample {
    pub(crate) fn monitored_terminal_count(&self) -> usize;
}

pub(crate) enum ProcessChange {
    BaselineEstablished,
    Unchanged,
    Activity,
}

pub(crate) struct OwnedSocketSet {
    pub(crate) namespace: NetworkNamespaceIdentity,
    pub(crate) inodes: Vec<OwnedSocketInode>, // sorted, unique, len <= 8192
}

pub(crate) struct OwnedSocketInode {
    pub(crate) inode: u64,
    pub(crate) representative_owner: ProcessIdentity,
    pub(crate) has_additional_owners: bool,
}

pub(crate) struct BlockingProcessEvidence {
    pub(crate) process: ProcessIdentity,
    pub(crate) safe_executable_identity: Option<String>,
}

pub(crate) struct FailureContext {
    pub(crate) processes: Vec<BlockingProcessEvidence>, // len <= 1024
    pub(crate) implicated_owned_inodes: Vec<OwnedSocketInode>, // len <= 8192
}

pub(crate) struct ActivityUnavailable {
    pub(crate) reason: ActivityUnavailableReason,
    pub(crate) retryable_close_race: bool,
    pub(crate) context: FailureContext,
}

pub(crate) struct NetworkNamespaceIdentity {
    pub(crate) device: u64,
    pub(crate) inode: u64,
}
```

`RetainedAttribution`, `AttributedProcess`, `ProcessImageKey` and `ProcessDiscoveryState` stay private to `process.rs` and contain no presentation strings. A retained attribution contains the exact process identity, terminal identity and raw-output handle; `ProcessSample.monitored_terminals` deduplicates those handles by terminal identity, including a removed terminal whose discovered lineage remains alive. The manager's live-fleet count remains independent and must not count a removed terminal as live. Phase04 receives only `OwnedSocketSet`, not matcher configuration, PTY commands, raw procfs handles or terminal evidence.

Data flow:

```text
PtyActivitySnapshot qualified roots
  -> one bounded stat table + adjacency
  -> current root reachability merged with validated retained identities
  -> finite native/interpreter match
  -> matched agents + descendant closure
  -> stable identity/namespace/FD reads
  -> ProcessSample + deduplicated OwnedSocketSet
  -> Phase04 socket diagnostics
```

Transactional state rule: `prepare_sample(&self, ...)` builds the entire candidate sample, retention/image maps and output-handle set in scratch state without mutating `ProcessDiscovery`. `PreparedProcessSample::sample()` exposes the typed socket input to Phase04. Phase05 prepares TCP from it, rechecks deadline/cancellation/request and captured revisions, then invokes infallible process and TCP commits back-to-back on the sole cooperative worker. Dropping either prepared value is abort and leaves both committed baselines unchanged. Any process/TCP error, stale ticket, invalidation or late completion aborts the pair. After the optional full retry ends unavailable or late, Phase05 calls both observer `invalidate()` methods before publishing unavailable; a preparation made stale solely by a known newer input/fleet event is dropped and that newer event supplies its own fence/activity semantics. Process `invalidate()` marks the committed comparison baseline as requiring reconciliation but preserves retained exact identities, terminal identities and counter handles. The first complete recovery/post-resume/post-handoff pass revalidates detached lineage and emits `BaselineEstablished`. Baseline establishment or unavailable-to-available recovery restarts quiet time but is not genuine activity, does not increment epoch activity revision and cannot grant a new epoch after an attempt was spent.

## Related code files

Create:

- `server/src/idle_suspend/activity/mod.rs`: private shared `ActivityUnavailable`, closed `ActivityUnavailableReason`, `OwnedSocketSet`, `OwnedSocketInode`, `NetworkNamespaceIdentity`, process/TCP module declarations, and only agreed crate-private cross-phase types.
- `server/src/idle_suspend/activity/process.rs`: `ProcessDiscovery`, prepared/commit state, `LinuxProcSource`, `ProcessSource`, finite matcher, retained terminal/output ownership, socket-inode collection and focused inline tests.

Modify:

- `server/src/idle_suspend/mod.rs`: declare the private `activity` module; do not publicly re-export private identities/status details.
- `server/src/pty/activity.rs`: only if Phase02's shared `ProcessStat` visibility or parser contract needs the already-agreed Phase03 consumer; Phase02 remains sole owner of the parser and IDs.
- `server/src/pty/mod.rs`: crate-private visibility only if required for `idle_suspend::activity::process`; no public API.
- `server/src/idle_suspend/policy.rs`: Phase01 owns and compiles `AgentExecutableSet`; Phase03 only borrows it and must not recompile, revalidate, normalize or mutate startup entries.

Inspect, do not repurpose:

- `server/src/system/linux/process.rs`: bounded procfs style; its top-RSS inventory is forbidden as discovery input.
- `server/src/linux_release/process_holders.rs`: FD traversal conventions; its permissive skip-on-denied behavior is not safe for this observer.
- `server/src/pty/manager.rs`, `server/src/pty/session.rs`: Phase02-owned roots/incarnations only.
- `server/Cargo.toml`: no new process-discovery dependency planned. Reuse `std`, existing `libc` metadata support, `thiserror` if the shared error derives it, and existing `tempfile` tests.

No files are deleted. No helper protocol, API DTO, UI, port-forward detector, host telemetry schema or persistence table changes belong here.

## Implementation Steps

1. Re-read final Phase01/02 type definitions and constructor/capture callsites. Freeze `AgentExecutableSet`, `PtyActivitySnapshot`, `ProcessIdentity`, `TerminalIdentity`, `ProcessStat` and common error visibility before editing. Do not fork names or parser behavior locally.
2. Create `idle_suspend/activity/mod.rs` and `process.rs` behind `cfg(target_os = "linux")` production code plus a non-Linux unavailable adapter consumed by Phase05. `mod.rs` owns the common errors and typed inode/namespace input; no type is publicly re-exported.
3. Define `ProcessSource` as a narrow synchronous, deadline-aware fake seam for listing numeric PIDs, reading shared stats, executable links/metadata, bounded cmdline/cwd, namespace metadata and FD links. Production methods use procfs directly. Tests supply deterministic fixtures without global `/proc` mutation.
4. Implement every directory/byte bound with a sentinel or `limit + 1` read. Exhaustion at exactly 8,192 process entries, 1,024 relevant identities, 4,096 FDs, 8,192 owned sockets or 16 KiB of valid cmdline may qualify. An extra item/byte, early truncation or iterator error fails closed; never sort/select a partial top set.
5. Validate every Phase02 root by full `ProcessIdentity`; reject unqualified roots before matching. Build PPID adjacency from stable stat records and walk all descendants iteratively to avoid recursion depth risk. Check deadline and relevant-count bound in each loop.
6. Before procfs work, read and validate raw sequence values for every current-root handle and every retained detached-lineage handle. Then merge retained attribution after validating exact identities in the current complete table. Detect cross-terminal conflicts before matching. Keep reparented identities, their terminal identities and cloned output handles even when the root/session is absent; traverse their new descendants. Treat zombie/dead identities as validated retirement and PID reuse as retirement of only the old identity.
7. Match against Phase01's borrowed, already-compiled basename/absolute variants. Do not allocate matcher strings, compile patterns, canonicalize configuration or rebuild lookup sets per sample. Configuration remains literal and case-sensitive.
8. Implement one NUL-token command parser and the frozen interpreter table. Resolve a relative entrypoint only against that process's stable cwd with lexical normalization. Reject generic basename matches. Never inspect a command string or arbitrary later argument.
9. Read identity before and after executable/cmdline/cwd metadata. For relevant processes derive a minimal `ProcessImageKey`; compare against the last committed image map only when its baseline is valid. Agent match transition, relevant creation, validated exit, image/exec change or retained-attribution change emits `ProcessChange::Activity`. First successful state and post-invalidation recovery emit `BaselineEstablished`.
10. Derive descendant closure from each recognized agent. Count unique live matching identities, not matching rules or descendants. Build sorted/deduplicated `MonitoredTerminalEvidence` for any current or retained relevant lineage, carrying the start-of-preparation counter plus Arc. Phase05 reads each Arc again after TCP preparation and during final admission. The vector length is monitored-terminal count even after a PTY root is removed; the separate manager fleet count stays live-only.
11. Read observing-thread network namespace identity once, then relevant process namespace and FD directories under pre/post identity checks. Apply exact-at-limit complete semantics. Deduplicate by inode, retaining the lowest PID (then start ticks) as `representative_owner` and setting `has_additional_owners` when other exact identities share it. Store one owner reference per inode, not a process-by-socket matrix; return one sorted `OwnedSocketSet`.
12. Distinguish a `read_link`/entry disappearance caused by a closing FD/process from permission/malformed data. Set `retryable_close_race = true` only for that expected churn. Phase05 may perform one complete Phase03+04 retry within the original one-second acceptance deadline; do not retry internally or extend the deadline.
13. Implement nonmutating prepare plus infallible consuming commit. An error or dropped preparation cannot advance retention/image state. `invalidate()` preserves retained identity/terminal/output ownership while marking comparison state invalid. Phase05 calls it after retry-exhausted unavailable/late samples and after handoff/resume, forcing full reconciliation and a baseline result on recovery.
14. Add focused parser and fake-proc tests for plausible bugs listed below. Use temp directories only for filesystem semantics the fake source cannot represent. Assert observable sample/error behavior, not internal vector growth.
15. Add harmless real-process coverage under `cfg(target_os = "linux")`: spawn a local fixture process tree with uniquely named temporary executable/script links, capture real PIDs, verify ancestry and reparent/output-handle retention, then terminate and reap only fixture children. Do not launch configured real agents, contact external APIs, signal unrelated processes or invoke suspend.
16. Hand Phase04 exact sorted `OwnedSocketSet`, common `FailureContext`, and preparation semantics; hand Phase05 output handles and same-preparation `process_evidence` for joining TCP failure inodes before abort. Integration requires zero-agent completeness, exact-bound, retention, safe-warning and abort tests.
17. Derive safe identity only from qualified executable/entrypoint evidence already read in the bounded pass: native/entrypoint basename or the configured exact path required for a generic entrypoint. Reject controls and values exceeding 256 UTF-8 bytes; otherwise use `None`, never command arguments or unqualified cmdline fallback. Attach only current attributable exact identities to failure context; global or unknown failures carry empty vectors. Keep context private with generic error formatting; never perform enrichment reads or extend the deadline.

## Todo list

- [x] Reuse Phase02's sole stat/identity parser.
- [x] Add complete bounded adjacency scan with exact-at-limit success.
- [x] Consume Phase01's compiled literal matcher without per-sample compilation.
- [x] Implement exact native and finite interpreted entrypoint matching.
- [x] Reject ambiguous wrapper/command forms without substring fallback.
- [x] Retain detached lineage plus terminal/output handles across root removal and invalidation.
- [x] Detect multi-root ambiguity, PID reuse, exit and exec/image changes.
- [x] Enforce relevant-process, cmdline, FD and socket-inode caps without truncation.
- [x] Verify same-thread/current network namespace ownership.
- [x] Prepare typed process/socket state and pair-commit only after TCP succeeds.
- [x] Prove fake-proc boundaries and harmless real-process behavior.
- [x] Supply bounded safe process evidence and deterministic representative socket ownership.
- [x] Preserve useful failure evidence without committing failed eligibility baselines.

## Success Criteria

Keep focused regressions for these observable contracts:

- Parenthesized `stat` names, PID reuse and a changed second start-time read cannot bind metadata to the wrong process.
- Exactly 256 complete roots, 8,192 complete process entries, 1,024 relevant identities, 4,096 complete FDs for one process, 8,192 unique sockets, and a valid exactly-16-KiB command line may qualify. One extra item/byte, truncated/incomplete iteration or missing exhaustion proof returns `scanLimit`/unavailable rather than a partial result.
- A native exact basename/path matches; case mismatch, argument mention and command-string text do not.
- Node/Python/Bun/shell entrypoints match only at the grammar-selected token. Unknown flags, eval/module/package-script ambiguity and generic `cli.js` basename fail closed.
- An ordinary shell, native service or classifiable interpreter service under a PTY produces a valid zero-agent sample only when the complete pass finds no configured entrypoint.
- A matched child makes its descendants relevant; nested matches do not duplicate recognized counts or shared socket inodes.
- A recognized descendant retained before root exit stays attributed after reparenting with the same terminal/output handle and start checkpoint. Output during process/TCP collection remains detectable. Root removal does not inflate the live fleet. Lineage is removed only after a complete later pass proves exact-identity exit; a same-number new PID is unrelated.
- A process reachable from two roots, mismatched network namespace, denied relevant FD directory, malformed socket link or unstable identity is unavailable, never assigned arbitrarily.
- If TCP preparation fails, process preparation is dropped and neither baseline advances. First full success/recovery is `BaselineEstablished`; recovery and post-resume reconciliation reset quiet but never create genuine activity or a new spent epoch.
- Protected status may expose only the Phase05 warning's bounded PID and safe executable identity. Logs, audits and WebSocket hints contain neither; arguments, terminal identities, start ticks and socket identifiers never enter public status.
- Attributable denial can identify the current PID with null identity; global denial invents no PID. PID reuse cannot inherit old safe identity. Shared sockets retain one deterministic owner reference and flag omitted owners without truncating eligibility observation.

Future focused commands from repository root:

```sh
cargo test --manifest-path server/Cargo.toml idle_suspend::activity::process::tests
cargo test --manifest-path server/Cargo.toml process_discovery
```

The implementation owner must ensure these filters match named tests; zero tests is failure. Phase07 owns the broad `pnpm test`/`pnpm check` gates. The process smoke must use fixture-owned local children only and assert no idle-suspend executor request occurred.

## Risk Assessment

- **Proc churn mistaken for inactivity:** double identity reads, transactional commit and one bounded full retry turn churn into unavailable rather than zero.
- **Over-conservative unrelated proc failure:** only attributable metadata is deep-read; globally unreadable stat entries remain unavailable when they cannot be proved outside managed ancestry. Document deployment impact instead of weakening safety.
- **Wrapper grammar drift:** a new runtime flag can make observation unavailable. This is safer than arbitrary argument scanning; extend only with deterministic fixtures and contract review.
- **Reparent retention leak or severed output evidence:** exact identity validation and complete-pass retirement bound lineage lifetime; storing terminal identity plus its Arc handle preserves continuity without treating a removed root as a live PTY. Never retain by PID alone.
- **Memory/latency spike:** hard sentinels, iterative traversal, Phase01's borrowed compiled matchers and one shared acceptance deadline prevent silent unbounded work. Exactly-at-limit complete input remains valid; partial input never does.
- **False-busy descendants:** every descendant of a recognized agent intentionally contributes sockets, including services it starts. This is a conservative policy limitation, not a classifier bug.
- **False-idle detached work:** never-observed descendants can escape between polls. The plan documents this heuristic boundary; no unauthorized hooks/cgroups are added.

## Security Considerations

- Same-UID child ownership and readable procfs are prerequisites, not permission to inspect arbitrary host commands. Deep metadata/FD reads occur only for managed-root-attributable identities.
- Expected unprivileged deployment needs `/proc` PID/stat/exe/cmdline/cwd/fd/ns access for server-spawned children. `hidepid`, `ProtectProc`, differing UIDs, non-dumpable processes, LSM denial or container proc masking may make observation unavailable.
- Raw path/token bytes remain transient and never enter error strings, logs, telemetry or persistence. The sole display exception is the qualified, bounded safe identity projected with PID into the authenticated/no-store measurement warning. No arguments, env, prompts or command-line fallback.
- Do not follow arbitrary procfs symlinks for content. Read link targets/metadata only at fixed proc paths and perform no writes.
- Network namespaces are explicit ownership boundaries. Never enter another namespace, request privilege, or merge identical inode values across namespaces.
- Observation failure affects only automatic `agent-activity` eligibility. It never kills the workload, prevents PTY use, weakens auth or invokes the suspend helper.

## Next steps

Phase04 classifies every typed owned inode using current-namespace TCP4/TCP6, UDP4/UDP6 and AF_UNIX diagnostics, replaces inode with cookie/family/namespace keys and prepares per-socket counter changes. Phase05 owns the sole worker, one full retry, pair commit/abort, output/input combination, genuine-activity versus recovery epoch semantics, and fresh final sample. Phase07 keeps internal scripted observer tests in library scope and uses the public observer/status plus `FakeExecutor` for integration, including ignored `server/tests/idle_suspend.rs::activity_live_linux_pty_tcp_smoke`.

## Unresolved questions

- Deployment kernels and service hardening may not expose all required procfs metadata unprivileged. This is a qualification fact, not an implementation choice; affected hosts must remain `unavailable`.
- `docs/development-rules.md`, required by the planning skill, is absent in this checkout. Repository `AGENTS.md`, `docs/code-standards.md` conventions and the normative contract govern this phase; no substitute policy was invented.
