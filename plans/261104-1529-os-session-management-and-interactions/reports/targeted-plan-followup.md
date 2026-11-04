# Targeted independent plan follow-up

Status: **COMPLETE** — assigned targeted review complete; **one unresolved medium design-coverage defect**. Not implementation readiness, runtime/user approval or permission to code. Initial independent report unchanged.

`P/` = `plans/261104-1529-os-session-management-and-interactions/`; source paths repository-relative.

## Material finding

### M2 — Medium: cancellation fencing omits the supervisor's pre-reservation validation-failure path

**Plan:** `P/architecture-contracts.md:29-32`; `P/phase-02-backend-guard.md:19-23`; `P/acceptance-matrix.md:33-36`. Cancellation must win before reservation and retain an observable exact completion marker. The concrete admission checks/tests cover queue receipt, timer wake, reservation and publication, but do not fence failure finalization after asynchronous target validation. The broad stale-command no-op requirement does not specify this bypass or its deterministic oracle.

**Source:** `server/src/pty/manager.rs:3597-3607,3645-3647` awaits target validation before reservation. On failure, `:3678-3697` records `TerminalFinalExit` before calling the state helper. `finish_respawn_source_failure` at `:3775-3795` checks pending replacement and incarnation only, then mutates the tombstone and persists dead/target-unavailable state. Neither boundary checks restart cancellation. Target-loss classification includes unavailable/unregistered targets at `:3751-3759`. Cancellation leaves the same source tombstone in place, so these existing checks do not exclude it.

**Concrete failure [INFERENCE from source ordering]:** supervisor passes its wake check, awaits target validation; exact pending End then wins, clears fleet pending and records cancellation; validation resumes with target-loss error. No reservation check executes. The old failure path emits an authoritative workflow event and marks/persists the cancelled tombstone target-unavailable. P02:21 gives target-unavailable precedence as `unavailable`, so a lost cancellation response can no longer reconcile from the required retained `restartCancelled` observation, despite the tombstone still existing. Even non-target errors produce stale workflow/persistence effects rather than the promised no-op.

**Confidence:** high in the source interleaving; medium in implementation risk because the broad no-op contract could lead an implementer to discover and repair it. This is an omitted explicit transition boundary/test, not a claim that future implementation has already failed.

**Minimal correction:** within the already-owned manager domain task, explicitly fence *all pre-reservation supervisor failure effects* against exact still-active restart ownership under the existing lock order. A cancelled/superseded command must produce no tombstone/persistence/target-unavailable/workflow effects; gate `TerminalFinalExit` on an accepted failure transition rather than emitting it first. Do not reuse admission's consumed-pending requirement for post-reservation publication/failure handling. Add a deterministic barrier test: pause asynchronous target validation, accept exact cancellation, release validation with target-loss error, assert unchanged cancellation marker/projection/history and no stale persistence/workflow effects. Propagate that case to P08/acceptance; no new scheduler, protocol, files or product choice needed.

## Targeted coverage and resolved surfaces

