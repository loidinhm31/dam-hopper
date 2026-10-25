package dev.damhopper.nativeapp.platform.notifications

import kotlin.test.Test
import kotlin.test.assertNotNull

class AndroidNotificationAudioTest {

    @Test
    fun audioLifecycleAndGracefulFailureHandling() {
        val audio = AndroidNotificationAudio()
        assertNotNull(audio)
        // Invalid or zero volume does not play or leak
        audio.play("invalid_pattern", 0.5)
        audio.play("default", 0.0)
        audio.play("default", -1.0)
        audio.stop()
        audio.close()
    }
}
