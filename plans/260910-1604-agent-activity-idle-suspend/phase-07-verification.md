# Phase 07 — Integrated verification and host qualification

## Context links

- [Plan](plan.md), [normative design contract](design-contract.md), [repository findings](research/repository-findings.md), and [approved detection rationale](../reports/brainstorm-260910-1604-pty-agent-activity-heuristic.md).
- Prerequisites: [Phase 01 policy/config](phase-01-policy-contracts.md), [Phase 02 PTY evidence](phase-02-pty-observation.md), [Phase 03 process discovery](phase-03-process-discovery.md), [Phase 04 TCP observation](phase-04-tcp-observation.md), [Phase 05 sampler/coordinator](phase-05-sampler-coordinator.md), and [Phase 06 API/UI](phase-06-api-ui.md).
- Existing verification surfaces: [`server/src/idle_suspend/tests.rs`](../../server/src/idle_suspend/tests.rs), [`server/src/pty/tests.rs`](../../server/src/pty/tests.rs), [`server/src/api/tests.rs`](../../server/src/api/tests.rs), [`server/tests/idle_suspend.rs`](../../server/tests/idle_suspend.rs), and [`packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`](../../packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx).
- Existing safety and operations contracts: [`docs/terminal-idle-suspend-security.md`](../../docs/terminal-idle-suspend-security.md), [`docs/linux-systemd.md`](../../docs/linux-systemd.md#11-terminal-idle-suspend-helper-enrollment--rollback-runbook), and [`scripts/verify-idle-suspend-boundary.sh`](../../scripts/verify-idle-suspend-boundary.sh).

## Overview

- Date: 2026-09-10.
- Description: qualify configured-agent activity eligibility from pure parsing through real managed PTY, loopback TCP, protected status, browser rendering, fake suspend admission, restore, and shutdown; keep actual host suspend an operator-only opt-in gate.
- Priority: P1. Estimated implementation effort: 26h.
- Implementation status: Pending.
- Review status: user validation incorporated; integration, security, UI, and Operations implementation review remain pending.
- Dependencies: Phases 01–06 complete and their shared types frozen. Phase 07 owns integrated test/evidence files after those owners hand off; production defects return to the owning phase rather than being masked in tests.

## Key Insights

- The dangerous regression is a false quiet result, not a missing badge. Every incomplete, stale, ambiguous, unsupported, overflowed, or timed-out observation must prove zero executor calls.
- Automated evidence must stop at the `IdleSuspendExecutor` seam. It may use fake executors, temporary proc/socket data, real unprivileged `/proc`, direct netlink diagnostics, local PTYs, loopback sockets, and Chromium. It must never invoke the enrolled helper, `systemctl suspend`, logind suspend, RTC writes, sudo, model APIs, or root asset installation.
- Unit tests should defend parsers, bounds, identities, and state transitions. Cross-module tests should defend user-visible eligibility and side effects. A Linux live smoke is qualification evidence for the actual procfs/netlink seams, not a deterministic replacement for fake tests.
- Existing `tokio::time::pause/advance`, `Notify` barriers, `TempDir`, `FakeExecutor`, real `PtySessionManager`, Axum `oneshot`, and Vitest browser patterns are the repository conventions. Do not add hard sleeps where a barrier, watch revision, or paused clock can establish the transition.
- The approved loopback `ss` experiment is prior evidence only. Production and qualification must exercise direct Rust socket diagnostics; no test may make `ss`, `lsof`, or `netstat` a runtime dependency.
- A one-second sample budget does not automatically make blocking procfs reads or a `spawn_blocking` task cancellable. `timeout` around blocking work is not proof that the work stopped. Target-host latency and shutdown/join behavior are hard feasibility gates; do not promise forced thread termination that Rust/Tokio cannot provide.
- Existing live fleet counts and manual force confirmation remain authoritative. `agent-activity` changes only automatic eligibility; test names and assertions must not relabel live service PTYs as absent.
- Blocked-measurement diagnostics are a narrow exception to the normal process-identity privacy boundary: only the authenticated, `Cache-Control: no-store` status GET and its rendered UI may show bounded PID/safe executable identity evidence. Arguments and all identity-bearing logs, audits, WebSocket hints, telemetry, and qualification artifacts remain prohibited.

## Requirements

### Evidence boundaries

1. Keep deterministic unit coverage with injected procfs, process metadata, diagnostic dump, monotonic clock, sample limits, and executor seams. Each fixture owns all files, identities, sockets, clocks, and cleanup.
2. Keep public-route/real-manager integration coverage in `server/tests/idle_suspend.rs` using its existing fake executor. Put scripted private observer/ticket races in existing `server/src/idle_suspend/tests.rs` or inline activity module tests: external integration crates cannot access `pub(crate)` types, and tests must not force private identities into the public API.
3. Keep raw PTY/input regressions with the actual `PtySessionManager`. Assert observed eligibility changes and handoff rejection; do not pin read chunk counts, terminal wording, or internal lock structure.
4. Keep API auth/status tests at the Axum router boundary and UI tests at rendered behavior. Do not add source-text tests for field presence or tests that only echo mocks.
5. Add one ignored, explicit Linux live observer smoke only if it exercises the actual managed-root, `/proc`, fd ownership, and direct netlink path without suspend. It must be named `activity_live_linux_pty_tcp_smoke`, use only test-owned loopback resources, and clean up on both success and failure.
6. Use real Chromium through the existing `@dam-hopper/ui` browser suite for the status surface. A jsdom/static-markup test alone is not UI proof.
7. Separate a live authenticated UAT browser walk-through from automated Chromium fixtures. UAT uses a custom disabled policy config and no live helper, so it cannot hand off to host suspend.
8. Treat a real automatic suspend/resume canary as an Operations procedure. Never put it in Cargo, Vitest, pnpm, CI, UAT runner, installer, or boundary script.

### Fixed timing, limits, and safety assertions

9. Verify 2s scheduled cadence, 1s per-sample acceptance deadline, 5s maximum accepted observation age, and a newly requested full sample after entering `finalCheck`. Late results are unavailable even if a kernel syscall outlives the deadline.
10. Verify hard limits independently: 256 terminal roots, 8192 process entries, 1024 relevant identities, 4096 fd entries per relevant process, 8192 owned sockets, 16MiB netlink response, and 16KiB candidate command line. Exactly-at-limit may qualify; insufficient/truncated over-limit input is unavailable, never truncated quiet.
11. Verify process identity is `(pid, start_ticks)` and terminal identity is `(session id, incarnation)`. Equal PID/count with changed start ticks/incarnation must invalidate.
12. Verify final admission binds request ID, activity revision, epoch activity revision, fleet generation, input revision, terminal/root set, and raw output checkpoints. Any mismatch makes the ticket stale and prevents claim.
13. Verify activity revision changes only for qualifying activity or required baseline resets. An unchanged heartbeat sample must not move the deadline or emit a status revision hint.
14. Verify unavailable-to-available recovery starts a complete quiet window but does not grant a new post-attempt epoch. Only genuine input/output/network/create/process activity can re-arm a spent epoch.
15. Verify lifecycle hard blockers (`creating`, `restart_pending`, `disposing`, `closing`, `handoff`) block automatic claim in both policies. Preserve `empty-fleet` semantics exactly.
16. Verify shutdown requests cancellation and joins the single worker/coordinator before PTY teardown, with no overlapping or detached work. Inject a blocked operation, prove timeout denies admission without pretending the worker stopped, release the barrier, then prove join completes before teardown. Real service-context latency must qualify; kernel-stalled syscalls can delay shutdown and no mathematical hard join bound is claimed.

### Deterministic fixture design

17. Pure discovery fixture: a `TempDir`-owned proc-like tree or reader trait supplies sorted stat/cmdline/exe/fd records, controlled read failures, pre/post start ticks, namespace identity, and explicit truncation. Use synthetic PIDs/inodes only inside the fixture; never inspect unrelated host processes.
18. Pure diagnostics fixture: typed records supply family, state, cookie, namespace, inode join metadata, and defensively sized TCP_INFO bytes. Provide exact sent/received counters and injected malformed/truncated/interrupted/error results.
19. Sampler fixture: a queue of complete/unavailable observations plus paused monotonic time drives coordinator events. Barriers release the fresh final sample in either order relative to input, timing, manual, fleet, and shutdown commands.
20. Real PTY/TCP smoke fixture: use the current integration-test executable as a test-only child mode under a managed PTY, selected by normalized absolute executable path. The child opens a test-owned IPv4 or IPv6 loopback TCP connection and exchanges commanded byte counts with an in-process listener. Guard recursion with an environment sentinel and exact test-harness filter. Do not depend on Node, Python, a model CLI, `nc`, `curl`, `ss`, or network access.
21. The smoke uses a recording executor that panics on any suspend request. It creates unique session IDs, closes client/server sockets, removes only its own PTYs, shuts down sampler/coordinator, and drops `TempDir`. Keep the test ignored because kernel/procfs/netlink availability is host-specific; failure is a qualification fact, not a retry target.
22. Browser fixtures use complete new-server DTOs plus explicit old-server payloads with both additive fields omitted. Assert consumer-visible policy/activity interpretation, not exact prose unless wording is a security warning required by contract.

### Blocked-measurement warning contract

23. Treat the following required field as part of every new-server `agent-activity` fixture and response. Tests consume it from `activity.measurementWarning` and produce evidence at the Axum serialization and rendered Chromium boundaries:

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
  processes: Array<{
    pid: number;
    executableIdentity: string | null;
  }>;
  processesTruncated: boolean;
}
```

24. Require `measurementWarning = null` for available measurement. Initial pending measurement produces `reconciling`; unavailable measurement produces the current reason. The field remains visible when `automaticPolicy = "agent-activity"` and coordinator `state = "disabled"`. `empty-fleet` continues to produce `activity = null`.
25. Verify `blockedSinceMs` represents the current continuous unavailable interval using monotonic state mapped to display-only epoch milliseconds: initialization is included, cause/PID/detail changes do not restart it, one complete available sample clears it, the next failure starts a new interval, and restart does not restore history. It never drives `armDeadlineMs` or eligibility.
26. Verify `processes` contains at most 32 current attributable blockers, sorted by PID and deduplicated privately by `(pid,start_ticks)`. Safe identity is the qualified native executable basename or script/entrypoint basename; an exact validated configured absolute path is allowed only when needed to distinguish a generic entrypoint. It is at most 256 UTF-8 bytes, has no control characters or arguments, and is `null` rather than a raw cmdline/`argv[0]` fallback when qualification fails.
27. Verify host-wide failures and unknown attribution retain reason/duration with an empty process list and no invented PID or total. `processesTruncated` means more than 32 known attributable blockers or omitted known shared owners; unknown attribution alone does not set it. Reporting caps do not weaken complete-observation requirements, trigger an enrichment scan, extend a timed-out scan, or grant eligibility.
28. PID/safe identity warning fields are permitted only through the authenticated no-store status response and its escaped plain-text UI. Anonymous requests remain denied; command arguments, start ticks, session/root/socket identities, addresses, terminal content, and warning identities in logs, audits, telemetry, support artifacts, or WebSocket hints remain forbidden. No warning offers a command, copy-command, signal, kill, or automatic-remediation action.

## Architecture

### Qualification ladder

```text
Pure bounded parser/state tests
  -> PTY manager + scripted observer + fake executor integration
  -> Axum protected status and revision-hint integration
  -> Chromium status/settings/manual-action behavior
  -> ignored live Linux managed-PTY + direct-netlink smoke (never suspend)
  -> disabled-policy authenticated UAT browser inspection (never suspend)
  -> Operations-only timed automatic suspend canary on one qualified host
