package dev.damhopper.nativeapp.platform.media

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.media.MediaException
import dev.damhopper.nativeapp.features.media.MediaKind
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlin.test.*

class AndroidMediaClientTest {

    private val testBaseUrl = "http://127.0.0.1:4801"

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

        val client = AndroidMediaClient(serverBaseUrl = testBaseUrl, okHttpClient = okHttpClient)

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
        val owner = ConnectionRef("prof-1", 1L)
        val lease = MediaLease(
            kind = MediaKind.VIDEO,
            ticket = "vid-seek-1",
            streamPath = "/api/fs/video/stream/vid-seek-1",
            expiresAtEpochMs = System.currentTimeMillis() + 60_000,
            purpose = MediaPurpose.PLAYBACK,
            mediaClientId = "11111111-1111-4111-8111-111111111111",
            cookieHeader = "damhopper-media-session-11111111-1111-4111-8111-111111111111=cookie-vid",
            ownerRef = owner
        )

        val fullPayload = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".encodeToByteArray()

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val req = chain.request()
                assertEquals("damhopper-media-session-11111111-1111-4111-8111-111111111111=cookie-vid", req.header("Cookie"))

                val rangeHeader = req.header("Range")
                if (rangeHeader != null) {
                    val rangeParts = rangeHeader.removePrefix("bytes=").split("-")
                    val start = rangeParts[0].toInt()
                    val end = rangeParts[1].toInt()
                    val slice = fullPayload.copyOfRange(start, minOf(end + 1, fullPayload.size))
                    Response.Builder()
                        .request(req)
                        .protocol(Protocol.HTTP_1_1)
                        .code(206)
                        .message("Partial Content")
                        .body(slice.toResponseBody("video/mp4".toMediaType()))
                        .build()
                } else {
                    Response.Builder()
                        .request(req)
                        .protocol(Protocol.HTTP_1_1)
                        .code(200)
                        .message("OK")
                        .body(fullPayload.toResponseBody("video/mp4".toMediaType()))
                        .build()
                }
            }
            .build()

        val client = AndroidMediaClient(serverBaseUrl = testBaseUrl, okHttpClient = okHttpClient)

        // Test readRangeSync directly
        val rangeBytes = client.readRangeSync(lease, 5, 10)
        assertEquals(10, rangeBytes.size)
        assertEquals("56789ABCDE", rangeBytes.decodeToString())

        // Test LeaseMediaDataSource seek
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
}
