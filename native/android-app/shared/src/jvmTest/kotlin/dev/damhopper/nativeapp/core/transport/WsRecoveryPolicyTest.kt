package dev.damhopper.nativeapp.core.transport

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class WsRecoveryPolicyTest {

    @Test
    fun testComputeNextDelayBoundsAndJitter() {
        // First failure: base is 1000ms. Range [500, 1000]
        val minDelay = WsRecoveryPolicy.computeNextDelay(1, randomFraction = 0.0)
        assertEquals(500L, minDelay)
        val maxDelay = WsRecoveryPolicy.computeNextDelay(1, randomFraction = 1.0)
        assertEquals(1000L, maxDelay)

        // 6th failure: base is 30,000ms. Range [15000, 30000]
        val min6 = WsRecoveryPolicy.computeNextDelay(6, randomFraction = 0.0)
        assertEquals(15_000L, min6)
        val max6 = WsRecoveryPolicy.computeNextDelay(6, randomFraction = 1.0)
        assertEquals(30_000L, max6)

        // 10th failure: caps at 30,000ms
        val delay10 = WsRecoveryPolicy.computeNextDelay(10, randomFraction = 1.0)
        assertEquals(30_000L, delay10)
    }

    @Test
    fun testClassifyDisconnectedRetriesWithNextCount() {
        val action = WsRecoveryPolicy.classify(WsState.Disconnected, failureCount = 0, randomFraction = 0.5)
        assertIs<WsRecoveryAction.Retry>(action)
        assertEquals(1, action.failureCount)
        assertTrue(action.delayMillis in 500..1000)
    }

    @Test
    fun testClassifyAuthBlockedOnMfaAndLoginRequired() {
        val mfaAction = WsRecoveryPolicy.classify(WsState.MfaRequired(4403), failureCount = 2)
        assertIs<WsRecoveryAction.AuthBlocked>(mfaAction)
        assertEquals("MfaRequired", mfaAction.reason)
        assertEquals(4403.toShort(), mfaAction.closeCode)

        val loginAction = WsRecoveryPolicy.classify(WsState.LoginRequired(4401), failureCount = 1)
        assertIs<WsRecoveryAction.AuthBlocked>(loginAction)
        assertEquals("LoginRequired", loginAction.reason)
        assertEquals(4401.toShort(), loginAction.closeCode)
    }

    @Test
    fun testClassifyTransientErrorsRetry() {
        val authUnavail = WsRecoveryPolicy.classify(WsState.AuthUnavailable(1013), failureCount = 0)
        assertIs<WsRecoveryAction.Retry>(authUnavail)

        val overflow = WsRecoveryPolicy.classify(WsState.Overflow(4001), failureCount = 1)
        assertIs<WsRecoveryAction.Retry>(overflow)

        val err = WsRecoveryPolicy.classify(WsState.Error(ConnectTimeoutException("timeout")), failureCount = 0)
        assertIs<WsRecoveryAction.Retry>(err)
        assertEquals("ConnectTimeout", err.reason)
    }
}
