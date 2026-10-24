# Phase 02 Frozen Common Contracts — Cycle 2 Code Review

## Assessment

**Score: 6/10. Changes required before freezing Phase 02 / scheduling downstream consumers.**

The targeted fixes improve the contracts, but production caller migration, bounded-read correctness, and subscription identity remain incomplete. Source-level fixes are not equivalent to behavioral qualification.

- Critical issues: none identified in inspected scope.
- High-priority warnings: 5.
- Medium-priority warning: incomplete regression evidence.
- Product/source edits: none. Plan/task status intentionally unchanged; Main owns integration and task tracking.

## Cycle 1 Resolution

| Finding | Cycle 2 evidence | Disposition |
|---|---|---|
| Invalid UTF-8 can become editable empty text | `EditorContentLoader.kt:60-74` rejects binary/null text; `FileRepositoryTest.kt:179-194` exercises malformed bytes through the loader | Resolved in source and covered by supplied test |
| Negative `FsWriteResult` classified Confirmed | `FsWriteCoordinator.kt:162-177` maps failure to Rejected, including CAS code | Local mapping resolved; end-to-end caller mapping still broken, W2 |
| Child-save containment symmetric/too broad | `FileOperationArbiter.kt:111-129,249-258` checks mutation parent, directional containment and sibling conflicts | Source-level resolved; test does not exercise ancestor escape |
| Missing queued-send socket verification | `WsConnection.kt:204-270`, `SerializedWsWriter.kt:29-34` recheck authority/socket inside writer lock before send | Source-level resolved; supplied tests do not exercise queued replacement |
| Canonical owner/document equality and delimiter collisions | `WorkspaceFileOwner.kt:42-59,117-147` uses normalized equality/hash and length-prefixed segments | Source-level resolved for normalization/encoding shown; no supplied behavioral regression |
| Behavioral safety tests | Added REST cap, strict UTF-8 loader, child kind/duplicate-child, and correlator mismatch tests | Partially resolved; required safety scenarios remain unproven |

## Warnings

### W1 — High: production construction fabricates identity and rejects ordinary project targets

**Evidence:** `FileRepository.kt:25-40,42-63`; `WorkspaceFileOwner.kt:35-39`; `WorkbenchScreen.kt:293,882`.

The secondary constructor invents `accountUser = "dev-user"` and `defaultProject = "default"`. Both production Workbench callers still invoke it. New target guards reject any selected project other than `default`, while authenticated sessions never supply their actual account identity. This contradicts C1 and the phase's explicit dormant-caller migration requirement. The workbench is currently dormant, so this is not a claim about the mounted terminal root.

Construction also validates the API endpoint against the owner but never compares `wsConnection.baseUrl` with that endpoint (`FileRepository.kt:42-55`); equal ConnectionRefs do not themselves establish equal endpoints.

**Correction:** remove fabricated-owner construction; migrate all callers to captured authenticated account + exact project/worktree owners, validate both transports' endpoint binding. Add non-default-project, worktree, account-change and mismatched-WS-endpoint tests. **Confidence: high.**

### W2 — High: compatibility wrappers erase conflict/unknown semantics and bypass retained reservations

**Evidence:** `FsWriteCoordinator.kt:33-55`; `FileRepository.kt:209-239,269-307,360-373`; supporting `EditorRepository.kt:72-102`; `FileMutationCoordinator.kt:45-60,69-132`.

The write wrapper converts Rejected and Unknown into ordinary `IllegalStateException`. `EditorRepository.saveFile` still expects a negative result for Conflict and a timeout exception for UnknownOutcome; converted outcomes reach generic Error instead. Its Conflict/Unknown branches are ineffective for outcomes converted by this wrapper. Mutation callers likewise consume `FsOpOutcome(ok=false)`, losing typed uncertainty.

The wrappers explicitly pass null reservation state. Direct outcome APIs also permit null tokens. Thus these existing mutation routes can dispatch without retained path quarantine/submitted bytes; an ambiguous result does not prevent another conflicting action. C4/C5 and the freeze document promise more than these routes provide.

