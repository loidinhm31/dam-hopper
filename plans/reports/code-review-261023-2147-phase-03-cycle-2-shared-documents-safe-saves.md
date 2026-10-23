# Phase 03 Cycle 2 — Shared documents, bounded loading and safe saves

## Assessment

**Score: 4/10 — changes required; Phase 03 acceptance remains incomplete.**

Review-only: no source/test/plan/task-state edits. Main retains integration/status ownership. Reviewed security, data integrity, ownership, resource bounds, architecture and YAGNI/KISS/DRY against Phase 03 and contracts C1–C4. Failure sequences below are source-derived, not dynamically reproduced by this reviewer. Confidence high unless qualified.

**Cycle 1 fix disposition:**
- Original unconditional-empty save implementation removed: `saveDocument` captures actual document bytes/baseline and marks the captured revision saved on confirmed outcome. Eligibility/lifecycle integration remains unsafe (C02 below).
- Initial successful saturated NORMAL read now restats and handles a single growth into DEGRADED/LARGE. Reclassification is not applied to subsequent reads (C03 below).
- Stale Discard consent now rejects a newer document revision; reload success now rejects edits made during the request (`EditorTabsState.kt:384–399,467–503`). New Discard regression exists. No delayed reload regression was found.

The separate Workbench is not mounted by the active root, per `docs/code-standards.md:59` and `docs/project-overview-pdr.md:43`. Its missing factory is an integration gap, not evidence of an active-root regression. Factory-backed paths are nevertheless required by the frozen ports and exercised through the JVM boundary.

## Critical issues

### C01 — Reload can convert a large-file preview into an editable replacement

**Evidence:** `EditorTabsState.kt:467–500`; `EditorSession.kt:20,72–81`; `EditorRepository.kt:46–47`; `EditorTabSaveCoordinator.kt:17–32`.

Open a clean NORMAL document, then let the remote file grow to >=5 MiB. Watcher reload receives a LARGE result containing only its first 64 KiB. Reload blindly calls `loadServerContent(res.content, res.mtime)` while leaving the old NORMAL tier, size, range metadata and session read-only state unchanged. The prefix becomes the authoritative editable document with the new server baseline. Edit and save: normal guards pass, and matching CAS can replace the large file with that prefix.

**Correction:** handle reclassification before document replacement. Transition to a noneditable bounded range/notice model and update all capabilities/metadata atomically; never load a partial read-only result into an editable authority. Add clean NORMAL→LARGE and NORMAL→binary reload regressions, including subsequent save denial.

### C02 — Frozen save port bypasses eligibility and can save a preview/notice over the file

**Evidence:** `EditorRepository.kt:126–159`; `EditorTabsState.kt:239–258`; `EditorDocument.kt:102,125`; `TestEditorDocument.kt:304–311`.

The real snapshot fixes the empty-placeholder bug for editable documents, but `saveDocument` never checks read-only, availability, input/privacy or save-in-flight state. Tabs create documents for read-only LARGE/media/binary results too. Their snapshots can contain only a 64 KiB preview or empty notice. Calling the advertised save port, especially explicit overwrite with fresh-stat CAS, can replace the entire file with that incomplete content. A document snapshot is not authorization to save it. No production caller of this port was found: **latent destructive API-contract defect**, not an observed mounted UI overwrite.

This second save path also skips tab saving/outcome publication and encrypted-session policy; confirmed `markSaved` occurs without rechecking the retained session/authority.

**Correction:** route the frozen port through the same exact-ID, eligibility-gated retained save coordinator. Reject noneditable/unavailable documents and preserve privacy, encryption, operation state and completion fences. Test that LARGE/binary/media and masked saves dispatch no write; test actual submitted bytes, observed baseline and confirmed save-point behavior.

### C03 — Growth re-read can still publish a capped editable file

**Evidence:** `EditorRepository.kt:51–77,85–90`; `EditorContentLoader.kt:72–93`; `server/src/api/ws.rs:2531–2553,2583–2590`; `server/src/fs/ops.rs:174–213`.

NORMAL read returns exactly 1 MiB; restat reports 2 MiB; DEGRADED retry then encounters a file that has grown beyond 5 MiB. The server correctly returns exactly the requested 5 MiB. Calls at repository lines 63, 76 and 90 return that `loadFullText` result directly, bypassing the >=5 MiB check applied only to the first result. Loader labels it editable DEGRADED and EOF. WS response mtime can describe the grown file, allowing a later CAS save to truncate it. An initial DEGRADED read's cutoff branch is protected; its unchecked retry counterparts are not.

