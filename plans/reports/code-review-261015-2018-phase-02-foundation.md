## Code Review Summary

### Scope
- Files reviewed:
  - `native-app/settings.gradle.kts`
  - `native-app/build.gradle.kts`
  - `native-app/gradle.properties`
  - `native-app/gradle/libs.versions.toml`
  - `native-app/gradle/wrapper/gradle-wrapper.properties`
  - `native-app/shared/build.gradle.kts`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/model/WorkbenchModel.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Color.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/NativeTheme.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/WorkbenchHeader.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/PanelNavigationRow.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/components/PanelPlaceholders.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt`
  - `native-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/model/WorkbenchSerializationTest.kt`
  - `native-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/model/WorkbenchStateTest.kt`
  - `native-app/androidApp/build.gradle.kts`
  - `native-app/androidApp/proguard-rules.pro`
  - `native-app/androidApp/src/main/AndroidManifest.xml`
  - `native-app/androidApp/src/main/res/xml/network_security_config.xml`
  - `native-app/androidApp/src/main/res/values/themes.xml`
  - `native-app/androidApp/src/main/res/values/colors.xml`
  - `native-app/androidApp/src/main/res/values/strings.xml`
  - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
  - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/ManifestSecurityTest.kt`
  - `tests/test-phase-02-foundation.sh`
  - `.gitignore`
  - `package.json`
- Lines of code analyzed: ~1,000 LOC.
- Review focus: Phase 02 Gradle KMP Android foundation, toolchain reproducibility, boundary isolation, manifest security, architecture shell invariants.
- Updated plans: `plans/261015-1647-android-native-app/phase-02-gradle-kmp-android-foundation.md`

### Overall Assessment
- **Review Score: 7.5/10**
- Strong architecture foundation: pure KMP `:shared` module without Android leakage, clean Compose Material3 theme, zero FABs, TERMINAL mode shell, and verified unit test suites.
- However, notable policy and acceptance gaps exist:
  1. Root `<domain-config>` permits cleartext HTTP in Release builds, violating debug/release security separation.
  2. Scope mismatch: `WorkbenchPanel` only models 10 panels, omitting `editor` and `merge` from the authoritative 12-panel registry in `docs/android-native-acceptance.md`.
  3. API 35 window insets missing from root Compose hierarchy, creating edge-to-edge occlusion risk.
  4. GATE-A application launch qualification remains incomplete due to lack of connected physical/emulator target.
  5. `package.json` scripts embed user-specific `/home/loidinh/...` paths.

### Critical Issues
- **None (0)**: No build-breaking defects or hardcoded secret exposures.

### High Priority Findings

1. **Release Cleartext Traffic Permitted in `network_security_config.xml`**
   - **Problem**: `native-app/androidApp/src/main/res/xml/network_security_config.xml` defines `<domain-config cleartextTrafficPermitted="true">` for `10.0.2.2`, `127.0.0.1`, and `localhost` at the root level. Root `<domain-config>` applies to all build types (including Release). `<debug-overrides>` only scopes trust anchors, not domain configs.
   - **Impact**: Violates requirement: *"Release manifest/config does not inherit debug cleartext"*. Production APKs would permit unencrypted HTTP to local addresses.
   - **Fix**: Move the cleartext `<domain-config>` to `native-app/androidApp/src/debug/res/xml/network_security_config.xml` (debug variant resource overlay) and keep `main` strictly TLS-only (`cleartextTrafficPermitted="false"`). Add a release test asserting release manifest/config disallows cleartext.

2. **Panel Destination Registry Divergence (10 vs 12 Panels)**
   - **Problem**: `WorkbenchPanel` in `WorkbenchModel.kt` defines 10 panels (`TERMINAL`, `FILES`, `GIT`, `DIFF`, `SEARCH`, `WORKFLOW`, `PORTS`, `FLEET`, `STORE`, `SETTINGS`). The authoritative specification in `docs/android-native-acceptance.md` (Section 2) defines **12 panels**:
     1. `terminal`
     2. `files`
     3. `editor` (missing)
     4. `diff`
     5. `merge` (missing)
     6. `git`
     7. `workflow`
     8. `agents` (labeled `STORE` in model)
     9. `resources` (labeled `FLEET` in model)
     10. `ports`
     11. `ssh_host` (missing or conflated)
     12. `settings`
     *(Note: `SEARCH` is not a top-level panel in the registry; search is federated inside Files).*
   - **Impact**: Breaking drift from frozen Phase 01 architecture baseline and NAV01 acceptance criteria.
   - **Fix**: Reconcile `WorkbenchPanel` enum directly against Section 2 of `docs/android-native-acceptance.md`.

3. **Missing Window Insets Handling on Android 15 (targetSdk 35)**
   - **Problem**: Target SDK is 35. Android 15 enforces edge-to-edge layout by default. `WorkbenchScreen.kt` declares a root `Column` without `Modifier.systemBarsPadding()` or `WindowInsets.safeDrawing`.
   - **Impact**: Status bar, camera cutouts, and navigation gestures will occlude `WorkbenchHeader` and top navigation row. `adjustResize` handles soft keyboard resize but does not protect against system cutout/status bar overlap.
   - **Fix**: Apply `Modifier.systemBarsPadding()` or `WindowInsets.safeDrawing` to the top-level container in `WorkbenchScreen.kt` or `MainActivity.kt`.

