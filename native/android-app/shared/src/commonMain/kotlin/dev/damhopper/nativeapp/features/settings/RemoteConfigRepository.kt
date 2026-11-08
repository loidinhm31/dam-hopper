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
 * - `/api/global-config` (GET), `/api/global-config/ui` and `/api/global-config/workspace` (POST)
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
        val parsed = ProtocolJson.decodeFromString(UiPreferences.serializer(), uiObj.toString())
        val unbounds = uiObj.entries.filter { it.value is kotlinx.serialization.json.JsonNull }.map { it.key }.toSet()
        return parsed.copy(unboundFields = unbounds)
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
     * Updates the server-global [workspace] root (and optional name) in config.toml.
     * Posts {"root": root} or {"root": root, "name": name} to /api/global-config/workspace.
     */
    suspend fun updateGlobalWorkspace(root: String, name: String? = null, guard: RequestAdmissionGuard): Boolean {
        require(root.isNotBlank()) { "Workspace root path is blank" }
        val body = buildJsonObject {
            put("root", root)
            if (name != null) put("name", name)
        }.toString()
        val text = apiClient.postJson("/api/global-config/workspace", body, guard)
        return confirmedFlag(text, "updated") || confirmedFlag(text, "ok")
    }

    /**
     * Posts a sparse UI patch where null values explicitly unbind keys (POST /api/global-config/ui).
     * Omitted keys remain unchanged; remote web-only keys are preserved untouched.
     */
    suspend fun updateGlobalUiSparse(patch: SparseUiConfigPatch, guard: RequestAdmissionGuard): Boolean {
        require(patch.ui.isNotEmpty()) { "UI preference patch is empty" }
        val body = buildJsonObject {
            put("ui", buildJsonObject {
                patch.ui.forEach { (k, v) ->
                    if (v == null || v is kotlinx.serialization.json.JsonNull) {
                        put(k, kotlinx.serialization.json.JsonNull)
                    } else {
                        put(k, v)
                    }
                }
            })
        }.toString()
        val text = apiClient.postJson("/api/global-config/ui", body, guard)
        return confirmedFlag(text, "updated")
    }

    /** True only for a JSON object whose [key] is the boolean `true`; malformed bodies throw. */
    private fun confirmedFlag(responseText: String, key: String): Boolean {
        val obj = ProtocolJson.decodeFromString(JsonObject.serializer(), responseText)
        val primitive = obj[key]?.jsonPrimitive ?: return false
        return !primitive.isString && primitive.booleanOrNull == true
    }
}
