package dev.damhopper.nativeapp.core.logging

/**
 * Standard log levels for DamHopper native app, matching web app severity ranks.
 */
enum class LogLevel(val rank: Int) {
    DEBUG(10),
    INFO(20),
    WARN(30),
    ERROR(40),
    NONE(50);

    fun shouldLog(configuredLevel: LogLevel): Boolean {
        return this.rank >= configuredLevel.rank && this != NONE
    }
}
