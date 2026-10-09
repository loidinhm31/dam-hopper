# Batch A validation and terminal review

Scope: phases 1–3 only of `plans/261008-0233-traditional-terminal-agents-sidebar/plan.md`. Authoring settled; phase 4 not dispatched. Parent owns approval/controller/finalization. No durable completion claimed.

## Actual validation

Tester terminal result:

| Command / scope | Result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | Exit 1; 326/327 files passed; 2690/2691 tests passed; 20.14s |
| Batch A cases within full suite | 138 passed, 0 failed: roster 83; navigator 11; row 3; URL helper 19; page 22 |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; 8.94s |

Only full-suite failure: `packages/ui/src/filename-conventions.test.ts:55` scans component filenames and asserts PascalCase. Frozen row paths are deliberately kebab-case. This incidental spelling test has no consumer-visible behavior. Parent-authorized proposed correction is deletion, not renaming the frozen interface or re-pinning the assertion. It remains present pending review/approval.

## Actual browser smoke

Real web host: Vite 6.4.1, `pnpm --filter @dam-hopper/web exec vite --host 127.0.0.1 --port 5177 --strictPort`. Browser had two registered disconnected local smoke profiles with auto-connect disabled; no server response/transport mocking.

- `/agent-store?tab=settings` initially required profile choice despite active A.
- Explicit deliberate B selection kept B's URL/identity and showed disconnected denial. Observed zero requests after clearing request history before selection.
- Unknown explicit target and empty explicit value both denied and kept chooser empty. Active global profile remained A.
- **Observed regression:** no-owner Settings → Memory Files produced `?tab=memory` and selected captured default A without profile choice. Disconnected A prevented remote work in this smoke; connected query mount follows the reviewed branch, not an exercised server claim.
- Isolated component smoke imported the real pure builder/navigator/row with explicit structural input, not live harness ingress. Native Enter and Space each activated exactly once with exact qualified session ID. Compact row measured 350 × 121.40625 CSS px; Settings link 116.8125 × 44 CSS px. Projects-first/Agents-second layout and primary Idle/secondary turn-ended/unverified-success description observed at wide and compact viewports.
- Screenshots visually inspected by assistant, not human acceptance or phase 4 qualification. Throwaway module deleted and tab closed.

## Terminal reviewer findings — cycle 1

Reviewer score: **8/10**, static assessment, not runtime certification. Reviewed all 10 source/test files and relevant existing ownership/status/query/feature APIs. No Critical issue identified.

### H1 — Must fix: tab changes escape unresolved chooser

`packages/ui/src/components/pages/AgentStorePage.tsx:91–98` updates tab alone while request is `choose`; `packages/ui/src/lib/agent-store-navigation.ts:31–32` then classifies missing profile as `default` on non-settings tabs. Page `:72–82,160–166` adopts captured active/first target and can mount its connected query subtree. Browser smoke independently observed implicit A selection. Ownership-intent violation, not backend authorization bypass.

Preserve unresolved chooser targeting across local tab changes or prevent tab changes until deliberate selection. Keep ordinary direct bare entry default behavior. Add connected-A denial-before-work cases for Store/Memory/Import tab changes, deliberate selection and Back/Forward; do not use undefined owner or change shared queries.

### M1 — Warning: accessible hook coverage lacks focused regression

Row source `:74–79` exposes hook/limited coverage correctly, but current three row tests do not protect that explanation. Add focused consumer assertion for the actual aria-describedby target and source tooltip with Unknown/unavailable hook row; do not restore label-echo matrices or synthetic keyboard clicks.

### Suggestion — Reconcile affected existing Agent Store docs

`docs/architecture/agent-store-ports-and-browser.md:12` still says removed selection chooses another listed profile. Parent finalization now owns this exact path to document removal denial and current owner mount boundary. Other phase 4 docs remain phase 4-owned.

### Positive evidence and limits

Canonical qualified tab/mounted/registered-owner/live-incarnation join; original readonly DTO retained; current connection generation and reconnect marker fence readiness; strict idle/explicit-ended/undefined-turn/nonexpired hint. Linear stable roster; no status sorting, timers, new transport subscriptions, scraping or notification coupling. Query-bearing child mounts only for registered connected owner and retires by connection key. Invalid/removed/disconnected targets otherwise deny before work. Projects tablist/roving navigation preserved, Agents ordinary keyed buttons, bounded independent overflow, no sensitive status IDs rendered.

Permanent cases exercise identity exclusions, generation changes, snapshot replacement, strict outcome negatives, real query hooks with owner API spies, cache isolation, late-response and dialog retirement, and focus stability. Feature mocks do not qualify actual harness ingress. Phase 4 still owns stale selection closure checks, both surface integrations, compact focus restoration, split/PTY preservation, actual supported harness/version qualification, final captures and human review.

