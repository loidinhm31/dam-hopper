package dev.damhopper.nativeapp.core.logging

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RedactorTest {

    @Test
    fun testBearerTokenRedaction() {
        val input = "Authorization: Bearer secret_jwt_token_12345.xyz"
        val redacted = Redactor.redactString(input)
        assertEquals("Authorization: Bearer [REDACTED]", redacted)
        assertFalse(redacted.contains("secret_jwt_token"))
    }

    @Test
    fun testUrlTokenQueryRedaction() {
        val url = "wss://127.0.0.1:4803/ws?token=tok_super_secret_value&mode=term"
        val redacted = Redactor.redactString(url)
        assertEquals("wss://127.0.0.1:4803/ws?token=[REDACTED]&mode=term", redacted)
        assertFalse(redacted.contains("tok_super_secret_value"))
    }

    @Test
    fun testKeyValueSecretRedaction() {
        val kv = "user=admin&password=very_secure_password_99&api_key=sk_live_123"
        val redacted = Redactor.redactString(kv)
        assertEquals("user=admin&password=[REDACTED]&api_key=[REDACTED]", redacted)
        assertFalse(redacted.contains("very_secure_password_99"))
        assertFalse(redacted.contains("sk_live_123"))
    }

    @Test
    fun testMetadataMapSensitiveKeyRedaction() {
        val meta = mapOf(
            "normalKey" to "normalValue",
            "authorization" to "Bearer abcdef",
            "password" to "mypassword123",
            "apiKey" to "xyz-456",
            "serverSecret" to "hush",
            "privateKey" to "pem-data",
            "safeNote" to "connect to https://host/ws?token=mytoken",
        )
        val redacted = Redactor.redactMetadata(meta) ?: emptyMap()

        assertEquals("normalValue", redacted["normalKey"])
        assertEquals("[REDACTED]", redacted["authorization"])
        assertEquals("[REDACTED]", redacted["password"])
        assertEquals("[REDACTED]", redacted["apiKey"])
        assertEquals("[REDACTED]", redacted["serverSecret"])
        assertEquals("[REDACTED]", redacted["privateKey"])
        // Scrubbed inside string values as well:
        assertEquals("connect to https://host/ws?token=[REDACTED]", redacted["safeNote"])
    }

    @Test
    fun testOversizedStringTruncation() {
        val huge = "A".repeat(2000)
        val redacted = Redactor.redactString(huge)
        assertTrue(redacted.length <= Redactor.MAX_STRING_LENGTH + 20)
        assertTrue(redacted.endsWith("…[TRUNCATED]"))
    }

    @Test
    fun testThrowableRedaction() {
        val err = IllegalStateException("Failed connect to https://host/ws?token=leaked_secret")
        val redacted = Redactor.redactThrowable(err) ?: ""
        assertTrue(redacted.startsWith("IllegalStateException:"))
        assertFalse(redacted.contains("leaked_secret"))
        assertTrue(redacted.contains("[REDACTED]"))
    }
}
