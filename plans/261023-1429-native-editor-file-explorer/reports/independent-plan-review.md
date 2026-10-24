# Independent plan review — substitute Advisor review and triage

Status: **complete (substitute, user-approved)**. `evc-code-reviewer` failed 2x and `reviewer` 1x: every subagent routes to `openai-codex/gpt-6.1-sol`, which hit `usage_limit_reached`. The user then chose "Advisor-model review now". The review ran via Advisor (`anthropic/claude-opus-5-5`), a different model from the plan author. This deviates from the standard reviewer agent.

Advisor visibility: phases 01–08 (some JSON tails truncated), `ownership.md` and `acceptance-matrix.md`. `plan.md`, `contracts.md`, the evidence reports and the Kotlin sources were not visible to it. The coordinator checked the source-dependent claims below directly. The single targeted follow-up was not used. Nothing was executed (no build, test, device or server run).

## Findings and dispositions
| ID | Severity | Finding | Disposition / evidence | Change |
|---|---|---|---|---|
| H1 | High | Phase05 consumes tab/session/close/conflict APIs that phase03 creates, but phase02 froze only `EditorDocument.kt`, so 03 and 05 were not independent | **Accept** | phase02 `freeze-document-and-watch-facades` owns new `EditorSessionPorts.kt` (tab read model, session commands, close intent, conflict choice, save outcome, dirty-guard port). Phase03 implements it; phase04/05 consume it read-only. contracts C2 and ownership updated. |
| H2 | High | Phase03 shape changes/deletions break unowned callers during the concurrent window | **Accept, narrowed.** Grep: `EditorUndoManager`/`EditorFindReplaceHelper`/`EditorPositionHelper` are used only by `EditorSession.kt` and `EditorSessionTest.kt` (both phase03-owned); no helper-only test files exist. Real break: `LargeFileView.kt:26` reads `tab.content` (phase05-owned). | phase03 no longer claims phase05 UI migration; it adds a compile note that verification happens only at group merge. phase05 migrates `LargeFileView` to the port read model. |
| H3 | High | Phase01 instrumentation needs Activity recreation and a test host but owns no test dependencies or host | **Accept.** The catalog has `androidx.test:core`, but the app declares only `test.ext` and runner; there is no androidTest manifest. | phase01 `qualify-pinned-editor-artifacts` adds justified `androidx.test:core`, Compose `ui-test-junit4` and debug `ui-test-manifest` (ComponentActivity host, no new manifest). Acceptance gained a matching row. |
| H4 | High | Phase08 server fixture runs on the device, so it cannot launch the server or read host bytes | **Accept** | phase08 adds an owned host script `native-app/scripts/run-editor-explorer-journeys.sh`: loopback server, lite-mode auth seeded with the existing `application_e2e_seed --sqlite-path` (verified `server/examples/application_e2e_seed.rs:34-35,136-140`), `adb reverse` per target, runner args, host-side byte verification. The device fixture becomes a client with a separate in-test authority. |
| M1 | Medium | Over-promises that uncommitted IME composition survives Activity recreation | **Accept** | phase01, contracts C2 and acceptance-matrix 08 now require deterministic finish/cancel before detach, committed state retained, and no duplicated or lost text. |
| M2 | Medium | Account identity may be unobtainable and block all writes | **Accept.** `AuthSession.user` exists (`features/profiles/AuthState.kt:45`). | phase02 step 1 and contracts C1 name `AuthSession.user` plus endpoint/profile as the source and define the `dev-user` case. If `user` turns out absent/unstable, escalate a design revision. |
| M3 | Medium | Phase02 `WsConnection` change has no terminal regression check | **Accept** | phase02 verification adds `TerminalSessionControllerTest`, `TerminalReplayGateTest` and `TerminalReplayRenderingTest`. |
| M4 | Medium | "Keep dependencies out of release" read as a build-variant exclusion | **Accept** | phase01 clarifies: normal `implementation` dependency; the licensing gate blocks distribution release only. |
| M5 | Medium | Phase07 ViewModel dependency unowned | **Reject.** `libs.versions.toml:33-34` and `androidApp/build.gradle.kts:66-67` already declare `activity-compose` and `lifecycle-viewmodel-compose`. | none |

Advisor marked as fine: FileTreeSubscription/WorkbenchScreen handoff ordering; the phase07 split; the empty `allowed_files` on the finalize task.

## Result
No unresolved High/Medium findings remain after revision. Structural validation was re-run after the edits (see `structural-validation.md`). The plan stays **blocked for implementation scheduling** on the phase01 pinned Sora feasibility gate and the phase02 facade freeze. This review is not a substitute for that executable evidence.

## Unresolved questions
- When the provider quota resets, rerun one standard `evc-code-reviewer` pass if a strict reviewer-agent receipt is required. The user accepted the substitute for now.
