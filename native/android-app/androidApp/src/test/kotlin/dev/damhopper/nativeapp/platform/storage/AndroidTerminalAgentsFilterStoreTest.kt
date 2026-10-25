package dev.damhopper.nativeapp.platform.storage

import android.content.SharedPreferences
import dev.damhopper.nativeapp.features.terminal.DefaultTerminalAgentsFilterCodec
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsStatus
import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Exercises the adapter against a recording in-memory [SharedPreferences] (an interface proxy, not Android's
 * default-return stubs), so reads, writes and stored bytes are observable.
 */
class AndroidTerminalAgentsFilterStoreTest {

    private class FakePreferences(initial: Map<String, Any?> = emptyMap()) {
        val values = LinkedHashMap<String, Any?>(initial)
        val reads = mutableListOf<String>()
        val mutations = mutableListOf<String>()
        var denyAccess = false
        var denyWrite = false

        private val editor: SharedPreferences.Editor = run {
            val pending = LinkedHashMap<String, String?>()
            lateinit var self: SharedPreferences.Editor
            self = Proxy.newProxyInstance(
                javaClass.classLoader,
                arrayOf(SharedPreferences.Editor::class.java),
            ) { _, method, args ->
                val a = args ?: emptyArray()
                when (method.name) {
                    "putString" -> {
                        pending[a[0] as String] = a[1] as String?
                        self
                    }
                    "apply", "commit" -> {
                        mutations += method.name
                        if (denyWrite) throw SecurityException("write denied")
                        for ((key, value) in pending) {
                            mutations += "putString:$key=$value"
                            values[key] = value
                        }
                        pending.clear()
                        if (method.name == "commit") true else null
                    }
                    else -> {
                        mutations += "unexpected:${method.name}"
                        self
                    }
                }
            } as SharedPreferences.Editor
            self
        }

        val preferences: SharedPreferences = Proxy.newProxyInstance(
            javaClass.classLoader,
            arrayOf(SharedPreferences::class.java),
        ) { _, method, args ->
            val a = args ?: emptyArray()
            when (method.name) {
                "getString" -> {
                    val key = a[0] as String
                    reads += key
                    if (denyAccess) throw SecurityException("access denied")
                    when (val stored = values[key]) {
                        null -> a[1]
                        is String -> stored
                        else -> throw ClassCastException("${stored::class.java.name} cannot be cast to String")
                    }
                }
                "edit" -> {
                    if (denyAccess) throw SecurityException("access denied")
                    editor
                }
                else -> {
                    mutations += "unexpected:${method.name}"
                    null
                }
            }
        } as SharedPreferences
    }

    private fun store(fake: FakePreferences) =
        AndroidTerminalAgentsFilterStore({ fake.preferences }, DefaultTerminalAgentsFilterCodec())

    @Test
    fun dedicatedFileAndKey() {
        assertEquals("terminal_agents_sidebar", AndroidTerminalAgentsFilterStore.PREFS_NAME)
        assertEquals("status_filter", AndroidTerminalAgentsFilterStore.KEY_STATUS_FILTER)
    }

    @Test
    fun missingValueLoadsAllWithoutWriting() {
        val fake = FakePreferences()
        assertEquals(TerminalAgentsFilterSelection.All, store(fake).load())
        assertEquals(listOf("status_filter"), fake.reads)
        assertTrue(fake.mutations.isEmpty(), "load must not write or remove: ${fake.mutations}")
        assertTrue(fake.values.isEmpty())
    }

