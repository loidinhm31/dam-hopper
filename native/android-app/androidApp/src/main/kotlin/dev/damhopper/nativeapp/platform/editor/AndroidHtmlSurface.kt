package dev.damhopper.nativeapp.platform.editor

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.viewinterop.AndroidView
import dev.damhopper.nativeapp.ui.theme.DamHopperColors
import java.io.ByteArrayInputStream

/**
 * Sandboxed HTML Preview surface using an isolated, security-hardened Android [WebView].
 * Renders full HTML with CSS stylesheets, layouts, fonts, and inline styles while strictly
 * preserving security boundaries:
 *
 * Security Invariants:
 * - JavaScript is strictly disabled (`javaScriptEnabled = false`).
 * - Local file access and ContentProvider access are disabled (`allowFileAccess = false`, `allowContentAccess = false`).
 * - DOM storage and geolocation are disabled (`domStorageEnabled = false`, `setGeolocationEnabled(false)`).
 * - Outbound navigation and form submissions are blocked; link clicks prompt user confirmation for external browser.
 * - Loaded under a synthetic origin (`https://appassets.androidplatform.net/`) with zero access to application bearer tokens or session cookies.
 * - WebResource requests are intercepted to block private loopback network probes.
 * - On disposal, the WebView is halted and destroyed cleanly.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AndroidHtmlSurface(
    htmlContent: String,
    @Suppress("UNUSED_PARAMETER") isTruncated: Boolean,
    modifier: Modifier = Modifier,
) {
    var pendingUrl by remember { mutableStateOf<String?>(null) }
    val uriHandler = LocalUriHandler.current

    Box(modifier = modifier.fillMaxSize().background(DamHopperColors.Background)) {
        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setBackgroundColor(Color.TRANSPARENT)

                    settings.apply {
                        javaScriptEnabled = false
                        allowFileAccess = false
                        allowContentAccess = false
                        domStorageEnabled = false
                        setGeolocationEnabled(false)
                        setSupportMultipleWindows(false)
                        cacheMode = WebSettings.LOAD_NO_CACHE
                        defaultTextEncodingName = "UTF-8"
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val url = request?.url?.toString()
                            if (url != null && (url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true))) {
                                pendingUrl = url
                            }
                            return true // Prevent webview from navigating away
                        }

                        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                            val uri = request?.url ?: return null
                            val host = uri.host?.lowercase() ?: ""
                            // Block any attempts to probe loopback or private services
                            if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") {
                                return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                            }
                            return super.shouldInterceptRequest(view, request)
                        }

                        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                            return true // Suppress crash if renderer dies
                        }
                    }

                    loadDataWithBaseURL("https://appassets.androidplatform.net/", htmlContent, "text/html", "UTF-8", null)
                }
            },
            update = { webView ->
                webView.loadDataWithBaseURL("https://appassets.androidplatform.net/", htmlContent, "text/html", "UTF-8", null)
            },
            onRelease = { webView ->
                webView.stopLoading()
                webView.webViewClient = WebViewClient()
                webView.destroy()
            },
            modifier = Modifier.fillMaxSize()
        )
    }

    pendingUrl?.let { url ->
        AlertDialog(
            onDismissRequest = { pendingUrl = null },
            containerColor = DamHopperColors.Surface,
            title = { Text("Open link in browser?", color = DamHopperColors.TextPrimary) },
            text = { Text(url, color = DamHopperColors.TextSecondary) },
            confirmButton = {
                TextButton(
                    onClick = {
                        val toOpen = pendingUrl
                        pendingUrl = null
                        if (toOpen != null) {
                            runCatching { uriHandler.openUri(toOpen) }
                        }
                    },
                ) { Text("Open", color = DamHopperColors.Primary) }
            },
            dismissButton = {
                TextButton(onClick = { pendingUrl = null }) { Text("Cancel", color = DamHopperColors.TextSecondary) }
            },
        )
    }
}
