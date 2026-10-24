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
        // Coalesced ordinary requests share the pending attempt's gate and captured offset.
        val queued = pending
        val offset = if (queued != null && !controller.isReplayCompleted) queued.offset else controller.beginAttach()
        enqueue(Request(offset, isCurrent, connect, send, onResult))
        return offset
    }

    fun recover(
        capturedOffset: ULong,
        isCurrent: () -> Boolean,
        connect: suspend () -> Unit,
        send: suspend (ULong?) -> Unit,
        onResult: (Exception?) -> Unit = {},
    ) {
        // Controller recovery already closed the gate. A second reset would drop queued live bytes.
        enqueue(Request(capturedOffset, isCurrent, connect, send, onResult))
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
                        fenceIfLatest(next)
                        continue
                    }
                    try {
                        next.connect()
                        if (!next.isCurrent()) {
                            fenceIfLatest(next)
                            continue
                        }
                        next.send(next.offset.takeIf { it > 0uL })
                        if (next.isCurrent()) next.onResult(null) else fenceIfLatest(next)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        fenceIfLatest(next)
                        if (next.isCurrent()) next.onResult(e)
                    }
                    // Sending is not readiness: only controller replay/drain can open the gate.
                }
            } catch (e: CancellationException) {
                // This worker's pending send is abandoned too. Preserve bytes, but never enable input.
                controller.failAttach()
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
        if (latest === request) controller.failAttach()
    }
}
