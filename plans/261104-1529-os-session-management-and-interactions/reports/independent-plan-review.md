# Independent plan review

Status: **COMPLETE** — plan review complete; one execution-contract issue identified. Not implementation approval, runtime qualification or final user validation.

Canonical overview: `/home/loidinh/WS/dam-hopper/plans/261104-1529-os-session-management-and-interactions/plan.md`.
Below, `P/` means `plans/261104-1529-os-session-management-and-interactions/` relative to repository root.

## Scope and inspected evidence

All requested plan surfaces inspected; no selected phase excluded:
- `P/plan.md:1-42`.
- `P/phase-01-shared-contracts.md:1-69`.
- `P/phase-02-backend-guard.md:1-96`.
- `P/phase-03-client-observation-actions.md:1-105`.
- `P/phase-04-session-hub-review-ui.md:1-110`.
- `P/phase-05-recipe-capture.md:1-68`.
- `P/phase-06-shell-interactions.md:1-109`.
- `P/phase-07-sequential-integration.md:1-128`.
- `P/phase-08-integrated-qualification.md:1-158`.
- `P/phase-09-documentation-handoff.md:1-64`.
- `P/architecture-contracts.md:1-62`; `P/execution-ownership.md:1-83`; `P/acceptance-matrix.md:1-47`.
- `P/reports/planning-intake.md:1-43`; `P/reports/session-contract-evidence.md:1-69`; `P/reports/recipe-interaction-evidence.md:1-69`.
- `plans/reports/brainstorm-261104-1231-os-session-management-and-interactions.md:1-224`.

Supporting repository inspection, limited to consequential mechanisms/callers:
- `README.md:1-122`; `docs/project-overview-pdr.md:1-100`; `docs/code-standards.md:1-120`.
- `server/src/pty/session.rs:199-310`.
- `server/src/pty/manager.rs:628-720,1491-1555,1712-1755,3090-3310,3314-3455,4302-4355`.
- `server/src/api/terminal.rs:315-400`.
- `packages/ui/src/api/queries.ts:1084-1130`; `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts:1-118`.
- `packages/ui/src/api/session-changes-queries.ts:1-260`; `packages/ui/src/api/session-changes-types.ts:108-136` (targeted search).
- `packages/ui/src/os/apps/TerminalsApp.tsx:1-167`.
- Destructive-call search across `packages/ui/src`: `api/client.ts:3352-3353`, `api/ws-transport.ts:748-757`, `hooks/use-ports.ts:403-415`, `hooks/use-terminal-manager.ts:717-738,1077-1081,1134-1138,1182-1186,1528-1556`, `os/apps/SystemMonitorApp.tsx:415-428`.
- Lifecycle/diagnostic boundary search: `components/organisms/TerminalPanel.tsx:302,634-650,952-1014`, `lib/terminal-buffer-replay.ts:45-48`, `api/ws-transport.ts:2058-2059,2508-2512,2987-2991,3046-3073`; `lib/diagnostics-client.ts:387-408` (all under `packages/ui/src/`).
- `packages/ui/package.json:1-76`; `packages/ui/playwright.config.ts:1-69`.
- `packages/ui/e2e/fixtures/application-fixture.ts:1-84`; `packages/ui/e2e/fixtures/capture-evidence.ts:1-317`; `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:1-185`.

Policies read directly: published planning skill/plan-review reference, code-review skill, primary workflow, development rules and AGENTS guidance. Local `.omp` absent. No automatic skill-activation claim.

## Material finding

### M1 — Medium: exhaustive capture allowlist cannot retain the required visual checkpoint matrix

**Confidence: high.** Plan contract mismatch, not an observed runtime failure.

**Plan:** `P/acceptance-matrix.md:6,10` requires all named surfaces at both baseline sizes and zoom; the six surfaces are named at `P/phase-06-shell-interactions.md:15-18`. `P/phase-08-integrated-qualification.md:23-24,32,85-117` limits published captures to four case directories, each with only `screenshot.png`, `fhd.png`, `compact.png`, `fhd-zoom125.png`, `compact-zoom125.png`. `P/execution-ownership.md:3,80,83` makes those paths exhaustive and requires revision before additional writes.

**Source:** `packages/ui/e2e/fixtures/capture-evidence.ts:31-68,147-159` deterministically maps case/checkpoint to one filename; `:246-284,309` publishes those files and replaces the case manifest/review. It does not preserve a sequence of different states under one repeated checkpoint name.

**Failure/impact:** six named surface states across two sizes and two zoom levels require distinct retained evidence, before adding Close, Recipe, Review and gesture captures. Only 20 PNG destinations are permitted in total. The four shell nonmodal/palette states are intentionally mutually exclusive (`P/phase-01-shared-contracts.md:28`), so a single composite shell state cannot cover them. Reusing generic checkpoint names overwrites earlier evidence; adding surface-specific names violates the allowlist. Separate tests sharing a case directory also replace its `evidence.json`/`review.md`, rather than accumulating a complete receipt. Implementation can pass functional checks yet be unable to deliver the specified human-review packet within ownership authority.