**Correction:** migrate direct callers to typed local outcomes, preserving Conflict and Unknown through the editor/mutation layer. Require or internally acquire and validate the correct owner/path reservation before mutating dispatch; retain it on uncertainty. No string/exception compatibility shim. Cover rejection, CAS conflict, timeout/cancellation after commit, and blocked conflicting action. **Confidence: high.**

### W3 — High: valid full-size WS ranges are rejected by padded Base64 estimate

**Evidence:** `FileRepository.kt:104,114-123`; `EditorContentLoader.kt:22-25`.

The predecode estimate `(rawData.length * 3) / 4` does not subtract padding. A valid 65,536-byte range has 87,384 Base64 characters; the estimate is 65,538 and returns `OVERSIZE_BYTES` before decoding. Normal full 64 KiB large-file windows therefore fail on WS even though the payload satisfies the requested bound. The early return does not use REST fallback.

**Correction:** bound encoded size with padding-aware arithmetic, then enforce actual decoded byte count. Add exact-limit cases with zero/one/two padding characters and limit+1 rejection. Correct validation rather than hiding the defect with fallback. **Confidence: high; arithmetic/source finding, not runtime-reproduced here.**

### W4 — High: nullable read bounds still allow oversized remote work before local rejection

**Evidence:** `FileRepository.kt:86-104,161-174`; C3 `contracts.md:29-32`; supporting `server/src/api/ws.rs:2539-2553`; `WsConnection.kt:294-297`.

Both explicit offset and len are required by C3, but the repository still forwards nullable values and omits missing REST parameters. Ordinary full-file WS reads do have a server cap; they are not all unbounded. The concrete dangerous combination is offset supplied without len: the server reads the remaining file and exempts that range from the normal cap. An excessive provided len is also sent unchanged even though local validation caps at 5 MiB. Local checks occur after full WS frame/JSON materialization.

**Correction:** normalize and validate explicit offset+len once before either transport request; send the actual bounded length, use safe unsigned conversion, and keep fallback identical. Test offset-only input, oversized len, observed wire bounds, and oversized server responses. **Confidence: high.**

### W5 — High: stale watch cancellation can affect a replacement socket/subscription

**Evidence:** `FileTreeSubscription.kt:40,57-85,135-171,185-194`; supporting `WorkbenchScreen.kt:851-864`.

Subscriptions remain indexed solely by `subId`. On reconnect, reuse overwrites the prior entry; an old handle's `cancel()` then removes/cancels the new entry and can unsubscribe its current origin. Even without a matching entry, `unsubscribe` falls back to generic current-socket `send`. Capturing a null socket also permits generic subscribe and accepts events from any socket indefinitely. These bypass exact-origin ownership rather than merely deferring shared watcher aggregation.

The Workbench file-event collector additionally consumes raw `incomingMessages` and labels events with current `snapshot.target`, without subscription/socket qualification.

**Correction:** require an origin socket; key handles and cleanup by captured socket + subId + subscription incarnation; absent/stale cleanup must not send on the current socket. Migrate scoped raw file consumers. Add reused-subId, stale-handle cancellation, null-socket and old-event tests. Full shared-demand aggregation can remain Phase 04. **Confidence: high.**

### W6 — Medium: supplied behavioral tests do not establish the required boundary guarantees

**Evidence:** `FileOperationArbiterTest.kt:137-166`; `FileRepositoryTest.kt:131-194`; `WsConnectionTest.kt:235-261`; `ApiClientTest.kt:190-215`.

The directional test checks parent kind and duplicate child conflicts but never rejects an ancestor save under a narrower mutation reservation. The WS addition tests correlator mismatch, not actual `sendOnSocket`/`requestOnSocket` queue replacement. Supplied tests do not demonstrate negative write-result mapping, post-dispatch quarantine/cancellation, canonical equality/hash/key collisions, exact-length WS ranges, or reused subscription IDs. Passing these tests does not close those acceptance criteria.

