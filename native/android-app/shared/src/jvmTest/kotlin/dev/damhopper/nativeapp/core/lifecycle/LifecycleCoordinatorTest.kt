package dev.damhopper.nativeapp.core.lifecycle

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LifecycleCoordinatorTest {

    private class TestListener : LifecycleAware {
        var foregroundCalls = 0
        var backgroundCalls = 0
        var retiredProfile: String? = null
        var destroyed = false

        override fun onForeground() {
            foregroundCalls++
        }

        override fun onBackground() {
            backgroundCalls++
        }

        override fun onOwnerRetired(profileId: String) {
            retiredProfile = profileId
        }

        override fun onDestroy() {
            destroyed = true
        }
    }

    @Test
    fun testLifecycleTransitionsAndListenerCallbacks() {
        val coordinator = LifecycleCoordinator()
        val listener = TestListener()
        coordinator.register(listener)

        assertEquals(LifecycleState.INITIALIZED, coordinator.state.value)
        assertEquals(0, listener.foregroundCalls)

        // App foreground
        coordinator.onAppForeground()
        assertEquals(LifecycleState.FOREGROUND, coordinator.state.value)
        assertEquals(1, listener.foregroundCalls)

        // Repeat foreground should be no-op
        coordinator.onAppForeground()
        assertEquals(1, listener.foregroundCalls)

        // App background
        coordinator.onAppBackground()
        assertEquals(LifecycleState.BACKGROUND, coordinator.state.value)
        assertEquals(1, listener.backgroundCalls)

        // Resume to foreground
        coordinator.onAppForeground()
        assertEquals(2, listener.foregroundCalls)

        // Profile retired
        coordinator.onProfileRetired("profile-target-1")
        assertEquals("profile-target-1", listener.retiredProfile)

        // Destroy
        coordinator.onDestroy()
        assertEquals(LifecycleState.DESTROYED, coordinator.state.value)
        assertTrue(listener.destroyed)
    }

    @Test
    fun testUnregisterListener() {
        val coordinator = LifecycleCoordinator()
        val listener = TestListener()
        coordinator.register(listener)
        coordinator.unregister(listener)

        coordinator.onAppForeground()
        assertEquals(0, listener.foregroundCalls)
    }

    @Test
    fun testFaultTolerantListenerDispatch() {
        val coordinator = LifecycleCoordinator()
        val badListener = object : LifecycleAware {
            override fun onForeground() = throw RuntimeException("Listener fault")
            override fun onBackground() {}
            override fun onOwnerRetired(profileId: String) {}
            override fun onDestroy() {}
        }
        val goodListener = TestListener()

        coordinator.register(badListener)
        coordinator.register(goodListener)

        coordinator.onAppForeground()
        assertEquals(1, goodListener.foregroundCalls)
    }
}
