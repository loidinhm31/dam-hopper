# OS session management — Code Review Cycle 3

## Score: 6.5/10 — changes required

**Not all Cycle 2 critical issues are resolved.** Canonical captured-row checks, normal verified-terminal revocation, exact OS runtime lookup, and per-mount action fencing improved. Original-lifetime provenance, presentation-independent End records, build contracts, and meaningful qualification remain blockers.

## Scope and evidence

- Plan: `plans/261104-1529-os-session-management-and-interactions/plan.md`; comparison: `plans/reports/code-review-261104-2232-os-session-management-cycle-2.md`.
- Inspected changed-file inventory (83 tracked changed files, +9,559/-1,248, plus untracked contracts/controllers/tests/evidence), key server guard/signal/inventory changes, and UI authority/transport/query/keepalive/Close/Monitor/Ports/Hub/Review/Recipe/shell/placement integrations and qualification oracles. Risk-based review, not a line-by-line certification of every modified test fixture.
- Read README, PDR/code standards, installed development/primary guidance and code-review skill, frozen architecture and P08 requirements.
- **Static review only. No build, typecheck, test, lint, formatter or browser command run by this reviewer.** Separate tester report `plans/reports/tester-261104-2321-cycle3-regression-verification.md:15-20` reports 112 PTY + 154 API + 3,189 UI tests passing, lint 0 errors / 326 warnings. Those are attributed results, not independent runtime verification. That command set excludes UI build/typecheck and authenticated browser/live-PTY qualification (`:56-60`).
- Only this report created; source, tests, plan and task state unchanged. No claim that all plan tasks, P08, P09 or human acceptance are complete. Type/test coverage percentages unavailable.

Unless stated otherwise, source paths below are relative to `packages/ui/src/`.

## Cycle 2 disposition

| Requested correction | Cycle 3 disposition | Evidence |
|---|---|---|
| 1. Resolver lifetime evidence | **Partial — MUST FIX** | Null-owner/canonical row checks and exhaustive lifecycle mapping fixed (`api/terminal-session-contract.ts:564-601`); missing original generation/epoch still accepted for ordinary adoption. C1. |
| 2. Durable terminal revocation/shared readiness | **Meaningful correction; incomplete boundary unification** | Revocation latch closes replay/input; normal input, history, suggestions and resize consult shared readiness (`TerminalPanel.tsx:264-269,534-581,1031-1060,1097-1103`). Higher-incarnation evidence and process restart revoke (`:723-730,851-869,994-1000`). Ad-hoc initial/recovery validation remains; attach does not use shared predicate. C1/W1. |
| 3. Exact claims/lifetime-bound runtime | **Partial** | OS dedup uses exact target key and window-stable mount key; visible lookup now exact (`OsResourceHost.tsx:217-245`; `TerminalsApp.tsx:136-145`). Stale target closure, raw-key host fallback and registry ambiguity remain. W2. |
| 4. Monitor/Ports action lifecycle | **Partial — MUST FIX** | Ports now reconciles and guards frozen target; both retain terminal states and token-fence responses within a mount. Records still disappear with presentation. C2. |
| 5. Qualification | **Incomplete — MUST FIX acceptance blocker** | QueryClient absence now fails, cache seed ordering corrected, Close A/B double returns correct body shape, recorder drops raw content. Still no actual physical-byte oracle, real pending/live/loss flows, mandatory lifecycle controls or live Review retirement proof. C4. |

## Critical issues — MUST FIX

### C1. Ordinary views still acquire newer lifetime authority without originating epoch proof
**High; ownership/destructive-action boundary; confidence high.**

References: `api/terminal-session-contract.ts:604-646`; `os/OsShell.tsx:332-378,1472-1507`; `os/apps/TerminalsApp.tsx:98-120`; `api/terminal-session-contract.test.ts:302-323,487-495`.

