package dev.damhopper.nativeapp.platform.media

import androidx.compose.ui.geometry.Offset
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.media.MediaException
import dev.damhopper.nativeapp.features.media.MediaKind
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.*

class AndroidMediaClientTest {

    private val testBaseUrl = "http://127.0.0.1:4801"
    private val ownerA = ConnectionRef("prof-1", 1L)
    private val ownerB = ConnectionRef("prof-1", 2L)
    private val clientId = "11111111-1111-4111-8111-111111111111"

    private fun videoLease(owner: ConnectionRef = ownerA, path: String = "/api/fs/video/stream/vid-1") = MediaLease(
        kind = MediaKind.VIDEO,
        ticket = "vid-ticket",
        streamPath = path,
        expiresAtEpochMs = System.currentTimeMillis() + 60_000,
        purpose = MediaPurpose.PLAYBACK,
        mediaClientId = clientId,
        cookieHeader = "damhopper-media-session-$clientId=cookie-vid",
        ownerRef = owner,
    )

    private fun imageLease(owner: ConnectionRef = ownerA) = MediaLease(
        kind = MediaKind.IMAGE,
        ticket = "img-ticket",
        streamPath = "/api/fs/image/stream/img-ticket",
        expiresAtEpochMs = System.currentTimeMillis() + 60_000,
        purpose = MediaPurpose.PREVIEW,
        mediaClientId = clientId,
        cookieHeader = null,
        ownerRef = owner,
    )

    private fun response(
        chain: Interceptor.Chain,
        code: Int,
        body: ByteArray = ByteArray(0),
        contentRange: String? = null,
    ): Response {
        val builder = Response.Builder()
            .request(chain.request())
            .protocol(Protocol.HTTP_1_1)
            .code(code)
            .message("test")
            .body(body.toResponseBody("video/mp4".toMediaType()))
        if (contentRange != null) builder.header("Content-Range", contentRange)
        return builder.build()
    }

    private fun clientWith(
        interceptor: Interceptor,
        supplier: () -> ConnectionRef? = { ownerA },
    ): AndroidMediaClient = AndroidMediaClient(
        serverBaseUrl = testBaseUrl,
        okHttpClient = OkHttpClient.Builder().addInterceptor(interceptor).build(),
        activeOwnerSupplier = supplier,
    )

    /** Client whose transport is the given handler (active owner = [ownerA]). */
    private fun serve(handler: (Interceptor.Chain) -> Response): AndroidMediaClient =
        clientWith(Interceptor { chain -> handler(chain) })

    /** Standards-compliant range server over [payload]; counts requests in [requests]. */
    private fun rangeServer(payload: ByteArray, requests: AtomicInteger = AtomicInteger()) = Interceptor { chain ->
        requests.incrementAndGet()
        val (s, e) = chain.request().header("Range")!!.removePrefix("bytes=").split("-").map { it.toLong() }
        if (s >= payload.size) {
            response(chain, 416, contentRange = "bytes */${payload.size}")
        } else {
            val last = minOf(e, payload.size - 1L)
            response(
                chain, 206,
                payload.copyOfRange(s.toInt(), last.toInt() + 1),
                "bytes $s-$last/${payload.size}",
            )
        }
    }

    @Test
    fun testOriginMismatchThrows() {
        val client = AndroidMediaClient(serverBaseUrl = testBaseUrl)

        assertFailsWith<MediaException> {
            client.assertSameOrigin("https://127.0.0.1:4801/api/fs/image/stream/ticket-1")
        }
        assertFailsWith<MediaException> {
            client.assertSameOrigin("http://malicious.evil.com:4801/api/fs/image/stream/ticket-1")
        }
        assertFailsWith<MediaException> {
            client.assertSameOrigin("http://127.0.0.1:9999/api/fs/image/stream/ticket-1")
        }
    }

