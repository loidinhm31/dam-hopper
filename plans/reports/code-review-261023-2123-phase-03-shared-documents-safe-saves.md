# Phase 03 — Shared Documents, Bounded Loading and Safe Saves: Code Review

## Assessment

**Score: 3/10 — changes required; Phase 03 acceptance incomplete.**

Review against C1–C4, frozen session ports, bounded retention and YAGNI/KISS/DRY. Three critical data-loss paths; eleven warnings below. Document injection and explicit text/range read bounds improve the foundation, but the cutover still retains mirrored text, lacks native event publication and memory enforcement, and exposes incomplete safe-save/close contracts.

Review-only: no product/test/plan/task-state edits. Main retains integration/status ownership. The pre-existing Workbench is dormant; findings about its callers are integration/carryover issues, not proof of an active-root regression. Source-derived failure scenarios below were not dynamically reproduced by this reviewer. Confidence high unless qualified.

## Critical Issues

### C01 — Frozen save port submits empty content instead of the document

**Evidence:** `EditorRepository.kt:115–134`, especially fresh stat at 121 and `content = ""` at 127.

`saveDocument(id, explicitOverwrite=true)` stats the current file and conditionally writes an empty string with that mtime. It does not retrieve a document, capture submitted revision/bytes, validate read-only/dirty/input state or mark the actual document saved. Successful CAS therefore truncates the file. Normal mode invents baseline `0L`. No current `saveDocument` caller was found: **latent data loss in the newly advertised frozen port**, not an observed active UI overwrite.

**Correction:** wire the port to the retained document/session save coordinator, using its exact ID, observed baseline, one snapshot and typed outcome. Do not retain a destructive placeholder implementation.

### C02 — Successful capped read can publish a truncated editable document after growth

**Evidence:** `EditorContentLoader.kt:72–93`; `EditorRepository.kt:49–66`; actual server range semantics `server/src/api/ws.rs:2539–2553`, `server/src/fs/ops.rs:174–213`.

Full-text ingress sends both `offset=0` and `len=1MiB` for a NORMAL stat. If the file grows to 2MiB before read, the real server correctly returns only the first 1MiB. Loader labels it EOF; repository merely changes tier to DEGRADED, without completing/revalidating the read. A later CAS save can replace the full file with the truncated prefix. Growth directly into LARGE has the same initial capped-success problem. The current growth test instead returns 1.1MB despite a 1MiB request, exercising an oversize-error branch, not production capped success.

**Correction:** prove complete editable ingress before publication, restat/reclassify at a saturated cap and perform the correct bounded read for the resulting tier; never treat a full range window as proof of EOF. Preserve actual read metadata and repeat growth checks without publishing partial text. Add a server-faithful capped-response regression.

### C03 — Captured discard consent does not protect newer edits

**Evidence:** `EditorTabsState.kt:363–388,457–505`.

`confirmClose(DISCARD)` ignores `CloseIntent.dirtyRevision` and closes immediately. Capture intent, type another edit, then confirm old Discard: the newer edit is destroyed. Forced discard/reload also bypasses **both** dirty and epoch checks at 473; an edit made while the reload is suspended is replaced at 476.

**Correction:** validate exact document ID and consented revision before close and again before reload publication, including explicit discard. Reject stale consent/reprompt; never bypass the newer-edit fence.

## Warnings

### W01 — High: C2 text-authority/per-edit allocation cutover is incomplete

**Evidence:** `EditorModels.kt:92–95`; `EditorSession.kt:47–60,129–160,201–219,244–290`; `EditorTabsState.kt:257–271,536–550`; `EditorDiagnosticsManager.kt:26–49`.

Editable tabs still mirror content, baseline and submitted strings. Session commands snapshot the entire document through `getText()` for the installed listener; listener republishes text to tab StateFlow and synchronously triggers diagnostics. Small documents get another whole snapshot; larger documents are validated as empty text, producing irrelevant diagnostics rather than disabling semantics. Find/replace still performs a separate string scan/rewrite after invoking native find; offset conversion repeatedly rescans the prefix. Deleted helper logic was substantially moved inline rather than fully delegated.

**Correction:** use document metadata/events for tab updates; remove editable tab text fields and legacy string/save overloads in the coordinated caller cutover. Delegate native search/edit operations. Disable active semantic invocation rather than validate fabricated empty content. Keep full snapshots at explicit ingress/save boundaries only.

### W02 — High: native edits do not publish tab metadata; saved revision is fabricated

**Evidence:** `EditorTabsState.kt:63–85,235–254,536–551`; `EditorSession.kt:35–36,147–160`; `EditorDocument.kt:94–104`.