- Resolver checks originating generation only **if present**, and never requires originating PTY epoch. Tests still deliberately grant authority to windows with no generation.
- Shell create paths now correctly fence changed profile/generation after await, but publish only numeric incarnation, generation and profile. Neither captures the original PTY epoch. Explicit relaunch does the same.
- Therefore an unbound ordinary view can acquire whichever manager epoch first supplies the same ID/incarnation, or another generation when stored generation is missing. Current-owner checks do not prove original lifetime; this is the exact provenance gap raised in Cycle 2. Exact `incarnationExact: String(number)` also is not independently exact-u64 evidence.
- `TerminalPanel.tsx:663-670,1223-1228,1340-1361` separately accepts a matching exact string without canonical inventory eligibility, bypassing the safe-numeric-disagreement rejection now used by the resolver.

**Correction:** bind creation/explicit adoption to proven originating `{profileId,generation,serverEpoch}` and canonical exact incarnation; enforce complete evidence in the resolver instead of optional generation checks. If the creation protocol cannot prove epoch, keep that view Close-only rather than borrowing a later observation's epoch. Reuse canonical eligibility in all panel authority checks. Regress missing generation, held create/first-adoption with a new epoch, owner retirement and exact-string/safe-number disagreement.

### C2. End state remains owned by unmountable Monitor/Ports presentation
**High; unresolved destructive-action lifecycle; confidence high.**

References: `os/apps/SystemMonitorApp.tsx:275-308,485-515,575-579`; `components/organisms/PortsPanel.tsx:264-301,799-828`; `os/DesktopCanvas.tsx:40-52,56-59,95`; `os/terminal-close-context.tsx:70-82`.

Maps/in-flight sets are still local `useState`/refs in ordinary views. Minimize removes the window subtree; selecting another tiled tab renders only that tab. Unmount drops unresolved dispatch/outcomeUnknown records, typed errors and reconciliation ownership. A new mount starts empty. With a held/lost response and still-live cached inventory, the same captured action can send another request. Separate Close/Monitor/Ports maps also cannot suppress another entry point's unresolved request.

The server may refuse duplicate mutation; **no second successful signal is asserted here**. Client no-retry and retained-outcome guarantees are nevertheless broken, and the user loses whether End was dispatched. New prompt tokens, frozen-target guards and settled-state protection do not fix owner lifetime.

**Correction:** reuse the existing persistent root action owner for every End entry point; persist only exact action records, not app presentation. Reconcile while views are absent; restore retained typed feedback. Tests must dispatch once, lose/hold response, minimize/tab-switch or close/reopen, invoke another entry point, and assert one dispatch until origin-specific authoritative resolution.

### C3. Production TypeScript contracts remain incompatible
**High; build/type-safety blocker; confidence high from declarations, compiler not executed.**

References: `components/organisms/PortsPanel.tsx:320-347`; `api/terminal-session-contract.ts:228-249,304-315`; `os/recipes/RecipeEditor.tsx:94-110`; `os/recipes/recipe-source-context.ts:115-120,190-203`; `api/connections.ts:347-354`; `packages/ui/package.json:7`; `packages/ui/tsconfig.json:18-19`.

- Ports constructs typed `TerminationState` values with `error.category: "unknown"` and `"transport_error"`; neither belongs to `TerminationFailureDetail.category`.
- Recipe passes `ConnectionSnapshot[]` from `getAllConnectionSnapshots()` to an ID-keyed `Record<string, ConnectionSnapshot>`. This is a static type mismatch; at runtime profile-ID lookup returns undefined and connected profiles appear disconnected.
- These production files are included by the UI `tsc` build. Vitest/lint passes do not establish type compatibility.

**Correction:** use existing allowed failure categories with honest unknown-versus-proven-failure semantics. Normalize snapshots by `snapshot.owner.profileId`, using existing reactive profile/connection subscriptions rather than mount-only memoization. Main should run UI build and E2E typecheck after repairs; do not substitute transpile-only test results.

### C4. Qualification still does not test its named guarantees
**High acceptance blocker; not itself proof of a product runtime failure; confidence high.**

