# Acceptance traceability and future qualification

[Canonical overview](plan.md) owns scope/readiness; [contracts](contracts.md) define safety semantics. Source: approved brainstorm journeys1–10, unchanged. **All checks below are future work, none executed during planning.** Tests named below are existing suites to extend or proposed permanent behavioral suites, not claims they exist/pass. Exact ownership/actions in linked phases; Main coordinates one coherent verification after writers settle.

## Journey-to-deliverable matrix

| Approved journey | Required tasks / phases | Lowest reliable permanent behavior coverage | Actual app/server/device evidence |
|---|---|---|---|
| 1. Authenticate → projects → Files → nested file → edit/save/reopen | `mount-focused-workspace-and-guard-departures` P07; `implement-incarnation-safe-tabs-saves` P03; `bridge-shared-editor-presentation` P05; `author-active-app-server-journeys` P08 | EditorTabsStateTest, EditorRepositoryTest, WorkspaceDepartureTest | Installed MainActivity; visible login/project/panel flow; read exact target server bytes before/after; close/reopen same path. |
| 2. All management actions, descendant identity, failures | `implement-focused-explorer-actions` P04; `integrate-subtree-mutation-transactions`, `integrate-unknown-outcome-reconciliation` P06 | FileMutationCoordinatorTest, FileEditorMutationTest, FileOperationArbiterTest | Real create file/folder, rename, explicit move, copy remote path, cancel/confirm delete; directory descendants/open tabs; server rejects root/.git without optimistic rekey. |
| 3. Multiple documents, undo/view state, close safety, rotation | `implement-document-backed-sessions` P03; `implement-android-native-document` P05; `retain-native-workspace-runtime` P07 | EditorSessionTest, EditorTabsStateTest, WorkspaceDepartureTest, AndroidEditorDocumentTest | Different text/undo/selection/scroll per tab across panel switches and actual Activity recreation; Save/Discard/Cancel; failed/unknown close-save leaves route/draft. |
| 4. External changes/conflicts/reload/overwrite | `implement-shared-directory-watchers` P04; `implement-incarnation-safe-tabs-saves` P03; `integrate-unknown-outcome-reconciliation` P06 | FileWatchCoordinatorTest, EditorSaveRaceTest, EditorTabsStateTest | External server write: clean reload, dirty stale; normal save does not overwrite; fresh-stat overwrite conditional; revision-safe Reload/Cancel. |
| 5. Every named race and uncertain result | `implement-incarnation-safe-tabs-saves` P03; both P06 tasks | EditorSaveRaceTest, FileEditorMutationTest, FileOperationArbiterTest | Real committed write/op with lost/delayed result; reconnect; inspect source AND destination/bytes; preserve safe unresolved state where protocol cannot prove outcome. |
| 6. Cross-profile/project/worktree isolation and retirement | `freeze-file-owner-and-operation-boundary` P02; `implement-incarnation-safe-tabs-saves` P03; `retain-native-workspace-runtime` P07 | FileRepositoryTest, ApiClientTest, WsConnectionTest, EditorTabsStateTest, ProjectWorkspaceStateTest | Two profiles (including distinct endpoint/account identity), two projects/worktrees, identical relative paths/labels and different sentinel bytes. Transport-origin socket envelope/expected-socket dispatch rejects retired authority; original drafts stay detached. |
| 7. Nested watches, lifecycle/socket/overflow | `freeze-file-owner-and-operation-boundary` P02; `implement-shared-directory-watchers` P04; `retain-native-workspace-runtime` P07 | WsConnectionTest, FileWatchCoordinatorTest, FileTreeStateTest | External nested changes; collapse with open-file parent demand; background/foreground; replace socket/reuse subId; overflow drops/recreates subscriptions then refetches; bounded queues and transport-stamped event origin. |
| 8. Native widget/IME/find/input isolation/current PTY | both P05 tasks; `retain-current-terminal-panel` P07 | AndroidEditorDocumentTest, EditorDocumentQualification, ProjectTerminalVisibilityTest; current terminal replay/controller/presentation suites | Real CodeEditor multiline composing IME/selection/paste/undo/redo/find; hide each panel while IME/paste/reconnect pending; hidden PTY/editor receives nothing; same PTY/font/pinch/scroll/replay preserved. |
| 9. Thresholds, binary/media/invalid text, encrypted fail-closed | `implement-bounded-tiered-loading` P03; `freeze-file-owner-and-operation-boundary` P02; `bridge-shared-editor-presentation` P05 | FileTierPolicyTest, EditorRepositoryTest, FileRepositoryTest, EncryptedSaveCoordinatorTest | Exact boundary fixtures and growing file; no whole large read/save; invalid UTF-8 noneditable; unsupported notices; invalid/missing/retired crypto session yields zero plaintext dispatch. |
| 10. Exact graph, Android29/ABIs, visual/IME and distribution | both P01 tasks; `qualify-integrated-runtime`, `document-qualified-scope-and-distribution`, `finalize-editor-explorer-acceptance` P08 | Actual dependency resolution/build, native mounted instrumentation and artifact inspection, not static assertions | Exact uppercase Rosemoe0.23.4 graph; Android29/x86_64 and arm64-v8a qualification; screenshots/video/memory; license/source/notices/relink mechanism demonstrated before release. |

