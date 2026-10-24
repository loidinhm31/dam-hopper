# Native App Modules and Frozen Contract Rules

Design status: pending implementation. [Architecture](../../docs/architecture/android-native-client.md), [scope](./scope-and-acceptance.md). All paths below are proposed unless explicitly marked existing.

## Root and module structure

```text
native-app/
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  gradlew / gradlew.bat / gradle/wrapper/
  gradle/libs.versions.toml
  gradle/verification-metadata.xml
  shared/
    build.gradle.kts
    src/commonMain/kotlin/dev/damhopper/nativeapp/
      core/{model,ownership,transport,security}/
      features/{profiles,workspace,terminal,files,editor,git,workflow,agents,host,settings}/
      ui/{theme,navigation,components}/
    src/commonTest/kotlin/dev/damhopper/nativeapp/
    src/jvmTest/kotlin/dev/damhopper/nativeapp/
  androidApp/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/kotlin/dev/damhopper/nativeapp/
      MainActivity.kt
      platform/{network,vault,terminal,editor,media,storage,notifications,lifecycle}/
    src/debug/res/xml/network_security_config.xml
    src/main/res/xml/{network_security_config,backup_rules,data_extraction_rules}.xml
    src/androidTest/kotlin/dev/damhopper/nativeapp/
  crypto-bridge/
    Cargo.toml
    Cargo.lock
    src/lib.rs
  scripts/
```

No desktopApp, Room database, offline sync engine, browser bridge, plugin registry or server binary is required. Prefer `:shared` and `:androidApp`; the Rust bridge is not automatically a third Gradle application module. A small Gradle task owns validated ABI artifact generation if the crypto gate chooses JNI.

Namespace/applicationId proposal: `dev.damhopper.nativeapp`; label DamHopper. Kotlin source files follow normal Kotlin casing for type-owning files; feature directories and scripts kebab-case where appropriate. No code files created during this planning session.

## Workspace presentation contract

- Sole shell: `workspaceMode = "terminal"` and `terminalUsageMode = "traditional"`; no IDE/Runtime implementation, switcher or persisted mode selection.
- `PanelRegistry` contains every included panel; `PanelNavigationRow` is the sole in-layout panel-navigation surface. Top below server/project header; icon + short text buttons; one horizontally scrollable line with selected-state semantics/reveal, no wrapping or More menu. Always visible, including with the software keyboard open.
- `PanelHost` presents one selected owner-qualified content area on all screen sizes, without recreating terminal/editor controllers. Panel selection replaces terminal visuals; no wide-screen terminal/panel docking. Only the active surface accepts input. Internal diff/merge/editor panes are allowed within that one selected panel.
- No floating buttons/FABs/draggable launchers/floating file-panel toggles or second panel-navigation rail/drawer/bar; ordinary actions stay inline.
- Feature scope remains intact: files/editor/Git and administrative views are panels within the terminal shell. Host fleet metrics is not the excluded Runtime terminal presentation.


## Shared interfaces to specify before feature integration

| Contract | Required semantics |
| --- | --- |
| ConnectionRef / ConnectionRegistry | Immutable profileId + generation; runtime replacement owns cancellation, auth, clients, cookies, streams and capability receipt; no ambient lookup |
| ProjectTargetRef / ResourceKey | Qualified profile/project/worktree + path/root/resource identity; project/worktree wire fields projected after owner check |
| PanelRegistry / PanelNavigationRow / PanelHost | Complete included destination registry; sole single-line button row; qualified selection/focus/scroll reveal; no mode switcher, floating controls or controller lifetime ownership |
| ApiClient / ApiError | Typed endpoint methods/status/code/retry-after; no `Any` dictionaries in screens; distinguish absent/unsupported/empty/unavailable/error |
| WsConnection / serialized writer | Current `kind` messages, typed decoders, bounded queue/request correlation, exclusive JSON-header+binary-frame groups; auth-close mapping and no unsafe mutation/input replay |
| TerminalSessionController / NativeTerminalSurface | Output/reset/application completion, encoded input, geometry, search/selection, explicit lifetime; renderer not remote PTY owner |
| EditorSession / NativeEditorSurface | Stable document identity/modelVersion/edit epoch, exact edits/undo, view state/line geometry/decorations/read-only guards; native platform type hidden |
| LanguageService | Captured document/version/target requests, cancellation and stale-result suppression; current JSON/TS behavior inventory required before accepting candidate |
| CryptoSession | OPAQUE register/login state + encryption/KDF envelope; bounded explicit lifetime; single owner; no plaintext fallback |
| MediaLease / MediaClient | Origin + namespaced mediaClientId/cookie + ticket/kind/purpose/owner; original-owner revoke, bounded cleanup and seek/range support |
| SettingsRepository | Distinct local preferences, remote Settings target and remote preference source; per-field persistence policy, no secret serialization |
| NotificationSink / PrivacyController | Exact profile/terminal routing; redacted visible content, permission denial; input freeze before/with mask, no OS-wide guarantee |

