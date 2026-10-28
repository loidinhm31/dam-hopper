package dev.damhopper.nativeapp.platform.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Monitors default network route changes using Android's ConnectivityManager.
 *
 * Uses application context to prevent Activity leaks.
 * Filters out duplicate network available/lost callbacks.
 */
class AndroidNetworkMonitor(
    context: Context,
    private val onNetworkAvailable: () -> Unit,
    private val onNetworkLost: () -> Unit,
) : AutoCloseable {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    private var activeNetworkId: Long? = null
    private val isClosed = AtomicBoolean(false)
    private val lock = Any()

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            val netId = network.networkHandle
            synchronized(lock) {
                if (isClosed.get()) return
                if (activeNetworkId == netId) return
                activeNetworkId = netId
            }
            onNetworkAvailable()
        }

        override fun onLost(network: Network) {
            val netId = network.networkHandle
            val wasActive = synchronized(lock) {
                if (isClosed.get()) return
                if (activeNetworkId == netId) {
                    activeNetworkId = null
                    true
                } else {
                    false
                }
            }
            if (wasActive) {
                onNetworkLost()
            }
        }
    }

    init {
        register()
    }

    private fun register() {
        val cm = connectivityManager ?: return
        try {
            // Initial network state inspection
            val activeNet = cm.activeNetwork
            synchronized(lock) {
                activeNetworkId = activeNet?.networkHandle
            }
            cm.registerDefaultNetworkCallback(networkCallback)
        } catch (_: Throwable) {
            // Best effort registration (e.g. security permissions)
        }
    }

    override fun close() {
        if (!isClosed.compareAndSet(false, true)) return
        val cm = connectivityManager ?: return
        try {
            cm.unregisterNetworkCallback(networkCallback)
        } catch (_: Throwable) {}
    }
}
