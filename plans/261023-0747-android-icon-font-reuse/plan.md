---
title: "Reuse icon and font from apps/native for native-app Android"
description: "Migrate DamHopper branded launcher icons and JetBrains Mono typography from apps/native and packages/ui to the Android application."
status: in_progress
priority: P2
branch: feat/android-native-app
tags: [android, assets, icons, fonts, compose, typography]
created: 2026-10-23
---

# Reuse Icon and Font from apps/native for native-app Android

## Preflight Contract

### Output
1. Android launcher icons in `native-app/androidApp/src/main/res/`:
   - `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/`: DamHopper launcher bitmaps (`ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png`).
   - `mipmap-anydpi-v26/`: Standard adaptive icon definitions (`ic_launcher.xml`, `ic_launcher_round.xml`) referencing `@color/ic_launcher_background` and `@drawable/ic_launcher_foreground`.
   - `mipmap-anydpi-v33/`: API 33+ adaptive icon definitions adding `@drawable/ic_launcher_monochrome`.
   - `drawable/`: Vector foreground (`ic_launcher_foreground.xml`) rendered in web app logo blue `#5293F7` and monochrome icon (`ic_launcher_monochrome.xml`) rendered in white, scaled to fit within adaptive safe zones with balanced margins.
   - `values/ic_launcher_background.xml`: DamHopper web app dark slate background color `#1C2637` (matching web app top nav brand surface).
   - `AndroidManifest.xml`: Configured with `android:icon="@mipmap/ic_launcher"` and `android:roundIcon="@mipmap/ic_launcher_round"`.
2. Custom font resources in `native-app/shared/src/androidMain/res/font/`:
   - JetBrains Mono TrueType fonts (9 font files converted from `packages/ui/src/assets/fonts/jetbrains-mono/`):
     - `jetbrains_mono_regular.ttf` (weight 400)
     - `jetbrains_mono_medium.ttf` (weight 500)
     - `jetbrains_mono_semibold.ttf` (weight 600)
     - `jetbrains_mono_bold.ttf` (weight 700)
     - `jetbrains_mono_extrabold.ttf` (weight 800)
     - `jetbrains_mono_light.ttf` (weight 300)
     - `jetbrains_mono_thin.ttf` (weight 100)
     - `jetbrains_mono_italic.ttf` (weight 400 italic)
     - `jetbrains_mono_bold_italic.ttf` (weight 700 italic)
   - Provenance documentation in `native-app/shared/FONTS.md`.
   - Packaged SIL OFL 1.1 license text in `native-app/androidApp/src/main/assets/licenses/jetbrains-mono.txt`.
3. Typography configuration:
   - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt`:
     - `expect val JetBrainsMonoFontFamily: FontFamily`
     - `DamHopperTypography` configuring all 15 Material 3 typography styles with `fontFamily = JetBrainsMonoFontFamily`.
   - `native-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.android.kt`:
     - `actual val JetBrainsMonoFontFamily: FontFamily` backed by `res/font/` Android font resources.
   - `native-app/shared/src/jvmMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.jvm.kt`:
     - `actual val JetBrainsMonoFontFamily: FontFamily = FontFamily.Monospace` for headless JVM tests.
   - UI components updated to route monospace overrides through `JetBrainsMonoFontFamily`:
     - `ProjectTerminalScreen.kt` (including `fontFeatureSettings = "calt 0"` for fixed-grid terminal column alignment)
     - `WorkbenchHeader.kt`
     - `TerminalScreens.kt`
     - `DiagnosticEntryRow.kt`
     - `NativeTextEditorView.kt`
4. Verification:
   - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/LauncherAssetTest.kt`: unit tests checking launcher icon references and resource files.

### Acceptance Criteria
- Launcher icon matches DamHopper branding across all standard screen densities and adaptive icon safe zones.
- Manifest security invariants (`allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules="@xml/data_extraction_rules"`, `windowSoftInputMode="adjustResize"`) remain preserved.
- JetBrains Mono is the active font family across all Material 3 typography roles and terminal screen rows.
- Gradle builds and tests pass cleanly:
  - `:shared:jvmTest` (111+ tests)
  - `:androidApp:testDebugUnitTest` (all tests passing)
  - `:androidApp:assembleDebug` (successful APK packaging)

### Scope Boundary
- Branding, icons, and typography only.
- No changes to terminal engine, reflow, byte replay, or ANR snapshot logic.
- No changes to server, web app, or Tauri native app.

### Risk & Public Contract Areas
- Android resource naming rules (`[a-z0-9_.]+`).
- Manifest security test assertions.
- Safe JVM fallback for headless unit tests.

### Affected Systems
- `native-app/androidApp/src/main/res/`
- `native-app/androidApp/src/main/AndroidManifest.xml`
- `native-app/shared/src/androidMain/res/font/`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.kt`
- `native-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.android.kt`
- `native-app/shared/src/jvmMain/kotlin/dev/damhopper/nativeapp/ui/theme/Type.jvm.kt`
- `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
- `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/LauncherAssetTest.kt`

### Testing Strategy
- Pre-execution checks via Python script verifying TTF conversion integrity.
- JVM unit tests: `:shared:jvmTest`.
- Android unit tests: `:androidApp:testDebugUnitTest`.
- Android debug assembly: `:androidApp:assembleDebug`.
