# Planning review — configured-agent activity idle suspend

Date: 2026-09-10. Deliverable: implementation plan only. Application implementation and every implementation checklist remain pending.

## Scope and provenance

- New [enhancement plan](../plan.md), not a rewrite of the completed original terminal idle-suspend plan.
- Followed the loaded hard-planning workflow and planning skill: source scoping, architecture-first design-only note, independent phase authors, parent contract integration, then document validation.
- Existing approved output/network heuristic retained. No hooks, CPU classifier, proxy, eBPF/cgroup privileges, service classifier or semantic-completion claim introduced.
- Source claims are supported by [repository findings](../research/repository-findings.md) and targeted source reads. The prior loopback TCP experiment is historical feasibility evidence, not a new Rust implementation test.

## Contract review decisions

1. **Safe upgrade default:** old configs remain `empty-fleet`; `agent-activity` requires explicit startup opt-in. Actual live counts and manual force confirmation are preserved.
2. **Authority coverage:** schema, manual TOML serialization, full-config preservation, settings/config reload and workspace activation must migrate together. The bounded timing endpoint gains no matcher/policy authority.
3. **PTY evidence:** raw per-incarnation counters, actual child PID/start identity, input-before-write revision, shared handoff gate; no terminal contents or foreground-PGID shortcut.
4. **Dependency correction:** Phase02 owns the minimum shared process-stat parser and IDs so Phase03 can consume them without a Phase02↔03 cycle. Phase01 owns the compiled literal `AgentExecutableSet`.
5. **Ownership correction:** Phase03 alone owns the initial activity module root; Phase04 supplies network module declarations. Phase05 takes integration ownership afterward and owns all backend status DTO constructors; Phase06 owns client/display.
6. **Recovery correction:** retained discovered lineage and terminal output handles must survive root removal and qualification invalidation. Rebuilt baselines/re-discovery do not create a new post-attempt epoch.
7. **Disabled qualification:** agent policy runs its observer even while automatic enablement is false, but remains Disabled with no countdown or automatic executor call. No new dry-run endpoint/switch.
8. **Timing honesty:** one second is a sample acceptance deadline. A timeout cannot forcibly cancel a kernel-stalled procfs syscall. One cooperative worker, no overlap/detach, and join before PTY teardown; target-host latency is qualified separately.
9. **Race honesty:** final tickets fence server-admitted input/lifecycle and observed counters/revisions. They do not atomically prevent future autonomous process/network activity or expose every same-image exec event.
10. **Test visibility:** private scripted observer/ticket tests remain library tests. External integration tests exercise public coordinator/status and real observation with fake suspend execution; no public identity exposure merely to make a test compile.
11. **Verification completeness:** qualification matrix covers config, identity, raw output/input, owned transport, mixed/service-only behavior, freshness, timing/manual/epoch races, restore/shutdown, auth/privacy, browser surface and disabled observation. Actual suspend is operator-only, never automated.
12. **Path corrections:** canonical serializer is `server_to_toml`, raw reader is `reader_thread`, timing persistence is `timing_store.rs`; existing client test filename was not invented. New narrow decoder coverage is explicitly identified if used.
13. **Inter-sample output correction:** compare current raw start/end to the previous accepted end for the same incarnation/Arc; start-versus-end alone misses output between polls. Commit process, TCP and raw checkpoints together; preserve genuine retained-counter increases through recovery. Phase05 names the explicit regression.
14. **Validation folded into phases:** each phase now carries its validated requirements inline: bounded attributable warning evidence, continuous blocked duration, exact authenticated DTO, safe UI display and privacy/qualification cases. The former amendment is a decision reference, not a precedence rule. Source/eligibility identities remain private except the explicitly permitted warning PID/safe executable projection.

## Document verification

- Document checks cover all 14 plan artifacts/eight phase files: local links/anchors, section order, pending checklists, frontmatter, code fences and matching phase/overview estimates.
- Each phase estimate directly includes validated warning work. The eight estimates sum to 111h; no additional amendment surcharge. Canonical overview remains under 80 lines.
- Formatting uses repository Prettier on this plan directory only. Application tests/builds and real suspend were not run: this deliverable changes planning documentation, not runtime behavior.

## Session registration

The activation script initially had no `EVCRATE_SESSION_ID`. Resumed registration supplied the actual UUID from `PI_SESSION_FILE`; the script returned `Active plan set to: plans/260910-1604-agent-activity-idle-suspend`. Explicit plan paths remain in worker handoffs.

Interrupted workers could not resume execution through parked-peer revival; replacement workers were assigned the two unfinished independent slices with original histories and current contracts. Existing completed drafts were retained and reviewed.

## Remaining qualification facts

- Required procfs/diagnostic access and TCP_INFO fields under each deployed service sandbox.
- Actual sample and shutdown/join latency on each supported host.
- Workload dependence on UDP/QUIC, network namespaces or external UNIX/proxy delegation.
- Operator, maintenance window and recovery path for an optional bounded real-suspend canary.

These facts gate deployment opt-in, not permission to fabricate zero activity or weaken the agreed heuristic.

## Unresolved questions

Validation interview completed: user confirmed 15-minute default and explicit mode selection; requested blocked-measurement warnings with PID, duration and executable identity without arguments. The shared contract and all phases incorporate those decisions directly. The [decision reference](../warning-report-contract.md) records integrated ownership only; implementers need no amendment merge or phase rewrite. No unresolved product decision; application implementation has not started.
