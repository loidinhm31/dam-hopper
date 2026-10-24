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
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * HTTP status carried as the cause of a [MediaException], so callers (e.g. the video surface)
 * can decide on a bounded ticket-expiry retry without parsing messages.
 */
internal class MediaHttpStatus(val code: Int, message: String) : IOException(message)

/** Returns the HTTP status recorded anywhere in this throwable's cause chain, if any. */
internal fun Throwable.mediaHttpStatus(): Int? {
    var current: Throwable? = this
    var depth = 0
    while (current != null && depth < 8) {
        if (current is MediaHttpStatus) return current.code
        current = current.cause
        depth++
    }
    return null
}

/** Statuses that signal an expired/revoked ticket and justify exactly one fresh-ticket retry. */
internal fun isTicketExpiryStatus(code: Int?): Boolean = code == 401 || code == 403 || code == 410

/**
 * Native Android media client responsible for ticketing, cookie-isolated streaming,
 * HEAD content queries, range-based seek reads, and SAF stream downloads.
 * Strictly enforces origin boundaries and rejects any cross-origin redirects.
 *
 * Every lease-bound request is fenced by [activeOwnerSupplier]: the lease's owner must equal the
 * currently active connection both before the request is sent and after the response arrives,
 * and owner-scoped in-flight calls are cancelled on retirement ([retireOwner]).
 */
