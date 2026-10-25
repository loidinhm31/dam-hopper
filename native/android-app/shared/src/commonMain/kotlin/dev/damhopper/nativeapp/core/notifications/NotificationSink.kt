package dev.damhopper.nativeapp.core.notifications

import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

@Serializable
enum class NotificationChannelId(val id: String, val channelName: String) {
    TERMINAL_ATTENTION("channel_terminal_attention", "Terminal Attention"),
    TRANSFERS("channel_transfers", "File Transfers"),
    IDLE_SUSPEND("channel_idle_suspend", "Idle Suspend"),
}

/** Largest integer a JSON/JS server counter can carry exactly (2^53 - 1). */
const val MAX_SERVER_SAFE_INTEGER: Long = 9_007_199_254_740_991L

/**
 * Accepts only `0..9007199254740991`. Larger values (including `ULong.MAX_VALUE`) return null, so callers
 * reject admission/click instead of truncating, wrapping, converting through floating point or using a sentinel.
 */
fun ULong.toServerSafeLongOrNull(): Long? =
    if (this <= MAX_SERVER_SAFE_INTEGER.toULong()) toLong() else null

/**
 * Exact semantic click/admission target. Every counter is a checked non-negative safe integer; construction
 * (including deserialization from an Intent) rejects anything else with [IllegalArgumentException].
 * Generic transfer/idle targets leave the terminal fields null and are therefore non-terminal.
 * No secret paths or commands may be stored here (it is encoded into the notification identity/Intent).
 */
@Serializable
data class NotificationTarget(
    val profileId: String,
    val generation: Long,
    val serverEpoch: Long? = null,
    val terminalId: String? = null,
    val incarnation: Long? = null,
    val attentionRevision: Long? = null,
    val processInstanceId: String? = null,
    val endpoint: String? = null,
    val accountId: String? = null,
    val project: String? = null,
    val worktreePath: String? = null,
    val agentSessionId: String? = null,
    val agentKind: String? = null,
) {
    init {
        requireSafe("generation", generation)
        serverEpoch?.let { requireSafe("serverEpoch", it) }
        incarnation?.let { requireSafe("incarnation", it) }
        attentionRevision?.let { requireSafe("attentionRevision", it) }
    }

    private fun requireSafe(name: String, value: Long) {
        require(value in 0L..MAX_SERVER_SAFE_INTEGER) { "$name must be a safe integer in 0..$MAX_SERVER_SAFE_INTEGER" }
    }
}

/**
 * [key] is the length-prefixed, UTF-8, URI-safe tuple
 * (processInstanceId, profile, generation, epoch, terminal, incarnation, agentSession, agentKind,
 * attentionRevision, semanticEventId): one value for history identity, OS notification tag and Intent.data
 * uniqueness. Never concatenation or hash-only. [silent] posts without sound/vibration; default public
 * title/body are always generic.
 */
data class AppNotification(
    val key: String,
    val channel: NotificationChannelId,
    val target: NotificationTarget,
    val title: String,
    val body: String,
    val silent: Boolean = false,
    val publicTitle: String = "DamHopper",
    val publicBody: String = "Attention required",
) {
    init {
        require(key.isNotBlank()) { "notification key cannot be blank" }
    }
}

/**
 * Canonical notification identity. One value is the history key, the OS notification tag and the unique
 * `Intent.data` path segment, so it is built from an injective encoding, never concatenation or a hash:
 * each of the ten tuple fields is `~` (null) or `<utf8ByteLength>:<utf8 bytes>`, and the whole byte string
 * is lowercase-hex encoded (URI-safe, case-stable, no padding rules). Field order is fixed:
 * processInstanceId, profile, generation, epoch, terminal, incarnation, agentSession, agentKind,
 * attentionRevision, semanticEventId. Two different tuples therefore never share a key, including
 * tuples whose parts contain `:` or digits, equal terminal ids in different profiles, or strings with
 * equal `hashCode()`. No secret path or command belongs in any field.
 */
object NotificationKey {
    private const val FIELD_COUNT = 10
    private val NULL_MARK = '~'.code
    private const val HEX = "0123456789abcdef"

    fun of(
        processInstanceId: String,
        profileId: String,
        generation: Long,
        serverEpoch: Long?,
        terminalId: String?,
        incarnation: Long?,
        agentSessionId: String?,
        agentKind: String?,
        attentionRevision: Long?,
        semanticEventId: String,
    ): String {
        require(processInstanceId.isNotBlank()) { "processInstanceId cannot be blank" }
        require(profileId.isNotBlank()) { "profileId cannot be blank" }
        require(semanticEventId.isNotBlank()) { "semanticEventId cannot be blank" }
        return encode(
            listOf(
                processInstanceId, profileId, generation.toString(), serverEpoch?.toString(), terminalId,
                incarnation?.toString(), agentSessionId, agentKind, attentionRevision?.toString(), semanticEventId,
            ),
        )
    }

