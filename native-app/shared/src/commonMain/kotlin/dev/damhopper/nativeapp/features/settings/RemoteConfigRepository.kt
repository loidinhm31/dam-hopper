package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Communicates with server config endpoints:
 * - /api/config (GET/PUT)
 * - /api/config/projects/{name} (PATCH)
 * - /api/global-config (GET)
 * - /api/global-config/ui (POST)
 */
class RemoteConfigRepository(
    val apiClient: ApiClient,
) {
    suspend fun getFullConfig(): String {
        return apiClient.get("/api/config")
    }

    suspend fun updateFullConfig(fullJson: String): Boolean {
        val text = apiClient.putJson("/api/config", fullJson)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun patchProject(projectName: String, patchJson: String): Boolean {
        val encodedName = ApiClient.encodePathSegment(projectName)
        val text = apiClient.patchJson("/api/config/projects/$encodedName", patchJson)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["ok"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun getGlobalConfig(): JsonObject {
        val text = apiClient.get("/api/global-config")
        return ProtocolJson.decodeFromString(JsonObject.serializer(), text)
    }

    suspend fun getUiPreferences(): UiPreferences {
        val global = getGlobalConfig()
        val uiObj = global["ui"]?.jsonObject ?: return UiPreferences()
        return ProtocolJson.decodeFromString(UiPreferences.serializer(), uiObj.toString())
    }

    suspend fun updateGlobalUi(preferences: UiPreferences): Boolean {
        val uiJson = buildJsonObject {
            preferences.systemFontSize?.let { put("systemFontSize", it) }
            preferences.editorFontSize?.let { put("editorFontSize", it) }
            preferences.terminalFontSize?.let { put("terminalFontSize", it) }
            preferences.cognitoModeShortcut?.let { put("cognitoModeShortcut", it) }
            preferences.cognitoModeStyle?.let { put("cognitoModeStyle", it) }
        }
        val requestBody = buildJsonObject {
            put("ui", uiJson)
        }.toString()

        val text = apiClient.postJson("/api/global-config/ui", requestBody)
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), text)
        return obj["updated"]?.jsonPrimitive?.booleanOrNull == true
    }
}
