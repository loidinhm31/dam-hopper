package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

@Composable
fun FleetScreens(
    controller: HostResourceController,
    modifier: Modifier = Modifier,
) {
    val uiState by controller.uiState.collectAsState()

    DisposableEffect(controller) {
        val u1 = controller.registerViewDemand(ResourceConsumerKind.FLEET)
        val u2 = controller.registerViewDemand(ResourceConsumerKind.DETAIL_SNAPSHOT)
        val u3 = controller.registerViewDemand(ResourceConsumerKind.DETAIL_METRICS)
        onDispose { u1(); u2(); u3() }
    }

    val modeColor = when (uiState.mode) {
        ResourceSourceMode.LIVE -> Color(0xFF10B981)
        ResourceSourceMode.STARTING, ResourceSourceMode.RETRY_WAIT -> Color(0xFFF59E0B)
        ResourceSourceMode.REST_ONLY -> Color(0xFF3B82F6)
        ResourceSourceMode.AUTH_BLOCKED -> Color(0xFFEF4444)
        ResourceSourceMode.PAUSED, ResourceSourceMode.STOPPED -> Color(0xFF6B7280)
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Stream Header & Status Bar
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusChip("MODE: ${uiState.mode.name}", modeColor)
                    uiState.freshness?.let { f ->
                        val isStale = f.isSnapshotStale(kotlinx.datetime.Clock.System.now().toEpochMilliseconds())
                        val staleColor = if (isStale) Color(0xFFF59E0B) else Color(0xFF10B981)
                        StatusChip(if (isStale) "STALE" else "FRESH", staleColor)
                    }
                }
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(DamHopperColors.SurfaceVariant)
                        .clickable { controller.triggerRestRefresh() }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        if (uiState.isRestLoading) "Refreshing..." else "Refresh",
                        fontSize = 11.sp,
                        color = DamHopperColors.Primary
                    )
                }
            }
        }

        // Host Summary Card
        item {
            val metrics = uiState.metrics
            val hostName = metrics?.hostname ?: uiState.snapshot?.host?.hostname ?: "Local Host"
            val osName = metrics?.osName ?: uiState.snapshot?.host?.osName ?: "Linux"

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(DamHopperColors.Surface)
                    .padding(12.dp)
            ) {
                Text(hostName, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text(osName, fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                Spacer(modifier = Modifier.height(10.dp))

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val cpuUsage = metrics?.cpu?.usagePercent?.let { "${(it * 10).toInt() / 10.0}%" } ?: "--"
                    val memUsage = metrics?.memory?.usagePercent?.let { "${(it * 10).toInt() / 10.0}%" } ?: "--"
                    val diskUsage = metrics?.disk?.usagePercent?.let { "${(it * 10).toInt() / 10.0}%" } ?: "--"

                    val ramSub = metrics?.memory?.usedBytes?.let { "${it.toLong() / 1048576} MB" } ?: "--"
                    val coreText = metrics?.cpu?.logicalCoreCount?.let { "Cores: $it" } ?: "Cores: --"
                    MetricGaugeCard("CPU", cpuUsage, coreText, modifier = Modifier.weight(1f))
                    MetricGaugeCard("RAM", memUsage, ramSub, modifier = Modifier.weight(1f))
                    MetricGaugeCard("DISK", diskUsage, metrics?.disk?.mountPoint ?: "--", modifier = Modifier.weight(1f))
                }
            }
        }

        // Deep Snapshot Memory Details
        uiState.snapshot?.let { snap ->
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(DamHopperColors.Surface)
                        .padding(12.dp)
                ) {
                    Text("MEMORY & PRESSURE", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
                    Spacer(modifier = Modifier.height(8.dp))
                    val swapU = snap.memory.swapUsedBytes?.let { "${it.toLong() / 1048576} MB" } ?: "--"
                    val swapT = snap.memory.swapTotalBytes?.let { "${it.toLong() / 1048576} MB" } ?: "--"
                    val bufS = snap.memory.buffersBytes?.let { "${it.toLong() / 1048576} MB" } ?: "--"
                    val cacS = snap.memory.cachedBytes?.let { "${it.toLong() / 1048576} MB" } ?: "--"
                    Text("Swap: $swapU / $swapT", fontSize = 11.sp, color = Color.White)
                    Text("Buffers: $bufS  •  Cached: $cacS", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                    if (snap.memory.availability.state != AvailabilityState.AVAILABLE) {
                        Text("Memory Status: ${snap.memory.availability.state.name}", fontSize = 10.sp, color = Color(0xFFF59E0B))
                    }
                    snap.pressure.memory.some?.let { psi ->
                        Text("Pressure PSI Some: avg10=${psi.avg10} avg60=${psi.avg60}", fontSize = 11.sp, color = DamHopperColors.TextSecondary)
                    }
                }
            }
        }

        // Active Alerts Section
        if (uiState.alerts.isNotEmpty()) {
            item {
                Text("ACTIVE ALERTS (${uiState.alerts.size})", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = DamHopperColors.TextSecondary)
            }
            items(uiState.alerts) { alert ->
                AlertIncidentRow(alert)
            }
        }
    }
}
