package dev.damhopper.nativeapp

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.settings.SettingsOwner
import dev.damhopper.nativeapp.platform.storage.AndroidCommandHistoryStore
import java.io.File
import java.util.concurrent.Executor
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Behavior of the opt-in, app-local, bounded command history: consent, exact scoping, the 1,000 record / 4 KiB entry
 * / 4 MiB total bounds, persistence failure semantics and clear. The I/O executor is synchronous so each
 * assertion observes the persisted state deterministically.
 */
class CommandHistoryStoreTest {

    private lateinit var dir: File
    private lateinit var file: File
    private val inline = Executor { it.run() }
    private val owner = SettingsOwner(ConnectionRef("profile-a", 1L), "https://host-a", "alice")

    @BeforeTest
    fun setUp() {
        dir = kotlin.io.path.createTempDirectory("history-test").toFile()
        file = File(dir, "history.bin")
    }

    @AfterTest
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun store(f: File = file) = AndroidCommandHistoryStore(f, inline)

    @Test
    fun consentDefaultsOffAndNothingIsRecordedOrPersistedUntilEnabled() {
        val s = store()
        assertFalse(s.enabled.value)
        s.record(owner, "proj", "ls -la")
        assertEquals(0, s.recordCount())
        assertFalse(file.exists(), "nothing is written without consent")
        assertTrue(s.suggestions(owner, "proj", "ls").isEmpty())
    }

