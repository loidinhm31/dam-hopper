# Research Report: PR #49 Filesystem Invariants & Security Review

## Executive Summary & Methodology
- Scope: Evaluate PR #49 changes in `server/src/fs/secure_path.rs`, `server/src/plans/scan.rs`, `server/src/api/ws.rs`, `server/src/api/plans.rs`.
- Focus: Descriptor-relative symlink-resistant reads, directory watch replacement / atomic-save semantics, resource bounds.
- Sources Consulted: 2 external primary sources (Linux Programmer's Manual). No broad survey.

## Primary Sources & Core Invariants

### 1. Descriptor-Relative Symlink-Resistant Reads
**Citation:** Linux Programmer's Manual, `openat2(2)`: *open and possibly create a file (extended)*, `https://man7.org/linux/man-pages/man2/openat2.2.html`. (Cross-ref: POSIX.1-2008 `openat(2)` / `fstatat(2)`).
- **Invariant 1.1 (Component Step Traversal):** Never resolve multi-component untrusted paths via ambient string `open()`/`stat()`. Open verified root descriptor with `O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW`; traverse intermediate components step-by-step via `openat(current_fd, comp, O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)`.
- **Invariant 1.2 (Atomic Leaf Open):** Open target leaf file with `openat(parent_fd, leaf_name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)`. Symlink avoidance must occur inside kernel resolution, not via pre-check (eliminates TOCTOU).
- **Invariant 1.3 (Descriptor-Bound Verification):** Execute `fstat(fd)` on opened descriptor, never on path string. Verify `(st_mode & S_IFMT) == S_IFREG`.
- **Invariant 1.4 (Pre/Post Stat Race Detection):** Record `fstat` before read and verify against `fstat` after read (`st_size`, `st_mtime`, `st_mtime_nsec`). Detects concurrent truncations or writes during read.
- **Invariant 1.5 (Root Identity Preservation):** Capture `(st_dev, st_ino)` of root directory at operation start; revalidate upon completion to detect workspace root mounts/replaces.

### 2. Directory Watch Replacement & Atomic-Save Semantics
**Citation:** Linux Programmer's Manual, `inotify(7)`: *monitoring filesystem events*, `https://man7.org/linux/man-pages/man7/inotify.7.html`.
- **Invariant 2.1 (Parent Directory Watch Requirement):** Atomic file saves write to temp file then rename over target (`renameat`). Inode watches on target file receive `IN_DELETE_SELF`/`IN_ATTRIB` then `IN_IGNORED`, abandoning future updates. Reactive file tracking MUST monitor containing directory for `IN_MOVED_TO` / `IN_CREATE`.
- **Invariant 2.2 (Ancestor Chain Coverage):** Directory renames require ancestor watches. To detect moves anywhere in the path, all ancestors up to root must be watched non-recursively.
- **Invariant 2.3 (Non-Recursive Watch Bounding):** Recursive watches on workspaces risk inotify watch exhaustion (`/proc/sys/fs/inotify/max_user_watches`). Watch only discrete ancestor directory set.
- **Invariant 2.4 (Overflow & Slow Consumer Ejection):** Event pumps must drop lagged subscriptions and signal overflow rather than buffering unbounded events or stalling backend workers.

## Codebase Analysis vs Invariants

### 1. `server/src/fs/secure_path.rs`
- **Unix Implementation (`mod unix`):**
  - Conforms to Invariants 1.1–1.5: `open_parent()` steps components via `open_child_directory()` using `O_DIRECTORY | O_NOFOLLOW`. Leaf opened via `libc::openat(..., O_NOFOLLOW)`. `fstat()` verifies regular file, bounds reading via `take(max_bytes + 1)`, and re-checks `fstat()` size/mtime/mtime_nsec.
- **Windows Implementation (`#[cfg(not(unix))]` Defect):**
  - **Violation:** `probe_file_marker`, `read_immediate_dir`, and `read_regular_snapshot` use `root.join(relative)` and `std::fs::symlink_metadata(&target)`. Only the leaf component is checked. If an intermediate path component (e.g. `plans/junction/plan.md`) is an NTFS junction or symlink, `File::open(&target)` traverses outside the sandbox root.

### 2. `server/src/plans/scan.rs`
- **Path Validation:** `validate_plans_relative_path` enforces `plans/` prefix, rejects `ParentDir`, caps path at 4096 bytes and 32 components.
- **Marker & Plan Handling (Contract Aligned):** Per `phase-02` line 52, folders without a regular `plan.md` marker are classified as `Group`/`Collection` without recursive descent. Per `phase-02` line 55, missing non-root `plan.md` in selected plan read intentionally yields 404.
- **Ancestor Watches:** `compute_watch_paths` correctly builds discrete ancestor directories `["." , "plans", ...]`, capped at `MAX_WATCH_PATHS = 33`.

### 3. `server/src/api/ws.rs` & `server/src/api/plans.rs`
- **`watch_only: true`:** `do_fs_subscribe` validates `abs_path.is_dir()`, calls `subscribe_target_directory`, and returns empty `TreeSnapshot { nodes: vec![] }`. Eliminates full-tree traversal overhead while providing reactive directory invalidation.
- **`read_mode: "plan-document"`:** Validates `.md` extension, enforces 64 KiB ceiling, rejects null bytes / invalid UTF-8, and revalidates `target_root` identity. Contractually permits reading Markdown outside `plans/` within the captured target root (e.g., referenced evidence or specs per `phase-02` lines 24 & 56).
- **Target Revalidation:** `get_plan_folders` and `get_selected_plan` capture `initial_root_id` and re-verify `current_root_id == initial_root_id` plus `state.resolve_project_target` post-scan, enforcing Invariant 1.5.

## Resource Bounds Matrix

| Resource | PR #49 Boundary | Location | Enforcement / Failure Mode |
| :--- | :--- | :--- | :--- |
| Document read size | 64 KiB (`MAX_DOCUMENT_BYTES`) | `scan.rs:343`, `ws.rs:2213` | `Read::take(max + 1)`, returns `TOO_LARGE` / `Oversize` |
| Directory entries visited | 5,000 (`MAX_VISITED_ENTRIES`) | `scan.rs:9, 233` | Stops loop, sets `complete = false`, `limits_reached: ["entries"]` |
| JSON response size | 2 MiB (`MAX_JSON_BYTES`) | `scan.rs:13, 285` | Pops folder entries until <= 2 MiB, sets `complete = false` |
| Path length & components | 4096 bytes / 32 components | `scan.rs:10-11, 99, 127` | Returns `PlansError::PathRejected` |
| Ancestor watch paths | 33 paths (`MAX_WATCH_PATHS`) | `scan.rs:12, 155` | `paths.truncate(33)` |
| Watcher event queue | 256 messages (`FS_CHAN_CAP`) | `ws.rs:3221` | Drops lagging subscriber, emits `FsOverflow`, unregisters watcher |

## Concrete Review Checklist

1. [ ] **Cross-Platform Ancestor Traversal:** Fix `#[cfg(not(unix))]` in `secure_path.rs`. Implement component-by-component ancestor verification or reject junctions before `File::open` on Windows.
2. [ ] **Atomic Save Event Handling in Watchers:** Verify front-end `useProjectPlans` invalidates cache on both `Created` and `Renamed` `FsEvent` types received on ancestor watches.
3. [ ] **Watch-Only Directory Invariant:** Ensure `do_fs_subscribe` with `watch_only: true` strictly returns `PATH_REJECTED` when given a non-directory path (verified present at `ws.rs:3122`).
4. [ ] **Double-Stat Integrity on macOS / non-Linux Unix:** In `secure_path.rs:614`, `mtime_nanos` defaults to 0 on non-Linux; ensure macOS `st_mtimespec` is supported to prevent nano-second race condition misses.

## Resolved Inquiries (Tracked Contract & Implementation)
1. **Detail Markdown scope outside `plans/`:** RESOLVED. Tracked `phase-02` lines 24 & 56 explicitly authorize strict `.md` detail reads anywhere within the captured target root (to display linked evidence/specs) under the 64 KiB ceiling.
2. **Incomplete folder listing handling in UI:** RESOLVED. `packages/ui/src/components/organisms/ProjectPlanFolderBrowser.tsx` lines 76–77 and 181–193 explicitly evaluate `!foldersData?.listing.complete || limitsReached.length > 0` and display an `AlertTriangle` warning banner with visited count.

## Unresolved Questions
None.