- **V1 / ownership:** `P/plan.md:23-40`, `P/phase-04-session-hub-review-ui.md:7,48-55`, `P/execution-ownership.md:9-29,54-56`. All-G1 barrier precedes P04; P07 sole integration owner. Manually compared G1 and the two P06 allowlists: no concurrent writable overlap. Fleet exact pending/creating read predicates and existing exact cancel are assigned narrowly to BackendOwner; no parallel source owner introduced.
- **V2 / main reservation path:** `P/architecture-contracts.md:28-34`, `P/phase-02-backend-guard.md:16-23,28-37`. Exact cancellation before reservation, reservation-first zero-effect refusal, stale queued/timer no-op, normal respawn publication and later same-ID create are explicit. Publication correctly does not require consumed fleet pending. Source support: `manager.rs:827-845,4302-4387,4554-4608`; `fleet_state.rs:111-125,268-308`. M2 is the remaining bypass, not a rejection of this predicate split.
- **Marker lifetime / future create:** P02:19 requires runtime-only exact tombstone marker, initialized in every constructor, naturally retired only with that tombstone; forbids raw-ID killed suppression. Source: `session.rs:329-408`, `manager.rs:1491-1559,1712-1748`. Required later same-ID create/non-regression probes assigned. No extra constructor ownership gap found.
- **200 vs 202 / operation origin / Close:** `P/phase-01-shared-contracts.md:20-25,29`, P03:16-19,24-28, P04:18-21, P07:27-28, acceptance:16,31,35-36. Pending `alive:false` still gets Close/End/Cancel; exact 200 cancellation completes immediately; pending response loss requires matching cancellation marker, never ordinary exit/absence. Live 202/loss requires exact observed exit. Wrong origin/status/outcome stays unresolved; no retry/retarget or close-on-202.
- **V3 / exact inventory:** P01:18-26, P02:21,30-31, P03:15-19, acceptance:28-29. Both array projections retain numeric/detail compatibility and add flat exact string/state from one manager snapshot with original epoch headers. Max-u64 exact remains eligible despite unsafe legacy number; malformed/missing exact never downgrades; safe disagreement refuses. Current projection seams inspected: `api/terminal.rs:327-336`, `manager.rs:2445-2449,2622-2637`, UI `api/ws-transport.ts:3156-3204`, `api/client.ts:194-220`, `hooks/use-aggregated-terminal-sessions.ts:54-116`. Source not claimed already compliant.
- **Unsafe downstream joins:** P03:25, P04:15,26-30, P07:17-18,22,33; acceptance:37. Exact strings survive hosts/claims; numeric agent/port/replay proof must be positive-safe and losslessly equal, else unavailable/input disabled/unproven content withheld. Valid inventory End remains independent. Source numeric boundaries inspected: UI `os/agent-hub.ts:283-342`, `hooks/use-ports.ts:46-62,194-195,242-262`, `lib/terminal-buffer-replay.ts:8-14,21-52`; Status string contract `api/session-changes-types.ts:121-136`.
- **M1 resolved at design level:** P08:24-33,94-185 and ownership:83 now retain **68 unique literal PNG destinations**: lifecycle 13, recipes 9, cutover 13, session-management 33; equivalently 64 state/size/zoom checkpoints + four primary images. All six named shell surfaces have four distinct destinations; no cross-state filename reuse. Each of four cases has one dedicated publishing test/session, explicit primary capture and complete manifest; missing/duplicate/overwritten checkpoints block human packet. Source helper `e2e/fixtures/capture-evidence.ts:31-68,147-159,237-309` still deterministically replaces filenames/manifests; fixture `application-fixture.ts:31-50` finalizes once per test. Revised ownership matches that behavior without helper edits or predecessor overwrites.
- **Documentation/qualification propagation:** P08:19-24,38-49 and P09:10,15-19 carry exact inventory, both operation origins, guard races/non-regression, unsafe downstream truthfulness and actual-human gate. M2 needs the additional failure-path case; no other material changed-surface contradiction identified.

## Inspected scope

- `README.md:1-122`; initial report `P/reports/independent-plan-review.md:1-76`; validation receipt `P/reports/validation-decisions.md:1-27`.
- Actual revised plan files: `P/plan.md:1-47`; `architecture-contracts.md:1-65`; P01:1-69; P02:1-100; P03:1-105; P04:1-110; P07:1-128; P08:1-217; P09:1-64; `execution-ownership.md:1-86`; `acceptance-matrix.md:1-49`. Long changed contract lines reread untruncated.
- P05:36-68 and P06:43-109 inspected for ownership comparison only; their unchanged behavioral design intentionally not re-reviewed.
- Additional relevant source inspected: `manager.rs:780-870,3090-3310,3530-3749,3763-3895`; `session.rs:245-408`; capture helper:1-180,220-317; `e2e/os-lifecycle/os-lifecycle.spec.ts:1-185`. Exact targeted source ranges supporting conclusions listed above.
- Published planning plan-review reference, code-review skill, AGENTS and development rules read directly. Advisor consulted to challenge conclusion; findings remain grounded in the cited plan/source, not Advisor assertions.

## Checks and exclusions

Performed: read-only document/source inspection, targeted symbol searches, manual transition/ownership comparison and literal capture-matrix reconciliation. Only this assigned report written; no initial-report, source, plan or task-state changes.

Not run: builds, compilation/typechecks, tests, lint, formatters, Git, official plan parser, task hydration, server/browser/PTy execution, authenticated-app capture, native-host qualification, external research, nested agents or user interview/validation. No runtime pass, image existence, process behavior or actual human acceptance claimed.

Excluded: broad re-review, unchanged P05/P06 behaviors, unrelated predecessor repairs, Android, new product choices and protocol/runtime/executor redesign. Future execution prerequisites remain pending; they are not fabricated planning failures.

## Unresolved evidence

M2 requires coordinator disposition and explicit plan coverage. Official structural/final reconciliation and future real signal/wait/race/response-loss/input/capture/human evidence remain unexecuted. This is the final allowed targeted independent follow-up, not approval of current code or authorization to implement.
