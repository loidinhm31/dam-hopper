package dev.damhopper.nativeapp

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import dev.damhopper.nativeapp.features.editor.DocumentPreviewSnapshot
import dev.damhopper.nativeapp.features.editor.DocumentSnapshotProvider
import dev.damhopper.nativeapp.features.editor.LocalDocumentSnapshotProvider
import dev.damhopper.nativeapp.features.editor.LocalNativeEditorSurfaceHost
import dev.damhopper.nativeapp.features.editor.LocalNativeHtmlSurfaceHost
import dev.damhopper.nativeapp.features.editor.NativeHtmlSurfaceHost
import dev.damhopper.nativeapp.features.files.FileTransferPlatformHost
import dev.damhopper.nativeapp.features.files.LocalFileTransferPlatformHost
import dev.damhopper.nativeapp.features.files.TransferResult
import dev.damhopper.nativeapp.features.media.LocalNativeMediaSurfaceHost
import dev.damhopper.nativeapp.features.media.NativeMediaSurfaceHost
import dev.damhopper.nativeapp.features.profiles.AuthStatus
import dev.damhopper.nativeapp.features.profiles.ServerProfile
import dev.damhopper.nativeapp.features.settings.MAX_CONFIG_IMPORT_BYTES
import dev.damhopper.nativeapp.features.workspace.ProjectWorkspaceState
import dev.damhopper.nativeapp.platform.editor.AndroidEditorDocument
import dev.damhopper.nativeapp.platform.editor.AndroidHtmlSurface
import dev.damhopper.nativeapp.platform.editor.AndroidNativeEditorSurfaceHost
import dev.damhopper.nativeapp.platform.lifecycle.AndroidLifecycleCoordinator
import dev.damhopper.nativeapp.platform.media.AndroidMediaClient
import dev.damhopper.nativeapp.platform.media.AndroidMediaSurfaceEnvironment
import dev.damhopper.nativeapp.platform.media.createAndroidMediaSurfaceHost
import dev.damhopper.nativeapp.platform.notifications.AndroidNotificationSink
import dev.damhopper.nativeapp.platform.storage.AndroidDocumentStorage
import dev.damhopper.nativeapp.platform.workspace.DocumentLaunchers
import dev.damhopper.nativeapp.platform.workspace.NativeWorkspaceViewModel
import dev.damhopper.nativeapp.ui.screens.DamHopperMobileApp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Main Android host Activity rendering the native DamHopper application.
 *
 * All runtime state (profiles, connections, navigation, workspace documents, Settings, notification feed and
 * history) is retained in [NativeWorkspaceViewModel] and survives Activity destruction and recreation. This class
 * only owns Activity-bound adapters: system pickers, the notification permission launcher and the click-intent
 * decoder. They are registered explicitly (never inside composition), attached on create and detached on destroy,
 * so the retained owner never holds an Activity and an old Activity's callback can never navigate a new owner.
 */
class MainActivity : ComponentActivity() {
    val viewModel: NativeWorkspaceViewModel by viewModels()

    private val documentStorage by lazy { AndroidDocumentStorage(applicationContext.contentResolver) }

    private val lifecycleCoordinator by lazy {
        AndroidLifecycleCoordinator(
            coordinator = viewModel.lifecycleCoordinator,
            onDetach = { viewModel.onActivityDestroy(isChangingConfigurations) },
            onResumed = { viewModel.notificationPlatform.refreshStatus() },
        )
    }

