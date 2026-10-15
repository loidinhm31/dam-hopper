# DamHopper Android Native Client (`native-app`)

**Status:** Foundation and security architecture verified (Phase 02). Physical/emulator runtime launch pending device attachment.  
**Architecture Document:** [Android Native Client Architecture](../docs/architecture/android-native-client.md)  
**Acceptance Ledger:** [Android Native Acceptance Ledger](../docs/android-native-acceptance.md)  
**Implementation Plan:** [Android Native App Plan](../plans/261015-1647-android-native-app/plan.md)

---

## 1. Overview

`native-app` is an Android-native implementation of the DamHopper development workbench. It connects to the existing DamHopper Rust server backend (`server/`) using REST, WebSocket, and Server-Sent Events (SSE).

Unlike `apps/native/` (which hosts the desktop application using Tauri 2 and WebView), `native-app` is built entirely with **Kotlin Multiplatform (KMP)** and **Jetpack Compose**, using platform-native Android widgets and terminal/editor rendering adapters. It does not contain or run a browser engine, WebView, local PTY, local Git, or local AI agent execution.

---

## 2. Workspace & Shell Invariants

The native Android client adheres to strict presentation rules established by architectural decisions and user validation:

1. **TERMINAL Mode Shell:**
   - The workbench operates strictly in **TERMINAL mode** (`workspaceMode = "terminal"`).
   - The desktop IDE shell and workspace mode switchers are excluded.
2. **Traditional Terminal Presentation:**
   - The terminal operates strictly in **Traditional terminal mode** (`terminalUsageMode = "traditional"`).
   - The desktop Runtime terminal presentation and usage mode switchers are excluded.
3. **Single Top Panel-Navigation Row:**
   - All 12 included remote workbench panels are accessed via a single horizontally scrollable button row positioned at the top, directly beneath the server/project header.
   - Buttons display an icon and a short text label, with visual indication of the active panel.
   - The navigation row stays visible and docked when the software keyboard (IME) is displayed.
   - No wrapping into multiple rows; no overflow/More menu.
4. **Zero Floating Buttons:**
   - Floating Action Buttons (FABs), draggable launchers, and floating panel toggles are strictly prohibited. All navigation and actions are inline.
5. **Single Content Area:**
   - One content area is used across all screen sizes (phones, foldables, tablets). Selecting a panel visually replaces the terminal while keeping underlying terminal sessions and controllers alive. No multi-pane or side-by-side terminal/panel docking.
6. **First-Release Preview Exceptions:**
   - **HTML Preview:** Embedded interactive HTML/JS browser preview is excluded (B01). HTML files are edited as raw source code.
   - **Mermaid Rendering:** DOM-rendered Mermaid diagrams are excluded (B02). Markdown files display raw fenced Mermaid code blocks with an explicit rendering-unavailable notice.

---

## 3. Module Architecture & Toolchain Pins

The project follows a two-module architecture established in Phase 02:

### Toolchain Pins
Defined in `native-app/gradle/libs.versions.toml` and pinned in the Gradle wrapper:
- **Gradle**: 8.11.1 (`gradle-wrapper.properties` with official SHA-256 `f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6`).
- **Android Gradle Plugin (AGP)**: 8.7.3 (`com.android.application`, `com.android.library`).
- **Kotlin**: 2.1.10 (`org.jetbrains.kotlin.multiplatform`, `org.jetbrains.kotlin.plugin.serialization`, `org.jetbrains.kotlin.plugin.compose`).
- **Compose Multiplatform**: 1.7.3 (`org.jetbrains.compose`).
- **Kotlinx Libraries**: Coroutines 1.10.1, Serialization 1.8.0, Datetime 0.6.1.
- **Ktor Client**: 3.1.0 (`ktor-client-okhttp`, `ktor-client-java` staged for Phase 03 transport).
- **Java / Bytecode Target**: Java 17 across all modules (`JavaVersion.VERSION_17`, `JvmTarget.JVM_17`).
- **Android SDK**: `minSdk 29` (Android 10+), `targetSdk 35`, `compileSdk 35`.
- **NDK ABI Filters**: `arm64-v8a` and `x86_64`.

### Implemented Project Structure

