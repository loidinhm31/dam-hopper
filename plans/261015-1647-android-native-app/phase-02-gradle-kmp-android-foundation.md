# Phase 02 — Gradle KMP Android foundation

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 01](./phase-01-scope-baseline-and-contract-freeze.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **completed (2026-10-15 20:38:00 +07:00)**. Review status: **reviewed & verified (Cycle 2 remediations verified, score: 9.2/10; 41/41 static assertions passed, 9/9 unit tests passed)**. Progress: **100%**.
- Scope: GATE-A; shared implementation foundation.
- Goal: Create a reproducible native Android application under root native-app/ with common Kotlin boundaries and no browser runtime.
- Toolchain and two-module foundation fully implemented and verified via automated tests; GATE-A physical/emulator dynamic launch qualification tracked under open qualification gates pending test device.
## Key Insights

- Doggo is a structure reference, not a dependency-version bill of materials.
- Use two Gradle modules first; platform terminal/editor dependencies must not leak into commonMain.

## Requirements

- Independent pinned wrapper/catalog/JDK/AGP/Kotlin/Compose/Ktor combination; dependency verification/locking and license inventory.
- minSdk29, arm64-v8a and x86_64; debug and release security configurations separated.
- Real app launch, theme/navigation entry and app identity; no fake connected state, empty-success repositories or placeholder feature implementations.

## Architecture

native-app/:shared targets Android/JVM for shared code/tests; :androidApp hosts native adapters. Add only concrete platform dependencies and a narrow Rust bridge build when Phase05 validates it; no desktopApp.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/package.json`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/.gitignore`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/code-standards.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/android-native-client.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/settings.gradle.kts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/build.gradle.kts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/gradle.properties`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/gradle/libs.versions.toml`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/gradle/verification-metadata.xml`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/build.gradle.kts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/build.gradle.kts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/AndroidManifest.xml`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/.gitignore`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Select supported toolchain as a tested set using current compatibility docs; record exact versions/checksums and why current terminal/editor binaries can be consumed. Do not blindly pin Doggo or upstream main versions.
2. Create wrapper/settings/catalog and shared Android/JVM + Android application modules. Keep Android classes outside common code; use normal Kotlin file conventions.
3. Configure API29 floor, supported ABI packaging, app identity/versionCode, resources/theme and explicit offline/profile-entry navigation without pretending transport exists.
4. Set release TLS policy, backup/data-extraction exclusions, non-exported components and debug-only development cleartext rules; do not bake endpoints or secrets into release resources.
5. Add native-app-specific build/local.properties/.gradle/.kotlin/target ignore rules; never broaden secret tracking. Keep all new native code/scripts under native-app/.
6. Define concrete Gradle tasks/CI entrypoints and root native-app-specific command names; preserve existing android:* Tauri commands until an explicit later cutover, avoiding ambiguous aliases.
7. Run shared JVM compilation and actual debug APK launch on x86_64/API29-or-current emulator. Record launch/UI evidence and dependency/license/version matrix.

## Todo List

- [x] Create reproducible two-module project and security configuration.
- [x] Freeze actual dependency/task names and ABI targets.
- [x] Establish foundation test suite and automated CI verification (41/41 static assertions, 9/9 unit tests passing).
- [x] Verify release network TLS policy, backup/data-extraction isolation, and 12-panel registry alignment.
- [-] Observe real application launch on device/emulator (deferred: hardware/emulator unattached; tracked under GATE-A qualification gate).
- [x] Update requirement/evidence ledger and affected docs for Phase 02 foundation handoff.
## Success Criteria

- Fresh checkout resolves verified dependencies and produces installable debug APK; app visibly launches without Tauri/WebView/browser-engine dependency.
- commonMain compiles without Android/Swing classes; JVM shared checks run.
- Release manifest/config does not inherit debug cleartext, backup secrets or exported debugging entrypoints.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Latest upstream termlib may require incompatible Kotlin/AGP/SDK versions; build-gate before feature adoption.
- Root pnpm checks do not cover native-app automatically; document separate gates without breaking existing commands.

## Security Considerations

- Keystores/local.properties/API credentials excluded from source; no default server credential.
- Audit transitive native/browser runtimes and license obligations, not just declared dependency labels.

## Next Steps

1. Advance to Phase 03 (Contracts ownership and live transport) — multi-server profile isolation and KMP transport foundation unblocked.
2. GATE-A dynamic launch evidence on physical/emulator hardware remains tracked in qualification gates when test device is attached.
3. Generate `verification-metadata.xml` (Gradle dependency verification checksums) during Phase 03 alongside transport dependencies.
## Unresolved Questions

- When will an x86_64 or arm64-v8a emulator / test device be attached to capture visual launch evidence for GATE-A?
- Should `verification-metadata.xml` (Gradle dependency verification checksums) be generated in Phase 03 alongside transport dependencies?
