package dev.damhopper.nativeapp.platform.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.core.model.ProjectTargetRef
import dev.damhopper.nativeapp.features.editor.FileTierPolicy
import dev.damhopper.nativeapp.features.media.MediaLease
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import dev.damhopper.nativeapp.ui.theme.DamHopperTypography
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.max
import kotlin.math.min

/** Pure decode-budget and pan/zoom geometry helpers (JVM-testable, no Android types). */
internal object ImageViewerMath {
    const val MAX_PIXELS: Long = 50_000_000L
    const val MAX_DECODE_DIMENSION: Int = 4096
    const val MIN_SCALE: Float = 1f
    const val MAX_SCALE: Float = 8f
    const val ZOOM_STEP: Float = 1.5f

    fun exceedsPixelLimit(width: Int, height: Int): Boolean =
        width.toLong() * height.toLong() > MAX_PIXELS

    /** Smallest power-of-two sample size bringing the longest edge to <= [MAX_DECODE_DIMENSION]. */
    fun inSampleSizeFor(width: Int, height: Int): Int {
        var sample = 1
        var longest = max(width, height)
        while (longest > MAX_DECODE_DIMENSION) {
            sample *= 2
            longest = (longest + 1) / 2
        }
        return sample
    }

    fun clampScale(scale: Float): Float = scale.coerceIn(MIN_SCALE, MAX_SCALE)

    /** Size of the image after ContentScale.Fit inside the container (unscaled). */
    fun fittedSize(containerW: Float, containerH: Float, imageW: Float, imageH: Float): Pair<Float, Float> {
        if (containerW <= 0f || containerH <= 0f || imageW <= 0f || imageH <= 0f) return 0f to 0f
        val fit = min(containerW / imageW, containerH / imageH)
        return imageW * fit to imageH * fit
    }

    /** Clamps [offset] so the scaled, fitted image never exposes more than its own bounds. */
    fun clampOffset(
        offset: Offset,
        scale: Float,
        containerW: Float,
        containerH: Float,
        imageW: Float,
        imageH: Float,
    ): Offset {
        val (fitW, fitH) = fittedSize(containerW, containerH, imageW, imageH)
        val maxX = max(0f, (fitW * scale - containerW) / 2f)
        val maxY = max(0f, (fitH * scale - containerH) / 2f)
        // `+ 0f` normalises -0.0f (from a zero-width clamp range) to 0.0f.
        return Offset(offset.x.coerceIn(-maxX, maxX) + 0f, offset.y.coerceIn(-maxY, maxY) + 0f)
    }
}

/** Result of an image load/decode attempt. */
internal sealed interface ImageLoadState {
    data object Loading : ImageLoadState
    class Ready(val bitmap: Bitmap) : ImageLoadState
    class Unsupported(val reason: String) : ImageLoadState
    class Failed(val message: String) : ImageLoadState
}

/** Bounds-first decode: enforces the 50 MP limit before allocating and downsamples above 4096 px. */
internal fun decodeImageBounded(bytes: ByteArray): ImageLoadState {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) return ImageLoadState.Unsupported("This image format cannot be decoded natively.")
    if (ImageViewerMath.exceedsPixelLimit(w, h)) {
        return ImageLoadState.Unsupported("Image is ${w}x$h px, exceeding the 50 megapixel preview limit.")
    }
    val options = BitmapFactory.Options().apply { inSampleSize = ImageViewerMath.inSampleSizeFor(w, h) }
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?: return ImageLoadState.Unsupported("This image format cannot be decoded natively.")
    return ImageLoadState.Ready(bitmap)
}

/**
 * Native image viewer: issues an image ticket, streams the bytes under a 32 MiB cap, decodes
 * with bounded memory and presents pinch-zoom / pan (clamped to the fitted image) plus inline
 * `+`, `-`, `Reset` controls. SVG and undecodable formats show a friendly fallback card.
 * The ticket is revoked in [cleanupScope] as soon as loading ends or the tab is disposed.
 */
