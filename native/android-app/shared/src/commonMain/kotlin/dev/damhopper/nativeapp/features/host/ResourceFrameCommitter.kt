package dev.damhopper.nativeapp.features.host

import dev.damhopper.nativeapp.core.transport.HostResourceDataEvent
import dev.damhopper.nativeapp.core.transport.HostResourceStatusEvent
import dev.damhopper.nativeapp.core.transport.ProtocolJson

/**
 * Handles validation, revision checks, decoding, and committing of SSE frames.
 */
object ResourceFrameCommitter {

    fun updateFreshness(
        status: HostResourceStatusEvent,
        currentState: ResourceSourceState,
        timeProvider: () -> Long,
    ): ResourceSourceState? {
        if (currentState.lastCommittedEpoch == status.serverEpoch &&
            currentState.lastCommittedRevision?.toString() == status.revision
        ) {
            return currentState.copy(
                freshness = ProjectionFreshness(
                    serverEpoch = status.serverEpoch,
                    revision = status.revision,
                    snapshotAgeMs = status.snapshotAgeMs,
                    metricsAgeMs = status.metricsAgeMs,
                    freshnessTtlMs = status.freshnessTtlMs,
                    localReceivedAtMs = timeProvider(),
                )
            )
        }
        return null
    }

    fun commitPairedFrame(
        status: HostResourceStatusEvent,
        data: HostResourceDataEvent,
        currentState: ResourceSourceState,
        timeProvider: () -> Long,
        isNewAttemptBaseline: Boolean = false,
    ): ResourceSourceState? {
        val newRev = data.revision.toULongOrNull() ?: return null
        val currentEpoch = currentState.lastCommittedEpoch
        val currentRev = currentState.lastCommittedRevision

        // Reject duplicate or regressing revisions within same server epoch,
        // but allow equal revision on new attempt baseline to establish reconnect baseline.
        if (currentEpoch == data.serverEpoch && currentRev != null) {
            if (isNewAttemptBaseline) {
                if (newRev < currentRev) return null
            } else {
                if (newRev <= currentRev) return null
            }
        }

        val snapshot: HostResourceSnapshotV1 = try {
            ProtocolJson.decodeFromJsonElement(HostResourceSnapshotV1.serializer(), data.snapshot)
        } catch (_: Throwable) {
            return null
        }
        val metrics: HostMetrics = try {
            ProtocolJson.decodeFromJsonElement(HostMetrics.serializer(), data.metrics)
        } catch (_: Throwable) {
            return null
        }

        val freshness = ProjectionFreshness(
            serverEpoch = status.serverEpoch,
            revision = status.revision,
            snapshotAgeMs = status.snapshotAgeMs,
            metricsAgeMs = status.metricsAgeMs,
            freshnessTtlMs = status.freshnessTtlMs,
            localReceivedAtMs = timeProvider(),
        )

        return currentState.copy(
            mode = ResourceSourceMode.LIVE,
            sourceGeneration = currentState.sourceGeneration + 1,
            switching = false,
            freshness = freshness,
            lastCommittedRevision = newRev,
            lastCommittedEpoch = data.serverEpoch,
            latestSnapshot = snapshot,
            latestMetrics = metrics,
        )
    }
}
