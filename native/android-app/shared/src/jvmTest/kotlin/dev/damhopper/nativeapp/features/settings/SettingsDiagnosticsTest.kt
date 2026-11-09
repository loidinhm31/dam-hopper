package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationChannelStatus
import dev.damhopper.nativeapp.core.notifications.NotificationPermissionState
import dev.damhopper.nativeapp.core.notifications.NotificationPlatformStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SettingsDiagnosticsTest {
    private fun input(
        prefs: WorkbenchPreferences = WorkbenchPreferences(),
        platform: NotificationPlatformStatus? = null,
    ) = SettingsDiagnosticsInput(
        generatedAtMs = 1_700_000_000_000L,
        preferences = prefs,
        sourceStatus = PreferenceSourceStatus.ACTIVE,
        syncStatus = PreferenceSyncStatus.SYNCED,
        sourceSelected = true,
        targetSelected = false,
        unsupportedRemotePolicy = false,
        legacyLanguageFilterNotice = true,
        storageRecoverableError = false,
        configuredServerCount = 2,
        notificationPlatform = platform,
    )

    private fun parse(bytes: ByteArray): JsonObject = Json.parseToJsonElement(bytes.decodeToString()).jsonObject

    @Test
    fun documentHasExactlyTheAllowlistedTopLevelKeysAndIsLocalScoped() {
        val doc = parse(SettingsDiagnostics.build(input()))
        assertEquals(SettingsDiagnostics.TOP_LEVEL_KEYS, doc.keys)
        assertEquals("LOCAL", doc["scope"]!!.jsonPrimitive.content)
        assertEquals(SettingsDiagnostics.FORMAT, doc["format"]!!.jsonPrimitive.content)
        assertEquals("2", doc["configuredServerCount"]!!.jsonPrimitive.content)
    }

    @Test
    fun freeTextConsentedHistoryAndPrivateFieldsNeverAppear() {
        val prefs = WorkbenchPreferences(statusFilter = "super-secret-token-123 /home/alice/.ssh/id_rsa", commandHistoryEnabled = true)
        val text = SettingsDiagnostics.build(input(prefs)).decodeToString()
        assertFalse(text.contains("super-secret"), text)
        assertFalse(text.contains("/home/alice"))
        assertFalse(text.contains("statusFilter"))
        assertFalse(text.contains("agentSettingsPaths"))
        assertFalse(text.contains("Bearer", ignoreCase = true))
        assertFalse(text.contains("password", ignoreCase = true))
        // Consent is a boolean only; there is no history payload at all.
        val doc = parse(text.encodeToByteArray())
        assertEquals("true", doc["preferences"]!!.jsonObject["commandHistoryEnabled"]!!.jsonPrimitive.content)
        assertFalse(doc["preferences"]!!.jsonObject.keys.any { it.contains("history", ignoreCase = true) && it != "commandHistoryEnabled" })
    }

    @Test
    fun preferencesShortcutsAndPolicyAreReportedFaithfully() {
        val prefs = WorkbenchPreferences(
            editorFontSize = 18,
            terminalScrollStep = 50,
            explorerLanguageFilter = ExplorerLanguageFilter.JAVASCRIPT_TYPESCRIPT,
            searchFilenameShortcut = "DoubleShift",
            terminalAgentNotifications = TerminalAgentNotifications(
                agents = AgentPolicies(claude = TerminalAgentPolicy(enabled = true, volume = 0.25, pattern = "urgent")),
            ),
        )
        val doc = parse(SettingsDiagnostics.build(input(prefs)))
        val p = doc["preferences"]!!.jsonObject
        assertEquals("18", p["editorFontSize"]!!.jsonPrimitive.content)
        assertEquals("50", p["terminalScrollStep"]!!.jsonPrimitive.content)
        assertEquals("javascript-typescript", p["explorerLanguageFilter"]!!.jsonPrimitive.content)
        assertEquals("DoubleShift", doc["shortcuts"]!!.jsonObject["SEARCH_FILENAME"]!!.jsonPrimitive.content)
        assertEquals(ShortcutAction.entries.map { it.name }.toSet(), doc["shortcuts"]!!.jsonObject.keys)
        val claude = doc["notificationPolicy"]!!.jsonObject["claude"]!!.jsonObject
        assertEquals("true", claude["enabled"]!!.jsonPrimitive.content)
        assertEquals("urgent", claude["pattern"]!!.jsonPrimitive.content)
        assertEquals("0.25", claude["volume"]!!.jsonPrimitive.content)
    }

    @Test
    fun platformStatusIsPermissionAndChannelFlagsOnly() {
        val none = parse(SettingsDiagnostics.build(input()))
        assertEquals(JsonNull, none["platform"])

        val status = NotificationPlatformStatus(
            permission = NotificationPermissionState.DENIED,
            appBlocked = false,
            channels = mapOf(NotificationChannelId.TERMINAL_ATTENTION to NotificationChannelStatus(blocked = true, soundConfigured = false)),
        )
        val doc = parse(SettingsDiagnostics.build(input(platform = status)))
        val platform = doc["platform"]!!.jsonObject
        assertEquals("DENIED", platform["permission"]!!.jsonPrimitive.content)
        val channel = platform["channels"]!!.jsonObject["TERMINAL_ATTENTION"]!!.jsonObject
        assertEquals(setOf("blocked", "soundConfigured"), channel.keys)
        assertTrue(channel["blocked"]!!.jsonPrimitive.content == "true")
    }

    @Test
    fun fileNameIsDeterministicAndHasNoUserText() {
        assertEquals("damhopper-diagnostics-1700000000000.json", SettingsDiagnostics.suggestedFileName(1_700_000_000_000L))
        assertEquals("application/json", SettingsDiagnostics.MIME_TYPE)
    }

    @Test
    fun everyStringValuedPreferenceIsValidatedSoPrivateLookingTextCannotLeak() {
        val secret = "private-token-9f3a/home/alice"
        val hostile = WorkbenchPreferences(
            searchTextShortcut = "Mod+$secret",
            searchFilenameShortcut = "Alt+$secret",
            terminalWorkspaceShortcut = secret,
            terminalFilePanelShortcut = "Cmd+Shift+$secret",
            projectPanelShortcut = "Wheel",
            revealActiveFileShortcut = "$secret+KeyA",
            gitPanelShortcut = "Mod+Shift+KeyG",
            terminalAgentNotifications = TerminalAgentNotifications(
                agents = AgentPolicies(omp = TerminalAgentPolicy(pattern = secret), claude = TerminalAgentPolicy(volume = Double.NaN)),
            ),
        )
        // Build the document from the raw (un-normalized) value to prove export itself validates.
        val text = SettingsDiagnostics.build(input(hostile)).decodeToString()
        assertFalse(text.contains("private-token"), text)
        assertFalse(text.contains("alice"), text)
        val doc = parse(text.encodeToByteArray())
        val shortcuts = doc["shortcuts"]!!.jsonObject
        assertEquals(SettingsDiagnostics.INVALID_VALUE, shortcuts["SEARCH_TEXT"]!!.jsonPrimitive.content)
        assertEquals(SettingsDiagnostics.INVALID_VALUE, shortcuts["PROJECT_PANEL"]!!.jsonPrimitive.content)
        assertEquals("Mod+Shift+KeyG", shortcuts["GIT_PANEL"]!!.jsonPrimitive.content, "valid chords are exported")
        assertEquals(SettingsDiagnostics.INVALID_VALUE, doc["notificationPolicy"]!!.jsonObject["omp"]!!.jsonObject["pattern"]!!.jsonPrimitive.content)
        assertEquals("0.0", doc["notificationPolicy"]!!.jsonObject["claude"]!!.jsonObject["volume"]!!.jsonPrimitive.content)
    }

    @Test
    fun diagnosticRedactionSanitizesTokensCredentialsPasswordsAndTicketPaths() {
        // Tokens: Bearer, url query token, access_token:
        val bearer = "Authorization: Bearer secret_jwt_token_12345.xyz"
        val redactedBearer = SettingsDiagnostics.redact(bearer)
        assertFalse(redactedBearer.contains("secret_jwt_token"))
        assertTrue(redactedBearer.contains("Bearer [REDACTED]"))

        val urlToken = "wss://127.0.0.1:4803/ws?token=tok_super_secret_value&mode=term"
        val redactedUrlToken = SettingsDiagnostics.redact(urlToken)
        assertFalse(redactedUrlToken.contains("tok_super_secret_value"))
        assertTrue(redactedUrlToken.contains("token=[REDACTED]"))

        val accessToken = "access_token=secret_access_val_789"
        val redactedAccessToken = SettingsDiagnostics.redact(accessToken)
        assertFalse(redactedAccessToken.contains("secret_access_val_789"))
        assertTrue(redactedAccessToken.contains("access_token=[REDACTED]"))

        // Credentials & passwords:
        val userPassUrl = "https://admin:superSecret123@127.0.0.1:4801/api/terminals"
        val redactedUserPass = SettingsDiagnostics.redact(userPassUrl)
        assertFalse(redactedUserPass.contains("superSecret123"))
        assertTrue(redactedUserPass.contains("admin:[REDACTED]@"))

        val kvSecrets = "password=verySecretPass99&passwd=secret456&client_secret=topsecret&api_key=sk-live-123"
        val redactedKv = SettingsDiagnostics.redact(kvSecrets)
        assertFalse(redactedKv.contains("verySecretPass99"))
        assertFalse(redactedKv.contains("secret456"))
        assertFalse(redactedKv.contains("topsecret"))
        assertFalse(redactedKv.contains("sk-live-123"))
        assertTrue(redactedKv.contains("password=[REDACTED]"))
        assertTrue(redactedKv.contains("passwd=[REDACTED]"))
        assertTrue(redactedKv.contains("client_secret=[REDACTED]"))
        assertTrue(redactedKv.contains("api_key=[REDACTED]"))

        // Sensitive account identifiers:
        val emailText = "User email is developer.alice@damhopper.dev in the system"
        val redactedEmail = SettingsDiagnostics.redact(emailText)
        assertFalse(redactedEmail.contains("developer.alice@damhopper.dev"))
        assertTrue(redactedEmail.contains("[REDACTED]"))

        val accountQuery = "https://127.0.0.1:4803/api/user?account_id=acc_sensitive_99&user_id=usr_private_11"
        val redactedAccount = SettingsDiagnostics.redact(accountQuery)
        assertFalse(redactedAccount.contains("acc_sensitive_99"))
        assertFalse(redactedAccount.contains("usr_private_11"))
        assertTrue(redactedAccount.contains("account_id=[REDACTED]"))
        assertTrue(redactedAccount.contains("user_id=[REDACTED]"))

        // Ticket paths:
        val streamTicketPath = "https://127.0.0.1:4803/media/stream/ticket-uuid-secret-554433?ticket=tkt_secret_token"
        val redactedStream = SettingsDiagnostics.redact(streamTicketPath)
        assertFalse(redactedStream.contains("ticket-uuid-secret-554433"))
        assertFalse(redactedStream.contains("tkt_secret_token"))
        assertTrue(redactedStream.contains("/media/stream/[REDACTED]"))
        assertTrue(redactedStream.contains("ticket=[REDACTED]"))

        val ticketEndpoint = "/tickets/sec_ticket_auth_token_998877"
        val redactedTicket = SettingsDiagnostics.redact(ticketEndpoint)
        assertFalse(redactedTicket.contains("sec_ticket_auth_token_998877"))
        assertTrue(redactedTicket.contains("/tickets/[REDACTED]"))
    }

    @Test
    fun diagnosticRedactionHandlesNullEmptyAndBenignStrings() {
        assertEquals("", SettingsDiagnostics.redact(null))
        assertEquals("", SettingsDiagnostics.redact(""))
        val benign = "damhopper-desktop font=14 dark-mode=true"
        assertEquals(benign, SettingsDiagnostics.redact(benign))
    }

    @Test
    fun canaryTokensAndTicketPathsNeverEnterExportedDocument() {
        val canaryToken = "canary-jwt-token-xyz"
        val canaryPassword = "canary-password-secret"
        val canaryTicketPath = "/media/stream/ticket-canary-uuid"
        val canaryEmail = "canary.user@damhopper.dev"

        val hostile = WorkbenchPreferences(
            searchTextShortcut = "Mod+$canaryToken",
            searchFilenameShortcut = "Alt+$canaryPassword",
            terminalWorkspaceShortcut = canaryTicketPath,
            terminalFilePanelShortcut = canaryEmail,
        )
        val bytes = SettingsDiagnostics.build(input(hostile))
        val text = bytes.decodeToString()
        assertFalse(text.contains(canaryToken), "canary token must not leak")
        assertFalse(text.contains(canaryPassword), "canary password must not leak")
        assertFalse(text.contains(canaryTicketPath), "canary ticket path must not leak")
        assertFalse(text.contains(canaryEmail), "canary email must not leak")

        val doc = parse(bytes)
        assertEquals(SettingsDiagnostics.TOP_LEVEL_KEYS, doc.keys, "top level keys must remain strictly allowlisted")
    }
}