**Smallest correction:** enumerate unique literal surface/state + viewport/zoom capture paths, or additional literal case directories, in P08 authoring instructions and execution allowlist. Define one evidence-session owner per case so its final manifest includes every required retained checkpoint; alternatively isolate cases per session. Preserve existing helper, predecessor artifacts and actual-human gate; no runner rewrite or relaxed acceptance needed.

## Requested design coverage / no additional material contradictions identified

- **Original inventory authority:** P01:17-25, P03:15-19 bind headers and rows before publication, preserve same-query array selectors, reject unsafe numeric incarnations, and forbid fresh-epoch blessing of old rows. Manager lifetime UUID is distinct from SessionChanges/AgentStatus epochs. Source manager allocator/pending state supports the documented correction to scout overclaims.
- **Atomic End:** P02:15-20 explicitly checks pending replacement before any side effect, signals captured live identity under selection boundary, records exact requested marker, retains live ownership, and requires successful exact reader wait before exit publication. Failure/lost response/backoff/replacement cases and no-op snapshots are named. Current best-effort shutdown and `wait().unwrap_or(0)` are acknowledged remediation targets, not accepted proof. No broad supervision rewrite required by the plan.
- **Web destructive/remove cutover:** observed caller search matches P03:24-28, P04:18-20 and P07:27-31. Remove-as-close and config-cleanup loops are explicitly eliminated; server DELETE compatibility is not a web fallback. Frame/list/pane/keyboard use one policy; programmatic layout cleanup never End.
- **Review:** P04:26-30 and P07:21,29 require complete originating generation, incarnation, capture, SessionChanges epoch, verified root/baseline; explicit refusal/Settings navigation; hidden-window retirement; late-result rejection; exact single-close cache scope preserving siblings. Existing optional-root/status-key behavior is explicitly assigned for correction, not silently treated as already exact.
- **Ownership/interface readiness:** all 16 durable task records inspected. G0 freezes wire/types before four G1 branches; P04 waits all G1; P07 serializes shared shell/frame/store/client transfer; P08 follows all writers; actual human gate precedes P09. Incomparable task allowlists are disjoint by inspection, including the two P06 tasks. External overlapping-plan handoff and changed-signature escalation are explicit. Capture-path completeness is the exception above; no executable parser claim.
- **Adoption vs reconnect:** P07:15-22 requires existing-only adoption, immutable target validation, no missing-session create fallback, replay incarnation checks and stable placement keys. Close/reopen is correctly distinct from same-xterm placement. Explicit fresh launch remains separate; Recipe F1 is not implicitly repaired/certified.
- **Recipe:** P05:15-22 covers stable selected source, canonical counted pairs/worktrees, sole/default vs mixed choice, offline/missing profiles, discovery revision fencing, every exclusion, no empty save/source mutation and value-bound command review. Executor/schema scope is restrained; AC8/F1 retained.
- **Input/focus/privacy:** P06:15-20 and P07:27-30 cover topmost nested portal dismissal, keyboard restoration, nonmodal outside-target preservation, modal backdrop consumption, immediate palette focus/trap, dirty save/discard/cancel and dispatched-state honesty. Actual Cognito/modal ownership and generic owner-bound stdin suppression are specified, not inferred from primitives.
- **Geometry/gestures:** P06:25-30 preserves float preference, explicit/restored/user bounds and shrink/widen topology through derived projection; deterministic 28px destination-canvas cascade; atomic maximize-to-mode transition; primary/noninteractive/4px-drag guards and privacy gesture abort.
- **Validation realism:** P08:16-23,29-40 names authenticated isolated services, actual xterm create/dispose/attach/replay/reset counters with nonempty baseline/truncation checks, real reconnect separately, physical raw-byte PTY sentinels, two sizes/zoom/repeats and actual human review. Existing scripts/config/fixture support the named check families; execution access/results remain unproven. M1 affects retained visual evidence, not these oracle requirements.
- **Authorization:** overview:12,37-42; intake:4,33-39; P09:19 keep final validation, hydration and implementation authorization with the parent/future caller. No such action authorized or performed by this review.

## Checks, exclusions and unresolved evidence

Performed: read-only plan/source inspection, targeted caller/boundary searches, manual ownership/DAG/contract comparison, Advisor challenge of finding formulation. Only this assigned report written; no plan/task/source changes.

Not run: builds, typechecks, tests, linters, formatters, browser/server/PTy execution, source compilation, Git commands, task hydration, plan parser or final user validation. No runtime/native-host/human acceptance claim.

Excluded intentionally: broad source/security audit, unrelated predecessor repairs, Android, producer/runtime/executor redesign, external research and nested agents. Supporting source reports treated as evidence and screened against corrective architecture, not runtime proof.

Unresolved: parent disposition/correction of M1. Future authenticated-container/browser availability, live Review data, platform signal/wait behavior, physical-input/counter outcomes and actual human acceptance remain execution prerequisites; not missing facts that justify implementation or a fabricated pass now.
