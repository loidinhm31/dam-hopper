# Brainstorm: PTY output + agent network activity

Status: user-selected detection direction; no implementation performed. Detailed implementation plan not authorized.
Date: 2026-09-10
Supersedes the harness-adapter requirement in brainstorm-260910-1604-ai-work-suspend-gate.md.

## Objective and boundary

Use a configured list of AI CLI executables, such as codex, omp and claude. Identify their processes within managed PTY sessions. Detect recent output and network activity without any harness-specific lifecycle integration or model API gateway.

A terminal containing no recognized agent does not block merely because it has a live shell, service or listening port. Existing lifecycle admission, operator enablement, input quiet time and helper/inhibitor checks remain. Unknown required measurement is not reported as observed inactivity.

This is an activity heuristic, not proof of thinking, human waiting or task completion. User rejected per-harness state integration and proposed output/network observation. No claim of zero interrupted silent work.

## Proposed algorithm

1. Discover recognized agent processes belonging to each managed PTY; the PTY child may be a shell, with the agent below it. Match configured executable identities rather than searching arbitrary command text. Match native executable basenames/paths; interpreted launchers need the actual entrypoint token, not generic node/python identification or an argument mentioning an agent.
2. Key observations by terminal incarnation and process PID plus start time, not reusable PID alone. Include observable descendants for network ownership. Process ancestry alone cannot guarantee retention of escaped/reparented work.
3. Observe a monotonic PTY output counter per terminal. A change means new output; do not compare retained scrollback length or copy buffer contents. Replayed output to a reconnecting browser is not activity. Process creation/restore establishes a fresh baseline, not historical-output activity.
4. Map agent/descendant socket ownership and sample per-socket sent/received counters. Compare counters per socket identity before aggregating activity; never compare summed current socket totals, since closures could hide growth. Treat newly observed connections as activity and initialize a fresh baseline. A listening port or an unchanged established connection alone is not activity.
5. Track lastObservedActivity using monotonic time. Output, measured agent network traffic, accepted user input and new agent work/process evidence reset the quiet window. All recognized agents must be inactive for the existing configured quiet period before automatic sleep eligibility.
6. Recheck current identities, counters and lifecycle state at deadline. Integrate accepted input with the existing generation/handoff admission fence. This narrows races but polling does not guarantee atomic absence of autonomous work.

Conceptual rule:

lastActivity = max(lastInput, lastPtyOutput, lastAgentNetworkActivity, lastAgentStart)

agentLikelyIdle = measurementValid AND now - lastActivity >= quietPeriod

autoEligible = every recognized agent is likely idle AND existing lifecycle/policy/helper checks pass

Maintain separate activity eligibility; live_count still means live PTYs. Do not change manual force behavior or startup/resume policy as a side effect.

## Repository reuse

- server/src/pty/buffer.rs:6-11,51-54 already tracks total_written and exposes current_offset(). This counter survives scrollback eviction; no new output copy/hash is needed.
- server/src/pty/manager.rs:2512-2517 appends output; :2575-2583 receives newly read PTY bytes. For strict raw-byte activity including stripped control markers, add only a cheap per-reader counter; visible output can reuse current_offset(). Choose one defined source during planning.
- packages/ui/src/lib/agent-command-recognizer.ts and AgentCommandPattern in packages/ui/src/api/client.ts establish existing naming/pattern conventions. They are browser command recognition, not authoritative process discovery or permission to mutate startup policy.
- server/src/port_forward/detector.rs polls listening ports only. It cannot measure agent traffic.
- Existing bounded top-RSS process telemetry is not complete agent discovery.

## Network feasibility evidence

A disposable local TCP experiment exercised ss socket diagnostics without sudo. The selected connected socket exposed process ownership. After transmitting 4096 bytes and receiving 2048 bytes, diagnostics showed bytes_sent=4096 and bytes_received=2048. The established state remained unchanged throughout. Thus byte deltas, not connection existence, can detect traffic on this host.

The experiment proves local Linux TCP diagnostic feasibility only, not deployment permissions, all transports or end-to-end agent detection. A Rust implementation should use socket diagnostics directly instead of spawning ss repeatedly. TCP socket ownership can be correlated using /proc PID fd socket identities and socket diagnostic records. TLS payload decryption is unnecessary for transport byte counters. Retain only identities/counters/timestamps, not payloads or full command lines.

UDP/QUIC needs a separately supported traffic measurement mechanism; TCP counters must not be presented as universal coverage. Restricted procfs, permissions and network namespaces can also make ownership/counters unavailable. Report measurement limitations explicitly.

## Limitations retained, not hidden

- A silent provider response, local computation without output, or delayed retry can outlast quietPeriod and be paused. Longer quiet time reduces some false-idle cases but cannot prove completion.
- Periodic spinner redraws, heartbeats or service output in the same PTY can prevent sleep. PTY bytes cannot identify their writer; an agent descendant service may also contribute traffic. Service-only terminals are excluded, but perfect service exclusion inside a mixed agent session is not supplied by these signals.
- Short-lived sockets/processes may appear and disappear between samples. Missing counter history is not a proven zero-byte interval.
- An established pooled connection alone must not keep the host awake indefinitely.
- No heartbeat timeout, provider cache inference, screen-text classifier, per-harness hook, cgroup deployment or generic service classifier added.

## Acceptance checks for a later implementation

- Continuous recognized-agent output or measured network traffic prevents automatic sleep.
- An output-silent agent receiving TCP traffic remains active; an unchanged pooled socket alone does not.
- A quiet recognized agent becomes eligible after the configured interval; new input/output/traffic cancels the interval.
- Scrollback capacity saturation, buffer clearing and browser replay cannot produce false activity decisions.
- Multiple terminals aggregate correctly; service-only terminals/listeners do not block.
- PID reuse, wrapped executable launch, child-owned sockets, new socket baselines and socket closure cannot corrupt attribution/counters.
- Unsupported/failed measurement is surfaced rather than fabricated as zero activity.
- Fake-executor scenarios verify decisions before any operator-approved actual suspend test.

## Next step and unresolved decisions

Prepare a detailed implementation plan only on request. Fix the measurement contract first: visible versus raw PTY bytes; supported transport/permission matrix; configurable process identity rules; polling cadence; and behavior on unavailable observation. CPU activity is an optional additional heuristic, not included in the user's selected two-signal rule.
