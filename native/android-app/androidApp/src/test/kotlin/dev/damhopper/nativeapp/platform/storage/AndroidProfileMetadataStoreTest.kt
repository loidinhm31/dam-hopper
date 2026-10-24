package dev.damhopper.nativeapp.platform.storage

import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AndroidProfileMetadataStoreTest {

    @Test
    fun testKeyNameMatchesWebStorageConvention() {
        assertEquals("damhopper_server_profiles", AndroidProfileMetadataStore.KEY_PROFILES)
    }

    @Test
    fun testSerializationRoundtripForProfileList() {
        val profiles = listOf(
            ServerProfile(
                id = "prof-1",
                name = "Production",
                baseUrl = "https://prod.damhopper.com",
                username = "alice",
                activeProjectId = "proj-1"
            ),
            ServerProfile(
                id = "prof-2",
                name = "Development",
                baseUrl = "http://127.0.0.1:4803",
                username = "dev-user"
            )
        )

        val json = ProtocolJson.encodeToString(ListSerializer(ServerProfile.serializer()), profiles)
        val decoded = ProtocolJson.decodeFromString(ListSerializer(ServerProfile.serializer()), json)

        assertEquals(2, decoded.size)
        assertEquals("prof-1", decoded[0].id)
        assertEquals("https://prod.damhopper.com", decoded[0].baseUrl)
        assertEquals("Development", decoded[1].name)
    }

    @Test
    fun testSourceFileExistsAndUsesSharedPreferences() {
        val sourceFile = File("src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidProfileMetadataStore.kt")
        assertTrue(sourceFile.exists(), "AndroidProfileMetadataStore.kt must exist")
        val content = sourceFile.readText()
        assertTrue(content.contains("SharedPreferences"), "Must use SharedPreferences for non-secret metadata")
        assertTrue(content.contains("damhopper_server_profiles"), "Must use key damhopper_server_profiles")
    }
}