    /**
     * Decodes a canonical key back into its ten fields, or null when [key] is not canonical (including a
     * generic caller-chosen key). Used to cross-check click extras against `Intent.data`.
     */
    fun fields(key: String): List<String?>? {
        if (key.isEmpty() || key.length % 2 != 0) return null
        val bytes = ByteArray(key.length / 2)
        for (i in bytes.indices) {
            val hi = HEX.indexOf(key[2 * i])
            val lo = HEX.indexOf(key[2 * i + 1])
            if (hi < 0 || lo < 0) return null
            bytes[i] = ((hi shl 4) or lo).toByte()
        }
        val out = ArrayList<String?>(FIELD_COUNT)
        var pos = 0
        while (out.size < FIELD_COUNT) {
            if (pos >= bytes.size) return null
            if (bytes[pos].toInt() == NULL_MARK) {
                out.add(null)
                pos++
                continue
            }
            var length = 0L
            var digits = 0
            while (pos < bytes.size && bytes[pos].toInt() in '0'.code..'9'.code) {
                length = length * 10 + (bytes[pos].toInt() - '0'.code)
                if (length > bytes.size) return null
                digits++
                pos++
            }
            if (digits == 0 || pos >= bytes.size || bytes[pos].toInt() != ':'.code) return null
            pos++
            val end = pos + length.toInt()
            if (end > bytes.size) return null
            out.add(bytes.decodeToString(pos, end))
            pos = end
        }
        if (pos != bytes.size) return null
        return if (encode(out) == key) out else null
    }

    private fun encode(fields: List<String?>): String {
        val sb = StringBuilder()
        for (field in fields) {
            if (field == null) {
                sb.append(hexOf(byteArrayOf(NULL_MARK.toByte())))
            } else {
                val bytes = field.encodeToByteArray()
                sb.append(hexOf("${bytes.size}:".encodeToByteArray()))
                sb.append(hexOf(bytes))
            }
        }
        return sb.toString()
    }

    private fun hexOf(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append(HEX[v ushr 4]).append(HEX[v and 0x0F])
        }
        return sb.toString()
    }
}

/**
 * Platform-independent notification sink interface.
 */
interface NotificationSink {
    /** True iff the notification was handed to the platform; false for a disabled/blocked/failed OS post (never throws for those). */
    fun postNotification(notification: AppNotification): Boolean
    fun cancelNotification(key: String)
    fun cancelNotificationsForProfile(profileId: String)
    fun cancelAll()
    fun areNotificationsEnabled(): Boolean
}

enum class NotificationPermissionState { NOT_REQUIRED, NOT_REQUESTED, GRANTED, DENIED }

data class NotificationChannelStatus(val blocked: Boolean, val soundConfigured: Boolean)

/** Permission/app/per-channel readiness. Never inferred from policy.browser alone. */
data class NotificationPlatformStatus(
    val permission: NotificationPermissionState,
    val appBlocked: Boolean,
    val channels: Map<NotificationChannelId, NotificationChannelStatus>,
)

/**
 * Platform permission/channel boundary. API 29 needs no runtime permission; API 33+ prompts only from an
 * explicit user action ([requestPermission]); events never prompt. Activity launchers are supplied only by
 * the retained integration, Settings never retains an Activity.
 */
interface NotificationPlatformPort {
    val status: StateFlow<NotificationPlatformStatus>
    fun requestPermission()
    fun openChannelSettings(channel: NotificationChannelId)
    fun refreshStatus()
}

/** Foreground in-app audio: [pattern] one of default/soft/two-tone/urgent, [volume] finite 0..1. */
interface NotificationAudioPort {
    fun play(pattern: String, volume: Double)
    fun stop()
}

/**
 * In-memory notification sink for testing and JVM targets. Same String-key identity as the Android sink:
 * an equal key replaces, a different key never does, and profile cancellation is exact by profile id.
 */
class InMemoryNotificationSink : NotificationSink {
    private val lock = Any()
    private val notifications = LinkedHashMap<String, AppNotification>()

    override fun postNotification(notification: AppNotification): Boolean {
        synchronized(lock) { notifications[notification.key] = notification }
        return true
    }

    override fun cancelNotification(key: String) {
        synchronized(lock) { notifications.remove(key) }
    }

    override fun cancelNotificationsForProfile(profileId: String) {
        synchronized(lock) { notifications.values.removeAll { it.target.profileId == profileId } }
    }

    override fun cancelAll() {
        synchronized(lock) { notifications.clear() }
    }

    override fun areNotificationsEnabled(): Boolean = true

    fun getActiveNotifications(): List<AppNotification> = synchronized(lock) { notifications.values.toList() }
}
