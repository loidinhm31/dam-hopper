package dev.damhopper.nativeapp.features.profiles

import kotlinx.coroutines.test.runTest
import kotlin.test.*

class CredentialVaultTest {

    private lateinit var vault: InMemoryCredentialVault

    @BeforeTest
    fun setUp() {
        vault = InMemoryCredentialVault()
    }

    @Test
    fun testStoreAndRetrieveToken() = runTest {
        vault.storeToken("prof-1", "https://prod.damhopper.com", "token-secret-123")
        val retrieved = vault.getToken("prof-1", "https://prod.damhopper.com")
        assertEquals("token-secret-123", retrieved)
    }

    @Test
    fun testClearToken() = runTest {
        vault.storeToken("prof-1", "https://prod.damhopper.com", "token-secret-123")
        vault.clearToken("prof-1", "https://prod.damhopper.com")
        assertNull(vault.getToken("prof-1", "https://prod.damhopper.com"))
    }

    @Test
    fun testEndpointIsolationWithinProfile() = runTest {
        // Same profile ID but different endpoint URLs must remain isolated
        vault.storeToken("prof-1", "https://prod.damhopper.com", "token-prod")
        vault.storeToken("prof-1", "https://staging.damhopper.com", "token-staging")

        assertEquals("token-prod", vault.getToken("prof-1", "https://prod.damhopper.com"))
        assertEquals("token-staging", vault.getToken("prof-1", "https://staging.damhopper.com"))

        vault.clearToken("prof-1", "https://prod.damhopper.com")
        assertNull(vault.getToken("prof-1", "https://prod.damhopper.com"))
        assertEquals("token-staging", vault.getToken("prof-1", "https://staging.damhopper.com"))
    }

    @Test
    fun testProfileIsolationWithIdenticalEndpoints() = runTest {
        // Two separate profiles pointing to the same server URL must not share tokens
        vault.storeToken("prof-alpha", "https://server.com", "token-alpha")
        vault.storeToken("prof-beta", "https://server.com", "token-beta")

        assertEquals("token-alpha", vault.getToken("prof-alpha", "https://server.com"))
        assertEquals("token-beta", vault.getToken("prof-beta", "https://server.com"))

        vault.clearAllForProfile("prof-alpha")
        assertNull(vault.getToken("prof-alpha", "https://server.com"))
        assertEquals("token-beta", vault.getToken("prof-beta", "https://server.com"))
    }

    @Test
    fun testVaultKeyInvalidationFailsClosed() = runTest {
        vault.storeToken("prof-1", "https://prod.damhopper.com", "token-secret")
        vault.simulateKeyInvalidation = true

        assertFailsWith<VaultKeyInvalidatedException> {
            vault.getToken("prof-1", "https://prod.damhopper.com")
        }

        assertFailsWith<VaultKeyInvalidatedException> {
            vault.storeToken("prof-1", "https://prod.damhopper.com", "token-new")
        }

        assertFailsWith<VaultKeyInvalidatedException> {
            vault.clearToken("prof-1", "https://prod.damhopper.com")
        }
    }

    @Test
    fun testToStringRedactsSensitiveFields() {
        val session = AuthSession(
            token = "super-secret-jwt-token-xyz",
            user = "alice",
            role = "admin",
            expiresAt = "2026-11-15T00:00:00Z"
        )
        assertFalse(session.toString().contains("super-secret-jwt-token-xyz"))
        assertTrue(session.toString().contains("[REDACTED]"))

        val challenge = LoginChallenge(
            type = ChallengeType.MFA_REQUIRED,
            challengeToken = "sensitive-challenge-token-abc",
            challengeExpiresAt = "2026-10-15T22:30:00Z"
        )
        assertFalse(challenge.toString().contains("sensitive-challenge-token-abc"))
        assertTrue(challenge.toString().contains("[REDACTED]"))

        val setup = MfaSetupData(
            secret = "BASE32SECRET123456",
            otpauthUri = "otpauth://totp/DamHopper:alice?secret=BASE32SECRET123456",
            issuer = "DamHopper",
            accountName = "alice"
        )
        assertFalse(setup.toString().contains("BASE32SECRET123456"))
        assertTrue(setup.toString().contains("[REDACTED]"))
    }
}
