# Phase 02 Frozen Common Contracts — Cycle 3 Code Review

## Assessment

**Score: 6/10 — changes required; do not freeze Phase 02 yet.**

Source fixes resolve the padded Base64 arithmetic and direct editor outcome mapping. Captured-handle subscription cleanup and endpoint validation improve. Prior ownership, read-bound, existing-caller migration and behavioral-evidence findings remain incomplete.

- Critical issues: none identified in inspected scope.
- High warnings: 4; medium warnings: 2.
- Review-only: no product, test, plan or task-state edits. Main owns integration/status.
- Workbench is dormant, not the mounted terminal root. Findings about its callers do not establish an active-root regression.

## Cycle 2 Resolution

| Prior finding | Cycle 3 evidence | Disposition |
|---|---|---|
| Padding-aware Base64 length | `FileRepository.kt:119-129` subtracts terminal padding before predecode bound, then checks actual bytes | Source resolved; exact-limit WS regression missing |
| Direct EditorRepository outcomes | `EditorRepository.kt:72-109` maps Confirmed, CAS_CONFLICT Rejected, Unknown and NotSubmitted directly | Direct plaintext editor mapping resolved; remaining legacy callers/reservations W3 |
| Socket-qualified cleanup | `FileTreeSubscription.kt:41,146,153-171,189-196` keys cleanup by captured socket/subId | Cross-socket stale-handle collision resolved in source; null-origin/raw consumer paths remain W4; no reused-ID regression |
| Unpinned constructor/baseUrl | `FileRepository.kt:25-57` changes default project to `*`, account to `authenticated-user`, validates both endpoints | Endpoint check resolved; wildcard workaround is not exact authenticated ownership, W1 |
| Behavioral tests | Existing REST bounds, UTF-8, child-token and correlator tests remain; editor gains disconnected-save test | Incomplete, W5; focused green suite does not close absent scenarios |
| Explicit bounded wire reads | `FileRepository.kt:92-107,174-177` still forwards optional/unclamped bounds | Unresolved, W2 |

## Critical Issues

None identified. No full-server security, Android runtime or release qualification claim.

## Warnings

### W1 — High: fabricated account and wildcard project remain in production repository construction

**Evidence:** `FileRepository.kt:25-40`; `WorkspaceFileOwner.kt:35-39`; `WorkbenchScreen.kt:293,882`; C1 `contracts.md:7-12`.

The secondary constructor still invents account identity (`authenticated-user`) instead of using the authenticated session. `project = "*"` avoids non-default-project rejection by removing exact project ownership, not by migrating the callers. Both Workbench callers still use this constructor. Its null worktree also rejects valid selected worktrees. Frozen identity/reservation/document keys cannot accurately represent account/project isolation on this route.

**Correction:** remove fabricated-owner construction; construct repositories with captured `AuthStatus.Authenticated.session.user`, endpoint, exact project/worktree and matching connection. Migrate both production callers, including federated targets. Keep the new API/WS endpoint checks. Add ordinary-project, worktree, account-change and mismatched-endpoint cases. **Confidence: high.**

### W2 — High: read requests still send nullable or excessive bounds before local rejection

**Evidence:** `FileRepository.kt:89-114,167-180`; `server/src/api/ws.rs:2539-2553`; `server/src/api/fs.rs:253-254`; C3 `contracts.md:29-32`.

`maxBytes` limits local acceptance but does not normalize `FsRead.len` or missing offset/len. Offset-only WS requests cause the server to read the remaining file with an uncapped range; excessive explicit lengths are also forwarded unchanged. The client materializes the WS frame/JSON before checking Base64 size. REST omits absent parameters, and its `offset.zip(len)` does not preserve offset-only WS semantics. `ULong.toLong()` can also wrap before the local cap calculation.

Ordinary no-range WS reads do have a server cap; this finding is specifically about offset-only/excessive-length requests and transport parity.

**Correction:** normalize/validate explicit bounded offset AND length once, using safe unsigned arithmetic, then send the same captured values to both transports. Enforce tier/probe acceptance on actual bytes. Add observed-wire cases for omitted bounds, offset-only, excessive length and limit responses. **Confidence: high.**

