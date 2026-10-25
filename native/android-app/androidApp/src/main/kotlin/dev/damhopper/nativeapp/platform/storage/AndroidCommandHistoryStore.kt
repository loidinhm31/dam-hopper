package dev.damhopper.nativeapp.platform.storage

import android.content.Context
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.ui.screens.ObservableCommandHistory
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Explicit, opt-in, app-local terminal command history.
 *
 * - **Consent:** off by default; [setEnabled] flips only this device's recording. Disabling stops future saving and
 *   hides suggestions; [clear] deletes the storage file and every live suggestion. The consent and the data are never
 *   part of any synchronized preference, source snapshot, diagnostic export or server request.
 * - **What is stored:** only the exact command text a user explicitly submitted in the app and the transport
 *   confirmed as delivered, scoped by endpoint/account/profile/project. Never raw keystrokes, terminal output,
 *   failed or uncertain submissions (the caller records only confirmed ones). Blank commands, commands containing
 *   control characters other than TAB, and commands over [MAX_COMMAND_BYTES] UTF-8 bytes are refused, not truncated.
 * - **Bounds:** at most [MAX_RECORDS] records and [MAX_TOTAL_BYTES] serialized bytes; the oldest records are dropped
 *   before either cap is exceeded.
 * - **Storage:** [file] must live in app-private, backup-excluded storage (the Context constructor uses
 *   `noBackupFilesDir`). Writes are atomic (temp file + rename). A persistence failure stops recording, is reported
 *   through [failure] and is never retried silently; unreadable stored bytes also stop recording until cleared.
 * - **Suggestions:** app-local history only (not shell lifecycle prediction). They are returned for the exact owner
 *   and project; the caller inserts a choice into the draft only and never submits it automatically.
 */