## Detailed scenarios and observable outcomes

### 01 — Reachable browse/edit loop
1. Start installed debug app at real MainActivity, authenticate with isolated fixture, select profile/project. Verify one project header and one inline Terminal/Files/Editor row; Files opens through visible UI, not a test-only screen.
2. Expand nested folder lazily; exercise loading/empty/hidden files/refresh/selection, open normal UTF-8 file and observe native line numbers and verified syntax/plain text.
3. Edit, save, independently read bytes from selected server/project/worktree, close/reopen. Assert correct content and no write to same relative path in other fixture roots. Opening already-open file focuses original document, no duplicate tab.
4. Disconnect/target unavailable and retry eligible reads; visible states honest, no wrong-profile fallback. Clipboard copy returns remote path, not device filesystem path.

### 02 — Confirmed mutations and failed identity changes
- Create file/folder then rename and move via explicit touch destination. Open parent and multiple descendant docs, including dirty docs and an open destination tab. Guard dirty affected revisions; cancel leaves tree/tab/session/undo unchanged.
- Confirmed directory rename/move atomically updates descendant keys/session paths/tree selection/watch demand, preserves document/undo/view identity and rejects old-path callbacks. Independently inspect source/destination and bytes.
- Delete confirmation Cancel sends nothing; confirmed delete reconciles tree/docs. External delete of dirty doc retains unavailable text; Save cannot recreate it.
- Server rejection/invalid target/root/.git leaves original identity/dialog values; fs:op force_git never bypasses protections. Note streamed-write protection differs; do not call client validation security enforcement.

### 03 — Document retention and dirty departure
- Open several normal/degraded docs, unique edits and undo histories; move between panels, tabs and actual ActivityScenario recreation/rotation. Verify text, dirty state, selection/cursor/scroll/undo continue while old Activity/widget/listeners release.
- Close dirty tab or leave workspace: Save/Discard/Cancel; fail server save and lose postcommit response. Save must confirm all current revisions before close; late edits prevent departure. Cancel never clears selected PTY/project.
- Exercise finite retained-memory budget: clean inactive docs may unload with metadata, dirty/unresolved docs never silently evict; new open refused when preservation requires. Profile/auth runtime and route survive configuration change. Process kill is outside retention guarantee.

### 04 — External modification and conflict choices
- Change clean file externally while its parent is watched: safe clean reload resets native undo as explicit server replacement. Dirty doc becomes stale without replacement.
- Normal save with stale observed mtime conflicts; verify remote bytes unchanged. Cancel leaves dirty text. Reload with consent captures revision; new edits during read prevent replacement and reprompt.
- Explicit overwrite performs fresh stat and remains conditional. Change server again between stat and commit; conflict remains, no unconditional overwrite. Success applies submitted save-point but leaves later edits dirty.

### 05 — Race and outcome fault matrix
For each row capture owner/socket/incarnation/revision/op ID, trigger controlled completion order, and assert resulting document + independent server bytes where meaningful:

