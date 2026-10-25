package dev.damhopper.nativeapp.features.terminal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/**
 * Canonical English-label codec for the local status filter. Pure: no storage access and no migration.
 *
 * Decode is defensive (missing/unreadable/invalid => All). Encode writes `all`, a scalar label for one status, or a
 * compact JSON array of labels in canonical status order.
 */
class DefaultTerminalAgentsFilterCodec : TerminalAgentsFilterCodec {
    override fun decode(raw: String?): TerminalAgentsFilterSelection {
        if (raw.isNullOrEmpty() || raw == ALL) return TerminalAgentsFilterSelection.All
        statusForLabel[raw]?.let { return TerminalAgentsFilterSelection.Selected(listOf(it)) }
        val parsed = try {
            Json.parseToJsonElement(raw)
        } catch (_: Exception) {
            return TerminalAgentsFilterSelection.All
        }
        if (parsed !is JsonArray) return TerminalAgentsFilterSelection.All
        val statuses = parsed.mapNotNull { element ->
            (element as? JsonPrimitive)?.takeIf { it.isString }?.let { statusForLabel[it.content] }
        }
        return normalize(statuses)
    }

    override fun encode(selection: TerminalAgentsFilterSelection): String {
        val normalized = when (selection) {
            TerminalAgentsFilterSelection.All -> TerminalAgentsFilterSelection.All
            is TerminalAgentsFilterSelection.Selected -> normalize(selection.statuses)
        }
        if (normalized !is TerminalAgentsFilterSelection.Selected) return ALL
        val labels = normalized.statuses.map { TerminalAgentsPresenter.statusLabel(it) }
        return if (labels.size == 1) labels.single() else JsonArray(labels.map { JsonPrimitive(it) }).toString()
    }

    override fun normalize(statuses: List<TerminalAgentsStatus>): TerminalAgentsFilterSelection {
        val chosen = statuses.toSet()
        if (chosen.isEmpty() || chosen.size == TerminalAgentsStatus.entries.size) {
            return TerminalAgentsFilterSelection.All
        }
        return TerminalAgentsFilterSelection.Selected(TerminalAgentsStatus.entries.filter { it in chosen })
    }

    private companion object {
        const val ALL = "all"
        val statusForLabel: Map<String, TerminalAgentsStatus> =
            TerminalAgentsStatus.entries.associateBy { TerminalAgentsPresenter.statusLabel(it) }
    }
}
