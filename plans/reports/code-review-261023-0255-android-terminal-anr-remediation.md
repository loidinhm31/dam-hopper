# Code Review Summary: Android Terminal ANR Remediation

**Report Path:** `plans/reports/code-review-261023-0255-android-terminal-anr-remediation.md`  
**Date:** 2026-10-23  
**Reviewer:** Senior Software Engineer (AnrCodeReviewer)  
**Score:** 8.5 / 10  
**Status:** COMPLETE (Ready for Phase 01 Task 3 Background Worker Offloading)

---

### Scope
- **Files reviewed:**
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalDisplaySnapshot.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalGrid.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt`
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt`
- **Lines of code analyzed:** ~950 lines across the 4 files
- **Review focus:** Atomic display snapshot migration, lock-free cursor blink, Compose `LazyColumn` binding, and ANR mitigation
- **Updated plans:** `plans/261023-0232-android-terminal-anr-remediation/plan.md`

---

### Overall Assessment
The migration to atomic display snapshots replaces the $O(N^2)$ `SnapshotStateList` element-by-element persistent vector churn with an $O(N)$ single reference publication using Compose's `referentialEqualityPolicy()`. Lock-free cursor blinking in `updateCursorBlink` eliminates UI-thread contention against `bufferLock`.

However, ANR remediation is only partially complete: PTY chunk parsing and row generation remain on `Dispatchers.Main` in `ProjectTerminalScreen`, pending the Phase 01 Task 3 background ingestion worker. Additionally, cursor movement beyond row extent increments `contentRevision` due to cursor padding in `baseText`, triggering unnecessary scroll follow events.

---

### Critical Issues
*None identified* (no memory leaks, fatal security vulnerabilities, or data loss).

---

### High Priority Findings

1. **Content revision increments on horizontal cursor movement beyond row extent**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt:114–118`
   - **Problem:** `base` is obtained via `row.render(if (isCursorRow) grid.cursorCol else null, showCursor = false)`. When `cursorCol >= extent`, `VtTerminalRow.render` generates cursor-padded text (`paddedColumn = column`, invalidating the cached `padded` instance). When the cursor moves horizontally along empty space (e.g., from col 4 to col 5 on a short line), `baseText` reference changes (`!==`), forcing `contentChanged = true` and incrementing `nextRevision`.
   - **Impact:** `TerminalViewportEffects` observes `contentRevision` and recalculates scroll anchors / auto-scrolls to bottom on mere cursor movement, disrupting user reading position.
   - **Fix:** Obtain `base` using canonical content (`row.render(cursorColumn = null, showCursor = false)`) so `baseText` represents immutable row cells regardless of cursor position.

2. **Ingestion still executes on `Dispatchers.Main` (ANR risk remains under heavy burst)**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:495–513`
   - **Problem:** Flow collection occurs inside `LaunchedEffect`, running on `Dispatchers.Main.immediate`. `CoroutineStart.UNDISPATCHED` starts on the caller context (Main) and does not offload parsing. Every arriving chunk synchronously parses ANSI sequences and constructs all published rows in `VtTerminalSurface.syncLinesFromEngine`.
   - **Impact:** While snapshot publication avoids Compose persistent list mutation jank, heavy streaming bursts (e.g. 50,000 lines / thousands of small packets) still saturate UI thread CPU until the Phase 01 Task 3 background ingestion worker with frame-paced coalescing (30 FPS) is implemented.

---

### Medium Priority Improvements

1. **Missing disposal check in `syncLinesFromEngine`**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt:100`
   - **Problem:** `syncLinesFromEngine` does not check `if (_isDisposed) return`. If `surface.close()` is invoked while a feed operation is completing or if asynchronous parsing is introduced, `syncLinesFromEngine` will overwrite the empty snapshot set by `close()`, resurrecting disposed terminal content.
   - **Fix:** Add `if (_isDisposed) return` at the top of `syncLinesFromEngine()`.

2. **Publication fencing via `surfaceGeneration` is incomplete**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalSurface.kt:80–88, 125–138`
   - **Problem:** `feedOutput(reset = true)` resets the engine but does not increment `surfaceGeneration`. Additionally, `syncLinesFromEngine` does not validate that `surfaceGeneration` hasn't advanced during parsing.
   - **Fix:** Increment `surfaceGeneration++` on authoritative resets in `feedOutput` and verify generation before assigning `displaySnapshot`.

3. **Dead code in `VtTerminalGrid.kt`**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/VtTerminalGrid.kt:376–415`
   - **Problem:** `buildDisplaySnapshot(...)` is an unused duplicate implementation that lacks revision diffing and is never invoked.
   - **Fix:** Remove `buildDisplaySnapshot` from `VtTerminalGrid.kt` to satisfy DRY/YAGNI principles.

4. **Contract inconsistency on `TerminalDisplaySnapshot.cursorRow`**
   - **File:** `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalDisplaySnapshot.kt:24`
   - **Problem:** `TerminalDisplaySnapshot.cursorRow` stores the screen-relative row (`grid.cursorRow`), whereas the specification in `phase-01-anr-remediation.md:83` defines it as the index into published `rows` including scrollback. The published row index is currently exposed via `cursorIndex`.
   - **Recommendation:** Document or reconcile the property semantics before external callers depend on `cursorRow`.

---

### Low Priority Suggestions

1. **Overlay projection optimization for cursor blink**
   - In `TerminalDisplaySnapshot.withCursorBlink`, shallow-copying `ArrayList(lines)` allocates a new pointer array (24 to 2,000 references) every 500ms. While sub-microsecond in practice, an immutable overlay view anchored to canonical rows would eliminate array allocations during idling.

---

### Positive Observations

- **Atomic reference swap:** Single assignment to `displaySnapshot` via `referentialEqualityPolicy()` completely eliminates quadratic persistent-vector tree comparisons.
- **Lock-free cursor blink:** UI thread never contends on `bufferLock` during 500ms blink cycles.
- **Referential row comparison:** `oldSnapshot.rows[i].baseText !== base` uses reference equality on cached `VtTerminalRow` styled strings, avoiding expensive `AnnotatedString` content diffing.
- **Backward compatibility:** Legacy accessors `lines`, `lineIds`, and `updateRevision` continue to work cleanly for existing callers.
- **Clean Compose keying:** `LazyColumn` uses `lineIds[index]` as persistent row keys, preserving item nodes across scroll and content appends.

---

### Recommended Actions

1. **Fix `baseText` calculation in `syncLinesFromEngine`:**
   Use unpadded canonical base string (`row.render(cursorColumn = null, showCursor = false)`) so cursor horizontal movement does not bump `contentRevision`.
2. **Add guard in `syncLinesFromEngine`:**
   Add `if (_isDisposed) return` at entry.
3. **Remove dead code:**
   Delete `buildDisplaySnapshot` in `VtTerminalGrid.kt`.
4. **Implement Phase 01 Task 3:**
   Offload PTY chunk ingestion from `ProjectTerminalScreen` to `TerminalIngestionWorker` with a 33ms frame-pacing ceiling and trailing flush.

---

### Metrics & Validation
- **JVM Terminal Tests:** 111 / 111 passed (`:shared:jvmTest --tests 'dev.damhopper.nativeapp.features.terminal.*'`).
- **Android Compilation:** `:androidApp:assembleDebug` completed successfully.
- **Device ANR Qualification:** `BLOCKED_PENDING_DEVICE` (requires physical/emulator trace under 50,000+ line burst).

---

### Unresolved Questions
- None. (Next step is proceeding to Phase 01 Task 3: off-UI-thread serialized ingestion worker).
