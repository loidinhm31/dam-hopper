# Implementation contract — configured-agent activity idle suspend

Status: pending implementation. Normative integrated contract across every phase, including the user-validated warning report. Phase files incorporate these decisions directly; no separate amendment overrides them.

## Objective and explicit non-goals

Identify configured AI CLI processes in server-managed PTYs. Recent raw PTY output or attributable network byte changes keep automatic suspend from claiming. Quiet recognized agents, live ordinary shells, and service-only PTYs may coexist with automatic suspend. Accepted input anywhere resets quiet time. Feature is a heuristic: no promise of semantic job completion.

No harness adapters/hooks, API gateway, content parsing, CPU/PSI activity thresholds, generic service classifier, cgroup/eBPF deployment, provider-cache control, browser-presence trigger, database migration, or privileged helper protocol expansion.

## Policy and rollout

- Add `automatic_policy` to operator-owned `[server.idle_suspend]`: `empty-fleet` (default, existing semantics) or `agent-activity` (explicit opt-in). Both are supported policies, not a compatibility shim. Existing enabled installations must not unexpectedly start suspending open services after upgrade.
- Add operator/startup-owned `agent_executables`: default `["codex", "omp", "claude", "agy"]`; 1..32 unique case-sensitive literal entries, basename or normalized absolute path; 1..256 UTF-8 bytes each. Allowed path-component characters are ASCII letters/digits, `_`, `-`, `.`, `+`, `@`; `/` only separates components of an absolute path. Reject whitespace/control/NUL, other pattern/shell syntax, empty or dot/dot-dot components, repeated/trailing slash and relative paths containing `/`; never interpret allowed punctuation as regex. Reject broad interpreter basenames even in absolute paths (`node`, `nodejs`, `bun`, `python` including versioned names, `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`), with guidance to list entrypoints.
- Serialize public config camelCase, canonical TOML snake_case using existing parser/writer conventions. Freeze both fields in StartupIdleSuspendPolicy. Every full-config/import/reload/workspace path must preserve startup authority exactly as current idle-suspend fields do. Existing timing PATCH still changes only its complete bounded pair; no pattern-list UI/mutation route.
- Enabled default false unchanged. quiet default 900s, range 60..86400; wake default 600s, range 60..86400 unchanged. Existing manual force-suspend/confirmation DTOs and helper capability/audit/inhibitor checks remain.
- Start the observer whenever startup policy is `agent-activity`, including `enabled = false`, so protected status can qualify observation without automatic execution. Disabled coordinator remains `disabled`, cannot arm or automatically execute, and has no countdown; manual action retains its existing independent authority. No extra dry-run option or endpoint. Empty-fleet starts no activity observer.
- Poll cadence fixed internal 2s; per-sample acceptance deadline 1s; publish validity with monotonic completed_at; maximum accepted observation age 5s. A result completing after its deadline is unavailable and cannot claim. Final-check requests a NEW sample after entering finalCheck, not merely any <5s cached observation. The deadline does not promise cancellation of a kernel-stalled procfs syscall.
- Hard per-sample limits: 256 managed terminal roots, 8192 scanned process entries, 1024 retained relevant identities, 4096 fd entries per relevant process, 8192 owned sockets, 16MiB netlink response bytes, 16KiB command line per candidate. Reaching an insufficient/truncated bound means unavailable, never zero agents/traffic. No silent top-N selection. Bounded pure parsers/fake seams may take smaller test limits.

## Private identity and matching contract

- `ProcessIdentity = (pid: u32, start_ticks: u64)`; `TerminalIdentity = (session id, incarnation)`. Read pid start time before and after candidate metadata/fd reads; mismatch/disappearance is handled explicitly, not rebound to a reused PID.
- Capture Child::process_id at spawn and respawn, resolve immutable root identity before observation becomes valid. portable-pty Unix process_group_leader means current foreground PGID, NOT root identity. Existing launch must not fail merely because observation cannot qualify; live terminal remains usable, automatic agent policy unavailable.
- Scan /proc stat/PPid once per pass, build adjacency, walk managed roots. Read executable/command tokens only for attributable processes. Reuse lower-level file/identity helpers where suitable, not host telemetry's top-RSS list. No global cmdline persistence/logging.
- Native match: exact real executable basename or configured normalized absolute executable path. Interpreted match: actual script/entrypoint token for node, bun, python/python3 (versioned python basename allowed only as interpreter), and shell-script interpreter argv. Bound parsing, support documented finite flags plus `--`; never scan arbitrary later args for a name. `node -e`, `python -c`, `python -m`, unknown wrapper flags -> unclassifiable attributable command -> unavailable, not ordinary service. This deliberately favors conservative false-busy over guessing. Scripts with generic basename (cli.js) require exact configured entrypoint path.
- `bash -c 'codex'` does not match the shell's string; discover the spawned executable. The gap is covered only by input/create quiet reset and later polling, not claimed atomic discovery.
- Once a matched root/descendant is observed, retain its identity-to-terminal attribution while alive across reparenting, even after root exit; remove only on validated exit. Newly created, never-observed detached descendants can escape attribution; document polling limitation. Never kill workload to recover observation.
- Agent descendants supply socket ownership; deduplicate shared fd/socket ownership across roots. A process belonging to ambiguous multiple terminal roots makes affected observation unavailable. Detected relevant identity discovery/exit/image or entrypoint changes conservatively reset activity. Polling does not detect every same-image exec or transient metadata change; never promise an exec-event stream.
- No recognized agents is a valid result ONLY from a complete qualified discovery pass. An unavailable process read that might hide an attributable agent cannot be ignored. Read failures provably outside managed roots need not block.

