package dev.damhopper.nativeapp.features.git

/**
 * Receipt emitted upon successful atomic commit message rewrite or commit squash
 * on an active or inactive local branch.
 */
data class RewriteReceipt(
    val branch: String,
    val sourceOid: String,
    val oldHeadOid: String,
    val targetOid: String,
    val rewrittenCount: Int,
    val scope: GitOperationScope,
)