Implement only boundaries exercised by selected Android behavior. Do not build a general transport/plugin/rendering framework.

## Wire authority and compatibility

`server/src/api/router.rs`, request DTOs, `server/src/api/ws_protocol.rs`, and actual `packages/ui/src/api/ws-transport.ts` serialization outrank stale examples in docs. `docs/api/websocket.md` contains historical terminal spawn/kill/chunk examples; **do not implement them** merely because listed.

| Area | Exact existing rule |
| --- | --- |
| Auth | REST login → enrollmentRequired/mfaRequired challenge → confirm/verify session; authProtocol2/workbenchProtocol2; no refresh-token endpoint assumed |
| Native WS admission | `ws.rs:144–152,262–274`: origin-less authenticated client requires query token. WSS only in release, URL/query/auth/cookie log redaction; no invented Bearer-header extraction or spoofed allowed Origin |
| Protocol casing | `kind`; `from_offset`, `req_id`, `sub_id`, `worktree_path`, `expected_mtime`, `new_path` on relevant WS frames; per-field `watchOnly`, `readMode` exceptions. REST DTOs commonly use `worktreePath`—map explicitly |
| Terminal | REST create/list/detailed/rename/kill/remove; WS write/resize/attach; output uses `data`, UTF8 byte `offset`, `incarnation`; exit is `terminal:exit` with restart fields |
| Replay | reset/delta/truncated tail; UTF8 byte arithmetic and retained emulator state; never base64-decode ordinary terminal data based on an outdated comment |
| Numeric bounds | Server u64 values have field-specific serialization. Use checked Long/ULong or decimal-string representation as appropriate; never round revisions through floating point. Match currently admitted wire/client range |
| Files | Qualified REST list/stat/search/range read; WS mutation/write/upload/encrypted-put state machines; serialize adjacent binary frames without interleaving |
| Media | Issue/revoke Bearer; stream uses namespaced session cookie and opaque ticket, exact profile-origin URL, not Bearer URL; preserve response/identity/range failures |
| Crypto | `opaque-ke`4; Ristretto255/TripleDH-SHA512/Identity KSF; HKDF-SHA256 info `dam-hopper-aes-256-gcm-v1`,32bytes; existing envelope/nonces/AAD/order from source |
| SSE | Authenticated resource events with epoch and exact decimal-string revisions; paired snapshot/metrics;32global/4subject; documented REST fallback and no duplicate observer streams |
| Workflow | Strict requestId and updatedAt CAS; reusing protocol-specific replay identity only as contract permits, never generic POST retries |
| Git | Exact root/worktree/branch/OIDs; normal push vs leased rewrite publication; active/inactive operation and signature-loss confirmation gates |
| Idle consent | Exact live socket `host:uiConnection` receipt + active consent request/revision; no persisted receipt or HTTP-only substitute |

## Error and lifecycle policy

- Connection states include connecting, ready, disconnected, MFA-required, auth-unavailable and incompatible; project/resource state adds missing/unavailable/stale without conflating them.
- Unknown non-mutating optional events can be ignored with bounded redacted diagnostics; required malformed state cannot be applied as a default success.
- Treat auth failures/4403 as user-action gates; pause reconnect until the correct profile is reauthenticated. Rebuild clients/media leases on credential rotation.
- No automatic replay of terminal input, session create, file/Git destructive commit, force suspend, reset, approve/execute or expired upload finalization after uncertain acknowledgement.
- Re-list/re-snapshot on reconnect before resuming domain UI; bound request maps, in-flight transfer windows, retained terminal data and cache budgets.
- App background is not remote session close. Process death restores eligible navigation metadata, not dirty-buffer bytes, secret PAKE state or a fabricated framebuffer.

## Source baseline capture

Phase01 creates a route/DTO/event ledger with source commit and representative sanitized actual frames; exact integer/schema/error/capability behavior frozen per feature. Later implementation must update that ledger when actual source differs; do not “fix” server wire casing to fit Kotlin serializers.

## Open gates

Native terminal/editor versions/licenses, JSON/TS language services, JNI crypto, physical-device/16KiB matrix and measured budgets. No alternative server-side language service or rendering service is authorized without a decision update.
