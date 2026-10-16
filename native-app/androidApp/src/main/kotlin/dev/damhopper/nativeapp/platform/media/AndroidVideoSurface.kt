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
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.delay
/**
 * Native Android video surface rendering ticket-bound video playback using
 * Android MediaPlayer and LeaseMediaDataSource.
 * Zero FAB invariant: controls are hosted inline in the panel.
 */
@Composable
fun AndroidVideoSurface(
    client: AndroidMediaClient,
    lease: MediaLease,
    modifier: Modifier = Modifier,
    onDownloadRequested: (() -> Unit)? = null,
) {
    var errorMessage by remember(lease.ticket) {
        mutableStateOf(
            if (lease.purpose != MediaPurpose.PLAYBACK) {
                "AndroidVideoSurface requires lease purpose PLAYBACK, got ${lease.purpose}"
            } else null
        )
    }
    var mediaPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var isPrepared by remember { mutableStateOf(false) }
    var currentPositionMs by remember { mutableIntStateOf(0) }
    var durationMs by remember { mutableIntStateOf(0) }
    // Position polling while playing
    LaunchedEffect(isPlaying) {
        while (isPlaying) {
            mediaPlayer?.let { player ->
                if (isPrepared) {
                    currentPositionMs = player.currentPosition
                }
            }
            delay(500)
        }
    }

    LaunchedEffect(lease.ticket) {
        val player = MediaPlayer()
        mediaPlayer = player

        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val mediaDataSource = client.createMediaDataSource(lease)
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    player.setDataSource(mediaDataSource)
                    player.setOnPreparedListener { mp ->
                        isPrepared = true
                        durationMs = mp.duration
                    }
                    player.setOnCompletionListener {
                        isPlaying = false
                        currentPositionMs = durationMs
                    }
                    player.setOnErrorListener { _, what, extra ->
                        errorMessage = "MediaPlayer error: what=$what, extra=$extra"
                        isPlaying = false
                        true
                    }
                    player.prepareAsync()
                }
            } catch (e: Exception) {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    errorMessage = "Failed to initialize video player: ${e.message}"
                }
            }
        }
    }

    DisposableEffect(lease.ticket) {
        onDispose {
            mediaPlayer?.let { player ->
                try {
                    if (player.isPlaying) {
                        player.stop()
                    }
                    player.reset()
                    player.release()
                } catch (_: Exception) {}
            }
            mediaPlayer = null
            isPlaying = false
            isPrepared = false
        }
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
            AndroidView(
                factory = { context ->
                    SurfaceView(context).apply {
                        holder.addCallback(object : SurfaceHolder.Callback {
                            override fun surfaceCreated(holder: SurfaceHolder) {
                                mediaPlayer?.setDisplay(holder)
                            }

                            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

                            override fun surfaceDestroyed(holder: SurfaceHolder) {
                                mediaPlayer?.setDisplay(null)
                            }
                        })
                    }
                },
                modifier = Modifier.fillMaxSize()
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
                text = "${formatTime(currentPositionMs)} / ${formatTime(durationMs)}",
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
            Slider(
                value = currentPositionMs.toFloat(),
                onValueChange = { newPos ->
                    currentPositionMs = newPos.toInt()
                    mediaPlayer?.seekTo(newPos.toInt())
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
