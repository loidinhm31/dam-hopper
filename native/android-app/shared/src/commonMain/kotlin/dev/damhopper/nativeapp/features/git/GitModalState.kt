package dev.damhopper.nativeapp.features.git

import dev.damhopper.nativeapp.features.workspace.ProjectWorktree

data class GitModalState(
    val editMessageTarget: GitLogEntry? = null,
    val squashTargetHashes: List<String>? = null,
    val showLeasedPushDialog: Boolean = false,
    val resetTarget: GitLogEntry? = null,
    val dropTarget: GitLogEntry? = null,
    val revertTarget: GitLogEntry? = null,
    val showUndoCommitDialog: Boolean = false,
    val showCreateBranchDialog: Boolean = false,
    val showAddWorktreeDialog: Boolean = false,
    val removeWorktreeTarget: Pair<ProjectWorktree, WorktreeRemovalPrecheck>? = null,
    val actionErrorResult: GitActionResult? = null,
)
