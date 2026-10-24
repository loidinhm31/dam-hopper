package dev.damhopper.nativeapp.core.logging

import kotlinx.serialization.Serializable

/**
 * Single leveled log entry emitted by [AppLogger].
 */
data class LogEntry(
    val timestampMs: Long,
    val level: LogLevel,
    val tag: String,
    val message: String,
    val metadata: Map<String, String>? = null,
    val throwable: Throwable? = null,
)

/**
 * Structured diagnostic event recorded by [AppLogger], scoped strictly to its owner.
 * Never contains keystrokes, commands, or PTY terminal content.
 */
@Serializable
data class DiagnosticEntry(
    val timestampMs: Long,
    val type: String, // e.g. "transport", "terminal", "log", "error"
    val scope: String, // e.g. "terminal-session", "terminal-panel", "ws-transport"
    val message: String,
    val profileId: String? = null,
    val generation: Long? = null,
    val sessionId: String? = null,
    val incarnation: Long? = null,
    val metadata: Map<String, String>? = null,
)

@Serializable
data class DiagnosticManifest(
    val schemaVersion: Int = 1,
    val entryCount: Int,
    val estimatedBytes: Int,
    val maxEntries: Int,
    val maxBytes: Int,
)

@Serializable
data class DiagnosticSnapshot(
    val manifest: DiagnosticManifest,
    val entries: List<DiagnosticEntry>,
)
