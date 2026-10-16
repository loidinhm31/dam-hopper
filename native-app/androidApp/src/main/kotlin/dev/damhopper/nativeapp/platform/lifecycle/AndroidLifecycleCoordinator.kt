package dev.damhopper.nativeapp.platform.lifecycle

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator

/**
 * Bridges Android Activity / Process lifecycle callbacks to the shared [LifecycleCoordinator].
 */
class AndroidLifecycleCoordinator(
    val coordinator: LifecycleCoordinator = LifecycleCoordinator(),
) : DefaultLifecycleObserver {

    override fun onStart(owner: LifecycleOwner) {
        coordinator.onAppForeground()
    }

    override fun onStop(owner: LifecycleOwner) {
        coordinator.onAppBackground()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        coordinator.onDestroy()
    }
}