## Gate state

Canonical cycle-1 advice returned `ADVICE_READY`; user selected **Fix all issues**. Parent registered and executed the accepted bounded correction in run `8f7a871c-e7f2-4ede-b024-b8aaf0dca977`, action `ab4c2766-7830-4201-b0f5-1e0afa1052ae`, episode `batch-a-review-cycle-1-fix-all`. Declared validation: `pnpm --filter @dam-hopper/ui test`.

## Post-correction evidence

- Chooser-only tab disablement preserves ownerless Settings until deliberate selection; no parser/signature/default-entry changes.
- Four page regression executions protect attempted Store/Memory/Import escape with connected A, deliberate B use, and Back/Forward restoration.
- Focused unavailable-hook regression protects accessible limited coverage and Unknown semantics without a success claim.
- Incidental filename spelling test deleted; frozen row paths unchanged. Affected architecture paragraphs reconciled.

| Check | Fresh observed result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 326/326 files and 2694/2694 tests passed; 23.54s |
| Five affected suites | 143 passed: roster 83; navigator 11; row 4; helper 19; page 26 |
| `pnpm --filter @dam-hopper/ui build` | Exit 0 |

### Fresh actual-app browser correction smoke

Fresh worktree Vite UI with two isolated real authenticated SQLite-backed fixture servers; existing `dam-hopper:production-test` image used for unchanged backend only, not current image/UI qualification. Initial cross-origin setup was denied; owned isolated servers were restarted with the supported exact-origin CORS flag. Authentication stayed enabled.

- Both A and B connected. Ownerless Settings retained empty profile choice; all three other tab controls were disabled. Attempted native-button activation left route/selection unresolved and generated zero Agent Store requests.
- Deliberate B selection mounted real Settings with successful inventory/matrix requests exclusively to B's distinct backend origin; active global profile stayed A.
- Back restored ownerless chooser and disabled tabs; Forward restored explicit B Settings.
- Ordinary bare Agent Store entry still selected valid A.
- Unknown and empty explicit profile values retained denial through Store/Memory/Import navigation, with zero Agent Store requests.
- B explicitly disconnected through existing connection manager while A stayed connected: B remained selected/unavailable through all three tab changes, zero Agent Store requests.
- B removed through existing profile manager/confirmation: requested B ID remained in URL, chooser empty, no fallback to A or Agent Store requests through tab changes; global A unchanged.
- Actual real Settings screenshot inspected by assistant only. No integration installs, path saves, policy changes or live harness events exercised.
- Browser closed; both owned isolated services disposed with exit 0; temporary driver deleted. No credential retained in this report or repository.

### Terminal reviewer — cycle 2

**9/10**, static assessment. No Critical, High or must-fix finding remaining. H1 is structurally prevented by narrow chooser-only native-button disablement; M1 accessible hook coverage protected; incidental spelling-test deletion and documentation correction accepted. Original identity/readiness/outcome/query-owner/accessibility invariants retained.

Warning: fresh validation/browser evidence was unavailable to the reviewer at its terminal barrier; parent now retains it above. Feature mocks remain composition/owner evidence, not real-harness or complete Settings/import/memory qualification. Suggestion: no additional source change; preserve choose-only disablement and ordinary route defaults.

Correction outcome was recorded truthfully (revision 6, evidence revision 1), followed by terminal same-run cycle-2 `ADVICE_READY` counsel and explicit user **Approve**. No remaining advisor must-fix or unresolved questions. Advice cautions preserve chooser-only behavior, original default entry, exact authorized finalization scope, no blanket staging, and no phase 4/live-harness qualification claim.

## Approved finalization

- Registered action: `0f2e9295-9fb3-417f-8b1b-eb51b017db56`; episode `batch-a-approved-finalization`; same run `8f7a871c-e7f2-4ede-b024-b8aaf0dca977`.
- Three phase documents now describe delivered APIs/behavior, authoring checklists, user approval, and scoped validation; controller completion remains pending in those captured snapshots. Parent clarified original readonly DTO preservation and page-owned versus app-root query boundaries.
- User selected **Leave uncommitted**. No staging/commit/index transitions performed. Plan/contracts and unrelated user planning files remain unchanged by finalization.
- Writer barrier settled. Parent ran `pnpm --filter @dam-hopper/ui test && pnpm --filter @dam-hopper/ui build`: exit 0; 326/326 files and 2694/2694 tests passed, UI test duration 20.27s; TypeScript build passed. Two nonfatal jsdom navigation-not-implemented messages appeared; no warnings suppressed. Actual browser route evidence above is separate from jsdom.
- Final outcome/controller seal and immutable phase-scoped receipts remain parent operations. No durable DONE claim in this captured report; phase 4 has not dispatched. Receipt/progress publication is outside baseline and does not authorize later edits to sealed paths.
