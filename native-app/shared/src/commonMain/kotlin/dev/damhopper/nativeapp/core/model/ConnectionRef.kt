package dev.damhopper.nativeapp.core.model

import kotlinx.serialization.Serializable

typealias ProfileId = String

/**
 * Immutable reference identifying a profile's connection epoch.
 *
 * All transport resources, TanStack-style caches, and feature repositories MUST be
 * scoped to this reference. Retiring a connection advances the generation, ensuring
 * that callbacks from older generations cannot mutate live state.
 */
@Serializable
data class ConnectionRef(
    val profileId: ProfileId,
    val generation: Long,
) {
    init {
        require(profileId.isNotBlank()) { "profileId cannot be blank" }
        require(generation >= 0) { "generation must be non-negative: $generation" }
    }

    /**
     * Deterministic tuple key string: ["profileId",generation]
     * Exact parity with TypeScript connectionKey in ownership.ts.
     */
    val key: String get() = connectionKey(this)

    companion object {
        fun connectionKey(ref: ConnectionRef): String =
            """["${ref.profileId}",${ref.generation}]"""

        fun parseKey(key: String): ConnectionRef? {
            val trimmed = key.trim()
            if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null
            val content = trimmed.substring(1, trimmed.length - 1).trim()
            val commaIdx = content.indexOf(',')
            if (commaIdx <= 0) return null
            val rawProfile = content.substring(0, commaIdx).trim()
            val rawGen = content.substring(commaIdx + 1).trim()
            if (!rawProfile.startsWith("\"") || !rawProfile.endsWith("\"") || rawProfile.length < 2) return null
            val profileId = rawProfile.substring(1, rawProfile.length - 1)
            val generation = rawGen.toLongOrNull() ?: return null
            return ConnectionRef(profileId, generation)
        }
    }
}

/**
 * Identifies a concrete WebSocket socket connection attempt within an owning ConnectionRef.
 * This separates connection generation (profile-level lifecycle) from individual socket attempts,
 * ensuring socket-level capabilities (like host:uiConnection receipts) are revoked upon reconnect.
 */
@Serializable
data class SocketInstanceRef(
    val connection: ConnectionRef,
    val socketId: String,
) {
    init {
        require(socketId.isNotBlank()) { "socketId cannot be blank" }
    }

    val key: String get() = """["${connection.profileId}",${connection.generation},"$socketId"]"""
}
