package dev.damhopper.nativeapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.lifecycle.lifecycleScope
import dev.damhopper.nativeapp.features.editor.LocalNativeEditorSurfaceHost
import dev.damhopper.nativeapp.platform.editor.AndroidNativeEditorSurfaceHost
import dev.damhopper.nativeapp.platform.lifecycle.AndroidLifecycleCoordinator
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import dev.damhopper.nativeapp.ui.flow.AppFlowStage
import dev.damhopper.nativeapp.ui.screens.DamHopperMobileApp
import dev.damhopper.nativeapp.ui.theme.NativeTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import android.os.Looper
import androidx.lifecycle.viewModelScope
import dev.damhopper.nativeapp.features.editor.DocumentPreviewSnapshot
import dev.damhopper.nativeapp.features.editor.DocumentSnapshotProvider
import dev.damhopper.nativeapp.features.editor.LocalDocumentSnapshotProvider
import dev.damhopper.nativeapp.features.editor.LocalNativeHtmlSurfaceHost
import dev.damhopper.nativeapp.features.editor.NativeHtmlSurfaceHost
import dev.damhopper.nativeapp.features.media.LocalNativeMediaSurfaceHost
import dev.damhopper.nativeapp.features.media.NativeMediaSurfaceHost
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocument
import dev.damhopper.nativeapp.platform.editor.AndroidHtmlSurface
import dev.damhopper.nativeapp.platform.media.AndroidMediaClient
import dev.damhopper.nativeapp.platform.media.AndroidMediaSurfaceEnvironment
import dev.damhopper.nativeapp.platform.media.createAndroidMediaSurfaceHost
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import dev.damhopper.nativeapp.features.files.FileTransferPlatformHost
import dev.damhopper.nativeapp.features.files.LocalFileTransferPlatformHost
import dev.damhopper.nativeapp.features.files.TransferResult
import dev.damhopper.nativeapp.platform.storage.AndroidDocumentStorage

/**
 * Main Android host Activity rendering the native DamHopper application.
 *
 * All runtime state (profiles, connections, navigation, and workspace documents)
 * is retained in [NativeWorkspaceViewModel] and survives Activity destruction and recreation.
 */
class MainActivity : ComponentActivity() {
    val viewModel: NativeWorkspaceViewModel by viewModels()

    private val lifecycleCoordinator by lazy {
        AndroidLifecycleCoordinator(
            coordinator = viewModel.lifecycleCoordinator,
            onDetach = { viewModel.onActivityDestroy(isChangingConfigurations) },
        )
    }

    /** Workspace most recently handed to the UI; read at call time by [activeDocumentSnapshotProvider]. */
    @Volatile
    private var activeWorkspaceState: ProjectWorkspaceState? = null

