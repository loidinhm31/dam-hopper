package dev.damhopper.nativeapp.features.host

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.damhopper.nativeapp.ui.theme.DamHopperColors

enum class ResourcesSubProduct(val label: String) {
    FLEET("Host Resources"),
    USAGE("Usage Insights"),
}

@Composable
fun ResourcesUnifiedPanelScreen(
    hostController: HostResourceController,
    usageController: UsageController,
    onActiveSubProductChanged: (ResourcesSubProduct) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var activeSubProduct by remember { mutableStateOf(ResourcesSubProduct.FLEET) }

    LaunchedEffect(activeSubProduct) {
        onActiveSubProductChanged(activeSubProduct)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DamHopperColors.Background)
    ) {
        // Sub-product segmented switcher
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DamHopperColors.Surface)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            ResourcesSubProduct.entries.forEach { subProd ->
                val isSelected = activeSubProduct == subProd
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            if (isSelected) DamHopperColors.Primary else DamHopperColors.SurfaceVariant
                        )
                        .clickable { activeSubProduct = subProd }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = subProd.label,
                        fontSize = 12.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.SemiBold,
                        color = if (isSelected) Color.Black else DamHopperColors.TextSecondary
                    )
                }
            }
        }

        // Selected Sub-Product View
        when (activeSubProduct) {
            ResourcesSubProduct.FLEET -> {
                FleetScreens(
                    controller = hostController,
                    modifier = Modifier.weight(1f)
                )
            }
            ResourcesSubProduct.USAGE -> {
                UsageScreens(
                    controller = usageController,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}
