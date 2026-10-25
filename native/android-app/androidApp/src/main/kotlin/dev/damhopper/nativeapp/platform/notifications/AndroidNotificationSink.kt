package dev.damhopper.nativeapp.platform.notifications

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import dev.damhopper.nativeapp.MainActivity
import dev.damhopper.nativeapp.core.notifications.AppNotification
import dev.damhopper.nativeapp.core.notifications.NotificationKey
import dev.damhopper.nativeapp.core.notifications.NotificationSink
import dev.damhopper.nativeapp.core.notifications.NotificationTarget

/** Decoded click payload: the canonical [key] and its exact [target]. Validation/navigation is integration-owned. */
class NotificationClick(val key: String, val target: NotificationTarget)

/**
 * Android implementation of NotificationSink.
 *
 * - **Identity:** the String [AppNotification.key] is the history key, the OS tag (`notify(key, 0, ...)`) and
 *   the unique `Intent.data` path (`damhopper://notification/<key>`), so two notifications never share a
 *   tag, a PendingIntent or a cancel (no Int hash identity, equal terminal ids in different profiles or
 *   incarnations stay distinct).
 * - **PendingIntent:** explicit MainActivity intent, requestCode 0, `FLAG_IMMUTABLE | FLAG_UPDATE_CURRENT`;
 *   the unique data URI is what distinguishes requests. Private extras carry the authoritative destination
 *   (profile, generation, epoch, terminal, incarnation, attention revision, process, endpoint, account,
 *   project, worktree, agent session/kind); a cold click must still be validated by the integration.
 * - **Silence:** `silent` uses NotificationCompat `setSilent(true)` on the existing channel: channel
 *   sound/importance is user-controlled and never changed here. Non-silent leaves the channel as is.
 * - **Privacy:** VISIBILITY_PRIVATE with a generic public version; the public text never carries the title,
 *   body, command, path or terminal data.
 * - **Failures:** a permission race / SecurityException after the precheck is a failed OS post, never a
 *   crash; the caller's history is independent of it.
 * - Only the Application context is held.
 */
class AndroidNotificationSink(context: Context) : NotificationSink {

