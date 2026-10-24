package dev.damhopper.nativeapp.core.notifications

import kotlinx.serialization.Serializable

@Serializable
enum class NotificationChannelId(val id: String, val channelName: String) {
    TERMINAL_ATTENTION("channel_terminal_attention", "Terminal Attention"),
    TRANSFERS("channel_transfers", "File Transfers"),
    IDLE_SUSPEND("channel_idle_suspend", "Idle Suspend"),
}

@Serializable
data class NotificationTarget(
    val profileId: String,
    val generation: Long,
    val serverEpoch: Long? = null,
    val terminalId: String? = null,
    val incarnation: Long? = null,
    val attentionRevision: Long? = null,
)

data class AppNotification(
    val id: Int,
    val channel: NotificationChannelId,
    val target: NotificationTarget,
    val title: String,
    val body: String,
    val publicTitle: String = "DamHopper",
    val publicBody: String = "Attention required",
)

/**
 * Platform-independent notification sink interface.
 */
interface NotificationSink {
    fun postNotification(notification: AppNotification)
    fun cancelNotification(id: Int)
    fun cancelNotificationsForProfile(profileId: String)
    fun cancelAll()
    fun areNotificationsEnabled(): Boolean
}

/**
 * In-memory notification sink for testing and JVM targets.
 */
class InMemoryNotificationSink : NotificationSink {
    private val notifications = mutableMapOf<Int, AppNotification>()
    private val profileMap = mutableMapOf<String, MutableSet<Int>>()

    override fun postNotification(notification: AppNotification) {
        notifications[notification.id] = notification
        profileMap.getOrPut(notification.target.profileId) { mutableSetOf() }.add(notification.id)
    }

    override fun cancelNotification(id: Int) {
        val n = notifications.remove(id) ?: return
        profileMap[n.target.profileId]?.remove(id)
    }

    override fun cancelNotificationsForProfile(profileId: String) {
        val ids = profileMap.remove(profileId) ?: return
        for (id in ids) {
            notifications.remove(id)
        }
    }

    override fun cancelAll() {
        notifications.clear()
        profileMap.clear()
    }

    override fun areNotificationsEnabled(): Boolean = true

    fun getActiveNotifications(): List<AppNotification> = notifications.values.toList()
}
