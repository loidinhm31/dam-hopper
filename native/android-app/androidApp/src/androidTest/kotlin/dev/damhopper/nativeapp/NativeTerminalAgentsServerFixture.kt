package dev.damhopper.nativeapp

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import dev.damhopper.nativeapp.features.terminal.TerminalSessionDetailed
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

/**
 * Real two-server fixture for Phase 05 terminal agents qualification journeys.
 * Queries and seeds test-owned terminals on externally launched disposable servers.
 * Never deletes preexisting terminals or unowned incarnations.
 */
class NativeTerminalAgentsServerFixture private constructor(
    val primaryUrl: String,
    val secondaryUrl: String,
    val primaryProject: String,
    val otherProject: String,
    val account: String,
    val primaryToken: String?,
    val secondaryToken: String?,
) {
    data class CreatedTerminal(
        val serverUrl: String,
        val id: String,
        val incarnation: ULong,
        val project: String,
        val worktree: String?,
    )

    private val createdTerminals = mutableListOf<CreatedTerminal>()

    companion object {
        const val DEFAULT_PRIMARY_URL = "http://127.0.0.1:4821"
        const val DEFAULT_SECONDARY_URL = "http://127.0.0.1:4822"
        const val DEFAULT_PRIMARY_PROJECT = "dam-hopper"
        const val DEFAULT_OTHER_PROJECT = "eigen-air"
        const val DEFAULT_ACCOUNT = "dev-user"

        fun fromRunnerArguments(): NativeTerminalAgentsServerFixture {
            val args: Bundle = InstrumentationRegistry.getArguments()
            val primaryUrl = (args.getString("agentsPrimaryUrl") ?: args.getString("serverUrl") ?: DEFAULT_PRIMARY_URL).trimEnd('/')
            val secondaryUrl = (args.getString("agentsSecondaryUrl") ?: DEFAULT_SECONDARY_URL).trimEnd('/')
            val primaryProject = args.getString("agentsPrimaryProject") ?: args.getString("primaryProject") ?: DEFAULT_PRIMARY_PROJECT
            val otherProject = args.getString("agentsOtherProject") ?: args.getString("secondaryProject") ?: DEFAULT_OTHER_PROJECT
            val account = args.getString("agentsAccount") ?: DEFAULT_ACCOUNT
            val primaryToken = args.getString("agentsPrimaryToken") ?: args.getString("token")
            val secondaryToken = args.getString("agentsSecondaryToken")

            return NativeTerminalAgentsServerFixture(
                primaryUrl = primaryUrl,
                secondaryUrl = secondaryUrl,
                primaryProject = primaryProject,
                otherProject = otherProject,
                account = account,
                primaryToken = primaryToken,
                secondaryToken = secondaryToken,
            )
        }
    }

    fun isServerReachable(url: String, token: String?): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = openConnection(url, "/api/auth/status", emptyMap(), token)
            conn.responseCode == 200
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    fun areBothServersReachable(): Boolean =
        isServerReachable(primaryUrl, primaryToken) && isServerReachable(secondaryUrl, secondaryToken)

    fun listDetailed(url: String, token: String?): List<TerminalSessionDetailed> {
        val conn = openConnection(url, "/api/terminal/detailed", emptyMap(), token)
        val text = try {
            if (conn.responseCode != 200) {
                throw IllegalStateException("GET /api/terminal/detailed returned ${conn.responseCode} on $url")
            }
            conn.inputStream.use { readStream(it) }
        } finally {
            conn.disconnect()
        }
        val array = JSONArray(text)
        val list = mutableListOf<TerminalSessionDetailed>()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            list.add(
                TerminalSessionDetailed(
                    id = obj.getString("id"),
                    incarnation = obj.optLong("incarnation", 1L).toULong(),
                    project = obj.optString("project").takeIf { it.isNotBlank() },
                    command = obj.optString("command", "sh"),
                    cwd = obj.optString("cwd", "/"),
                    worktreePath = obj.optString("worktreePath").takeIf { it.isNotBlank() },
                    name = obj.optString("name").takeIf { it.isNotBlank() },
                    sessionType = obj.optString("type", "traditional"),
                    alive = obj.optBoolean("alive", true),
                    exitCode = if (obj.has("exit_code") && !obj.isNull("exit_code")) obj.getInt("exit_code") else null,
                    startedAt = obj.optLong("started_at", 0L).toULong(),
                    restartCount = obj.optInt("restart_count", 0).toUInt(),
                    lastExitAt = if (obj.has("last_exit_at") && !obj.isNull("last_exit_at")) obj.getLong("last_exit_at").toULong() else null,
                    restartPolicy = obj.optString("restart_policy", "never"),
                    targetUnavailable = obj.optBoolean("targetUnavailable", false),
                    bufferBytes = obj.optLong("buffer_bytes", 0L),
                ),
            )
        }
        return list
    }

    fun seedTerminal(
        url: String,
        token: String?,
        id: String,
        project: String,
        worktree: String? = null,
        command: String = "sh",
    ): CreatedTerminal {
        // Preflight: fail if id already exists
        val existing = listDetailed(url, token).firstOrNull { it.id == id }
        check(existing == null) { "Cannot commandeer existing terminal $id on $url" }

        val body = JSONObject().apply {
            put("id", id)
            put("command", command)
            put("project", project)
            if (worktree != null) put("worktreePath", worktree)
        }
        val conn = openConnection(url, "/api/terminal", emptyMap(), token)
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            check(conn.responseCode in 200..204) { "Failed to create terminal $id on $url: ${conn.responseCode}" }
        } finally {
            conn.disconnect()
        }
        // Read back exact created metadata
        val created = listDetailed(url, token).firstOrNull { it.id == id }
            ?: error("Created terminal $id not found in detailed list on $url")
        check(created.project == project) { "Project mismatch: expected $project, got ${created.project}" }
        check(created.worktreePath == worktree) { "Worktree mismatch: expected $worktree, got ${created.worktreePath}" }
        val record = CreatedTerminal(url, created.id, created.incarnation, project, worktree)
        createdTerminals.add(record)
        return record
    }

    fun cleanup(): List<String> {
        val reports = mutableListOf<String>()
        for (item in createdTerminals) {
            var conn: HttpURLConnection? = null
            try {
                val token = if (item.serverUrl == primaryUrl) primaryToken else secondaryToken
                val current = listDetailed(item.serverUrl, token).firstOrNull { it.id == item.id }
                if (current != null && current.incarnation == item.incarnation) {
                    conn = openConnection(item.serverUrl, "/api/terminal/${item.id}", emptyMap(), token)
                    conn.requestMethod = "DELETE"
                    reports.add("Deleted ${item.id} on ${item.serverUrl}: ${conn.responseCode}")
                } else {
                    reports.add("Skipped deletion of ${item.id} on ${item.serverUrl}: incarnation mismatch or gone")
                }
            } catch (e: Exception) {
                reports.add("Failed deletion of ${item.id} on ${item.serverUrl}: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }
        createdTerminals.clear()
        return reports
    }
    private fun openConnection(
        baseUrl: String,
        path: String,
        queryParams: Map<String, String> = emptyMap(),
        token: String?,
    ): HttpURLConnection {
        val queryString = if (queryParams.isNotEmpty()) {
            "?" + queryParams.entries.joinToString("&") { (k, v) ->
                "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
            }
        } else ""

        val url = URL("$baseUrl$path$queryString")
        require(url.userInfo.isNullOrBlank()) { "URLs with userinfo credentials are not allowed" }
        require(url.protocol.equals("http", ignoreCase = true) || url.protocol.equals("https", ignoreCase = true)) {
            "Unsupported protocol: ${url.protocol}"
        }

        val isHttps = url.protocol.equals("https", ignoreCase = true)
        val isLoopback = dev.damhopper.nativeapp.features.profiles.ServerProfile.isLoopbackHost(url.host)
        if (!token.isNullOrBlank()) {
            require(isHttps || isLoopback) {
                "Bearer token cannot be sent over remote cleartext HTTP to ${url.host}"
            }
        }

        val conn = url.openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 5_000
        conn.readTimeout = 10_000
        if (!token.isNullOrBlank()) {
            conn.setRequestProperty("Authorization", "Bearer $token")
        }
        return conn
    }

    private fun readStream(stream: InputStream): String {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(4096)
        var n: Int
        var total = 0
        val maxBytes = 1024 * 1024 // 1 MiB bound
        while (stream.read(buf).also { n = it } > 0) {
            total += n
            check(total <= maxBytes) { "Response body exceeded 1 MiB bound" }
            out.write(buf, 0, n)
        }
        return out.toString(StandardCharsets.UTF_8.name())
    }
}
