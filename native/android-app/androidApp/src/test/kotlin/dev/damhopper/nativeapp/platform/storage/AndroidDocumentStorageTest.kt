package dev.damhopper.nativeapp.platform.storage

import kotlin.test.Test
import kotlin.test.assertEquals

class AndroidDocumentStorageTest {

    @Test
    fun testFilenameSanitization() {
        assertEquals("passwd", AndroidDocumentStorage.sanitizeFilename("../../etc/passwd"))
        assertEquals("cmd.exe", AndroidDocumentStorage.sanitizeFilename("C:\\Windows\\System32\\cmd.exe"))
        assertEquals("weird_____file_.txt", AndroidDocumentStorage.sanitizeFilename("weird:?*|<file>.txt"))
        assertEquals("unnamed_file", AndroidDocumentStorage.sanitizeFilename("   "))
        assertEquals("valid-document_v2.0.pdf", AndroidDocumentStorage.sanitizeFilename("valid-document_v2.0.pdf"))
        assertEquals("日本語_ファイル.pdf", AndroidDocumentStorage.sanitizeFilename("日本語_ファイル.pdf"))
        assertEquals("Tiếng_Việt_báo_cáo.docx", AndroidDocumentStorage.sanitizeFilename("Tiếng_Việt_báo_cáo.docx"))
    }

    @Test
    fun testDocumentDescriptorContract() {
        val descriptor = DocumentDescriptor(
            name = "archive.tar.gz",
            size = 1048576L,
            mimeType = "application/gzip"
        )
        assertEquals("archive.tar.gz", descriptor.name)
        assertEquals(1048576L, descriptor.size)
        assertEquals("application/gzip", descriptor.mimeType)
    }
}
