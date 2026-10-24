package dev.damhopper.nativeapp.features.git

/**
 * Receipt emitted upon successful contiguous commit squash on an active or inactive local branch.
 */
data class SquashReceipt(
    val branch: String,
    val sourceOid: String,
    val count: Int,
    val targetOid: String?,
    val scope: GitOperationScope,
)
