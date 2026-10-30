# Phase 07 Device and Hardware Qualification Ledger

Date: 2026-10-30  
Workstation: Windows 10.0.26200 x64  
Target Branch: `feat/android-native-features`  
Qualification Status: **RELEASE GATE BLOCKED — BLOCKED_PENDING_DEVICE**  
Authority: [acceptance-matrix](../acceptance-matrix.md), [phase-07-live-qualification](../phase-07-live-qualification.md)

---

## 1. Workstation Host Environment Ledger

| Component | Detected Version / Identity | Status |
|---|---|---|
| OS / Architecture | Microsoft Windows 10.0.26200 x64 | Supported |
| Node.js Runtime | v24.21.0 | Supported (ESM, child_process, native http) |
| Git Binary | 2.48.1.windows.1 | Supported (Porcelain v2, worktree, hash-object) |
| Rust Toolchain | rustc / cargo 1.96.0 (30a34c682 2026-05-25) | Supported |
| Server Binary | `dam-hopper-server` v0.15.3 | Built and verified on loopback |
| Seed Helper | `application_e2e_seed` | Built and verified via `--stdin` |
| Android SDK Platform-Tools (`adb`) | **NOT FOUND IN PATH** | **BLOCKED (GATE-C)** |
| Physical Android Device (ARM64 / API 29) | **NONE ATTACHED** | **BLOCKED (GATE-C)** |
| Android Emulator Instance | **NONE RUNNING** | **BLOCKED (GATE-C)** |

---

## 2. Compilation and Build Verification

All Gradle targets were executed using the repository Gradle wrapper (`./native/android-app/gradlew.bat -p native/android-app`):

| Gradle Task | Target Source Set | Status | Observed Execution Time |
|---|---|---|---|
| `:shared:compileKotlinJvm` | Shared KMP JVM main | **PASSED** | 1.5s |
| `:androidApp:compileDebugKotlin` | Android App debug main | **PASSED** | 1.8s |
| `:androidApp:compileDebugAndroidTestKotlin` | Android Instrumentation Test (incl. `NativeGitWorkspaceJourneys`, `NativeGitServerFixture`) | **PASSED** | 2.2s |
| `:androidApp:assembleDebug` | Debug APK assembly | **PASSED** | 29.2s |

---

## 3. Unit, Protocol, and Current-Server Smoke Execution

### 3.1 Node Git Workspace Fixture Self-Test (`--self-test`)
- **Command**: `node native/android-app/scripts/git-workspace-fixture.mjs --self-test`
- **Result**: **PASSED (0 failures)**
- **Coverage**:
  - Git presence verification (`git version 2.48.1.windows.1`).
  - Disposable Git workspace generator: staged+unstaged same file (`doc1.txt`), binary assets, deleted files (`to_delete.txt`), untracked and empty files.
  - Linear, 2-parent merge, and 3-parent octopus history (12 commits).
  - Skewed commit timestamps (`GIT_AUTHOR_DATE` in past).
  - Punctuation and spaced worktrees (`wt & spaces + punct # test=val`).
  - Signed commit header simulation (`gpgsig` header verified via `git cat-file -p`).
  - Unmerged conflict repository state.
  - Independent Git Oracle queries (`getStatusPorcelainV2`, `getRevParse`, `getLog`, `getWorktrees`).
  - Transparent proxy forwarding, bearer token redaction in audit logs, and drop-ack fault injection.
  - Fail-closed negative prerequisite handling on non-existent binaries.

### 3.2 Current-Server Live Smoke (`--smoke-current-server`)
- **Command**: `node native/android-app/scripts/git-workspace-fixture.mjs --smoke-current-server --server-bin <current-bin> --seed-bin <seed-bin> --evidence-dir <dir>`
- **Result**: **PASSED (0 failures)**
- **Observed Output**:
  ```
  === Running Current-Server Smoke ===
  Server Binary: C:/Users/loidi/AppData/Local/Temp/cargo-target/debug/dam-hopper-server.exe
  Seed Binary: C:/Users/loidi/AppData/Local/Temp/cargo-target/debug/examples/application_e2e_seed.exe
  Isolated Run Directory: C:\Users\loidi\AppData\Local\Temp\git-smoke-evidence\smoke-run-1793370018007
  [PASS] Auth database seeded. User: git-fixture, Token: Bearer [REDACTED]
  [PASS] Current server is healthy and responding on loopback.
  [PASS] Discovered 1 root(s) via transparent proxy.
  [PASS] External Git Oracle verified branch: main, clean: false
  [PASS] Smoke evidence recorded in C:\Users\loidi\AppData\Local\Temp\git-smoke-evidence\smoke-run-1793370018007\smoke-evidence.json
  ```

