package dev.damhopper.nativeapp.core.security

import dev.damhopper.nativeapp.features.settings.CognitoModeStyle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Ephemeral privacy mode controller.
 *
 * Invariants:
 * - Activation state and chord are held strictly in-memory and NEVER persisted.
 * - When active, input dispatch is frozen across terminal, editor, keyboard, and gesture surfaces.
 * - Dismissal requires the exact same shortcut chord that activated the mask, or explicit touch emergency dismissal.
 * - Consumes trailing touch/key releases after dismissal to prevent accidental input leaks.
 */
class PrivacyController {
    private val _isMaskActive = MutableStateFlow(false)
    val isMaskActive: StateFlow<Boolean> = _isMaskActive.asStateFlow()

    private val _activeStyle = MutableStateFlow(CognitoModeStyle.HEAVY_BLUR)
    val activeStyle: StateFlow<CognitoModeStyle> = _activeStyle.asStateFlow()

    private val _activationChord = MutableStateFlow<String?>(null)
    val activationChord: StateFlow<String?> = _activationChord.asStateFlow()

    private var ignoreNextRelease = false

    /**
     * Checks if user input dispatch is allowed. Returns false when Cognito mask is active.
     */
    fun isInputAllowed(): Boolean = !_isMaskActive.value

    /**
     * Activates Cognito mode, capturing the dismissal chord and presentation style.
     */
    fun activate(chord: String, style: CognitoModeStyle = CognitoModeStyle.HEAVY_BLUR) {
        _activationChord.value = chord.trim().lowercase()
        _activeStyle.value = style
        _isMaskActive.value = true
        ignoreNextRelease = false
    }

    /**
     * Attempts dismissal using a keyboard shortcut chord.
     * Only the exact chord captured at activation will dismiss the mask.
     */
    fun dismissWithChord(chord: String): Boolean {
        if (!_isMaskActive.value) return false
        val candidate = chord.trim().lowercase()
        if (candidate == _activationChord.value) {
            deactivate()
            return true
        }
        return false
    }

    /**
     * Touch-accessible dismissal path for mobile devices without a physical keyboard.
     */
    fun dismissTouchEmergency() {
        if (_isMaskActive.value) {
            deactivate()
        }
    }

    /**
     * Deactivates the mask and marks trailing release events to be consumed.
     */
    fun deactivate() {
        _isMaskActive.value = false
        _activationChord.value = null
        ignoreNextRelease = true
    }

    /**
     * Consumes trailing release events (ACTION_UP or key release) immediately after dismissal.
     */
    fun consumeTrailingRelease(): Boolean {
        if (ignoreNextRelease) {
            ignoreNextRelease = false
            return true
        }
        return false
    }

    /**
     * Lifecycle reset on activity destruction, logout, or background cleanup.
     */
    fun reset() {
        _isMaskActive.value = false
        _activationChord.value = null
        ignoreNextRelease = false
    }
}