### W3 — High: existing mutation routes still erase outcomes and bypass retained reservations

**Evidence:** `FileRepository.kt:215-245,275-313,366-379`; `FsWriteCoordinator.kt:33-55,65-66,127-143`; `EditorRepository.kt:72-77`; `FileMutationCoordinator.kt:45-60,69-132`; `ReplaceCoordinator.kt:138-155`.

Direct editor mapping is repaired, but its call supplies no reservation token. Optional tokens allow save/fs:op dispatch without any retained quarantine; ambiguity then leaves no arbiter record blocking conflicting work. Legacy write wrappers still turn rejection/unknown into `IllegalStateException`. ReplaceCoordinator consequently loses its CAS-conflict branch to generic failure; FileMutationCoordinator still consumes flattened `FsOpOutcome` rather than typed uncertainty. This is current boundary/caller safety, not a demand for all later editor/explorer behavior now.

**Correction:** finish typed-outcome migration for named direct callers; require or acquire and validate an owner/path-qualified reservation at the mutation boundary. Preserve submitted state and reservation on possible submission; release only on definite settlement. Do not retain exception/string compatibility shims. Cover CAS, definite rejection, ambiguous commit/fs:op, cancellation and blocked conflicting actions. **Confidence: high.**

### W4 — High: subscription origin cutover is incomplete despite corrected map keys

**Evidence:** `FileTreeSubscription.kt:58-86,139-143,153,176-179`; `WorkbenchScreen.kt:851-864`; C1 `contracts.md:10-11`; C6 `contracts.md:53`.

A null captured socket still enables generic `request` and accepts events from every socket. A connection appearing between capture and request can therefore create an unqualified subscription. Cleanup in the disposed-during-subscribe path also uses generic send when origin is null. The subId-only unsubscribe overload samples the current socket instead of accepting the captured handle identity.

Workbench still consumes raw `incomingMessages`, associates all matching file events with the current target, and falls back to an absolute event path. These are exact-origin migration gaps; full shared-watch aggregation/bounded replay can remain Phase 04.

**Correction:** require a captured origin before subscription; eliminate current-socket fallbacks for file subscribe/cleanup; route scoped consumers through exact subscription/socket identity and target-relative fields. Keep captured-handle keyed cleanup. Include incarnation when retiring/replacing a subscription; same-socket reuse is not protected by the pair key alone. **Confidence: high for concrete null/raw paths; same-socket reuse behavior unqualified.**

### W5 — Medium: new safety paths lack behavioral regression evidence

**Evidence:** complete inspected `FileRepositoryTest.kt:1-195`, `EditorRepositoryTest.kt:1-131`, `WsConnectionTest.kt:1-280`; `FileOperationArbiterTest.kt:137-201`; `ApiClientTest.kt:190-215`.

No supplied cases exercise padded exact-limit WS reads, direct editor success/CAS/unknown mapping, socket replacement while queued in the actual expected-socket implementation, reused subscription IDs/stale-handle cleanup, or fabricated-owner/endpoint denial. The child test checks kind/duplicate children but not an ancestor escape from a narrower reservation. Correlator mismatch does not exercise writer queue replacement. Canonical equality/key collision and post-dispatch cancellation/quarantine remain untested.

**Correction:** add behavior-level cases at the real boundary, not source-string assertions or overrides bypassing the code being qualified. Preserve existing useful REST/UTF-8 tests. **Confidence: high for inspected coverage.**

### W6 — Medium: arbiter accepts foreign tokens by colliding numeric ID

**Evidence:** `FileOperationArbiter.kt:47,111-119,147-151,158-177`.

Every arbiter starts token IDs at 1. Child creation, quarantine and release look up only `token.id`, without checking the supplied token is the locally issued object. Passing a token from another arbiter can manipulate an unrelated local reservation with the same ID. Quarantine also does not validate the operation's owner/path against its reservation.

**Correction:** validate the exact issued token/issuer plus operation ownership/coverage before changing state. A two-arbiter colliding-ID test should show foreign tokens cannot release, quarantine or derive children from local reservations. **Confidence: high; source finding, not runtime reproduced.**

## Suggestions / Positive Observations

