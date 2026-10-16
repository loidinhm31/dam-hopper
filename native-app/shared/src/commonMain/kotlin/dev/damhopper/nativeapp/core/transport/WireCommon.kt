@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)

package dev.damhopper.nativeapp.core.transport

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Standard Json configuration for WebSocket protocol2 messages.
 * Matches the server-authoritative ws_protocol.rs envelope:
 * - Discriminator: "kind"
 * - Ignores unknown keys
 * - Encodes defaults
 */
val ProtocolJson: Json = Json {
    ignoreUnknownKeys = true
    classDiscriminator = "kind"
    encodeDefaults = true
    isLenient = false
}

@Serializable
data class TreeNode(
    val path: String,
    val name: String,
    val kind: String, // "file" | "dir"
    val size: ULong,
    val mtime: Long,
    val isSymlink: Boolean = false,
)

@Serializable
data class FsEventDto(
    val kind: String,
    val path: String,
    val from: String? = null,
    val targetRelativePath: String? = null,
    val targetRelativeFrom: String? = null,
)