No session/tab collector observes `EditorDocument.events` or its flows. Only wrapper commands invoke the session listener. A native widget editing the sole document updates its document flows but leaves `openTabs` dirty/revision state stale. `savedRevision` is always set equal to current revision even when dirty. There is also no explicit owner-dispatcher serialization of session/tab mutations or document-event listener lifetime.

**Correction:** attach a retained, incarnation-qualified metadata/event collector on the owner UI dispatcher; remove it deterministically. Track the real saved revision/save point. Apply each native/programmatic event once, without full-text copying.

### W03 — High: agreed retained-memory limits are not enforced

**Evidence:** `EditorTabsState.kt:41–46,199–255,338–358,420–428`; `interface-freeze.md:88–96`.

Opening always appends another tab/document. No admission check, aggregate accounting, clean-inactive eviction or actionable refusal exists. `getBudgetMetrics()` is unused in production coordination. Degraded documents receive the factory's default 200-action history rather than the frozen 50. `_saveOutcomes` is never pruned on close; large/binary previews also receive retained read-only documents when a factory is present.

**Correction:** implement the existing single policy: 64MiB accounted memory including submitted snapshots, max 8 documents and 2 degraded documents; native undo limits; safe clean-inactive eviction/restoration or explicit refusal. Retain dirty/unresolved buffers. Prune settled closed metadata/results and avoid unnecessary document authorities for bounded notices/ranges.

### W04 — High: incarnation checks cover only selected success callbacks

**Evidence:** `EditorTabsState.kt:227–291,295–327,409–455,457–500`; `EditorTabSaveCoordinator.kt:33–35,89–91`.

Load/reload/range errors still transform tabs by string key. Two range/reload requests on the same incarnation have no operation watermark; older success can overwrite newer state. No captured socket/retirement/document-revision fence governs publication. An old save whose session was disposed explicitly transforms the replacement tab by key to clear saving/submitted state. Success-only incarnation checks do not satisfy C1's all-completion contract.

**Correction:** capture owner, authority/socket, incarnation, operation ID and applicable revision/range epoch; validate before every success, error, cleanup and listener action. Dispose/cancel only the originating operation's resources. Add delayed success/error/cleanup regressions against actual state coordination.

### W05 — High: Unknown save loses the recovery snapshot and has no quarantine

**Evidence:** `EditorTabSaveCoordinator.kt:57–62,108–117`; `EditorRepository.kt:151–186`; `EditorTabsState.kt:409–450`; `FileRepository.kt:226–245`; `FsWriteCoordinator.kt:127–143`.

Normal Unknown calls `abortSave()`, clears submitted text and `isSaving`; no exact-path reservation is acquired/passed. The lower writer only records retained quarantine when a token is supplied. Subsequent saves remain eligible. Tabs reconstruct Unknown with synthetic `save-$key`/`overwrite-$key` IDs and hardcoded commit stage, losing original operation/stage; NotSubmitted becomes generic Error and then Rejected. No bounded byte reconciliation exists. Overwrite failures inconsistently retain the session snapshot without a settled/unresolved lifecycle.

**Correction:** preserve typed outcome identity end-to-end, acquire the owner/path reservation before saving, retain original submitted bytes/revision/baseline on Unknown, block conflicts/retries, and reconcile current bounded bytes before settlement. Release on definite outcomes only; do not flatten NotSubmitted into Rejected.

### W06 — High: binary/range handling still violates C3

**Evidence:** `EditorContentLoader.kt:24–41,56–69`; `FileTierPolicy.kt:106–152`; `FileRepository.kt:89–107,174–180`.

Range decoding drops incomplete trailing bytes without carry, uses lossy decoding for malformed middle/start sequences, reports consumed bytes as `receivedBytes`, and uses mtime as request epoch. No previous-window boundary metadata exists; a malformed incomplete EOF can yield empty text without EOF/error. Binary ingress calls `readFile(target,path)` with no explicit range and Base64-encodes the returned whole payload; it is not a small bounded notice/probe. Existing server/default client limits cap ordinary full reads around 5MiB, but that does not satisfy the 64KiB/probe contract or explicit wire bounds. Excessive/offset-only requests remain possible at the shared file boundary.

**Correction:** strict range decoder with at most three carried bytes, separate transport-consumed/display offsets, explicit malformed-EOF handling and bounded Back metadata. Enforce explicit normalized offset/length once for WS/REST, and binary/media noneditable notice/probe behavior. Add sequential split-codepoint/malformed cases, not just decoding one prefix.

### W07 — High: W1 logical ownership is only partially addressed

**Evidence:** `EditorTabsState.kt:88–96`; `EditorRepository.kt:98–129`; `FileRepository.kt:25–40`; `WorkbenchScreen.kt:293,308,882`; `EditorModels.kt:68–76`; `WorkspaceFileOwner.kt:35–39`.