```

A lower layer failing blocks every higher layer. Passing a higher layer never waives a deterministic lower-layer failure. The default release remains `empty-fleet`; a host may receive the code while `agent-activity` stays disabled or unselected.

### Complete qualification matrix

| ID  | Layer                   | Setup and stimulus                                                                                                                                   | Required observable result                                                                                                                                                                                                                                   |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q01 | Config/unit             | Omit both new keys from an old valid config                                                                                                          | Starts with `automatic_policy = empty-fleet`, existing enabled/timing behavior unchanged, default executable list valid                                                                                                                                      |
| Q02 | Config/unit             | Native basename, normalized absolute native path, supported interpreted script/entrypoint flags and `--`                                             | Exact case-sensitive configured entry matches; executable/path identity, not arbitrary later argument text, decides                                                                                                                                          |
| Q03 | Config/unit             | `bash -c 'codex'`, `node -e`, `python -c`, `python -m`, unknown wrapper flags, generic `cli.js` basename                                             | Shell string never matches; unclassifiable attributable command is unavailable; generic script needs exact configured path                                                                                                                                   |
| Q04 | Discovery/unit          | Root shell -> matching child -> descendants, then matched parent reparents while alive                                                               | Matched identity and descendant attribution retained until validated exit; child sockets remain attributable                                                                                                                                                 |
| Q05 | Discovery/unit          | PID reused or pre/post `start_ticks` differ; root identity missing                                                                                   | Candidate never rebinds; affected observation unavailable while terminal remains usable                                                                                                                                                                      |
| Q06 | Discovery/unit          | Process under two managed roots, inaccessible potentially attributable metadata, or exact scan bound exceeded                                        | Affected observation unavailable; no zero-agent result or top-N selection                                                                                                                                                                                    |
| Q07 | Discovery/unit          | Complete roots with ordinary shells/services only                                                                                                    | Qualified zero recognized agents, true monitored-terminal count, no agent activity from their output/network/listeners                                                                                                                                       |
| Q08 | PTY/unit                | Agent-owned terminal emits visible bytes, ANSI/control-only bytes, or spinner redraw                                                                 | Raw sequence advances and qualifies `recentOutput`; content is neither parsed nor retained by activity observer                                                                                                                                              |
| Q09 | PTY/unit                | Hydrate restored scrollback, browser replay, clear buffer, or resize without child output                                                            | Raw sequence unchanged; no activity revision/deadline change                                                                                                                                                                                                 |
| Q10 | PTY/integration         | Recreate same session ID with new incarnation; old reader advances late                                                                              | Old counter/root cannot qualify replacement; new incarnation begins a new baseline                                                                                                                                                                           |
| Q11 | Input/integration       | Non-newline input accepted in agent, ordinary shell, or service-only terminal                                                                        | Input revision and last input advance before writer dispatch; all automatic quiet is invalidated globally                                                                                                                                                    |
| Q12 | Input/integration       | Empty input, nonexistent target, rejected post-handoff write, and injected writer failure                                                            | Empty/rejected input is not accepted or replayed; failed attempted write may conservatively reset only as documented; typed handoff error preserved                                                                                                          |
| Q13 | Network/unit            | TCP4 and TCP6 owned non-listening sockets increase sent, received, or both counters                                                                  | Delta computed per socket key; `recentNetwork`; no payload/address publication                                                                                                                                                                               |
| Q14 | Network/unit            | Same socket stays established with counters unchanged                                                                                                | No activity; pooled connection existence alone does not keep host awake                                                                                                                                                                                      |
| Q15 | Network/unit            | New owned socket, retired socket, or counter decrease                                                                                                | Activity plus new baseline; never subtract aggregate totals across changing sets                                                                                                                                                                             |
| Q16 | Network/unit            | Shared fd/socket ownership across relevant descendants/roots                                                                                         | Deduplicated once by cookie/family/namespace key; inode only joins ownership                                                                                                                                                                                 |
| Q17 | Network/unit            | Listener-only agent/service socket                                                                                                                   | Listener ignored and does not reset quiet                                                                                                                                                                                                                    |
| Q18 | Network/unit            | Owned UDP/QUIC, unknown family, missing TCP_INFO fields, namespace mismatch, malformed/truncated/interrupted dump                                    | Unavailable with the contracted reason; never claim TCP covered it or report zero traffic                                                                                                                                                                    |
| Q19 | Network/unit            | Expected close/read race                                                                                                                             | At most one retry inside the same 1s budget; second failure unavailable until next scheduled sample                                                                                                                                                          |
| Q20 | Policy/integration      | Service-only PTY continuously outputs and owns active/listening TCP; no recognized agent                                                             | `agent-activity` may reach deadline; live fleet counts remain nonzero; `empty-fleet` remains blocked                                                                                                                                                         |
| Q21 | Policy/integration      | Recognized agent shares PTY with noisy service or has noisy descendant                                                                               | Mixed output/descendant traffic conservatively resets quiet; UI/docs identify false-busy limitation                                                                                                                                                          |
| Q22 | Policy/integration      | Recognized agent is silent with unchanged sockets for full quiet period                                                                              | Arms once only after a complete available baseline and full quiet duration; no semantic-completion claim                                                                                                                                                     |
| Q23 | Sampler/unit            | Initial empty server, no prior activity                                                                                                              | Initial reconciling warning lasts until complete measurement, then clears; clean boot stays Watching without automatic arming even after an available empty baseline                                                                                         |
| Q24 | Sampler/integration     | Restored live roots followed by complete reconciliation                                                                                              | Initial warning clears only on a complete available sample; restored-root baseline may begin a full quiet window, but recovery alone never grants another spent epoch                                                                                        |
| Q25 | Sampler/unit            | Sample exceeds 1s, is older than 5s, hits any hard limit, or has counter/revision overflow                                                           | Unavailable with typed reason and zero automatic claim                                                                                                                                                                                                       |
| Q26 | Final-check/integration | Deadline reached with a recent cached sample                                                                                                         | Enter `finalCheck`, request a new full sample, and do not execute from cache                                                                                                                                                                                 |
| Q27 | Final-check/race        | Admitted input/create, changed raw checkpoint, or process/network change actually captured by the final sample                                       | Ticket stale or deadline moved; zero executor calls. An autonomous kernel change after its last sampled comparison is the documented blind spot, not an impossible zero-call guarantee                                                                       |
| Q28 | Final-check/race        | Timing PATCH admitted while final sample runs                                                                                                        | Ticket stale; unspent eligible epoch resets to now + new quiet duration; timing pair remains atomic                                                                                                                                                          |
| Q29 | Final-check/race        | Manual force command arrives while automatic final sample runs                                                                                       | Manual path follows existing auth/confirmation/claim rules; automatic request canceled/stale; no duplicate executor request                                                                                                                                  |
| Q30 | Final-check/integration | Fresh final sample fails or is unavailable                                                                                                           | Return Watching/unavailable, no executor, epoch not spent; later recovery starts full quiet                                                                                                                                                                  |
| Q31 | Epoch/integration       | Executor success, suppression, or failure, followed by unchanged samples/recovery/timing/helper release/wall-clock change                            | Exactly one request for spent epoch; no automatic retry                                                                                                                                                                                                      |
| Q32 | Epoch/integration       | New accepted input, agent output, network delta, create, or relevant identity change after spent epoch                                               | New genuine activity grants the next epoch; a later full quiet period may attempt once                                                                                                                                                                       |
| Q33 | Outcome/integration     | Automatic or manual outcome/resume                                                                                                                   | Baselines invalidated, live process identities reconciled before eligibility, handoff released, spent automatic epoch preserved                                                                                                                              |
| Q34 | Shutdown/integration    | Shutdown while scheduled scan, fresh final scan, command, or executor future is pending                                                              | Admission stops; command loop remains responsive; sampler/coordinator cancel and join before PTY teardown; no overlapping collector remains                                                                                                                  |
| Q35 | API                     | Protected GET with cookie/Bearer; unauthenticated GET; empty-fleet and agent-activity snapshots                                                      | Auth and `no-store` preserved; additive fields exact; `activity = null` only in empty-fleet; warning PID/safe identity appears only when attributable; commands, arguments, private roots/sockets/addresses absent                                           |
| Q36 | API/revision            | Unchanged 2s samples, meaningful state/count/reason/deadline change, live GET                                                                        | Heartbeats do not spam `statusRevision`/WS hints; meaningful change emits hint; GET may show latest display timestamps                                                                                                                                       |
| Q37 | Client compatibility    | New client receives old-server status missing `automaticPolicy` and `activity`; fetch fails                                                          | Missing fields render legacy empty-fleet semantics; failed fetch remains unavailable/error, never fabricated zeros                                                                                                                                           |
| Q38 | UI/browser              | Available/initializing/unavailable/epoch-spent states, known and unknown counts, active deadline                                                     | Shows selected policy, count or unknown, activity reason/countdown, true fleet counts, TCP-only heuristic warning, and blocked warning reason/duration/current identified examples; no matcher editor                                                        |
| Q39 | UI/browser              | Manual force dialog opened while agent policy active                                                                                                 | Existing active-fleet confirmation, auth behavior, one-POST/no-retry, handed-off disablement, and resume reconciliation unchanged                                                                                                                            |
| Q40 | Security                | Status GET, hints, logs/audits inspected under success and all errors                                                                                | Only authenticated no-store `measurementWarning.processes[]` may contain PID and qualified safe executable identity; no arguments/start ticks/session/root/socket/address/bytes/token leak, and no warning identity in hints/logs/audits                     |
| Q41 | Live Linux smoke        | Managed test child emits raw bytes and exchanges exact loopback TCP byte counts                                                                      | Actual proc ancestry/fd ownership/direct netlink path observes agent/output/TCP changes; listener/unchanged connection excluded; panic executor untouched                                                                                                    |
| Q42 | Target-host feasibility | Run live smoke under deployed API service hardening and target kernel                                                                                | Required TCP_INFO counters and unprivileged ownership reads work within bounds, or status remains unavailable and host is barred from opt-in                                                                                                                 |
| Q43 | Operator-only canary    | Approved single host, bounded RTC wake, service-only and quiet-agent sequences                                                                       | Exactly one automatic handoff per genuine epoch, expected resume/reconciliation, audits intact; no automation invokes this scenario                                                                                                                          |
| Q44 | Disabled qualification  | Select `agent-activity` with `enabled = false`, emit local fixture output/TCP/input, then wait past quiet                                            | Observer/status reflect real activity and any `reconciling`/unavailable warning; coordinator stays Disabled, deadline null and zero automatic executor calls; empty-fleet starts no activity observer                                                        |
| Q45 | Warning/network         | Owned UDP/unsupported socket has a qualified attributable process identity                                                                           | Measurement unavailable and zero automatic execution; authenticated no-store warning shows the current PID, safe executable identity, `unsupportedTransport`, and continuous blocked duration                                                                |
| Q46 | Warning/discovery       | Required proc metadata read is denied for a directly attributable process                                                                            | Warning permits that PID with `executableIdentity = null`; no argv, environment, terminal content, start ticks, path fallback, or additional scan leaks; measurement remains unavailable                                                                     |
| Q47 | Warning/host failure    | Host-wide diagnostics, scan limit, or scan timeout fails without qualified attribution                                                               | Warning preserves exact reason and duration with `processes = []`, `processesTruncated = false`; no fake PID, blocker count, or exhaustive-process claim; zero automatic execution                                                                           |
| Q48 | Warning/interval        | Cause and attributable PID/details change while continuously unavailable; then one complete sample and a later failure                               | `blockedSinceMs` does not restart during the continuous blocked interval; recovery clears warning; next failure starts a new interval; warning changes never move eligibility/countdown or re-arm epoch                                                      |
| Q49 | Warning/PID lifecycle   | Attributable process exits, PID is reused with changed `start_ticks`, or recovery invalidates cached evidence                                        | Stale blocker entry disappears or becomes unattributed; reused PID is never bound to old safe identity; current evidence only, while the continuous interval persists until complete recovery                                                                |
| Q50 | Warning/bounds          | More than 32 known attributable blockers and shared-owner omissions; separately, attribution is unknown                                              | Exactly the lowest sorted bounded current examples are exposed, maximum 32, with truncation true for known omissions and false for merely unknown attribution; observation caps/completeness and one-second deadline remain unchanged                        |
| Q51 | Warning/privacy         | Anonymous and authenticated status GETs plus WS hints, logs, audits, telemetry/support capture; identity contains metacharacters and argument secret | Anonymous GET denied; authenticated response is no-store; UI escapes safe identity as plain text; argument secret and warning PID/identity are absent from hints/logs/audits/telemetry/artifacts; no executable action/control                               |
| Q52 | Warning/UI/browser      | Real Chromium renders initializing, disabled-observer, attributable, host-wide-empty, cause-change, recovery, and truncated warning fixtures         | Shows reason, continuously elapsed “Blocked for …”, current PID and safe identity or “Identity unavailable,” and identified-examples truncation; initial/disabled states stay visible; countdown, true fleet counts, and force confirmation remain unchanged |

### Hard go/no-go gates

1. **Merge gate:** all deterministic focused and full repository commands pass without retry-masking; no zero-test filter accepted.
2. **Safety gate:** every busy/stale/unknown/unsupported/overflow/limit scenario records zero fake-executor calls. Any false quiet is no-go.
3. **Epoch gate:** exact one-request counts hold across final-check, manual, timing, outcome, recovery, and wall-clock races. Duplicate automatic request is no-go.
4. **Privacy gate:** only the protected no-store status DTO and its escaped UI may expose bounded `measurementWarning.processes[].pid` and qualified `executableIdentity`. Arguments, start ticks, terminal/root/socket/address/content data, and warning identities in WS hints, logs, audits, telemetry, screenshots, or evidence artifacts are prohibited. Leakage or identity rendering as markup/action is no-go.
5. **Responsiveness gate:** timing/manual/shutdown admission remains responsive during final sampling. Late results cannot claim; overlapping/detached collectors are no-go. Measure normal shutdown join on the target host and report kernel-stall limitations honestly.
6. **Target-host observer gate:** direct Rust TCP diagnostics, proc ownership, namespace, required counters, and one-second budget qualify under the actual service context. Unsupported hosts remain `unavailable` with a warning and cannot enable automatic agent-policy execution; disabled observation remains available for diagnosis.
7. **UI gate:** actual Chromium renders unknown as unknown; shows initial, disabled-observer, attributable, host-wide-empty, truncation, continuous-duration, cause-change and recovery warning states; warns TCP-only heuristic/no completion proof; preserves live counts/countdown/manual confirmation; handles old-server payloads. Misleading zero/idle, stale PID, or warning-driven countdown is no-go.
8. **Rollout gate:** code may ship with default `empty-fleet` after automated gates. Enabling automatic agent-policy execution additionally requires documented Operations approval, physical/out-of-band recovery, a bounded timed canary, and rollback ownership. Selecting `agent-activity` with `enabled=false` is the preceding observation-only qualification stage.
9. **Canary gate:** any unexpected suspend, missing wake, duplicate request, stuck handoff, lost PTY reconciliation, foreign RTC state, or incomplete audit immediately stops rollout and triggers Phase 08 rollback.

## Related code files

Phase 07 integration owner may modify tests only after Phase 01–06 handoff:

- `server/tests/idle_suspend.rs`: public API/real-manager/fake-executor scenarios and ignored `activity_live_linux_pty_tcp_smoke`, using the public coordinator and status rather than reaching into private observer types. Private scripted-observer/ticket races stay in `server/src/idle_suspend/tests.rs` or inline activity tests.
- `server/src/pty/tests.rs`: raw output, input-before-write, same-ID/new-incarnation, replay/hydrate/resize, and handoff-write regressions when not already owned by Phase 02.
- `server/src/api/tests.rs`: protected status DTO, privacy, old/new policy behavior, and meaningful revision-hint cases.
- Phase06's client boundary coverage stays in existing component/browser scenarios unless malformed/old-server transport decoding requires a new narrow `packages/ui/src/api/idle-suspend-client.test.ts`. `client.test.ts` does not currently exist; do not invent an existing test location or duplicate coverage.
- `packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx`: consumer-visible policy/activity/count/unknown/compatibility states.
- `packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.test.tsx`: timing/manual separation and handoff behavior only where changed.
- `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx`: regression-only confirmation/no-retry behavior; do not retest unchanged markup.
- `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`: real Chromium status, warning, countdown, compatibility, and manual-action regression.

Inspect and require focused unit coverage in the files created/owned by Phases 02–05 under `server/src/pty/` and `server/src/idle_suspend/activity/`. Do not move all parser tests into the integration suite or duplicate them. Production source fixes remain with their phase owner.

Run but do not modify unless a pre-existing boundary genuinely changed:

- `scripts/verify-idle-suspend-boundary.sh`: existing helper/auth/RTC/static boundary suite. Do not add wording/source-plumbing assertions for activity fields.
- `scripts/run-all-tests.sh`: actual aggregate command behind `pnpm test:all`; it already runs server, shared, browser bridge, UI, native, and UI browser suites.
- `packages/ui/vitest.browser.config.ts`: existing Chromium configuration; no feature-specific server plugin.

No deployment unit, helper protocol, RTC backend, or permanent model-agent fixture belongs to this phase.

## Implementation Steps

1. Freeze a requirements-to-evidence checklist from Q01–Q52. For every row, name one primary test/smoke artifact and one owner. Reject rows backed only by code inspection, mocked field echo, or prose.
2. Review Phase 01–05 unit tests against configuration bounds, identity reuse, wrapper parsing, attribution retention, per-socket deltas, UDP/namespace failures, sample limits, revisions, and recovery. Add only missing behavior regressions in the owning module.
3. Extend `server/tests/idle_suspend.rs` fixture construction for both automatic policies and the real observer through the public coordinator. Keep scripted private-observer scenarios inside the library's test modules. Preserve current `FakeExecutor`, Axum, real PTY, and paused-time patterns; fixture-owned teardown must run after assertion failure.
4. Add integrated service-only, recognized-agent, mixed-session, raw output/input, network, stale/final sample, spent epoch, timing/manual race, outcome/restore, and shutdown scenarios. Assert coordinator state/deadline/reason plus exact executor request count.
5. Use barriers around fresh-final sampling. Exercise each race with both event orders instead of scheduler sleeps. A stale ticket must never claim even when counts happen to match.
6. Add API tests for `automaticPolicy`, nullable `activity`, reason/count nullability, `networkCoverage`, and the exact required `measurementWarning` null/object union on all agent-activity constructors, including initializing and disabled observer states. Cover protected/no-store behavior, bounded/sorted process examples, privacy omissions, meaningful warning-detail revisions, and revision-hint suppression; preserve the timing and force-suspend auth/CSRF matrix.
7. Add focused client/UI behavior tests for warning decoding, continuous elapsed duration, current PID/safe identity or unavailable identity, empty host-wide attribution, truncation, escaping, recovery, initial and disabled visibility. Delete or avoid tests that only pin incidental wording, object field copying, CSS classes, or mock return values; assert accessible behavior and unchanged countdown/fleet/manual flow.
8. Extend the existing Chromium suite with complete new-server warning DTOs and old-server payloads. Exercise keyboard and pointer access to the existing host status/manual dialog, meaningful status refresh, cause/detail change without interval reset, recovery, safe rendering, and no fake zero after fetch failure.
9. Implement the ignored Linux live observer smoke using the current integration test binary's test-only child mode, managed PTY, in-process loopback listener, direct production proc/netlink collector, and panic executor. Cover raw output, accepted input, TCP send/receive, unchanged pooled socket, listener exclusion, and cleanup. Skip with an explicit unsupported reason on non-Linux; do not turn unsupported Linux measurement into a pass.
10. Exercise restore ordering with persisted scrollback/root metadata: restore first, start observer/coordinator second, establish fresh baseline, then prove full quiet behavior. Exercise outcome baseline invalidation and identity reconciliation.
11. Exercise shutdown at each blocked seam. Prove late results deny admission, only one worker exists, and join precedes PTY teardown after an injected operation is released. Measure actual procfs/netlink sample and join latency under the target service context. A timeout is not forced syscall cancellation; observed persistent stalls block opt-in, never justify detaching work.
12. Run focused commands from repository root, then aggregate commands once. Record exact counts/results only in the eventual implementation report and Phase 08 changelog after execution; this pending plan claims none.
13. Run a disabled-policy authenticated UAT browser smoke only after automated proof. Use a custom `/tmp/dam-hopper-uat/dam-hopper.toml` with `enabled = false`, `automatic_policy = "agent-activity"`, exact fixture executable entry, and a deliberately nonexistent `DAM_HOPPER_IDLE_SUSPEND_SOCKET`; start via `scripts/run-uat.sh`, inspect through a real browser/authenticated profile, and stop in Phase 08 cleanup. Do not use `--no-auth` as auth evidence.
14. Have Security review fail-closed/privacy cases, UI review the real Chromium surface, and Operations review target-host live observer evidence and canary prerequisites. Apply the hard gates without waivers hidden as warnings.
15. Only after all non-suspend gates pass, hand Phase 08 the evidence record and target-host feasibility result. Operations—not the test runner—decides whether to run one bounded automatic suspend canary.

Future validation commands, from repository root; do not run during parallel implementation:

```sh
cargo test --manifest-path server/Cargo.toml --lib idle_suspend::activity
cargo test --manifest-path server/Cargo.toml --lib pty::
cargo test --manifest-path server/Cargo.toml --lib api::tests::idle_suspend
cargo test --manifest-path server/Cargo.toml --test idle_suspend
pnpm --filter @dam-hopper/ui test -- HostIdleSuspendStatus.test.tsx SettingsIdleSuspendTimingSection.test.tsx ForceSleepDialog.test.tsx
pnpm --filter @dam-hopper/ui test:browser -- idle-suspend-settings-status.browser.tsx
cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
./scripts/verify-idle-suspend-boundary.sh
pnpm test:all
pnpm check
```

Before accepting a Cargo filter, confirm its output reports at least one executed test. The ignored live smoke runs only on an explicitly selected Linux qualification host. `pnpm test:all` is grounded in `scripts/run-all-tests.sh`; `pnpm check` is the root build/native/lint/server-test gate. None of these commands may reach real suspend or RTC state.

## Todo list

- [ ] Map Q01–Q52 to concrete test/smoke owners with no evidence gaps.
- [ ] Complete bounded config/process/TCP/sampler unit regressions.
- [ ] Complete raw PTY/input and incarnation regressions.
- [ ] Complete integrated service-only, mixed-session, stale/recovery, epoch, manual/timing, restore, and shutdown scenarios.
- [ ] Prove exact fake-executor calls and zero side effects on every denial.
- [ ] Complete protected API/auth/no-store/warning/privacy/revision-hint coverage.
- [ ] Complete client compatibility and real Chromium UI coverage, including continuous warning duration, current identities, truncation, initial/disabled visibility, recovery, and unchanged fleet/countdown/manual behavior.
- [ ] Run the ignored managed-PTY/direct-netlink Linux smoke on a qualification host.
- [ ] Prove acceptance deadlines, single-worker cleanup and target-host join latency.
- [ ] Run focused and aggregate repository commands once after integration.
- [ ] Complete disabled-policy authenticated UAT browser smoke without helper access.
- [ ] Obtain Security, UI, and Operations gate decisions.
- [ ] Hand verified evidence and cleanup inventory to Phase 08.

## Success Criteria

- Q01–Q52 each has observed evidence at its proper layer or is explicitly marked target-host/operator pending; no planned row is called passed before execution.
- Complete scans can prove zero agents; every incomplete/uncertain scan fails closed. All configured matching, PID reuse, descendant retention, and ambiguity cases behave as contracted.
- Raw bytes and accepted input move eligibility at the correct admission boundaries. Replay/hydrate/clear/resize do not. Post-handoff bytes are rejected and never replayed.
- TCP4/TCP6 activity is per-socket; new/retired/decreased counters establish activity/baselines; unchanged connections/listeners do not. UDP/QUIC, namespace, metadata, counter, and dump failures are unavailable.
- Service-only PTYs may remain live under agent policy without their output/network blocking. Mixed agent/service activity remains conservative noise and is presented as such.
- Fresh final-check, stale ticket, recovery, spent epoch, timing, manual, restore, resume, and shutdown behavior produces exact one-or-zero executor requests as required.
- API and UI show policy, true fleet counts, recognized/unknown counts, reason, countdown, TCP-only heuristic warning, and exact blocked-measurement warning semantics. Initial and disabled observer warnings stay visible; old-server payloads fall back to legacy semantics without inventing zeros.
- PID and qualified safe executable identity appear only as bounded current examples in the authenticated no-store `measurementWarning`. Arguments, unsafe/raw identity fallbacks, start ticks, terminal/root/socket/address/content data, and warning identities in WS hints, logs, audits, telemetry, screenshots, and shared evidence remain absent.
- Live Linux qualification either demonstrates actual direct proc/netlink behavior under target service conditions or blocks opt-in as unavailable. No fallback heuristic is substituted.
- Automated commands and UAT perform zero host suspend, RTC, helper execution, sudo, root installation, or model API calls.
- One-second sample acceptance and normal target-host shutdown/join latency are demonstrated honestly. Late results never qualify; kernel-stalled syscalls may delay join and are not falsely described as cancelled.
- Code may release with `empty-fleet` default after repository gates; no host enables automatic agent-policy execution without Phase08 approval and canary prerequisites. Disabled agent-policy observation and warnings remain usable before qualification.

## Risk Assessment

| Risk                                                   | Impact   | Mitigation / gate                                                                                                                                              |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| False quiet from partial process/socket scan           | Critical | Fault/limit/truncation matrix; assert zero executor calls                                                                                                      |
| Poll misses short-lived work between scans             | High     | Document admitted heuristic; fresh final scan narrows but does not claim atomicity                                                                             |
| Blocking procfs/netlink work outlives timeout/shutdown | Critical | Real cancellation/join measurement; no detached worker; block opt-in or revise design if unprovable                                                            |
| Live smoke flakes with unrelated host processes        | High     | Attribute only test-owned managed root/socket; unique identities; no global count assertions                                                                   |
| Test fixture accidentally reaches suspend helper       | Critical | Panic/recording executor, nonexistent helper socket, no helper binary invocation                                                                               |
| Race test passes by scheduling luck                    | High     | Paused time, barriers, both event orders, exact revisions/request counts                                                                                       |
| Unit mocks disagree with real kernel layout            | High     | Defensive byte fixtures plus ignored direct-netlink target-host smoke                                                                                          |
| UI turns unknown into zero/quiet                       | High     | Old/new/fetch-failure Chromium scenarios and accessible assertions                                                                                             |
| Existing empty-fleet behavior regresses                | Critical | Run old integration suite unchanged and explicit dual-policy scenarios                                                                                         |
| Privacy leaks through diagnostics or evidence logs     | High     | Positive authenticated warning-field tests plus negative serialization/hint/log/audit/telemetry assertions; escape UI identity; redact qualification artifacts |
| Controlled canary fails to wake                        | Critical | Operations window, bounded RTC, physical/out-of-band recovery, single request, immediate rollback                                                              |

## Security Considerations

- No test accepts command text, arbitrary shell fragments, regexes, or UI-edited matcher lists as authority. The live fixture identity may appear only through the same qualified, bounded authenticated warning contract; it never authorizes execution.
- Tests must prove independent gates: startup policy, complete measurement, freshness, lifecycle, epoch, final ticket, automatic claim, existing auth, helper capability, inhibitor, RTC ownership, audit, and warning isolation. `agent-activity` must never call the manual forced-claim path.
- Fake/test diagnostics retain no payloads or real remote addresses. Live smoke uses loopback only and records aggregate expected byte changes, not data content.
- Status/auth tests retain valid cookie/Bearer protection and `Cache-Control: no-store`. PID and qualified safe executable identity are allowed only inside `activity.measurementWarning.processes`; `--no-auth` is negative coverage only, never an approval path for host mutation.
- Evidence artifacts must omit JWTs, cookies, usernames, hostnames, command lines, process/terminal IDs, executable identities/lists/paths, remote addresses, and audit contents unless an operator deliberately supplies a redacted warning screenshot for restricted support. Default records store only test name, result, reason code, timings/limits, and sanitized environment facts.
- Do not run a live observer smoke against unrelated users' process trees or namespaces. It observes only the current service namespace and test-owned descendants.
- A real canary is host-wide, destructive, and outside automation. Require explicit owner consent, maintenance window, exclusive RTC ownership, no inhibitors, one bounded request, and verified recovery before execution.

## Next steps

1. Phase 08 updates architecture, API, configuration, security, deployment, product, summary, roadmap, index, and changelog only after Phase 07 smoke evidence exists.
2. Ship defaults as `enabled = false` and `automatic_policy = "empty-fleet"`; treat agent policy activation as a separate per-host Operations decision.
3. Transfer a sanitized qualification record: exact commit/build, target kernel/service context, executed commands/results, unsupported facts, sample latency/shutdown observations, canary decision, and fixture cleanup list. Redact warning PIDs/executable identities unless the operator deliberately authorizes their restricted disclosure.

## Unresolved questions

- Can each target kernel/service sandbox expose unprivileged `SOCK_DIAG` TCP_INFO sent/received fields and complete `/proc/<pid>/fd` ownership within the one-second wall budget? The prior workstation `ss` experiment does not answer this.
- What normal sample/join latency does each target service context exhibit? A kernel-stalled syscall may delay joining; this is an admitted operational limitation, not a requirement to invent unsafe thread termination.
- Which production host, Operations owner, maintenance window, and verified physical/out-of-band wake path will own the first bounded automatic canary?
- Do target workloads use UDP/QUIC, another network namespace, or a local UNIX/external proxy often enough that the policy will remain unavailable or materially incomplete? Measure; do not broaden scope in this feature.
