# Phase 01 — Gates G4 & G5: Adaptive Sync Contract & Navigation Freshness

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-sync-version.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gates:** G4 — Adaptive Sync Contract & G5 — Version/Freshness Fencing  
**Status:** **REAL-PROCESS VERIFIED (PASS)**  
**Date:** 2026-10-23 (Updated with Hardened Harness Results)  

---

## 1. Executive Summary

This report establishes the wire-level synchronization contract and request freshness guarantees between Monaco editor, the DamHopper semantic gateway, and `typescript-language-server` (TSLS), verified through real-process execution in `scripts/spike-lsp-test.mjs`.

### Empirically Proven Behaviors
1. **Single Negotiated Sync Kind (`Incremental = 2`)**:
   - TSLS requires `textDocumentSync: 2`.
   - The server negotiates `Incremental` with both client and child.
   - For documents `< 64 KiB`, whole-document updates are transmitted as a single `TextDocumentContentChangeEvent` without a range (`{ text: newContent }`). Real-process testing confirms TSLS fully supports range-less replacements under `Incremental` mode.
   - For documents `>= 64 KiB`, ranged edits (`{ range, text }`) minimize wire transfer.
2. **Bidirectional Threshold Crossing**:
   - Tested real files transitioning across the 64 KiB boundary in both directions:
     - Document opens at ~59.5 KiB (<64 KiB).
     - Ranged incremental edit expands it to ~70.5 KiB (>=64 KiB); definition resolves accurately in the large file state.
     - Range-less replacement shrinks it back to <64 KiB; definition updates accurately to line 0.
3. **Empty Document Lifecycle**:
   - Document opened with empty string `""` (`didOpen`).
   - Incremental edit added text (`didChange`).
   - Document closed (`didClose`).
   - Document reopened with new content (`didOpen` at version 1); definition resolved accurately.
4. **Unicode & Astral Plane Column Offset on the SAME Line**:
   - Line: `/* 🚀 */ const astralVal = 123; const testRef = astralVal;\n`
   - Astral emoji `🚀` consists of 2 UTF-16 code units (`\uD83D\uDE80`, 4 UTF-8 bytes).
   - Definition query sent at position `{ line: 0, character: 50 }` (targeting `testRef = astralVal`).
   - TSLS returned `targetSelectionRange.start.character = 15` (pointing to the definition of `astralVal`), proving exact UTF-16 code unit offset alignment on the same line after an astral emoji.
5. **G5 Unopened Destination File Resolution**:
   - `index.ts` imported `UNOPENED_SYMBOL` from `unopened.ts` on disk.
   - `unopened.ts` was never sent via `didOpen`.
   - Querying definition on `UNOPENED_SYMBOL` resolved directly to `targetUri: "file://.../unopened.ts"` on disk.

---

## 2. Wire Format Specification

### didChange Below 64 KiB (Full Replacement without Range)
```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/didChange",
  "params": {
    "textDocument": {
      "uri": "dam-hopper://semantic/target-1/src/index.ts",
      "version": 2
    },
    "contentChanges": [
      {
        "text": "// New complete file text below 64 KiB..."
      }
    ]
  }
}
```

### didChange At/Above 64 KiB (Ranged Edit)
```json
{
  "jsonrpc": "2.0",
  "method": "textDocument/didChange",
  "params": {
    "textDocument": {
      "uri": "dam-hopper://semantic/target-1/src/large.ts",
      "version": 4
    },
    "contentChanges": [
      {
        "range": {
          "start": { "line": 120, "character": 0 },
          "end": { "line": 120, "character": 10 }
        },
        "rangeLength": 10,
        "text": "newContent"
      }
    ]
  }
}
```

---

## 3. Freshness & Invalidation Fencing (G5)

Standard LSP `textDocument/definition` responses contain only location coordinates (`Location` or `LocationLink[]`), with no document version metadata. Stale responses are prevented via:

1. **Strict FIFO stdio ordering**: Because stdio is a strictly ordered stream, writes for version $V$ are sent to the child writer before the definition request for version $V$. TSLS processes edits sequentially before computing definitions.
2. **Gateway-Level Extension Fence**:
   - Client sends:
     ```json
     {
       "method": "textDocument/definition",
       "params": {
         "textDocument": { "uri": "..." },
         "position": { "line": 3, "character": 9 },
         "damHopperDocumentVersion": 2,
         "damHopperModelGeneration": 1
       }
     }
     ```
   - Gateway records `(requestId, uri, version, generation)`.
   - Gateway strips `damHopper*` fields before writing to child stdio.
   - When child returns response for `requestId`: if the client document has advanced to version 3 in the interim, the gateway **discards** the stale result and returns an empty navigation response or re-queries.
3. **Target & Session Generation**:
   - Connection re-attachments or workspace switches increment `sessionGeneration`. Results from prior generations are rejected.

---

## 4. Gates G4 & G5 Evaluation

- [x] Negotiated single `Incremental = 2` sync kind tested on real TSLS.
- [x] Range-less full update under Incremental mode accepted and verified.
- [x] Bidirectional 64 KiB threshold crossing verified (<64 KiB -> >=64 KiB -> <64 KiB).
- [x] Empty document open/edit/close/reopen cycle verified.
- [x] Same-line UTF-16 non-BMP astral character offset verified.
- [x] Unopened file destination navigation verified.
- [x] Gates G4 and G5 status: **GO / PASSED**.
