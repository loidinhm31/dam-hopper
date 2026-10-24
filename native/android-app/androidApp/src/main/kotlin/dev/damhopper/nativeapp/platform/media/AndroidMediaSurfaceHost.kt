package dev.damhopper.nativeapp.platform.media

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.features.media.MediaPurpose
import dev.damhopper.nativeapp.features.media.NativeMediaSurfaceHost
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope

/**
 * Dependencies the Android media viewers need from the app shell.
 *
 * - [client] must have been constructed with an `activeOwnerSupplier` resolving to [activeOwner].
 * - [activeOwner] returns the currently active connection (null when disconnected).
 * - [bearerToken] returns the current session bearer token (never cached by the viewers).
 * - [cleanupScope] is an application-lifetime scope for non-blocking ticket revocation.
 */
class AndroidMediaSurfaceEnvironment(
    val client: AndroidMediaClient,
    val activeOwner: () -> ConnectionRef?,
    val bearerToken: () -> String,
    val cleanupScope: CoroutineScope,
    val mediaClientId: String = AndroidMediaClient.generateMediaClientId(),
)

/**
 * Android [NativeMediaSurfaceHost]: image tabs render [AndroidImageSurface], video tabs
 * issue a playback ticket and render [AndroidVideoSurface].
 */
fun createAndroidMediaSurfaceHost(environment: AndroidMediaSurfaceEnvironment): NativeMediaSurfaceHost =
    { tab, isImage, modifier, onDownloadClicked ->
        val owner = remember(tab.key) { environment.activeOwner() }
        when {
            owner == null -> MediaMessage("No active connection for media preview.", modifier)
            isImage -> AndroidImageSurface(
                tabKey = tab.key,
                fileName = tab.name,
                target = tab.target,
                path = tab.path,
                client = environment.client,
                mediaClientId = environment.mediaClientId,
                ownerRef = owner,
                bearerToken = environment.bearerToken,
                cleanupScope = environment.cleanupScope,
                modifier = modifier,
                onDownloadRequested = onDownloadClicked,
            )
            else -> AndroidVideoTab(environment, owner, tab.key, tab.target, tab.path, modifier, onDownloadClicked)
        }
    }

@Composable
private fun AndroidVideoTab(
    environment: AndroidMediaSurfaceEnvironment,
    owner: ConnectionRef,
    tabKey: String,
    target: dev.damhopper.nativeapp.core.model.ProjectTargetRef,
    path: String,
    modifier: Modifier,
    onDownloadClicked: (() -> Unit)?,
) {
    var lease by remember(tabKey) { mutableStateOf<MediaLease?>(null) }
    var error by remember(tabKey) { mutableStateOf<String?>(null) }

    suspend fun issuePlaybackLease(): MediaLease = environment.client.issueVideoTicket(
        target = target,
        path = path,
        purpose = MediaPurpose.PLAYBACK,
        mediaClientId = environment.mediaClientId,
        ownerRef = owner,
        bearerToken = environment.bearerToken(),
    )

    LaunchedEffect(tabKey) {
        try {
            lease = issuePlaybackLease()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Failed to start video playback: ${e.message}"
        }
    }

    val current = lease
    when {
        current != null -> AndroidVideoSurface(
            tabKey = tabKey,
            client = environment.client,
            lease = current,
            cleanupScope = environment.cleanupScope,
            modifier = modifier,
            onDownloadRequested = onDownloadClicked,
            reissueLease = { issuePlaybackLease() },
            revokeLease = { stale -> environment.client.revokeVideoTicket(stale, environment.bearerToken()) },
        )
        error != null -> MediaMessage(error ?: "", modifier)
        else -> Box(
            modifier = modifier.fillMaxSize().background(DamHopperColors.Background),
            contentAlignment = Alignment.Center
        ) { CircularProgressIndicator(color = DamHopperColors.Primary) }
    }
}

@Composable
private fun MediaMessage(text: String, modifier: Modifier) {
    Box(
        modifier = modifier.fillMaxSize().background(DamHopperColors.Background).padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text = text, style = DamHopperTypography.bodyMedium, color = MaterialTheme.colorScheme.error)
    }
}