## PTY/input evidence contract

- Choose RAW output, not rendered text or retained scrollback length: one `Arc<AtomicU64>` output byte sequence per live incarnation incremented at reader Ok(n), before parsing/decoding/persistence. No allocations, hashing, text scans, per-byte manager mutex, or WS publication added. Saturation/overflow means observation unavailable; never wrap an activity counter into equality.
- This captures spinner/control bytes too. It intentionally may keep a mixed agent/service terminal awake. Browser replay, hydrate, buffer clear and resize alone do NOT increment raw output.
- Capture handles + root identity + fleet generation + input revision/time under manager mutex, then release before procfs/socket I/O. Read raw counters at beginning/end AND compare against the prior accepted end for the same incarnation/Arc, so bytes emitted entirely between scans count. Commit raw checkpoints with successful process/TCP observation; failed/stale samples never advance them. Count measured increases conservatively at sample-completion time; recovery alone is not activity, but an increase on the same retained Arc is genuine.
- `last_input_at` and `input_revision` belong to manager admission. Every accepted nonempty input to any live PTY invalidates automatic quiet BEFORE passing bytes to the writer; even non-newline input counts. Empty payload is a no-op. Failed attempted writes may conservatively reset but never appear accepted if rejected. Existing write caller signatures/errors migrate together; retain current WebSocket wire semantics rather than inventing an input acknowledgement protocol.
- After any accepted suspend handoff, terminal writes as well as creates/restarts return existing typed handoff error. Do not silently queue keystrokes or replay them after resume. Manual force API and confirmation stay unchanged; gating terminal input is intentional shared handoff safety.

## Linux network measurement contract

- TCP IPv4 + IPv6 only for byte observation: use unprivileged Linux NETLINK_SOCK_DIAG / INET_DIAG_INFO and /proc fd socket-inode attribution. Never spawn ss/lsof/netstat, use host-interface traffic, /proc/PID/io as network traffic, or decrypt TLS.
- Use socket diagnostic cookie + family + namespace identity as persistent key; inode is join metadata, not sufficient long-lived identity. Require valid TCP_INFO sent/received cumulative byte fields; parse length defensively. If selected kernel lacks needed fields, unavailable (no fallback to zero or raw unsafe struct cast).
- Filter owned sockets. TCP listeners alone are ignored. Track byte DELTAS per socket before aggregation. New attributable non-listening socket, socket retirement or unexpected counter decrease -> activity + new baseline. Byte-counter totals over the current socket set cannot be subtracted across samples.
- Current same network namespace only. Namespace mismatch / inaccessible ownership / malformed or interrupted/truncated dump / missing potentially-owned socket metadata / unsupported required counters -> unavailable. Retry once within sample budget only for expected close/read race; otherwise next scheduled sample may recover.
- Detect attributable INET UDP/QUIC socket presence and report `unsupportedTransport` while present; do NOT claim TCP counters cover UDP. Known local AF_UNIX IPC is not measured; delegation to an untracked external daemon or UNIX proxy is outside network attribution guarantee and must be documented. Unclassified socket family/ownership is unavailable.
- For final-check, a full fresh process/socket scan must complete within the same bounds. Socket/process activity entirely between scans remains an admitted heuristic blind spot. A cached sample/final fence is NOT proof no future autonomous network work starts.

## Sampler and eligibility contract

