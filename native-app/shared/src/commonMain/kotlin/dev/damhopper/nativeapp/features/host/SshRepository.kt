package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ProtocolJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

class SshRepository(
    val apiClient: ApiClient
) {
    suspend fun listKeys(): Result<List<SshKeyInfo>> = runCatching {
        val responseText = apiClient.get("/api/ssh/keys")
        val keyNames = ProtocolJson.decodeFromString(
            ListSerializer(String.serializer()),
            responseText
        )
        keyNames.map { name ->
            SshKeyInfo(
                name = name,
                path = "~/.ssh/$name"
            )
        }
    }

    suspend fun checkAgent(): Result<SshAgentStatus> = runCatching {
        val responseText = apiClient.get("/api/ssh/agent")
        ProtocolJson.decodeFromString(SshAgentStatus.serializer(), responseText)
    }

    suspend fun loadKey(
        keyPath: String? = null,
        passphrase: String? = null,
        saveForLater: Boolean = false
    ): Result<LoadKeyResult> = runCatching {
        val body = ProtocolJson.encodeToString(
            LoadKeyBody.serializer(),
            LoadKeyBody(keyPath = keyPath, passphrase = passphrase, saveForLater = saveForLater)
        )
        val responseText = apiClient.postJson("/api/ssh/keys/load", body)
        ProtocolJson.decodeFromString(LoadKeyResult.serializer(), responseText)
    }

    suspend fun getCredentialStatus(keyPath: String? = null): Result<CredentialStatus> = runCatching {
        val queryParams = if (keyPath != null) mapOf("keyPath" to keyPath) else emptyMap()
        val responseText = apiClient.get("/api/ssh/credentials", queryParams)
        ProtocolJson.decodeFromString(CredentialStatus.serializer(), responseText)
    }

    suspend fun forgetCredential(keyPath: String? = null): Result<ForgetCredentialResult> = runCatching {
        val queryParams = if (keyPath != null) mapOf("keyPath" to keyPath) else emptyMap()
        val responseText = apiClient.delete("/api/ssh/credentials", queryParams)
        ProtocolJson.decodeFromString(ForgetCredentialResult.serializer(), responseText)
    }
}
