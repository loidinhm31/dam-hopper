# Phase 04 — Cycle 2 terminal follow-up review

## Assessment

**Score: 7/10 — changes requested.** Final fixes improve modal bubbling, reactive enablement and typed-error coverage. Comparison identity fencing and ambient cache retirement remain incomplete. Static findings below have not been runtime-reproduced in this review; consequences are marked **[INFERENCE]**.

Scope: six requested checks, not whole-phase release certification. No source, plan or task-state edits. Coordinator owns task status and shared verification lane.

## Requested-check disposition

| Check | Result | Evidence |
|---|---|---|
| Workspace shortcuts gated; modal stops outward bubbling | Partial | Six workspace action callbacks check `sessionChangesState.isOpen`; host stops bubble propagation. However, shared capture listener consumes matching chords before invoking those guarded callbacks. |
| Keyed ready view completely fences epoch/baseline and late refresh | Not satisfied | Key resets child selection/files/detail state, but mutation data/error/pending remain in unkeyed parent and flow into replacement child. |
| Config update purges resolved and ambient/default owner | Partial | Explicit owner cancellation/removal present. Ambient branch guesses `default@1`, which is not necessarily the owner of ambient transport. |
| Host shares reactive fail-closed enablement | Satisfied by static inspection | `useSessionChangesEnabled(owner)` now supplies host readiness; helper observes connection snapshot, config errors and generation. |
| Client regression uses `ApiRequestError.details` | Satisfied by static inspection | Real `ApiRequestError` constructed with details; assertions check typed class, code, retryability and current revision. |
| 104 tests and UI compilation | Existing execution evidence supports requested narrow gate | Tester reports 17 + 72 + 8 + 7 = 104, zero failures. Coordinator transcript records final UI build success after the missing `Comparison` import was corrected. This reviewer did not rerun checks. |

## Critical issues

None identified at Critical severity.

## Warnings

### 1. High — keyed child still receives unfenced parent refresh state

**Evidence:** `packages/ui/src/components/organisms/SessionChangesPanel.tsx:74–97,331,348–361,508–520`; `packages/ui/src/api/session-changes-queries.ts:267–303`.

`SessionChangesReadyView` is keyed by epoch/baseline, but `useSessionChangesRefreshMutation` lives above that key. `initialComparison={refreshMutation.data ?? status?.comparison ?? null}` accepts a comparison without checking its epoch/baseline; the DTO contains both identity fields. The mutation's error and pending flags are also unqualified.

**Failure/impact [INFERENCE]:** refresh A remains pending while status changes to B. The newly keyed B view receives A's retained comparison if it already existed, initializing `activeRevision` to A's revision and requesting B files with that revision. Alternatively, late A completion can supply A's comparison while B's files are unresolved and pass A's revision into B's detail queries. Old failure/pending state can affect the new view. The key only fences child-owned state, not incoming parent mutation state.

**Correction:** put mutation and refresh UI in the keyed identity scope; or qualify mutation data, error and pending using captured epoch/baseline and current status before passing them to the child. Reject comparison DTOs whose identity does not match. Add delayed-refresh A → B regression and assert every files/detail request uses B identity and B revision (or no revision for bootstrap).

**Confidence:** High.

### 2. High — ambient cache purge still guesses an unrelated owner

**Evidence:** `packages/ui/src/api/queries.ts:115–131,1188–1210`; `packages/ui/src/components/pages/SettingsPage.tsx:51–71`; `packages/ui/src/api/client.ts:4396–4399,4442–4445`; `packages/ui/src/api/connections.ts:588–615,845–856`; `packages/ui/src/api/session-changes-queries.ts:28–95`.

Undefined owner dispatches via ambient `api`. That client delegates the installed active transport, and connection code installs the actual active profile transport. Yet mutation cleanup substitutes `{ profileId: "default", generation: 1 }`. Clearing the unqualified `["session-changes"]` prefix cannot remove the actual owner-qualified entries.

**Failure/impact [INFERENCE]:** Current/Default Settings mutation affects connected A@generation N, while cleanup removes default@1 and unqualified keys. A's retained original/detail data and in-flight requests remain when the modal is closed. Explicit-owner path is improved; default/ambient path does not meet the requested purge contract.

**Correction:** resolve/capture the actual ambient connection owner when the mutation begins and use that captured client/owner through completion and cleanup. Do not guess a profile ID or generation; do not purge unrelated servers. Cover closed modal, delayed detail, generation >1, and another owner's retained data.

**Confidence:** High.

### 3. Medium — workspace action guard runs after capture-phase event consumption

**Evidence:** `packages/ui/src/components/pages/WorkspacePage.tsx:1289–1335,1426–1448`; `packages/ui/src/hooks/use-shortcuts.ts:38–54`; `packages/ui/src/components/organisms/SessionChangesHost.tsx:92–95`.

