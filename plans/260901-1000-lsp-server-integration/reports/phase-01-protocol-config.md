# Phase 01 — Gate G3: Child Handshake, Capabilities Negotiation, and Configuration Replies

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-protocol-config.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G3 — TSLS Handshake & Server-Owned Config  
**Status:** VERIFIED ON REAL PROCESS (PASS)  
**Date:** 2026-10-23  

---

## 1. Executive Summary

This report documents the real-process verification of Gate G3 using the candidate bundled engine (`typescript-language-server` 6.0.2 with `typescript` 5.9.3 on Linux x64).

### Key Observable Findings
1. **Sync Kind**: TSLS advertises `textDocumentSync: 2` (Incremental). It does not advertise Full (1), but natively accepts full-document text replacements under this kind without error.
2. **Provider Capabilities**: Successfully advertises `definitionProvider: true` and `implementationProvider: true`.
3. **Server Configuration Replies**: TSLS initiates `workspace/configuration` JSON-RPC requests upon initialization. Our supervisor replies with server-owned, safe defaults (`[{}]`), satisfying the child and preventing deadlock.
4. **UTF-16 Character Offsets**: TSLS operates strictly on standard LSP 0-based UTF-16 code unit coordinates, directly matching Monaco Editor's position semantics.

---

## 2. Tested JSON-RPC Handshake Sequence

### Client `initialize` Request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "processId": 138900,
    "rootUri": "file:///tmp/lsp-test-clean-p7D2ir",
    "capabilities": {
      "textDocument": {
        "synchronization": {
          "dynamicRegistration": false,
          "willSave": false,
          "willSaveWaitUntil": false,
          "didSave": false
        },
        "definition": { "dynamicRegistration": false, "linkSupport": true },
        "implementation": { "dynamicRegistration": false, "linkSupport": true }
      },
      "workspace": {
        "configuration": true
      }
    },
    "initializationOptions": {
      "disableAutomaticTypingAcquisition": true,
      "maxTsServerMemory": 256,
      "plugins": [],
      "tsserver": {
        "path": "/opt/dam-hopper/lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js"
      }
    }
  }
}
```

### TSLS `initialize` Response (Observed)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": {
      "textDocumentSync": 2,
      "definitionProvider": true,
      "implementationProvider": true,
      "referencesProvider": true,
      "documentSymbolProvider": true,
      "workspaceSymbolProvider": true,
      "hoverProvider": true
    }
  }
}
```

### Server-to-Client `workspace/configuration` Request (Observed)
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "workspace/configuration",
  "params": {
    "items": [
      { "scopeUri": "file:///tmp/lsp-test-clean-p7D2ir", "section": "typescript" },
      { "scopeUri": "file:///tmp/lsp-test-clean-p7D2ir", "section": "javascript" }
    ]
  }
}
```
**Supervisor Response**: Immediately responds with `{ "jsonrpc": "2.0", "id": 0, "result": [{}, {}] }`. The server never exposes client environment variables, host paths, or unvalidated user settings in this reply.

---

## 3. Method Filtering & Gateway Policy

In the production gateway:
- **Client-to-Server Allowed Methods**:
  - `initialize` (mediated and synthesized by supervisor)
  - `initialized`
  - `textDocument/didOpen`
  - `textDocument/didChange`
  - `textDocument/didClose`
  - `textDocument/definition`
  - `textDocument/implementation`
  - `$/cancelRequest`
  - `shutdown` / `exit`
- **Denied Methods**:
  - All workspace editing requests (`workspace/applyEdit`)
  - Command execution (`workspace/executeCommand`)
  - Code action, renaming, and refactoring commands (out of MVP scope)
  - Dynamic capability registrations (`client/registerCapability` is ignored/rejected)

---

## 4. Gate G3 Evaluation

- [x] Real process handshake successfully executed and parsed.
- [x] Advertised capabilities verified (`textDocumentSync: 2`, `definitionProvider: true`, `implementationProvider: true`).
- [x] Fixed server configuration reply tested and confirmed non-blocking.
- [x] Method allowlist and denial filters defined.
- [x] Gate G3 status: **GO / PASSED**.