4. **GATE-A Device Launch Unverified**
   - **Problem**: Phase 02 success criteria mandates: *"Observe real application launch and document GATE-A foundation result"*. Build outputs and unit tests passed, but no emulator or device was attached to exercise actual APK installation and launch.
   - **Impact**: Runtime Compose crashes or missing Android runtime resources could pass static tests undetected.
   - **Fix**: Record GATE-A device launch status as **Pending / Blocked** until an emulator or physical test device is provisioned.

### Medium Priority Improvements

1. **Android 12+ (API 31+) Backup & Data Extraction Policy**
   - `native-app/androidApp/src/main/AndroidManifest.xml` specifies `android:dataExtractionRules="@null"`.
   - On Android 12+, `@null` relies on legacy fallback behavior where device-to-device migration caveats exist on certain OEM builds.
   - Create explicit `res/xml/data_extraction_rules.xml` with `<cloud-backup><exclude path="."/></cloud-backup><device-transfer><exclude path="."/></device-transfer>` and reference `@xml/data_extraction_rules` before Phase 04 credential vaulting.

2. **Non-Portable Fallback Paths in `package.json`**
   - `package.json` scripts contain: `JAVA_HOME=${JAVA_HOME:-/home/loidinh/.local/share/jvm/jdk-21} ANDROID_HOME=${ANDROID_HOME:-/home/loidinh/Android/Sdk}`.
   - Hardcoded user home directory breaks on CI runners and other developers' environments.
   - Rely on system `JAVA_HOME`/`ANDROID_HOME` or provide clear error messaging if unset.

3. **Release R8 Minification Disabled**
   - `buildTypes.release` sets `isMinifyEnabled = false`.
   - Without R8 shrinking, Compose Multiplatform + Ktor + Coroutines runtime bloats APK size to 29 MB.
   - Enable `isMinifyEnabled = true` with appropriate Proguard rules before Phase 19 release qualification.

### Low Priority Suggestions

1. **Compose Allocation in `PanelNavigationRow.kt`**
   - Line 40 calls `WorkbenchPanel.values().forEach { panel -> ... }`.
   - In Kotlin, `values()` allocates a new array on every call. In Compose, this happens on every recomposition.
   - Replace with `WorkbenchPanel.entries` (Kotlin 1.9+ enum entries list) or a cached top-level list.

2. **Unused Import in `NativeTheme.kt`**
   - `import androidx.compose.foundation.isSystemInDarkTheme` is unused. Remove to keep code pristine.

3. **Short Code vs Icon Presentation in Navigation Row**
   - `PanelNavigationRow.kt` renders bracketed text `"[${panel.shortCode}]"`. Acceptance spec calls for "icon + short text label". Introduce Compose vector icons or icon placeholders alongside labels.

### Positive Observations
- Strict KMP Boundary: Pure Kotlin in `:shared` with zero Android imports in `commonMain`.
- Shell Invariants Enforced: Data class and serialization tests strictly enforce `TERMINAL` workspace mode, `TRADITIONAL` terminal mode, `allowFloatingButtons = false`, and `singleContentArea = true`.
- Excellent Build Hygiene: Pinned Gradle wrapper (8.11.1) with official SHA-256 integrity hash; pinned version catalog (`libs.versions.toml`).
- Modular File Sizes: All files <= 117 LOC, well under the 200 LOC project limit.
- Comprehensive Test Script: `tests/test-phase-02-foundation.sh` executes 25 automated structural checks.

### Recommended Actions
1. **Security**: Create `native-app/androidApp/src/debug/res/xml/network_security_config.xml` containing the loopback domain-config, and remove `cleartextTrafficPermitted="true"` from `src/main/res/xml/network_security_config.xml`.
2. **Scope**: Reconcile `WorkbenchPanel` in `WorkbenchModel.kt` to the 12 panels defined in `docs/android-native-acceptance.md` (`terminal`, `files`, `editor`, `diff`, `merge`, `git`, `workflow`, `agents`, `resources`, `ports`, `ssh_host`, `settings`).
3. **UI/Insets**: Add `Modifier.systemBarsPadding()` to `WorkbenchScreen.kt`.
4. **Environment**: Replace `/home/loidinh/...` hardcoded fallbacks in `package.json` with standard environment variables.
5. **Runtime Validation**: Attach emulator/device to execute APK install and launch, closing GATE-A qualification.

### Metrics
- **Automated Tests Executed**: 7/7 unit tests passed fresh (5 in `:shared:jvmTest`, 2 in `:androidApp:testDebugUnitTest`).
- **Static Invariant Tests**: 25/25 assertions passed in `./tests/test-phase-02-foundation.sh`.
- **Debug APK Build**: Success (29 MB, ABI arm64-v8a + x86_64, targetSdk 35).
- **Type Coverage**: 100% strict Kotlin type safety (zero `Any` casts, explicit serialization models).
- **Critical Issues**: 0
- **High Priority Issues**: 4
- **Medium Priority Issues**: 3
- **Low Priority Issues**: 3

### Unresolved Questions
1. Should release cleartext policy be strictly forbidden by separating `src/debug/res/xml/network_security_config.xml` before Phase 03 transport work?
2. When will an x86_64 or arm64-v8a emulator / test device be attached to capture visual launch evidence for GATE-A?
3. Should `WorkbenchPanel` enum be updated immediately to match the 12 panels defined in `docs/android-native-acceptance.md` (`editor`, `merge`, `agents`, `resources`, `ssh_host`)?