# Code Review — Phase 05 remediation, Cycle 2

## Overall assessment

**Score: 7/10 — request changes.** Several owner-routing and intent-delivery defects are corrected in inspected control flow. Remaining search/replace, clean-save model, and Changes-selection defects prevent closing the remediation end to end.

Published `code-review` skill and project rules read directly. Review of current accumulated working diff, with R1–R8 as the acceptance focus; no isolated Cycle 2 baseline supplied. Security, performance, architecture, YAGNI/KISS/DRY assessed. Runtime impacts below are **[INFERENCE]** from inspected source/upstream behavior, not newly executed reproductions. No source/test/plan/task-state modifications; only this report authored. Phase 05 plan remains coordinator-owned and explicitly records incomplete technical acceptance.

## Critical issues

None established at Critical severity. No new server endpoint, dependency, credential exposure, injection sink, or authentication change identified within inspected changes. This is not whole-repository security certification.

## Warnings

### C2-W1 — High: controlled Search queries are not used by replacement

**Evidence:** `packages/ui/src/components/organisms/SearchPanel.tsx:64-87,151-158,238-246`; `packages/ui/src/os/apps/SearchApp.tsx:19-34,85-90`; `packages/ui/src/hooks/use-search-panel-replace.ts:108-109,433-446`.

Search requests now use the per-window controlled `query`; replacement still receives `searchQuery: queries.content` from the legacy global store. Typing in the OS Search input deliberately never updates that store.

**Failure/impact [INFERENCE]:** with the global default `queries.content = ""`, Replace remains disabled despite valid OS results. If the legacy/global query is `foo` and this window searches `bar`, Replace All searches and changes `foo` in files selected by `bar` results. Replace Next likewise validates the wrong term. This is a new integration mismatch introduced by controlled-query support.

**Correction:** feed replacement the same effective content-query snapshot that produced its matches; keep the legacy store only as the uncontrolled adapter. Add a rendered SearchPanel test with differing controlled/global queries and assert exact mutation content. **Confidence: high.**

### C2-W2 — High: mode, scope and replacement text still couple every Search window

**Evidence:** `packages/ui/src/components/organisms/SearchPanel.tsx:64-87,151-158,187-219`; `packages/ui/src/stores/search-ui.ts:24-64`; `packages/ui/src/hooks/use-file-search.ts:74-85,155-181`.

Only the query string is controlled. Every instance still reads/writes the singleton `mode`, `scope`, and `replaceQuery`. Changing Files/Contents or Project/Workspace in one OS window changes all other windows' effective requests. Replacement text remains shared as well.

**Failure/impact [INFERENCE]:** changing window B to Workspace causes window A's private local query to be federated to up to four connected profiles, even though A was left in project scope. Other windows also change modes and replacement terms without local interaction. This retains the cross-window targeting/disclosure and unnecessary remote-work portion of R4.

**Correction:** make the existing search view state owner/window-local as one coherent contract (mode, scope, per-mode queries, replacement text); preserve global state only for the legacy route. No new orchestration framework needed. Test two simultaneous owner-qualified windows and scope changes. **Confidence: high.**

### C2-W3 — High: a clean successful save can drive the old query baseline back into Monaco