class AndroidMediaClient(
    val serverBaseUrl: String,
    private val okHttpClient: OkHttpClient = createSecureOkHttpClient(),
    private val activeOwnerSupplier: () -> ConnectionRef? = { null },
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val expectedUri = URI(serverBaseUrl.trimEnd('/'))

    private val activeCallsLock = Any()
    private val activeCalls = HashMap<ConnectionRef, MutableSet<Call>>()
    private val retiredOwners = HashSet<ConnectionRef>()

    companion object {
        const val MEDIA_SESSION_COOKIE_PREFIX = "damhopper-media-session-"

        /** Hard cap for a fully-buffered image body. */
        const val MAX_IMAGE_BYTES: Long = 32L * 1024L * 1024L

        private val CONTENT_RANGE_REGEX = Regex("""^bytes (\d+)-(\d+)/(\d+)$""")
        private val CONTENT_RANGE_UNSATISFIED_REGEX = Regex("""^bytes \*/(\d+)$""")

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

    // ---- Owner-scoped call tracking & retirement -------------------------------------------

    private fun registerCall(ownerRef: ConnectionRef, call: Call) = synchronized(activeCallsLock) {
        if (ownerRef in retiredOwners) {
            throw MediaException("Cannot register call for retired connection ${ownerRef.key}")
        }
        activeCalls.getOrPut(ownerRef) { mutableSetOf() }.add(call)
    }

    private fun unregisterCall(ownerRef: ConnectionRef, call: Call) = synchronized(activeCallsLock) {
        val calls = activeCalls[ownerRef] ?: return@synchronized
        calls.remove(call)
        if (calls.isEmpty()) activeCalls.remove(ownerRef)
    }

    /** Cancels only the in-flight calls belonging to [ownerRef]; other owners are untouched. */
    fun cancelOwnerCalls(ownerRef: ConnectionRef) {
        val callsToCancel = synchronized(activeCallsLock) { activeCalls.remove(ownerRef) }
        callsToCancel?.forEach { runCatching { it.cancel() } }
    }

    /** Permanently retires [ownerRef]: no new calls may start and in-flight calls are cancelled. */
    fun retireOwner(ownerRef: ConnectionRef) {
        synchronized(activeCallsLock) { retiredOwners.add(ownerRef) }
        cancelOwnerCalls(ownerRef)
    }

    internal fun isOwnerRetired(ownerRef: ConnectionRef): Boolean =
        synchronized(activeCallsLock) { ownerRef in retiredOwners }

    internal fun activeCallCount(ownerRef: ConnectionRef): Int =
        synchronized(activeCallsLock) { activeCalls[ownerRef]?.size ?: 0 }

    /** Throws [MediaException] unless [ownerRef] is the active, non-retired connection. */
    internal fun assertOwnerActive(ownerRef: ConnectionRef) {
        if (isOwnerRetired(ownerRef) || ownerRef != activeOwnerSupplier()) {
            throw MediaException("Stale response for retired connection")
        }
    }

    /**
     * Executes [request] fenced by [ownerRef]: owner is verified before sending and again once
     * the response arrives (response dropped on mismatch). The call is tracked for owner-scoped
     * cancellation for its entire lifetime, including body consumption inside [handler].
     */
    private fun <T> executeOwned(ownerRef: ConnectionRef, request: Request, handler: (Response) -> T): T {
        assertOwnerActive(ownerRef)
        val call = okHttpClient.newCall(request)
        registerCall(ownerRef, call)
        try {
            return call.execute().use { response ->
                assertOwnerActive(ownerRef)
                handler(response)
            }
        } catch (e: IOException) {
            if (call.isCanceled()) throw MediaException("Media request cancelled: connection retired", e)
            throw e
        } finally {
            unregisterCall(ownerRef, call)
        }
    }

    // ---- Tickets ---------------------------------------------------------------------------

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

        executeOwned(ownerRef, request) { response ->
            if (response.code != 201) {
                throw MediaException(
                    "Failed to issue image ticket: HTTP ${response.code} ${response.message}",
                    MediaHttpStatus(response.code, "HTTP ${response.code}"),
                )
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

        executeOwned(ownerRef, request) { response ->
            if (response.code != 201) {
                throw MediaException(
                    "Failed to issue video ticket: HTTP ${response.code} ${response.message}",
                    MediaHttpStatus(response.code, "HTTP ${response.code}"),
                )
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

    // ---- Streaming reads -------------------------------------------------------------------

    /**
     * Streams the image body into memory, aborting as soon as more than [maxBytes] have been
     * produced (or the declared Content-Length already exceeds it).
     */
    suspend fun fetchImageBytes(
        lease: MediaLease,
        maxBytes: Long = MAX_IMAGE_BYTES,
    ): ByteArray = withContext(Dispatchers.IO) {
        require(lease.kind == MediaKind.IMAGE) { "Lease is not an image lease" }
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val reqBuilder = Request.Builder().url(url).get()
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        executeOwned(lease.ownerRef, reqBuilder.build()) { response ->
            if (!response.isSuccessful) {
                throw MediaException(
                    "Image fetch failed: HTTP ${response.code} ${response.message}",
                    MediaHttpStatus(response.code, "HTTP ${response.code}"),
                )
            }
            val body = response.body ?: throw MediaException("Empty image body")
            val declared = body.contentLength()
            if (declared > maxBytes) {
                throw MediaException("Image exceeds size limit of $maxBytes bytes (declared $declared)")
            }
            val input = body.byteStream()
            val out = ByteArrayOutputStream(if (declared in 1..maxBytes) declared.toInt() else 64 * 1024)
            val chunk = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val read = input.read(chunk)
                if (read < 0) break
                total += read
                if (total > maxBytes) {
                    throw MediaException("Image exceeds size limit of $maxBytes bytes")
                }
                out.write(chunk, 0, read)
            }
            assertOwnerActive(lease.ownerRef)
            out.toByteArray()
        }
    }

    suspend fun fetchMediaHeader(lease: MediaLease): Pair<Long, String?> = withContext(Dispatchers.IO) {
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val reqBuilder = Request.Builder().url(url).head()
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        executeOwned(lease.ownerRef, reqBuilder.build()) { response ->
            if (!response.isSuccessful) {
                throw MediaException(
                    "Media HEAD request failed: HTTP ${response.code} ${response.message}",
                    MediaHttpStatus(response.code, "HTTP ${response.code}"),
                )
            }
            val length = response.header("Content-Length")?.toLongOrNull() ?: -1L
            val type = response.header("Content-Type")
            Pair(length, type)
        }
    }

    /**
     * Reads `[start, start + length)` with strict RFC 7233 validation. Returns an empty array at EOF
     * (416 with `bytes * / total` where start >= total, or a 206 whose total is <= start).
     *
     * @throws MediaException on non-206 statuses, malformed/mismatched Content-Range, or body length mismatch.
     */
    fun readRangeSync(lease: MediaLease, start: Long, length: Int): ByteArray {
        require(start >= 0) { "start must be non-negative" }
        require(length > 0) { "length must be positive" }
        val url = "$serverBaseUrl${lease.streamPath}"
        assertSameOrigin(url)

        val requestedEnd = start + length - 1
        val reqBuilder = Request.Builder()
            .url(url)
            .get()
            .header("Range", "bytes=$start-$requestedEnd")
        lease.cookieHeader?.let { reqBuilder.header("Cookie", it) }

        return executeOwned(lease.ownerRef, reqBuilder.build()) { response ->
            val contentRange = response.header("Content-Range")?.trim()

            if (response.code == 416) {
                val total = contentRange?.let { CONTENT_RANGE_UNSATISFIED_REGEX.matchEntire(it) }
                    ?.groupValues?.get(1)?.toLongOrNull()
                if (total != null && start >= total) return@executeOwned ByteArray(0)
                throw MediaException(
                    "Range not satisfiable: HTTP 416 for bytes=$start-$requestedEnd (Content-Range=$contentRange)",
                    MediaHttpStatus(416, "HTTP 416"),
                )
            }
            if (response.code != 206) {
                throw MediaException(
                    "Expected HTTP 206, got ${response.code}",
                    MediaHttpStatus(response.code, "HTTP ${response.code}"),
                )
            }

            val match = contentRange?.let { CONTENT_RANGE_REGEX.matchEntire(it) }
                ?: throw MediaException("Missing or malformed Content-Range: $contentRange")
            val returnedStart = match.groupValues[1].toLongOrNull()
            val returnedEnd = match.groupValues[2].toLongOrNull()
            val totalLength = match.groupValues[3].toLongOrNull()
            if (returnedStart == null || returnedEnd == null || totalLength == null) {
                throw MediaException("Malformed Content-Range: $contentRange")
            }
            if (start >= totalLength) return@executeOwned ByteArray(0)
            if (returnedStart != start) {
                throw MediaException("Content-Range start $returnedStart != requested start $start")
            }
            if (returnedEnd < returnedStart || returnedEnd > requestedEnd || returnedEnd >= totalLength) {
                throw MediaException("Content-Range end $returnedEnd outside requested interval $start-$requestedEnd/$totalLength")
            }

            val expected = (returnedEnd - returnedStart + 1).toInt()
            val body = response.body ?: throw MediaException("Empty range body")
            val input = body.byteStream()
            val buffer = ByteArray(expected)
            var totalRead = 0
            while (totalRead < expected) {
                val read = input.read(buffer, totalRead, expected - totalRead)
                if (read < 0) break
                totalRead += read
            }
            if (totalRead != expected || input.read() != -1) {
                throw MediaException("Range body length mismatch: expected $expected bytes for $contentRange")
            }
            assertOwnerActive(lease.ownerRef)
            buffer
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

        executeOwned(lease.ownerRef, reqBuilder.build()) { response ->
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

    suspend fun createMediaDataSource(lease: MediaLease): LeaseMediaDataSource {
        val (totalSize, _) = fetchMediaHeader(lease)
        return LeaseMediaDataSource(this, lease, totalSize)
    }
}

/**
 * Custom MediaDataSource backed by origin-bound, ticketed AndroidMediaClient.
 * Fulfills MediaPlayer seek requests with exact cookie/ticket authorization, serving reads
 * from an aligned, bounded LRU block cache (8 x 256 KiB = 2 MiB) so MediaPlayer's many small
 * reads do not each become an HTTP range request.
 */
class LeaseMediaDataSource(
    private val client: AndroidMediaClient,
    private val lease: MediaLease,
    private val totalSize: Long,
) : MediaDataSource() {

    companion object {
        const val BLOCK_SIZE: Int = 256 * 1024
        const val MAX_CACHED_BLOCKS: Int = 8
    }

    private val cacheLock = Any()
    private val blocks = object : LinkedHashMap<Long, ByteArray>(MAX_CACHED_BLOCKS + 1, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>): Boolean =
            size > MAX_CACHED_BLOCKS
    }

    /** HTTP status of the most recent failed read (for single-shot ticket-expiry recovery). */
    @Volatile
    var lastFailureStatus: Int? = null
        private set

    internal fun cachedBlockCount(): Int = synchronized(cacheLock) { blocks.size }

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (size <= 0) return 0
        if (position < 0 || (totalSize >= 0 && position >= totalSize)) return -1
        try {
            val wanted = if (totalSize >= 0) minOf(size.toLong(), totalSize - position).toInt() else size
            var copied = 0
            while (copied < wanted) {
                val pos = position + copied
                val blockIndex = pos / BLOCK_SIZE
                val block = loadBlock(blockIndex)
                val inBlock = (pos - blockIndex * BLOCK_SIZE).toInt()
                if (inBlock >= block.size) break // EOF inside (or at the end of) this block
                val n = minOf(wanted - copied, block.size - inBlock)
                System.arraycopy(block, inBlock, buffer, offset + copied, n)
                copied += n
            }
            return if (copied == 0) -1 else copied
        } catch (e: Exception) {
            lastFailureStatus = e.mediaHttpStatus()
            synchronized(cacheLock) { blocks.clear() }
            throw IOException("Failed to read range at position $position: ${e.message}", e)
        }
    }

    /** Returns the cached block, or fetches it. Owner is re-verified even on cache hits. */
    private fun loadBlock(blockIndex: Long): ByteArray {
        client.assertOwnerActive(lease.ownerRef)
        synchronized(cacheLock) { blocks[blockIndex] }?.let { return it }

        val blockStart = blockIndex * BLOCK_SIZE
        val len = if (totalSize >= 0) minOf(BLOCK_SIZE.toLong(), totalSize - blockStart).toInt() else BLOCK_SIZE
        val fetched = if (len <= 0) ByteArray(0) else fillBlock(blockStart, len)
        if (fetched.isNotEmpty()) {
            synchronized(cacheLock) { blocks[blockIndex] = fetched }
        }
        return fetched
    }

    /** Reads `len` bytes at `blockStart`, continuing after valid short (partial) 206 responses. */
    private fun fillBlock(blockStart: Long, len: Int): ByteArray {
        val out = ByteArray(len)
        var filled = 0
        while (filled < len) {
            val part = client.readRangeSync(lease, blockStart + filled, len - filled)
            if (part.isEmpty()) break
            System.arraycopy(part, 0, out, filled, part.size)
            filled += part.size
        }
        return if (filled == len) out else out.copyOf(filled)
    }

    override fun getSize(): Long = totalSize

    override fun close() {
        // Ephemeral lease lifecycle managed externally; drop cached bytes.
        synchronized(cacheLock) { blocks.clear() }
    }
}
