# Interface Freeze & Callsite Transfer Ledger (Phase 02)

## 1. Authority & Identity Freeze

### `WorkspaceFileOwner` (`features/workspace/WorkspaceFileOwner.kt`)
- **Fields**: `profileId: ProfileId?`, `baseUrl: String`, `accountUser: String`, `project: String`, `worktreePath: String?`.
- **Identity Invariant**: Account identity is strictly the server-returned `AuthSession.user` from `AuthStatus.Authenticated` (or `"dev-user"` on loopback devMode). Labels or `ServerProfile.username` alone are never identities.
- **Normalization**: `normalizedBaseUrl` strips trailing slashes; `normalizedWorktreePath` and `relativePath` enforce forward slashes and reject root escape (`..` outside project root) or drive letters.
- **Matching**: `owner.matchesTarget(target: ProjectTargetRef)` asserts profileId, project, and worktree equality.

### `DocumentId` (`features/workspace/WorkspaceFileOwner.kt`)
- **Fields**: `owner: WorkspaceFileOwner`, `relativePath: String`, `tabIncarnation: Long`.
- **Canonical Equality**: Compares `owner`, `normalizedPath`, and `tabIncarnation`.
- **Monotonicity**: `tabIncarnation` is strictly monotonic per owner, surviving reconnects, closes, and reopens.
- **Rekeying**: `rekeyed(newPath: String)` updates `relativePath` while preserving owner and tab incarnation.
- **Presentation**: Length-prefixed structured encoding (`len:val/...`) prevents delimiter collision attacks.

### `FileAuthority` (`features/workspace/WorkspaceFileOwner.kt`)
- **Fields**: `owner: WorkspaceFileOwner`, `connection: ConnectionRef`, `socketRef: SocketInstanceRef?`, `retirementToken: Long`, `isRetired: Boolean`.
- **Validation**: `assertValid(target, requireSocket)` validates unretired state, target ownership, and live socket availability.

---

## 2. Transport & Operation Boundary Freeze

### `WsConnection` Expected-Socket Seam (`core/transport/WsConnection.kt`)
- **Socket Origin Message**: `SocketBoundMessage(socketRef: SocketInstanceRef, message: ServerMsg)`.
- **Observer**: `socketBoundMessages: SharedFlow<SocketBoundMessage>`, `subscribeSocketBound(predicate)`.
- **Expected-Socket Dispatch**:
  - `sendOnSocket(expectedSocketRef, msg)`: Atomically validates `activeSocketRef == expectedSocketRef` under `lifecycleMutex`, and re-verifies authority and live socket identity inside writer mutex immediately prior to frame transmission.
  - `requestOnSocket(expectedSocketRef, reqId, msg, timeoutMillis)`: Atomically registers request with expected socket in `correlator` and captures writer under `lifecycleMutex`, awaiting response outside lock without holding dispatch serialization.
  - Correlator stale response prevention: `WsRequestCorrelator.dispatch(msg, socketRef)` verifies `boundSocket == socketRef`.
### `ApiClient` Bounded Streaming (`core/transport/ApiClient.kt`)
- **Method**: `getBytesBounded(path, queryParams, maxBytes): ByteArray`.
- **Streaming Guard**: Streams chunks from `bodyAsChannel()` up to `maxBytes`. If exceeded, immediately cancels and throws without buffering whole unbounded response.
- **Error Bounding**: Caps error response bodies at 8 KiB.

### `FileOperationOutcome` (`features/files/FileOperationOutcome.kt`)
- `NotSubmitted(reason, cause)`: Wire transmission was provably not attempted.
- `Rejected(code, message, details)`: Authoritative server rejection (including `FsWriteResult.ok = false` or CAS conflict).
- `Confirmed(result)`: Authoritative matching server ACK/result.
- `Unknown(stage, opId, message, cause)`: Dispatch was attempted; result is ambiguous. Recorded in durable `QuarantinedOperation` before commit/op dispatch.
### `FileOperationArbiter` (`features/files/FileOperationArbiter.kt`)
- **Segment Conflict Logic**: `a` and `ab` do not conflict; `a` and `a/b` conflict (ancestor-descendant); `""` conflicts with all.
- **Atomic Mutation Reservation**: `tryReserveMutation(owner, source, dest)` reserves both subtrees or none.
- **Child Save Capability**: `createChildSaveToken(parentToken, savePath)` requires MUTATION_SUBTREE parent and strict directional containment (`isPathAncestorOrEqual`); excludes only parent token so peer child saves conflict correctly.
- **Quarantine Invariant**: Quarantined tokens cannot be released via `releaseToken()`; require explicit `abandonQuarantine()`.

