package dev.damhopper.nativeapp.platform.editor

import dev.damhopper.nativeapp.core.model.ConnectionRef
import dev.damhopper.nativeapp.features.git.DiffLayoutMode
import dev.damhopper.nativeapp.features.git.DiffRow

/**
 * Metadata record for native Android diff, merge, and blame review surfaces.
 */
data class CandidateReviewSurface(
    val name: String = "Native Review Surfaces",
    val version: String = "1.0.0",
    val supportsSideBySide: Boolean = true,
    val supportsInlineDiff: Boolean = true,
    val supports3WayMerge: Boolean = true,
    val supportsBlameGutters: Boolean = true,
    val notes: String = "Native Android Jetpack Compose diff, merge conflict, and blame surfaces qualified under Phase 10."
)

/**
 * Platform bridge for native Android review surfaces.
 */
class NativeReviewSurfaces(
    val candidate: CandidateReviewSurface = CandidateReviewSurface(),
) {
    fun formatHunkHeader(hunkIndex: Int, totalHunks: Int): String {
        return if (totalHunks > 0) "Hunk ${hunkIndex + 1} of $totalHunks" else "No hunks"
    }

    fun isSideBySideSupported(): Boolean = candidate.supportsSideBySide
}
