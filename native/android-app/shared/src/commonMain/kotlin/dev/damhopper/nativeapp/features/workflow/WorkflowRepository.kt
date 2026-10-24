package dev.damhopper.nativeapp.features.workflow

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.serializer
import kotlin.random.Random

sealed class WorkflowOverviewResult {
    data class Available(val overview: WorkflowOverviewDto) : WorkflowOverviewResult()
    data class Unavailable(val message: String) : WorkflowOverviewResult()
}

class WorkflowRepository(
    val apiClient: ApiClient
) {
    /**
     * Fetches current workspace workflow overview.
     * Only HTTP 404 on this route signals that the feature is unavailable on the remote server.
     * All other errors (401, 5xx, network) are thrown normally to preserve retry/auth handling.
     */
    suspend fun getOverview(): Result<WorkflowOverviewResult> = runCatching {
        try {
            val responseText = apiClient.get("/api/workflow/overview")
            val overview = ProtocolJson.decodeFromString(WorkflowOverviewDto.serializer(), responseText)
            WorkflowOverviewResult.Available(overview)
        } catch (e: ApiRequestError) {
            if (e.status == 404) {
                WorkflowOverviewResult.Unavailable("Workflow tracking is unavailable for this profile.")
            } else {
                throw e
            }
        }
    }

    suspend fun getEvents(cursor: String? = null, limit: Int? = null): Result<WorkflowEventsDto> = runCatching {
        val queryParams = mutableMapOf<String, String>()
        if (!cursor.isNullOrBlank()) {
            queryParams["cursor"] = cursor
        }
        if (limit != null && limit in 1..100) {
            queryParams["limit"] = limit.toString()
        }
        val responseText = apiClient.get("/api/workflow/events", queryParams)
        ProtocolJson.decodeFromString(WorkflowEventsDto.serializer(), responseText)
    }

    suspend fun createItem(request: CreateItemRequest): Result<MutationDto<ItemDto>> = runCatching {
        val body = ProtocolJson.encodeToString(CreateItemRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/items", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(ItemDto.serializer()), responseText)
    }

    suspend fun patchItem(id: String, request: PatchItemRequest): Result<MutationDto<ItemDto>> = runCatching {
        val encodedId = ApiClient.encodePathSegment(id)
        val body = ProtocolJson.encodeToString(PatchItemRequest.serializer(), request)
        val responseText = apiClient.patchJson("/api/workflow/items/$encodedId", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(ItemDto.serializer()), responseText)
    }

    suspend fun deleteItem(id: String, request: DeleteItemRequest): Result<TombstoneDto> = runCatching {
        val encodedId = ApiClient.encodePathSegment(id)
        val body = ProtocolJson.encodeToString(DeleteItemRequest.serializer(), request)
        val responseText = apiClient.deleteJson("/api/workflow/items/$encodedId", body)
        ProtocolJson.decodeFromString(TombstoneDto.serializer(), responseText)
    }

    suspend fun createSession(request: CreateSessionRequest): Result<MutationDto<SessionDto>> = runCatching {
        val body = ProtocolJson.encodeToString(CreateSessionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/sessions", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(SessionDto.serializer()), responseText)
    }

    suspend fun endSession(id: String, request: EndSessionRequest): Result<MutationDto<SessionDto>> = runCatching {
        val encodedId = ApiClient.encodePathSegment(id)
        val body = ProtocolJson.encodeToString(EndSessionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/sessions/$encodedId/end", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(SessionDto.serializer()), responseText)
    }

    suspend fun abandonSession(id: String, request: AbandonSessionRequest): Result<MutationDto<SessionDto>> = runCatching {
        val encodedId = ApiClient.encodePathSegment(id)
        val body = ProtocolJson.encodeToString(AbandonSessionRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/sessions/$encodedId/abandon", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(SessionDto.serializer()), responseText)
    }

    suspend fun linkResource(sessionId: String, request: LinkResourceRequest): Result<MutationDto<LinkDto>> = runCatching {
        val encodedSessionId = ApiClient.encodePathSegment(sessionId)
        val body = ProtocolJson.encodeToString(LinkResourceRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/sessions/$encodedSessionId/links", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(LinkDto.serializer()), responseText)
    }

    suspend fun unlinkResource(sessionId: String, request: UnlinkResourceRequest): Result<TombstoneDto> = runCatching {
        val encodedSessionId = ApiClient.encodePathSegment(sessionId)
        val body = ProtocolJson.encodeToString(UnlinkResourceRequest.serializer(), request)
        val responseText = apiClient.deleteJson("/api/workflow/sessions/$encodedSessionId/links", body)
        ProtocolJson.decodeFromString(TombstoneDto.serializer(), responseText)
    }

    suspend fun createNote(request: CreateNoteRequest): Result<MutationDto<NoteDto>> = runCatching {
        val body = ProtocolJson.encodeToString(CreateNoteRequest.serializer(), request)
        val responseText = apiClient.postJson("/api/workflow/notes", body)
        ProtocolJson.decodeFromString(MutationDto.serializer(NoteDto.serializer()), responseText)
    }

    suspend fun deleteNote(id: String, request: DeleteNoteRequest): Result<TombstoneDto> = runCatching {
        val encodedId = ApiClient.encodePathSegment(id)
        val body = ProtocolJson.encodeToString(DeleteNoteRequest.serializer(), request)
        val responseText = apiClient.deleteJson("/api/workflow/notes/$encodedId", body)
        ProtocolJson.decodeFromString(TombstoneDto.serializer(), responseText)
    }

    suspend fun purgeHistory(before: String): Result<PurgeDto> = runCatching {
        val body = ProtocolJson.encodeToString(PurgeHistoryRequest.serializer(), PurgeHistoryRequest(before = before))
        val responseText = apiClient.deleteJson("/api/workflow/history", body)
        ProtocolJson.decodeFromString(PurgeDto.serializer(), responseText)
    }

    companion object {
        fun generateUuid(): String {
            val bytes = Random.nextBytes(16)
            bytes[6] = (bytes[6].toInt() and 0x0f or 0x40).toByte() // version 4
            bytes[8] = (bytes[8].toInt() and 0x3f or 0x80).toByte() // IETF variant
            return buildString(36) {
                for (i in 0 until 16) {
                    if (i == 4 || i == 6 || i == 8 || i == 10) append('-')
                    val b = bytes[i].toInt() and 0xff
                    append((b shr 4).toString(16))
                    append((b and 0x0f).toString(16))
                }
            }
        }
    }
}
