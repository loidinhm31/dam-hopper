package dev.damhopper.nativeapp.platform.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import dev.damhopper.nativeapp.core.notifications.NotificationChannelId
import dev.damhopper.nativeapp.core.notifications.NotificationChannelStatus
import dev.damhopper.nativeapp.core.notifications.NotificationPermissionState
import dev.damhopper.nativeapp.core.notifications.NotificationPlatformPort
import dev.damhopper.nativeapp.core.notifications.NotificationPlatformStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The three stable notification channels, created idempotently by both the sink and the platform adapter.
 * Channel importance/sound is user-controlled after creation: this never edits an existing channel, and no
 * channel is created per policy/pattern/volume setting.
 */
internal object AndroidNotificationChannels {
    fun ensure(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
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
        for (channel in channels) manager.createNotificationChannel(channel)
    }
}

/**
 * Android implementation of [NotificationPlatformPort]: observed permission, app-level and per-channel
 * state, plus explicit user-initiated request / open-settings actions.
 *
 * - Holds only the Application context. The permission launcher (an Activity result API) and an optional
 *   settings opener are supplied by the retained integration through [bindLaunchers] and dropped with
 *   [unbindLaunchers]; no Activity is ever captured here or by Settings.
 * - API 29-32: no runtime permission ([NotificationPermissionState.NOT_REQUIRED]). API 33+: the system
 *   dialog is only launched from [requestPermission] (an explicit button); an event never prompts, and a
 *   denial/dismissal is only recorded, never retried automatically and never revokes in-app policy.
 * - [refreshStatus] re-reads the OS (call on resume, after settings, after the permission result).
 */
class AndroidNotificationPlatform(context: Context) : NotificationPlatformPort {

    private val appContext: Context = context.applicationContext
    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Volatile private var permissionRequester: (() -> Unit)? = null
    @Volatile private var settingsOpener: ((Intent) -> Unit)? = null

    init {
        AndroidNotificationChannels.ensure(appContext)
    }

    private val _status = MutableStateFlow(readStatus())
    override val status: StateFlow<NotificationPlatformStatus> = _status.asStateFlow()

    /**
     * Binds the Activity-owned launchers. [requestPermission] must start the POST_NOTIFICATIONS system
     * request and report its result through [onPermissionResult]; [openSettings] may start a Settings
     * intent from the Activity (defaults to the Application context with NEW_TASK).
     */
    fun bindLaunchers(requestPermission: (() -> Unit)?, openSettings: ((Intent) -> Unit)? = null) {
        permissionRequester = requestPermission
        settingsOpener = openSettings
    }

    /** Drops every Activity-bound callback (call from onDestroy so no Activity is retained). */
    fun unbindLaunchers() {
        permissionRequester = null
        settingsOpener = null
    }

    /** Result of the system permission request (granted, denied or dismissed). Records that it was asked. */
    fun onPermissionResult(@Suppress("UNUSED_PARAMETER") granted: Boolean) {
        preferences.edit().putBoolean(KEY_PERMISSION_REQUESTED, true).apply()
        refreshStatus()
    }

    override fun requestPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || isPermissionGranted()) {
            refreshStatus()
            return
        }
        val requester = permissionRequester
        if (requester != null) {
            preferences.edit().putBoolean(KEY_PERMISSION_REQUESTED, true).apply()
            requester()
        } else {
            // No Activity bound: the only honest action is the system notification settings screen.
            openAppNotificationSettings()
        }
        refreshStatus()
    }

    override fun openChannelSettings(channel: NotificationChannelId) {
        val channelIntent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, appContext.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, channel.id)
        if (!launch(channelIntent)) openAppNotificationSettings()
    }

    override fun refreshStatus() {
        _status.value = readStatus()
    }

    private fun openAppNotificationSettings() {
        val appIntent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, appContext.packageName)
        if (launch(appIntent)) return
        launch(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(android.net.Uri.fromParts("package", appContext.packageName, null)),
        )
    }

    private fun launch(intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val opener = settingsOpener
        if (opener != null) opener(intent) else appContext.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }

    private fun isPermissionGranted(): Boolean =
        appContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun permissionState(): NotificationPermissionState = when {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> NotificationPermissionState.NOT_REQUIRED
        isPermissionGranted() -> NotificationPermissionState.GRANTED
        preferences.getBoolean(KEY_PERMISSION_REQUESTED, false) -> NotificationPermissionState.DENIED
        else -> NotificationPermissionState.NOT_REQUESTED
    }

    private fun readStatus(): NotificationPlatformStatus {
        val permission = permissionState()
        // With the runtime permission missing the OS reports "disabled" too; that is the permission state,
        // not an additional app-level block the user must fix separately.
        val appBlocked = when (permission) {
            NotificationPermissionState.NOT_REQUIRED, NotificationPermissionState.GRANTED ->
                !notificationManager.areNotificationsEnabled()
            NotificationPermissionState.NOT_REQUESTED, NotificationPermissionState.DENIED -> false
        }
        val channels = NotificationChannelId.entries.associateWith { id ->
            val channel = notificationManager.getNotificationChannel(id.id)
            if (channel == null) {
                NotificationChannelStatus(blocked = false, soundConfigured = false)
            } else {
                NotificationChannelStatus(
                    blocked = channel.importance == NotificationManager.IMPORTANCE_NONE,
                    soundConfigured = channel.sound != null && channel.importance >= NotificationManager.IMPORTANCE_DEFAULT,
                )
            }
        }
        return NotificationPlatformStatus(permission, appBlocked, channels)
    }

    private companion object {
        const val PREFS_NAME = "dam_hopper_notification_platform"
        const val KEY_PERMISSION_REQUESTED = "post_notifications_requested"
    }
}
