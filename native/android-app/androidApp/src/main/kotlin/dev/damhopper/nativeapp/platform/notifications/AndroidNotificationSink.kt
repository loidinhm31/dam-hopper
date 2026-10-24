package dev.damhopper.nativeapp.platform.notifications

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import dev.damhopper.nativeapp.MainActivity
import dev.damhopper.nativeapp.core.notifications.AppNotification
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationSink

/**
 * Android implementation of NotificationSink.
 *
 * Enforces:
 * - Redacted generic public version shown on lock-screen (VISIBILITY_PRIVATE).
 * - Exact-target deep linking carrying profileId, generation, terminalId, incarnation.
 * - Profile-scoped notification tracking and automatic cancellation on owner retirement.
 * - Safe handling of runtime notification permissions (POST_NOTIFICATIONS on Android 13+).
 */
class AndroidNotificationSink(
    private val context: Context,
) : NotificationSink {

    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private val activeNotifications = mutableMapOf<String, MutableSet<Int>>()

    init {
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channels = listOf(
                NotificationChannel(
                    NotificationChannelId.TERMINAL_ATTENTION.id,
                    NotificationChannelId.TERMINAL_ATTENTION.channelName,
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Alerts when terminal agents require user interaction"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(
                    NotificationChannelId.TRANSFERS.id,
                    NotificationChannelId.TRANSFERS.channelName,
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Progress notifications for encrypted file uploads and downloads"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(
                    NotificationChannelId.IDLE_SUSPEND.id,
                    NotificationChannelId.IDLE_SUSPEND.channelName,
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Warnings and consent requests for host idle suspend"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
            )
            for (channel in channels) {
                notificationManager.createNotificationChannel(channel)
            }
        }
    }

    override fun areNotificationsEnabled(): Boolean {
        if (!notificationManager.areNotificationsEnabled()) {
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    @SuppressLint("NotificationPermission", "MissingPermission")
    override fun postNotification(notification: AppNotification) {
        if (!areNotificationsEnabled()) {
            return
        }

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_TARGET_PROFILE_ID, notification.target.profileId)
            putExtra(EXTRA_TARGET_GENERATION, notification.target.generation)
            notification.target.serverEpoch?.let { putExtra(EXTRA_TARGET_SERVER_EPOCH, it) }
            notification.target.terminalId?.let { putExtra(EXTRA_TARGET_TERMINAL_ID, it) }
            notification.target.incarnation?.let { putExtra(EXTRA_TARGET_INCARNATION, it) }
            notification.target.attentionRevision?.let { putExtra(EXTRA_TARGET_ATTENTION_REVISION, it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            notification.id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // Public non-sensitive notification for lock screens
        val publicNotification = Notification.Builder(context, notification.channel.id)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(notification.publicTitle)
            .setContentText(notification.publicBody)
            .setAutoCancel(true)
            .build()

        val builder = Notification.Builder(context, notification.channel.id)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicNotification)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

        notificationManager.notify(notification.id, builder.build())

        synchronized(activeNotifications) {
            activeNotifications.getOrPut(notification.target.profileId) { mutableSetOf() }
                .add(notification.id)
        }
    }

    override fun cancelNotification(id: Int) {
        notificationManager.cancel(id)
        synchronized(activeNotifications) {
            for (set in activeNotifications.values) {
                set.remove(id)
            }
        }
    }

    override fun cancelNotificationsForProfile(profileId: String) {
        val ids = synchronized(activeNotifications) {
            activeNotifications.remove(profileId)
        } ?: return

        for (id in ids) {
            notificationManager.cancel(id)
        }
    }

    override fun cancelAll() {
        notificationManager.cancelAll()
        synchronized(activeNotifications) {
            activeNotifications.clear()
        }
    }

    companion object {
        const val EXTRA_TARGET_PROFILE_ID = "dev.damhopper.target_profile_id"
        const val EXTRA_TARGET_GENERATION = "dev.damhopper.target_generation"
        const val EXTRA_TARGET_SERVER_EPOCH = "dev.damhopper.target_server_epoch"
        const val EXTRA_TARGET_TERMINAL_ID = "dev.damhopper.target_terminal_id"
        const val EXTRA_TARGET_INCARNATION = "dev.damhopper.target_incarnation"
        const val EXTRA_TARGET_ATTENTION_REVISION = "dev.damhopper.target_attention_revision"
    }
}
