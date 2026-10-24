package dev.damhopper.nativeapp.features.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

interface PreferencesStore {
    fun loadPreferences(): WorkbenchPreferences
    fun savePreferences(preferences: WorkbenchPreferences)
    fun loadSourceTargetState(): SettingsSourceTargetState
    fun saveSourceTargetState(state: SettingsSourceTargetState)
}

class InMemoryPreferencesStore(
    initialPreferences: WorkbenchPreferences = WorkbenchPreferences(),
    initialSourceTargetState: SettingsSourceTargetState = SettingsSourceTargetState(),
) : PreferencesStore {
    private var preferences = initialPreferences.clamped()
    private var sourceTargetState = initialSourceTargetState

    private val _preferencesFlow = MutableStateFlow(preferences)
    val preferencesFlow: StateFlow<WorkbenchPreferences> = _preferencesFlow.asStateFlow()

    private val _sourceTargetStateFlow = MutableStateFlow(sourceTargetState)
    val sourceTargetStateFlow: StateFlow<SettingsSourceTargetState> = _sourceTargetStateFlow.asStateFlow()

    override fun loadPreferences(): WorkbenchPreferences = preferences

    override fun savePreferences(preferences: WorkbenchPreferences) {
        val clamped = preferences.clamped()
        this.preferences = clamped
        _preferencesFlow.value = clamped
    }

    override fun loadSourceTargetState(): SettingsSourceTargetState = sourceTargetState

    override fun saveSourceTargetState(state: SettingsSourceTargetState) {
        this.sourceTargetState = state
        _sourceTargetStateFlow.value = state
    }
}