    /**
     * Workspace-level [LocalDocumentSnapshotProvider]: the active tab's [AndroidEditorDocument] is the
     * single text authority (captured on Main); non-Android documents fall back to the tab snapshot.
     */
    private val activeDocumentSnapshotProvider: DocumentSnapshotProvider = { maxChars ->
        activeWorkspaceState?.editorTabsState?.let { tabsState ->
            tabsState.activeTabKey.value?.let { activeKey ->
                val activeDoc = tabsState.getSession(activeKey)?.document
                    ?: tabsState.activeTabId.value?.let { tabsState.getDocument(it) }
                (activeDoc as? AndroidEditorDocument)?.let { capturePreviewSnapshot(it, maxChars) }
                    ?: tabsState.previewSnapshot(activeKey, maxChars)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycle.addObserver(lifecycleCoordinator)
        lifecycleScope.launch {
            viewModel.profileRepository.initialize()
            handleDeepLink(intent)
        }
        setContent {
            NativeTheme {
                val flowNavigation = viewModel.flowNavigation
                val flowState by flowNavigation.state.collectAsState()
                val profiles by viewModel.profileRepository.profiles.collectAsState()
                val authStatuses by viewModel.profileRepository.authStatuses.collectAsState()
                val mediaHost = rememberAndroidMediaSurfaceHost(
                    profile = profiles.find { it.id == flowState.activeProfileId },
                    authStatus = flowState.activeProfileId?.let { authStatuses[it] },
                )

                val documentStorage = remember { AndroidDocumentStorage(contentResolver) }
                var pendingUploadState by remember { mutableStateOf<Triple<String, dev.damhopper.nativeapp.core.model.ProjectTargetRef, String>?>(null) }
                var pendingDownloadState by remember { mutableStateOf<Triple<String, String, ByteArray>?>(null) } // (filename, relativePath, bytes)

                val uploadLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.GetContent()
                ) { uri: Uri? ->
                    val pending = pendingUploadState ?: return@rememberLauncherForActivityResult
                    pendingUploadState = null
                    if (uri != null) {
                        lifecycleScope.launch {
                            try {
                                val ws = activeWorkspaceState ?: return@launch
                                if (ws.fileTreeState.target != pending.second) {
                                    Toast.makeText(this@MainActivity, "Upload cancelled: active workspace changed", Toast.LENGTH_LONG).show()
                                    return@launch
                                }
                                val descriptor = documentStorage.queryMetadata(uri)
                                val bytes = documentStorage.readBytes(uri, maxBytes = 32L * 1024L * 1024L)
                                val result = ws.fileRepository.uploadPlain(
                                    target = pending.second,
                                    dir = pending.third,
                                    filename = descriptor.name,
                                    content = bytes,
                                    overwrite = false,
                                )
                                when (result) {
                                    is TransferResult.Success -> {
                                        ws.fileTreeState.refresh()
                                        Toast.makeText(this@MainActivity, "Uploaded ${descriptor.name}", Toast.LENGTH_SHORT).show()
                                    }
                                    is TransferResult.Conflict -> {
                                        Toast.makeText(this@MainActivity, "Upload conflict: '${descriptor.name}' already exists on server", Toast.LENGTH_LONG).show()
                                    }
                                    is TransferResult.Error -> {
                                        Toast.makeText(this@MainActivity, "Upload failed: ${result.message}", Toast.LENGTH_LONG).show()
                                    }
                                    else -> {}
                                }
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                Toast.makeText(this@MainActivity, "Upload error: ${e.message}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                }

                val downloadSaveLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.CreateDocument("*/*")
                ) { uri: Uri? ->
                    val pending = pendingDownloadState ?: return@rememberLauncherForActivityResult
                    pendingDownloadState = null
                    if (uri != null) {
                        lifecycleScope.launch {
                            try {
                                documentStorage.writeBytes(uri, pending.third)
                                Toast.makeText(this@MainActivity, "Downloaded ${pending.first}", Toast.LENGTH_SHORT).show()
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                Toast.makeText(this@MainActivity, "Download save error: ${e.message}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                }

                val fileTransferHost = remember(activeWorkspaceState) {
                    FileTransferPlatformHost(
                        onUploadFile = { targetDir ->
                            val ws = activeWorkspaceState ?: return@FileTransferPlatformHost
                            pendingUploadState = Triple(flowState.activeProfileId ?: "", ws.fileTreeState.target, targetDir)
                            uploadLauncher.launch("*/*")
                        },
                        onDownloadFile = { relativePath, filename ->
                            lifecycleScope.launch {
                                try {
                                    val ws = activeWorkspaceState ?: return@launch
                                    val readRes = ws.fileRepository.readFile(ws.fileTreeState.target, relativePath)
                                    if (!readRes.ok) {
                                        Toast.makeText(this@MainActivity, "Download failed: ${readRes.errorCode ?: "remote read rejected"}", Toast.LENGTH_LONG).show()
                                        return@launch
                                    }
                                    val bytes = readRes.binaryData ?: readRes.textContent?.encodeToByteArray()
                                        ?: throw Exception("Could not read file bytes")
                                    pendingDownloadState = Triple(filename, relativePath, bytes)
                                    downloadSaveLauncher.launch(filename)
                                } catch (e: Exception) {
                                    if (e is CancellationException) throw e
                                    Toast.makeText(this@MainActivity, "Download failed: ${e.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    )
                }
                CompositionLocalProvider(
                    LocalNativeEditorSurfaceHost provides AndroidNativeEditorSurfaceHost,
                    LocalNativeMediaSurfaceHost provides mediaHost,
                    LocalNativeHtmlSurfaceHost provides AndroidNativeHtmlSurfaceHost,
                    LocalDocumentSnapshotProvider provides activeDocumentSnapshotProvider,
                    LocalFileTransferPlatformHost provides fileTransferHost,
                ) {
                    BackHandler(enabled = true) {
                        if (!flowNavigation.handleBackPress()) {
                            finish()
                        }
                    }
                    DamHopperMobileApp(
                        profileRepository = viewModel.profileRepository,
                        targetStore = viewModel.targetStore,
                        navigation = flowNavigation,
                        preferencesStore = viewModel.preferencesStore,
                        lifecycleCoordinator = viewModel.lifecycleCoordinator,
                        workspaceStateProvider = { owner, target, client, ws ->
                            viewModel.getOrCreateWorkspaceState(owner, target, client, ws)
                                .also { activeWorkspaceState = it }
                        },
                    )
                }
            }
        }
    }

    /**
     * Media host bound to the active profile: the media client is origin-pinned to the profile base URL,
     * the active owner is read live from the connection registry, and the bearer token is loaded from the
     * vault (refreshed on auth status change) and never persisted by the viewers. Null (placeholder card
     * fallback) when no profile is active.
     */
    @Composable
    private fun rememberAndroidMediaSurfaceHost(
        profile: ServerProfile?,
        authStatus: AuthStatus?,
    ): NativeMediaSurfaceHost? {
        val profileId = profile?.id
        val baseUrl = profile?.baseUrl?.trim()?.trimEnd('/')
        var bearerToken by remember(profileId, baseUrl) { mutableStateOf<String?>(null) }
        LaunchedEffect(profileId, baseUrl, authStatus) {
            bearerToken = try {
                profile?.let { viewModel.vault.getToken(it.id, it.baseUrl) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
        }
        val environment = remember(profileId, baseUrl) {
            if (profileId == null || baseUrl == null) {
                null
            } else {
                val registry = viewModel.registry
                val activeOwner = { registry.connectionsState.value[profileId] }
                AndroidMediaSurfaceEnvironment(
                    client = AndroidMediaClient(serverBaseUrl = baseUrl, activeOwnerSupplier = activeOwner),
                    activeOwner = activeOwner,
                    bearerToken = { bearerToken ?: throw IllegalStateException("No bearer token available for media request") },
                    cleanupScope = viewModel.viewModelScope,
                )
            }
        }
        return remember(environment) { environment?.let { createAndroidMediaSurfaceHost(it) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val targetProfileId = intent?.getStringExtra(AndroidNotificationSink.EXTRA_TARGET_PROFILE_ID) ?: return
        val targetGeneration = intent.getLongExtra(AndroidNotificationSink.EXTRA_TARGET_GENERATION, -1L)
        lifecycleScope.launch {
            val profiles = viewModel.profileRepository.profiles.value
            val matchingProfile = profiles.find { it.id == targetProfileId } ?: return@launch
            if (targetGeneration > 0) {
                val currentConn = viewModel.registry.getCurrentConnection(targetProfileId)
                if (currentConn != null && currentConn.generation != targetGeneration) {
                    return@launch
                }
            }
            // Check departure guard before mutating profile selection
            val guard = viewModel.flowNavigation.departureGuard
            if (guard != null) {
                val intercepted = guard(AppFlowStage.PROJECT_LIST) {
                    lifecycleScope.launch {
                        viewModel.profileRepository.selectProfile(matchingProfile.id)
                    }
                }
                if (!intercepted) {
                    viewModel.profileRepository.selectProfile(matchingProfile.id)
                }
            } else {
                viewModel.profileRepository.selectProfile(matchingProfile.id)
            }
        }
    }
}

/** Zero-WebView HTML preview host (Compose `AnnotatedString` rendering). */
private val AndroidNativeHtmlSurfaceHost: NativeHtmlSurfaceHost = { html, isTruncated, modifier ->
    AndroidHtmlSurface(html, isTruncated, modifier)
}

/**
 * Bounded preview snapshot of [doc], the single text authority. Must run on the Main thread because
 * the Sora content buffer is mutated there; the copy is capped at [maxChars] UTF-16 code units and never
 * ends in half a surrogate pair.
 */
fun capturePreviewSnapshot(doc: AndroidEditorDocument, maxChars: Int): DocumentPreviewSnapshot {
    check(Looper.myLooper() == Looper.getMainLooper()) { "Snapshot capture must run on Main thread" }
    val revision = doc.revision.value
    val fullLen = doc.content.length
    var end = minOf(maxChars.coerceAtLeast(0), fullLen)
    if (end in 1 until fullLen && doc.content[end - 1].isHighSurrogate()) end--
    return DocumentPreviewSnapshot(
        documentId = doc.id,
        revision = revision,
        text = doc.content.substring(0, end),
        isTruncated = end < fullLen,
    )
}