| Boundary | Interleaving | Required outcome |
|---|---|---|
| Save snapshot/result | Edit after snapshot before success | Submitted bytes saved; newer local revision dirty. |
| Load/reload/range/error/diagnostic | Close and reopen same path before old callback; begin newer request | Old incarnation/request cannot create session, replace text or clear replacement flags/errors. |
| Save result | Close/reopen and new save on same path | Old session/result cannot alter replacement document/baseline/saving flag. |
| Save vs subtree operation | Save in flight then rename/move/delete file/ancestor; reverse order too | Reservation waits/blocks conflict, no old-path write or self-deadlock; unrelated target/path not blocked. |
| Dirty prompt | Edit before final consent/dispatch; Save failure/Cancel | Consent revalidated; no loss, no premature path publication. |
| WS operation | Disconnect/retire before submission, begin, chunk, attempted commit/op dispatch, result | Correct NotSubmitted/Rejected/Confirmed/Unknown classification; cancellation after ambiguous dispatch retains quarantine. |
| Save unknown | Server commits, drop response, reconnect exact owner | Stat+bounded bytes reconcile submitted baseline, later edits dirty; no automatic retry. |
| Mutation unknown | Drop op result after server change; probe both old/new path; external writer recreates/collides | Original local identity/quarantine until sufficient proof; existence/matching metadata alone never confirms. Ambiguous directory op stays unresolved without duplicate dispatch. |
| Reconnect | New generation/socket, reused req/sub IDs and old completion | Writes require fresh exact-owner reconciliation; retired socket cannot publish/settle cleanup. |

### 06 — Full logical identity and revocable authority
- Two saved profiles with same display labels/path names but different endpoint/account; two projects and two worktrees per fixture with distinct sentinel bytes. Also change endpoint/account behind same profile ID. Key identity includes captured endpoint/account, never just label/profile ID.
- Open/dirty same relative path in each; verify text/undo/watch/save/mutation never bleed. Select another profile during load/save, auth expires during Save, return/reauth original owner. Detached drafts preserved, no retarget to new current selection.
- Old ConnectionRef generation and SocketInstanceRef callbacks/errors/listener cleanup rejected. Missing/unverifiable account owner disables rebind/writes rather than guessing. Fresh stat/current bytes required before writing after ordinary reconnect.

### 07 — Watch demand, event ordering and recovery
- Root plus two expanded nested dirs and two open documents sharing parent: exactly one subscription per demanded directory, no recursive assumption. Collapse retains only open-parent refs; close removes final demand.
- Event before subscribe response, slow list after newer event/newer list, missing target-relative routing, socket replacement with reused subId: final tree matches current server state, no absolute-path ambient fallback.
- Force server watcher overflow and bounded local early queue overflow; prove subscription recreated before refetch (server drops overflowed sub). No unbounded event/channel growth or duplicate listeners.
- Background app, mutate multiple loaded dirs/open files, foreground: resubscribe/reconcile tree and open-doc metadata before writes enabled. Clean files reload, dirty stale, deleted dirty unavailable. Record queue/subscription counts using test boundary state, not new production telemetry.

### 08 — Mounted native editor and preserved current terminal
- Use real soft keyboard: multiline composing text, selection handles, multiline paste, undo/redo and in-file find. Verify native syntax for qualified fixture and plain text for unsupported grammar, no fabricated semantic diagnostics. On panel switch or Activity recreation mid-composition, composition is finished or cancelled deterministically; committed text/undo/selection retained with no duplicated or lost characters. Uncommitted composition surviving recreation is not required.
- Begin composition/input, switch to Files/Terminal, reconnect/replay/attach/select session while Terminal hidden, then switch back. Hidden terminal/editor receives no key/paste/IME command; same PTY remains selected and remote byte/input capture unchanged by hidden attempt.
- Current VtTerminalSurface replay, atomic snapshots, FIFO input, resize, font10..32sp, font+4sp metrics, pinch/one-finger scroll, Diag/New Terminal controls retained. No old Workbench terminal path.
- Phone/tablet portrait/landscape with IME: one visible panel, inline row below shared project header and above keyboard, no duplicate header/FAB/second navigation. Actual Activity recreation preserves docs/runtime without retaining old Activity/widget.
- System Back, Projects, deep-link owner change and voluntary profile/project departure guard runs before navigation/session clearing. Forced auth loss revokes writes and retains detached buffers; it does not wait on impossible Save.