References: `packages/ui/e2e/os-session-management/os-session-management.spec.ts:42-84,97-107,134-165,212-250,290-352`; `packages/ui/e2e/fixtures/terminal-session-observation.ts:75-118,191-264,308-362`; `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:65-75`; `os/terminal-close-context.test.tsx:195-265`; selected `phase-08-integrated-qualification.md:18-25`.

- **Physical oracle remains a comment:** launches ordinary Dock terminal, never runs `stty`/`od`, observes hex, proves sentinels or asserts blocked-byte absence. Optional notification/profile checks can skip the named surfaces.
- **Termination flow is mocked incorrectly:** newly generated terminal receives fixed `term-1`/fixed-epoch success, violating exact echoed identity. Request assertion checks only version. Test expects live-202 prompt disappearance, while production waits for exact exit; fake response does not terminate the process. No real pending200, dropped-response or origin-specific reconciliation journey.
- **Review qualification uses fabricated metadata and seeded cache:** no eligible live metadata join, hidden/config retirement or held late result. Base capture claims Eligible Review but only launches a terminal; fallback capture branches can publish an unrelated state under a required checkpoint name.
- **Lifecycle baseline still vacuous:** only token presence is mandatory. Initial create/attach/replay completion and advancing live output are not required; `null === null` epoch/incarnation passes. Frame filtering ignores recorded socketIndex and matches raw ID only. Counts are derived from a silently rotating 500-frame buffer; eviction can erase lifecycle evidence. `totalFramesRecorded` is not used to reject truncation. `data.length` is characters, not UTF-8 bytes.
- New Close loss test ends at `outcomeUnknown`; despite its title it neither supplies a restartCancelled observation nor exercises successful pending200 completion.

**Correction:** implement frozen P08 positive controls and actual authenticated PTY/Review flows, target-owned monotonic content-free counters with overflow detection, both real termination origins plus loss/negative controls, mandatory named surfaces and full capture-state assertions. Missing prerequisites must block, not fabricate data or skip assertions. Keep actual human review separately pending.

## Warnings — SHOULD FIX

1. **Attach/recovery is not fully behind the shared mutation gate.** `components/organisms/TerminalPanel.tsx:558-580,1171-1175,1361-1367`: sendAttach checks connection/verified flag, not durable revoked ref or shared readiness; initialization can set the local verified flag again after rebinding. Resize's predicate also omits attach/replay readiness. Route attach/recovery through the explicit authority predicate and define which readiness state permits resize. Existing revocation test (`TerminalPanel.test.tsx:1171-1235`) proves basic write/resize refusal but not successful ready baseline → revoke → history/suggestion/restart/rebind/recovery. Do not claim all routes qualified.
2. **Exact claim/runtime lookup still has stale and ambiguous paths.** `os/apps/TerminalsApp.tsx:130-153`: attachment closure reads target but omits it from effect dependencies, so claim updates can leave lookup on an earlier raw/exact key. `TerminalKeepAliveHost.tsx:75-77` falls back to profile/raw React key when mountKey is absent, not exact lifetime. `lib/terminal-registry.ts:65-73` deletes raw alias for A+B, then recreates it for C while A/B remain; ambiguity is not durable. `TerminalPanel.tsx:1513-1532` aliases by raw qualified fallback rather than the component's own entry. Use a stable exact target key in subscription dependencies and lifetime-safe registration/lookup; retain stable same-lifetime xterm. Add simultaneous old-A/new-B tests and three-way collision/removal-order tests.
3. **Arbitrary HTTP500 becomes proven signal failure.** `lib/terminal-session-actions.ts:153-181`: all 500s become retryable `failed` with fabricated TERMINATION_SIGNAL_FAILED. Only validated protocol signal-failure code proves no dispatch; other errors must remain outcomeUnknown. Validate refusal codes instead of casting arbitrary strings.
4. **Notification bell double-updates the same controlled state.** `os/TopBar.tsx:319-326`; `os/OsShell.tsx:1601-1604`; `os/shell-input-context.tsx:85-90`: context sets notification-center, then callback toggles it off. Choose one state owner and exercise real shell/provider click behavior.
5. **Shell keyboard layer state is captured stale.** `os/OsShell.tsx:250-311`: listener reads isPaletteOpen/modalDepth/activeNonmodal but dependencies omit them. Current modal/nonmodal arbitration can use mount-time state. Use current narrow dependencies/current-state callback; test real nested surfaces.
6. **Review cleanup equality is not full authority.** `api/session-changes-queries.ts:212-225`: sibling check omits profileId/generation/rootId, allowing another owner's otherwise equal tuple to suppress cleanup. Status key/matcher also omit requested epoch (`:32-47,123-133,270-277`). Compare full identities and preserve only queries actually shared by surviving eligible viewers. Frame/list now invoke cleanup; that Cycle 2 omission is corrected (`WindowFrame.tsx:273-285`; `WindowList.tsx:170-182`).
7. **Hub still promotes unqualified evidence and retains fake authority.** `os/agent-hub.ts:287-299,330-350,388-393`: numeric join alone does not establish status-view availability/current generation. `:403-425` manufactures zero-UUID targets when explicit inventory is empty too, not just omitted test input; production passes sessions plus groups (`os/apps/AgentHubApp.tsx:134-143`). `:725-749` retains raw-ID fallback. Require current ready owner-qualified status, never construct a fake terminal target, remove test-driven production fallback.
8. **Float projection still clips right-side controls.** `os/window-ops.ts:130-139,151-160`: x clamps to viewport minus 50/100 without considering width; only a left sliver can remain visible. Preserve the actual titlebar control strip in derived display geometry without rewriting saved bounds.
9. **Destructive endpoint still ignores media type.** `server/src/api/terminal.rs:457-505`: bounded Bytes parser accepts JSON under text/plain/missing Content-Type. Enforce application/json/415 alongside body bounds. Protocol hardening; no demonstrated authentication/CSRF bypass claimed.

