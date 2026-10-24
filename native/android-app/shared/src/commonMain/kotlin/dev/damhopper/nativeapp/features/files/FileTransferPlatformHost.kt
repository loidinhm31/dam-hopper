package dev.damhopper.nativeapp.features.files

import androidx.compose.runtime.compositionLocalOf

/**
 * Platform bridge for Storage Access Framework (SAF) file uploads and downloads.
 */
data class FileTransferPlatformHost(
    val onUploadFile: (targetDir: String) -> Unit,
    val onDownloadFile: (relativePath: String, filename: String) -> Unit,
)

val LocalFileTransferPlatformHost = compositionLocalOf<FileTransferPlatformHost?> { null }
