package dev.damhopper.nativeapp.features.host

import kotlinx.serialization.Serializable

@Serializable
data class LoadAverageMetrics(
    val one: Double = 0.0,
    val five: Double = 0.0,
    val fifteen: Double = 0.0,
)

@Serializable
data class CpuMetrics(
    val usagePercent: Double = 0.0,
    val logicalCoreCount: Int = 0,
    val physicalCoreCount: Int? = null,
    val loadAverage: LoadAverageMetrics? = null,
)

@Serializable
data class MemoryMetrics(
    val totalBytes: ULong = 0uL,
    val usedBytes: ULong = 0uL,
    val availableBytes: ULong = 0uL,
    val usagePercent: Double = 0.0,
)

@Serializable
data class DiskMetrics(
    val name: String = "",
    val mountPoint: String = "",
    val totalBytes: ULong = 0uL,
    val availableBytes: ULong = 0uL,
    val usedBytes: ULong = 0uL,
    val usagePercent: Double = 0.0,
)

@Serializable
data class TemperatureMetrics(
    val label: String = "",
    val celsius: Double = 0.0,
    val source: String = "",
)

@Serializable
data class HostMetrics(
    val sampledAt: Long = 0L,
    val hostname: String? = null,
    val osName: String? = null,
    val uptimeSeconds: ULong = 0uL,
    val cpu: CpuMetrics = CpuMetrics(),
    val memory: MemoryMetrics = MemoryMetrics(),
    val disk: DiskMetrics = DiskMetrics(),
    val disks: List<DiskMetrics> = emptyList(),
    val temperatures: List<TemperatureMetrics> = emptyList(),
)