```text
native-app/
├── gradle/
│   ├── libs.versions.toml       # Pinned version catalog (AGP 8.7.3, Kotlin 2.1.10, Compose 1.7.3, Ktor 3.1.0)
│   └── wrapper/
│       ├── gradle-wrapper.jar
│       └── gradle-wrapper.properties # Gradle 8.11.1-bin with verified SHA-256
├── gradlew / gradlew.bat        # Executable Gradle wrappers
├── settings.gradle.kts          # Declares rootProject and includes :shared, :androidApp
├── build.gradle.kts             # Root build script declaring plugin aliases
├── gradle.properties            # JVM allocation and Kotlin/Android flags
├── shared/                      # Kotlin Multiplatform shared library module
│   ├── build.gradle.kts         # KMP config (Android + JVM targets, JVM 17, minSdk 29)
│   └── src/
│       ├── commonMain/kotlin/   # Domain models, Compose UI, theme (excludes Android/Swing classes)
│       │   └── dev/damhopper/nativeapp/
│       │       ├── model/       # WorkbenchModel.kt (WorkbenchPanel, WorkbenchState, shell invariants)
│       │       └── ui/
│       │           ├── components/ # WorkbenchHeader, PanelNavigationRow, PanelPlaceholders
│       │           ├── screens/    # WorkbenchScreen
│       │           └── theme/      # Color.kt, Type.kt, NativeTheme.kt
│       ├── commonTest/kotlin/   # Unit tests for domain models and shell invariants
│       ├── androidMain/         # Android platform dependencies (Ktor OkHttp, Security Crypto)
│       └── jvmMain/             # JVM platform dependencies (Ktor Java)
├── androidApp/                  # Android application module
│   ├── build.gradle.kts         # Android config (minSdk 29, compileSdk 35, ABI filters, Compose)
│   ├── proguard-rules.pro       # R8 / ProGuard optimization rules
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml # Backup disabled, adjustResize, network security config
│       │   ├── kotlin/dev/damhopper/nativeapp/
│       │   │   └── MainActivity.kt # Compose entry point with NativeTheme and WorkbenchScreen
│       │   └── res/
│       │       ├── values/      # strings.xml, colors.xml, themes.xml
│       │       └── xml/
│       │           ├── network_security_config.xml # Release TLS-only base config
│       │           └── data_extraction_rules.xml   # Excludes cloud-backup and device-transfer
│       ├── debug/res/xml/
│       │   └── network_security_config.xml # Debug loopback cleartext overrides (10.0.2.2, 127.0.0.1)
│       └── test/kotlin/dev/damhopper/nativeapp/
│           └── ManifestSecurityTest.kt # Unit tests verifying manifest security invariants
└── crypto-bridge/               # Planned for Phase 05: Rust client JNI boundary for OPAQUE
```

### Security Policies & Manifest Isolation
- **Release TLS Policy**: `src/main/res/xml/network_security_config.xml` sets `cleartextTrafficPermitted="false"` with system trust anchors only.
- **Debug Loopback Cleartext**: `src/debug/res/xml/network_security_config.xml` permits cleartext traffic strictly for `10.0.2.2`, `127.0.0.1`, and `localhost` with user trust anchors.
- **Data Extraction & Backup**: Manifest sets `android:allowBackup="false"` and `android:fullBackupContent="false"`; `data_extraction_rules.xml` excludes root path from cloud-backup and device-transfer.
- **IME Window Management**: Manifest sets `android:windowSoftInputMode="adjustResize"` to request window resizing when the software keyboard opens (visual dock stability across virtual keyboards pending device testing).
- **Prohibited Dependency Exclusion**: Zero occurrences of `WebView` or `tauri` detected in `native-app/shared/src/` or `native-app/androidApp/src/main/` by the static test suite.

---

## 4. Verification & Build Commands

### Root Workspace Commands (`package.json`)

```bash
# Run shared platform-agnostic unit tests (WorkbenchModel, shell invariants, serialization):
pnpm native-app:test

# Run Android unit tests (manifest security, network security configs, extraction rules):
pnpm native-app:test:android

# Assemble debug APK:
pnpm native-app:assembleDebug

# Run foundation and security assertion test suite (41/41 assertions):
bash tests/test-phase-02-foundation.sh
```
*(Note: Root scripts provide sensible fallbacks for `JAVA_HOME` and `ANDROID_HOME`, which can be overridden in your local shell environment).*

### Direct Gradle Commands

```bash
# Run shared JVM unit tests:
./native-app/gradlew -p native-app :shared:jvmTest

# Run Android unit tests:
./native-app/gradlew -p native-app :androidApp:testDebugUnitTest

# Assemble debug APK:
./native-app/gradlew -p native-app :androidApp:assembleDebug

# Install debug APK on connected device or emulator (pending device attachment):
./native-app/gradlew -p native-app :androidApp:installDebug

# Run connected Android instrumentation tests (pending device attachment):
./native-app/gradlew -p native-app :androidApp:connectedDebugAndroidTest
```

---

## 5. Implementation Roadmap

- **Phase 01:** Scope baseline and contract freeze *(Completed)*
- **Phase 02:** Gradle KMP Android foundation *(Foundation & security verified; runtime launch pending device attachment)*
- **Phase 03:** Contracts ownership and live transport *(Next)*
- **Phase 04:** Profiles authentication, MFA, and credential vault
- **Phase 05:** Native terminal, editor, and crypto proof gates
- **Phase 06:** TERMINAL Traditional shell, projects, and configuration
- **Phase 07:** Terminal sessions, replay, input, and agent status
- **Phase 08:** Filesystem watchers, search, and replace
- **Phase 09:** Native editor, language services, and safe saves
- **Phase 10:** Native diff, merge, and blame
- **Phase 11:** Encrypted transfers, media, and Android storage
- **Phase 12:** Complete Git and safe history workflows
- **Phase 13:** Workflow tracking and project plans
- **Phase 14:** Agent Store imports and memory
- **Phase 15:** Host resources, fleet, and usage
- **Phase 16:** Ports, tunnels, idle consent, and host controls
- **Phase 17:** Preferences, privacy, notifications, and lifecycle
- **Phase 18:** Integrated device security and performance qualification
- **Phase 19:** Signed APK release and operational handoff