    @Test
    fun testIssueImageTicketAndCookieExtraction() {
        runBlocking {
        val owner = ConnectionRef("prof-1", 1L)
        val mediaClientId = java.util.UUID.randomUUID().toString()

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val req = chain.request()
                assertEquals("POST", req.method)
                assertEquals("Bearer secret-token", req.header("Authorization"))
                assertTrue(req.url.toString().endsWith("/api/fs/image/tickets"))

                val respBody = """{"ticket":"img-ticket-42","streamPath":"/api/fs/image/stream/img-ticket-42","expiresAt":1712600000000,"purpose":"preview","authorizationMode":"session-cookie-v2"}"""
                Response.Builder()
                    .request(req)
                    .protocol(Protocol.HTTP_1_1)
                    .code(201)
                    .message("Created")
                    .header("Set-Cookie", "damhopper-media-session-$mediaClientId=cookie-val-999; Path=/api/fs; HttpOnly")
                    .body(respBody.toResponseBody("application/json".toMediaType()))
                    .build()
            }
            .build()

        val client = AndroidMediaClient(
            serverBaseUrl = testBaseUrl,
            okHttpClient = okHttpClient,
            activeOwnerSupplier = { owner },
        )

        val lease = client.issueImageTicket(
            target = ProjectTargetRef(project = "my-project"),
            path = "assets/logo.png",
            mediaClientId = mediaClientId,
            ownerRef = owner,
            bearerToken = "secret-token"
        )

        assertEquals("img-ticket-42", lease.ticket)
        assertEquals("/api/fs/image/stream/img-ticket-42", lease.streamPath)
        assertEquals(MediaKind.IMAGE, lease.kind)
        assertEquals(MediaPurpose.PREVIEW, lease.purpose)
        assertTrue(lease.cookieHeader?.contains("damhopper-media-session-$mediaClientId=cookie-val-999") == true)
        lease.assertValidOwner(owner)
        }
    }

    @Test
    fun testRangeReadAndMediaDataSourceSeek() {
        val fullPayload = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".encodeToByteArray()
        val interceptor = Interceptor { chain ->
            assertEquals("damhopper-media-session-$clientId=cookie-vid", chain.request().header("Cookie"))
            rangeServer(fullPayload).intercept(chain)
        }
        val client = clientWith(interceptor)
        val lease = videoLease()

        val rangeBytes = client.readRangeSync(lease, 5, 10)
        assertEquals(10, rangeBytes.size)
        assertEquals("56789ABCDE", rangeBytes.decodeToString())

        val dataSource = LeaseMediaDataSource(client, lease, fullPayload.size.toLong())
        val buffer = ByteArray(4)
        val readCount = dataSource.readAt(10, buffer, 0, 4)
        assertEquals(4, readCount)
        assertEquals("ABCD", buffer.decodeToString())
    }

    @Test
    fun testMediaLeaseOwnerFencing() {
        val owner1 = ConnectionRef("prof-a", 1L)
        val owner2 = ConnectionRef("prof-a", 2L)

        val lease = MediaLease(
            kind = MediaKind.IMAGE,
            ticket = "t1",
            streamPath = "/stream",
            expiresAtEpochMs = System.currentTimeMillis() + 100_000,
            purpose = MediaPurpose.PREVIEW,
            mediaClientId = "c1",
            cookieHeader = null,
            ownerRef = owner1
        )

        lease.assertValidOwner(owner1)
        assertFailsWith<IllegalArgumentException> {
            lease.assertValidOwner(owner2)
        }
    }

    @Test
    fun testInvalidMediaClientIdRejected() {
        runBlocking {
        val client = AndroidMediaClient(serverBaseUrl = testBaseUrl)
        assertFailsWith<IllegalArgumentException> {
            client.issueImageTicket(
                target = ProjectTargetRef(project = "proj"),
                path = "img.png",
                mediaClientId = "not-a-valid-uuid",
                ownerRef = ConnectionRef("prof-1", 1L),
                bearerToken = "token"
            )
        }
        }
    }

    // ---- Owner fencing & retirement ----------------------------------------------------------

    @Test
    fun testRetiredOwnerRejectedBeforeRequest() {
        val requests = AtomicInteger()
        val client = clientWith(Interceptor { chain ->
            requests.incrementAndGet()
            rangeServer("abcdef".encodeToByteArray()).intercept(chain)
        })
        client.retireOwner(ownerA)

        assertFailsWith<MediaException> { client.readRangeSync(videoLease(), 0, 4) }
        assertEquals(0, requests.get(), "retired owner must not reach the network")
    }

    @Test
    fun testInactiveOwnerRejectedBeforeRequest() {
        val requests = AtomicInteger()
        val client = clientWith(
            Interceptor { chain -> requests.incrementAndGet(); rangeServer("abcdef".encodeToByteArray()).intercept(chain) },
            supplier = { ownerB },
        )
        assertFailsWith<MediaException> { client.readRangeSync(videoLease(ownerA), 0, 4) }
        assertEquals(0, requests.get())
    }

    @Test
    fun testOwnerRetiredAfterResponseDropsResponse() {
        val active = AtomicReference<ConnectionRef?>(ownerA)
        val payload = "abcdef".encodeToByteArray()
        val client = clientWith(
            Interceptor { chain ->
                val resp = rangeServer(payload).intercept(chain)
                active.set(ownerB) // connection retired while the response was in flight
                resp
            },
            supplier = { active.get() },
        )
        val ex = assertFailsWith<MediaException> { client.readRangeSync(videoLease(ownerA), 0, 4) }
        assertTrue(ex.message!!.contains("Stale response"))
    }

    @Test
    fun testDataSourceCacheHitStillChecksOwner() {
        val active = AtomicReference<ConnectionRef?>(ownerA)
        val requests = AtomicInteger()
        val client = clientWith(rangeServer(ByteArray(1024) { it.toByte() }, requests), supplier = { active.get() })
        val source = LeaseMediaDataSource(client, videoLease(ownerA), 1024)
        val buf = ByteArray(16)
        assertEquals(16, source.readAt(0, buf, 0, 16))
        assertEquals(1, requests.get())

        active.set(ownerB)
        assertFailsWith<IOException> { source.readAt(16, buf, 0, 16) }
        assertEquals(1, requests.get(), "cache hit must not bypass the owner check or hit the network")
        assertEquals(0, source.cachedBlockCount(), "cache cleared after owner mismatch")
    }

    @Test
    fun testCancelOwnerCallsIsOwnerScoped() {
        val active = AtomicReference<ConnectionRef?>(ownerA)
        val startedA = CountDownLatch(1)
        val startedB = CountDownLatch(1)
        val release = CountDownLatch(1)
        val payload = ByteArray(64) { it.toByte() }

        val interceptor = Interceptor { chain ->
            val isA = chain.request().url.encodedPath.endsWith("/a")
            (if (isA) startedA else startedB).countDown()
            release.await(10, TimeUnit.SECONDS)
            if (chain.call().isCanceled()) throw IOException("Canceled")
            rangeServer(payload).intercept(chain)
        }
        val client = clientWith(interceptor, supplier = { active.get() })

        val resultA = AtomicReference<Throwable?>()
        val resultB = AtomicReference<ByteArray?>()
        val errorB = AtomicReference<Throwable?>()
        val tA = Thread { runCatching { client.readRangeSync(videoLease(ownerA, "/stream/a"), 0, 8) }.onFailure { resultA.set(it) } }
        tA.start()
        assertTrue(startedA.await(5, TimeUnit.SECONDS))

        active.set(ownerB) // owner B becomes the active connection and issues its own traffic
        val tB = Thread {
            runCatching { client.readRangeSync(videoLease(ownerB, "/stream/b"), 0, 8) }
                .onSuccess { resultB.set(it) }.onFailure { errorB.set(it) }
        }
        tB.start()
        assertTrue(startedB.await(5, TimeUnit.SECONDS))

        assertEquals(1, client.activeCallCount(ownerA))
        assertEquals(1, client.activeCallCount(ownerB))

        client.cancelOwnerCalls(ownerA)
        assertEquals(0, client.activeCallCount(ownerA))
        assertEquals(1, client.activeCallCount(ownerB), "unrelated owner's call must stay tracked")

        release.countDown()
        tA.join(5_000)
        tB.join(5_000)

        assertTrue(resultA.get() is MediaException, "cancelled owner call fails with MediaException: ${resultA.get()}")
        assertNull(errorB.get(), "unrelated owner's call must not be cancelled: ${errorB.get()}")
        assertEquals(8, resultB.get()?.size)
        assertEquals(0, client.activeCallCount(ownerB))
    }

    // ---- Range validation -------------------------------------------------------------------

    @Test
    fun testRangeRejects200OnRangeRequest() {
        val client = serve { chain -> response(chain, 200, ByteArray(16)) }
        val ex = assertFailsWith<MediaException> { client.readRangeSync(videoLease(), 0, 16) }
        assertTrue(ex.message!!.contains("Expected HTTP 206"))
        assertEquals(200, ex.mediaHttpStatus())
    }

    @Test
    fun testRangeRejectsMissingOrMalformedContentRange() {
        val missing = serve { chain -> response(chain, 206, ByteArray(4)) }
        assertFailsWith<MediaException> { missing.readRangeSync(videoLease(), 0, 4) }

        for (bad in listOf("bytes 0-3/*", "items 0-3/10", "bytes 0-3", "bytes a-b/10", "bytes 0-3/10 extra")) {
            val client = serve { chain -> response(chain, 206, ByteArray(4), bad) }
            assertFailsWith<MediaException>("Content-Range '$bad'") { client.readRangeSync(videoLease(), 0, 4) }
        }
    }

    @Test
    fun testRangeRejectsIntervalMismatch() {
        // returnedStart != requestedStart
        val shifted = serve { chain -> response(chain, 206, ByteArray(4), "bytes 2-5/100") }
        assertFailsWith<MediaException> { shifted.readRangeSync(videoLease(), 0, 4) }

        // returnedEnd beyond requested interval
        val overrun = serve { chain -> response(chain, 206, ByteArray(8), "bytes 0-7/100") }
        assertFailsWith<MediaException> { overrun.readRangeSync(videoLease(), 0, 4) }

        // returnedEnd < returnedStart
        val inverted = serve { chain -> response(chain, 206, ByteArray(0), "bytes 3-1/100") }
        assertFailsWith<MediaException> { inverted.readRangeSync(videoLease(), 3, 4) }
    }

    @Test
    fun testRangeRejectsBodyLengthMismatch() {
        val short = serve { chain -> response(chain, 206, ByteArray(3), "bytes 0-3/100") }
        assertFailsWith<MediaException> { short.readRangeSync(videoLease(), 0, 4) }

        val long = serve { chain -> response(chain, 206, ByteArray(6), "bytes 0-3/100") }
        assertFailsWith<MediaException> { long.readRangeSync(videoLease(), 0, 4) }
    }

    @Test
    fun testRangeAcceptsShorterValidPartialAndDataSourceFillsBlock() {
        // Server legitimately returns at most 100 bytes per response.
        val payload = ByteArray(300) { (it % 251).toByte() }
        val inner = rangeServer(payload)
        val client = serve { chain ->
            val (s, e) = chain.request().header("Range")!!.removePrefix("bytes=").split("-").map { it.toLong() }
            val capped = chain.request().newBuilder().header("Range", "bytes=$s-${minOf(e, s + 99)}").build()
            inner.intercept(object : Interceptor.Chain by chain { override fun request() = capped })
        }
        val source = LeaseMediaDataSource(client, videoLease(), payload.size.toLong())
        val buf = ByteArray(300)
        assertEquals(300, source.readAt(0, buf, 0, 300))
        assertContentEquals(payload, buf)
    }

    @Test
    fun testEofHandlingReturnsMinusOne() {
        val payload = ByteArray(10) { it.toByte() }
        val client = clientWith(rangeServer(payload))
        val lease = videoLease()

        // 416 with `bytes */total` where start >= total is EOF, not an error.
        assertEquals(0, client.readRangeSync(lease, 10, 4).size)

        val known = LeaseMediaDataSource(client, lease, payload.size.toLong())
        val buf = ByteArray(4)
        assertEquals(-1, known.readAt(10, buf, 0, 4))
        assertEquals(-1, known.readAt(50, buf, 0, 4))

        // Unknown size: EOF discovered through the server's 416.
        val unknown = LeaseMediaDataSource(client, lease, -1L)
        assertEquals(-1, unknown.readAt(10, buf, 0, 4))
        // Reads crossing EOF return the available bytes, then -1.
        val tail = ByteArray(16)
        assertEquals(6, unknown.readAt(4, tail, 0, 16))
        assertEquals(-1, unknown.readAt(10, tail, 0, 16))
    }

    @Test
    fun testRangeNon416ErrorsNotTreatedAsEof() {
        val client = serve { chain -> response(chain, 416, contentRange = "bytes */100") }
        // start (0) < total (100): unsatisfiable range is a protocol error, not EOF.
        assertFailsWith<MediaException> { client.readRangeSync(videoLease(), 0, 4) }
    }

    // ---- Block cache ------------------------------------------------------------------------

    @Test
    fun testSmallReadsCollapseIntoOneBlockRequest() {
        val requests = AtomicInteger()
        val payload = ByteArray(LeaseMediaDataSource.BLOCK_SIZE * 2) { (it % 199).toByte() }
        val client = clientWith(rangeServer(payload, requests))
        val source = LeaseMediaDataSource(client, videoLease(), payload.size.toLong())

        val buf = ByteArray(1024)
        repeat(100) { i -> assertEquals(1024, source.readAt(i * 1024L, buf, 0, 1024)) }
        assertEquals(1, requests.get(), "100 small reads in one 256 KiB block = 1 HTTP request")
        assertContentEquals(payload.copyOfRange(99 * 1024, 100 * 1024), buf)
    }

    @Test
    fun testBlockCacheIsBoundedToEightBlocksLru() {
        val blocks = 10
        val requests = AtomicInteger()
        val payload = ByteArray(LeaseMediaDataSource.BLOCK_SIZE * blocks) { (it % 241).toByte() }
        val client = clientWith(rangeServer(payload, requests))
        val source = LeaseMediaDataSource(client, videoLease(), payload.size.toLong())
        val buf = ByteArray(1)

        for (b in 0 until blocks) source.readAt(b.toLong() * LeaseMediaDataSource.BLOCK_SIZE, buf, 0, 1)
        assertEquals(blocks, requests.get())
        assertEquals(LeaseMediaDataSource.MAX_CACHED_BLOCKS, source.cachedBlockCount())
        assertEquals(8 * 256 * 1024, LeaseMediaDataSource.MAX_CACHED_BLOCKS * LeaseMediaDataSource.BLOCK_SIZE)

        // Most recent block still cached; the oldest (block 0) was evicted.
        source.readAt((blocks - 1).toLong() * LeaseMediaDataSource.BLOCK_SIZE, buf, 0, 1)
        assertEquals(blocks, requests.get())
        source.readAt(0, buf, 0, 1)
        assertEquals(blocks + 1, requests.get())
    }

    @Test
    fun testDataSourceRecordsExpiryStatusForRetry() {
        val client = serve { chain -> response(chain, 410) }
        val source = LeaseMediaDataSource(client, videoLease(), 100)
        assertFailsWith<IOException> { source.readAt(0, ByteArray(4), 0, 4) }
        assertEquals(410, source.lastFailureStatus)
        assertTrue(isTicketExpiryStatus(source.lastFailureStatus))
        assertFalse(isTicketExpiryStatus(404))
        assertTrue(isTicketExpiryStatus(401) && isTicketExpiryStatus(403))
    }

    // ---- Image streaming cap ----------------------------------------------------------------

    @Test
    fun testImageFetchAbortsAtThirtyTwoMiB() {
        val produced = AtomicLong()
        val client = serve { chain ->
            val body = object : ResponseBody() {
                override fun contentType() = "image/png".toMediaType()
                override fun contentLength() = -1L
                override fun source(): BufferedSource = object : Source {
                    override fun read(sink: Buffer, byteCount: Long): Long {
                        val n = minOf(byteCount, 8192L)
                        sink.write(ByteArray(n.toInt()))
                        produced.addAndGet(n)
                        return n
                    }
                    override fun timeout() = Timeout.NONE
                    override fun close() {}
                }.buffer()
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body).build()
        }
        assertEquals(32L * 1024 * 1024, AndroidMediaClient.MAX_IMAGE_BYTES)
        assertFailsWith<MediaException> { runBlocking { client.fetchImageBytes(imageLease()) } }
        val cap = AndroidMediaClient.MAX_IMAGE_BYTES
        assertTrue(produced.get() > cap, "must have read past the cap to detect overflow")
        assertTrue(produced.get() <= cap + 256 * 1024, "must abort promptly, produced=${produced.get()}")
    }

    @Test
    fun testImageFetchRejectsDeclaredOversizeAndAcceptsSmall() {
        val tooBig = serve { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .header("Content-Length", (AndroidMediaClient.MAX_IMAGE_BYTES + 1).toString())
                .body(ByteArray(8).toResponseBody("image/png".toMediaType()) .let { small ->
                    object : ResponseBody() {
                        override fun contentType() = small.contentType()
                        override fun contentLength() = AndroidMediaClient.MAX_IMAGE_BYTES + 1
                        override fun source() = small.source()
                    }
                }).build()
        }
        assertFailsWith<MediaException> { runBlocking { tooBig.fetchImageBytes(imageLease()) } }

        val payload = ByteArray(1000) { it.toByte() }
        val ok = serve { chain -> response(chain, 200, payload) }
        assertContentEquals(payload, runBlocking { ok.fetchImageBytes(imageLease()) })
    }

    @Test
    fun testImageFetchDropsResponseForRetiredOwner() {
        val client = clientWith({ chain -> response(chain, 200, ByteArray(8)) }, supplier = { ownerB })
        assertFailsWith<MediaException> { runBlocking { client.fetchImageBytes(imageLease(ownerA)) } }
    }

    // ---- Redaction --------------------------------------------------------------------------

    @Test
    fun testMediaLeaseToStringRedactsTicketPathAndQuery() {
        val lease = imageLease().copy(streamPath = "/api/fs/image/stream/img-ticket?sig=abc123&t=zzz")
        val text = lease.toString()
        assertFalse(text.contains("img-ticket"))
        assertFalse(text.contains("abc123"))
        assertFalse(text.contains("cookie-vid"))
        assertTrue(text.contains("[REDACTED]"))
    }

    // ---- Surface / player arrival order & release -------------------------------------------

    @Test
    fun testBinderPlayerThenSurface() {
        val attached = mutableListOf<Pair<String, Int>>()
        val binder = PlayerSurfaceBinder<String, Int>(attach = { p, s -> attached += p to s }, detach = {})
        binder.onPlayer("player")
        assertTrue(attached.isEmpty(), "no surface yet")
        binder.onSurface(7)
        assertEquals(listOf("player" to 7), attached)
    }

    @Test
    fun testBinderSurfaceThenPlayer() {
        val attached = mutableListOf<Pair<String, Int>>()
        val binder = PlayerSurfaceBinder<String, Int>(attach = { p, s -> attached += p to s }, detach = {})
        binder.onSurface(7)
        assertTrue(attached.isEmpty(), "no player yet")
        binder.onPlayer("player")
        assertEquals(listOf("player" to 7), attached, "player arriving after surface must still get its display")
    }

    @Test
    fun testBinderSurfaceLossDetachesAndRecreatedSurfaceRebinds() {
        val attached = mutableListOf<Pair<String, Int>>()
        val detached = mutableListOf<String>()
        val binder = PlayerSurfaceBinder<String, Int>(attach = { p, s -> attached += p to s }, detach = { detached += it })
        binder.onPlayer("player")
        binder.onSurface(1)
        binder.onSurface(null)
        assertEquals(listOf("player"), detached)
        binder.onSurface(2)
        assertEquals(listOf("player" to 1, "player" to 2), attached)
    }

    @Test
    fun testBinderLateReleaseDoesNotClearNewerPlayer() {
        val attached = mutableListOf<Pair<String, Int>>()
        val binder = PlayerSurfaceBinder<String, Int>(attach = { p, s -> attached += p to s }, detach = {})
        binder.onSurface(1)
        binder.onPlayer("old")
        binder.onPlayer("new")
        binder.onPlayerReleased("old")
        binder.onSurface(2)
        assertEquals("new" to 2, attached.last())
    }

    @Test
    fun testTabDisposalReleasesPlayerSynchronouslyEvenIfRevocationHangs() {
        val events = java.util.Collections.synchronizedList(mutableListOf<String>())
        val revokeStarted = CountDownLatch(1)
        val revokeEnded = CountDownLatch(1)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val cleanup = VideoPlayerCleanup(
                pausePlayer = { events += "pause" },
                releasePlayer = { events += "release" },
                revokeTicket = {
                    revokeStarted.countDown()
                    try {
                        delay(60_000) // network hang
                    } finally {
                        revokeEnded.countDown()
                    }
                },
                cleanupScope = scope,
                revokeTimeoutMs = 100,
            )
            cleanup.dispose()
            // Release is complete the instant dispose() returns, regardless of the revocation.
            assertEquals(listOf("pause", "release"), events.toList())
            assertTrue(revokeStarted.await(5, TimeUnit.SECONDS))
            assertTrue(revokeEnded.await(5, TimeUnit.SECONDS), "revocation must be bounded by its timeout")

            cleanup.dispose() // idempotent
            assertEquals(listOf("pause", "release"), events.toList())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun testReleaseHappensEvenWhenPauseOrRevokeThrow() {
        val released = AtomicBoolean(false)
        val revokeRan = CountDownLatch(1)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            VideoPlayerCleanup(
                pausePlayer = { throw IllegalStateException("player in bad state") },
                releasePlayer = { released.set(true) },
                revokeTicket = { revokeRan.countDown(); throw IOException("network down") },
                cleanupScope = scope,
            ).dispose()
            assertTrue(released.get())
            assertTrue(revokeRan.await(5, TimeUnit.SECONDS))
        } finally {
            scope.cancel()
        }
    }

    // ---- Image viewer geometry --------------------------------------------------------------

    @Test
    fun testImageDecodeBudget() {
        assertFalse(ImageViewerMath.exceedsPixelLimit(7000, 7000)) // 49 MP
        assertTrue(ImageViewerMath.exceedsPixelLimit(8000, 7000)) // 56 MP
        assertTrue(ImageViewerMath.exceedsPixelLimit(100_000, 100_000), "no Int overflow")

        assertEquals(1, ImageViewerMath.inSampleSizeFor(4096, 3000))
        assertEquals(2, ImageViewerMath.inSampleSizeFor(4097, 100))
        assertEquals(2, ImageViewerMath.inSampleSizeFor(8192, 100))
        assertEquals(4, ImageViewerMath.inSampleSizeFor(8193, 6000))
        assertTrue(7000 / ImageViewerMath.inSampleSizeFor(7000, 7000) <= ImageViewerMath.MAX_DECODE_DIMENSION)
    }

    @Test
    fun testPanClampStaysWithinFittedImage() {
        // 1000x500 container, 2000x500 image: fitted 1000x250.
        val noPanAtFit = ImageViewerMath.clampOffset(Offset(300f, 300f), 1f, 1000f, 500f, 2000f, 500f)
        assertEquals(Offset.Zero, noPanAtFit)

        // 2x zoom: fitted 2000x500 -> maxX = (2000-1000)/2 = 500; maxY = max(0, (500-500)/2) = 0.
        val clamped = ImageViewerMath.clampOffset(Offset(900f, -900f), 2f, 1000f, 500f, 2000f, 500f)
        assertEquals(Offset(500f, 0f), clamped)

        // 4x zoom: maxY = (1000-500)/2 = 250.
        val tall = ImageViewerMath.clampOffset(Offset(-5000f, -5000f), 4f, 1000f, 500f, 2000f, 500f)
        assertEquals(Offset(-1500f, -250f), tall)

        assertEquals(1f, ImageViewerMath.clampScale(0.2f))
        assertEquals(ImageViewerMath.MAX_SCALE, ImageViewerMath.clampScale(99f))
    }
}
