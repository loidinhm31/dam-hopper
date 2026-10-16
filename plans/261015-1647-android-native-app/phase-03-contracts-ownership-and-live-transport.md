# Phase 03 — Contracts ownership and live transport

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 02](./phase-02-gradle-kmp-android-foundation.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **completed (2026-10-15 21:44:52 +07:00)**. Review status: **reviewed & approved (Cycle 2 score: 8.8/10, remediations & socket fencing confirmed by Main; 48/48 Phase 03 static assertions, 47/47 foundation assertions, 38/38 unit tests reported passed)**. Progress: **100% (implementation complete; live daemon lifecycle qualification tracked under open qualification gates)**.
- Scope: A01, T02, X01, H01, H02 foundation.
- Goal: Implement exact owner-bound typed REST/WebSocket/SSE plumbing and resource lifetimes used by all domains.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Native origin-less WS auth requires current query-token admission; header-only/cookie-only guesses fail.
- Mixed header/binary transfer sequences must be serialized while control-frame liveness remains responsive.

## Requirements

- Typed protocol2 DTOs/errors; explicit per-field casing, integer bounds and supported-version negotiation.
- One connection runtime per profile/generation; cancellable request/subscription/receipt/media ownership; no ambient fallback.
- Bounded queues/request maps and visibility-driven stream demand; no generic unsafe input/mutation retry.

## Architecture

ConnectionRegistry owns ApiClient, WsConnection, request correlator, serialized writer and exact-socket receipt. Feature repositories receive captured ConnectionRef and explicit target; screens never choose a global client.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws_protocol.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/connections.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/transport.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/ws-transport.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/host-resource-sse.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ConnectionRef.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/ProjectTargetRef.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WireMessages.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/AndroidHttpClientFactory.kt`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Transcribe the Phase01 endpoint/DTO ledger into typed serializers; retain actual WS snake_case fields plus explicit rename exceptions, required fields and field-specific number representation.
2. Implement immutable owner capture/current-owner check and generation retirement. Keep selected project, Settings target and preference source independent.
3. Implement per-profile Ktor engine/auth-cookie policy, REST errors/status/code/retry-after and compatible-server state. Redact all URLs/query tokens/cookies/body content in errors/logs.
4. Implement WSS origin-less query-token handshake per ws.rs admission; map 4403/4401/1013/4001 to appropriate current-owner states and request new baselines after reconnect.
5. Create one serialized application writer for atomic JSON-header/binary pairs; bound queue/in-flight correlation and cancellation; handle ping/pong/close without UI-thread or application-message starvation.
6. Implement exact-socket host:uiConnection receipt capture/revocation and subscribe handles with original-owner cleanup; no persisted decision capability.
7. Provide authenticated SSE session boundary and demand-limited subscription API; leave feature-specific resource pairing/fallback to Phase15.
8. Exercise actual health/status and WS handshake using an isolated valid session fixture, plus malformed/unsupported frame/close and delayed-old-generation scenarios. Keep regression tests for consumer-visible identity/ordering failures.

## Todo List

- [x] Freeze DTO/encoding/error and compatibility contracts.
- [x] Implement owner registry and bounded transport lifetimes.
- [x] Exercise real WS/REST and stale-owner/binary ordering scenarios.
- [x] Remediate code review findings: CancellationException propagation in ApiClient, WsRequestCorrelator timeout unregister, generation watermark ABA guard, and Android platform engine alignment.
- [x] Update requirement/evidence ledger and affected docs after automated verification (live daemon lifecycle qualification tracked under open qualification gates).

## Success Criteria

- Two same-origin or different-server profiles with distinct accounts cannot share credentials/callbacks/requests; replacing one leaves the other alive.
- Captured old-generation callbacks and cleanup cannot affect a replacement runtime; header/binary frames remain correctly paired.
- Actual authenticated WS admission and close behavior matches source; required malformed data never becomes default success.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Server docs include obsolete terminal examples; schema tests must use actual frames/source.
- Foreground reconnect storms/duplicate SSE and leaked request maps drain memory; bound and retire by owner.

## Security Considerations

- Release trust/hostname verification remains intact; no synthetic Origin or trust-all TLS.
- No bearer/query tokens, socket capabilities, cookies, prompts or file bodies in transport diagnostics.

## Next Steps
1. Phase 03 contracts ownership and live transport verified and completed (2026-10-15 21:44:52 +07:00).
2. Phase 04 (Profiles authentication MFA and credential vault) unblocked and ready for implementation.
3. Interactive auth/profile flows in Phase 04 must build on `ConnectionRegistry` and `ConnectionRef` owner-fenced lifecycles; no feature may bypass owner contracts.

## Unresolved Questions

- Should `generationWatermarks` in `ConnectionRegistry` persist across app cold boots (e.g. in EncryptedSharedPreferences) in Phase 04?
- When will an x86_64 or arm64-v8a emulator / test device be attached for live daemon integration and GATE-A visual proof?