    @Test
    fun storedAllScalarAndArrayDecodeWithoutWriteback() {
        val cases = mapOf(
            "all" to TerminalAgentsFilterSelection.All,
            "Working" to TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.WORKING)),
            """["Idle","Needs attention"]""" to TerminalAgentsFilterSelection.Selected(
                listOf(TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.IDLE),
            ),
        )
        for ((raw, expected) in cases) {
            val fake = FakePreferences(mapOf("status_filter" to raw))
            val adapter = store(fake)
            assertEquals(expected, adapter.load(), raw)
            assertEquals(expected, adapter.load(), "repeat load $raw")
            assertTrue(fake.mutations.isEmpty(), "load must never write: ${fake.mutations}")
            assertEquals(mapOf<String, Any?>("status_filter" to raw), fake.values, "bytes untouched for $raw")
        }
    }

    @Test
    fun corruptOrNonStringStorageLoadsAllAndIsNotRepaired() {
        for (raw in listOf<Any?>("{not json", "[1,2", "Nonsense", "[]", 42, true)) {
            val fake = FakePreferences(mapOf("status_filter" to raw))
            assertEquals(TerminalAgentsFilterSelection.All, store(fake).load(), "raw=$raw")
            assertTrue(fake.mutations.isEmpty(), "corrupt bytes must not be rewritten: ${fake.mutations}")
            assertEquals(raw, fake.values["status_filter"])
        }
    }

    @Test
    fun deniedReadLoadsAllWithoutThrowing() {
        val fake = FakePreferences().apply { denyAccess = true }
        assertEquals(TerminalAgentsFilterSelection.All, store(fake).load())
        assertTrue(fake.mutations.isEmpty())
    }

    @Test
    fun preferencesAcquisitionFailureIsSafe() {
        val adapter = AndroidTerminalAgentsFilterStore(
            { throw IllegalStateException("storage unavailable") },
            DefaultTerminalAgentsFilterCodec(),
        )
        assertEquals(TerminalAgentsFilterSelection.All, adapter.load())
        adapter.save(TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.IDLE)))
    }

    @Test
    fun saveWritesCanonicalBytesOnlyOnExplicitSave() {
        val cases = listOf(
            TerminalAgentsFilterSelection.All to "all",
            TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.UNKNOWN)) to "Unknown",
            TerminalAgentsFilterSelection.Selected(
                listOf(TerminalAgentsStatus.WORKING, TerminalAgentsStatus.NEEDS_ATTENTION, TerminalAgentsStatus.WORKING),
            ) to """["Needs attention","Working"]""",
            TerminalAgentsFilterSelection.Selected(emptyList()) to "all",
            TerminalAgentsFilterSelection.Selected(TerminalAgentsStatus.entries.reversed()) to "all",
        )
        for ((selection, expected) in cases) {
            val fake = FakePreferences()
            store(fake).save(selection)
            assertEquals(mapOf<String, Any?>("status_filter" to expected), fake.values, "$selection")
            assertEquals(listOf("apply", "putString:status_filter=$expected"), fake.mutations, "$selection")
        }
    }

    @Test
    fun savedValueRoundTripsThroughLoadAndPersistsNothingElse() {
        val fake = FakePreferences()
        val adapter = store(fake)
        val selection = TerminalAgentsFilterSelection.Selected(
            listOf(TerminalAgentsStatus.IDLE, TerminalAgentsStatus.UNAVAILABLE),
        )
        adapter.save(selection)
        assertEquals(selection, adapter.load())
        assertEquals(setOf("status_filter"), fake.values.keys)
        assertEquals("""["Idle","Unavailable"]""", fake.values["status_filter"])
    }

    @Test
    fun deniedWriteIsSafeAndLeavesStoredValue() {
        val fake = FakePreferences(mapOf("status_filter" to "Working")).apply { denyWrite = true }
        val adapter = store(fake)
        adapter.save(TerminalAgentsFilterSelection.All)
        assertEquals("Working", fake.values["status_filter"])
        assertEquals(
            TerminalAgentsFilterSelection.Selected(listOf(TerminalAgentsStatus.WORKING)),
            adapter.load(),
        )
    }

    @Test
    fun deniedEditAccessIsSafe() {
        val fake = FakePreferences().apply { denyAccess = true }
        store(fake).save(TerminalAgentsFilterSelection.All)
        assertTrue(fake.values.isEmpty())
    }
}