Also, growth to exactly 1 MiB with restat size equal to received bytes returns the original NORMAL result at lines 58–66, violating the exact tier threshold.

**Correction:** apply one common publication/classification gate to every read result, including re-reads. Reject/reclassify actual bytes at the read-only cutoff and fail closed if completeness cannot be established; do not publish capped text as EOF. Reuse typed oversize/classification outcomes instead of duplicating message-substring exception branches. Add server-faithful capped-response tests for one growth, repeated growth and exact thresholds.

## Warnings

### W01 — High: per-edit full-text copying and competing search remain
- `EditorSession.kt:47–69,129–160,201–290`, `EditorModels.kt:92–94`, `EditorTabsState.kt:548–562`, `EditorDiagnosticsManager.kt:34–47`.
- Edits/undo/redo snapshot and decode the whole document, then republish text into tab StateFlow; tabs retain current/saved/submitted strings. Find scans a full snapshot after native find, repeatedly rescans prefixes, and replace rebuilds text. Diagnostics still run and snapshot smaller documents; larger files are validated as fabricated empty content rather than disabling invocation.
- **Impact:** violates the sole-authority/allocation contract; avoidable edit latency, GC and duplicate behavior. **Correction:** metadata-only document events, native command delegation, removal of legacy text/save overloads and active semantic invocation in the coordinated cutover.

### W02 — High: native edits do not publish metadata; saved revision is fabricated
- `EditorTabsState.kt:67–86,548–563`; `EditorSession.kt:35–36,147–160`; `EditorDocument.kt:94–104`.
- No document event/flow collector exists in these coordinators. Only wrapper commands invoke the content listener. Native widget edits can therefore leave `openTabs` dirty/revision metadata stale. `savedRevision` is always current revision, even when dirty. Owner-dispatcher serialization/listener lifetime is not established.
- **Correction:** retain an exact-incarnation event collector on the owner UI dispatcher, publish metadata once per delta, track the real save point and remove collectors deterministically.

### W03 — High: frozen retained-memory budget is not enforced
- `EditorTabsState.kt:41–46,203–258,342–362`; `interface-freeze.md:88–96`.
- No 64 MiB / 8-document / 2-degraded admission, accounting, clean-inactive eviction or refusal. DEGRADED creation uses the default 200 undo actions rather than 50. Production coordination never calls `getBudgetMetrics`; settled `_saveOutcomes` remain after close.
- **Correction:** enforce the existing single budget policy, including submitted snapshots, preserve dirty/unresolved buffers and avoid allocating document authorities for notices/ranges. Positive metrics assertions are not retention enforcement.

### W04 — High: async fencing is still success-only and incomplete
- `EditorTabsState.kt:288–329,419–465,505–511`; `EditorTabSaveCoordinator.kt:33–35,89–91`.
- Open/reload/range errors update by key only; two requests within one incarnation have no operation watermark. Old save cleanup explicitly transforms a replacement tab when the original session is disposed. No captured retirement/socket authority guards all publications.
- **Correction:** validate owner/authority, incarnation, operation ID and applicable revision/range epoch before every success/error/cleanup. Preserve existing lower socket-qualified transport behavior; do not claim it fences tab state automatically. Add delayed success, error and cleanup delivery tests against the actual coordinator.

### W05 — High: Unknown saves discard recovery state and do not reserve/quarantine the path
- `EditorTabSaveCoordinator.kt:57–62,108–117`; `EditorRepository.kt:143–148,175–209`; `EditorTabsState.kt:430–438,454–462`; `FileRepository.kt:226–245`; `FsWriteCoordinator.kt:127–143`.
- Normal Unknown clears the submitted snapshot; no save path acquires/passes an exact-path reservation token. Lower quarantine requires that token. Subsequent actions remain eligible. Legacy mapping loses original stage/op ID and turns NotSubmitted into generic Error/Rejected; tabs manufacture IDs/stages.
- **Correction:** retain submitted bytes/revision/baseline and reservation for Unknown; preserve typed outcomes/identity, block conflicting actions and release only on definite settlement. Phase 06 reconciliation needs this retained state; do not replace it with automatic retry. Global per-tabs save mutex is not path arbitration.

