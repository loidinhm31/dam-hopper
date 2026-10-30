package dev.damhopper.nativeapp.features.terminal

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

/** Main-thread confined, per-controller request ordering; not a retry or replay-completion policy. */
internal class TerminalAttachQueue(
    private val controller: TerminalSessionController,
    private val scope: CoroutineScope,
) {
    private class Request(
        val offset: ULong,
        val replayGeneration: Long,
        val isCurrent: () -> Boolean,
        val connect: suspend () -> Unit,
        val send: suspend (ULong?) -> Unit,
        val onResult: (Exception?) -> Unit,
    )

    private var pending: Request? = null
    private var latest: Request? = null
    private var running = false

    fun attach(
        isCurrent: () -> Boolean,
        connect: suspend () -> Unit,
        send: suspend (ULong?) -> Unit,
        onResult: (Exception?) -> Unit = {},
    ): ULong {
        if (!isCurrent()) {
            return controller.lastSeenOffset
        }
        // Coalesced ordinary requests share the pending attempt's gate and captured offset.
        val queued = pending
        val offset = if (queued != null && !controller.isReplayCompleted && queued.isCurrent()) {
            queued.offset
        } else {
            controller.beginAttach()
        }
        val generation = controller.gate.replayGeneration
        enqueue(Request(offset, generation, isCurrent, connect, send, onResult))
        return offset
    }

    fun recover(
        capturedOffset: ULong,
        isCurrent: () -> Boolean,
        connect: suspend () -> Unit,
        send: suspend (ULong?) -> Unit,
        onResult: (Exception?) -> Unit = {},
    ) {
        if (!isCurrent()) return
        // Controller recovery already closed the gate. A second reset would drop queued live bytes.
        val generation = controller.gate.replayGeneration
        enqueue(Request(capturedOffset, generation, isCurrent, connect, send, onResult))
    }

    private fun enqueue(request: Request) {
        // While a send is suspended, keep only the latest pending target/offset for this controller.
        pending = request
        latest = request
        if (running) return
        running = true
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                while (true) {
                    val next = pending ?: break
                    pending = null
                    if (!next.isCurrent()) {
                        controller.failAttach()
                        continue
                    }
                    try {
                        next.connect()
                        if (!next.isCurrent()) {
                            controller.failAttach()
                            continue
                        }
                        next.send(next.offset.takeIf { it > 0uL })
                        if (next.isCurrent()) next.onResult(null) else controller.failAttach()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        if (next.isCurrent()) {
                            controller.failAttach()
                            next.onResult(e)
                        }
                    }
                    // Sending is not readiness: only controller replay/drain can open the gate.
                }
            } catch (e: CancellationException) {
                // This worker's pending send is abandoned too. Preserve bytes, but never enable input.
                val curLatest = latest
                if (curLatest != null && curLatest.isCurrent()) {
                    controller.failAttach()
                }
                throw e
            } finally {
                running = false
                pending = null
                latest = null
            }
        }
    }

    private fun fenceIfLatest(request: Request) {
        // An older superseded send must not fence a newer attempt on the same controller.
        if (latest === request) {
            controller.failAttach()
        }
    }
}