## Suggestions — NICE TO HAVE

- **DRY/KISS:** consolidate exact target equality, authority eligibility and retained action transitions into existing helpers/root owner, not another registry/service. Three parallel controllers and hand-written checks already diverge.
- **Bounds/cleanup:** root Close retains settled records and callbacks indefinitely (`os/terminal-close-context.tsx:70-78`); prune safely after exact retirement while never evicting unresolved dispatches on dismissal.
- **Avoid hot-path allocation:** `server/src/pty/manager.rs:791-805` allocates String for exact marker membership/removal; use borrowed lookup/storage, especially during inventory projection.
- Remove unconditional production QueryClient test exposure (`apps/web/src/main.tsx:71-73`); use existing supported test-only diagnostics, not permanent globals solely to seed fabricated qualification state.

## Positive observations

- Captured resolver now rejects null owners and canonical safe-number disagreement, and never infers typed state from alive alone.
- Normal verified higher-incarnation replacement durably revokes input/resize authority and closes replay; history/suggestion write paths now share readiness.
- Exact OS dedup/visible lookup plus stable window mount keys materially improve old/new lifetime separation without replacing the resource architecture.
- Ports now reconciles exact origin-specific terminal state and guards the frozen dispatch target; both action consumers preserve settled records against late responses within a mount.
- Root Close A/B test now returns actual result-body shape, and original token/ref isolation remains in place.
- Backend guarded signal/cancellation retains atomic epoch/incarnation/replacement checks and reader-owned exit publication (`server/src/pty/manager.rs:2632-2719`; `server/src/pty/session.rs:301-337`). No new generic runtime or poller introduced.

## Recommended order / unresolved evidence

1. Repair production type contracts; finish originating lifetime proof and persistent shared action ownership.
2. Correct runtime identity/attachment and remaining interaction warnings; strengthen targeted race/retirement tests.
3. Main owns serialized UI build, E2E typecheck, focused browser/unit checks and required real authenticated P08 matrix. Preserve first failures and explicit blockers. Tester regression passes do not replace build/browser/physical-input evidence.
4. Actual human acceptance and selected P08/P09 handoff remain unestablished. No unresolved product decision; outstanding uncertainty is runtime/acceptance evidence, not permission to weaken requirements.
