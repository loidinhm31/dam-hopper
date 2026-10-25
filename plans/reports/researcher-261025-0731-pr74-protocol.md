# PR #74 Protocol Research: LSP 3.17 + Monaco contracts

Scope: protocol invariants for cancellation, versioning and incremental sync, definition/LocationLink, and Monaco provider/model lifecycle. Goal: review PR #74 (dirty edits, reconnects, stale model/profile responses). External docs only; no repo reads.

## Sources (2 primary)
- [S1] LSP 3.17 spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ (anchors `#cancelRequest`, `#responseMessage`, `#messageOrdering`, `#textDocuments`, `#versionedTextDocumentIdentifier`, `#textDocument_didOpen/didChange/didClose/didRename`, `#locationLink`, `#textDocument_definition`, `#shutdown`)
- [S2] Monaco API typings `monaco-editor@0.57.0/monaco.d.ts`: https://unpkg.com/monaco-editor@0.57.0/monaco.d.ts (line refs below)
- Fetch accounting: 2 distinct URLs. The spec URL was fetched twice (reader view, then raw HTML). The Monaco URL was accessed 4 times (one read, one grep, one ranged read, one grep); cache hits unknown. Within the 3-source cap, but more than 3 network accesses.

## A. Cancellation / response invariants [S1]
- A1: Every request MUST get a response, including cancelled ones: "can not be left open / hanging". Cancellation is `$/cancelRequest {id}`, and the server may ignore it (`$/` messages are optional).
- A2: Client-cancel error code is `RequestCancelled -32800`. `ContentModified -32801` means content changed "outside normal conditions". The server "should NOT send" it for changes it sees in its own unprocessed queue: "result even computed on an older state might still be useful". **So the server may return results computed on stale text; only the client can detect staleness.**
- A3: `ServerCancelled -32802` applies only to requests that explicitly support server cancellation (3.17). `RequestFailed -32803` = valid request that failed.
- A4: Ordering: responses come in "roughly" request order. The server "most likely should not reorder textDocument/definition and textDocument/rename". Notifications such as didChange must reach the server before a later request on the same doc.
- A5: After `shutdown` the client must send nothing except `exit`; the server answers later requests with `InvalidRequest`. Exit code is 0 only if shutdown was received first.

## B. Document sync / versioning [S1]
- B1: didOpen/didClose are balanced; max open count per URI is 1. While a doc is open the server MUST NOT read its content from the URI.
- B2: `version` increases on every change incl. undo/redo, and need not be consecutive. In `didChange` it is the version *after* all `contentChanges` are applied.
- B3: `contentChanges` apply sequentially: c1 on S→S′, c2 on S′→S″. An entry with only `text` replaces the whole doc. `rangeLength` is deprecated.
- B4: "Before requesting information… the client must ensure the document's state is synchronized" (sync v5, then request on v5).
- B5: A languageId change requires didClose then didOpen. A rename is close(old) then open(new).
- B6: Positions are 0-based line/char; char units come from the negotiated `positionEncoding` (default and mandatory `utf-16`; server echoes its choice in the `initialize` result). A char past line end clamps to line length. `\n`, `\r\n` and `\r` are all EOLs.
- B7: Server answers for closed docs are "independent of open/closed", i.e. it falls back to the URI's master (disk). [INFERENCE] With virtual/non-file URIs, the master may be unresolvable after close.

## C. Definition / LocationLink [S1][S2]
- C1: Result type is `Location | Location[] | LocationLink[] | null`. `LocationLink[]` only if the client set `textDocument.definition.linkSupport`. Partial results (`Location[] | LocationLink[]`) are possible if a `partialResultToken` is sent.
- C2: LSP `LocationLink` fields: `originSelectionRange?` (underline span, default = word at cursor), `targetUri`, `targetRange` (full symbol extent incl. comments), `targetSelectionRange` (reveal/select, e.g. name; MUST be inside `targetRange`).
- C3: Monaco `LocationLink` (S2 L8358-8376): `{originSelectionRange?, uri, range, targetSelectionRange?}`. Mapping: targetUri→`uri`, targetRange→`range`, targetSelectionRange→`targetSelectionRange`. `Definition = Location | Location[] | LocationLink[]` (L8378).
- C4: Monaco positions are 1-based line and column (L814-833). LSP is 0-based. Every range/position needs a ±1 conversion on both axes.

## D. Monaco provider + model lifecycle [S2]
- D1: `provideDefinition(model, position, token): ProviderResult<…>` (L8389). `ProviderResult = T | undefined | null | Thenable<…>` (L7512), so null/undefined are legal "no result" returns.
- D2: `CancellationToken.onCancellationRequested` fires at most once. Listeners added after cancellation still fire next tick (L376-378). It returns an `IDisposable` that must be disposed.
- D3: `getVersionId()` increments on any change incl. undo/redo (L2316-2319). `getAlternativeVersionId()` repeats values across undo/redo (L2321-2325), so it is unsafe for LSP `version`.
- D4: `model.id` is unique per model instance (L2307). URI alone does not distinguish a disposed-and-recreated model. Also available: `isDisposed()` (L2454), `onWillDispose` ("right before disposing", ~L2706), global `editor.onWillDisposeModel` (L1363), `onDidChangeModelLanguage` (L1369).
- D5: `IModelContentChangedEvent.changes` are "ordered from the end of the document to the beginning, so they should be safe to apply in sequence" (L3253). Each change has the *old* `range`, `rangeOffset` and `rangeLength` (L3320-3349). Event flags: `versionId`, `isUndoing`, `isRedoing`, `isFlush` (model reset), `isEolChange`.
- D6: `editor.setModel()` swaps models without disposing them (L3148, L6484). Editor `onWillChangeModel`/`onDidChangeModel` are distinct from model disposal.

