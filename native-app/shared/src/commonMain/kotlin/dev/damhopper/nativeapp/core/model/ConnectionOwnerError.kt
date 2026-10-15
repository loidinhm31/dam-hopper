package dev.damhopper.nativeapp.core.model

/**
 * Standard reasons for connection and ownership failures.
 */
enum class ConnectionErrorReason {
    /** The captured connection generation or socket instance is older than the current active one. */
    STALE,
    /** The requested profile connection or socket transport is not currently available/connected. */
    UNAVAILABLE,
    /** Attempted operation with a mismatched profileId or connection owner. */
    OWNER_MISMATCH,
    /** Operation was rejected because authentication or step-up is required. */
    AUTH_REQUIRED,
}

/**
 * Exception thrown when an operation fails owner checks or connection generation validation.
 */
class ConnectionOwnerError(
    message: String,
    val reason: ConnectionErrorReason,
    cause: Throwable? = null,
) : RuntimeException(message, cause) {
    override fun toString(): String = "ConnectionOwnerError(reason=$reason, message='$message')"
}
