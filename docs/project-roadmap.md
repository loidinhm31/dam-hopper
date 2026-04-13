# DamHopper Project Roadmap

This document outlines the high-level roadmap for DamHopper development, tracking progress across major phases and milestones.

## Status Overview

- **Current Phase:** Phase 05: Write Operations (In Progress)
- **Last Milestone:** Phase 04: Monaco Editor + Save (Completed 2026-04-09)
- **Next Milestone:** Phase 05: Create/delete/move/rename operations

## Roadmap Phases

### Phase 01: IDE File Explorer
**Status: [COMPLETED]**
- [x] Filesystem sandbox
- [x] List/read/stat REST endpoints
- [x] Binary detection
- [x] Path validation and security checks

### Phase 02: File Watcher
**Status: [COMPLETED]**
- [x] inotify integration (Linux) / notify crate (Cross-platform)
- [x] WebSocket subscription + fs:event push
- [x] Live tree sync on file changes
- [x] Debounced events for UI performance

### Phase 03: IDE Shell
**Status: [COMPLETED]**
- [x] react-resizable-panels layout (tree | editor | terminal)
- [x] react-arborist file tree with live sync
- [x] TanStack Query + useFsSubscription hook
- [x] /ide lazy route with feature gate

### Phase 04: Monaco Editor + Save
**Status: [COMPLETED]**
- [x] Monaco integration with tab management
- [x] Ctrl+S save via 3-phase WS write protocol (begin → chunks → commit)
- [x] File tiering (normal <1MB, degraded 1-5MB, large ≥5MB, binary)
- [x] Mtime-guarded atomic writes (conflict detection)
- [x] ConflictDialog (overwrite or reload on concurrent edits)
- [x] LargeFileViewer (range reads), BinaryPreview (hex dump)
- [x] **Performance Optimization: Binary Streaming for Large Files** (Completed 2026-04-14)
    - [x] Binary protocol for `fsWriteFile`
    - [x] Disk-backed buffering via `NamedTempFile`
    - [x] Optimized client-side transport for binary frames

### Phase 05: Write Operations
**Status: [IN PROGRESS]**
- [ ] Create file/directory
- [ ] Delete file/directory
- [ ] Move/rename operations
- [ ] Undo/history tracking

### Phase 06+: Advanced Features
**Status: [PLANNED]**
- [ ] Advanced Terminal (split panes, session persistence, search)
- [ ] Git integration UI (blame, diff)
- [ ] AI assistant integration (Gemini/Claude)
- [ ] Multi-workspace management UI

## Recent Milestones

- **2026-04-14:** Implemented Binary Streaming for Large File Writes.
    - Switched `fsWriteFile` from base64 text frames to zero-overhead binary frames for large files.
    - Introduced `NamedTempFile` buffering on the server to prevent RAM spikes during large saves.
    - Updated `ws-transport.ts` to support the hybrid JSON+Binary protocol.
- **2026-04-09:** Completed Phase 04: Monaco Editor + Save.
- **2026-03-25:** Completed Phase 03: IDE Shell.

## Success Metrics Tracking

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Workspace load time | <200ms | ~150ms | ✓ Passing |
| File explorer response | <100ms | ~45ms | ✓ Passing |
| Large file save (10MB) | <2s | ~1.2s | ✓ Passing |
| Memory usage (10MB save) | Constant | Constant | ✓ Passing |
