package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SshKeyInfo(
    val name: String,
    val path: String
)

@Serializable
data class SshAgentStatus(
    @SerialName("has_keys")
    val hasKeys: Boolean,
    @SerialName("key_count")
    val keyCount: Int
)

@Serializable
data class LoadKeyBody(
    val keyPath: String? = null,
    val passphrase: String? = null,
    val saveForLater: Boolean = false
) {
    override fun toString(): String =
        "LoadKeyBody(keyPath='$keyPath', passphrase=${if (passphrase != null) "[REDACTED]" else "null"}, saveForLater=$saveForLater)"
}

@Serializable
data class LoadKeyResult(
    val success: Boolean,
    val saved: Boolean,
    val keyPath: String? = null,
    val error: String? = null
)

@Serializable
data class CredentialStatus(
    val saved: Boolean,
    val keyPath: String? = null,
    val error: String? = null
)

@Serializable
data class ForgetCredentialResult(
    val success: Boolean,
    val forgotten: Boolean,
    val error: String? = null
)
