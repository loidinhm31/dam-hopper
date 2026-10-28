package dev.damhopper.nativeapp.core.lifecycle

/**
 * Immutable connection environment state representing logical foreground/background epochs
 * and default network route revisions.
 */
data class ConnectionEnvironment(
    val foregroundEpoch: Long = 0L,
    val networkRouteRevision: Long = 0L,
    val isNetworkAvailable: Boolean = true,
    val isForeground: Boolean = true,
)
