# Code Review Summary: Android Simple Flow Refactor

## Scope
- Files reviewed:
  1. `native-app/androidApp/src/debug/res/xml/network_security_config.xml`
  2. `native-app/androidApp/src/main/res/xml/network_security_config.xml` (release counterpart)
  3. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt`
  4. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`
  5. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt`
  6. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectListScreen.kt`
  7. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
  8. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`
  9. `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
  10. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt`
  11. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt`
  12. `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt`
- Lines of code analyzed: ~3,650 LOC
- Review focus: Android Simple Mobile Flow (Profile Login -> Project List -> Select Project -> Terminal display)
- Updated plans:
  - `plans/261018-1643-android-core-flow-refactor/plan.md`
  - `plans/261018-1643-android-core-flow-refactor/phase-01-foundation-and-network.md`
  - `plans/261018-1643-android-core-flow-refactor/phase-05-root-wiring.md`
  - `plans/261018-1643-android-core-flow-refactor/phase-06-verification.md`

---

## Overall Assessment
Solid architectural implementation following KMP and Compose best practices. Zero WebView and zero Floating Action Button (FAB) invariants strictly upheld. Release network security remains TLS-only. Password custody and cleartext HTTP protection well defended in `ProfileLoginScreen`. Terminal session detachment decouples local UI controllers while preserving remote server PTY processes intact.

Three High-priority defects detected in `DamHopperMobileApp.kt` root integration: (1) navigation trap bouncing authenticated users out of `PROFILE_LOGIN`, (2) unsynchronized profile switches retaining stale project/session in navigation state, and (3) repository reconstruction race and missing connection generation fence. Remediation needed before production cutover.

---

## Critical Issues
None (no OWASP vulnerabilities, no plaintext password leakage, release build enforces strict TLS).

---

## High Priority Findings

### 1. Authenticated User Navigation Loop Traps User on Project List
- **File**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:94-102`
- **Problem**: Root `LaunchedEffect(activeProfileId, currentAuthStatus, flowState.stage)` auto-advances any authenticated user from `PROFILE_LOGIN` to `PROJECT_LIST`:
  ```kotlin
  else if (isAuthenticated && flowState.stage == AppFlowStage.PROFILE_LOGIN && activeProfileId != null) {
      navigation.onProfileAuthenticated(activeProfileId!!)
  }
  ```
  When an authenticated user taps "Profiles / Switch" on `ProjectListScreen` or presses Back, `flowState.stage` switches to `PROFILE_LOGIN`. The effect immediately triggers, evaluates `isAuthenticated == true`, and calls `navigation.onProfileAuthenticated()`, immediately redirecting back to `PROJECT_LIST`. User can never access profile configuration once authenticated.
- **Remediation**:
  Separate startup auto-advance from user-initiated back-navigation. Track one-shot startup advancement or gate auto-advance on profile selection rather than stage change:
  ```kotlin
  var hasInitialAutoAdvanced by rememberSaveable { mutableStateOf(false) }
  LaunchedEffect(activeProfileId, currentAuthStatus) {
      val isAuthenticated = currentAuthStatus is AuthStatus.Authenticated
      if (!isAuthenticated && flowState.stage != AppFlowStage.PROFILE_LOGIN) {
          navigation.navigateToProfiles()
      } else if (!hasInitialAutoAdvanced && isAuthenticated && activeProfileId != null) {
          hasInitialAutoAdvanced = true
          navigation.onProfileAuthenticated(activeProfileId!!)
      }
  }
  ```

### 2. Root Integration Missing Profile-Switch Synchronization
- **File**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:94-102`
- **Problem**: When `activeProfileId` changes (e.g. deep link or notification intent in `MainActivity`) while app is in `PROJECT_LIST` or `TERMINAL`, `navigation.onProfileAuthenticated(newProfileId)` is never called. `AppFlowNavigation.state.value.activeProfileId` retains old profile ID and old project/session, while UI composables receive new profile ID, violating multi-server profile isolation.
- **Remediation**:
  Explicitly synchronize profile identity changes across navigation state:
  ```kotlin
  LaunchedEffect(activeProfileId) {
      val profId = activeProfileId ?: return@LaunchedEffect
      if (flowState.activeProfileId != null && flowState.activeProfileId != profId) {
          navigation.onProfileAuthenticated(profId)
      }
  }
  ```