    private val appContext: Context = context.applicationContext
    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        AndroidNotificationChannels.ensure(appContext)
    }

    override fun areNotificationsEnabled(): Boolean {
        if (!notificationManager.areNotificationsEnabled()) {
            return false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return appContext.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    @SuppressLint("NotificationPermission", "MissingPermission")
    override fun postNotification(notification: AppNotification): Boolean {
        if (!areNotificationsEnabled()) return false
        return try {
            notificationManager.notify(notification.key, NOTIFICATION_ID, buildNotification(notification))
            true
        } catch (_: RuntimeException) {
            // Permission revoked between the precheck and notify (SecurityException) or a transient binder
            // failure: this OS post failed (reported as false); admitted history is untouched, nothing crashes.
            false
        }
    }

    override fun cancelNotification(key: String) {
        notificationManager.cancel(key, NOTIFICATION_ID)
    }

    override fun cancelNotificationsForProfile(profileId: String) {
        // The profile id travels in each notification's own extras, so this is exact by profile even
        // after a process restart, and never touches another profile's entries.
        for (active in notificationManager.activeNotifications) {
            if (active.packageName == appContext.packageName &&
                active.notification.extras.getString(EXTRA_NOTIFICATION_PROFILE_ID) == profileId
            ) {
                notificationManager.cancel(active.tag, active.id)
            }
        }
    }

    override fun cancelAll() {
        notificationManager.cancelAll()
    }

    /** Builds the OS notification for [notification] (exposed for instrumentation of the exact presentation). */
    internal fun buildNotification(notification: AppNotification): Notification {
        val pendingIntent = PendingIntent.getActivity(
            appContext,
            REQUEST_CODE,
            contentIntent(notification),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // Generic public version: lock-screen safe, never any private text.
        val publicVersion = NotificationCompat.Builder(appContext, notification.channel.id)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(notification.publicTitle)
            .setContentText(notification.publicBody)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .build()

        val extras = Bundle().apply {
            putString(EXTRA_NOTIFICATION_KEY, notification.key)
            putString(EXTRA_NOTIFICATION_PROFILE_ID, notification.target.profileId)
            putLong(EXTRA_NOTIFICATION_GENERATION, notification.target.generation)
        }
        return NotificationCompat.Builder(appContext, notification.channel.id)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setSilent(notification.silent)
            .addExtras(extras)
            .build()
    }

    /** The explicit click intent: unique canonical data URI plus the private exact-target extras. */
    internal fun contentIntent(notification: AppNotification): Intent {
        val target = notification.target
        return Intent(appContext, MainActivity::class.java).apply {
            action = ACTION_OPEN_NOTIFICATION
            data = dataUriFor(notification.key)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_KEY, notification.key)
            putExtra(EXTRA_TARGET_PROFILE_ID, target.profileId)
            putExtra(EXTRA_TARGET_GENERATION, target.generation)
            target.serverEpoch?.let { putExtra(EXTRA_TARGET_SERVER_EPOCH, it) }
            target.terminalId?.let { putExtra(EXTRA_TARGET_TERMINAL_ID, it) }
            target.incarnation?.let { putExtra(EXTRA_TARGET_INCARNATION, it) }
            target.attentionRevision?.let { putExtra(EXTRA_TARGET_ATTENTION_REVISION, it) }
            target.processInstanceId?.let { putExtra(EXTRA_TARGET_PROCESS_INSTANCE_ID, it) }
            target.endpoint?.let { putExtra(EXTRA_TARGET_ENDPOINT, it) }
            target.accountId?.let { putExtra(EXTRA_TARGET_ACCOUNT_ID, it) }
            target.project?.let { putExtra(EXTRA_TARGET_PROJECT, it) }
            target.worktreePath?.let { putExtra(EXTRA_TARGET_WORKTREE_PATH, it) }
            target.agentSessionId?.let { putExtra(EXTRA_TARGET_AGENT_SESSION_ID, it) }
            target.agentKind?.let { putExtra(EXTRA_TARGET_AGENT_KIND, it) }
        }
    }

    companion object {
        const val NOTIFICATION_ID = 0
        const val REQUEST_CODE = 0
        const val ACTION_OPEN_NOTIFICATION = "dev.damhopper.action.OPEN_NOTIFICATION"
        const val DATA_SCHEME = "damhopper"
        const val DATA_AUTHORITY = "notification"

        const val EXTRA_NOTIFICATION_KEY = "dev.damhopper.notification_key"
        const val EXTRA_TARGET_PROFILE_ID = "dev.damhopper.target_profile_id"
        const val EXTRA_TARGET_GENERATION = "dev.damhopper.target_generation"
        const val EXTRA_TARGET_SERVER_EPOCH = "dev.damhopper.target_server_epoch"
        const val EXTRA_TARGET_TERMINAL_ID = "dev.damhopper.target_terminal_id"
        const val EXTRA_TARGET_INCARNATION = "dev.damhopper.target_incarnation"
        const val EXTRA_TARGET_ATTENTION_REVISION = "dev.damhopper.target_attention_revision"
        const val EXTRA_TARGET_PROCESS_INSTANCE_ID = "dev.damhopper.target_process_instance_id"
        const val EXTRA_TARGET_ENDPOINT = "dev.damhopper.target_endpoint"
        const val EXTRA_TARGET_ACCOUNT_ID = "dev.damhopper.target_account_id"
        const val EXTRA_TARGET_PROJECT = "dev.damhopper.target_project"
        const val EXTRA_TARGET_WORKTREE_PATH = "dev.damhopper.target_worktree_path"
        const val EXTRA_TARGET_AGENT_SESSION_ID = "dev.damhopper.target_agent_session_id"
        const val EXTRA_TARGET_AGENT_KIND = "dev.damhopper.target_agent_kind"

        /** Keys placed in the posted notification's own extras so profile cancellation survives a process restart. */
        const val EXTRA_NOTIFICATION_PROFILE_ID = "dev.damhopper.notification_profile_id"
        const val EXTRA_NOTIFICATION_GENERATION = "dev.damhopper.notification_generation"

        /** `damhopper://notification/<key>`: the key is URI-safe for canonical keys; others are percent-encoded. */
        fun dataUriFor(key: String): Uri =
            Uri.Builder().scheme(DATA_SCHEME).authority(DATA_AUTHORITY).appendPath(key).build()

        /**
         * Decodes a click Intent into its key and exact [NotificationTarget] using only checked safe integers
         * and required canonical fields; returns null for anything missing, out of range, wrong action/data or
         * (for canonical keys) inconsistent with the key tuple. This is decoding only: process-id, owner,
         * epoch/incarnation and terminal existence validation, consumption and navigation are integration-owned,
         * and a cold process must never trust a stale generation.
         */
        fun decodeClick(intent: Intent?): NotificationClick? {
            if (intent == null || intent.action != ACTION_OPEN_NOTIFICATION) return null
            val key = intent.getStringExtra(EXTRA_NOTIFICATION_KEY)?.takeIf { it.isNotBlank() } ?: return null
            val uri = intent.data ?: return null
            if (uri.scheme != DATA_SCHEME || uri.authority != DATA_AUTHORITY || uri.lastPathSegment != key) return null

            val profileId = intent.getStringExtra(EXTRA_TARGET_PROFILE_ID)?.takeIf { it.isNotBlank() } ?: return null
            if (!intent.hasExtra(EXTRA_TARGET_GENERATION)) return null
            fun optionalLong(name: String): Long? = if (intent.hasExtra(name)) intent.getLongExtra(name, -1L) else null
            val target = try {
                NotificationTarget(
                    profileId = profileId,
                    generation = intent.getLongExtra(EXTRA_TARGET_GENERATION, -1L),
                    serverEpoch = optionalLong(EXTRA_TARGET_SERVER_EPOCH),
                    terminalId = intent.getStringExtra(EXTRA_TARGET_TERMINAL_ID),
                    incarnation = optionalLong(EXTRA_TARGET_INCARNATION),
                    attentionRevision = optionalLong(EXTRA_TARGET_ATTENTION_REVISION),
                    processInstanceId = intent.getStringExtra(EXTRA_TARGET_PROCESS_INSTANCE_ID),
                    endpoint = intent.getStringExtra(EXTRA_TARGET_ENDPOINT),
                    accountId = intent.getStringExtra(EXTRA_TARGET_ACCOUNT_ID),
                    project = intent.getStringExtra(EXTRA_TARGET_PROJECT),
                    worktreePath = intent.getStringExtra(EXTRA_TARGET_WORKTREE_PATH),
                    agentSessionId = intent.getStringExtra(EXTRA_TARGET_AGENT_SESSION_ID),
                    agentKind = intent.getStringExtra(EXTRA_TARGET_AGENT_KIND),
                )
            } catch (_: IllegalArgumentException) {
                return null
            }
            val fields = NotificationKey.fields(key)
            if (fields != null) {
                val consistent = fields[0] == target.processInstanceId &&
                    fields[1] == target.profileId &&
                    fields[2] == target.generation.toString() &&
                    fields[3] == target.serverEpoch?.toString() &&
                    fields[4] == target.terminalId &&
                    fields[5] == target.incarnation?.toString() &&
                    fields[6] == target.agentSessionId &&
                    fields[7] == target.agentKind &&
                    fields[8] == target.attentionRevision?.toString()
                if (!consistent) return null
            } else {
                // A caller-chosen (non-canonical) key is only valid for generic non-terminal targets
                // (transfer/idle); a terminal/semantic target must carry its canonical key tuple.
                val semantic = target.serverEpoch != null || target.terminalId != null || target.incarnation != null ||
                    target.attentionRevision != null || target.processInstanceId != null || target.agentSessionId != null ||
                    target.agentKind != null
                if (semantic) return null
            }
            return NotificationClick(key, target)
        }
    }
}
