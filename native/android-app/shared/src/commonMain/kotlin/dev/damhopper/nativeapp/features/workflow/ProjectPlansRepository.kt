package dev.damhopper.nativeapp.features.workflow

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ApiRequestError
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import dev.damhopper.nativeapp.features.files.FileRepository
import kotlinx.coroutines.CancellationException

sealed class PlanDocumentReadResult {
    data class Success(val content: String, val sizeBytes: Long, val modifiedAt: String? = null) : PlanDocumentReadResult()
    data class Oversize(val sizeBytes: Long) : PlanDocumentReadResult()
    data class Unreadable(val reason: String) : PlanDocumentReadResult()
    object Absent : PlanDocumentReadResult()
}

class ProjectPlansRepository(
    val apiClient: ApiClient,
    val fileRepository: FileRepository? = null
) {
    /**
     * Lists plan folders under the specified path (defaults to "plans").
     */
    suspend fun getPlanFolders(
        project: String,
        worktreePath: String? = null,
        path: String? = null
    ): Result<PlanFoldersResponse> = runCatching {
        val queryParams = mutableMapOf("project" to project)
        if (!worktreePath.isNullOrBlank()) {
            queryParams["worktree_path"] = worktreePath
        }
        if (!path.isNullOrBlank()) {
            queryParams["path"] = path
        }
        val responseText = apiClient.get("/api/plans/folders", queryParams)
        ProtocolJson.decodeFromString(PlanFoldersResponse.serializer(), responseText)
    }

    /**
     * Reads a selected plan.md file and its declared phases/milestones.
     */
    suspend fun getSelectedPlan(
        project: String,
        worktreePath: String? = null,
        planPath: String
    ): Result<SelectedPlanResponse> = runCatching {
        val queryParams = mutableMapOf(
            "project" to project,
            "planPath" to planPath
        )
        if (!worktreePath.isNullOrBlank()) {
            queryParams["worktree_path"] = worktreePath
        }
        val responseText = apiClient.get("/api/plans", queryParams)
        ProtocolJson.decodeFromString(SelectedPlanResponse.serializer(), responseText)
    }

    /**
     * Reads a linked plan document (e.g. phase document or plan.md) with strict path containment
     * and a 64 KiB resource ceiling. Over-size documents are rejected before buffering.
     */
    suspend fun readPlanDocument(
        project: String,
        worktreePath: String? = null,
        relativePath: String
    ): PlanDocumentReadResult {
        // Enforce safe relative path containment
        val normalized = relativePath.trim()
        val segments = normalized.split('/', '\\')
        if (normalized.isBlank() ||
            normalized.startsWith("/") ||
            normalized.startsWith("\\") ||
            segments.any { it == ".." || it == "." } ||
            normalized.contains('\u0000') ||
            normalized.startsWith("http://") ||
            normalized.startsWith("https://")
        ) {
            return PlanDocumentReadResult.Unreadable("Invalid path: path traversal, absolute path, or external URL rejected")
        }

        val target = ProjectTargetRef(project = project, worktreePath = worktreePath)
        val maxBytes = PlanConstants.MAX_DOCUMENT_BYTES

        // Use fileRepository if available for stat / bounded read, or fallback to REST GET /api/fs/read
        if (fileRepository != null) {
            return try {
                // Request maxBytes + 1 bytes to detect oversize without downloading unbounded files
                val readResult = fileRepository.readFile(
                    target = target,
                    relativePath = normalized,
                    offset = 0uL,
                    len = (maxBytes + 1).toULong()
                )
                if (!readResult.ok) {
                    if (readResult.errorCode == "NOT_FOUND" || readResult.errorCode?.contains("not found", ignoreCase = true) == true) {
                        PlanDocumentReadResult.Absent
                    } else {
                        PlanDocumentReadResult.Unreadable(readResult.errorCode ?: "Read failed")
                    }
                } else if (readResult.isBinary) {
                    PlanDocumentReadResult.Unreadable("Binary document cannot be displayed as Markdown plan")
                } else {
                    val text = readResult.textContent ?: ""
                    val byteSize = readResult.size?.toLong() ?: text.encodeToByteArray().size.toLong()
                    if (byteSize > maxBytes) {
                        PlanDocumentReadResult.Oversize(byteSize)
                    } else {
                        PlanDocumentReadResult.Success(content = text, sizeBytes = byteSize, modifiedAt = readResult.mtime?.toString())
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                PlanDocumentReadResult.Unreadable(e.message ?: "Document read exception")
            }
        } else {
            // Direct REST fallback to /api/fs/read with bounded query
            return try {
                val queryParams = mutableMapOf(
                    "project" to project,
                    "path" to normalized,
                    "offset" to "0",
                    "len" to (maxBytes + 1).toString()
                )
                if (!worktreePath.isNullOrBlank()) {
                    queryParams["worktreePath"] = worktreePath
                }
                val body = apiClient.get("/api/fs/read", queryParams)
                if (body.contains("\"binary\":true") || body.contains("\"binary\": true")) {
                    PlanDocumentReadResult.Unreadable("Binary document rejected")
                } else {
                    val bytes = body.encodeToByteArray()
                    if (bytes.size > maxBytes) {
                        PlanDocumentReadResult.Oversize(bytes.size.toLong())
                    } else {
                        PlanDocumentReadResult.Success(content = body, sizeBytes = bytes.size.toLong())
                    }
                }
            } catch (e: ApiRequestError) {
                if (e.status == 404) {
                    PlanDocumentReadResult.Absent
                } else {
                    PlanDocumentReadResult.Unreadable(e.message ?: "Not found")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                PlanDocumentReadResult.Unreadable(e.message ?: "Document read failed")
            }
        }
    }
}
