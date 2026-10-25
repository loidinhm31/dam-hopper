package dev.damhopper.nativeapp.platform.storage

import android.content.Context
import android.content.SharedPreferences
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterCodec
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterSelection
import dev.damhopper.nativeapp.features.terminal.TerminalAgentsFilterStore

/**
 * Device-local persistence of the Traditional terminal Agents status filter.
 *
 * One dedicated SharedPreferences file (`terminal_agents_sidebar`) and one key (`status_filter`), independent of
 * profiles, [dev.damhopper.nativeapp.features.settings.WorkbenchPreferences] and the remote settings envelope. Only
 * canonical filter labels are stored: never terminal/profile/project/account/command/status data.
 *
 * [load] never writes or removes; storage failures degrade to [TerminalAgentsFilterSelection.All] on load and to a
 * silently skipped write on [save] (the caller keeps its process-local selection).
 */
class AndroidTerminalAgentsFilterStore internal constructor(
    private val preferences: () -> SharedPreferences,
    private val codec: TerminalAgentsFilterCodec,
) : TerminalAgentsFilterStore {

    constructor(context: Context, codec: TerminalAgentsFilterCodec) : this(
        preferences = {
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        },
        codec = codec,
    )

    override fun load(): TerminalAgentsFilterSelection = try {
        codec.decode(preferences().getString(KEY_STATUS_FILTER, null))
    } catch (_: Exception) {
        TerminalAgentsFilterSelection.All
    }

    override fun save(selection: TerminalAgentsFilterSelection) {
        try {
            preferences().edit().putString(KEY_STATUS_FILTER, codec.encode(selection)).apply()
        } catch (_: Exception) {
            // Optional local UI preference: keep the process-local selection, never crash.
        }
    }

    companion object {
        const val PREFS_NAME = "terminal_agents_sidebar"
        const val KEY_STATUS_FILTER = "status_filter"
    }
}
