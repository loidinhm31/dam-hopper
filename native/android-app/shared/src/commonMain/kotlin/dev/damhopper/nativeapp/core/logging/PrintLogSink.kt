package dev.damhopper.nativeapp.core.logging

/**
 * Log sink interface for receiving dispatched log entries.
 */
fun interface LogSink {
    fun log(entry: LogEntry)
}

/**
 * Standard console/logcat output sink using println (supported on both JVM and Android).
 */
class PrintLogSink : LogSink {
    override fun log(entry: LogEntry) {
        val levelLabel = entry.level.name.padEnd(5)
        val prefix = "[${entry.tag}] $levelLabel: ${entry.message}"
        if (entry.metadata == null && entry.throwable == null) {
            println(prefix)
            return
        }

        val details = buildString {
            append(prefix)
            if (entry.metadata != null && entry.metadata.isNotEmpty()) {
                append(" | meta=")
                append(entry.metadata.toString())
            }
            if (entry.throwable != null) {
                append(" | err=")
                append(entry.throwable.message ?: entry.throwable::class.simpleName)
            }
        }
        println(details)
    }
}