### W06 — High: range UTF-8 and binary ingress still violate bounded-read contracts
- `EditorContentLoader.kt:24–40,56–69`; `FileTierPolicy.kt:106–152`.
- Decoder drops incomplete trailing bytes, lossily decodes malformed sequences and reports consumed bytes as received bytes. No carry/previous-window metadata exists; malformed incomplete EOF can fail to advance or terminate. Epoch is mtime, not a request epoch. Binary ingress has no explicit offset/len and retains Base64 payload instead of a bounded notice/probe. Existing default 5 MiB file cap is not the required probe bound.
- **Correction:** strict decode with <=3 carried bytes, distinct transport/display offsets and malformed-EOF handling, bounded Back metadata and request fencing; explicit bounded binary probe or notice only.

### W07 — High: logical owner enforcement remains partial
- `EditorRepository.kt:109–127`; `EditorTabsState.kt:92–100`; `FileRepository.kt:25–40,60–65`; `WorkbenchScreen.kt:293,308`.
- Range port discards ID profile/endpoint/account and projects only project/worktree onto this repository's server. Lower target checking cannot detect a foreign same-project owner. New save lookup rejects foreign IDs with the installed exact-match provider, an improvement; the repository still does not itself enforce that invariant. Production construction still fabricates account identity and wildcard project; tabs accept a separate profile ID.
- **Correction:** capture real authenticated/exact owner, validate complete identity and snapshot ID before IO/publication, use structured normalized internal keys. Production caller migration remains assigned integration work, not evidence of completion.

### W08 — High: privacy bypass and encrypted-overwrite carryover
- `EditorTabSaveCoordinator.kt:74–88`; `EditorSession.kt:93–99`; `EditorRepository.kt:221–225`; `EncryptedSaveCoordinator.kt:83–148`.
- Explicit overwrite falls back to direct document snapshot when session snapshot denies masked input, thereby bypassing the gate. Encrypted overwrite still uses unconditional `fs:put_save`, raw incoming messages and generic Error for some post-send failures, unlike fresh-stat conditional plaintext overwrite.
- **Correction:** never convert denied snapshot to permission via fallback; revalidate input/authority before dispatch. Use supported conditional encrypted overwrite and socket-qualified outcomes, or reject unsupported safe overwrite. Keep missing-crypto fail-closed behavior.

### W09 — High: lifecycle ports contain no-ops and factory injection remains optional
- `EditorTabsState.kt:22,239–259,395–415`; `WorkbenchScreen.kt:308`.
- `confirmClose(SAVE)` does nothing; conflict RELOAD merely clears flags; EXPLICIT_OVERWRITE does nothing. Existing Workbench construction omits factory, yielding successful opens with no sessions; save fails and reload returns early. This caller is dormant, but the new focused UI must not inherit that contract gap.
- **Correction:** implement retained asynchronous lifecycle actions behind the frozen ports; require real factory injection in the assigned caller cutover. Do not claim successful document-less opening or require UI to bypass frozen ports via concrete helpers.

### W10 — High/Medium: replacement and selection behavior is incorrect
- `EditorSession.kt:62–65,163–168,222–255`; `TestEditorDocument.kt:77–83,364–374`.
- `setText` uses fixed end column 100,000, so a longer last line retains its suffix under the current faithful boundary; `replaceAll` uses this method. Correct native end-position handling remains unverified without the platform implementation.
- `setCursorAndSelection` uses the selection end as both native endpoints; `replaceCurrent` replaces the first string occurrence regardless of selected native match; navigation returns zero-length ranges.
- **Correction:** derive valid full-document bounds without a magic column and preserve actual native selection/current-match semantics. Test >100k-column text and replacement of a non-first match.

### W11 — High evidence gap: green tests do not prove the claimed fixes/races
- `EditorRepositoryTest.kt:133–164,189–203` still returns 1.1 MB despite a 1 MiB request, rather than testing successful saturated reads. New save-port test only accepts disconnected Rejected/NotSubmitted; it inspects no submitted bytes/mtime/markSaved.
- `EditorSaveRaceTest.kt:44–138` manually completes a session snapshot, compares sequential incarnations without delivering an old callback, and simulates conflict with `abortSave()` without a save. No delayed reload test was found.
- `TestEditorDocument.kt:314–319` records current text when an older submitted revision is marked saved; undo/redo compare against that text at 140/170. Submit A, edit B, confirm A: undo to A remains dirty and redo to unsaved B can become clean.
- **Correction:** repair the double's submitted save-point semantics; exercise real coordinator/port dispatch and controlled callback ordering. Add the missing capped-growth, tier-changing reload, noneditable save denial, Unknown reservation, old-socket and memory-pressure tests. Test names/counts are not behavioral evidence.

