package dev.damhopper.nativeapp.platform.media

import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Binds a player to a display surface regardless of which one arrives first.
 * Both `onPlayer` and `onSurface` funnel through the single [bind] step, so a surface that
 * is created before the player (or a player created after the surface) never ends up
 * audio-only. Losing the surface detaches the player's display.
 */
internal class PlayerSurfaceBinder<P : Any, S : Any>(
    private val attach: (P, S) -> Unit,
    private val detach: (P) -> Unit,
) {
    private var player: P? = null
    private var surface: S? = null

    @Synchronized
    fun onPlayer(newPlayer: P?) {
        player = newPlayer
        bind()
    }

    /** Clears the player only if [released] is still the bound one (guards against late cleanup). */
    @Synchronized
    fun onPlayerReleased(released: P) {
        if (player === released) player = null
    }

    @Synchronized
    fun onSurface(newSurface: S?) {
        val current = player
        surface = newSurface
        if (newSurface == null && current != null) detach(current) else bind()
    }

    private fun bind() {
        val p = player
        val s = surface
        if (p != null && s != null) attach(p, s)
    }
}

/**
 * Owns the teardown of one [MediaPlayer] instance. [dispose] pauses and releases the local
 * player synchronously and immediately; ticket revocation is dispatched on [cleanupScope]
 * (non-cancellable, bounded by [revokeTimeoutMs]) so network failure or delay can never block
 * or skip the local release. Idempotent.
 */
internal class VideoPlayerCleanup(
    private val pausePlayer: () -> Unit,
    private val releasePlayer: () -> Unit,
    private val revokeTicket: (suspend () -> Unit)?,
    private val cleanupScope: CoroutineScope,
    private val revokeTimeoutMs: Long = 3_000L,
) {
    private var disposed = false

    @Synchronized
    fun dispose() {
        if (disposed) return
        disposed = true
        runCatching { pausePlayer() }
        runCatching { releasePlayer() }
        val revoke = revokeTicket ?: return
        cleanupScope.launch(NonCancellable) {
            withTimeoutOrNull(revokeTimeoutMs) {
                try {
                    revoke()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Best-effort: the server expires unrevoked tickets.
                }
            }
        }
    }
}

/**
 * Native Android video surface rendering ticket-bound video playback using
 * Android MediaPlayer and LeaseMediaDataSource.
 * Zero FAB invariant: controls are hosted inline in the panel.
 *
 * - [tabKey] scopes the player's lifetime: leaving composition (tab closed/switched) pauses and
 *   synchronously releases the player; app `ON_STOP` only pauses.
 * - [reissueLease] is used for at most one fresh-ticket retry after HTTP 401/403/410.
 * - [revokeLease] revokes a ticket in the background via [cleanupScope] after local release.
 */