### `FileWatchContracts` (`features/files/FileWatchContracts.kt`)
- `FileWatchDemand`: Nonrecursive directory watch reference-counted by `WatchConsumerKind` (`EXPLORER_EXPANDED_DIRECTORY`, `OPEN_DOCUMENT_PARENT`).
- `WatchSubscriptionState`: Exact origin socket binding and monotonic `subscribeIncarnation`.
- `WatchQueueLimits`: `MAX_EARLY_EVENT_COUNT = 128`, `MAX_EARLY_EVENT_BYTES = 65_536`, `MAX_HISTORY_EVENT_COUNT = 256`.

---

## 3. Editor Common Document & Session Ports Freeze

### `EditorDocument` (`features/editor/EditorDocument.kt`)
- Interactive authority backed on Android by Sora `0.23.4` `Content` subclass on Android Main dispatcher.
- StateFlows: `revision`, `length`, `lineCount`, `isDirty`, `canUndo`, `canRedo`, `isReadOnly`, `viewState`.
- Event Stream: `events: Flow<DocumentEvent>` for reactive UI updates and subscription bridges.
- Commands: `undo()`, `redo()`, `find()`, `nextMatch()`, `previousMatch()`, `setSelection()`, `setReadOnly()`, `rekey(newPath)`.
- Editing: `applyEdit(startLine, startCol, endLine, endCol, replacement, sourceToken)` with source-token suppression.
- Lifecycle: `replaceFromLoad()`, `snapshotForSave()`, `markSaved()`, `captureViewState()`, `getBudgetMetrics()`, `detachView()`, `close()`.

### `EditorSessionPorts` (`features/editor/EditorSessionPorts.kt`)
- `EditorTabMetadata`: Read-only presentation model containing zero full-text strings.
- `BoundedRangeWindow`: Windowed view model for large/read-only files (max 64 KiB).
- `CloseDecision` / `CloseIntent`: Preserves dirty revision guarded by user decision (`SAVE`, `DISCARD`, `CANCEL`).
- `ConflictResolutionChoice`: `RELOAD`, `EXPLICIT_OVERWRITE`, `CANCEL`.
- Ports: `EditorCommandPort`, `EditorDirtyGuardPort`, `EditorSaveOutcomePort`, `EditorTabLifecyclePort`, `EditorDocumentAccessPort`, `EditorRangeRequestPort`, `EditorSavePort`.

### `EditorContentLoader` Safety Guard
- `loadFullText`: If `readResult.isBinary` or `readResult.textContent == null` (e.g. invalid UTF-8 sequences), loading fails with `EditorLoadResult.Error` and never publishes an empty editable document.

---

## 4. Callsite Transfer & Ownership Matrix for Downstream Phases

| Phase | Assigned Component | Transferred File Ownership | Consumed Frozen Contracts |
|---|---|---|---|
| **Phase 03** | Editor Core & Session State | `features/editor/EditorContentLoader.kt`<br>`features/editor/EditorRepository.kt`<br>`features/editor/EditorTabsState.kt`<br>`features/editor/FileTierPolicy.kt`<br>`features/editor/EncryptedSaveCoordinator.kt` | `EditorDocument`, `EditorSessionPorts`, `WorkspaceFileOwner`, `DocumentId`, `FileOperationOutcome` |
| **Phase 04** | Explorer & Shared Watchers | `features/files/FileTreeState.kt`<br>`features/files/FileTreeSubscription.kt`<br>`features/files/FileMutationCoordinator.kt`<br>`features/files/TreeSubscriptionManager` | `FileWatchContracts`, `FileOperationArbiter`, `FileOperationOutcome`, `EditorDirtyGuardPort` |
| **Phase 05** | Android Native Editor Widget | `platform/editor/SoraEditorAdapter.kt`<br>`ui/components/NativeEditorPanel.kt`<br>`ui/screens/WorkbenchScreen.kt` bridge | `EditorDocument`, `EditorDocumentFactory`, `EditorSessionPorts`, `DocumentViewState` |

---

## 5. Retention & Memory Budget Policy

Derived from connected Android x86_64 API 36 measurements (`document-qualification.md`):
- **Normal Tier (`< 1 MiB`)**: `maxUndoStackSize = 200`, `maxUndoBytes = 2 MiB` UTF-16 payload.
- **Degraded Tier (`1 MiB .. < 5 MiB`)**: `maxUndoStackSize = 50`, `maxUndoBytes = 2 MiB` UTF-16 payload, plain-text syntax mode (`EmptyLanguage`), bracket matching and auto-complete disabled.
- **Estimated Document Memory**:
  $$\text{estimatedRetainedBytes} = (\text{utf8Length} \times 4) + \text{undoStackBytes} + (\text{inFlightSnapshotBytes} \times 2)$$
- **Workspace Memory Ceiling**: `64 MiB` aggregate budget, max `8` live retained `EditorDocument` instances, max `2` simultaneous degraded instances.
- **Eviction Rule**: When opening would exceed budget, cleanly evict clean inactive documents (retaining `EditorTabMetadata` and `DocumentViewState` for lazy reload); refuse open with actionable notice when all documents are dirty or in-flight. Never silently evict dirty or unresolved documents.
