package dev.damhopper.nativeapp.core.lifecycle

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class LifecycleState {
    INITIALIZED,
    FOREGROUND,
    BACKGROUND,
    DESTROYED,
}

/**
 * Interface implemented by feature coordinators and subscriptions that must
 * adapt to app backgrounding, foreground resumption, or owner retirement.
 */
interface LifecycleAware {
    fun onForeground()
    fun onBackground()
    fun onOwnerRetired(profileId: String)
    fun onDestroy()
}

/**
 * Platform-independent lifecycle coordinator.
 *
 * Invariants:
 * - Distinguishes temporary background pausing from destructive profile logout/retirement.
 * - On background: pauses demand-driven streaming (SSE, usage polling, file tree watches)
 *   without destroying remote PTY sessions.
 * - On resume: re-evaluates visible demand without duplicating subscriptions or replaying queued input.
 * - On owner retirement: tears down profile-specific streams, leases, notifications, and cached state.
 */
class LifecycleCoordinator {
    private val _state = MutableStateFlow(LifecycleState.INITIALIZED)
    val state: StateFlow<LifecycleState> = _state.asStateFlow()

    private val listeners = mutableSetOf<LifecycleAware>()

    fun register(listener: LifecycleAware) {
        synchronized(listeners) {
            listeners.add(listener)
            if (_state.value == LifecycleState.FOREGROUND) {
                listener.onForeground()
            }
        }
    }

    fun unregister(listener: LifecycleAware) {
        synchronized(listeners) {
            listeners.remove(listener)
        }
    }

    fun onAppForeground() {
        if (_state.value == LifecycleState.FOREGROUND) return
        _state.value = LifecycleState.FOREGROUND

        val currentListeners = synchronized(listeners) { listeners.toList() }
        for (listener in currentListeners) {
            try {
                listener.onForeground()
            } catch (_: Throwable) {
                // Prevent one failing listener from blocking other restorations
            }
        }
    }

    fun onAppBackground() {
        if (_state.value == LifecycleState.BACKGROUND) return
        _state.value = LifecycleState.BACKGROUND

        val currentListeners = synchronized(listeners) { listeners.toList() }
        for (listener in currentListeners) {
            try {
                listener.onBackground()
            } catch (_: Throwable) {
                // Prevent failure during background dispatch
            }
        }
    }

    fun onProfileRetired(profileId: String) {
        val currentListeners = synchronized(listeners) { listeners.toList() }
        for (listener in currentListeners) {
            try {
                listener.onOwnerRetired(profileId)
            } catch (_: Throwable) {
                // Continue cleaning up remaining listeners
            }
        }
    }

    fun onDestroy() {
        _state.value = LifecycleState.DESTROYED
        val currentListeners = synchronized(listeners) { listeners.toList() }
        for (listener in currentListeners) {
            try {
                listener.onDestroy()
            } catch (_: Throwable) {
                // Teardown
            }
        }
        synchronized(listeners) {
            listeners.clear()
        }
    }
}
