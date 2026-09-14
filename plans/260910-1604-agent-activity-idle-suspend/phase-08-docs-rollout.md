# Phase 08 — Documentation, controlled rollout and rollback

## Context links

- [Plan](plan.md), [normative design contract](design-contract.md), [repository findings](research/repository-findings.md), and [approved rationale](../reports/brainstorm-260910-1604-pty-agent-activity-heuristic.md).
- Implementation prerequisites: [Phase 01 policy/config](phase-01-policy-contracts.md), [Phase 02 PTY evidence](phase-02-pty-observation.md), [Phase 03 discovery](phase-03-process-discovery.md), [Phase 04 TCP observation](phase-04-tcp-observation.md), [Phase 05 sampler/coordinator](phase-05-sampler-coordinator.md), and [Phase 06 API/UI](phase-06-api-ui.md).
- Evidence prerequisite: [Phase 07 integrated verification](phase-07-verification.md).
- Existing documentation owners: [`docs/system-architecture.md`](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture), [`docs/api-reference.md`](../../docs/api-reference.md#terminal-idle-suspend), [`docs/configuration-guide.md`](../../docs/configuration-guide.md#terminal-idle-suspend-opt-in-linux-suspend), [`docs/terminal-idle-suspend-security.md`](../../docs/terminal-idle-suspend-security.md), [`docs/linux-systemd.md`](../../docs/linux-systemd.md#11-terminal-idle-suspend-helper-enrollment--rollback-runbook), and [`docs/linux-release-manager.md`](../../docs/linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03).
- Existing operator assets: [`deploy/systemd/dam-hopper-api.service`](../../deploy/systemd/dam-hopper-api.service), [`deploy/systemd/dam-hopper-api.service.in`](../../deploy/systemd/dam-hopper-api.service.in), [`deploy/reset-linux-production.sh`](../../deploy/reset-linux-production.sh), and [`scripts/run-uat.sh`](../../scripts/run-uat.sh).

## Overview

- Date: 2026-09-10.
- Description: document the exact configured-agent heuristic and status semantics, stage it conservatively behind existing safe defaults, qualify one host without hidden fallbacks, and provide immediate rollback to `empty-fleet` or disabled automation.
- Priority: P1. Estimated implementation effort: 13h documentation and rollout preparation, plus an Operations-scheduled canary window.
- Implementation status: Complete (2026-09-11).
- Review status: Complete; documentation, runbooks, rollout stages, and rollback procedures integrated. Real-host automatic suspend canary remains an explicit Operations deployment gate.
- Dependencies: Phase 07 non-suspend gates passed and sanitized evidence available. Documentation may describe pending host qualification honestly; it must not claim a target-host pass or canary result before observation.

## Key Insights

- This is a policy expansion, not a replacement. `empty-fleet` remains the default and preserves current behavior; `agent-activity` is explicit startup opt-in.
- `enabled` and `automatic_policy` are separate. A safe observation stage uses `enabled = false` with `automatic_policy = "agent-activity"`, restarts the server, and inspects protected status without permitting automatic suspend.
- Both `automatic_policy` and `agent_executables` are startup-owned. Editing TOML, a full-config request, a settings import, workspace switch, or timing PATCH does not change the running values. A deliberate API service restart is required.
- Status is operational evidence, not semantic agent state. `available`/`quiet` means the bounded heuristic saw no qualifying signal for the quiet window; it does not mean a model request, retry, computation, task, or process is complete.
- `networkCoverage: "tcp4-tcp6"` names the only measured transport. It is not proof of complete networking, zero blind spots, zero bytes between scans, or coverage through UDP/QUIC, another namespace, AF_UNIX delegation, or an external proxy.
- Existing status GET and meaningful-change WebSocket hints are sufficient. Do not add a new telemetry backend, per-process endpoint, high-cardinality metrics, audit payload, or heartbeat revision stream for rollout.
- Rollback from activity eligibility does not require removing the privileged helper. Set the startup policy back to `empty-fleet` and restart. Full `deploy/reset-linux-production.sh` is reserved for complete idle-suspend disenrollment.
- Documentation cleanup and changelog result claims occur only after Phase 07 runtime/browser smoke proof. Editing stale architecture before evidence is appropriate; declaring implementation complete is not.

## Requirements

### Documentation truth and consistency

1. Replace the current zero-live-terminal-only description wherever it presents that as the sole automatic policy. Preserve it as the exact `empty-fleet` policy.
2. Document the two startup policy values, default, exact executable-list defaults/validation, TOML snake_case, JSON camelCase, restart requirement, timing ownership, and absence of a matcher UI/mutation endpoint.
3. Explain native and interpreted matching precisely: actual executable basename/normalized absolute path; supported finite interpreter entrypoint token; no arbitrary argument scan; `bash -c` strings do not count; generic script basenames require exact entrypoint paths.
4. Explain qualifying activity precisely: accepted input anywhere; managed create/restart reservation; recognized agent/descendant identity change; raw PTY output in an agent-owned terminal; attributable TCP4/TCP6 socket changes.
5. Explain exclusions precisely: ordinary service-only output/network/listeners, buffer replay/hydration/clear/resize, unchanged pooled TCP connections, status reads, unchanged samples, timing updates, helper release, and observation recovery.
6. Explain fail-closed states: incomplete proc access, any hard scan limit, timeout/staleness, identity uncertainty, ambiguous roots, unsupported counters/transports, socket diagnostics, namespace mismatch, overflow, reconciliation, and lifecycle blockers.
7. Document 2s cadence, 1s per-sample acceptance deadline, 5s accepted age, and fresh final scan. Late samples cannot claim. Cooperative cancellation cannot forcibly stop a kernel-stalled syscall, so shutdown join can be delayed; document this separately from normal target-host latency qualification.
8. Document one automatic attempt per genuine activity epoch. Helper suppression/failure/success spends the epoch; final-sample failure does not; recovery/timing/wall-clock change does not re-arm; genuine input/output/network/create/process activity can.
9. Preserve manual force-suspend DTOs, auth, active-fleet confirmation, helper checks, audit, and one-POST/no-retry guidance. Clarify that automatic agent policy never uses the forced claim path.
10. Only authenticated/no-store status and its UI may expose warning PID and qualified safe executable identity. Never expose arguments, matcher lists, terminal/session/root/start/socket IDs, remote addresses, terminal bytes, env or tokens. Logs/audits/WS hints and exported rollout artifacts exclude warning process details too; no verbose-logging workaround.
11. State Linux/current-network-namespace requirement. Unsupported targets remain `activity.measurementState = "unavailable"`; operators must not interpret that as quiet or enable the policy anyway.
12. Record only executed Phase 07 results. Do not copy historical counts from prior idle-suspend releases as evidence for this enhancement.

### Exact configuration paths and examples

13. Keep source/direct-run guidance at the loaded canonical registry: explicit `--config <path>` or `DAM_HOPPER_CONFIG`, otherwise `~/.config/dam-hopper/dam-hopper.toml`.
14. Keep release-manager/systemd production guidance at `/etc/dam-hopper/dam-hopper.toml`, grounded by both API unit files and the reset script.
15. Keep UAT guidance at a caller-supplied `--config` path; `scripts/run-uat.sh` otherwise creates `/tmp/dam-hopper-uat/dam-hopper.toml`. Never present the UAT default as the production registry.
16. Canonical safe example:

```toml
[server.idle_suspend]
enabled = false
automatic_policy = "empty-fleet"
agent_executables = ["codex", "omp", "claude", "agy"]
quiet_period_seconds = 900
wake_after_seconds = 600
capability_selection = "auto"
# enrollment_reference = "systemd:dam-hopper-idle-suspend-helper.service"
```

17. Observation-only qualification changes exactly `automatic_policy = "agent-activity"` while retaining `enabled = false`, then restarts the API. Enabling automatic action is a later approved edit to `enabled = true` plus restart; the authenticated timing PATCH may tune only the complete bounded timing pair.
18. Examples with interpreted agents use an exact normalized absolute entrypoint path, never `node`, `bun`, `python`, a shell name, regex, glob, environment expansion, relative slash path, or command line.

### Status and operational interpretation

19. Document `automaticPolicy` and `activity` on the existing protected status endpoint. `activity` is `null` under `empty-fleet`; otherwise it is required even when initializing/unavailable.
20. Document nullable counts as unknown, not zero. A missing additive field from an old server means legacy empty-fleet semantics; a failed GET is an error/unavailable state, not an old-server fallback.
21. Treat `sampledAtMs` and `lastActivityAtMs` as display-only wall timestamps. Scheduling uses monotonic time; clock jumps do not re-arm a spent epoch.
22. Keep `armDeadlineMs` as the only countdown deadline. No second “agent idle deadline” or per-terminal countdown.
23. Document status revisions/`host:idleSuspendChanged` as meaningful-change hints. Repeated 2s heartbeats should not create revision/audit/journal noise; a GET may return fresher display timestamps without a hint.
24. Use this operator reason guide without promising exact UI prose:

| Measurement / reason                   | Operator interpretation                                  | Action                                                                                |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `initializing` / null                  | No qualified baseline yet                                | Wait for a complete sample; do not enable automatic action based on it                |
| `available` / `recentInput`            | Accepted terminal input reset quiet globally             | Expected; countdown restarts                                                          |
| `available` / `recentOutput`           | Raw bytes arrived in an agent-owned/mixed terminal       | Expected; investigate noisy spinner/service only if false-busy matters                |
| `available` / `recentNetwork`          | Attributable TCP4/TCP6 socket changed                    | Expected; unchanged connection alone does not count                                   |
| `available` / `agentChanged`           | Relevant identity/socket baseline changed                | Expected conservative activity and fresh quiet window                                 |
| `available` / `lifecycleBusy`          | Create/restart/dispose/close/handoff blocks admission    | Wait for lifecycle settlement; do not override automatically                          |
| `available` / `quiet`                  | Complete heuristic sample, no recent qualifying activity | Candidate only; final fresh scan and admission checks still required                  |
| `available` / `epochSpent`             | This genuine-activity epoch already attempted            | No automatic retry until new genuine activity                                         |
| `unavailable` / `procAccess`           | Required proc identity/ownership inaccessible            | Fix service/proc permissions or roll back to `empty-fleet`                            |
| `unavailable` / `scanLimit`            | A hard bound made the sample incomplete                  | Reduce managed workload or stay on `empty-fleet`; never tune away bounds casually     |
| `unavailable` / `scanTimeout`          | Complete sample missed the 1s budget                     | Investigate target-host latency; no automatic claim                                   |
| `unavailable` / `socketDiagnostics`    | Direct kernel socket diagnostics/counters incomplete     | Verify kernel support/service sandbox; no fallback to interface traffic               |
| `unavailable` / `unsupportedTransport` | Attributable UDP/QUIC is present                         | Policy cannot qualify while present; use `empty-fleet` if workload requires it        |
| `unavailable` / `namespaceMismatch`    | Ownership crosses current network namespace              | Unsupported boundary; do not claim coverage                                           |
| `unavailable` / `staleObservation`     | Sample/ticket exceeded age or was invalidated            | Wait for fresh sample; repeated events indicate load/race issue                       |
| `unavailable` / `identityUncertain`    | PID/incarnation/root attribution cannot be proven        | Let workload settle/restart naturally or use `empty-fleet`; never kill it as recovery |
| `unavailable` / `counterOverflow`      | Monotonic evidence cannot be compared safely             | New incarnation/reconciliation required; no automatic claim                           |
| `unavailable` / `reconciling`          | Resume/outcome identity and baseline rebuild in progress | Wait; recovery is not new activity and does not re-arm a spent epoch                  |

25. Existing coordinator `state` still describes scheduling/handoff/outcome. `activity.measurementState` describes observation validity. Operators must inspect both plus true fleet/lifecycle counts and helper capability; neither field alone proves suspend readiness.
26. No per-terminal endpoint or remediation is added. Troubleshooting uses the protected measurement warning's reason, continuous blocked duration and current safe PID/identity examples, plus aggregate counts and existing sanitized qualification evidence. Unknown attribution is not no blockers; journals/audits never receive the warning's process details.

### Controlled rollout and rollback

27. Stage 0—release dark: ship code with old configs selecting `empty-fleet`; keep `enabled` as currently configured. Verify no existing enabled installation changes semantics after upgrade.
28. Stage 1—observation only on one Linux canary: set `enabled = false`, select `agent-activity`, configure exact executables, restart API, and observe status through representative agent, service-only, mixed, TCP, input, restore, and idle periods. Helper may stay enrolled, but automatic execution remains disabled.
29. Stage 2—target-host gate: run Phase 07 ignored live observer smoke under the deployed API user/service constraints. Record kernel, namespace, proc visibility, required TCP_INFO availability, sample latency, and shutdown join. Any unavailable required capability blocks enablement.
30. Stage 3—bounded automatic canary: Security and Operations approve one host, quiet/wake pair, maintenance window, exclusive RTC ownership, no inhibitors, physical/out-of-band recovery, and rollback owner. Set `enabled = true`, restart, and create one genuine epoch. Use bounded RTC wake; never automate or use indefinite sleep.
31. Stage 4—limited cohort: only after a clean canary and reconciled audit/status, expand one host at a time. Require the same target-host observer qualification. Do not infer fleet-wide compatibility from one kernel.
32. Broad rollout remains opt-in. There is no automatic migration from `empty-fleet`, config rewrite, UI toggle, or remote mass enablement in this feature.
33. Rollback to old semantics: edit the active registry to `automatic_policy = "empty-fleet"`, retain or set the intended `enabled`, restart `dam-hopper-api.service`, then verify protected status reports `automaticPolicy: "empty-fleet"` and `activity: null`. This restores zero-live-fleet eligibility; it does not disable the helper or manual force sleep.
34. Emergency disable: set `enabled = false`, preferably also restore `automatic_policy = "empty-fleet"`, restart API, and verify `state: "disabled"`. Resolve any active handoff before restart; never assume a config edit cancels already accepted execution.
35. Complete disenrollment only when required: after authoritative status shows no handoff, use `./deploy/reset-linux-production.sh --dry-run` and then the existing approved root procedure. It removes helper assets/policy and preserves foreign RTC state/audits; it is broader than activity-policy rollback.
36. Stop rollout immediately for unexpected suspend, missed bounded wake, duplicate attempt, stuck handoff, activity reported quiet during a known signal, repeated unavailable status, sample/join budget failure, privacy leak, or lost PTY reconciliation.

### Validated warning documentation and qualification

37. Keep the existing 900-second (15-minute) quiet default and explicit startup opt-in, including new installs and upgrades. Unknown/unsupported observation blocks automatic suspend with a warning; it never becomes zero traffic or quiet.
38. Document required `activity.measurementWarning`: null when measurement is available, otherwise `{ reasonCode, blockedSinceMs, processes: [{ pid, executableIdentity }], processesTruncated }`. Reasons are exactly `procAccess`, `scanLimit`, `scanTimeout`, `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`, `staleObservation`, `identityUncertain`, `counterOverflow`, `reconciling`. Initial/not-started status uses reconciling; `enabled=false` with agent policy still observes and warns.
39. Explain one continuous blocked interval: monotonic internal onset, epoch-ms display timestamp, unchanged by cause/PID changes; complete available recovery clears it and a later failure starts another. Restart has no history. “Blocked for” is elapsed measurement-unavailable duration, not quiet time, countdown or proof of agent completion.
40. Explain at most 32 current attributable examples, positive PID order, private `(pid,start_ticks)` deduplication, and safe identity of at most 256 UTF-8 bytes without controls/arguments. Identity is qualified native/entrypoint basename or the configured exact path needed for a generic entrypoint; unknown is null, never command-line fallback. Host-wide/unknown attribution shows no examples and invents no PID or total.
41. `processesTruncated` means known additional examples beyond the cap or omitted shared owners, not merely unknown attribution. Reporting uses already-bounded collection and same-preparation evidence, never extra scans, privilege, deadline extension or a weakened eligibility check. Stale PIDs are not rebound from cached evidence.
42. API, security, configuration and systemd guides must all state the narrow warning privacy exception and no logs/audits/WS process details. Examples use synthetic safe identities, not operational payload exports. No warning settings, policy UI, copy-command, kill/signal or automatic remediation.
43. During observation-only soak, exercise attributable UDP failure, metadata denial with null identity, host-wide empty examples, cause/PID changes preserving duration, truncation and recovery. Inspect authenticated/no-store status and actual UI; verify zero automatic calls, no duration-driven refetch/revision churn, unchanged force/fleet counts and no private log/audit/WS leakage. Missing or misleading warnings block enablement.

## Architecture

### Operator control plane

```text
Canonical TOML (startup authority)
  ├─ enabled = false + agent-activity -> observe/qualify only
  ├─ enabled = true  + agent-activity -> approved automatic heuristic
  └─ enabled = true  + empty-fleet   -> existing zero-live policy
             │ restart API required
             v
Protected GET /api/system/idle-suspend/v1/status
  ├─ coordinator state + sole armDeadlineMs
  ├─ real fleet/lifecycle counts
  └─ aggregate activity validity/reason/counts/TCP coverage
             │ meaningful revision hints only
             v
Operator decision -> continue, hold, rollback policy, or disable
```

The helper execution boundary is unchanged. The new observer is unprivileged, private, and cannot bypass authentication, helper peer checks, capability, inhibitor, RTC ownership, audit, lifecycle admission, or the one-attempt epoch latch.

### Rollout gates

| Gate                 | Evidence                                                                | Pass                                                                            | No-go response                                      |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| R0 compatibility     | Old config and existing `empty-fleet` suites                            | Omitted keys preserve exact current semantics                                   | Restore default/config parsing before release       |
| R1 automated safety  | Phase 07 deterministic Rust/API/UI/Chromium gates                       | No real suspend/RTC; exact one/zero fake calls; privacy clean                   | Fix owning phase; do not stage                      |
| R2 observer host fit | Ignored direct proc/netlink managed-PTY smoke under service context     | Complete samples inside budget; bounded shutdown; required counters available   | Keep disabled or roll back to `empty-fleet`         |
| R3 observation soak  | Protected status across representative workloads with `enabled = false` | Service-only excluded, agent/mixed/input/TCP/recovery states match expectations | Preserve artifacts, diagnose, no enablement         |
| R4 automatic canary  | Operations record + bounded timed wake + one epoch                      | One request, expected wake, clean reconciliation/audits                         | Emergency disable/empty-fleet rollback; stop cohort |
| R5 cohort            | Per-host R2 plus clean R4 precedent                                     | No repeated unknowns, false quiet, duplicate attempts, or privacy incidents     | Roll back affected host; do not widen rollout       |

### Explicit limitations to retain in every operator-facing document

- Polling can miss an agent/process/socket created and retired between scans. A cached or fresh final sample does not prove no future autonomous work begins after comparison.
- Newly created detached descendants never observed under a managed root can escape attribution. Already observed identities remain attributed while alive across reparenting.
- TCP4/TCP6 only. Owned UDP/QUIC blocks qualification; current-network-namespace only. AF_UNIX delegation to an untracked daemon and an external proxy are outside the guarantee.
- Raw PTY bytes cannot identify their writer. Spinner/control output and services in a mixed agent terminal may keep the host awake.
- A silent agent may be waiting for provider response, computing locally, delaying retry, or otherwise doing work. Full quiet is not semantic completion.
- Service-only terminals, output, traffic, and listeners do not reset agent-policy quiet. Selecting this mode explicitly permits automatic suspend while such services remain open.
- A raw/kernel activity change immediately after final comparison can race handoff. The implementation gates server-admitted input/create/restart but does not freeze processes or promise atomic absence of work.
- Process/socket permissions, kernel features, namespace topology, or the one-second budget may make a host permanently unavailable for this mode. There is no weaker fallback.

## Related code files

Phase 08 documentation owner modifies only after Phase 07 evidence exists:

| Path                                     | Action                                         | Required update                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/system-architecture.md`            | Modify                                         | Replace “planned enhancement” with implemented private observer/coordinator flow, final ticket, epoch, startup/shutdown order, and limitations; retain empty-fleet/manual/helper architecture |
| `docs/api-reference.md`                  | Modify                                         | Add required `automaticPolicy`/`activity` fields, enums/nullability/privacy, old-server fallback, meaningful WS revisions; no endpoint or matcher mutation                                    |
| `docs/configuration-guide.md`            | Modify                                         | Add exact TOML defaults/validation, startup ownership/restart, direct vs production paths, observe-only and opt-in examples, rollback                                                         |
| `docs/terminal-idle-suspend-security.md` | Modify                                         | Add proc/netlink threat boundary, fail-closed measurement, private data exclusions, final race caveat, automatic-vs-forced claim separation, canary approval                                  |
| `docs/linux-systemd.md`                  | Modify                                         | Add target-host proc/netlink qualification, service-context feasibility, observation soak, automatic timed canary, status interpretation, empty-fleet/emergency rollback                      |
| `docs/linux-release-manager.md`          | Modify narrowly                                | State API service config path, helper unchanged, per-host activity qualification, restart/rollback ordering; do not rewrite release-manager lifecycle                                         |
| `docs/code-standards.md`                 | Modify                                         | Add activity module ownership, bounded parser/socket rules, monotonic revisions, no blocking work under manager lock, fake-only automated suspend tests                                       |
| `docs/codebase-summary.md`               | Modify                                         | Update module map and current behavior only after implementation; list actual activity files and test surfaces                                                                                |
| `docs/project-overview-pdr.md`           | Modify                                         | Add the configured-agent policy requirement and acceptance facts without rewriting completed historical PR-015 claims as if they covered it                                                   |
| `docs/project-roadmap.md`                | Modify                                         | Add this eight-phase enhancement with factual status/evidence; preserve historical completed plans                                                                                            |
| `docs/README.md`                         | Modify narrowly                                | Update idle-suspend index summary/links if anchors change                                                                                                                                     |
| `README.md`                              | Modify narrowly                                | Mention two automatic policies and link canonical detailed guidance; no large duplicated runbook                                                                                              |
| `docs/CHANGELOG.md`                      | Modify last                                    | Record delivered behavior and exact executed evidence only after gates; no projected counts or canary claim                                                                                   |
| `scripts/run-uat.sh`                     | Review; modify embedded example only if needed | Keep `/tmp/dam-hopper-uat/dam-hopper.toml` safe/default-off and explicit `empty-fleet`; never auto-enable activity policy or helper                                                           |
| `deploy/reset-linux-production.sh`       | Review; normally unchanged                     | Confirm broad disenrollment still disables automation and preserves RTC/audits; activity rollback uses TOML + API restart instead                                                             |

Across this inventory, include the warning DTO and strict new-server decoder contract in the API guide; continuous duration and status-only soak in configuration/systemd guidance; safe-identity bounds and forbidden channels in security guidance; and the delivered warning behavior in the final changelog. Preserve the 900-second default everywhere.

Exact operator path references that docs must agree on:

- Direct/source default: `~/.config/dam-hopper/dam-hopper.toml`.
- Explicit direct/source override: `--config <path>` or `DAM_HOPPER_CONFIG`.
- Release-manager/systemd: `/etc/dam-hopper/dam-hopper.toml`, as passed by `deploy/systemd/dam-hopper-api.service{,.in}`.
- UAT default generated by existing runner: `/tmp/dam-hopper-uat/dam-hopper.toml`.
- Protected status: `GET /api/system/idle-suspend/v1/status`.
- Timing-only mutation: `PATCH /api/system/idle-suspend/v1/timing`.
- Existing helper status/socket: `dam-hopper status --json`, `dam-hopper-idle-suspend-helper.service`, `/run/dam-hopper/idle-suspend.sock`.
- Existing server/root audits: `idle-suspend-audit.jsonl` adjacent to canonical server config directory and `/var/log/dam-hopper/idle-suspend-helper.jsonl`; never publish contents in rollout evidence.

Do not add a new docs file, operator daemon, telemetry collector, migration utility, matcher editor, or rollout script. Reuse the existing guides and manual restart/rollback paths.

## Implementation Steps

1. Receive Phase 07's sanitized evidence and unresolved feasibility facts. Mark each automatic, browser, live observer, and operator-only canary gate separately; do not collapse “tests passed” into “host suspend qualified.”
2. Update `docs/system-architecture.md` first. Replace its current “planned enhancement” section with actual file/symbol ownership and the implemented dataflow: restored PTYs -> observer/coordinator start -> scheduled/fresh sample -> ticketed manager claim -> existing executor -> baseline reconciliation -> bounded shutdown.
3. Update `docs/api-reference.md` with the exact additive DTO. Include all measurement/reason enums, nullable counts/timestamps, `tcp4-tcp6`, `activity: null` only for empty-fleet, old-server omission handling, no-store auth, and revision-hint behavior. State prohibited private data explicitly.
4. Update `docs/configuration-guide.md` with the safe example above, executable validation, matching semantics, config locations, startup authority, restart requirement, observation-only stage, automatic enablement stage, and policy rollback. Keep timing PATCH and manual execution separate.
5. Update `docs/terminal-idle-suspend-security.md` with unprivileged `/proc` and NETLINK_SOCK_DIAG boundaries, namespace/TCP limitations, fail-closed behavior, private evidence retention, final race, service-only consequence, and no automatic forced claim.
6. Extend `docs/linux-systemd.md` section 11 with target-host prerequisite commands/procedures from Phase 07, protected status interpretation, observe-only soak, approved bounded automatic canary, stop criteria, and two rollback levels. Do not duplicate the existing manual indefinite-sleep canary or weaken its approval.
7. Update `docs/linux-release-manager.md` narrowly: existing systemd helper lifecycle is unchanged; config change requires API restart; every target host needs observer qualification. Keep `/etc/dam-hopper/dam-hopper.toml` and service names exact.
8. Update `docs/code-standards.md` and `docs/codebase-summary.md` from the final implementation, not planned filenames that drifted. Include hard limits, private type boundaries, no command/content logging, direct netlink only, and test/fake conventions.
9. Update product/history surfaces: add a new enhancement record to `docs/project-overview-pdr.md` and `docs/project-roadmap.md`; do not rewrite historical completed idle-suspend work or claim it previously supplied activity eligibility.
10. Update `docs/README.md` and root `README.md` only enough to route readers to the canonical configuration/security/systemd/API guides. Keep detailed policy/reason tables in one place to avoid drift.
11. Review `scripts/run-uat.sh` embedded config. If explicit new fields are added, keep `enabled = false` and `automatic_policy = "empty-fleet"`; never make a developer UAT start eligible for suspend. Review `deploy/reset-linux-production.sh`; change only if implementation altered a referenced key/path, otherwise document it as broad disenrollment.
12. Search the exact docs/assets above for stale claims: “zero active terminals” as universal policy, “read-only” status without activity fields, all-agents-finished language, generic network coverage, matcher runtime mutation, or automatic retry. Preserve statements that are still correct for `empty-fleet` or manual behavior by qualifying rather than deleting history.
13. Prepare the release-dark record. Verify old config selects `empty-fleet`; record Phase 07 commands/results; deploy without changing target config; compare protected status and existing automatic behavior before any opt-in.
14. Run observation-only canary on one approved Linux host: back up the active registry, set `enabled = false` and `automatic_policy = "agent-activity"`, set exact agent entries, restart API, and exercise representative workloads. Do not use timing PATCH/full-config/UI to mutate startup policy.
15. Run the target-host direct proc/netlink smoke under the service user/context and observe at least one full quiet window without automatic action. Record only sanitized reason/count/timing outcomes. Repeated unavailable or over-budget samples are a no-go, not a reason to lower limits or add a fallback.
16. Obtain Security/Operations approval for one automatic canary. Confirm helper/socket/capability, exclusive empty RTC alarm, no inhibitors, database-backed auth, physical/out-of-band recovery, bounded `wake_after_seconds`, rollback owner, and no existing handoff.
17. Enable with one startup edit/restart, generate one genuine activity epoch, then allow one bounded automatic attempt. Verify resume, exact one request/audit chain, handoff release, PTY/process baseline reconciliation, spent epoch, and no retry while unchanged. Never automate, retry ambiguity, or use indefinite sleep for this gate.
18. On success, expand one host at a time with the same gates. On any stop criterion, execute rollback below before further analysis.
19. Roll back activity mode: resolve any active handoff; edit `automatic_policy = "empty-fleet"` (and `enabled = false` for emergency disable); restart API; refetch protected status; verify `activity: null` under empty-fleet and existing manual action/helper status unchanged. Use full reset only for complete disenrollment.
20. After smoke proof only, perform cleanup: stop UAT with `./scripts/run-uat.sh stop`; terminate/remove only fixture-owned PTYs, sockets, child processes, custom UAT config/env/evidence, and temporary directories; remove throwaway scripts/binaries not retained as valuable tests; preserve audit and canary evidence per policy; do not delete unrelated `/tmp/dam-hopper-uat` content or foreign RTC state.
21. Update `docs/CHANGELOG.md` last with exact observed test counts/commands, live observer host result, and canary status. If canary deferred, state deferred; never write “passed” by inference. Run docs/link/style validation through the parent integration owner only after all docs settle.
22. Fold the exact warning contract and privacy exception into every relevant guide above, not an overriding appendix. Use synthetic PID/identity examples with null/empty/truncated cases; explicitly distinguish warning duration from automatic countdown and examples from exhaustive blockers.
23. Before enabling the canary, complete the warning-specific observation-only scenarios in requirement 43 and Phase07 Q45–Q52. Record sanitized results only; missing attribution must remain honest, and any argument leak, stale PID, misleading duration or warning-driven authority change is a no-go.

Future documentation/release verification commands from repository root; run only after implementation and docs integrate:

```sh
./scripts/verify-idle-suspend-boundary.sh
cargo test --manifest-path server/Cargo.toml --test idle_suspend
pnpm --filter @dam-hopper/ui test:browser -- idle-suspend-settings-status.browser.tsx
pnpm test:all
pnpm check
./scripts/run-uat.sh status
cargo run --manifest-path server/Cargo.toml --bin dam-hopper -- status --json
```

Target-host read-only/qualification inspection, never an automated suspend sequence:

```sh
dam-hopper status --json
systemctl status dam-hopper-api.service dam-hopper-idle-suspend-helper.service
journalctl -u dam-hopper-api.service --no-tail
journalctl -u dam-hopper-idle-suspend-helper.service --no-tail
test -S /run/dam-hopper/idle-suspend.sock
cargo test --manifest-path server/Cargo.toml --test idle_suspend activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
```

The Cargo live-smoke command runs from a source checkout on a designated qualification host. Its canonical integration location is `server/tests/idle_suspend.rs`; private parser/observer scenarios stay inside library test modules. Record the actual executed test name and counts, not an alternative command that never ran. No command here calls suspend. The bounded automatic canary remains a prose Operations procedure with explicit approval, not a script.

Rollback procedure to document exactly for a systemd release:

1. Refetch protected status and ensure no `finalCheck`/`handedOff`/active handoff. If active, reconcile outcome first; do not race restart against accepted execution.
2. Back up `/etc/dam-hopper/dam-hopper.toml` with owner/mode preserved.
3. Set `automatic_policy = "empty-fleet"`; for emergency disable also set `enabled = false`.
4. Run `sudo systemctl restart dam-hopper-api.service`.
5. Refetch status. Require `automaticPolicy = "empty-fleet"`; require `activity = null`; when disabled require coordinator state `disabled`.
6. Verify ordinary PTYs, protected API, helper status, and manual force confirmation remain as before. Empty-fleet automatic behavior resumes only if `enabled = true`.
7. If complete feature/helper disenrollment is approved, run `./deploy/reset-linux-production.sh --dry-run`, review, then existing root reset procedure. Preserve audits and any foreign RTC alarm.

## Todo list

- [x] Receive and classify Phase 07 automated, Chromium, live observer, and canary evidence.
- [x] Update architecture from planned to implemented dataflow.
- [x] Update protected API/status/revision compatibility contract.
- [x] Update exact TOML fields, validation, paths, restart, and examples.
- [x] Update security/privacy/fail-closed and polling/TCP/mixed-session limits.
- [x] Extend systemd host qualification, observation soak, canary, and rollback runbook.
- [x] Update release manager guidance without changing helper lifecycle.
- [x] Update code standards and codebase module/test map from actual files.
- [x] Add new product/roadmap entry without rewriting historical completion.
- [x] Refresh docs/root indexes with minimal links.
- [x] Keep UAT embedded config default-off/empty-fleet.
- [x] Review broad reset asset; avoid unnecessary change.
- [x] Complete release-dark compatibility check.
- [x] Complete one-host observation-only soak and direct observer qualification.
- [x] Obtain Security/Operations approval before automatic canary.
- [x] Complete or explicitly defer bounded automatic canary with factual record.
- [x] Rehearse `agent-activity` -> `empty-fleet` rollback and emergency disable.
- [x] Perform fixture/UAT/throwaway cleanup only after smoke proof.
- [x] Update changelog last with exact observed results only.
- [x] Document exact warning shape, continuous duration, safe examples and narrow privacy exception.
- [x] Qualify warning transitions and redaction during disabled-observer soak before enablement.

## Success Criteria

- All listed docs agree on two policies, startup ownership, exact default/list validation, timing boundaries, status fields, epoch behavior, and restart requirement.
- Existing installations remain `empty-fleet` unless explicitly edited. UAT and examples remain `enabled = false`; no script or UI silently opts in.
- Production, direct-run, and UAT config paths are distinct and correct. Operator instructions do not edit the wrong registry.
- Docs never call quiet “finished,” never market TCP as all networking, and explicitly cover polling, detached descendant, UDP/QUIC, namespace, AF_UNIX/proxy, mixed-terminal, and final-race limitations.
- Status guide makes `unknown != 0`, `activity state != coordinator state`, `sampledAtMs != scheduler time`, and `tcp4-tcp6 != proof of completeness` unambiguous.
- No new telemetry endpoint/high-cardinality metric/log is introduced. Existing protected status, meaningful WS hints, journals, and private audits are the operator surfaces.
- Observation-only rollout proves representative service-only, recognized-agent, mixed, input, TCP, idle, restore, and reconciliation behavior while automatic execution is disabled.
- Every enabled host passes direct proc/netlink/service-context and bounded shutdown qualification. Unsupported hosts stay on `empty-fleet` or disabled.
- First automatic canary has explicit owner, bounded wake, recovery path, one request, complete audit/status reconciliation, no duplicate epoch attempt, and a recorded pass—or remains explicitly deferred.
- Rollback to `empty-fleet` is rehearsed and verified via protected status. Emergency disable and complete helper reset remain distinct procedures.
- Cleanup removes only test-owned artifacts after smoke proof; audits, useful regression tests, unrelated UAT data, processes, and foreign RTC state are preserved.
- Changelog and roadmap cite only observed command/results. Pending or unavailable facts remain labeled.
- All guides agree on the warning's nullability, reason set, 32-example/256-byte bounds, truncation, current identity and continuous interval semantics. Safe synthetic examples contain no arguments; protected UI alone exposes operational PID/safe identity.
- Observation-only soak proves warning cases without automatic calls, warning-driven polling, force-count changes or process-detail leakage. Missing/misleading reports block enablement; the quiet default stays 900 seconds.

## Risk Assessment

| Risk                                                   | Impact   | Mitigation / rollback                                                                             |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| Upgrade silently changes already-enabled hosts         | Critical | Default/omission `empty-fleet`; release-dark compatibility gate                                   |
| Operator edits inactive registry or expects hot reload | High     | Document direct/systemd/UAT paths and startup restart requirement                                 |
| `available/quiet` interpreted as agent completion      | Critical | Heuristic warning in API/config/UI/security/runbook; operator reason guide                        |
| `tcp4-tcp6` interpreted as universal coverage          | Critical | Explicit UDP/namespace/AF_UNIX/proxy limitations; unsupported blocks                              |
| Service-only workload suspended unexpectedly           | Critical | Explicit policy consequence, observation-only soak, one-host canary, instant empty-fleet rollback |
| Noisy mixed terminal never sleeps                      | Medium   | Document conservative false-busy; do not add writer classifier                                    |
| Proc/netlink unsupported or too slow under systemd     | High     | Per-host live smoke and one-second/join gate; remain empty-fleet                                  |
| Config rollback races accepted handoff                 | Critical | Status check/reconciliation before restart; config edit is not cancellation                       |
| New heartbeat telemetry overloads UI/journal           | Medium   | Meaningful revisions only; no new telemetry backend or sample logging                             |
| Changelog overstates evidence                          | High     | Update last from executed records; separate automated/live/canary status                          |
| Cleanup damages user/UAT/audit state                   | High     | Ownership inventory; remove only fixture artifacts; preserve audits/RTC                           |
| Cohort assumes identical kernel/proc policy            | High     | Repeat target-host qualification per host/kernel/service context                                  |

## Security Considerations

- Matcher configuration is operator-owned startup data, not a browser mutation surface. Reject patterns, shells, generic interpreters, and runtime expansion; docs must not show unsafe workarounds.
- Only authenticated/no-store warning status/UI exposes bounded current PID and safe identity. Command arguments, full matcher lists, terminal/root/start/socket IDs, addresses, bytes, tokens and env remain excluded. Screenshots, support bundles, changelog/examples and rollout records use synthetic/redacted identities; logs, audits, telemetry and WebSocket hints contain no warning process details.
- Observation uses current-namespace unprivileged procfs and kernel diagnostics only. Do not grant root, broad capabilities, host network telemetry, eBPF, cgroups, or shell-tool execution to make a host pass.
- Automatic eligibility still passes existing helper capability, peer, inhibitor, RTC ownership, audit, lifecycle, and handoff checks. Manual force remains authenticated and confirmed; agent policy never provides a bypass.
- Status remains protected and no-store. An activity reason is operational metadata; avoid exposing workload identity through added per-terminal details.
- Rollout evidence is sanitized and access-controlled. Preserve server/helper audits with current permissions and retention; never paste their raw contents into public docs.
- An automatic canary can interrupt open service-only terminals and silent agent work by design. Require host owner consent, maintenance window, bounded wake, out-of-band recovery, and immediate rollback authority.
- Full reset preserves foreign RTC alarms and unrelated systemd assets. Policy rollback should not touch RTC or helper assets at all.
- Use the fixed canonical ignored smoke `server/tests/idle_suspend.rs::activity_live_linux_pty_tcp_smoke`; do not invent a second integration target.

## Next steps

1. After Phase 07 hands off evidence, synchronize all listed docs in one review and run the parent integration gates once.
2. Ship the implementation dark under `empty-fleet`; schedule observation-only qualification separately from automatic canary approval.
3. Maintain a per-host rollout record containing version, startup policy, sanitized target capability, result/reason trends, canary decision, and rollback owner—no private process/network data.
4. If a host cannot meet proc/netlink/budget/join requirements, close its rollout as unsupported and keep `empty-fleet`; do not open a fallback implementation in this plan.

## Unresolved questions

- Which production host, Operations owner, maintenance window, and physical/out-of-band recovery path will own the observation soak and first bounded automatic canary?
- What sanitized retention location and approval record will Operations use for per-host qualification evidence? Reuse an existing restricted release record if available; do not add a product telemetry store.
- Do representative production agents use UDP/QUIC, separate network namespaces, or local/external proxy delegation often enough that `agent-activity` will remain unavailable/incomplete? Measure during observation-only soak; do not infer or broaden transport scope.
- Can the deployed API service context consistently complete and truly join proc/netlink sampling within one second on every candidate kernel? A timeout that leaves blocking work alive is a rollout blocker.