### 09 — Exact bytes and tier limits
- Generate valid UTF-8 fixtures of exactly1,048,575 /1,048,576 /1,048,577 and5,242,879 /5,242,880 /5,242,881 bytes, with multibyte sequences adjacent to size/range boundaries. Actual response bytes, not fixture labels/stat alone, determine tier.
- Grow file between stat/read; server/fallback response larger than requested; malformed Base64; invalid interior UTF-8; incomplete EOF sequence; split2/3/4-byte sequences at65,536-byte boundaries. Reject invalid/oversize editable publication, never lossy-save; range traversal loses/duplicates no bytes and stays bounded.
- Large binary/media before size tier: bounded notice/probe, no whole Base64/hex/media preview load. Read-only, invalid text, unsupported and unavailable tabs cannot invoke save. REST fallback retains offset+len, strict bytes and same authority; auth/owner/semantic errors do not widen/fallback.
- Missing/invalid/retired owner-bound crypto session with encryptedRequested: no plaintext request sent. No claim of server project encryption policy or new enrollment readiness.

### 10 — Version, device and legal release gates
- Exact `io.github.Rosemoe.sora-editor:editor:0.23.4` resolved with verified pinned grammar coordinates/API/asset inventory; retain prerelease risk and Java17/minSdk29 baseline. Source links/POM are evidence of identity only, not runtime compatibility.
- Build debug/runtime graph and both declared ABIs; run Android29 x86_64 emulator and arm64-v8a target and record exact API/ABI/device/IME. Missing target blocks required qualification. Capture mounted editor visual/IME/rotation and memory/allocation evidence near tiers/multi-document budgets; no thresholds silently relaxed.
- Inventory editor/transitive/grammar licenses; preserve copyright/notices, exact source/version provenance and required source access/offer. Demonstrate user modification/relink/replacement mechanism and distribution materials on actual packaged artifact. AAR packaging alone is not proof of dynamic linking or compliance. Unqualified mechanism blocks release.
- Keep broader native-release rich preview/TypeScript semantic/language-service obligations open in related plan/docs. Syntax highlighting and this focused increment do not satisfy/delete them.

## Planned execution commands and evidence discipline

From repository root, after all feature writers settle (not during planning):

```powershell
.\native-app\gradlew.bat -p native-app :androidApp:dependencyInsight --configuration debugRuntimeClasspath --dependency editor
.\native-app\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:lintDebug
.\native-app\gradlew.bat -p native-app :androidApp:connectedDebugAndroidTest
```

- Targeted suite commands are in phases. Common test root: `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`; native tests: `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/`. Exact new/existing file ownership in task records, no broad write permission from these roots.
- Use existing Rust server APIs with disposable isolated fixtures and explicit `--host 127.0.0.1`; never use convenience dev scripts that bind no-auth on all interfaces. Real authenticated cases exercise account/reauth; unauthenticated loopback fixtures cannot certify those paths. No server code/test edits required.
- Record per-command exit/results, fixture/server/device/API/ABI/IME/version, server byte evidence, fault location, screenshot/video/memory evidence and independent review status. `qualify-integrated-runtime` owns runtime-qualification.md and records failures/blockers even if its gate cannot complete; downstream docs do not gate failure reporting. Never fabricate result, turn skip into pass or report model tests as UI proof.
- Parent owns planning source.load/schema/DAG/ownership review and independent plan challenge. Implementation Main owns integrated runtime qualification, reviewer evidence and eventual task-state lifecycle only when separately authorized.

## Unresolved questions

No new product-scope question. Exact pinned native Content/undo/language APIs and retention feasibility are phase01 blockers; real device/server/Android29/ABIs and distribution/relinking evidence are phase08 gates. No runtime gate has been exercised by this plan.
