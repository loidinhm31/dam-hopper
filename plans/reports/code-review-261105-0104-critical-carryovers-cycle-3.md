# Critical carryovers — Code Review Cycle 3

## Score: 7/10 — changes required; technical qualification remains open

Risk-based review of Cycle 2 repairs and affected critical-carryover paths, not a full audit of the 89-file modified tree. No exploitable authentication bypass or data-loss vulnerability established. C4 is not qualified by the six reported green automated gates.

Source, tests, plan and task state unchanged. Only this report created. No TODO tracking or test/build/lint reruns; main/tester owns execution.

## Carryover disposition

| Carryover | Cycle 3 assessment |
|---|---|
| C1 — originating lifetime provenance | Inspected resolver and launch paths retain originating profile/generation/epoch and require matching exact inventory identity before authority adoption. No new blocker established in these paths. |
| C2 — presentation-independent actions | Cached snapshot identity repair remains sound on inspection. New regression catches identity reuse for reserve/outcome/reset, but does not prove mounted React behavior or complete immutable contents. Retained-feedback and retention warnings remain. |
| C3 — production TypeScript alignment | Latest tester reports both production and E2E typechecks passing. Mount-only Recipe profile configuration remains stale after configuration changes. |
| C4 — real input/lifecycle/termination/Review qualification | Incomplete. Fresh distinct input sentinels improve the oracle, but a new query API misuse and existing journey/capture gaps remain. No actual authenticated browser or human receipt established. |

## Critical issues / high acceptance blockers

**Critical security/data-loss issues: none established.** The following are **High qualification blockers**, not demonstrated production exploits.

### H1. New exit injection passes a function where TanStack requires a filter object

