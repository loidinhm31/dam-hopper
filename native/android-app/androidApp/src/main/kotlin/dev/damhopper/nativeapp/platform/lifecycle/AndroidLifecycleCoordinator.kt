package dev.damhopper.nativeapp.platform.lifecycle

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import dev.damhopper.nativeapp.core.lifecycle.LifecycleCoordinator

/**
 * Bridges Android Activity / Process lifecycle callbacks to the shared [LifecycleCoordinator].
 *
 * Invariants:
 * 1. Forwards foreground and background transitions to the application coordinator.
 * 2. Activity destruction only detaches view adapters/widgets/launchers via [onDetach]; it never
 *    triggers runtime teardown or destroys retained document/workspace stores.
 * 3. Final runtime destruction is owned exclusively by ViewModel.onCleared.
 * 4. [onResumed] runs on every resume so OS-owned state (notification permission, app/channel blocks changed in
 *    system settings) is re-read; it only reads, it never prompts.
 */
class AndroidLifecycleCoordinator(
    val coordinator: LifecycleCoordinator = LifecycleCoordinator(),
    private val onDetach: (() -> Unit)? = null,
    private val onResumed: (() -> Unit)? = null,
) : DefaultLifecycleObserver {

    override fun onStart(owner: LifecycleOwner) {
        coordinator.onAppForeground()
    }

    override fun onResume(owner: LifecycleOwner) {
        onResumed?.invoke()
    }

    override fun onStop(owner: LifecycleOwner) {
        coordinator.onAppBackground()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        onDetach?.invoke()
    }
}