**Correction:** add behavior-level tests at the real boundary, not source-string assertions or overridden methods that bypass the implementation under review. **Confidence: high for inspected suites.**

## Suggestions / Positive Observations

- Keep the existing transport/runtime and wire schema: the new socket envelope and captured writer are appropriately small seams, not a second filesystem client.
- Strict UTF-8 loader denial now prevents the concrete editable-empty-buffer failure.
- Reservation acquisition uses short synchronous critical sections; prompts/network awaits are not held under the arbiter lock.
- Normalized equals/hashCode and structured length-prefix encoding are preferable to delimiter concatenation.
- Focus next cycle on W1–W6; no abstraction or cosmetic modularization is needed to fix them.

## Reviewed Files

Root prefix for Kotlin paths: `native-app/shared/src/`.

- `commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceFileOwner.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/core/transport/{SocketBoundMessage,WsRequestCorrelator,SerializedWsWriter,WsConnection,ApiClient}.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/features/files/{FileOperationOutcome,FileOperationArbiter,FileWatchContracts,FsWriteCoordinator,FileTreeSubscription,FileRepository}.kt`
- `commonMain/kotlin/dev/damhopper/nativeapp/features/editor/{EditorDocument,EditorSessionPorts,EditorContentLoader}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/features/files/{FileOperationArbiterTest,FileRepositoryTest}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/{EditorRepositoryTest,EditorTabsStateTest}.kt`
- `jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/{ApiClientTest,WsConnectionTest}.kt`
- `plans/261023-1429-native-editor-file-explorer/interface-freeze.md`
- Supporting sections: `EditorRepository.kt`, `FileMutationCoordinator.kt`, `ui/screens/WorkbenchScreen.kt`; phase02 plan, `contracts.md`; `server/src/api/{ws,fs}.rs`; README/PDR/code standards and installed review guidance.

Approximately 3,300 source/test/contract lines inspected. No broader server security or Android runtime qualification claim.

## Validation Commands / Results

Reviewer performed source inspection/search and `git diff --stat`; no build/test/lint execution and no product edits. Avoided duplicate verification with the assigned tester.

**Peer-reported by `Phase02TesterCycle2`, not independently verified by this reviewer:**

```text
cmd /c "native-app\gradlew.bat -p native-app :shared:jvmTest --tests dev.damhopper.nativeapp.features.files.FileRepositoryTest --tests dev.damhopper.nativeapp.features.files.SearchAndReplaceTest --tests dev.damhopper.nativeapp.features.files.FileOperationArbiterTest --tests dev.damhopper.nativeapp.core.transport.ApiClientTest --tests dev.damhopper.nativeapp.core.transport.WsConnectionTest --tests dev.damhopper.nativeapp.features.terminal.TerminalSessionControllerTest --tests dev.damhopper.nativeapp.features.terminal.TerminalReplayGateTest --tests dev.damhopper.nativeapp.features.terminal.TerminalReplayRenderingTest --tests dev.damhopper.nativeapp.features.editor.EditorRepositoryTest --tests dev.damhopper.nativeapp.features.editor.EditorTabsStateTest --rerun-tasks"
```

Reported BUILD SUCCESSFUL, 25s, 8 tasks executed; **84 passed / 0 failed / 0 skipped**. Initial identical command without `--rerun-tasks` used `:shared:jvmTest FROM-CACHE`; it is not the fresh-execution evidence.

```text
cmd /c "native-app\gradlew.bat -p native-app :shared:compileKotlinJvm"
```

Reported BUILD SUCCESSFUL, UP-TO-DATE; forced test invocation also executed compilation. Reviewer access to standard build-result paths was denied by tool ignore policy; no independent XML/log verification. Type/test coverage percentages and lint counts unavailable. Android/device/live-server behavior unverified.

## Unresolved Questions / Evidence

- Behavioral evidence for W1–W6 remains outstanding despite the supplied green compile/test gate.
- Main must reconcile Phase 02 acceptance and pending task status after corrections; no phase-completion approval in this review.
- No additional product decision is needed to establish the cited owner, outcome, bounds and exact-origin requirements.
