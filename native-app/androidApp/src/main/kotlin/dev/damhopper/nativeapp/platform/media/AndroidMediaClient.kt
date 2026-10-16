package dev.damhopper.nativeapp.platform.media

import android.media.MediaDataSource
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.media.IssueImageTicketRequest
import dev.damhopper.nativeapp.features.media.IssueImageTicketResponse
import dev.damhopper.nativeapp.features.media.IssueVideoTicketRequest
import dev.damhopper.nativeapp.features.media.IssueVideoTicketResponse
import dev.damhopper.nativeapp.features.media.MediaException
import dev.damhopper.nativeapp.features.media.MediaKind
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import dev.damhopper.nativeapp.features.media.RevokeMediaSessionRequest
import dev.damhopper.nativeapp.features.media.RevokeTicketRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.io.OutputStream
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Native Android media client responsible for ticketing, cookie-isolated streaming,
 * HEAD content queries, range-based seek reads, and SAF stream downloads.
 * Strictly enforces origin boundaries and rejects any cross-origin redirects.
 */
class AndroidMediaClient(
    val serverBaseUrl: String,
    private val okHttpClient: OkHttpClient = createSecureOkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val expectedUri = URI(serverBaseUrl.trimEnd('/'))

    companion object {
        const val MEDIA_SESSION_COOKIE_PREFIX = "damhopper-media-session-"

        fun mediaSessionCookieName(mediaClientId: String): String = "$MEDIA_SESSION_COOKIE_PREFIX$mediaClientId"

        fun generateMediaClientId(): String = java.util.UUID.randomUUID().toString()

        fun assertValidMediaClientId(mediaClientId: String) {
            try {
                val uuid = java.util.UUID.fromString(mediaClientId)
                require(uuid.version() == 4) { "mediaClientId must be a valid UUIDv4" }
            } catch (e: Exception) {
                throw IllegalArgumentException("Invalid mediaClientId '$mediaClientId': must be a valid UUIDv4", e)
            }
        }

        fun createSecureOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }
    internal fun assertSameOrigin(targetUrl: String) {
        val targetUri = URI(targetUrl)
        if (targetUri.scheme != expectedUri.scheme ||
            targetUri.host != expectedUri.host ||
            targetUri.port != expectedUri.port
        ) {
            throw MediaException("Origin mismatch or cross-origin redirect rejected: $targetUrl (expected $serverBaseUrl)")
        }
    }

    suspend fun issueImageTicket(
        target: ProjectTargetRef,
        path: String,
        mediaClientId: String,
        ownerRef: ConnectionRef,
        bearerToken: String,
    ): MediaLease = withContext(Dispatchers.IO) {
        assertValidMediaClientId(mediaClientId)
        val url = "$serverBaseUrl/api/fs/image/tickets"
        assertSameOrigin(url)

        val reqBodyDto = IssueImageTicketRequest(
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
            mediaClientId = mediaClientId,
        )
        val bodyStr = json.encodeToString(reqBodyDto)
        val request = Request.Builder()
            .url(url)
            .post(bodyStr.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $bearerToken")
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (response.code != 201) {
                throw MediaException("Failed to issue image ticket: HTTP ${response.code} ${response.message}")
            }
            val respBody = response.body?.string() ?: throw MediaException("Empty response body from image ticket endpoint")
            val ticketResp = json.decodeFromString(IssueImageTicketResponse.serializer(), respBody)

            val cookieName = mediaSessionCookieName(mediaClientId)
            val cookieHeader = response.headers("Set-Cookie").firstOrNull { cookie ->
                cookie.contains(cookieName)
            }?.substringBefore(';')

            MediaLease(
                kind = MediaKind.IMAGE,
                ticket = ticketResp.ticket,
                streamPath = ticketResp.streamPath,
                expiresAtEpochMs = ticketResp.expiresAt,
                purpose = MediaPurpose.PREVIEW,
                mediaClientId = mediaClientId,
                cookieHeader = cookieHeader,
                ownerRef = ownerRef,
            )
        }
    }

    suspend fun revokeImageTicket(lease: MediaLease, bearerToken: String): Unit = withContext(Dispatchers.IO) {
        val url = "$serverBaseUrl/api/fs/image/tickets"
        assertSameOrigin(url)

        val reqBody = json.encodeToString(RevokeTicketRequest(ticket = lease.ticket, mediaClientId = lease.mediaClientId))
        val request = Request.Builder()
            .url(url)
            .delete(reqBody.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $bearerToken")
            .build()

        okHttpClient.newCall(request).execute().use { _ -> }
    }

    suspend fun issueVideoTicket(
        target: ProjectTargetRef,
        path: String,
        purpose: MediaPurpose,
        mediaClientId: String,
        ownerRef: ConnectionRef,
        bearerToken: String,
    ): MediaLease = withContext(Dispatchers.IO) {
        assertValidMediaClientId(mediaClientId)
        val url = "$serverBaseUrl/api/fs/video/tickets"
        assertSameOrigin(url)

        val purposeStr = if (purpose == MediaPurpose.DOWNLOAD) "download" else "playback"
        val reqBodyDto = IssueVideoTicketRequest(
            project = target.project,
            worktreePath = target.worktreePath,
            path = path,
            purpose = purposeStr,
            mediaClientId = mediaClientId,
        )
        val bodyStr = json.encodeToString(reqBodyDto)
        val request = Request.Builder()
            .url(url)
            .post(bodyStr.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $bearerToken")
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (response.code != 201) {
                throw MediaException("Failed to issue video ticket: HTTP ${response.code} ${response.message}")
            }
            val respBody = response.body?.string() ?: throw MediaException("Empty response body from video ticket endpoint")
            val ticketResp = json.decodeFromString(IssueVideoTicketResponse.serializer(), respBody)

            val cookieName = mediaSessionCookieName(mediaClientId)
            val cookieHeader = response.headers("Set-Cookie").firstOrNull { cookie ->
                cookie.contains(cookieName)
            }?.substringBefore(';')

            MediaLease(
                kind = MediaKind.VIDEO,
                ticket = ticketResp.ticket,
                streamPath = ticketResp.streamPath,
                expiresAtEpochMs = ticketResp.expiresAt,
                purpose = purpose,
                mediaClientId = mediaClientId,
                cookieHeader = cookieHeader,
                ownerRef = ownerRef,
            )
        }
    }

    suspend fun revokeVideoTicket(lease: MediaLease, bearerToken: String): Unit = withContext(Dispatchers.IO) {
        val url = "$serverBaseUrl/api/fs/video/tickets"
        assertSameOrigin(url)

        val reqBody = json.encodeToString(RevokeTicketRequest(ticket = lease.ticket, mediaClientId = lease.mediaClientId))
        val request = Request.Builder()
            .url(url)
            .delete(reqBody.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $bearerToken")
            .build()

        okHttpClient.newCall(request).execute().use { _ -> }
    }

    suspend fun revokeMediaSession(mediaClientId: String, bearerToken: String): Unit = withContext(Dispatchers.IO) {
        val url = "$serverBaseUrl/api/fs/media-session"
        assertSameOrigin(url)

        val reqBody = json.encodeToString(RevokeMediaSessionRequest(mediaClientId = mediaClientId))
        val request = Request.Builder()
            .url(url)
            .delete(reqBody.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $bearerToken")
            .build()

        okHttpClient.newCall(request).execute().use { _ -> }
    }

    suspend fun fetchImageBytes(lease: MediaLease): ByteArray = withContext(Dispatchers.IO) {
        require(lease.kind == MediaKind.IMAGE) { "Lease is not an image lease" }
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val reqBuilder = Request.Builder().url(url).get()
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        okHttpClient.newCall(reqBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw MediaException("Image fetch failed: HTTP ${response.code} ${response.message}")
            }
            response.body?.bytes() ?: throw MediaException("Empty image body")
        }
    }

    suspend fun fetchMediaHeader(lease: MediaLease): Pair<Long, String?> = withContext(Dispatchers.IO) {
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val reqBuilder = Request.Builder().url(url).head()
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        okHttpClient.newCall(reqBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw MediaException("Media HEAD request failed: HTTP ${response.code} ${response.message}")
            }
            val length = response.header("Content-Length")?.toLongOrNull() ?: -1L
            val type = response.header("Content-Type")
            Pair(length, type)
        }
    }

    fun readRangeSync(lease: MediaLease, start: Long, length: Int): ByteArray {
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val end = start + length - 1
        val reqBuilder = Request.Builder()
            .url(url)
            .get()
            .header("Range", "bytes=$start-$end")

        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        okHttpClient.newCall(reqBuilder.build()).execute().use { response ->
            if (response.code != 206 && response.code != 200) {
                throw MediaException("Range read failed: HTTP ${response.code} ${response.message}")
            }
            val body = response.body ?: return ByteArray(0)
            val input = body.byteStream()
            if (response.code == 200 && start > 0) {
                var skipped = 0L
                while (skipped < start) {
                    val s = input.skip(start - skipped)
                    if (s <= 0) break
                    skipped += s
                }
            }
            val buffer = ByteArray(length)
            var totalRead = 0
            while (totalRead < length) {
                val read = input.read(buffer, totalRead, length - totalRead)
                if (read < 0) break
                totalRead += read
            }
            return if (totalRead == length) buffer else buffer.copyOf(totalRead)
        }
    }

    suspend fun downloadMediaStream(
        lease: MediaLease,
        outputStream: OutputStream,
        onProgress: ((bytesRead: Long, totalBytes: Long) -> Unit)? = null,
    ): Unit = withContext(Dispatchers.IO) {
        require(lease.purpose == MediaPurpose.DOWNLOAD) {
            "Download requires lease with purpose=DOWNLOAD, but got ${lease.purpose}"
        }
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val reqBuilder = Request.Builder().url(url).get()
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        okHttpClient.newCall(reqBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw MediaException("Media download stream failed: HTTP ${response.code} ${response.message}")
            }
            val body = response.body ?: throw MediaException("Empty download body")
            val totalBytes = body.contentLength()
            val input = body.byteStream()
            val buffer = ByteArray(64 * 1024)
            var bytesReadTotal = 0L

            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                outputStream.write(buffer, 0, read)
                bytesReadTotal += read
                onProgress?.invoke(bytesReadTotal, totalBytes)
            }
            outputStream.flush()
        }
    }

    suspend fun createMediaDataSource(lease: MediaLease): MediaDataSource {
        val (totalSize, _) = fetchMediaHeader(lease)
        return LeaseMediaDataSource(this, lease, totalSize)
    }
}

/**
 * Custom MediaDataSource backed by origin-bound, ticketed AndroidMediaClient.
 * Fulfills MediaPlayer seek requests with exact cookie/ticket authorization.
 */
class LeaseMediaDataSource(
    private val client: AndroidMediaClient,
    private val lease: MediaLease,
    private val totalSize: Long,
) : MediaDataSource() {

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (totalSize in 0..position) return -1
        val toRead = if (totalSize > 0) minOf(size.toLong(), totalSize - position).toInt() else size
        if (toRead <= 0) return -1
        return try {
            val bytes = client.readRangeSync(lease, position, toRead)
            if (bytes.isEmpty()) return -1
            val actualCount = minOf(bytes.size, buffer.size - offset)
            bytes.copyInto(buffer, destinationOffset = offset, startIndex = 0, endIndex = actualCount)
            actualCount
        } catch (e: Exception) {
            throw IOException("Failed to read range at position $position: ${e.message}", e)
        }
    }
    override fun getSize(): Long = totalSize

    override fun close() {
        // Ephemeral lease lifecycle managed externally
    }
}