@Composable
@OptIn(ExperimentalFoundationApi::class)
fun AndroidImageSurface(
    tabKey: String,
    fileName: String,
    target: ProjectTargetRef,
    path: String,
    client: AndroidMediaClient,
    mediaClientId: String,
    ownerRef: ConnectionRef,
    bearerToken: () -> String,
    cleanupScope: CoroutineScope,
    modifier: Modifier = Modifier,
    onDownloadRequested: (() -> Unit)? = null,
) {
    var loadState by remember(tabKey) { mutableStateOf<ImageLoadState>(ImageLoadState.Loading) }
    var scale by remember(tabKey) { mutableFloatStateOf(1f) }
    var offset by remember(tabKey) { mutableStateOf(Offset.Zero) }
    var containerSize by remember(tabKey) { mutableStateOf(IntSize.Zero) }

    LaunchedEffect(tabKey) {
        loadState = ImageLoadState.Loading
        if (FileTierPolicy.fileExtension(fileName) == "svg") {
            loadState = ImageLoadState.Unsupported("SVG images are not rendered natively. Use the download action to open them elsewhere.")
            return@LaunchedEffect
        }
        var lease: MediaLease? = null
        try {
            val issued = client.issueImageTicket(target, path, mediaClientId, ownerRef, bearerToken())
            lease = issued
            val bytes = client.fetchImageBytes(issued)
            loadState = withContext(Dispatchers.Default) { decodeImageBounded(bytes) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: OutOfMemoryError) {
            loadState = ImageLoadState.Unsupported("Not enough memory to display this image.")
        } catch (e: Exception) {
            loadState = ImageLoadState.Failed("Failed to load image: ${e.message}")
        } finally {
            lease?.let { issued ->
                val token = runCatching { bearerToken() }.getOrNull()
                if (token != null) {
                    cleanupScope.launch(NonCancellable) {
                        withTimeoutOrNull(3_000L) {
                            try {
                                client.revokeImageTicket(issued, token)
                            } catch (e: CancellationException) {
                                throw e
                            } catch (_: Exception) {
                                // Best-effort: the server expires unrevoked tickets.
                            }
                        }
                    }
                }
            }
        }
    }

    // Release the decoded bitmap synchronously when the tab leaves composition.
    DisposableEffect(tabKey) {
        onDispose {
            (loadState as? ImageLoadState.Ready)?.bitmap?.let { if (!it.isRecycled) it.recycle() }
            loadState = ImageLoadState.Loading
        }
    }

    val ready = loadState as? ImageLoadState.Ready
    fun applyScale(newScale: Float) {
        scale = ImageViewerMath.clampScale(newScale)
        val bmp = ready?.bitmap ?: return
        offset = ImageViewerMath.clampOffset(
            offset, scale, containerSize.width.toFloat(), containerSize.height.toFloat(),
            bmp.width.toFloat(), bmp.height.toFloat(),
        )
    }

    val transformState = rememberTransformableState { zoomChange, panChange, _ ->
        val bmp = ready?.bitmap ?: return@rememberTransformableState
        val newScale = ImageViewerMath.clampScale(scale * zoomChange)
        scale = newScale
        offset = ImageViewerMath.clampOffset(
            offset + panChange, newScale, containerSize.width.toFloat(), containerSize.height.toFloat(),
            bmp.width.toFloat(), bmp.height.toFloat(),
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black)
                .clipToBounds()
                .onSizeChanged { containerSize = it }
                .transformable(state = transformState, canPan = { scale > 1f }),
            contentAlignment = Alignment.Center
        ) {
            when (val state = loadState) {
                is ImageLoadState.Loading -> CircularProgressIndicator(color = DamHopperColors.Primary)
                is ImageLoadState.Ready -> Image(
                    bitmap = state.bitmap.asImageBitmap(),
                    contentDescription = fileName,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offset.x
                            translationY = offset.y
                        }
                )
                is ImageLoadState.Unsupported -> FallbackCard(
                    title = "Preview unavailable",
                    detail = state.reason,
                    isError = false,
                )
                is ImageLoadState.Failed -> FallbackCard(
                    title = "Image failed to load",
                    detail = state.message,
                    isError = true,
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Inline controls (Zero FABs)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val zoomEnabled = ready != null
            OutlinedButton(
                onClick = { applyScale(scale / ImageViewerMath.ZOOM_STEP) },
                enabled = zoomEnabled && scale > ImageViewerMath.MIN_SCALE,
            ) { Text("-") }
            OutlinedButton(
                onClick = { applyScale(scale * ImageViewerMath.ZOOM_STEP) },
                enabled = zoomEnabled && scale < ImageViewerMath.MAX_SCALE,
            ) { Text("+") }
            OutlinedButton(
                onClick = {
                    scale = 1f
                    offset = Offset.Zero
                },
                enabled = zoomEnabled && (scale != 1f || offset != Offset.Zero),
            ) { Text("Reset") }
            Text(
                text = "${(scale * 100).toInt()}%",
                style = DamHopperTypography.labelSmall,
                color = DamHopperColors.TextSecondary,
                modifier = Modifier.weight(1f)
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
    }
}

@Composable
private fun FallbackCard(title: String, detail: String, isError: Boolean) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isError) MaterialTheme.colorScheme.errorContainer else DamHopperColors.Surface
        ),
        modifier = Modifier.padding(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = title,
                style = DamHopperTypography.bodyMedium,
                color = if (isError) MaterialTheme.colorScheme.onErrorContainer else DamHopperColors.TextPrimary
            )
            Text(
                text = detail,
                style = DamHopperTypography.bodySmall,
                color = if (isError) MaterialTheme.colorScheme.onErrorContainer else DamHopperColors.TextSecondary
            )
        }
    }
}