New document construction includes all five owner fields, copying endpoint/account from the repository. However production repository construction still fabricates `authenticated-user` and wildcard project instead of authenticated session identity/exact target. New range/save ports discard ID profile/endpoint/account and reconstruct a target using only project/worktree, so a foreign same-project DocumentId can execute against this repository's server/account. Tabs accept an independent profile ID without verifying it matches repository ownership. Internal string-key routing remains unnormalized/delimiter-based rather than DocumentId-based.

**Correction:** construct from captured authenticated user/endpoint/exact target; reject any ID whose logical owner differs before stat/read/write; use normalized structured document identity internally. Remove the fabricated-owner constructor under coordinated ownership. Existing Workbench migration belongs to its assigned owner; do not silently claim W1 closed.

### W08 — High: explicit overwrite bypasses the privacy/input gate

**Evidence:** `EditorSession.kt:93–99`; `EditorTabSaveCoordinator.kt:74–88`; `PrivacyControllerTest.kt:137–178`.

When masked, `snapshotSave()` returns null, but overwrite falls back to `session.document.snapshotForSave()` and dispatches anyway. Unlike normal save, its fallback negates the session gate. Existing privacy tests cover `beginSave`, not the overwrite coordinator.

**Correction:** revalidate input/authority/read-only eligibility before either snapshot or dispatch. Never use direct document access as fallback for a denied command. Add a masked-overwrite test proving no transport submission.

### W09 — High: frozen lifecycle commands still contain no-op branches

**Evidence:** `EditorTabsState.kt:380–406`; `EditorTabsState.kt:19–26,235–255`; `WorkbenchScreen.kt:308`.

`confirmClose(SAVE)` does nothing; conflict RELOAD only clears flags; EXPLICIT_OVERWRITE does nothing. Alternate concrete methods do not implement the frozen port's behavior for its consumers. The factory is optional; the existing production caller omits it and a successful open then creates no session/document at all. All revised tab tests inject a factory, hiding this integration gap.

**Correction:** complete the frozen ports through the retained asynchronous coordinator/owner and expose meaningful pending/failure outcomes. Require document-factory injection and migrate the owning integration caller; no silent document-less success or constructor shim. Maintain owner-retained incarnation watermarks when replacing state owners; the per-instance counter alone does not establish reconnect monotonicity.

### W10 — High carryover: encrypted overwrite remains unconditional and socket-unqualified

**Evidence:** `EditorRepository.kt:191–201`; unchanged `EncryptedSaveCoordinator.kt:83–148`.

Encrypted explicit overwrite bypasses fresh-stat CAS via `fs:put_save`, consumes raw messages by reqId, and reports ordinary Error for some post-send failures. It does not inherit safe conditional overwrite or exact-socket ambiguity semantics from plaintext. This is existing code still reached by Phase 03, not a newly introduced implementation in that file.

**Correction:** route encrypted overwrite through supported fresh-stat conditional encrypted save and preserve captured socket/crypto owner/outcome; reject unsupported safe overwrite rather than silently using an unconditional path. Keep encrypted-request fail-closed behavior.

### W11 — Medium: selection/replace behavior is not faithfully delegated

**Evidence:** `EditorSession.kt:163–168,222–255`; `EditorTabsState.kt:189–194`.

