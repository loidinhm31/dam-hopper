# DamHopper Android Native Client (`native-app`)

**Status:** Architecture and scope baseline frozen (Phase 01). Gradle build and source implementation pending Phase 02.  
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

## 3. Planned Module Architecture

*(Note: Modules and Gradle wrappers will be established in Phase 02. The paths below reflect the planned project structure).*

```text
native-app/
├── gradle/
│   ├── libs.versions.toml       # Planned: Unified version catalog (KMP, Compose, Ktor, AGP)
│   └── wrapper/                 # Planned: Gradle wrapper distribution
├── gradlew / gradlew.bat        # Planned: Executable Gradle wrappers
├── settings.gradle.kts          # Planned: Gradle project configuration (:shared, :androidApp)
├── build.gradle.kts             # Planned: Root build script
├── shared/                      # Planned: Kotlin Multiplatform shared module
│   ├── build.gradle.kts
│   └── src/
│       ├── commonMain/kotlin/   # Business logic, DTOs, Ktor clients, Zustand-like stores, Compose UI
│       ├── commonTest/kotlin/   # Unit tests for shared domain models
│       └── jvmTest/kotlin/      # Platform-agnostic JVM unit tests
├── androidApp/                  # Planned: Android application module
│   ├── build.gradle.kts
│   └── src/
│       ├── main/AndroidManifest.xml
│       ├── main/kotlin/         # MainActivity, Compose entry point, Android platform adapters
│       └── androidTest/         # Instrumented Android UI and integration tests
└── crypto-bridge/               # Planned (Conditional): Rust client JNI boundary for OPAQUE
    ├── Cargo.toml
    └── src/lib.rs
```

---

## 4. Planned Verification & Build Commands

Once Phase 02 establishes the Gradle foundation, the following commands will be used for verification:

```bash
# Run shared platform-agnostic unit tests:
./native-app/gradlew -p native-app :shared:jvmTest

# Run Android unit tests:
./native-app/gradlew -p native-app :androidApp:testDebugUnitTest

# Assemble debug APK:
./native-app/gradlew -p native-app :androidApp:assembleDebug

# Install debug APK on connected device or emulator:
./native-app/gradlew -p native-app :androidApp:installDebug

# Run connected Android instrumentation tests:
./native-app/gradlew -p native-app :androidApp:connectedDebugAndroidTest
```

---

## 5. Implementation Roadmap

- **Phase 01:** Scope baseline and contract freeze *(Completed)*
- **Phase 02:** Gradle KMP Android foundation *(Next)*
- **Phase 03:** Contracts ownership and live transport
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
