package dev.damhopper.nativeapp.features.files

import com.sun.net.httpserver.HttpServer
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.core.model.SocketInstanceRef
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.core.transport.ClientMsg
import dev.damhopper.nativeapp.core.transport.FsEventDto
import dev.damhopper.nativeapp.core.transport.ServerMsg
import dev.damhopper.nativeapp.core.transport.SocketBoundMessage
import dev.damhopper.nativeapp.core.transport.WsConnection
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FileWatchCoordinatorTest {

    private var server: HttpServer? = null
    private var serverExecutor: java.util.concurrent.ExecutorService? = null
    private var serverPort: Int = 0
    private lateinit var testScope: CoroutineScope

    @BeforeTest
    fun setUp() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverExecutor = java.util.concurrent.Executors.newCachedThreadPool()
        server!!.executor = serverExecutor
        serverPort = server!!.address.port
        server!!.start()
        testScope = CoroutineScope(Dispatchers.Unconfined + SupervisorJob())
    }

    @AfterTest
    fun tearDown() {
        testScope.cancel()
        server?.stop(0)
        serverExecutor?.shutdownNow()
    }
    private class ControllableWsConnection(
        connection: ConnectionRef,
        baseUrl: String,
    ) : WsConnection(connection, baseUrl, { "test-token" }) {
        @Volatile
        var currentSocket: SocketInstanceRef? = SocketInstanceRef(connection, "sock-1")

        private val _boundFlow = MutableSharedFlow<SocketBoundMessage>(extraBufferCapacity = 256)
        override val socketBoundMessages: SharedFlow<SocketBoundMessage> = _boundFlow.asSharedFlow()

        val sentOnSocket = CopyOnWriteArrayList<Pair<SocketInstanceRef, ClientMsg>>()
        val requestHandlers = ConcurrentHashMap<ULong, suspend (SocketInstanceRef, ClientMsg) -> ServerMsg>()
        var defaultRequestHandler: (suspend (SocketInstanceRef, ULong, ClientMsg) -> ServerMsg)? = null

        override fun activeSocketRef(): SocketInstanceRef? = currentSocket

        suspend fun emitSocketBound(socketRef: SocketInstanceRef, msg: ServerMsg) {
            _boundFlow.emit(SocketBoundMessage(socketRef, msg))
        }

        override suspend fun sendOnSocket(expectedSocketRef: SocketInstanceRef, msg: ClientMsg) {
            if (currentSocket != expectedSocketRef) {
                throw dev.damhopper.nativeapp.core.model.ConnectionOwnerError(
                    "Socket mismatch",
                    dev.damhopper.nativeapp.core.model.ConnectionErrorReason.STALE,
                )
            }
            sentOnSocket.add(expectedSocketRef to msg)
        }

        override suspend fun requestOnSocket(
            expectedSocketRef: SocketInstanceRef,
            reqId: ULong,
            msg: ClientMsg,
            timeoutMillis: Long,
        ): ServerMsg {
            if (currentSocket != expectedSocketRef) {
                throw dev.damhopper.nativeapp.core.model.ConnectionOwnerError(
                    "Socket mismatch",
                    dev.damhopper.nativeapp.core.model.ConnectionErrorReason.STALE,
                )
            }
            val specific = requestHandlers[reqId]
            if (specific != null) {
                return specific(expectedSocketRef, msg)
            }
            val handler = defaultRequestHandler
                ?: error("No request handler configured for reqId=$reqId msg=$msg")
            return handler(expectedSocketRef, reqId, msg)
        }
    }

    private fun createFixture(
        project: String = "demo",
        worktreePath: String? = null,
    ): Triple<WorkspaceFileOwner, ControllableWsConnection, FileRepository> {
        val conn = ConnectionRef("profile-1", 1L)
        val baseUrl = "http://127.0.0.1:$serverPort"
        val owner = WorkspaceFileOwner(
            profileId = "profile-1",
            baseUrl = baseUrl,
            accountUser = "alice",
            project = project,
            worktreePath = worktreePath,
        )
        val client = ApiClient(conn, baseUrl, { "test-token" })
        val ws = ControllableWsConnection(conn, baseUrl)
        val repo = FileRepository(owner, client, ws, testScope)
        return Triple(owner, ws, repo)
    }

    @Test
    fun testSharedDemandReferenceCountingBetweenExplorerAndOpenDocuments() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val subCounter = AtomicLong(10L)
        val subscribePaths = CopyOnWriteArrayList<String>()

        ws.defaultRequestHandler = { _, reqId, msg ->
            val sub = assertIs<ClientMsg.FsSubscribeTree>(msg)
            subscribePaths.add(sub.path)
            ServerMsg.TreeSnapshot(reqId = reqId, subId = subCounter.getAndIncrement().toULong())
        }

        val coordinator = FileWatchCoordinator(owner, target, repo, testScope)

        // Explorer demands root "" and "src"
        coordinator.acquireExplorerDemand("")
        coordinator.acquireExplorerDemand("src")
        // Two open documents also demand parent "src"
        coordinator.acquireDocumentParentDemand("src/A.kt", "doc-1")
        coordinator.acquireDocumentParentDemand("src/B.kt", "doc-2")

        // Exactly one subscription for "" and one for "src"
        assertEquals(2, coordinator.getActiveSubscriptionCount())
        assertEquals(listOf("", "src"), subscribePaths.toList())
        assertEquals(3, coordinator.getDemand("src")?.consumers?.size)

        // Collapse "src" in explorer: releases only explorer reference; open docs keep "src" subscribed
        coordinator.releaseExplorerDemand("src")
        assertEquals(2, coordinator.getActiveSubscriptionCount())
        assertEquals(2, coordinator.getDemand("src")?.consumers?.size)
        assertTrue(ws.sentOnSocket.none { it.second is ClientMsg.FsUnsubscribeTree })

        // Close first document: still 1 consumer left on "src"
        coordinator.releaseDocumentParentDemand("src/A.kt", "doc-1")
        assertEquals(2, coordinator.getActiveSubscriptionCount())

        // Close second document: final consumer on "src" released -> unsubscribes "src" on origin socket
        coordinator.releaseDocumentParentDemand("src/B.kt", "doc-2")
        assertEquals(1, coordinator.getActiveSubscriptionCount())
        assertNull(coordinator.getDemand("src"))
        val unsub = ws.sentOnSocket.map { it.second }.filterIsInstance<ClientMsg.FsUnsubscribeTree>()
        assertEquals(1, unsub.size)
        assertEquals(11uL, unsub.single().subId)

        coordinator.dispose()
    }

    @Test
    fun testFinalDemandReleaseDuringInFlightSubscribeImmediatelyCleansUp() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val subscribeStarted = CompletableDeferred<Unit>()
        val releaseSnapshot = CompletableDeferred<ServerMsg.TreeSnapshot>()

        ws.defaultRequestHandler = { _, reqId, _ ->
            subscribeStarted.complete(Unit)
            val snap = releaseSnapshot.await()
            snap.copy(reqId = reqId)
        }

        val coordinator = FileWatchCoordinator(owner, target, repo, testScope)

        val subscribeJob = testScope.launch {
            coordinator.acquireExplorerDemand("src/nested")
        }
        subscribeStarted.await()

        // Release final demand while subscribe request is still awaiting snapshot
        coordinator.releaseExplorerDemand("src/nested")
        releaseSnapshot.complete(ServerMsg.TreeSnapshot(reqId = 1uL, subId = 77uL))
        subscribeJob.join()

        // Subscription must NOT be retained and must be unsubscribed on originSocket
        assertEquals(0, coordinator.getActiveSubscriptionCount())
        val unsubs = ws.sentOnSocket.map { it.second }.filterIsInstance<ClientMsg.FsUnsubscribeTree>()
        assertEquals(1, unsubs.size)
        assertEquals(77uL, unsubs.single().subId)

        coordinator.dispose()
    }

    @Test
    fun testDelayedListingCannotOverwriteNewerListingAndInFlightEventIsReplayed() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val sock1 = ws.currentSocket!!

        ws.defaultRequestHandler = { _, reqId, _ ->
            ServerMsg.TreeSnapshot(reqId = reqId, subId = 50uL)
        }

        val listCallCount = AtomicInteger(0)
        val firstListGate = CompletableDeferred<Unit>()
        val firstListEntered = CompletableDeferred<Unit>()

        server!!.createContext("/api/fs/list") { exchange ->
            val call = listCallCount.incrementAndGet()
            val body = if (call == 1) {
                firstListEntered.complete(Unit)
                 kotlinx.coroutines.runBlocking { firstListGate.await() }
                """{"entries":[{"name":"stale.kt","kind":"file","size":10,"mtime":1,"isSymlink":false},{"name":"deleted.kt","kind":"file","size":10,"mtime":1,"isSymlink":false}]}"""
            } else {
                """{"entries":[{"name":"fresh.kt","kind":"file","size":20,"mtime":2,"isSymlink":false},{"name":"deleted.kt","kind":"file","size":10,"mtime":1,"isSymlink":false}]}"""
            }
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val coordinator = FileWatchCoordinator(owner, target, repo, testScope)
        coordinator.acquireExplorerDemand("src")

        // Launch slow List #1 on a background thread so we can interleave List #2
        val slowResultDeferred = CompletableDeferred<OrderedDirectoryListingResult>()
        val bgScope = CoroutineScope(Dispatchers.Default)
        bgScope.launch {
            slowResultDeferred.complete(coordinator.fetchDirectoryOrdered("src"))
        }
        firstListEntered.await()

        // Run fast List #2 while List #1 is still blocked
        val secondResult = coordinator.fetchDirectoryOrdered("src")
        val published2 = assertIs<OrderedDirectoryListingResult.Published>(secondResult)
        assertEquals(listOf("fresh.kt", "deleted.kt"), published2.entries.map { it.name })

        // Unblock slow List #1: it must be rejected as Superseded
        firstListGate.complete(Unit)
        val firstResult = slowResultDeferred.await()
        assertIs<OrderedDirectoryListingResult.Superseded>(firstResult)

        // Now test buffered event replay during a single in-flight listing
        val thirdListEntered = CompletableDeferred<Unit>()
        val thirdListGate = CompletableDeferred<Unit>()
        server!!.removeContext("/api/fs/list")
        server!!.createContext("/api/fs/list") { exchange ->
            thirdListEntered.complete(Unit)
            kotlinx.coroutines.runBlocking { thirdListGate.await() }
            val body = """{"entries":[{"name":"keep.kt","kind":"file","size":10,"mtime":1,"isSymlink":false},{"name":"remove_me.kt","kind":"file","size":10,"mtime":1,"isSymlink":false}]}"""
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val thirdDeferred = CompletableDeferred<OrderedDirectoryListingResult>()
        bgScope.launch {
            thirdDeferred.complete(coordinator.fetchDirectoryOrdered("src"))
        }
        thirdListEntered.await()

        // Emit a delete event for "src/remove_me.kt" while list #3 is in flight
        ws.emitSocketBound(
            sock1,
            ServerMsg.FsEventMsg(
                subId = 50uL,
                event = FsEventDto(
                    kind = "delete",
                    path = "/abs/project/src/remove_me.kt",
                    targetRelativePath = "src/remove_me.kt",
                ),
            ),
        )

        thirdListGate.complete(Unit)
        val thirdResult = thirdDeferred.await()
        val published3 = assertIs<OrderedDirectoryListingResult.Published>(thirdResult)
        assertEquals(listOf("keep.kt"), published3.entries.map { it.name })
        assertEquals(1, published3.replayedEventCount)

        bgScope.cancel()
        coordinator.dispose()
    }

    @Test
    fun testEarlyEventBeforeSnapshotAndReusedSubIdAcrossSockets() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val sock1 = SocketInstanceRef(ws.connection, "sock-1")
        val sock2 = SocketInstanceRef(ws.connection, "sock-2")
        ws.currentSocket = sock1

        val snapshotGate = CompletableDeferred<Unit>()
        val subscribeEntered = CompletableDeferred<Unit>()

        ws.defaultRequestHandler = { socket, reqId, _ ->
            if (socket == sock1) {
                subscribeEntered.complete(Unit)
                snapshotGate.await()
                // Both sock1 and sock2 will use subId = 99uL to test subId reuse fencing
                ServerMsg.TreeSnapshot(reqId = reqId, subId = 99uL)
            } else {
                ServerMsg.TreeSnapshot(reqId = reqId, subId = 99uL)
            }
        }

        val receivedEvents = CopyOnWriteArrayList<QualifiedWatchEvent>()
        val manager = TreeSubscriptionManager(ws, testScope, owner) { ws.nextReqId() }

        val sub1Deferred = CompletableDeferred<FileTreeSubscription>()
        testScope.launch {
            val sub = manager.subscribeQualified(
                target = target,
                path = "src",
                onQualifiedEvent = { receivedEvents.add(it) },
                onOverflow = {},
            )
            sub1Deferred.complete(sub)
        }
        subscribeEntered.await()

        // Emit early event on sock1 BEFORE snapshot arrives
        ws.emitSocketBound(
            sock1,
            ServerMsg.FsEventMsg(
                subId = 99uL,
                event = FsEventDto(
                    kind = "create",
                    path = "/abs/src/early.kt",
                    targetRelativePath = "src/early.kt",
                ),
            ),
        )
        // Emit event with same subId=99uL on sock2 -> must be ignored by sock1 subscription
        ws.emitSocketBound(
            sock2,
            ServerMsg.FsEventMsg(
                subId = 99uL,
                event = FsEventDto(
                    kind = "create",
                    path = "/abs/src/wrong_socket.kt",
                    targetRelativePath = "src/wrong_socket.kt",
                ),
            ),
        )

        snapshotGate.complete(Unit)
        val sub1 = sub1Deferred.await()

        assertEquals(1, receivedEvents.size)
        assertEquals("src/early.kt", receivedEvents.single().targetRelativePath)
        assertEquals(sock1, receivedEvents.single().originSocket)

        // Now switch active socket to sock2 and subscribe with reused subId = 99uL
        ws.currentSocket = sock2
        val sub2Events = CopyOnWriteArrayList<QualifiedWatchEvent>()
        val sub2 = manager.subscribeQualified(
            target = target,
            path = "src",
            onQualifiedEvent = { sub2Events.add(it) },
            onOverflow = {},
        )
        assertTrue(sub2.subscribeIncarnation > sub1.subscribeIncarnation)

        // Cancel old sub1: must NOT send FsUnsubscribeTree on sock2!
        sub1.cancel()
        assertTrue(ws.sentOnSocket.none { it.first == sock2 && it.second is ClientMsg.FsUnsubscribeTree })

        // Emit event on sock2 for subId=99uL -> sub2 still receives it!
        ws.emitSocketBound(
            sock2,
            ServerMsg.FsEventMsg(
                subId = 99uL,
                event = FsEventDto(
                    kind = "modify",
                    path = "/abs/src/live_on_sock2.kt",
                    targetRelativePath = "src/live_on_sock2.kt",
                ),
            ),
        )
        assertEquals(1, sub2Events.size)
        assertEquals("src/live_on_sock2.kt", sub2Events.single().targetRelativePath)

        sub2.cancel()
        manager.dispose()
    }

    @Test
    fun testEarlyBufferOverflowAndServerOverflowRecreateSubscriptionBeforeRefetch() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val sock1 = ws.currentSocket!!

        val subIdSeq = AtomicLong(200L)
        val actionLog = CopyOnWriteArrayList<String>()
        val firstSnapshotGate = CompletableDeferred<Unit>()
        val firstSubscribeEntered = CompletableDeferred<Unit>()

        ws.defaultRequestHandler = { _, reqId, _ ->
            val subId = subIdSeq.getAndIncrement().toULong()
            actionLog.add("subscribe:$subId")
            if (subId == 200uL) {
                firstSubscribeEntered.complete(Unit)
                firstSnapshotGate.await()
            }
            ServerMsg.TreeSnapshot(reqId = reqId, subId = subId)
        }

        val coordinator = FileWatchCoordinator(
            owner = owner,
            target = target,
            repository = repo,
            coroutineScope = testScope,
            onRefetchExplorerDirectory = { dir ->
                actionLog.add("refetch:$dir")
                true
            },
            onReconcileOpenDocumentParents = { dirs, _ ->
                actionLog.add("reconcileDocs:${dirs.joinToString(",")}")
                true
            },
        )

        val acquireJob = testScope.launch {
            coordinator.acquireExplorerDemand("src")
            coordinator.acquireDocumentParentDemand("src/Open.kt", "doc-1")
        }
        firstSubscribeEntered.await()

        // Overflow the bounded early event queue (> 128 events) before snapshot completes
        repeat(WatchQueueLimits.MAX_EARLY_EVENT_COUNT + 10) { idx ->
            ws.emitSocketBound(
                sock1,
                ServerMsg.FsEventMsg(
                    subId = 200uL,
                    event = FsEventDto(
                        kind = "modify",
                        path = "/abs/src/f$idx.kt",
                        targetRelativePath = "src/f$idx.kt",
                    ),
                ),
            )
        }

        firstSnapshotGate.complete(Unit)
        acquireJob.join()

        // Verify overflow retired subId=200, recreated subId=201 FIRST, and then refetched "src" and open docs
        assertEquals(
            listOf("subscribe:200", "subscribe:201", "refetch:src", "reconcileDocs:src"),
            actionLog.toList(),
        )
        assertEquals("201", coordinator.activeSubscriptions.value["src"]?.subId)

        coordinator.dispose()
    }

    @Test
    fun testMissingRelativeRoutingNeverUsesRawAbsolutePathAndRefetchesWatchedDir() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val sock1 = ws.currentSocket!!

        ws.defaultRequestHandler = { _, reqId, _ ->
            ServerMsg.TreeSnapshot(reqId = reqId, subId = 301uL)
        }

        val refetchedDirs = CopyOnWriteArrayList<String>()
        val coordinator = FileWatchCoordinator(
            owner = owner,
            target = target,
            repository = repo,
            coroutineScope = testScope,
            onRefetchExplorerDirectory = { dir ->
                refetchedDirs.add(dir)
                true
            },
        )

        coordinator.acquireExplorerDemand("src")
        val subState = coordinator.activeSubscriptions.value["src"]!!

        // Event with null targetRelativePath and raw absolute path "/ server/secret/path/file.kt"
        val rawEvent = QualifiedWatchEvent.fromRaw(
            owner = owner,
            target = target,
            watchedDirectoryPath = "src",
            originSocket = sock1,
            subId = 301uL,
            requestId = 1uL,
            subscribeIncarnation = subState.subscribeIncarnation,
            sequenceNumber = 1L,
            event = FsEventDto(
                kind = "modify",
                path = "/server/secret/path/file.kt",
                targetRelativePath = null,
            ),
        )
        assertTrue(rawEvent.hasMissingRelativeRouting)
        assertNull(rawEvent.targetRelativePath)

        coordinator.handleQualifiedEvent(rawEvent)

        // Must refetch demanded "src", never "/server/secret/path"
        assertEquals(listOf("src"), refetchedDirs.toList())

        coordinator.dispose()
    }

    @Test
    fun testBackgroundPauseAndForegroundReconciliationGateWriteReadiness() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val subCounter = AtomicLong(400L)

        ws.defaultRequestHandler = { _, reqId, _ ->
            ServerMsg.TreeSnapshot(reqId = reqId, subId = subCounter.getAndIncrement().toULong())
        }

        var docReconcileShouldSucceed = false
        val coordinator = FileWatchCoordinator(
            owner = owner,
            target = target,
            repository = repo,
            coroutineScope = testScope,
            onRefetchExplorerDirectory = { true },
            onReconcileOpenDocumentParents = { _, _ -> docReconcileShouldSucceed },
        )

        coordinator.acquireExplorerDemand("")
        coordinator.acquireDocumentParentDemand("src/App.kt", "doc-1")

        // Initial reconcile fails because docReconcileShouldSucceed == false -> writes stay disabled
        assertFalse(coordinator.reconcileAllDemands())
        assertFalse(coordinator.isWriteReady.value)

        // Now doc reconciliation succeeds -> writes enabled
        docReconcileShouldSucceed = true
        assertTrue(coordinator.reconcileAllDemands())
        assertTrue(coordinator.isWriteReady.value)
        assertEquals(2, coordinator.getActiveSubscriptionCount())

        // Background pause disables writes and unsubscribes active handles while keeping demands
        coordinator.pause()
        assertFalse(coordinator.isWriteReady.value)
        assertEquals(0, coordinator.getActiveSubscriptionCount())
        assertNotNull(coordinator.getDemand(""))
        assertNotNull(coordinator.getDemand("src"))

        // Foreground resume recreates subscriptions and reconciles before enabling writes
        assertTrue(coordinator.resume())
        assertTrue(coordinator.isWriteReady.value)
        assertEquals(2, coordinator.getActiveSubscriptionCount())

        coordinator.dispose()
    }

    @Test
    fun testEventDeliveredBeforeEnsureSubscribedCompletesIsBufferedAndReplayed() = runTest {
        val (owner, ws, repo) = createFixture()
        val target = owner.toProjectTargetRef()
        val sock1 = ws.currentSocket!!

        val snapshotGate = CompletableDeferred<Unit>()
        val subscribeStarted = CompletableDeferred<Unit>()

        ws.defaultRequestHandler = { _, reqId, _ ->
            subscribeStarted.complete(Unit)
            snapshotGate.await()
            ServerMsg.TreeSnapshot(reqId = reqId, subId = 555uL)
        }

        val coordinator = FileWatchCoordinator(
            owner = owner,
            target = target,
            repository = repo,
            coroutineScope = testScope,
            onRefetchExplorerDirectory = { true },
        )

        val acquireJob = testScope.launch {
            coordinator.acquireExplorerDemand("src")
        }
        subscribeStarted.await()

        // Before snapshot completes and before handle is installed, emit event on sock1
        ws.emitSocketBound(
            sock1,
            ServerMsg.FsEventMsg(
                subId = 555uL,
                event = FsEventDto(
                    kind = "modify",
                    path = "/abs/src/PreInstall.kt",
                    targetRelativePath = "src/PreInstall.kt",
                ),
            ),
        )

        snapshotGate.complete(Unit)
        acquireJob.join()

        // The handle was installed and the pending event was drained into history
        assertEquals(1, coordinator.getRetainedHistoryCount())
        assertEquals(1, coordinator.getActiveSubscriptionCount())

        coordinator.dispose()
    }
}