### 3.3 Gate Q1 Test Suite Execution
- **Command**: `./native/android-app/gradlew.bat -p native/android-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug :androidApp:compileDebugAndroidTestKotlin --no-parallel -Dorg.gradle.parallel=false`
- **Results**:
  - `:shared:jvmTest`: 934 tests completed, 932 passed, **2 failed** (retained in ledger honestly per rule: never suppress or ignore failed checks):
    1. `TerminalPresentationPolicyTest > invalidatedTargetAfterConnectCannotSendAndZeroOffsetUsesResetRequest[jvm]`
    2. `TerminalPresentationPolicyTest > connectFailureAfterAuthoritativeReplayRefencesWithoutLosingAcceptedText[jvm]`
    *Attribution & Scoped Return*: Both failures are in terminal presentation policy regression tests affected by predecessor working-tree modifications in `TerminalAttachQueue.kt` and `TerminalSessionController.kt` (Phase 02 / F2). In accordance with Phase 07 strict file ownership boundaries and plan rule line 64 ("Failures return to original implementation task for scoped fix; stop qualification while product edits occur"), Phase 07 does not modify out-of-scope terminal product code. These 2 failures are explicitly returned to the Phase 02 implementation task for terminal fix.
  - `:androidApp:testDebugUnitTest`: **PASSED (0 failures)**.
  - `:androidApp:assembleDebug`: **PASSED**.
  - `:androidApp:compileDebugAndroidTestKotlin`: **PASSED**.
---

## 4. Honest Hardware and Device Blocker Ledger (GATE-C)

### 4.1 Runner Execution Attempt
- **Command**:
  ```bash
  bash native/android-app/scripts/run-git-workspace-journeys.sh \
    --server-bin "C:/Users/loidi/AppData/Local/Temp/cargo-target/debug/dam-hopper-server.exe" \
    --seed-bin "C:/Users/loidi/AppData/Local/Temp/cargo-target/debug/examples/application_e2e_seed.exe"
  ```
- **Exit Code**: **2 (BLOCKED)**
- **Observed Output**:
  ```
  === DamHopper Phase 07 Git Workspace Journey Runner ===
  Working directory: /mnt/g/ws/sharing/dam-hopper/native/android-app
  [BLOCKED] ADB command not found in PATH.
  Physical hardware or emulator qualification requires Android SDK platform-tools.
  GATE-C device journeys status: BLOCKED_PENDING_DEVICE
  ```

### 4.2 Open Release Gates (Deferred to Hardware Environment)
In accordance with `phase-07-live-qualification.md` lines 63–66 and `acceptance-matrix.md` lines 18–19:
1. **Physical ARM64 Target Execution**: Blocked due to absence of physical ARM64 test device with USB debugging connected to host.
2. **API 29 (Android 10) Target Execution**: Blocked due to absence of Android 10 emulator/device image on host.
3. **Emulator Execution (API 34/35)**: Blocked due to absence of Android SDK emulator and platform-tools (`adb`).
4. **Form-Factor Visual Inspection (Phone vs Tablet)**:
   - *Phone layout*: Single-column docked Git surface (`GitPanelScreen`), nested full-screen Diff and Details screens with hardware Back and toolbar Back affordances.
   - *Tablet layout*: Multi-pane master-detail view with persistent Git branch tree, wide graph canvas rendering, and side-by-side hunk diff review.
   - *Visual & Accessibility*: Touch targets (min 48dp), high-contrast commit graph lane palette (`#4CAF50`, `#2196F3`, `#9C27B0`, `#FF9800`, etc.), screen-reader descriptions on action buttons and commit graph rows.
   - *Status*: Code implemented and compiled; live physical/display inspection blocked pending device.

No synthetic waivers, mock successful runs, or fake hardware numbers were recorded. Gate remains **BLOCKED_PENDING_DEVICE**.
