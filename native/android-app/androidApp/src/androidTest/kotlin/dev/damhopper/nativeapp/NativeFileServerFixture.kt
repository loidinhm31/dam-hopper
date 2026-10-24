package dev.damhopper.nativeapp

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import org.json.JSONObject

/**
 * Device-side client of a pre-launched server for Phase 08 qualification.
 * Reads endpoint and credentials strictly from instrumentation runner arguments;
 * never launches the server. Provides independent separate-authority REST queries
 * to verify actual server bytes and metadata without using the application's repositories.
 */
class NativeFileServerFixture private constructor(
    val baseUrl: String,
    val token: String?,
    val primaryProject: String,
    val secondaryProject: String,
) {
    data class ServerStatResult(
        val kind: String,
        val size: Long,
        val mtime: Long,
        val mime: String?,
        val isBinary: Boolean,
    )

    data class ServerFileEntry(
        val name: String,
        val kind: String,
        val size: Long,
        val mtime: Long,
        val isSymlink: Boolean,
    )

    companion object {
        private const val DEFAULT_BASE_URL = "http://127.0.0.1:4821"
        private const val DEFAULT_PRIMARY_PROJECT = "dam-hopper"
        private const val DEFAULT_SECONDARY_PROJECT = "eigen-air"

        fun fromRunnerArguments(): NativeFileServerFixture {
            val args: Bundle = InstrumentationRegistry.getArguments()
            val serverUrl = args.getString("serverUrl")
                ?: args.getString("baseUrl")
                ?: DEFAULT_BASE_URL
            val token = args.getString("authToken")
                ?: args.getString("token")
            val primaryProject = args.getString("primaryProject")
                ?: DEFAULT_PRIMARY_PROJECT
            val secondaryProject = args.getString("secondaryProject")
                ?: DEFAULT_SECONDARY_PROJECT

            return NativeFileServerFixture(
                baseUrl = serverUrl.trimEnd('/'),
                token = token,
                primaryProject = primaryProject,
                secondaryProject = secondaryProject,
            )
        }
    }

    private fun openConnection(path: String, queryParams: Map<String, String> = emptyMap()): HttpURLConnection {
        val queryString = if (queryParams.isNotEmpty()) {
            "?" + queryParams.entries.joinToString("&") { (k, v) ->
                "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
            }
        } else ""

        val url = URL("$baseUrl$path$queryString")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 5_000
        conn.readTimeout = 10_000
        if (!token.isNullOrBlank()) {
            conn.setRequestProperty("Authorization", "Bearer $token")
        }
        return conn
    }

    fun isServerAvailable(): Boolean {
        val conn = openConnection("/api/auth/status")
        return try {
            conn.requestMethod = "GET"
            val code = conn.responseCode
            code in 200..401
        } catch (_: Exception) {
            false
        } finally {
            conn.disconnect()
        }
    }

    fun readServerBytes(
        project: String = primaryProject,
        path: String,
        offset: Long? = null,
        len: Long? = null,
    ): ByteArray {
        val params = mutableMapOf("project" to project, "path" to path)
        if (offset != null) params["offset"] = offset.toString()
        if (len != null) params["len"] = len.toString()

        val conn = openConnection("/api/fs/read", params)
        return try {
            conn.requestMethod = "GET"
            val code = conn.responseCode
            if (code != 200) {
                val err = conn.errorStream?.use { readAllBytes(it) }?.let { String(it, StandardCharsets.UTF_8) }
                throw IllegalStateException("Failed to read server bytes: HTTP $code ($err)")
            }
            conn.inputStream.use { readAllBytes(it) }
        } finally {
            conn.disconnect()
        }
    }

    fun statServerPath(
        project: String = primaryProject,
        path: String,
    ): ServerStatResult? {
        val conn = openConnection("/api/fs/stat", mapOf("project" to project, "path" to path))
        return try {
            conn.requestMethod = "GET"
            val code = conn.responseCode
            if (code == 404) {
                return null
            }
            if (code != 200) {
                throw IllegalStateException("Failed to stat server path: HTTP $code")
            }
            val body = conn.inputStream.use { readAllBytes(it) }.let { String(it, StandardCharsets.UTF_8) }
            val json = JSONObject(body)
            ServerStatResult(
                kind = json.optString("kind", "file"),
                size = json.optLong("size", 0L),
                mtime = json.optLong("mtime", 0L),
                mime = if (json.has("mime") && !json.isNull("mime")) json.getString("mime") else null,
                isBinary = json.optBoolean("isBinary", false),
            )
        } finally {
            conn.disconnect()
        }
    }

    fun listServerDirectory(
        project: String = primaryProject,
        path: String = "",
    ): List<ServerFileEntry> {
        val conn = openConnection("/api/fs/list", mapOf("project" to project, "path" to path))
        return try {
            conn.requestMethod = "GET"
            val code = conn.responseCode
            if (code != 200) {
                throw IllegalStateException("Failed to list server directory: HTTP $code")
            }
            val body = conn.inputStream.use { readAllBytes(it) }.let { String(it, StandardCharsets.UTF_8) }
            val json = JSONObject(body)
            val entriesArray = json.optJSONArray("entries") ?: return emptyList()
            val results = ArrayList<ServerFileEntry>(entriesArray.length())
            for (i in 0 until entriesArray.length()) {
                val item = entriesArray.getJSONObject(i)
                results.add(
                    ServerFileEntry(
                        name = item.getString("name"),
                        kind = item.optString("kind", "file"),
                        size = item.optLong("size", 0L),
                        mtime = item.optLong("mtime", 0L),
                        isSymlink = item.optBoolean("isSymlink", false),
                    )
                )
            }
            results
        } finally {
            conn.disconnect()
        }
    }

    private fun readAllBytes(input: InputStream, maxBytes: Int = 10 * 1024 * 1024): ByteArray {
        val buffer = ByteArray(8192)
        val out = ByteArrayOutputStream()
        var total = 0
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
            total += read
            if (total > maxBytes) {
                throw IllegalStateException("Response exceeded maximum allowed size of $maxBytes bytes")
            }
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