### 3. Repository Reconstruction Race, Swallowed Cancellation, and Missing Generation Key
- **File**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:65-91`
- **Problem**:
  1. While `profileRepository.getOrCreateApiClient(profId)` suspends, `workspaceRepo` and `terminalRepo` retain the previous profile's instance, creating a window where child screens interact with old repositories under new profile identity.
  2. `catch (_: Exception)` catches and suppresses `CancellationException`, violating coroutine structured concurrency.
  3. `LaunchedEffect` keys only on `(activeProfileId, currentProfile?.baseUrl)`, ignoring credential rotation / connection generation bumps (`ConnectionRef.generation`).
- **Remediation**:
  ```kotlin
  val connections by profileRepository.registry.connectionsState.collectAsState()
  val currentConn = connections[activeProfileId]

  LaunchedEffect(activeProfileId, currentProfile?.baseUrl, currentConn?.generation) {
      // Invalidate immediately to prevent stale cross-profile interactions
      workspaceRepo = null
      terminalRepo = null
      apiClient = null
      wsConnection = null

      val profId = activeProfileId
      if (profId != null && currentProfile != null) {
          try {
              val client = profileRepository.getOrCreateApiClient(profId)
              val ws = try { profileRepository.getOrCreateWsConnection(profId) } catch (_: Exception) { null }
              apiClient = client
              wsConnection = ws
              workspaceRepo = WorkspaceRepository(client, targetStore)
              terminalRepo = TerminalRepository(client, ws)
          } catch (e: CancellationException) {
              throw e
          } catch (_: Exception) {
              // Leave null; triggers loading state in downstream screens
          }
      }
  }
  ```

---

## Medium Priority Improvements

### 4. Cancellation-Prone Attempt Invalidation on Screen Disposal
- **File**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProfileLoginScreen.kt:186-197`
- **Problem**: In `DisposableEffect(Unit).onDispose`, `coroutineScope.launch` is invoked on `val coroutineScope = rememberCoroutineScope()`. In Compose, `rememberCoroutineScope` cancels its `Job` upon unmount. Calling `launch` inside `onDispose` invokes a cancelled scope, meaning `profileRepository.attemptTracker.invalidate(id)` may fail to run.
- **Remediation**:
  Provide a non-suspending atomic invalidation method on `AuthAttemptTracker` or route through non-cancelling lifecycle coordinator:
  ```kotlin
  // In AuthAttemptTracker:
  private val watermarks = java.util.concurrent.ConcurrentHashMap<String, Long>()
  fun invalidateSync(profileId: String) {
      watermarks.compute(profileId) { _, current -> (current ?: 0L) + 1L }
  }
  ```

### 5. `AppFlowNavigation` State Loss on Configuration Change
- **File**: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt:45`
- **Problem**: `val flowNavigation = remember { AppFlowNavigation() }` is stored in Compose `remember`. Device orientation changes, multi-window splits, or OS night-mode toggles recreate `MainActivity`, resetting navigation state back to `PROFILE_LOGIN`.
- **Remediation**:
  Promote `AppFlowNavigation` into an Android `ViewModel` or inject via `rememberSaveable` with a custom Saver.

---

## Low Priority Suggestions

### 6. Precompile ANSI Stripping Regex Patterns
- **File**: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalScreens.kt:55-60`
- **Problem**: `cleanAnsiCodes()` allocates and compiles 3 `Regex` instances on every invocation. In streaming terminal output, this causes unnecessary garbage generation and CPU cycles.
- **Remediation**:
  ```kotlin
  private val ANSI_CSI_REGEX = Regex("\u001B\\[[0-9;?]*[a-zA-Z]")
  private val ANSI_OSC_REGEX = Regex("\u001B\\][^\u0007]*\u0007")
  private val ANSI_CHARSET_REGEX = Regex("\u001B[()][AB012]")

  fun cleanAnsiCodes(text: String): String = text
      .replace(ANSI_CSI_REGEX, "")
      .replace(ANSI_OSC_REGEX, "")
      .replace(ANSI_CHARSET_REGEX, "")
  ```

---

## Positive Observations
1. **Zero WebView and Zero FAB Compliance**: Thoroughly validated across all 4 screens (`ProfileLoginScreen`, `ProjectListScreen`, `ProjectTerminalScreen`, `DamHopperMobileApp`). Automated tests assert absence in code and AndroidManifest.
2. **Security & Credential Custody**: Tokens stored in `CredentialVault` backed by EncryptedSharedPreferences and Android Keystore. Cleartext HTTP security guards prevent sending passwords or stored tokens over unencrypted HTTP unless server confirmed `--no-auth` dev capability. Password strings kept only in transient Compose state and wiped on auth/switch.
3. **Graceful PTY Detach & Reattachment**: Navigating back via `onBackToProjects` cleanly closes local controllers/surfaces without issuing `removeSession` or `destroyTerminal`. Server PTY persists across screen transitions and reattaches seamlessly with `lastSeenOffset` buffer replay.
4. **Input Gating**: `ProjectTerminalScreen` enforces multi-layer input checks (`isPanelActive`, `isReplayCompleted`, `shouldForwardTerminalData`, `isInputAllowed`) through serialized `writeChannel`.

---

## Recommended Actions
1. **[High]** Apply fix for Finding #1 in `DamHopperMobileApp.kt` to prevent auto-advance from overriding user navigation to `PROFILE_LOGIN`.
2. **[High]** Apply fix for Finding #2 in `DamHopperMobileApp.kt` to synchronize profile ID changes into `AppFlowNavigation`.
3. **[High]** Invalidate and re-key repository creation with `currentConn?.generation` in `DamHopperMobileApp.kt` (Finding #3).
4. **[Medium]** Add non-suspending atomic invalidation in `AuthAttemptTracker` (Finding #4).
5. **[Medium]** Migrate `AppFlowNavigation` to a `ViewModel` in `MainActivity.kt` (Finding #5).
6. **[Low]** Extract Regex constants in `TerminalScreens.kt` (Finding #6).

---

## Metrics
- Type Coverage: 100% Kotlin strict typing
- Test Coverage: 4 suites / 20+ assertions dedicated to Simple Flow (`AppFlowNavigationTest`, `SimpleFlowJourneysTest`, `ManifestSecurityTest`, `OwnershipAndReplayTests`)
- Test Results: 100% passing (44/44 tasks in `:shared:jvmTest` and `:androidApp:testDebugUnitTest`)
- Linting / Compiler Issues: 0 errors, 4 non-fatal warnings (expect/actual Beta flags, deprecated test override)

---

## Unresolved Questions
None.
