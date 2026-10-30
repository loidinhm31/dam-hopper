package dev.damhopper.nativeapp.features.terminal

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.ownership.ConnectionRegistry
import dev.damhopper.nativeapp.core.transport.ApiClient
import dev.damhopper.nativeapp.features.workspace.WorkspaceFileOwner
import dev.damhopper.nativeapp.ui.screens.FailedCommandRecord
import dev.damhopper.nativeapp.ui.screens.QueuedWrite
import dev.damhopper.nativeapp.ui.screens.TerminalBindingToken
import dev.damhopper.nativeapp.ui.screens.installCurrentControllerBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TerminalScreenBindingTest {

    private fun createRepository(conn: ConnectionRef): TerminalRepository {
        val registry = ConnectionRegistry()
        val client = ApiClient(
            connection = conn,
            baseUrl = "http://127.0.0.1:8080",
            authTokenProvider = { "token" },
            registry = registry,
        )
        return TerminalRepository(client, null)
    }

    @Test
    fun sameIncarnationScreenRebindSmoke() = runTest {
        val owner = WorkspaceFileOwner(
            profileId = "prof-1",
            baseUrl = "http://127.0.0.1:8080",
            accountUser = "dev-user",
            project = "dam-hopper",
        )
        val conn1 = ConnectionRef("prof-1", 1L)
        val repo1 = createRepository(conn1)

        val surface = VtTerminalSurface()
        val controller = TerminalSessionController(
            sessionId = "term-1",
            initialIncarnation = 1L,
            connectionRef = conn1,
            surface = surface,
            terminalRepository = repo1,
        )

        // Preload VT buffer content and accepted offset
        surface.updateCursorBlink(false)
        controller.handleBufferReplay("prompt$ ".encodeToByteArray(), 8uL, reset = true, truncated = false, bufferIncarnation = 1uL)
        assertEquals(8uL, controller.lastSeenOffset)
        assertEquals("prompt$", surface.lines.firstOrNull()?.text?.trimEnd())

        val writeChannel = Channel<QueuedWrite>(capacity = 64)
        val attachQueues = mutableMapOf<TerminalSessionController, TerminalAttachQueue>()
        val destroying = mutableMapOf<String, Boolean>()
        val failedRecords = mutableListOf<FailedCommandRecord>()
        var confirmedCmd: String? = null
        var uiBanner: String? = null

        var currentToken1 = TerminalBindingToken(
            owner = owner,
            connectionRef = conn1,
            repositoryIdentity = System.identityHashCode(repo1),
            controllerId = "term-1",
            controllerIncarnation = 1L,
            surfaceEpoch = 1L,
        )

        var activeBinding = currentToken1

        // Install binding 1 on controller
        installCurrentControllerBinding(
            controller = controller,
            bindingToken = currentToken1,
            ownerScope = this,
            terminalRepo = repo1,
            writeChannel = writeChannel,
            attachQueues = attachQueues,
            destroyingSessionIds = destroying,
            isInputEligible = { true },
            currentActiveSessionId = { "term-1" },
            currentActiveSessionEpoch = { 1L },
            currentAttachmentAttemptToken = { 1L },
            nextAttachmentAttemptToken = { 2L },
            isBindingCurrent = { activeBinding == currentToken1 },
            lastSubmittedCommandText = { "ls -la" },
            onConfirmedCommand = { confirmedCmd = it },
            onErrorBanner = { uiBanner = it },
            failedRecords = failedRecords,
        )

        // Type on binding 1
        controller.sendInput("ls -la\n".encodeToByteArray())
        val write1 = writeChannel.tryReceive().getOrNull()
        assertNotNull(write1)
        assertEquals("term-1", write1.sessionId)
        assertEquals(currentToken1, write1.bindingToken)

        // Now rebind to generation 2 (same controller and surface retained!)
        val conn2 = ConnectionRef("prof-1", 2L)
        val repo2 = createRepository(conn2)
        controller.rebindTransport(conn2, repo2)

        val currentToken2 = TerminalBindingToken(
            owner = owner,
            connectionRef = conn2,
            repositoryIdentity = System.identityHashCode(repo2),
            controllerId = "term-1",
            controllerIncarnation = 1L,
            surfaceEpoch = 2L,
        )
        activeBinding = currentToken2

        // Shared screen installer invoked for same incarnation on reuse path
        installCurrentControllerBinding(
            controller = controller,
            bindingToken = currentToken2,
            ownerScope = this,
            terminalRepo = repo2,
            writeChannel = writeChannel,
            attachQueues = attachQueues,
            destroyingSessionIds = destroying,
            isInputEligible = { true },
            currentActiveSessionId = { "term-1" },
            currentActiveSessionEpoch = { 2L },
            currentAttachmentAttemptToken = { 3L },
            nextAttachmentAttemptToken = { 4L },
            isBindingCurrent = { activeBinding == currentToken2 },
            lastSubmittedCommandText = { "git status" },
            onConfirmedCommand = { confirmedCmd = it },
            onErrorBanner = { uiBanner = it },
            failedRecords = failedRecords,
        )

        // Deliver old binding output/stream chunk with stale generation/token: verify it doesn't corrupt state
        // Replay gate accepts new data on generation 2
        controller.handleBufferReplay("output-2\n".encodeToByteArray(), 8uL, reset = false, truncated = false, bufferIncarnation = 1uL)

        // Send input on binding 2
        controller.sendInput("git status\n".encodeToByteArray())
        val write2 = writeChannel.tryReceive().getOrNull()
        assertNotNull(write2)
        assertEquals(currentToken2, write2.bindingToken)
        assertEquals(conn2, write2.bindingToken.connectionRef)

        // Grid contents preserved
        assertEquals("prompt$", surface.lines.firstOrNull()?.text?.trimEnd())
        assertEquals(8uL, controller.lastSeenOffset)
        assertEquals(1uL, controller.incarnation.toLong().toULong())
    }

    @Test
    fun staleBindingTokenDropsQueuedWriteExecution() = runTest {
        val owner = WorkspaceFileOwner("prof-1", "http://127.0.0.1:8080", "dev-user", "dam-hopper")
        val conn1 = ConnectionRef("prof-1", 1L)
        val repo1 = createRepository(conn1)
        val controller = TerminalSessionController("term-1", 1L, conn1)

        val writeChannel = Channel<QueuedWrite>(capacity = 64)
        val token1 = TerminalBindingToken(owner, conn1, System.identityHashCode(repo1), "term-1", 1L, 1L)

        var admitted = false
        installCurrentControllerBinding(
            controller = controller,
            bindingToken = token1,
            ownerScope = this,
            terminalRepo = repo1,
            writeChannel = writeChannel,
            attachQueues = mutableMapOf(),
            destroyingSessionIds = emptyMap(),
            isInputEligible = { true },
            currentActiveSessionId = { "term-1" },
            currentActiveSessionEpoch = { 1L },
            currentAttachmentAttemptToken = { 1L },
            nextAttachmentAttemptToken = { 2L },
            isBindingCurrent = { false }, // Binding became stale!
            lastSubmittedCommandText = { "stale command" },
            onAdmitted = { admitted = it },
        )

        controller.sendInput("stale command\n".encodeToByteArray())
        val write = writeChannel.tryReceive().getOrNull()
        assertEquals(null, write, "Stale binding must drop input before enqueueing")
        assertFalse(admitted)
    }
}