    // Settings document pickers (SAF; no broad storage permission, no persisted URI grant). MIME is advisory.
    private val openSettingsDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        onSettingsOpenResult(uri)
    }
    private val createTomlDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/toml")) { uri ->
        onSettingsCreateResult(uri)
    }
    private val createJsonDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        onSettingsCreateResult(uri)
    }

    // Explicit user-initiated notification permission request (API 33+); events never prompt.
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        viewModel.notificationPlatform.onPermissionResult(granted)
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
        attachPlatformPorts()
        viewModel.viewModelScope.launch {
            viewModel.profileRepository.initialize()
            handleNotificationIntent(intent)
        }
        setContent {
            val flowNavigation = viewModel.flowNavigation
            val profiles by viewModel.profileRepository.profiles.collectAsState()
            val authStatuses by viewModel.profileRepository.authStatuses.collectAsState()
            val flowState by flowNavigation.state.collectAsState()
            val mediaHost = rememberAndroidMediaSurfaceHost(
                profile = profiles.find { it.id == flowState.activeProfileId },
                authStatus = flowState.activeProfileId?.let { authStatuses[it] },
            )

            var pendingUploadState by remember { mutableStateOf<Triple<String, dev.damhopper.nativeapp.core.model.ProjectTargetRef, String>?>(null) }
            var pendingDownloadState by remember { mutableStateOf<Triple<String, String, ByteArray>?>(null) } // (filename, relativePath, bytes)

            // Existing file-transfer pickers stay independent of the Settings document launchers above.
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
                    services = viewModel,
                    lifecycleCoordinator = viewModel.lifecycleCoordinator,
                    workspaceStateProvider = { owner, target, client, ws ->
                        viewModel.getOrCreateWorkspaceState(owner, target, client, ws)
                            .also { activeWorkspaceState = it }
                    },
                )
            }
        }
    }

    /**
     * Attaches the Activity-bound launchers to the retained ports. Nothing retained references this Activity after
     * [AndroidLifecycleCoordinator]'s detach (called on destroy) drops them.
     */
    private fun attachPlatformPorts() {
        viewModel.documentPort.attach(
            object : DocumentLaunchers {
                override fun launchOpen() {
                    openSettingsDocument.launch(arrayOf("*/*"))
                }

                override fun launchCreate(suggestedName: String, mime: String) {
                    if (mime == "application/json") createJsonDocument.launch(suggestedName) else createTomlDocument.launch(suggestedName)
                }
            },
        )
        viewModel.notificationPlatform.bindLaunchers(
            requestPermission = { notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) },
            openSettings = { settingsIntent -> startActivity(settingsIntent) },
        )
    }

    /**
     * Streaming, bounded read of the picked file: at most [MAX_CONFIG_IMPORT_BYTES] bytes (the stream is read
     * until the ceiling is exceeded, then rejected), the stream is closed on every path, and nothing is decoded here
     * (strict UTF-8 and operation validation happen at completion in the retained consumer). The result is reported
     * on the retained scope so a rotation mid-read cannot strand the in-flight token.
     */
    private fun onSettingsOpenResult(uri: Uri?) {
        val port = viewModel.documentPort
        if (uri == null) {
            port.onOpenResult(null, cancelled = true, error = null)
            return
        }
        val storage = documentStorage
        viewModel.viewModelScope.launch {
            try {
                val bytes = storage.readBytes(uri, MAX_CONFIG_IMPORT_BYTES)
                port.onOpenResult(bytes, cancelled = false, error = null)
            } catch (e: CancellationException) {
                port.onOpenResult(null, cancelled = true, error = null)
                throw e
            } catch (e: Exception) {
                port.onOpenResult(null, cancelled = false, error = e.message ?: "The selected file could not be read.")
            }
        }
    }

    private fun onSettingsCreateResult(uri: Uri?) {
        val port = viewModel.documentPort
        if (uri == null) {
            port.onCreateResult(saved = false, cancelled = true, error = null)
            return
        }
        val bytes = port.pendingCreateBytes()
        if (bytes == null) {
            port.onCreateResult(saved = false, cancelled = true, error = null)
            return
        }
        val storage = documentStorage
        viewModel.viewModelScope.launch {
            try {
                storage.writeBytes(uri, bytes)
                port.onCreateResult(saved = true, cancelled = false, error = null)
            } catch (e: CancellationException) {
                // A possibly partial write is never reported as saved.
                port.onCreateResult(saved = false, cancelled = false, error = "Saving was interrupted; the file may be incomplete.")
                throw e
            } catch (e: Exception) {
                port.onCreateResult(saved = false, cancelled = false, error = e.message ?: "The file could not be saved.")
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
        viewModel.viewModelScope.launch { handleNotificationIntent(intent) }
    }

    /**
     * Decodes and consumes a notification click EXACTLY once (cold start or live): malformed/overflowing/wrong
     * extras decode to null, consumed extras/data are cleared, and a process-memory set of consumed request keys
     * stops a rotation from replaying it. Routing then goes through the retained authoritative validator (process
     * nonce, owner, endpoint/account, live socket, epoch, terminal incarnation/project/worktree, departure guard);
     * a refusal is shown inline, never an auto-activation.
     */
    private suspend fun handleNotificationIntent(intent: Intent?) {
        val click = AndroidNotificationSink.decodeClick(intent) ?: return
        intent?.let {
            it.action = null
            it.data = null
            it.replaceExtras(Bundle())
        }
        if (!viewModel.consumeNotificationClick(click.key)) return
        viewModel.markNotificationRead(click.key)
        viewModel.openNotification(click.target)
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
