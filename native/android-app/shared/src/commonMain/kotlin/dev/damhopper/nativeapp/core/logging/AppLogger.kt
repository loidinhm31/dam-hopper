package dev.damhopper.nativeapp.core.logging

import kotlinx.datetime.Clock

/**
 * Global logging and diagnostics coordinator for DamHopper native app.
 *
 * Invariants:
 * 1. Log behavior only: never log keystrokes, command lines, or raw terminal data.
 * 2. Redacts all sensitive keys, bearer tokens, passwords, and secrets before sink delivery and storage.
 * 3. Never throws: sink failures are safely caught and ignored to protect core app and transport execution.
 * 4. Diagnostics are retained in a bounded ring buffer scoped by owner profile and session ID.
 */
object AppLogger {
    var minLevel: LogLevel = LogLevel.DEBUG
    var redactSensitiveData: Boolean = true

    private val sinkLock = Any()
    private val sinks = mutableListOf<LogSink>(PrintLogSink())
    private val ringBuffer = DiagnosticRingBuffer()

    var testClock: (() -> Long)? = null

    fun nowMs(): Long = testClock?.invoke() ?: Clock.System.now().toEpochMilliseconds()

    fun addSink(sink: LogSink) {
        synchronized(sinkLock) {
            if (!sinks.contains(sink)) {
                sinks.add(sink)
            }
        }
    }

    fun removeSink(sink: LogSink) {
        synchronized(sinkLock) {
            sinks.remove(sink)
        }
    }

    fun clearSinks() {
        synchronized(sinkLock) {
            sinks.clear()
        }
    }

    fun resetToDefault() {
        minLevel = LogLevel.DEBUG
        redactSensitiveData = true
        testClock = null
        ringBuffer.clear()
        synchronized(sinkLock) {
            sinks.clear()
            sinks.add(PrintLogSink())
        }
    }

    fun debug(
        tag: String,
        message: String,
        metadata: Map<String, String>? = null,
        throwable: Throwable? = null,
    ) {
        emit(LogLevel.DEBUG, tag, message, metadata, throwable)
    }

    fun info(
        tag: String,
        message: String,
        metadata: Map<String, String>? = null,
        throwable: Throwable? = null,
    ) {
        emit(LogLevel.INFO, tag, message, metadata, throwable)
    }

    fun warn(
        tag: String,
        message: String,
        metadata: Map<String, String>? = null,
        throwable: Throwable? = null,
    ) {
        emit(LogLevel.WARN, tag, message, metadata, throwable)
    }

    fun error(
        tag: String,
        message: String,
        metadata: Map<String, String>? = null,
        throwable: Throwable? = null,
    ) {
        emit(LogLevel.ERROR, tag, message, metadata, throwable)
    }

    /**
     * Records a structured diagnostic event into the bounded ring buffer.
     * Also mirrors to logger sinks as debug or warn depending on event type.
     */
    fun recordDiagnostic(
        type: String,
        scope: String,
        message: String,
        profileId: String? = null,
        generation: Long? = null,
        sessionId: String? = null,
        incarnation: Long? = null,
        metadata: Map<String, String>? = null,
    ) {
        val safeMessage = if (redactSensitiveData) Redactor.redactString(message) else message
        val safeMeta = if (redactSensitiveData) Redactor.redactMetadata(metadata) else metadata
        val timestamp = nowMs()

        val entry = DiagnosticEntry(
            timestampMs = timestamp,
            type = type,
            scope = scope,
            message = safeMessage,
            profileId = profileId,
            generation = generation,
            sessionId = sessionId,
            incarnation = incarnation,
            metadata = safeMeta,
        )

        ringBuffer.add(entry)

        val level = if (type == "error" || message.contains("error", ignoreCase = true) || message.contains("failed", ignoreCase = true)) {
            LogLevel.WARN
        } else {
            LogLevel.DEBUG
        }
        val metaWithScope = (safeMeta ?: emptyMap()) + mapOf(
            "diagType" to type,
            "scope" to scope,
        )
        emit(level, scope, safeMessage, metaWithScope, null)
    }

    fun getDiagnosticsSnapshot(
        profileId: String? = null,
        generation: Long? = null,
        sessionId: String? = null,
    ): DiagnosticSnapshot {
        val entries = ringBuffer.snapshot(profileId, generation, sessionId)
        val stats = ringBuffer.currentStats()
        val manifest = DiagnosticManifest(
            schemaVersion = 1,
            entryCount = entries.size,
            estimatedBytes = stats.second,
            maxEntries = ringBuffer.maxEntries,
            maxBytes = ringBuffer.maxBytes,
        )
        return DiagnosticSnapshot(manifest, entries)
    }

    fun clearDiagnostics(profileId: String? = null) {
        ringBuffer.clear(profileId)
    }

    private fun emit(
        level: LogLevel,
        tag: String,
        message: String,
        metadata: Map<String, String>?,
        throwable: Throwable?,
    ) {
        if (!level.shouldLog(minLevel)) return

        val safeMessage = if (redactSensitiveData) Redactor.redactString(message) else message
        val safeMeta = if (redactSensitiveData) Redactor.redactMetadata(metadata) else metadata
        val entry = LogEntry(
            timestampMs = nowMs(),
            level = level,
            tag = tag,
            message = safeMessage,
            metadata = safeMeta,
            throwable = throwable,
        )

        val currentSinks = synchronized(sinkLock) { sinks.toList() }
        for (sink in currentSinks) {
            try {
                sink.log(entry)
            } catch (_: Throwable) {
                // Sinks must never break the execution path
            }
        }
    }
}
