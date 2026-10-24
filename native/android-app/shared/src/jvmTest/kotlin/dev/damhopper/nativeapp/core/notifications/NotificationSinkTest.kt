package dev.damhopper.nativeapp.core.notifications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NotificationSinkTest {

    @Test
    fun testNotificationChannels() {
        assertEquals("channel_terminal_attention", NotificationChannelId.TERMINAL_ATTENTION.id)
        assertEquals("channel_transfers", NotificationChannelId.TRANSFERS.id)
        assertEquals("channel_idle_suspend", NotificationChannelId.IDLE_SUSPEND.id)
    }

    @Test
    fun testNotificationPostingAndPublicRedaction() {
        val sink = InMemoryNotificationSink()
        val target = NotificationTarget(
            profileId = "profile-1",
            generation = 2L,
            serverEpoch = 100L,
            terminalId = "term-42",
            incarnation = 3L,
            attentionRevision = 5L,
        )

        val notification = AppNotification(
            id = 1001,
            channel = NotificationChannelId.TERMINAL_ATTENTION,
            target = target,
            title = "Agent OMP needs attention",
            body = "Approve tool call: git push origin main",
            publicTitle = "DamHopper",
            publicBody = "Attention required",
        )

        sink.postNotification(notification)

        val active = sink.getActiveNotifications()
        assertEquals(1, active.size)
        val posted = active.first()
        assertEquals(1001, posted.id)
        assertEquals("DamHopper", posted.publicTitle)
        assertEquals("Attention required", posted.publicBody)
        assertEquals("profile-1", posted.target.profileId)
        assertEquals(2L, posted.target.generation)
        assertEquals("term-42", posted.target.terminalId)
        assertEquals(3L, posted.target.incarnation)
    }

    @Test
    fun testCancelNotificationsForProfileOnRetirement() {
        val sink = InMemoryNotificationSink()
        val target1 = NotificationTarget("profile-A", 1L)
        val target2 = NotificationTarget("profile-B", 1L)

        sink.postNotification(
            AppNotification(
                id = 1,
                channel = NotificationChannelId.TERMINAL_ATTENTION,
                target = target1,
                title = "Alert A1",
                body = "Body A1",
            )
        )
        sink.postNotification(
            AppNotification(
                id = 2,
                channel = NotificationChannelId.TRANSFERS,
                target = target1,
                title = "Alert A2",
                body = "Body A2",
            )
        )
        sink.postNotification(
            AppNotification(
                id = 3,
                channel = NotificationChannelId.IDLE_SUSPEND,
                target = target2,
                title = "Alert B1",
                body = "Body B1",
            )
        )

        assertEquals(3, sink.getActiveNotifications().size)

        // Retire profile A
        sink.cancelNotificationsForProfile("profile-A")

        val remaining = sink.getActiveNotifications()
        assertEquals(1, remaining.size)
        assertEquals(3, remaining.first().id)
        assertEquals("profile-B", remaining.first().target.profileId)
    }
}