@Composable
fun AndroidVideoSurface(
    tabKey: String,
    client: AndroidMediaClient,
    lease: MediaLease,
    cleanupScope: CoroutineScope,
    modifier: Modifier = Modifier,
    onDownloadRequested: (() -> Unit)? = null,
    reissueLease: (suspend () -> MediaLease)? = null,
    revokeLease: (suspend (MediaLease) -> Unit)? = null,
) {
    var errorMessage by remember(tabKey, lease.ticket) {
        mutableStateOf(
            if (lease.purpose != MediaPurpose.PLAYBACK) {
                "AndroidVideoSurface requires lease purpose PLAYBACK, got ${lease.purpose}"
            } else null
        )
    }
    var activeLease by remember(tabKey, lease.ticket) { mutableStateOf(lease) }
    var retryUsed by remember(tabKey) { mutableStateOf(false) }
    var resumePositionMs by remember(tabKey) { mutableIntStateOf(0) }

    var mediaPlayer by remember(tabKey) { mutableStateOf<MediaPlayer?>(null) }
    var isPlaying by remember(tabKey) { mutableStateOf(false) }
    var isPrepared by remember(tabKey) { mutableStateOf(false) }
    var currentPositionMs by remember(tabKey) { mutableIntStateOf(0) }
    var durationMs by remember(tabKey) { mutableIntStateOf(0) }
    var videoAspect by remember(tabKey) { mutableStateOf<Float?>(null) }
    var dragPosition by remember(tabKey) { mutableStateOf<Float?>(null) }

    val scope = rememberCoroutineScope()
    val binder = remember(tabKey) {
        PlayerSurfaceBinder<MediaPlayer, SurfaceHolder>(
            attach = { player, holder -> runCatching { player.setDisplay(holder) } },
            detach = { player -> runCatching { player.setDisplay(null) } },
        )
    }
    // Holder of the live player's cleanup so tab disposal, ON_STOP-independent retry and the
    // effect's own finally all tear down through the same idempotent path.
    val currentCleanup = remember(tabKey) { arrayOfNulls<VideoPlayerCleanup>(1) }

    // Position polling while playing
    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            mediaPlayer?.let { player ->
                if (isPrepared && dragPosition == null) {
                    currentPositionMs = runCatching { player.currentPosition }.getOrDefault(currentPositionMs)
                }
            }
            delay(500)
        }
    }

    fun tryRecoverWithFreshTicket(status: Int?, resumeMs: Int): Boolean {
        val reissue = reissueLease
        if (!isTicketExpiryStatus(status) || retryUsed || reissue == null) return false
        retryUsed = true
        resumePositionMs = resumeMs
        scope.launch {
            // Local release (and background revocation of the dead ticket) before the new ticket.
            currentCleanup[0]?.dispose()
            try {
                val fresh = reissue()
                errorMessage = null
                activeLease = fresh
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                errorMessage = "Failed to refresh video ticket: ${e.message}"
            }
        }
        return true
    }

    LaunchedEffect(tabKey, activeLease.ticket) {
        val playerLease = activeLease
        if (playerLease.purpose != MediaPurpose.PLAYBACK) return@LaunchedEffect
        val localPlayer = MediaPlayer()
        val revoker: (suspend () -> Unit)? = revokeLease?.let { revoke ->
            val action: suspend () -> Unit = { revoke(playerLease) }
            action
        }
        var dataSource: LeaseMediaDataSource? = null
        val cleanup = VideoPlayerCleanup(
            pausePlayer = { if (localPlayer.isPlaying) localPlayer.pause() },
            releasePlayer = {
                localPlayer.setOnPreparedListener(null)
                localPlayer.setOnCompletionListener(null)
                localPlayer.setOnErrorListener(null)
                localPlayer.setOnVideoSizeChangedListener(null)
                try {
                    localPlayer.setDisplay(null)
                } catch (_: Exception) {
                }
                localPlayer.release()
                dataSource?.close()
            },
            revokeTicket = revoker,
            cleanupScope = cleanupScope,
        )
        currentCleanup[0] = cleanup
        mediaPlayer = localPlayer
        isPrepared = false
        isPlaying = false
        binder.onPlayer(localPlayer)
        try {
            val ds = client.createMediaDataSource(playerLease)
            dataSource = ds
            localPlayer.setDataSource(ds)
            localPlayer.setOnVideoSizeChangedListener { _, w, h ->
                if (w > 0 && h > 0) videoAspect = w.toFloat() / h.toFloat()
            }
            localPlayer.setOnPreparedListener { mp ->
                isPrepared = true
                durationMs = mp.duration
                if (resumePositionMs > 0) {
                    mp.seekTo(resumePositionMs)
                    currentPositionMs = resumePositionMs
                    resumePositionMs = 0
                }
            }
            localPlayer.setOnCompletionListener {
                isPlaying = false
                currentPositionMs = durationMs
            }
            localPlayer.setOnErrorListener { mp, what, extra ->
                isPlaying = false
                val resumeAt = runCatching { mp.currentPosition }.getOrDefault(currentPositionMs)
                if (!tryRecoverWithFreshTicket(ds.lastFailureStatus, resumeAt)) {
                    errorMessage = "MediaPlayer error: what=$what, extra=$extra"
                }
                true
            }
            localPlayer.prepareAsync()
            awaitCancellation()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            isPlaying = false
            if (!tryRecoverWithFreshTicket(e.mediaHttpStatus(), resumePositionMs)) {
                errorMessage = "Failed to initialize video player: ${e.message}"
            }
        } finally {
            // Synchronous local release regardless of how this effect ends.
            cleanup.dispose()
            binder.onPlayerReleased(localPlayer)
            if (mediaPlayer === localPlayer) {
                mediaPlayer = null
                isPrepared = false
                isPlaying = false
            }
            if (currentCleanup[0] === cleanup) currentCleanup[0] = null
        }
    }

    // Tab disposal (closed or switched away): pause and synchronously release in onDispose.
    DisposableEffect(tabKey) {
        onDispose {
            currentCleanup[0]?.dispose()
            currentCleanup[0] = null
            mediaPlayer = null
            isPlaying = false
            isPrepared = false
        }
    }

    // App backgrounded: pause only, keep the player so playback can be resumed.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, tabKey) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                mediaPlayer?.let { player ->
                    runCatching { if (player.isPlaying) player.pause() }
                }
                isPlaying = false
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (errorMessage != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
            ) {
                Text(
                    text = errorMessage ?: "",
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    style = DamHopperTypography.bodySmall,
                    modifier = Modifier.padding(12.dp)
                )
            }
        }

        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
            contentAlignment = Alignment.Center
        ) {
            val aspect = videoAspect
            AndroidView(
                factory = { context ->
                    SurfaceView(context).apply {
                        holder.addCallback(object : SurfaceHolder.Callback {
                            override fun surfaceCreated(holder: SurfaceHolder) {
                                binder.onSurface(holder)
                            }

                            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

                            override fun surfaceDestroyed(holder: SurfaceHolder) {
                                binder.onSurface(null)
                            }
                        })
                    }
                },
                modifier = if (aspect != null) Modifier.aspectRatio(aspect) else Modifier.fillMaxSize()
            )

            if (!isPrepared && errorMessage == null) {
                CircularProgressIndicator(color = DamHopperColors.Primary)
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Inline Controls (Zero FABs)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Button(
                onClick = {
                    mediaPlayer?.let { player ->
                        if (isPlaying) {
                            player.pause()
                            isPlaying = false
                        } else {
                            player.start()
                            isPlaying = true
                        }
                    }
                },
                enabled = isPrepared,
                colors = ButtonDefaults.buttonColors(containerColor = DamHopperColors.Surface)
            ) {
                Text(
                    text = if (isPlaying) "⏸ Pause" else "▶ Play",
                    color = DamHopperColors.TextPrimary
                )
            }

            Text(
                text = "${formatTime(dragPosition?.toInt() ?: currentPositionMs)} / ${formatTime(durationMs)}",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary
            )

            if (onDownloadRequested != null) {
                OutlinedButton(
                    onClick = onDownloadRequested,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = DamHopperColors.Primary)
                ) {
                    Text("⬇ Save SAF")
                }
            }
        }

        if (durationMs > 0) {
            // Seeking is throttled: dragging only updates the thumb; the player seeks once on release.
            Slider(
                value = dragPosition ?: currentPositionMs.toFloat(),
                onValueChange = { dragPosition = it },
                onValueChangeFinished = {
                    dragPosition?.let { target ->
                        currentPositionMs = target.toInt()
                        mediaPlayer?.seekTo(target.toInt())
                    }
                    dragPosition = null
                },
                valueRange = 0f..durationMs.toFloat(),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

private fun formatTime(ms: Int): String {
    if (ms <= 0) return "00:00"
    val totalSeconds = ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    val padMin = if (minutes < 10) "0$minutes" else "$minutes"
    val padSec = if (seconds < 10) "0$seconds" else "$seconds"
    return "$padMin:$padSec"
}