The six action callbacks now return while review is open. However, `addKeyboardShortcutListener` calls `preventDefault()` and `stopPropagation()` at window capture before the callback. Returning there prevents the workspace action but still prevents a matching key chord from reaching dialog children.

**Failure/impact [INFERENCE]:** modal/Monaco key chords colliding with a configured workspace shortcut remain swallowed. Ordinary unmatched keys regain child delivery; the blanket interception regression is improved but not completely removed.

**Correction:** gate listener registration or shortcut matching before event consumption while modal is open. Retain the host's bubble stop. Add real capture-listener collision assertion alongside child Arrow navigation, Escape and focus containment.

**Confidence:** High.

### 4. Qualification evidence is narrower than full Phase 04 acceptance

The requested 104 tests are useful focused gates, not integrated OMP/Tauri proof. `plans/261031-0949-lightweight-session-changes-refactor/reports/` contains no `integration-report.md` at inspection; Phase 04 plan still lists live OMP, no-viewer measurements, shared Tauri/visual and documentation gates. No claims made that these passed. Host browser test `session-changes-host.browser.tsx:129–131` dispatches ArrowDown without asserting keyboard isolation or child navigation, so its title alone cannot qualify that behavior.

## Suggestions

- Preserve the shared reactive enablement helper and exact owner-qualified query keys.
- Add regressions for the two async identity/cache failures before treating current test counts as coverage of those fixes.
- Update `docs/code-standards.md:137` when documenting final behavior: it still mandates the blanket window capture interception now removed from the host. Document gated workspace capture listeners plus modal bubble/focus isolation instead.
- Keep plan/task updates coordinator-owned; this report does not administratively complete Phase 04.

## Reviewed files

Primary:
- `packages/ui/src/components/pages/WorkspacePage.tsx` — relevant shortcut registrations.
- `packages/ui/src/components/organisms/SessionChangesPanel.tsx` — keyed ready view, comparison/files/detail state, refresh parent.
- `packages/ui/src/components/organisms/SessionChangesHost.tsx` — readiness, cancellation, modal bubbling and identity key.
- `packages/ui/src/api/queries.ts` — owner resolution and `useUpdateConfig`.
- `packages/ui/src/api/session-changes-queries.ts` — query keys, refresh mutation and enablement helper.
- `packages/ui/src/api/session-changes-client.test.ts` — real details-bearing error regression.

Supporting inspected sections:
- `packages/ui/src/api/{client,connections,transport,session-changes-types,session-changes-client}.ts`.
- `packages/ui/src/hooks/use-shortcuts.ts`.
- `packages/ui/browser-tests/session-changes-host.browser.tsx`; targeted test declarations in panel/viewer browser suites.
- `packages/ui/package.json`.
- `README.md`, `docs/{project-overview-pdr,code-standards}.md`.
- Current refactor overview and Phase 04 plan; previous Cycle 2 review; tester report/transcript; coordinator transcript.

## Validation commands/results

Evidence provenance: delegated tester `agent://Phase04TesterCycle2`, matching execution entries in `history://Phase04TesterCycle2:45–65`; coordinator `history://Main:1509–1529`. Raw Rust output inspected at `artifact://69:1–14`. No compile/test/lint commands executed by this reviewer; avoided duplicating coordinator-owned shared verification.

| Command | Recorded result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/components/pages/SettingsPage.test.tsx` | Tester: 17 passed, 0 failed; two non-failing jsdom navigation diagnostics. |
| `pnpm --filter @dam-hopper/ui test src/api/session-changes-types.test.ts src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/api/ws-transport.test.ts` | Tester: 72 passed, 0 failed across four files. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-panel.browser.tsx browser-tests/session-changes-host.browser.tsx browser-tests/session-changes-viewer.browser.tsx` | Tester: 8 passed, 0 failed across three files. |
| `cargo test --manifest-path server/Cargo.toml session_changes::types` | 7 passed, 0 failed; requested filter excludes 2,078 other tests per tester. Raw unit output confirms seven passes. |
| `pnpm --filter @dam-hopper/ui build` | Coordinator confirms `tsc -p tsconfig.json` exited 0, clean build; final successful execution also recorded in coordinator transcript after import correction. Reviewer did not rerun or inspect raw final stdout. |

Aggregate recorded: **104 passed, 0 failed**. No type/test coverage percentage or lint-clean claim inferred.

## Unresolved questions

- No unresolved product-design questions. Coordinator acknowledges all three implementation findings and is implementing targeted corrections/regressions; those subsequent changes are outside this reviewed snapshot and require fresh qualification.
- Integrated live/platform gates remain unqualified by the supplied focused evidence.