    @Test
    fun suggestionsAreScopedToTheExactOwnerAccountEndpointAndProject() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "git status")
        s.record(owner, "proj", "git stash")
        s.record(owner, "other", "git secret-other-project")
        s.record(SettingsOwner(ConnectionRef("profile-a", 1L), "https://host-a", "bob"), "proj", "git secret-other-account")
        s.record(SettingsOwner(ConnectionRef("profile-a", 1L), "https://host-b", "alice"), "proj", "git secret-other-endpoint")
        s.record(SettingsOwner(ConnectionRef("profile-b", 1L), "https://host-a", "alice"), "proj", "git secret-other-profile")

        assertEquals(listOf("git stash", "git status"), s.suggestions(owner, "proj", "git s"), "newest first, scoped only")
        assertTrue(s.suggestions(owner, "proj", "git status").isEmpty(), "an exact match is not a suggestion")
        assertTrue(s.suggestions(owner, "proj", "").isEmpty(), "no prefix, no suggestions")
    }

    @Test
    fun onlyRecordableExactCommandsAreStored() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "   ")
        s.record(owner, "proj", "echo a\necho b")
        s.record(owner, "proj", "echo \u0000nul")
        s.record(owner, "proj", "echo\tok")
        assertEquals(1, s.recordCount(), "blank, multi-line and control-character commands are refused, a tab is fine")
    }

    @Test
    fun entryCapIs4KiBOfUtf8NotCharacters() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "x".repeat(4096))
        assertEquals(1, s.recordCount())
        s.record(owner, "proj", "y".repeat(4097))
        assertEquals(1, s.recordCount(), "4097 bytes is refused, never truncated")
        s.record(owner, "proj", "é".repeat(2049)) // 4098 UTF-8 bytes in 2049 characters
        assertEquals(1, s.recordCount())
        s.record(owner, "proj", "é".repeat(2048)) // exactly 4096 bytes
        assertEquals(2, s.recordCount())
    }

    @Test
    fun recordCountIsBoundedAt1000DroppingTheOldest() {
        val s = store()
        s.setEnabled(true)
        repeat(1005) { s.record(owner, "proj", "cmd-$it") }
        assertEquals(1000, s.recordCount())
        assertTrue(s.suggestions(owner, "proj", "cmd-0").none { it == "cmd-0" }, "the oldest were dropped first")
        assertTrue(s.suggestions(owner, "proj", "cmd-1004").isEmpty(), "an exact match is not suggested, but it is stored")
        assertEquals(listOf("cmd-1004", "cmd-1003", "cmd-1002", "cmd-1001", "cmd-1000"), s.suggestions(owner, "proj", "cmd-100"), "the newest survive")
    }

    @Test
    fun serializedSizeIsBoundedAt4MiBDroppingTheOldestBeforeTheCap() {
        val s = store()
        s.setEnabled(true)
        val wide = SettingsOwner(ConnectionRef("profile-a", 1L), "https://" + "h".repeat(3000), "alice")
        repeat(1000) { s.record(wide, "proj", "$it-" + "z".repeat(4000)) }
        assertTrue(s.serializedBytes() <= 4 * 1024 * 1024, "serialized ${s.serializedBytes()} must stay within 4 MiB")
        assertTrue(s.recordCount() < 1000, "oldest entries were dropped to honor the byte cap")
        assertTrue(file.length() <= 4 * 1024 * 1024, "the persisted file honors the cap too")
    }

    @Test
    fun repeatedSubmissionMovesToNewestInsteadOfDuplicating() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "make build")
        s.record(owner, "proj", "make test")
        s.record(owner, "proj", "make build")
        assertEquals(2, s.recordCount())
        assertEquals(listOf("make build", "make test"), s.suggestions(owner, "proj", "make "))
    }

    @Test
    fun historySurvivesRestartButSuggestionsNeedConsentAgain() {
        val first = store()
        first.setEnabled(true)
        first.record(owner, "proj", "npm test")
        assertTrue(file.exists())

        val second = store()
        assertFalse(second.enabled.value, "consent is a local preference, never inferred from stored data")
        assertTrue(second.suggestions(owner, "proj", "npm").isEmpty())
        second.setEnabled(true)
        assertEquals(listOf("npm test"), second.suggestions(owner, "proj", "npm t"))
        assertEquals(1, second.recordCount())
    }

    @Test
    fun disableStopsSavingAndHidesSuggestionsButKeepsDataUntilClear() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "ls")
        s.setEnabled(false)
        s.record(owner, "proj", "ls -la")
        assertEquals(1, s.recordCount(), "nothing is saved while disabled")
        assertTrue(s.suggestions(owner, "proj", "l").isEmpty(), "no live suggestions while disabled")
        assertTrue(file.exists(), "disable alone does not delete; clear does")
    }

    @Test
    fun clearRemovesStorageAndLiveSuggestions() {
        val s = store()
        s.setEnabled(true)
        s.record(owner, "proj", "ls -la")
        val before = s.revision.value
        s.clear()
        assertEquals(0, s.recordCount())
        assertFalse(file.exists())
        assertTrue(s.suggestions(owner, "proj", "ls").isEmpty())
        assertTrue(s.revision.value > before, "observers recompute suggestions after a clear")
    }

    @Test
    fun persistenceFailureStopsRecordingAndIsReportedWithoutRetry() {
        val blocker = File(dir, "not-a-directory").apply { writeText("x") }
        val s = store(File(blocker, "history.bin")) // the parent is a regular file: every write fails
        s.setEnabled(true)
        s.record(owner, "proj", "first")
        assertNotNull(s.failure.value, "the failure is shown")
        s.record(owner, "proj", "second")
        assertEquals(1, s.recordCount(), "recording stopped after the failure; nothing retried silently")
    }

    @Test
    fun unreadableStoredBytesStopRecordingUntilTheUserClears() {
        file.writeBytes(byteArrayOf(1, 2, 3, 4, 5))
        val s = store()
        assertNotNull(s.failure.value)
        s.setEnabled(true)
        s.record(owner, "proj", "ls")
        assertEquals(0, s.recordCount())
        assertNotNull(s.failure.value, "re-enabling does not paper over corrupt storage")
        s.clear()
        assertNull(s.failure.value)
        s.record(owner, "proj", "ls")
        assertEquals(1, s.recordCount())
    }
}
