package dev.damhopper.nativeapp.features.settings

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.core.transport.RequestAdmissionGuard
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Sole owner of the server config endpoints used by Settings:
 * - `/api/config` (GET/PUT), `/api/config/projects/{name}` (PATCH)
 * - `/api/global-config` (GET), `/api/global-config/ui` and `/api/global-config/defaults` (POST)
 *
 * Every mutation takes a **required** request-local [RequestAdmissionGuard] (C2b) that is forwarded unchanged
 * to the existing transport. A `false` return means the server did not confirm; after admission the caller
 * must report that as Unknown (the server may have mutated), never as a retryable failure. Nothing here
 * retries or replays a request. Reads accept an optional guard but callers always fence publication.
 */
class RemoteConfigRepository(
    val apiClient: ApiClient,
) {
    suspend fun getFullConfig(guard: RequestAdmissionGuard? = null): String {
        return apiClient.get("/api/config", guard = guard)
    }

    suspend fun updateFullConfig(fullJson: String, guard: RequestAdmissionGuard): Boolean {
        val text = apiClient.putJson("/api/config", fullJson, guard)
        return confirmedFlag(text, "ok")
    }

    suspend fun patchProject(projectName: String, patchJson: String, guard: RequestAdmissionGuard): Boolean {
        val encodedName = ApiClient.encodePathSegment(projectName)
        val text = apiClient.patchJson("/api/config/projects/$encodedName", patchJson, guard)
        return confirmedFlag(text, "ok")
    }

    suspend fun getGlobalConfig(guard: RequestAdmissionGuard? = null): JsonObject {
        val text = apiClient.get("/api/global-config", guard = guard)
        return ProtocolJson.decodeFromString(JsonObject.serializer(), text)
    }

    suspend fun getUiPreferences(guard: RequestAdmissionGuard? = null): UiPreferences {
        val global = getGlobalConfig(guard)
        val uiObj = global["ui"]?.jsonObject ?: return UiPreferences()
        return ProtocolJson.decodeFromString(UiPreferences.serializer(), uiObj.toString())
    }

    /**
     * Posts exactly the non-null (dirty) fields as `{ "ui": { ... } }`; never a full defaulted UI object and
     * never unknown remote properties.
     */
    suspend fun updateGlobalUi(preferences: UiPreferences, guard: RequestAdmissionGuard): Boolean {
        require(!preferences.isEmpty()) { "UI preference patch is empty" }
        val text = apiClient.postJson("/api/global-config/ui", preferences.toUiRequestBody(), guard)
        return confirmedFlag(text, "updated")
    }

    /**
     * Replaces the global `defaults` object (it does not touch the known-workspace registry).
     * Set sends exactly `{"defaults":{"workspace":path}}`; Clear (`workspace == null`) sends exactly
     * `{"defaults":{}}`.
     */
    suspend fun updateGlobalDefaults(workspace: String?, guard: RequestAdmissionGuard): Boolean {
        require(workspace == null || workspace.isNotBlank()) { "Default workspace path is blank" }
        val body = buildJsonObject {
            put(
                "defaults",
                buildJsonObject {
                    if (workspace != null) put("workspace", workspace)
                },
            )
        }.toString()
        val text = apiClient.postJson("/api/global-config/defaults", body, guard)
        return confirmedFlag(text, "updated")
    }

    /** True only for a JSON object whose [key] is the boolean `true`; malformed bodies throw. */
    private fun confirmedFlag(responseText: String, key: String): Boolean {
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), responseText)
        val primitive = obj[key]?.jsonPrimitive ?: return false
        return !primitive.isString && primitive.booleanOrNull == true
    }
}
