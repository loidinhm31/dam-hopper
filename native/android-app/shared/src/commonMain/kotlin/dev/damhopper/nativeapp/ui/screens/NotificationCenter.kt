package dev.damhopper.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.core.notifications.NotificationFeedState
import dev.damhopper.nativeapp.core.notifications.NotificationRecord
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

/** Entries mounted in the existing login/project/workspace headers: Settings and the notification bell. */
data class HeaderEntries(
    val unreadNotifications: Int,
    val notificationsOpen: Boolean,
    val onOpenSettings: () -> Unit,
    val onToggleNotifications: () -> Unit,
)

/** Local in-app list filter (the `statusFilter` preference): case-insensitive substring of title or body. */
fun filterNotificationRecords(records: List<NotificationRecord>, statusFilter: String): List<NotificationRecord> {
    val needle = statusFilter.trim()
    if (needle.isEmpty()) return records
    return records.filter { it.title.contains(needle, ignoreCase = true) || it.body.contains(needle, ignoreCase = true) }
}

fun unreadCount(feed: NotificationFeedState): Int = feed.records.count { !it.read }

/** The transient records (at most three, newest first) that are still in the bounded feed. */
fun transientRecords(feed: NotificationFeedState): List<NotificationRecord> {
    val byKey = feed.records.associateBy { it.key }
    return feed.transients.mapNotNull { byKey[it] }
}

/** Inline Settings + bell controls with 48 dp touch targets; no second navigation system. */
@Composable
fun HeaderEntryButtons(entries: HeaderEntries, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Visual separator between page actions and global entries
        Box(
            modifier = Modifier
                .width(1.dp)
                .height(18.dp)
                .background(DamHopperColors.Border.copy(alpha = 0.6f))
        )

        // Alerts button
        val alertsOpen = entries.notificationsOpen
        val hasUnread = entries.unreadNotifications > 0
        val alertsBg = if (alertsOpen) DamHopperColors.Primary.copy(alpha = 0.15f) else DamHopperColors.SurfaceVariant.copy(alpha = 0.7f)
        val alertsBorder = if (alertsOpen) DamHopperColors.Primary else DamHopperColors.Border
        Box(
            modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 36.dp)
                .clip(RoundedCornerShape(6.dp))
                .border(BorderStroke(1.dp, alertsBorder), RoundedCornerShape(6.dp))
                .background(alertsBg)
                .clickable(onClick = entries.onToggleNotifications)
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .semantics {
                    contentDescription = if (hasUnread) "Notifications, ${entries.unreadNotifications} unread" else "Notifications"
                },
            contentAlignment = Alignment.Center,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = "Alerts",
                    color = if (alertsOpen) DamHopperColors.Primary else DamHopperColors.TextPrimary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
                if (hasUnread) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(DamHopperColors.Primary)
                            .padding(horizontal = 5.dp, vertical = 1.dp)
                    ) {
                        Text(
                            text = "${entries.unreadNotifications}",
                            color = DamHopperColors.Background,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // Settings button
        Box(
            modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 36.dp)
                .clip(RoundedCornerShape(6.dp))
                .border(BorderStroke(1.dp, DamHopperColors.Border), RoundedCornerShape(6.dp))
                .background(DamHopperColors.SurfaceVariant.copy(alpha = 0.7f))
                .clickable(onClick = entries.onOpenSettings)
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .semantics { contentDescription = "Settings" },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "Settings",
                color = DamHopperColors.Primary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

/**
 * Inline transient toasts (at most three, dismissible). A tap hands the record to [onOpen], the same authoritative
 * route validator the feed uses; it is never a floating overlay.
 */
@Composable
fun NotificationTransients(
    feed: NotificationFeedState,
    onOpen: (NotificationRecord) -> Unit,
    onDismiss: (key: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val transients = transientRecords(feed)
    if (transients.isEmpty()) return
    Column(modifier = modifier.fillMaxWidth().background(DamHopperColors.Surface), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        transients.forEach { record ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .sizeIn(minHeight = 48.dp)
                    .background(DamHopperColors.SurfaceVariant)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(modifier = Modifier.weight(1f).clickable { onOpen(record) }) {
                    Text(record.title, color = DamHopperColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(record.body, color = DamHopperColors.TextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(
                    modifier = Modifier
                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        .semantics { contentDescription = "Dismiss notification" }
                        .clickable { onDismiss(record.key) },
                    contentAlignment = Alignment.Center,
                ) { Text("Dismiss", color = DamHopperColors.Primary, fontSize = 12.sp) }
            }
        }
    }
}

/**
 * Inline in-app notification feed (bounded to 50 records by the coordinator). Rows are history: reading,
 * mark-all, clear and open all go through the callbacks, and opening never trusts the row's labels - the host
 * validates the exact target before navigating. [routeNotice] is the explicit result of the last refused click.
 */
@Composable
fun NotificationCenter(
    feed: NotificationFeedState,
    statusFilter: String,
    routeNotice: String?,
    onOpen: (NotificationRecord) -> Unit,
    onMarkAllRead: () -> Unit,
    onClear: () -> Unit,
    onDismissNotice: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val visible = filterNotificationRecords(feed.records, statusFilter)
    Column(modifier = modifier.fillMaxWidth().background(DamHopperColors.Surface).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "Notifications (${feed.records.size}/50)",
                color = DamHopperColors.TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            TextAction("Mark all read", enabled = feed.records.any { !it.read }, onClick = onMarkAllRead)
            TextAction("Clear", enabled = feed.records.isNotEmpty(), onClick = onClear)
        }
        routeNotice?.let {
            Row(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(DamHopperColors.SurfaceVariant).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(it, color = DamHopperColors.Warning, fontSize = 12.sp, modifier = Modifier.weight(1f))
                TextAction("OK", enabled = true, onClick = onDismissNotice)
            }
        }
        when {
            feed.records.isEmpty() -> Text(
                text = "No notifications yet. Agent attention appears here when enabled in Settings.",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
            )
            visible.isEmpty() -> Text(
                text = "No notifications match the status filter.",
                color = DamHopperColors.TextSecondary,
                fontSize = 12.sp,
            )
            else -> LazyColumn(modifier = Modifier.heightIn(max = 280.dp)) {
                items(visible, key = { it.key }) { record ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .sizeIn(minHeight = 48.dp)
                            .clickable { onOpen(record) }
                            .padding(vertical = 4.dp),
                    ) {
                        Text(
                            text = if (record.read) record.title else "● ${record.title}",
                            color = DamHopperColors.TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = if (record.read) FontWeight.Normal else FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(record.body, color = DamHopperColors.TextSecondary, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun TextAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) DamHopperColors.Primary else DamHopperColors.TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