- New bounded `idle_suspend/activity` module owns procfs/TCP observation, identity/counter baselines and one sampler task. No permanent disk store. Only the authenticated warning projection below may disclose an attributable PID and safe executable identity; internal identities, cmdline and socket details never enter other status fields, logs, WS hints or audits.
- `ActivityObservation` (private): monotonic observation sequence, completed_at, measurement state + closed reason, captured fleet generation/input revision, per-terminal output checkpoints, recognized agent count, monitored terminal count, last qualifying activity time, activity revision, and epoch activity revision.
- Sequence increments per sample; activity revision increments only on qualifying observed activity or required baseline reset, not unchanged samples. An unavailable->available recovery starts a full quiet window but MUST NOT grant a new post-attempt epoch by itself.
- Global activity = accepted input anywhere + managed create/restart reservation + detected agent/descendant changes + raw output delta in a terminal with recognized/retained agent ownership + attributable socket changes. Ordinary service-only output/network/listening ports do not reset quiet. Mixed agent/service output and descendant service traffic remain conservative noise.
- Manager lifecycle hard blockers: creating/restart_pending>0, disposing, closing, handoff; live_count may exceed zero in agent-activity mode. Empty-fleet is_quiescent remains unchanged. Add an agent-policy claim path with an opaque observation ticket; never call the manual forced-claim path for automatic sleep.
- Deadline = max(last qualifying activity, baseline/recovery start, timing-change reset) + quiet duration. No second quiet period after a terminal becomes likely-idle. Continuous traffic/input keeps moving the deadline; samples alone do not.
- Initial empty server with no activity remains Watching (legacy no clean-boot auto-arm). Live restored roots count as initial nonquiescent context; after successful first baseline, a full quiet period may arm the new policy. Startup never hands off based on persisted timestamps/output bytes. First subsequent create/input/agent discovery qualifies a fresh epoch.
- Once an epoch is attempted (success, suppression or failure), require NEW genuine activity before another automatic attempt. Unchanged samples, status fetch, measurement recovery, timing update, helper release/resume or wall-clock jump must not re-arm a spent epoch. New input/output/network/create can start the next epoch even if a shell never exits.
- Timing update retains current validated atomic transaction. If admitted before handoff, reset countdown to now + new quiet duration for an unspent eligible epoch; unavailable remains non-armable. Same-pair no-op unchanged. Accepted handoff returns exact current 409 unchanged.

## Final admission and shutdown contract

1. At deadline enter FinalCheck and request one fresh sample; coordinator must remain responsive to timing/manual/shutdown commands (do not await slow scan inline in the select branch).
2. A timing/input/lifecycle invalidation while sample is running makes its ticket stale. Use request ID and activity/fleet/input revisions; never trust only equal counts or wall time.
3. Under manager admission mutex validate current policy state, lifecycle hard blockers, incarnation/root set, input revision, accepted observation ticket/activity revisions, current raw output checkpoints, and still-expired deadline. Claim handoff synchronously; issue immutable existing helper request through the current single-flight executor. No disk/procfs/netlink await under lock.
4. Claim prevents NEW server-admitted input/create/restart. A raw read/kernel process/network change immediately after comparison can still race; the heuristic does not gate autonomous OS execution. Do not freeze processes or claim atomic absence of work.
5. Final-sample failure => Watching with unavailable observation; no executor. This is not an actual sleep attempt and does not consume the epoch, but recovery restarts full quiet. Actual helper suppression/failure consumes epoch as existing policy does.
6. On outcome/resume, invalidate activity baselines; reconcile live process identities before agent-policy eligibility. Preserve spent epoch. Manual handoff likewise cancels automatic countdown and must not create a self-generated fresh epoch.
7. Start observer/coordinator after persisted PTY restore. Shutdown stops admission, requests cooperative cancellation and joins the single sampler worker/coordinator before PTY teardown. Check deadline/cancellation between bounded procfs operations and use nonblocking, deadline-aware netlink I/O; never overlap workers or detach work after a timeout. An in-progress kernel syscall can delay the join; no mathematical hard shutdown bound is claimed. Normal service-context sample/join latency must qualify before opt-in, and observed stalls block rollout rather than weaken admission.

## Public status addition (no new endpoint)

Extend protected IdleSuspendStatusV1 with required `automaticPolicy` and `activity` from new server. Old-server client compatibility: missing fields render legacy empty-fleet semantics, not zeros for failed fetches. Old clients ignore additive fields.

`activity`: null in empty-fleet; otherwise object:

- `measurementState`: `initializing | available | unavailable`.
- `reasonCode`: null, `recentInput`, `recentOutput`, `recentNetwork`, `agentChanged`, `lifecycleBusy`, `quiet`, `procAccess`, `scanLimit`, `scanTimeout`, `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`, `staleObservation`, `identityUncertain`, `counterOverflow`, `reconciling`, `epochSpent`.
- `recognizedAgentCount`, `monitoredTerminalCount`: nonnegative integers or null while unknown; never use stale count as evidence of zero.
- `sampledAtMs`, `lastActivityAtMs`: display-only timestamps or null. Scheduling uses monotonic Instant, not these fields.
- `networkCoverage`: literal `tcp4-tcp6` (coverage claim, not proof no blind spots).
- `measurementWarning`: required; null when available, otherwise the bounded warning object below, including initialization and disabled observation.

