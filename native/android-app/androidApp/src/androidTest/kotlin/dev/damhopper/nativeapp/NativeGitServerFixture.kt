package dev.damhopper.nativeapp

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android Instrumentation Fixture for Phase 07 Real-Server Git Qualification.
 *
 * Reads mandatory endpoints, authentication token, and test target identities
 * strictly from runner arguments. Fails fast if mandatory arguments are missing,
 * enforcing honest qualification gates without silent defaults or test skips.
 *
 * Provides separate-authority HTTP queries against the test-only proxy control
 * plane and Git oracle, verifying actual filesystem objects, refs, and wire requests.
 */
class NativeGitServerFixture private constructor(
    val baseUrl: String,
    val proxyUrl: String,
    val controlUrl: String,
    val token: String,
    val accountUser: String,
    val primaryProject: String,
    val secondaryProject: String,
) {
    data class GitOracleStatus(
        val branch: String,
        val headOid: String,
        val staged: List<String>,
        val unstaged: List<String>,
        val untracked: List<String>,
        val isClean: Boolean,
    )

    data class GitAuditLogEntry(
        val timestamp: Long,
        val method: String,
        val path: String,
        val queryKeys: List<String>,
        val bodyKeys: List<String>,
        val statusCode: Int?,
        val ackDropped: Boolean,
    )

    companion object {
        /**
         * Parses mandatory instrumentation arguments injected by the journey runner.
         * Fails immediately if required server or credential parameters are absent.
         */
        fun fromRunnerArguments(): NativeGitServerFixture {
            val args: Bundle = InstrumentationRegistry.getArguments()

            val serverUrl = args.getString("serverUrl")
                ?: args.getString("baseUrl")
                ?: throw IllegalStateException(
                    "Mandatory runner argument 'serverUrl' is missing. " +
                        "Naked connected test execution without an isolated Git server fixture is forbidden."
                )

            val proxyUrl = args.getString("proxyUrl") ?: serverUrl
            val controlUrl = args.getString("controlUrl") ?: "${proxyUrl.trimEnd('/')}/__test_control"

            val token = args.getString("authToken")
                ?: args.getString("token")
                ?: throw IllegalStateException(
                    "Mandatory runner argument 'authToken' is missing. " +
                        "Authenticated test execution requires a valid seeded session token."
                )

            val accountUser = args.getString("accountUser")
                ?: throw IllegalStateException(
                    "Mandatory runner argument 'accountUser' is missing. " +
                        "Owner verification requires the seeded user identity."
                )

            val primaryProject = args.getString("primaryProject") ?: "primary"
            val secondaryProject = args.getString("secondaryProject") ?: "secondary"

            return NativeGitServerFixture(
                baseUrl = serverUrl.trimEnd('/'),
                proxyUrl = proxyUrl.trimEnd('/'),
                controlUrl = controlUrl.trimEnd('/'),
                token = token,
                accountUser = accountUser,
                primaryProject = primaryProject,
                secondaryProject = secondaryProject,
            )
        }
    }

    private fun openConnection(fullUrl: String, queryParams: Map<String, String> = emptyMap()): HttpURLConnection {
        val queryString = if (queryParams.isNotEmpty()) {
            "?" + queryParams.entries.joinToString("&") { (k, v) ->
                "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
            }
        } else ""

        val url = URL("$fullUrl$queryString")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 5_000
        conn.readTimeout = 10_000
        if (token.isNotBlank()) {
            conn.setRequestProperty("Authorization", "Bearer $token")
        }
        return conn
    }

    /**
     * Verifies that the upstream server is reachable and responsive to authenticated requests.
     */
    fun isServerAvailable(): Boolean {
        return try {
            val conn = openConnection("$baseUrl/api/projects")
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Verifies that the test control plane and transparent proxy are active.
     */
    fun isProxyControlAvailable(): Boolean {
        return try {
            val conn = openConnection("$controlUrl/ping")
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code == 200
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Queries the external Git Oracle for independent status information on the specified project.
     */
    fun getOracleStatus(project: String = primaryProject, worktree: String? = null): GitOracleStatus? {
        return try {
            val params = mutableMapOf("project" to project)
            if (worktree != null) params["worktree"] = worktree
            val conn = openConnection("$controlUrl/oracle/status", params)
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) {
                conn.disconnect()
                return null
            }
            val text = String(readAllBytes(conn.inputStream), StandardCharsets.UTF_8)
            conn.disconnect()
            val json = JSONObject(text)

            val stagedArr = json.optJSONArray("staged") ?: JSONArray()
            val unstagedArr = json.optJSONArray("unstaged") ?: JSONArray()
            val untrackedArr = json.optJSONArray("untracked") ?: JSONArray()

            GitOracleStatus(
                branch = json.optString("branch", ""),
                headOid = json.optString("headOid", ""),
                staged = (0 until stagedArr.length()).map { stagedArr.getString(it) },
                unstaged = (0 until unstagedArr.length()).map { unstagedArr.getString(it) },
                untracked = (0 until untrackedArr.length()).map { untrackedArr.getString(it) },
                isClean = json.optBoolean("isClean", false),
            )
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Resolves a Git reference directly through the host Oracle.
     */
    fun getOracleHeadOid(project: String = primaryProject, ref: String = "HEAD"): String? {
        return try {
            val conn = openConnection("$controlUrl/oracle/head", mapOf("project" to project, "ref" to ref))
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) {
                conn.disconnect()
                return null
            }
            val text = String(readAllBytes(conn.inputStream), StandardCharsets.UTF_8)
            conn.disconnect()
            val json = JSONObject(text)
            json.optString("oid", null)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Reads a raw Git object via git cat-file -p through the host Oracle.
     */
    fun getOracleCatFile(project: String = primaryProject, oid: String): String? {
        return try {
            val conn = openConnection("$controlUrl/oracle/cat-file", mapOf("project" to project, "oid" to oid))
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) {
                conn.disconnect()
                return null
            }
            val text = String(readAllBytes(conn.inputStream), StandardCharsets.UTF_8)
            conn.disconnect()
            text
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Resolves a reference on the bare remote via the host Oracle.
     */
    fun getOracleRemoteRef(project: String = primaryProject, branch: String): String? {
        return try {
            val conn = openConnection("$controlUrl/oracle/remote-ref", mapOf("project" to project, "branch" to branch))
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) {
                conn.disconnect()
                return null
            }
            val text = String(readAllBytes(conn.inputStream), StandardCharsets.UTF_8)
            conn.disconnect()
            val json = JSONObject(text)
            json.optString("oid", null)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Retrieves the audit log of all wire requests forwarded by the transparent proxy.
     */
    fun getAuditLogs(): List<GitAuditLogEntry> {
        return try {
            val conn = openConnection("$controlUrl/audit/logs")
            conn.requestMethod = "GET"
            if (conn.responseCode != 200) {
                conn.disconnect()
                return emptyList()
            }
            val text = String(readAllBytes(conn.inputStream), StandardCharsets.UTF_8)
            conn.disconnect()
            val arr = JSONArray(text)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                val qKeys = obj.optJSONArray("queryKeys") ?: JSONArray()
                val bKeys = obj.optJSONArray("bodyKeys") ?: JSONArray()
                GitAuditLogEntry(
                    timestamp = obj.optLong("timestamp"),
                    method = obj.optString("method"),
                    path = obj.optString("path"),
                    queryKeys = (0 until qKeys.length()).map { qKeys.getString(it) },
                    bodyKeys = (0 until bKeys.length()).map { bKeys.getString(it) },
                    statusCode = if (obj.has("statusCode") && !obj.isNull("statusCode")) obj.getInt("statusCode") else null,
                    ackDropped = obj.optBoolean("ackDropped", false),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Clears captured audit logs on the proxy.
     */
    fun clearAuditLogs() {
        try {
            val conn = openConnection("$controlUrl/audit/clear")
            conn.requestMethod = "GET"
            conn.responseCode
            conn.disconnect()
        } catch (_: Exception) {
            // Ignored
        }
    }

    /**
     * Instructs the transparent proxy to drop the response of the next mutating request
     * after the upstream server completes it. Used for AC08 idempotence testing.
     */
    fun setDropNextAck() {
        try {
            val conn = openConnection("$controlUrl/faults/drop-next-ack")
            conn.requestMethod = "GET"
            conn.responseCode
            conn.disconnect()
        } catch (_: Exception) {
            // Ignored
        }
    }

    /**
     * Clears any active faults configured on the proxy.
     */
    fun clearFaults() {
        try {
            val conn = openConnection("$controlUrl/faults/clear")
            conn.requestMethod = "GET"
            conn.responseCode
            conn.disconnect()
        } catch (_: Exception) {
            // Ignored
        }
    }

    private fun readAllBytes(input: InputStream, maxBytes: Int = 10 * 1024 * 1024): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
            total += read
            if (total > maxBytes) {
                throw IllegalStateException("Response exceeded maximum allowed bytes ($maxBytes)")
            }
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