`setCursorAndSelection` sends the cursor (the caller's selection end) as the native selection start and `sel.end` as its end, collapsing requested selections. `replaceCurrent` always finds the first occurrence, ignoring the current native match selected by next/previous; find navigation returns zero-length ranges. Existing test checks that the first occurrence changed, so it cannot catch wrong-current replacement.

**Correction:** preserve actual start/end selection and native selected-match commands. Test selecting a non-first occurrence and replacing only that match; avoid rebuilding a competing full-text search model.

## Test Evidence and Carryovers

**W5 remains incomplete despite 38 passing tests.** `EditorSaveRaceTest.kt:44–138` directly calls session snapshot/completion, checks two sequential incarnation IDs without delivering an old callback, and simulates CAS by calling `abortSave()` without a save/rejection. These are not network/save-coordinator race proofs. No test shown covers old socket completion, Unknown quarantine, forced reload newer-edit protection, saturated successful ingress growth, aggregate memory refusal, or a foreign-ID save/range.

The test double also has a correctness defect: `TestEditorDocument.kt:314–319` records *current* text when marking an *older submitted revision* saved. Undo/redo dirtiness at 140/170 compares against that text. Submit A, type B, confirm A: undo to A remains dirty and redo to unsaved B becomes clean. Existing tests stop before undo/redo across this save. Repair the double's save-point semantics and test the actual submitted point. Its undo metric excludes redo and permits one snapshot over budget (`187–195,327–334`); a metrics-positive test does not qualify retention enforcement.

| Carryover | Disposition |
|---|---|
| W1 owner construction | Partial: five fields exist in new IDs/tests, but actual authenticated/exact production construction and foreign-ID rejection remain open (W07). |
| W2 bounded wire/growth | Partial: editable/range loader calls now send explicit bounds; successful capped growth can truncate, binary/shared optional bounds remain, UTF-8 range contract incomplete (C02/W06). |
| W5 boundary/race evidence | Not closed: 38 focused tests green, but named safety behavior is largely unexercised; double's save-point error invalidates stronger claims. |

All three Phase 03 task acceptance groups remain incomplete from inspected source. No TODO/FIXME marker was found in scoped implementation/tests, but destructive placeholders and no-op command branches remain; absence of TODO text is not completion. Phase/task status intentionally unchanged by reviewer.

## Suggestions and Positive Observations

- Keep document injection and deletion of competing shared undo storage. Remove the remaining legacy text facade rather than add another abstraction layer.
- Keep strict editable UTF-8 rejection, fixed tier thresholds, cancellation propagation in repository loads, same-owner transports and fresh-stat plaintext conditional overwrite.
- Keep monotonically increasing incarnations within a retained tabs instance and success-side load checks; expand them to every completion and owner lifetime.
- After correctness fixes, consolidate duplicated save/overwrite outcome mapping, replace message-substring growth detection with existing typed classifications, remove unused parameters/locals, and remove growth-test println/stack-trace scaffolding. Do not broaden into semantic services or unrelated transport rewrites.

## Reviewed Files

All 17 assigned modified/created/deleted files reviewed; approximately 3,000 scoped source/test lines plus supporting contracts/callers.

Production root `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/`:
- `EditorSession.kt`, `EditorModels.kt`, `EditorContentLoader.kt`, `EditorRepository.kt`, `EditorResults.kt`, `EditorTabsState.kt`, `EditorTabSaveCoordinator.kt`, `EditorDiagnosticsManager.kt`.
- Deleted `EditorUndoManager.kt`, `EditorFindReplaceHelper.kt`, `EditorPositionHelper.kt` reviewed through Git diff; no remaining references found in searched production sources.

Tests under `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`:
- `features/editor/TestEditorDocument.kt`, `EditorSessionTest.kt`, `EditorRepositoryTest.kt`, `EditorTabsStateTest.kt`, `EditorSaveRaceTest.kt`.
- `core/security/PrivacyControllerTest.kt`.

Supporting evidence: `EditorDocument.kt`, `EditorSessionPorts.kt`, `FileTierPolicy.kt`, `EncryptedSaveCoordinator.kt`, `LargeFileView.kt`, `FileTierPolicyTest.kt`; `files/FileRepository.kt`, `FsWriteCoordinator.kt`; `workspace/WorkspaceFileOwner.kt`; relevant `WorkbenchScreen.kt`, server `api/{ws,fs}.rs` and `fs/ops.rs`; Phase 03 plan, C1–C4, interface freeze, prior Phase 02 Cycle 3 review; README, PDR, code standards, Android/system architecture and installed code-review/workflow guidance.

## Validation Commands / Results

Reviewer exercised source reads/searches and `git diff --stat` / scoped `git diff -- <paths>`. No build/test/lint run by reviewer; avoided duplicate work with assigned tester. Advisor consulted on final assessment; advisory output is not validation evidence.

**Peer-reported by `phase03TestValidation`, not independently executed by reviewer:**

```text
powershell -NoProfile -Command ".\native-app\gradlew.bat -p native-app :shared:jvmTest --tests '*EditorSessionTest*' --tests '*PrivacyControllerTest*' --tests '*FileTierPolicyTest*' --tests '*EditorRepositoryTest*' --tests '*EncryptedSaveCoordinatorTest*' --tests '*EditorTabsStateTest*' --tests '*EditorSaveRaceTest*'"
```

Reported **BUILD SUCCESSFUL in 6s**, `:shared:jvmTest` executed, **38 passed / 0 failed / 0 skipped**, no retries. Breakdown: session 6, privacy 8, tier 4, repository 7, encrypted save 3, tabs 7, save race 3. This is narrower than the earlier Phase 02 85-test scope and does not establish its full regression gate.

No Android build/device/native allocation, live-server save/race, full suite or lint results supplied. Type/test coverage percentages unavailable; do not infer coverage from test count.

## Unresolved Questions / Evidence

- Main must obtain behavioral regressions for C01–C03 and W01–W11 before Phase 03 acceptance; existing focused green tests do not close these source-proven gaps.
- Which retained integration owner supplies required document factory, logical owner, dispatcher and incarnation watermark when Phase 05 callers land? Current production construction does not establish that contract; cross-phase readiness remains unqualified.
- Android event/IME/widget retention, heap ceilings, API 29/arm64 and distribution qualification remain downstream evidence, not results of the JVM double. No new product decision is needed for the cited contract corrections.
