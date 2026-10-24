package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class AvailabilityState {
    @SerialName("available")
    AVAILABLE,
    @SerialName("unsupported")
    UNSUPPORTED,
    @SerialName("permissionDenied")
    PERMISSION_DENIED,
    @SerialName("temporarilyUnavailable")
    TEMPORARILY_UNAVAILABLE,
    @SerialName("stale")
    STALE,
}

@Serializable
data class Availability(
    val state: AvailabilityState = AvailabilityState.AVAILABLE,
    val sampledAt: Long = 0L,
    val detailCode: String? = null,
)

@Serializable
data class HostIdentity(
    val bootId: String? = null,
    val hostname: String? = null,
    val osName: String? = null,
)

@Serializable
data class SnapshotCapabilities(
    val linuxDeepMetrics: Availability = Availability(),
)

@Serializable
data class MemorySnapshot(
    val totalBytes: ULong? = null,
    val usedBytes: ULong? = null,
    val availableBytes: ULong? = null,
    val freeBytes: ULong? = null,
    val buffersBytes: ULong? = null,
    val cachedBytes: ULong? = null,
    val swapTotalBytes: ULong? = null,
    val swapUsedBytes: ULong? = null,
    val swapFreeBytes: ULong? = null,
    val availability: Availability = Availability(),
)

@Serializable
data class PressureInfo(
    val avg10: Double = 0.0,
    val avg60: Double = 0.0,
    val avg300: Double = 0.0,
    val total: ULong? = null,
)

@Serializable
data class MemoryPressure(
    val some: PressureInfo? = null,
    val full: PressureInfo? = null,
    val availability: Availability = Availability(),
)

@Serializable
data class PressureSnapshot(
    val memory: MemoryPressure = MemoryPressure(),
)

@Serializable
data class CgroupMemory(
    val path: String = "",
    val namespace: String = "",
    val currentBytes: ULong? = null,
    val maxBytes: ULong? = null,
    val maxUnlimited: Boolean = false,
    val highBytes: ULong? = null,
    val highUnlimited: Boolean = false,
    val fileCacheBytes: ULong? = null,
    val events: List<JsonElement> = emptyList(),
    val pressure: MemoryPressure = MemoryPressure(),
    val availability: Availability = Availability(),
)

@Serializable
data class ProcessMemory(
    val pid: Long,
    val startTicks: ULong? = null,
    val uid: Long? = null,
    val name: String,
    val commandSummary: String? = null,
    val rssBytes: ULong? = null,
    val anonRssBytes: ULong? = null,
    val fileRssBytes: ULong? = null,
    val shmemRssBytes: ULong? = null,
    val pssBytes: ULong? = null,
    val availability: Availability = Availability(),
)

@Serializable
data class ProcessInventory(
    val processes: List<ProcessMemory> = emptyList(),
    val scannedCount: Int = 0,
    val truncated: Boolean = false,
    val deadlineExceeded: Boolean = false,
    val skippedCount: Int = 0,
    val permissionDeniedCount: Int = 0,
    val invalidUtf8Count: Int = 0,
    val malformedCount: Int = 0,
    val disappearedCount: Int = 0,
    val availability: Availability = Availability(),
)

@Serializable
data class CacheAttribution(
    val label: String = "",
    val bytes: ULong? = null,
    val confidence: Confidence = Confidence.LOW,
    val availability: Availability = Availability(),
)

@Serializable
data class MountContext(
    val mountPoint: String = "",
    val fsType: String? = null,
    val freeBytes: ULong? = null,
    val activeMappedPaths: List<String> = emptyList(),
    val activeMappedPathsAvailability: Availability = Availability(),
    val cacheAttribution: CacheAttribution? = null,
    val availability: Availability = Availability(),
)

@Serializable
data class BatterySnapshot(
    val stateOfChargePercent: Double? = null,
    val state: String? = null,
    val availability: Availability = Availability(),
)

@Serializable
data class ActionCapabilities(
    val availability: Availability = Availability(),
)

@Serializable
data class HostResourceSnapshotV1(
    val schemaVersion: Int = 1,
    val sampleId: String = "",
    val sampledAt: Long = 0L,
    val host: HostIdentity = HostIdentity(),
    val capabilities: SnapshotCapabilities = SnapshotCapabilities(),
    val memory: MemorySnapshot = MemorySnapshot(),
    val battery: BatterySnapshot = BatterySnapshot(),
    val pressure: PressureSnapshot = PressureSnapshot(),
    val cgroups: List<CgroupMemory> = emptyList(),
    val processes: ProcessInventory = ProcessInventory(),
    val mountContext: MountContext = MountContext(),
    val alert: AlertSummary? = null,
    val currentAlerts: List<AlertSummary> = emptyList(),
    val actionCapabilities: ActionCapabilities = ActionCapabilities(),
)