## Suggestions / positive observations

1. Address C01–C03 before acceptance; avoid another parallel save implementation or compatibility shim.
2. Keep actual snapshot revision/baseline capture, initial saturation restat, discard/newer-edit fencing, strict editable UTF-8 rejection, and cancellation propagation in load paths.
3. Consolidate duplicate save/overwrite outcome mapping and read reclassification only after restoring the contracts. Remove unused parameters/locals and misleading guarantees; do not broaden into semantic service work.
4. Keep test-only document injection and removal of shared undo storage; finish native event/metadata delegation instead of moving string helpers inline.

## Reviewed files

Production root `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/`:
- `EditorRepository.kt`, `EditorContentLoader.kt`, `EditorTabsState.kt`, `EditorSession.kt`, `EditorTabSaveCoordinator.kt`, `EditorDiagnosticsManager.kt`, `EditorModels.kt` (tab/key sections).
- Supporting `EditorDocument.kt`, `EditorSessionPorts.kt`, `FileTierPolicy.kt`, `EncryptedSaveCoordinator.kt` (save/overwrite outcome sections).

Tests under `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`:
- `features/editor/EditorRepositoryTest.kt`, `EditorTabsStateTest.kt`, `EditorSessionTest.kt`, `EditorSaveRaceTest.kt`, relevant `TestEditorDocument.kt` sections.
- `core/security/PrivacyControllerTest.kt:137–178`.

Additional supporting sections: `files/FileRepository.kt`, `files/FsWriteCoordinator.kt`, `ui/screens/WorkbenchScreen.kt`; `server/src/fs/ops.rs`, `server/src/api/ws.rs`; Phase 03 plan/contracts/interface freeze/prior review; README, PDR, code standards, published development rules and code-review skill. Approximately 2,700 source/test lines plus supporting documentation inspected. No full-codebase or platform implementation review claimed.

## Validation commands / results

**Reviewer executed:** source reads/searches; `git diff --stat`; scoped `git diff --` for repository, content loader and tabs state. No reviewer build/test/lint or dynamic reproduction; avoided duplicating the assigned tester. Advisor consulted; advisory claims independently filtered against inspected source, not used as verification evidence.

**Peer-reported by `phase03TestValidation2`, not independently executed by reviewer:**

```text
powershell -NoProfile -Command ".\native-app\gradlew.bat -p native-app :shared:jvmTest --tests '*EditorSessionTest*' --tests '*PrivacyControllerTest*' --tests '*FileTierPolicyTest*' --tests '*EditorRepositoryTest*' --tests '*EncryptedSaveCoordinatorTest*' --tests '*EditorTabsStateTest*' --tests '*EditorSaveRaceTest*'"
```

First run: BUILD SUCCESSFUL, `:shared:jvmTest UP-TO-DATE`; not fresh test execution. Same command then run with `--rerun-tasks`: BUILD SUCCESSFUL, 8 tasks executed, **40 passed / 0 failed / 0 skipped**. Breakdown: Session 6, Privacy 8, FileTier 4, Repository 8, EncryptedSaveCoordinator 3, TabsState 8, SaveRace 3. No test failure or retry-to-green reported; the second run forced execution after the up-to-date result.

No lint, Android build/device, native allocation, full-suite, live-server save or socket/race qualification supplied. Type/test coverage percentages unavailable. Focused JVM success does not satisfy all Phase 03 behavioral acceptance; all three task groups still have source-backed gaps. Plans/task state intentionally unchanged under review-only ownership.

## Unresolved questions / evidence

- Main must obtain the missing coordinator/port regressions and integrated Phase 03/04/05 compilation/caller evidence before marking acceptance complete.
- Factory/real authenticated owner/owner dispatcher must be supplied by the assigned retained integration owner. Current dormant Workbench construction does not establish them.
- Native event/IME/widget retention, heap ceilings and device/distribution gates remain downstream evidence, not results of the JVM double. No additional product decision is needed to correct the cited contract violations.