class AndroidCommandHistoryStore(
    private val file: File,
    private val ioExecutor: Executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "command-history-io").apply { isDaemon = true }
    },
) : ObservableCommandHistory {

    constructor(context: Context) : this(File(context.applicationContext.noBackupFilesDir, "command-history-v1.bin"))

    private class Record(val scope: String, val project: String, val command: String) {
        val bytes: Int = RECORD_OVERHEAD + scope.utf8Size() + project.utf8Size() + command.utf8Size()
    }

    private val lock = Any()
    private val records = ArrayDeque<Record>()
    private var totalBytes = HEADER_BYTES
    private var recordingStopped = false
    private var writeSequence = 0L

    private val _enabled = MutableStateFlow(false)
    override val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    private val _failure = MutableStateFlow<String?>(null)
    override val failure: StateFlow<String?> = _failure.asStateFlow()

    private val _revision = MutableStateFlow(0L)

    /** Advances on every change of stored content so live suggestions can be recomputed. */
    override val revision: StateFlow<Long> = _revision.asStateFlow()

    @Volatile
    private var isCorrupt = false
    init {
        load()
    }

    override fun setEnabled(enabled: Boolean) {
        synchronized(lock) {
            if (_enabled.value == enabled) return
            _enabled.value = enabled
            // Re-enabling is an explicit consent: it also lifts a previous persistence-failure stop.
            if (enabled && _failure.value != null && !isCorrupt) {
                recordingStopped = false
                _failure.value = null
            }
        }
        bump()
    }

    override fun record(owner: SettingsOwner, project: String, command: String) {
        if (!isRecordable(command)) return
        val stored: List<Record>
        val sequence: Long
        synchronized(lock) {
            if (!_enabled.value || recordingStopped) return
            val scope = scopeKey(owner)
            val candidate = Record(scope, project, command)
            if (candidate.bytes + HEADER_BYTES > MAX_TOTAL_BYTES) return
            // A repeated submission becomes the newest entry instead of duplicating.
            val existing = records.indexOfFirst { it.scope == scope && it.project == project && it.command == command }
            if (existing >= 0) {
                totalBytes -= records.removeAt(existing).bytes
            }
            records.addLast(candidate)
            totalBytes += candidate.bytes
            while (records.size > MAX_RECORDS || totalBytes > MAX_TOTAL_BYTES) {
                totalBytes -= records.removeFirst().bytes
            }
            stored = records.toList()
            sequence = ++writeSequence
        }
        persist(stored, sequence)
        bump()
    }

    override fun suggestions(owner: SettingsOwner, project: String, prefix: String): List<String> {
        if (prefix.isEmpty()) return emptyList()
        val scope = scopeKey(owner)
        synchronized(lock) {
            if (!_enabled.value) return emptyList()
            val out = LinkedHashSet<String>()
            for (i in records.indices.reversed()) {
                val r = records[i]
                if (r.scope == scope && r.project == project && r.command.startsWith(prefix) && r.command != prefix) {
                    out += r.command
                    if (out.size >= MAX_SUGGESTIONS) break
                }
            }
            return out.toList()
        }
    }

    override fun clear() {
        synchronized(lock) {
            records.clear()
            totalBytes = HEADER_BYTES
            writeSequence++
            isCorrupt = false
            recordingStopped = false
            _failure.value = null
        }
        ioExecutor.execute {
            try {
                if (file.exists() && !file.delete()) throw IOException("could not delete ${file.name}")
            } catch (t: Throwable) {
                synchronized(lock) {
                    recordingStopped = true
                    _failure.value = "Could not delete the saved command history (${t.message ?: "I/O error"}). Recording is paused."
                }
            }
        }
        bump()
    }

    /** Number of stored records (tests/diagnostics of bounds; no content). */
    internal fun recordCount(): Int = synchronized(lock) { records.size }

    /** Serialized size of the current content in bytes. */
    internal fun serializedBytes(): Int = synchronized(lock) { totalBytes }


    private fun bump() {
        _revision.value = _revision.value + 1
    }

    private fun persist(snapshot: List<Record>, sequence: Long) {
        ioExecutor.execute {
            // Newer writes supersede older queued ones; a stale snapshot must never overwrite a newer one.
            if (synchronized(lock) { sequence != writeSequence }) return@execute
            try {
                val bytes = encode(snapshot)
                val temp = File(file.parentFile, file.name + ".tmp")
                file.parentFile?.mkdirs()
                temp.writeBytes(bytes)
                if (!temp.renameTo(file)) {
                    file.delete()
                    if (!temp.renameTo(file)) throw IOException("could not replace ${file.name}")
                }
            } catch (t: Throwable) {
                synchronized(lock) {
                    recordingStopped = true
                    _failure.value = "Saving command history failed (${t.message ?: "I/O error"}). Recording is paused."
                }
            }
        }
    }

    private fun load() {
        val bytes = try {
            if (!file.exists()) return
            if (file.length() > MAX_TOTAL_BYTES + 4096) throw IOException("file size ${file.length()} exceeds maximum bound")
            file.readBytes()
        } catch (t: Throwable) {
            markCorrupt("The saved command history could not be read (${t.message ?: "I/O error"}). Clear it to resume recording.")
            return
        }
        val decoded = try {
            decode(bytes)
        } catch (t: Throwable) {
            null
        }
        if (decoded == null) {
            markCorrupt("The saved command history is unreadable. Clear it to resume recording.")
            return
        }
        synchronized(lock) {
            for (r in decoded) {
                records.addLast(r)
                totalBytes += r.bytes
            }
            while (records.size > MAX_RECORDS || totalBytes > MAX_TOTAL_BYTES) totalBytes -= records.removeFirst().bytes
        }
    }

    private fun markCorrupt(message: String) {
        isCorrupt = true
        recordingStopped = true
        _failure.value = message
    }

    private fun encode(snapshot: List<Record>): ByteArray {
        val out = ByteArrayOutputStream(HEADER_BYTES + snapshot.sumOf { it.bytes })
        DataOutputStream(out).use { data ->
            data.writeInt(MAGIC)
            data.writeInt(VERSION)
            data.writeInt(snapshot.size)
            for (r in snapshot) {
                writeField(data, r.scope)
                writeField(data, r.project)
                writeField(data, r.command)
            }
        }
        return out.toByteArray()
    }

    private fun decode(bytes: ByteArray): List<Record>? {
        DataInputStream(ByteArrayInputStream(bytes)).use { data ->
            if (data.readInt() != MAGIC || data.readInt() != VERSION) return null
            val count = data.readInt()
            if (count < 0 || count > MAX_RECORDS) return null
            val out = ArrayList<Record>(count)
            repeat(count) {
                val scope = readField(data, MAX_SCOPE_BYTES) ?: return null
                val project = readField(data, MAX_SCOPE_BYTES) ?: return null
                val command = readField(data, MAX_COMMAND_BYTES) ?: return null
                out += Record(scope, project, command)
            }
            if (data.available() != 0) return null
            return out
        }
    }

    private fun writeField(data: DataOutputStream, value: String) {
        val raw = value.encodeToByteArray()
        data.writeInt(raw.size)
        data.write(raw)
    }

    private fun readField(data: DataInputStream, max: Int): String? {
        val length = data.readInt()
        if (length < 0 || length > max) return null
        val raw = ByteArray(length)
        data.readFully(raw)
        return raw.decodeToString(throwOnInvalidSequence = true)
    }

    companion object {
        const val MAX_RECORDS = 1000
        const val MAX_COMMAND_BYTES = 4 * 1024
        const val MAX_TOTAL_BYTES = 4 * 1024 * 1024
        const val MAX_SUGGESTIONS = 5
        private const val MAX_SCOPE_BYTES = 8 * 1024
        private const val MAGIC = 0x44484953 // "DHIS"
        private const val VERSION = 1
        private const val HEADER_BYTES = 12
        private const val RECORD_OVERHEAD = 12

        /** Endpoint/account/profile scope; the length prefix keeps tuples injective. */
        internal fun scopeKey(owner: SettingsOwner): String {
            val parts = listOf(owner.endpoint, owner.accountId, owner.connection.profileId)
            return parts.joinToString("") { "${it.length}:$it" }
        }

        /** Exact app-submitted command text only: non-blank, single text line, within the per-entry cap. */
        internal fun isRecordable(command: String): Boolean {
            if (command.isBlank()) return false
            if (command.utf8Size() > MAX_COMMAND_BYTES) return false
            return command.none { it.code < 0x20 && it != '\t' || it.code == 0x7F }
        }

        private fun String.utf8Size(): Int = encodeToByteArray().size
    }
}