Existing armDeadlineMs remains the sole countdown deadline. Unknown observation is reflected in watching/unavailable reason, not a new executor capability code. Only `measurementWarning.processes` may disclose attributable PIDs and safe executable identities through authenticated, no-store status. No session IDs, start ticks, matcher list, arguments, environment, remote addresses, token data, terminal bytes or socket counts are exposed. Logs/audits/WS hints exclude warning identities too. Keep revision hint + REST refetch; unchanged samples and elapsed warning duration do not announce revisions. Meaningful warning reason/process/truncation changes do.

UI: display policy, recognized counts/unknown, activity reason/countdown and heuristic warning. When measurement is blocked, also show its reason, continuous blocked duration, identified PID/safe executable examples and truncation. Empty process detail remains visibly blocked. Preserve live fleet counts and manual force confirmation. No matcher editing, per-terminal controls, command execution or automatic remediation.

## Authenticated measurement warning

```ts
interface IdleSuspendMeasurementWarningV1 {
  reasonCode:
    | "procAccess"
    | "scanLimit"
    | "scanTimeout"
    | "socketDiagnostics"
    | "unsupportedTransport"
    | "namespaceMismatch"
    | "staleObservation"
    | "identityUncertain"
    | "counterOverflow"
    | "reconciling";
  blockedSinceMs: number;
  processes: Array<{ pid: number; executableIdentity: string | null }>;
  processesTruncated: boolean;
}
```

- Track the continuous measurement-unavailable interval with monotonic time; `blockedSinceMs` is display-only. Initialization uses `reconciling`. Cause/PID changes do not restart duration. Complete available recovery clears warning; later failure starts a new interval. Restart does not restore history.
- At most 32 currently attributable process examples, sorted by positive PID and internally deduplicated by `(pid,start_ticks)`. Host-wide/unknown failures may return an empty list. Never invent identity or imply zero blockers.
- Safe executable identity is a nonempty qualified native/entrypoint basename, or a configured exact path needed to distinguish a generic entrypoint; at most 256 UTF-8 bytes, no control characters or arguments. Unknown qualification yields null, not raw argv fallback. Render plain escaped text.
- `processesTruncated` indicates known additional examples or shared owners omitted by the bounded representative-owner report, not merely unknown attribution. Do not claim an exhaustive inventory or made-up total.
- Phase03 supplies bounded private `BlockingProcessEvidence` and `FailureContext` from normal collection: at most 1024 process entries and 8192 implicated owned inode records. For each deduplicated `OwnedSocketInode`, retain `inode: u64`, `representative_owner: ProcessIdentity` (lowest PID, then start ticks) and `has_additional_owners: bool`; safe identity stored once per process. No process×socket matrix or copied argument strings.
- Phase04 returns implicated owned inode context privately. Phase05 joins it against the same prepared Phase03 evidence even when TCP preparation fails, without committing process/TCP/raw baselines. No extra unbounded enrichment scan, privilege or deadline extension for reports.
- Replace stale warning details on each failure using current evidence; never rebind a cached PID after reuse. Keep interval continuity separate from detail validity. Report truncation cannot weaken observation-completeness checks.
- Authenticated/no-store status and UI are the only disclosure surfaces. No report export, persistence, audit/log identifiers, argument copy button, new endpoint or matcher controls. Warning data never authorizes sleep or replaces actual manual-force counts.
- Validate warning numeric fields as finite safe integers: positive sorted unique PIDs and nonnegative epoch-ms `blockedSinceMs` within the supported date range. Meaningful cause/process/truncation changes announce a status revision; elapsed duration alone does not. Missing nested warning on a new agent-policy payload is malformed, not legacy compatibility.

## Validation and ownership

- Phase order: 01 policy; 02 PTY seam; 03 process discovery; 04 TCP observer; 05 sampler/coordinator; 06 status/UI; 07 integrated qualification; 08 docs/rollout.
- 03 and 04 implementation can run in parallel after shared contracts/types; 04 consumes typed owned-socket inputs and must not reinvent matching. Coordinator integration requires 02/03/04. Phase06 DTO/view work can parallel Phase05 after field contract freeze, but shared status.rs mutation has one owner.
- Every phase specifies affected real files, new files, exact observable regressions, failure behavior and next gate. Lower-capability implementers must not replace missing measurement with stubs/heuristics not authorized here.
- Verify each implementation slice using repo Cargo/pnpm commands, not nonexistent bun check/test scripts. Parallel authors/implementers skip gates/formatters; integration owner runs formatting/gates after collection. No current implementation claims from a pending plan.
- Automated runtime evidence must never suspend, program RTC, require model API calls, install root assets or kill unrelated processes. Real-host suspend acceptance is separate operator-only qualification after fake-executor proof.
