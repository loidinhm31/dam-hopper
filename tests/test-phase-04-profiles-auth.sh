#!/usr/bin/env bash
set -euo pipefail

# Profiles, Auth, MFA & Vault Verification for Phase 04
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PASS_COUNT=0
FAIL_COUNT=0

assert_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (pattern '$pattern' not found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_not_contains() {
    local desc="$1"
    local pattern="$2"
    local file="$3"
    if ! grep -Fq "$pattern" "$file"; then
        echo "  [PASS] $desc"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "  [FAIL] $desc (prohibited pattern '$pattern' found in $file)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=== Suite 1: Frozen Protocol Matrix & Auth State Models ==="
AUTH_STATE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthState.kt"
assert_contains "Frozen authProtocol version is 2" "const val FROZEN_AUTH_PROTOCOL_VERSION: Int = 2" "$AUTH_STATE"
assert_contains "Frozen workbenchProtocol version is 2" "const val FROZEN_WORKBENCH_PROTOCOL_VERSION: Int = 2" "$AUTH_STATE"
assert_contains "AuthErrorCodes defines ACCOUNT_DISABLED" 'const val ACCOUNT_DISABLED = "ACCOUNT_DISABLED"' "$AUTH_STATE"
assert_contains "AuthErrorCodes defines MFA_REQUIRED" 'const val MFA_REQUIRED = "MFA_REQUIRED"' "$AUTH_STATE"
assert_contains "AuthErrorCodes defines SESSION_EXPIRED" 'const val SESSION_EXPIRED = "SESSION_EXPIRED"' "$AUTH_STATE"
assert_contains "AuthErrorCodes defines SESSION_REVOKED" 'const val SESSION_REVOKED = "SESSION_REVOKED"' "$AUTH_STATE"
assert_contains "AuthErrorCodes defines INCOMPATIBLE_PROTOCOL" 'const val INCOMPATIBLE_PROTOCOL = "INCOMPATIBLE_PROTOCOL"' "$AUTH_STATE"
assert_contains "AuthErrorCodes defines ATTEMPT_STALE" 'const val ATTEMPT_STALE = "ATTEMPT_STALE"' "$AUTH_STATE"
assert_contains "AuthSession toString redacts token" "token=[REDACTED]" "$AUTH_STATE"
assert_contains "LoginChallenge toString redacts token" "token=[REDACTED]" "$AUTH_STATE"
assert_contains "MfaSetupData toString redacts secret" "secret=[REDACTED]" "$AUTH_STATE"

SERVER_PROFILE="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ServerProfile.kt"
assert_contains "ServerProfile validates http/https scheme" 'trimmed.startsWith("https://", ignoreCase = true)' "$SERVER_PROFILE"
assert_contains "ServerProfile rejects credentials in URL" "Server URL cannot contain credentials in authority" "$SERVER_PROFILE"
assert_contains "ServerProfile rejects query parameters" "Server URL cannot contain query parameters" "$SERVER_PROFILE"
assert_contains "ServerProfile rejects fragments" "Server URL cannot contain fragment identifier" "$SERVER_PROFILE"
assert_contains "ServerProfile identifies loopback addresses" '"10.0.2.2"' "$SERVER_PROFILE"

echo "=== Suite 2: Credential Vault & Android Keystore Custody ==="
VAULT_CONTRACT="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/CredentialVault.kt"
assert_contains "VaultKeyInvalidatedException declared" "class VaultKeyInvalidatedException(" "$VAULT_CONTRACT"
assert_contains "CredentialVault makeKey binds profileId and baseUrl" '"token:${profileId.trim()}:${ServerProfile.normalizeUrl(baseUrl)}"' "$VAULT_CONTRACT"

ANDROID_VAULT="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/vault/AndroidCredentialVault.kt"
assert_contains "AndroidCredentialVault uses MasterKey AES256_GCM" "MasterKey.KeyScheme.AES256_GCM" "$ANDROID_VAULT"
assert_contains "AndroidCredentialVault uses EncryptedSharedPreferences AES256_GCM" "EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM" "$ANDROID_VAULT"
assert_contains "AndroidCredentialVault throws VaultKeyInvalidatedException on error" "throw VaultKeyInvalidatedException" "$ANDROID_VAULT"
assert_not_contains "AndroidCredentialVault never uses plaintext fallback" "getSharedPreferences(" "$ANDROID_VAULT"

DATA_RULES="native-app/androidApp/src/main/res/xml/data_extraction_rules.xml"
assert_contains "Data extraction excludes sharedpref from cloud-backup" '<exclude domain="sharedpref" path="."' "$DATA_RULES"
assert_contains "Data extraction excludes sharedpref from device-transfer" '<exclude domain="sharedpref" path="."' "$DATA_RULES"
PROFILE_STORE="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidProfileMetadataStore.kt"
assert_contains "AndroidProfileMetadataStore persists profiles under damhopper_server_profiles" 'KEY_PROFILES = "damhopper_server_profiles"' "$PROFILE_STORE"
assert_contains "AndroidProfileMetadataStore decodes ServerProfile list" 'ListSerializer(ServerProfile.serializer())' "$PROFILE_STORE"

MAIN_ACTIVITY="native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt"
assert_contains "MainActivity injects AndroidProfileMetadataStore" "AndroidProfileMetadataStore(applicationContext)" "$MAIN_ACTIVITY"

echo "=== Suite 3: Auth Attempt Fencing & Lifecycle Invariants ==="
ATTEMPT_REF="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthAttemptRef.kt"
assert_contains "AuthAttemptRef declared" "data class AuthAttemptRef(" "$ATTEMPT_REF"
assert_contains "AuthAttemptStaleException declared" "class AuthAttemptStaleException(" "$ATTEMPT_REF"

ATTEMPT_TRACKER="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthAttemptTracker.kt"
assert_contains "AuthAttemptTracker increments attempt ID" "val nextId = (watermarks[profileId] ?: 0L) + 1L" "$ATTEMPT_TRACKER"
assert_contains "AuthAttemptTracker validates active attempt" "throw AuthAttemptStaleException(attempt)" "$ATTEMPT_TRACKER"

PROFILE_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/ProfileRepository.kt"
assert_contains "ProfileRepository invalidates attempts on update" "attemptTracker.invalidate(id)" "$PROFILE_REPO"
assert_contains "ProfileRepository retires connection on update" "retireProfileConnection(id)" "$PROFILE_REPO"
assert_contains "ProfileRepository clears vault on update" "vault.clearToken(id, oldProfile.baseUrl)" "$PROFILE_REPO"
assert_contains "ProfileRepository invalidates attempts on logout" "attemptTracker.invalidate(profileId)" "$PROFILE_REPO"
assert_contains "ProfileRepository retires connection on logout" "retireProfileConnection(profileId)" "$PROFILE_REPO"
assert_contains "ProfileRepository clears vault on logout" "vault.clearToken(profileId, profile.baseUrl)" "$PROFILE_REPO"
assert_contains "ProfileRepository asserts attempt on session install" "attemptTracker.assertActive(attempt)" "$PROFILE_REPO"
assert_contains "ProfileRepository retires connection on session install" "retireProfileConnection(profileId)" "$PROFILE_REPO"

echo "=== Suite 4: AuthRepository & Frozen Protocol Verification ==="
AUTH_REPO="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthRepository.kt"
assert_contains "AuthRepository registers via /api/auth/register" '"/api/auth/register"' "$AUTH_REPO"
assert_contains "AuthRepository logs in via /api/auth/login" '"/api/auth/login"' "$AUTH_REPO"
assert_contains "AuthRepository fetches setup via /api/auth/mfa/setup" '"/api/auth/mfa/setup"' "$AUTH_REPO"
assert_contains "AuthRepository confirms MFA via /api/auth/mfa/confirm" '"/api/auth/mfa/confirm"' "$AUTH_REPO"
assert_contains "AuthRepository verifies MFA via /api/auth/mfa/verify" '"/api/auth/mfa/verify"' "$AUTH_REPO"
assert_contains "AuthRepository challenges step-up via /api/auth/mfa/challenge" '"/api/auth/mfa/challenge"' "$AUTH_REPO"
assert_contains "AuthRepository checks status via /api/auth/status" '"/api/auth/status"' "$AUTH_REPO"
assert_contains "AuthRepository logs out via /api/auth/logout" '"/api/auth/logout"' "$AUTH_REPO"

AUTH_PARSER="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthResponseParser.kt"
assert_contains "AuthResponseParser enforces authProtocol == FROZEN_AUTH_PROTOCOL_VERSION" "challenge.authProtocol != FROZEN_AUTH_PROTOCOL_VERSION" "$AUTH_PARSER"
assert_contains "AuthResponseParser enforces dev authProtocol version" "authProto != FROZEN_AUTH_PROTOCOL_VERSION" "$AUTH_PARSER"
assert_contains "AuthResponseParser enforces dev workbenchProtocol version" "benchProto != FROZEN_WORKBENCH_PROTOCOL_VERSION" "$AUTH_PARSER"

AUTH_STATUS_PARSER="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthStatusParser.kt"
assert_contains "AuthStatusParser enforces status authProtocol version" "authProto != FROZEN_AUTH_PROTOCOL_VERSION" "$AUTH_STATUS_PARSER"
assert_contains "AuthStatusParser maps MFA_REQUIRED status" "AuthErrorCodes.MFA_REQUIRED" "$AUTH_STATUS_PARSER"

echo "=== Suite 5: UI & Security Presentation Invariants ==="
AUTH_DIALOG="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/AuthDialog.kt"
assert_contains "AuthDialog obscures password input" "visualTransformation = PasswordVisualTransformation()" "$AUTH_DIALOG"
assert_contains "AuthDialog includes account approval notice" "Newly registered accounts are created disabled" "$AUTH_DIALOG"

MFA_CONTENT="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/profiles/MfaChallengeContent.kt"
assert_contains "MfaChallengeContent states transient secrets" "Secrets are transient and never saved." "$MFA_CONTENT"

WORKBENCH_SCREEN="native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/WorkbenchScreen.kt"
assert_contains "WorkbenchScreen provides ProfileListScreen under SETTINGS" "state.activePanel == WorkbenchPanel.SETTINGS" "$WORKBENCH_SCREEN"
assert_not_contains "WorkbenchScreen has zero FABs" "FloatingActionButton" "$WORKBENCH_SCREEN"

echo "============================================="
echo "Total assertions passed: $PASS_COUNT"
echo "Total assertions failed: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "Phase 04 Profiles & Auth verification FAILED!"
    exit 1
fi
echo "Phase 04 Profiles & Auth verification PASSED (100%)"
