# Phase 04 Code Review Report: Profiles, Authentication, MFA & Credential Vault

- **Date:** 2026-10-15
- **Working Directory:** `/home/loidinh/WS/worktrees/dam-hopper-android-native-app`
- **Scope:** Phase 04 changes across `native-app/shared/` and `native-app/androidApp/`
- **Reviewer:** Phase04Reviewer (Senior Staff Engineer / Code Quality Assessment)
- **Score:** **8.5 / 10**

---

## 1. Summary of Changes

Phase 04 implements multi-server profiles, authentication state machines, TOTP MFA challenges/enrollment, and hardware-backed credential custody for the Android native client:

1. **Shared Domain Models (`features/profiles/`):**
   - `AuthState.kt`: Frozen protocol constants (`authProtocol = 2`, `workbenchProtocol = 2`), standard `AuthErrorCodes`, domain DTOs (`AuthSession`, `LoginChallenge`, `MfaSetupData`) with `toString()` credential redaction (`[REDACTED]`), and sealed `AuthStatus` hierarchy.
   - `ServerProfile.kt`: Strict server URL normalization and validation (scheme check, authority user-info rejection, query/fragment rejection, loopback address checks).
   - `AuthAttemptRef.kt` & `AuthAttemptTracker.kt`: Monotonic attempt fencing preventing late asynchronous callbacks from polluting rotated or logged-out profile state.
   - `CredentialVault.kt` & `InMemoryCredentialVault.kt`: Fail-closed vault contract with `VaultKeyInvalidatedException`; in-memory test implementation with key invalidation simulation.
   - `AuthWireDto.kt`, `AuthResponseParser.kt`, `AuthStatusParser.kt`: Serialization models and strict protocol version 2 validation across status, login, setup, confirm, and challenge flows.
   - `AuthRepository.kt`: Clean REST authentication operations against server endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/mfa/*`, `/api/auth/status`, `/api/auth/logout`).
   - `ProfileRepository.kt`: Profile lifecycle management, connection generation retirement on edit/logout/rotation, independent profile state partitioning.
   - `ProfileMetadataStore.kt`: Interface and in-memory store for non-secret server profile metadata.

2. **Compose UI Presentation:**
   - `WorkbenchHeader.kt`: Restored full-width layout (`fillMaxWidth()`) and interactive profile management trigger.
   - `WorkbenchScreen.kt`: Integrated `ProfileListScreen` under SETTINGS panel and header click, preserving strict TERMINAL traditional mode and zero-FAB invariants.
   - `WorkbenchAuthFlow.kt`, `ProfileListScreen.kt`, `AddProfileCard.kt`: Profile CRUD, server switching, and active profile indicators.
   - `AuthDialog.kt`: Tabbed login/register dialog with masked password inputs (`PasswordVisualTransformation`) and operator approval notice.
   - `MfaChallengeContent.kt`: Transient TOTP setup secret/code entry with clear disclosure of non-persistent secrets.

3. **Android Platform Adapter:**
   - `AndroidCredentialVault.kt`: Backed by Android Keystore and `EncryptedSharedPreferences` (`AES256_GCM` + `AES256_SIV`). Configured with explicit `data_extraction_rules.xml` backup exclusion and fail-closed exception handling.
   - `MainActivity.kt`: Wired `AndroidCredentialVault`, `ConnectionRegistry`, and `ProfileRepository`.

4. **Remediations Applied During Review:**
   - Fixed missing `Modifier.fillMaxWidth()` on `WorkbenchHeader` `Row` that squished header components.
   - Fixed swallowed `ApiRequestError` in `AuthResponseParser.parseLoginResponse` so protocol negotiation mismatches fail fast.
   - Added post-body completion ownership recheck (`assertActiveOwner`) in `ApiClient.handleResponse` to prevent race conditions during response body consumption.

---

## 2. Critical Issues (MUST FIX)

1. **[CRIT-1] Android Profile Metadata Is Not Persistent Across App Lifecycle**
   - **Location:** `MainActivity.kt:18` & `ProfileRepository.kt:24`
   - **Problem:** `MainActivity` constructs `ProfileRepository` without providing a persistent `ProfileMetadataStore`. It defaults to `InMemoryProfileMetadataStore`. Consequently, all configured server profiles disappear whenever the Android Activity is destroyed, recreated, or the app process restarts. However, encrypted tokens in `AndroidCredentialVault` (EncryptedSharedPreferences) *do* persist, leading to orphaned credentials.
   - **Remediation:** Implement `AndroidProfileMetadataStore` backed by standard `SharedPreferences` storing JSON under key `damhopper_server_profiles` (matching web client storage semantics), and inject it into `ProfileRepository` inside `MainActivity`.

2. **[CRIT-2] Native Physical-Device & Live-Server Qualification Pending**
   - **Location:** Plan ledger & verification scope (`phase-04-profiles-auth-mfa-and-credential-vault.md`)
   - **Problem:** All executed checks are automated unit tests against mock HTTP fixtures and shell AST assertions. The plan’s acceptance ledger requires runtime proof against an authenticated live backend instance and physical hardware Keystore.
   - **Remediation:** Keep live device runtime acceptance pending until Phase 18 (Integrated Device Security & Performance Qualification) and document this boundary explicitly in the acceptance ledger.

---

## 3. Warnings (SHOULD FIX)

1. **[WARN-1] Main-Thread Blocking on Credential Vault Reads (`runBlocking`)**
   - **Location:** `ProfileRepository.kt:123-127`
   - **Problem:** `getOrCreateApiClient` supplies `authTokenProvider` as `{ kotlinx.coroutines.runBlocking { vault.getToken(profileId, profile.baseUrl) } }`. When API requests originate from Compose UI scopes (`rememberCoroutineScope` defaults to `Dispatchers.Main.immediate`), `runBlocking` blocks the Android main thread during disk I/O and Keystore Binder IPC.
   - **Remediation:** Convert `authTokenProvider` in `ApiClient`, `WsConnection`, and `HostResourceSseClient` to `suspend () -> String? = { null }`. All callers are already suspending functions, which eliminates `runBlocking` entirely.

2. **[WARN-2] Repeated EncryptedSharedPreferences Instantiation**
   - **Location:** `AndroidCredentialVault.kt:27-46`
   - **Problem:** `getEncryptedPrefs()` builds `MasterKey` and invokes `EncryptedSharedPreferences.create()` on every single token read, write, and clear. This introduces substantial GC pressure, disk XML parsing, and Keystore IPC latency on every HTTP request.
   - **Remediation:** Cache the `SharedPreferences` instance in a private field. Recreate it only if a `VaultKeyInvalidatedException` or security error occurs.

3. **[WARN-3] Concurrent Read-Modify-Write Race on `_authStatuses`**
   - **Location:** `ProfileRepository.kt:140-143, 161-166`
   - **Problem:** `applyAuthenticatedSession` and `logout` read `_authStatuses.value.toMutableMap()` and replace `_authStatuses.value` outside of `mutex.withLock`. Concurrent updates to different profiles can overwrite and drop each other's status updates.
   - **Remediation:** Use atomic `_authStatuses.update { current -> current + (profileId to status) }` or wrap all mutations in `mutex.withLock`.

---

## 4. Suggestions (NICE TO HAVE)

1. **[SUGG-1] Virtual Keyboard Type for Numeric TOTP Entry**
   - **Location:** `MfaChallengeContent.kt:70-76`
   - **Suggestion:** Add `keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)` to the 6-digit code `OutlinedTextField` to automatically present a numeric keypad on mobile touchscreens. Add `KeyboardType.Password` to `AuthDialog` to prevent system keyboard dictionary caching.

2. **[SUGG-2] Compose LazyColumn Item Keying**
   - **Location:** `ProfileListScreen.kt:78`
   - **Suggestion:** Supply `items(profiles, key = { it.id })` to prevent item recreation and state glitches during profile deletion or reordering.

3. **[SUGG-3] Invalidate Auth Attempt on Dialog Dismissal**
   - **Location:** `WorkbenchAuthFlow.kt:105-108`
   - **Suggestion:** Call `profileRepository.attemptTracker.invalidate(profileId)` when `onDismiss` is triggered during an active challenge to immediately retire pending watermarks.

4. **[SUGG-4] IPv6 URL Host Parsing in Loopback Checks**
   - **Location:** `ServerProfile.kt:70-74, 82-87`
   - **Suggestion:** Bracketed IPv6 URLs (e.g. `http://[::1]:4800`) produce host `[` when split naively by `:`. Strip brackets before port parsing and loopback validation.

---

## 5. Reviewed Files

| File | Module | Status / Purpose |
|---|---|---|
| `features/profiles/AuthState.kt` | `:shared` | Auth models, frozen protocols, redaction |
| `features/profiles/ServerProfile.kt` | `:shared` | URL validation, normalization |
| `features/profiles/AuthAttemptRef.kt` | `:shared` | Attempt token & stale exception |
| `features/profiles/AuthAttemptTracker.kt` | `:shared` | Monotonic watermark concurrency tracker |
| `features/profiles/CredentialVault.kt` | `:shared` | Secure vault contract |
| `features/profiles/InMemoryCredentialVault.kt` | `:shared` | Test vault with key invalidation |
| `features/profiles/AuthWireDto.kt` | `:shared` | Internal JSON wire DTOs |
| `features/profiles/AuthResponseParser.kt` | `:shared` | Response parser (fixed exception swallowing) |
| `features/profiles/AuthStatusParser.kt` | `:shared` | Status parser and error code mapper |
| `features/profiles/AuthRepository.kt` | `:shared` | REST API operations |
| `features/profiles/ProfileMetadataStore.kt` | `:shared` | Profile persistence interface |
| `features/profiles/ProfileRepository.kt` | `:shared` | Profile & auth lifecycle orchestrator |
| `features/profiles/ProfileListScreen.kt` | `:shared` | Profile management UI |
| `features/profiles/AddProfileCard.kt` | `:shared` | Profile creation card |
| `features/profiles/AuthDialog.kt` | `:shared` | Masked login/register dialog |
| `features/profiles/MfaChallengeContent.kt` | `:shared` | Transient TOTP challenge UI |
| `ui/screens/WorkbenchScreen.kt` | `:shared` | Settings integration & profile routing |
| `ui/screens/WorkbenchAuthFlow.kt` | `:shared` | UI auth flow state coordinator |
| `ui/components/WorkbenchHeader.kt` | `:shared` | Header UI (restored `fillMaxWidth`) |
| `core/transport/ApiClient.kt` | `:shared` | Added post-body ownership fence |
| `platform/vault/AndroidCredentialVault.kt` | `:androidApp` | Keystore EncryptedSharedPreferences vault |
| `MainActivity.kt` | `:androidApp` | Component wiring & launch initialization |
| `features/profiles/ProfileRepositoryTest.kt` | `:shared:jvmTest` | Profile lifecycle & fencing tests (6 tests) |
| `features/profiles/AuthRepositoryTest.kt` | `:shared:jvmTest` | HTTP auth & protocol tests (9 tests) |
| `features/profiles/CredentialVaultTest.kt` | `:shared:jvmTest` | Vault isolation & redaction tests (6 tests) |
| `platform/vault/AndroidCredentialVaultTest.kt` | `:androidApp:test` | Keystore & backup exclusion tests (3 tests) |
| `tests/test-phase-04-profiles-auth.sh` | `tests/` | Static invariant verification script (54 checks) |

---

## 6. Validation Commands & Results

| Command / Suite | Tests Executed | Passed | Failed | Status |
|---|---|---|---|---|
| `bash tests/test-phase-04-profiles-auth.sh` | 54 assertions | 54 | 0 | **PASSED (100%)** |
| `bash tests/test-phase-03-transport.sh` | 48 assertions | 48 | 0 | **PASSED (100%)** |
| `bash tests/test-phase-02-foundation.sh` | 47 assertions | 47 | 0 | **PASSED (100%)** |
| `./native-app/gradlew -p native-app :shared:jvmTest --rerun-tasks` | 53 unit tests | 53 | 0 | **PASSED (100%)** |
| `./native-app/gradlew -p native-app :androidApp:testDebugUnitTest --rerun-tasks` | 7 unit tests | 7 | 0 | **PASSED (100%)** |
| `./native-app/gradlew -p native-app :androidApp:assembleDebug` | 55 tasks | 55 | 0 | **SUCCESSFUL** |

---

## 7. Unresolved Questions

1. Should `AndroidProfileMetadataStore` (persisting `damhopper_server_profiles` to standard Android SharedPreferences) be implemented immediately as a remediation before proceeding to Phase 05, or scheduled for Phase 06 (Shell, Projects & Worktrees)?
2. Should `authTokenProvider` in `ApiClient` be transitioned to `suspend () -> String?` in Phase 05 to permanently eliminate `runBlocking` across all network layers?