**High; high confidence; static diagnosis, not runtime reproduction.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:293-317`.

The replacement declares its own incompatible API:

```ts
setQueriesData: (
  predicate: (query: { queryKey: readonly unknown[] }) => boolean,
  updater: /* ... */,
) => void;
```

and calls:

```ts
qc.setQueriesData(
  (query) => Array.isArray(query.queryKey) && query.queryKey.includes("terminal-sessions"),
  /* updater */,
);
```

Actual `setQueriesData` accepts **`{ predicate: fn }`**, not `fn`. The lockfile resolves `@tanstack/query-core` to **5.91.2** (`pnpm-lock.yaml:4252-4254`). Its versioned implementation forwards the first argument to `QueryCache.findAll`; `findAll` returns every query when `Object.keys(filters).length === 0`. That is the result for this ordinary function, so the intended predicate is never called. The updater consequently touches every truthy cached value, spreading unrelated arrays/objects/primitives into an object with `sessions`; array-shaped query data can lose its expected shape. It also updates matching raw terminal IDs across owners rather than the captured lifetime alone.

Sources: [versioned QueryClient](https://unpkg.com/@tanstack/query-core@5.91.2/src/queryClient.ts), [versioned QueryCache](https://unpkg.com/@tanstack/query-core@5.91.2/src/queryCache.ts), [versioned QueryFilters](https://unpkg.com/@tanstack/query-core@5.91.2/src/utils.ts).

**Correction:** use the real `QueryClient` type, not an asserted substitute signature. For a narrow cache-integration test, update the exact captured owner key with `exact: true`, or supply a real filter object with a strictly scoped predicate. Require the client, existing observation and full target tuple to exist; preserve owner/epoch/incarnation and prove unrelated caches/sibling owners unchanged. Do not silently skip absent diagnostics. A correct injection is still not authoritative process evidence.

### H2. Termination and Review tests still substitute invented state for the required real journeys

**High; high confidence.** `os-session-management.spec.ts:35-84,249-322`; `packages/ui/e2e/fixtures/application-fixture.ts:54-65`.

- Termination fulfills a synthetic 202 instead of forwarding to the real endpoint, then injects an exited inventory row. Its title claims 202 versus 200 and origin-loss reconciliation, but there is no successful pending-origin 200 or either lost-response journey in this test.
- Review uses `profile=default`, fixed generation/terminal/epoch and invented Review metadata, although the fixture creates a UUID profile. It does not obtain an eligible complete tuple from the real server. Manually seeded cache entries cannot establish successful Review authorization or actual request retirement.

**Correction:** keep narrowly named cache integration regressions separate. Qualify live202 with a real request and exact exit, pending200, both origin-specific response-loss cases and their negative controls. Derive Review owner and eligible metadata from actual fixture/runtime evidence; assert actual readonly content, targeted retirement and sibling reads/cache preservation.

### H3. Capture filenames still do not establish their claimed states

**High; high confidence.** `os-session-management.spec.ts:324-424`; required matrix: `plans/261104-1529-os-session-management-and-interactions/phase-08-integrated-qualification.md:24-34`.

The base is labeled Eligible Review after only launching a terminal. Notifications capture does not require the surface to appear. Profiles and Settings explicitly capture a fallback when the trigger is absent. Unavailable Review navigation captures without asserting the intended unavailable explanation. Surface assertions, where present, precede the whole viewport/zoom loop rather than every checkpoint.

**Correction:** establish and assert the actual named state at each viewport/zoom before capture. Missing state must fail/report blocked, never produce a misleading receipt. Preserve the full 64-checkpoint plus four-primary matrix and separate actual human acceptance.

## Warnings

1. **Physical oracle improved, but still incomplete.** `os-session-management.spec.ts:108-208`: distinct awaited opening/closing hex sentinels now address the reused-barrier defect for four interactions. However, assertions inspect cumulative rendered text, not decoded exact output intervals, and never assert consumed Escape/modifier bytes absent. Notification Center, Profiles, Settings, nested Select/context menu and dirty confirmation are missing. TerminalPanel supports WebGL rendering (`TerminalPanel.tsx:366-377`; `terminal-renderer.ts:80-129`); DOM text is renderer-dependent. Read the known synthetic process output, verify exact sentinel intervals/control bytes and prove restoration per interaction, without recording arbitrary transcripts.
2. **New snapshot regression overclaims immutability/React coverage.** `terminal-session-action-coordinator.test.ts:169-188`: changed references are checked for reserve/outcome/reset, but no component/hook is mounted, reconciliation publication is omitted, and previous contents are not checked. `snapAfterReserve.get(targetA.terminalId)` is guaranteed undefined because keys are composite (`terminal-session-contract.ts:118-130`); that assertion cannot establish a correct snapshot. Assert actual composite-key values, stable reads between mutations, old snapshot contents and mounted consumer updates. Ports tests remain static markup (`PortsPanel.test.tsx:37-142`), not cancel/reopen token regressions.
3. **Continuity recorder still allows empty baselines and mixes owners.** `terminal-session-observation.ts:130-139,196-240,271-297,313-367`; `os-lifecycle.spec.ts:65-75`: missing diagnostics become empty arrays, a DOM token suffices, zero initial create/attach/replay and null epoch/incarnation can pass unchanged comparisons. Frame filtering uses raw ID despite storing socket indexes. Require positive initial lifecycle/completed replay, non-null exact identity, progressing synthetic output, owner/socket lifetime scope and diagnostic truncation/reset detection.
4. **Retained state has no safe production retirement path.** `terminal-session-action-coordinator.ts:22-29,75-85,123-157,184-188`; `terminal-close-context.tsx:73-81,203-210`: actions, tokens and close callbacks accumulate. Each notification copies the retained map; reconciliation scans retained actions against observations. Retire safely settled/unreferenced records and callbacks, preserving unresolved outcomes and late-token safety; do not add another registry/poller.
5. **Unknown feedback remains inaccessible after remount.** `PortsPanel.tsx:588-608`; `SystemMonitorApp.tsx:429-437,823-838`: explanations are reconstructed through an opener disabled for `outcomeUnknown`. Show retained reason/status independently of dispatch eligibility; duplicate End must stay disabled.
6. **Recipe profile configuration is mount-only.** `RecipeEditor.tsx:91-125`: `getProfiles()` is memoized with `[]`; new/removed profiles cannot update candidate eligibility while mounted. Reuse the existing profile-change subscription/version pattern (`use-aggregated-terminal-sessions.ts:39-45`).

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

- Remove or narrowly test-gate writable production `window.__DAM_HOPPER_QUERY_CLIENT__` (`apps/web/src/main.tsx:71-73`). This is unnecessary mutable diagnostic exposure, not proof of an authentication bypass.
- Keep the cached immutable publication pattern and exact target/attempt fencing. Avoid allocate-on-read snapshots, retries, new pollers or generic registry abstractions.
- Drop obsolete `unknown` migration props (`PortsPanel.tsx:196-197`) and unused in-flight set bookkeeping (`terminal-close-context.tsx:81,319-320`).
- Iterate the coordinator map directly instead of allocating `Array.from(entries())`; avoid duplicate full reconciliation in persistent root plus each presentation when existing observation ownership suffices.
- Document create-response epoch/capability headers (`server/src/api/terminal.rs:221-231`); API/changelog currently describe those additions for inventory GET only (`docs/api-reference.md:125-143`; `docs/CHANGELOG.md:5`).

## Positive observations

- Snapshot publication is centralized and getAllActions returns the cached snapshot; the added regression would catch the original map-identity defect for its exercised operations.
- Distinct awaited hex sentinels now provide fresh positive output barriers for each implemented interaction; the old reused-sentinel criticism no longer applies to those four paths.
- Resolver requires originating generation, profile, canonical manager epoch and matching exact incarnation before ordinary-view authority adoption (`terminal-session-contract.ts:604-667`).
- Terminals launch rechecks the originating owner after create and binds response epoch (`TerminalsApp.tsx:79-126`); create headers come from the PTY manager and carry no-store.
- Main/tester report explicitly separates six automated checks from unexecuted browser qualification.

## Reviewed files

Targeted source/test sections, approximately 2,000+ lines; not every line of each large file:

- `packages/ui/src/lib/{terminal-session-action-coordinator.ts,terminal-session-action-coordinator.test.ts,terminal-renderer.ts}`
- `packages/ui/src/api/{terminal-session-contract.ts,queries.ts}`
- `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts`
- `packages/ui/src/components/organisms/{PortsPanel.tsx,PortsPanel.test.tsx,TerminalPanel.tsx}`
- `packages/ui/src/os/terminal-close-context.tsx`
- `packages/ui/src/os/apps/{SystemMonitorApp.tsx,TerminalsApp.tsx}`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/e2e/os-session-management/os-session-management.spec.ts`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/fixtures/{terminal-session-observation.ts,application-fixture.ts}`
- `apps/web/src/main.tsx`; `server/src/api/terminal.rs`; resolved TanStack source linked above.
- Supporting evidence: README/PDR/code standards, API/changelog, lockfile, selected plan/P08/handoff, Cycle 2 review and latest tester report. Targeted source searches additionally inspected relevant OsShell/transport references.

Code-review skill and required published development/primary workflows read. No plan/task status changed, per assignment.

## Validation commands / results

**Attributed evidence, not reviewer-executed:** `plans/reports/tester-261105-0059-cycle-3-verification.md:13-22,85-88`.

| Command | Tester-reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 334 files, 3,201 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --lib` | Exit 0; 1,418 passed, 0 failed, 1 ignored |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; production TypeScript, 0 errors |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; E2E TypeScript, 0 errors |
| `pnpm lint` | Exit 0; 0 errors, 325 warnings |
| `pnpm build` | Exit 0; web build completed; one static/dynamic import notice |

Reported total: **4,619 passed, 0 failed, 1 ignored**. Browser E2E was **typechecked only**, not executed. Type/test coverage percentages unavailable. Reviewer ran only repository inventory/diff inspection and static reads; no runtime reproduction or release approval claimed.

Recommended main/tester checks after repairs: focused mounted coordinator/Ports regressions; real authenticated termination/Review/physical-byte journeys; positive owner-scoped lifecycle checks; complete state-correct P08 capture matrix, then required regression gates. Actual human review remains separate.

## Unresolved questions / evidence

- No unresolved product/design question identified.
- Missing evidence: actual authenticated browser execution, live202/exact exit, pending200 and both loss-origin cases, owner-scoped positive continuity, eligible Review/retirement, state-correct fresh captures and actual human acceptance.
- Qualification directory currently contains only `handoff.md`; no runtime report, capture index or human-review receipt found there. Administrative plan completion is not technical release qualification.