**Evidence:** `packages/ui/src/components/organisms/DiffViewer.tsx:289-295,491-500,758-764`; `packages/ui/src/api/queries.ts:333-350`; [`@monaco-editor/react` v4.7.0 DiffEditor controlled-modified update](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/DiffEditor/DiffEditor.tsx#L95-L116). Package declares `^4.7.0` at `packages/ui/package.json:27`; installed dependency source was not inspected because node_modules access is policy-blocked.

The new dirty branch protects newer typing while `isDirty` remains true. But after a normal successful save with no concurrent typing, `setIsDirty(false)` executes before the awaited query invalidation/refetch has supplied fresh `data.modified`.

**Failure/impact [INFERENCE]:** load O, edit A, save A, delay the diff refetch. Before the write completes the controlled prop is A. After success, the clean branch supplies old O. The wrapper's changed-`modified` effect performs a full-model replacement to O; the content listener sees O differ from saved baseline A and marks it dirty. When the fresh query A arrives, the dirty branch can now preserve O instead. The editor no longer represents the successful save, and another save can restore the old file content. This differs from the original newer-typing race but leaves R1 incomplete.

**Correction:** retain a document-scoped authoritative modified value/saved baseline across both dirty and post-save pending-refetch states. Never release control to a pre-save response. Test ordinary successful save with deliberately delayed refetch, as well as newer typing during write/refetch, using a wrapper-aware behavioral oracle. **Confidence: high for the upstream wrapper contract; runtime reproduction outstanding.**

The added `capturedOwnerIsCurrent()` rejection guard correctly addresses R1's old-owner catch publication issue in inspected code.

### C2-W4 — High: Changes intent consumption overwrites authoritative file-selection metadata

**Evidence:** `packages/ui/src/os/apps/ChangesApp.tsx:33-47,61-76,173-183`; `packages/ui/src/os/OsShell.tsx:715-753`; `packages/ui/src/os/intents.ts:142-147`; `packages/ui/src/components/organisms/ChangedFilesList.tsx:287-318`; `packages/ui/src/components/organisms/DiffViewer.tsx:137-142,184-191`.

A normal list click stores a real `ChangedFileSelection` (status, actual root, root-relative diff path, additions/deletions), then dispatches `changes:diff` with only `projectPath`. Delivery, now forced on every intent, runs the effect that replaces that selection with fabricated `status: "M"`, zero counts, window root/`.` and `diffPath: requestedFilePath`.

**Failure/impact [INFERENCE]:** deleted/added files lose their read-only classification. Nested repository selections lose their actual root and root-relative path, producing an incorrect or failed comparison. Even ordinary list clicks are affected, not just external intents. Repeated-delivery identity works but makes this metadata overwrite reliably repeat.

**Correction:** carry/preserve the canonical selection through the intent, or resolve the exact file entry before mounting the diff; do not manufacture file status/root/path. Update the typed payload, handler and consumer together. Test added/deleted and nested-root list-click journeys plus repeated identical intents. **Confidence: high.**

### C2-W5 — Medium: Devices cannot faithfully represent or recover from the deliberate default target

**Evidence:** `packages/ui/src/os/apps/SettingsApp.tsx:24-39,81-86`; `packages/ui/src/components/pages/DevicesPage.tsx:26-37,54-86`; `packages/ui/src/components/organisms/LoginDevicesSection.tsx:18-20,42-44`; `packages/ui/src/components/organisms/login-devices-owner.ts:19-30`.

The corrected initializer preserves explicit null, and Settings/Devices now share target changes. However, the Devices select has no empty/default option, and is hidden unless there are more than one saved profiles. The downstream login owner requires a concrete saved profile; null resolves to no owner rather than a current/default server.

**Failure/impact [INFERENCE]:** opening Settings on Current/Default and selecting Login Devices displays no manageable logins. With one saved profile the picker is absent, so no target can be chosen there. With multiple profiles the selected null has no corresponding option; the control does not faithfully display the actual target and offers no way back to default.

**Correction:** explicitly display default/unavailable selection and allow choosing the sole saved profile. Define consistent deliberate-default semantics for device management without adding ambient fallback. Add default → Devices → explicit target → General coverage. **Confidence: high.**

### C2-W6 — Medium: selected passing checks do not exercise the Cycle 2 acceptance cases

**Evidence:** `DiffViewer.test.tsx:46-58,184-278`; `use-search-panel-replace.test.tsx:163-272`; `browser-tests/os-workspace-apps.browser.tsx:196-248`; `browser-tests/os-management-apps.browser.tsx:206-231` (all under `packages/ui/`).

Diff tests cover the superseded-stat idle state, not successful-save/refetch model synchronization; their wrapper double never applies controlled-prop changes to a model. Replace All tests cover generation validation, not a tab becoming dirty during a deferred read. Browser search/diff tests inspect window-store payloads, not rendered action effects or repeated delivery. Terminal rejection tests only an empty desktop. The Agent Store test never changes a control or asserts URL stability.

**Correction:** add the missing behavioral oracles for the original R1–R8 scenarios and the new integration defects above; replace timer-based race sequencing with explicit deferred promises. Passing metadata/mount tests cannot certify owner safety or data preservation. **Confidence: high.**

## R1–R8 disposition

| Prior item | Current source assessment |
| --- | --- |
| R1 | Partial: dirty model preservation and catch owner guard improved; post-save clean-branch baseline regression remains (C2-W3). |
| R2 | Addressed in inspected branch: delivered stale/disconnected generation rejected before editor mutation/read; editor open captures its owner synchronously before awaiting. Reconnect browser oracle still absent. |
| R3 | Addressed for Replace All: both dirty checks query live editor state, including the check after read and before write; no await separates that check from dispatch. Deferred-read test still absent. |
| R4 | Partial: query delivery no longer writes global query; replacement/query mismatch and shared mode/scope/replace state remain (C2-W1/W2). |
| R5 | Addressed for explicitly qualified windows: profile selector dispatches canonical launch/focus, while originating body stays pinned to its context identity. Two-profile selector/relaunch oracle absent. |
| R6 | Improved: null preserved, Devices selection lifted, explicit settings intent updates both profile fields in current source; Devices default/selection gap remains (C2-W5). |
| R7 | Addressed in inspected branch: registry existence checked before exact-window or arbitrary-window reuse; unknown IDs cause no window mutation. Existing-window test absent. |
| R8 | Delivery nonce now reaches Search/Changes consumer effects, addressing identical-payload dependency suppression; Changes metadata regression remains (C2-W4). |

Do not repeat QA's stale Settings-intent or Devices-initializer warnings as current defects: current `OsShell.tsx:517-520` updates `targetProfileId`, and current `DevicesPage.tsx:28-30` distinguishes null from undefined.

## Suggestions / architecture / performance

1. Prefer one canonical per-window search-state contract over three mirrored states (window appState, local query, global search store). Keep the legacy adapter; avoid a second feature implementation.
2. Keep Agent Store/Settings wrappers thin and preserve canonical page bodies. Standardize controlled/uncontrolled contracts rather than using `noLayout` as both presentation and state-ownership mode.
3. Remove unused DiffViewer save fields (`id`, stored `content`, stored `filePath`) and unreachable generation duck-typing after normalization. Object identity already distinguishes active saves; use explicit owner types.
4. Snapshot mutable store state at operation boundaries, as Replace All now does. Reuse a small launch/focus/deliver helper if reducing repeated shell handlers; do not introduce another router abstraction.
5. No measured CPU/memory/bundle regression established. Concrete redundant remote work remains in shared search scope/mode. The dirty render's full-model `getValue()` and repeated shell boilerplate merit simplification while correcting canonical state, not speculative caching.

Positive: no backend API expansion; explicit owner guards; registry-first rejection; fresh dirty checks; per-delivery nonce; fail-closed requested Conflict Resolver operation; separate Settings target/preferences source; existing canonical components reused.

## Reviewed files

All 20 paths shown by the initial accumulated diff reviewed in relevant source sections/diffs (approximately 2,500 lines including supporting/test sections, not a coverage metric):

- `packages/ui/src/components/organisms/DiffViewer.tsx`
- `packages/ui/src/components/organisms/DiffViewer.test.tsx`
- `packages/ui/src/components/organisms/SearchPanel.tsx`
- `packages/ui/src/components/pages/AgentStorePage.tsx`
- `packages/ui/src/components/pages/DevicesPage.tsx`
- `packages/ui/src/components/pages/SettingsPage.tsx`
- `packages/ui/src/hooks/use-search-panel-replace.ts`
- `packages/ui/src/hooks/use-search-panel-replace.test.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/apps/AgentStoreApp.tsx`
- `packages/ui/src/os/apps/ChangesApp.tsx`
- `packages/ui/src/os/apps/ConflictResolverApp.tsx`
- `packages/ui/src/os/apps/SearchApp.tsx`
- `packages/ui/src/os/apps/SessionChangesApp.tsx`
- `packages/ui/src/os/apps/SettingsApp.tsx`
- `packages/ui/src/os/apps/TerminalsApp.tsx`
- `packages/ui/src/os/intents.ts`
- `packages/ui/browser-tests/os-workspace-apps.browser.tsx`
- `packages/ui/browser-tests/os-review-apps.browser.tsx`
- `packages/ui/browser-tests/os-management-apps.browser.tsx`

Supporting: `README.md`; `docs/{code-standards,project-overview-pdr}.md`; Phase 05 plan; previous remediation review and Cycle 2 tester report; `api/queries.ts`; `stores/{editor,search-ui}.ts`; `hooks/use-file-search.ts`; `lib/{terminal-registry,search-replace-next}.ts`; `components/organisms/{ChangedFilesList,LoginDevicesSection,login-devices-owner}`; `os/{window-context,app-registry}.tsx/.ts`; `os/apps/EditorApp.tsx`; `packages/ui/package.json`; upstream Monaco wrapper linked above.

## Validation commands / results

Reviewer executed `git diff --stat`, targeted `git diff` source inspections, `date +%y%m%d`, reads and callsite/state searches. No reviewer build/test/lint/formatter or runtime mutation; main/tester owns joined execution. No source fixes authorized by this review.

**QA-reported, not independently rerun:** `plans/reports/tester-261102-1822-phase05-cycle2-remediation.md:15-21,40-43,60-71`:

| Command | Reported result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os src/hooks/use-search-panel-replace.test.tsx src/components/pages/AgentStorePage.test.tsx src/components/organisms/DiffViewer.test.tsx` | Exit 0; 12 files; 97 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-workspace-apps.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/os-management-apps.browser.tsx` | Exit 0; 3 files; 14 passed, 0 failed/skipped. |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; 0 TypeScript errors. Package script is `tsc -p tsconfig.json`, not production Vite bundling. |

Receipt total: **111/111 selected tests passed**. Nonfatal React `act(...)` warnings reported. No lint run, type-coverage percentage, test-coverage percentage or production-bundle result available. This receipt does not establish runtime fixes for untested edge cases above.

## Unresolved questions

- No product clarification blocks C2-W1–W4. Their intended behavior follows existing owner/data-integrity contracts.
- What should deliberate Current/Default mean for Login Devices, whose canonical owner requires a saved profile? Preserve explicit unavailable state or deliberately resolve a saved target; do not silently pick one.
- Successful-save/refetch Monaco behavior, two-window search scope isolation, two-profile Agent Store relaunch, late dirty-tab races, and repeated rendered intent actions remain unexercised by the selected receipt.
- Broader Phase 05 gates (offscreen Session Changes retirement, physical PTY keyboard/paste/IME isolation, navigation/back-forward/basename, complete canonical parity, production bundling) remain outside this scoped remediation certification.