## E. Invariants to verify in PR #74 (exact edge cases)
1. **Change order mapping.** Monaco `changes[]` → LSP `contentChanges[]` must keep Monaco order (end→start). Sorting ascending, or sending one didChange per change with ranges not recomputed, corrupts the server copy on multi-cursor edits. Test with multi-cursor typing at 2+ lines.
2. **Version source.** didChange `version` must equal `event.versionId` / `getVersionId()`, never `getAlternativeVersionId()`. Version must never go backwards for the same open doc, including undo then redo.
3. **64 KiB threshold switch.** When text crosses the threshold (either direction), check:
   - Is the full-text vs incremental decision per event?
   - Does a full-text event (`{text}` only) carry the same versionId?
   - Does any path use a different transport/queue than requests? That breaks B4/A4: a definition request could overtake a large-overlay sync and be answered on stale text.
4. **Flush/EOL events.** `isFlush` (`setValue`, external reload) and `isEolChange` must produce a full-text change or a close+open. Applying old-range deltas is not valid for them.
5. **1 MiB cap mid-session.** If a doc grows past the cap after didOpen, the client must close the doc or stop issuing requests for it. Silently dropping didChange leaves the server answering definitions on stale content (A2 says it may not signal ContentModified). Check the shrink-back path re-opens with full text and a fresh version.
6. **Balanced open/close across reconnect.** On WS reconnect:
   - If TSLS survived: no duplicate didOpen without a didClose (B1).
   - If TSLS restarted: re-didOpen every live model with current full text, then send changes. No didChange before didOpen.
   - Check where the gateway keeps open-doc state (per WS session vs per process) and that the reaper path clears it.
7. **Pending requests on disconnect/restart.** Every in-flight Monaco promise must settle: resolve null/undefined or reject, never hang (A1). The proxy should send `$/cancelRequest` upstream and swallow late responses whose ids belong to a dead session. Request ids must not collide across sessions if ids are reused/rewritten.
8. **Cancellation wiring.** `token.onCancellationRequested` → `$/cancelRequest` with the *upstream* id (post-rewrite). Dispose the listener on completion (D2). Map `-32800`, `-32801` and late-after-cancel results to `null`/`undefined`, with no user-facing error.
9. **Stale-response guard (client).** At request start capture `(model.id, model.getVersionId(), sessionEpoch, profileId/workspaceRoot)`. On response, drop it if:
   - `model.isDisposed()`;
   - `model.id` differs for the URI;
   - the epoch/profile changed.

   Decide whether a version change alone drops the result: the spec allows stale results, but `originSelectionRange` would then be off.
10. **Profile/workspace switch.** A profile change must bump the epoch, close all docs on the old server/profile, and reject old responses. Definition URIs from the old root must not be turned into Monaco models in the new profile.
11. **Model lifecycle.**
    - `onWillDispose` → didClose plus cancel of in-flight requests for that model.
    - Language change → close+open with the new languageId (B5).
    - `setModel` swap → no didClose unless the model is disposed (D6).
    - Same URI recreated → new didOpen allowed only after the prior didClose was sent.
12. **Result normalization.**
    - Handle a single `Location`, `Location[]`, `LocationLink[]`, `null` and `[]`.
    - LocationLink only if `linkSupport` was advertised.
    - Clamp or validate `targetSelectionRange ⊆ targetRange` (C2).
    - Convert 0→1-based (C4).
    - Translate `targetUri` from server URI to virtual URI and back exactly (percent-encoding, drive letters, `file://` vs custom scheme).
    - Decide how out-of-workspace targets (TS lib `.d.ts`, `node_modules`) are handled: filtered, read-only model, or null.
13. **Position encoding.** Check the `initialize` params' `general.positionEncodings` and the server's echoed `positionEncoding`. Monaco columns are UTF-16 code units [INFERENCE: JS string semantics; not stated in S2]. Only `utf-16` end-to-end avoids offset drift on non-ASCII and astral chars. If the Rust gateway rewrites ranges/offsets, it must count UTF-16, not bytes.
14. **Shutdown ordering.** The reaper should do `shutdown` (await response, bounded) → `exit` → signal. No forwarded requests after shutdown (A5). Pending client requests are settled per item 7.
15. **didClose for virtual URIs.** After close, TSLS falls back to disk (B7). For virtual/overlay-only docs, definition lookups after close should return null cleanly, not error or leak disk content.

## Validation status
- Research only; no repo files read, no product edits, no build/tests run.
- Claims are quoted or paraphrased from S1/S2. Items marked [INFERENCE] are not stated by the sources.

## Unresolved questions
- Which Monaco version does the PR pin? S2 is 0.57.0 (latest on unpkg). If the pin differs, re-check line refs and the `changes` ordering comment.
- Does PR #74 send `partialResultToken` or `workDoneToken` on definition? If yes, partial results need the same stale guard.
- Is the 64 KiB threshold full-vs-incremental per event, or a separate upload channel? This decides whether item 3 is a real ordering risk.
- Is one TSLS process shared across WS sessions/profiles (id rewriting, open-doc refcount) or one per session?
- What does the client advertise for `positionEncodings`, and does any Rust-side code transform ranges?