- Keep the existing transport/runtime and wire DTOs. Socket envelopes, captured writers and writer-queue checks are appropriately narrow seams.
- Direct editor typed outcomes and strict UTF-8 loader rejection are meaningful fixes.
- Arbiter critical sections remain short; no UI prompt/network await under its lock. Directional child containment and segment-aware conflicts are good foundations.
- Normalized equality/hash and length-prefixed presentation segments avoid simple delimiter collisions.
- Optional performance improvement: `getBytesBounded` retains chunk copies plus a final array; REST reads decode once lossily for marker search and again strictly. After correctness fixes, use bounded accumulation with less copying and parse binary markers structurally rather than scanning arbitrary file text. No new abstraction required.
- Reconcile interface-freeze claims with actual construction, caller migration and evidence before scheduling concurrent consumers; do not mark pending Phase 02 tasks complete from compilation alone.

## Reviewed Files

Kotlin root: `native-app/shared/src/`.

- `commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/core/transport/{SocketBoundMessage,WsRequestCorrelator,SerializedWsWriter,WsConnection,ApiClient}.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/features/files/{FileOperationOutcome,FileOperationArbiter,FileWatchContracts,FsWriteCoordinator,FileTreeSubscription,FileRepository}.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/features/editor/{EditorDocument,EditorSessionPorts,EditorContentLoader,EditorRepository}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/features/files/{FileOperationArbiterTest,FileRepositoryTest}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/{EditorRepositoryTest,EditorTabsStateTest}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/{ApiClientTest,WsConnectionTest}.kt`
- `plans/261023-1429-native-editor-file-explorer/interface-freeze.md`
- Supporting sections: `WorkbenchScreen.kt`, `FileMutationCoordinator.kt`, `ReplaceCoordinator.kt`, `server/src/api/{ws,fs}.rs`; Phase 02 plan/contracts, Cycle 2 report, README/PDR/code standards and Android architecture documentation.

Approximately 3,600 source/test/contract lines inspected. No entire-codebase review.

## Validation Commands / Results

Reviewer ran source inspection/search and `git diff --stat`; no build/test/lint run and no product edits. Avoided duplicate verification with assigned tester. Advisor consulted on review judgment; advice is not validation evidence.

**Peer-reported by `Phase02TesterCycle3`, not independently executed/verified by reviewer:**

```text
cmd /c "native-app\gradlew.bat -p native-app :shared:jvmTest --tests dev.damhopper.nativeapp.features.files.FileRepositoryTest --tests dev.damhopper.nativeapp.features.files.SearchAndReplaceTest --tests dev.damhopper.nativeapp.features.files.FileOperationArbiterTest --tests dev.damhopper.nativeapp.core.transport.ApiClientTest --tests dev.damhopper.nativeapp.core.transport.WsConnectionTest --tests dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest --tests dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest --tests dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest --tests dev.damhopper.nativeapp.features.editor.EditorRepositoryTest --tests dev.damhopper.nativeapp.features.editor.EditorTabsStateTest --rerun-tasks"
```

Reported **BUILD SUCCESSFUL; 85 passed / 0 failed / 0 skipped; 27s; 8 tasks executed**.

```text
cmd /c "native-app\gradlew.bat -p native-app :shared:compileKotlinJvm"
```

Reported **BUILD SUCCESSFUL; compile UP-TO-DATE; 1s**. Forced JVM invocation above executed compilation. Environment: Java 21.0.9, wrapper Gradle 8.11.1, JVM target 17.

Reviewer XML access was denied by tool ignore policy (`build/`); no independent log/XML inspection. Type/test coverage percentages and lint issue counts unavailable. This is focused JVM/local-loopback evidence, not full-suite, Android/native runtime, live-server, device or release qualification.

## Unresolved Questions / Evidence

- Missing behavioral cases in W5 remain acceptance evidence gaps; green focused tests cannot close them.
- Same-socket subscription-ID reuse/incarnation behavior remains unqualified; exact-origin null/raw gaps are independently visible.
- Main must settle W1–W6 and reconcile Phase 02 task/acceptance status. No freeze approval given here.
- No new product decision is required to correct the cited ownership, bounds, outcome and exact-origin contracts.
