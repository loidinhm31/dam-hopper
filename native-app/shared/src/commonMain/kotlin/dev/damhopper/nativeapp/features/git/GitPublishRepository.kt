package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Handles CAS-leased push preparation and publication against /api/git/{project}/push/...
 *
 * Invariants:
 * - Publication strictly requires a frozen PublishSnapshot returned by prepareLeasedPush.
 * - Leased publish uses exact expectedRemoteOid CAS lease; stale remote aborts.
 * - Normal push cannot fall back to leased push, and leased push never falls back to force push.
 */
class GitPublishRepository(
    val apiClient: ApiClient,
) {
    suspend fun prepareLeasedPush(
        project: String,
        request: PrepareLeasedPushRequest,
    ): PublishPreview {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(PrepareLeasedPushRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/push/prepare", body)
        return ProtocolJson.decodeFromString(PublishPreview.serializer(), text)
    }

    suspend fun publishLeasedPush(
        project: String,
        request: PublishLeasedPushRequest,
    ): PublishResult {
        val encodedProject = ApiClient.encodePathSegment(project)
        val body = ProtocolJson.encodeToString(PublishLeasedPushRequest.serializer(), request)
        val text = apiClient.postJson("/api/git/$encodedProject/push/publish", body)
        return ProtocolJson.decodeFromString(PublishResult.serializer(), text)
    }
}
