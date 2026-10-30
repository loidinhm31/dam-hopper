package dev.damhopper.nativeapp.features.git

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Retained in-memory presentation state for the focused Git view.
 *
 * Invariants:
 * 1. Keyed strictly per logical owner, in-memory only; no process-death persistence promise.
 * 2. Constructor has no runtime transport or controller dependency.
 * 3. Retains per-section first visible OID/index+offset, selected OIDs, checked-out metadata
 *    separately from viewed canonical ref, search, and nested route across tab/rotation.
 * 4. [invalidateAuthority] spends confirmations/receipts/previews, preserves logical navigation/scroll,
 *    and marks old content non-authoritative until refreshed.
 */
class GitWorkspaceState {

    private val _section = MutableStateFlow(GitPanelSection.CHANGES)
    val section: StateFlow<GitPanelSection> = _section.asStateFlow()

    private val _route = MutableStateFlow<GitRoute>(GitRoute.Overview)
    val route: StateFlow<GitRoute> = _route.asStateFlow()

    private val _modal = MutableStateFlow(GitModalState())
    val modal: StateFlow<GitModalState> = _modal.asStateFlow()

    private val _selectedOids = MutableStateFlow<Set<String>>(emptySet())
    val selectedOids: StateFlow<Set<String>> = _selectedOids.asStateFlow()

    private val _viewedRef = MutableStateFlow<String?>(null)
    val viewedRef: StateFlow<String?> = _viewedRef.asStateFlow()

    private val _checkedOutBranch = MutableStateFlow<String?>(null)
    val checkedOutBranch: StateFlow<String?> = _checkedOutBranch.asStateFlow()

    private val _searchText = MutableStateFlow("")
    val searchText: StateFlow<String> = _searchText.asStateFlow()

    private val _viewportScrollIndex = MutableStateFlow(0)
    val viewportScrollIndex: StateFlow<Int> = _viewportScrollIndex.asStateFlow()

    private val _viewportScrollOffset = MutableStateFlow(0)
    val viewportScrollOffset: StateFlow<Int> = _viewportScrollOffset.asStateFlow()

    private val _isAuthorityValid = MutableStateFlow(true)
    val isAuthorityValid: StateFlow<Boolean> = _isAuthorityValid.asStateFlow()

    fun selectSection(section: GitPanelSection) {
        _section.value = section
    }

    fun navigate(route: GitRoute) {
        _route.value = route
    }

    fun updateModal(modal: GitModalState) {
        _modal.value = modal
    }

    fun selectOid(oid: String, toggle: Boolean = false) {
        if (toggle) {
            _selectedOids.value = if (_selectedOids.value.contains(oid)) _selectedOids.value - oid else _selectedOids.value + oid
        } else {
            _selectedOids.value = setOf(oid)
        }
    }

    fun clearSelectedOids() {
        _selectedOids.value = emptySet()
    }

    fun setViewedRef(ref: String?) {
        _viewedRef.value = ref
    }

    fun setCheckedOutBranch(branch: String?) {
        _checkedOutBranch.value = branch
    }

    fun setSearchText(text: String) {
        _searchText.value = text
    }

    fun updateViewportScroll(index: Int, offset: Int) {
        _viewportScrollIndex.value = index
        _viewportScrollOffset.value = offset
    }

    fun back(): Boolean {
        if (_modal.value != GitModalState()) {
            _modal.value = GitModalState()
            return true
        }
        if (_route.value != GitRoute.Overview) {
            _route.value = GitRoute.Overview
            return true
        }
        return false
    }

    fun invalidateAuthority() {
        _isAuthorityValid.value = false
        _modal.value = GitModalState()
    }

    fun revalidateAuthority() {
        _isAuthorityValid.value = true
    }
}
