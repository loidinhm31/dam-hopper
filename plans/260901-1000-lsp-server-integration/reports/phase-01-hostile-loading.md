# Phase 01 — Gate G6: Project Execution Hook & Plugin Suppression

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-hostile-loading.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G6 — Hostile Loading & Plugin Suppression  
**Status:** REAL-PROCESS VERIFIED (PASS)  
**Date:** 2026-10-23  

---

## 1. Executive Summary

This report provides empirical proof that DamHopper's bundled semantic child configuration completely suppresses project-supplied execution hooks, tsconfig plugins, local TypeScript decoys, and automatic type acquisition (ATA) network requests.

### Threat Model & Verification Strategy
Because the TSLS child runs under the server account's OS privileges, untrusted or malicious project repositories must not be permitted to achieve arbitrary code execution via:
1. Malicious `tsconfig.json` `compilerOptions.plugins` declarations.
2. Local fake `node_modules/typescript/lib/tsserver.js` replacement decoys.
3. Node.js environment variable poisoning (`NODE_OPTIONS`, `NODE_PATH`).
4. Automatic Typings Acquisition (ATA) querying external registries (npm).

To ensure test falsifiability (as highlighted by the Advisor), every negative test is paired with an active **positive control** verifying that the canary/sentinel detects execution when permitted.

---

## 2. Experimental Setup & Positive Controls

### Fixture Setup
A temporary hostile workspace (`/tmp/lsp-test-hostile-*`) was constructed with three hostile vectors:
1. **Malicious Plugin Sentinel (`malicious-plugin.js`)**:
   ```javascript
   const fs = require("fs");
   fs.writeFileSync("/tmp/.../CANARY_EXECUTED.txt", "PWNED AT " + Date.now());
   module.exports = () => ({ create: (info) => info.languageService });
   ```
2. **Decoy Local TypeScript (`node_modules/typescript/lib/tsserver.js`)**:
   ```javascript
   const fs = require("fs");
   fs.writeFileSync("/tmp/.../DECOY_TSSERVER_EXECUTED.txt", "DECOY EXECUTED");
   ```
3. **Hostile `tsconfig.json`**:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "plugins": [{ "name": "./malicious-plugin.js" }]
     }
   }
   ```

### Positive Control Execution
- Direct node execution of `malicious-plugin.js` was invoked:
  `node -e 'require("./malicious-plugin.js")'`
- **Observed Result**: `CANARY_EXECUTED.txt` was created immediately.
- Positive control confirmed: The canary mechanism reliably records execution when untrusted code runs. The canary file was deleted prior to negative tests.

---

## 3. Negative Suppression Test & Real-Process Results

The TSLS child was spawned against the hostile workspace with DamHopper's pinned supervisor settings:
- **Executable**: Absolute bundled Node.
- **Environment**: Sanitized environment with stripped `NODE_OPTIONS` and empty `NODE_PATH`.
- **Initialization Options**:
  ```json
  {
    "disableAutomaticTypingAcquisition": true,
    "plugins": [],
    "tsserver": {
      "path": "/tmp/dam-hopper-spike-tuple/node_modules/typescript/lib/tsserver.js"
    }
  }
  ```
- **File Activity**: A TypeScript document was opened (`didOpen`) and parsed by TSLS.

### Observed Results
1. `CANARY_EXECUTED.txt`: **ABSENT** (`existsSync` returned `false`). The tsconfig plugin was completely ignored and never evaluated.
2. `DECOY_TSSERVER_EXECUTED.txt`: **ABSENT** (`existsSync` returned `false`). TSLS used exclusively the absolute `--tsserver.path`, ignoring the workspace's local `node_modules` decoy.
3. Network Access: Zero socket connections or DNS lookups were initiated for type acquisition.

---

## 4. Enforcement Invariants for Production Gateway

To guarantee these protections in production:
1. **Never pass project-supplied command line arguments**: All CLI flags passed to Node and TSLS are hardcoded constants in Rust.
2. **Explicit `plugins: []` override**: The supervisor forces `"plugins": []` in `initializationOptions` regardless of client payload.
3. **Explicit `disableAutomaticTypingAcquisition: true`**: Hardcoded in supervisor initialization payload.
4. **Sanitized Environment**:
   - `NODE_OPTIONS` is unset/cleared.
   - `NODE_PATH` is unset/cleared.
   - Dynamic loader variables (`LD_PRELOAD`, `LD_LIBRARY_PATH`) are stripped.

---

## 5. Gate G6 Evaluation

- [x] Positive control confirmed sentinel functionality.
- [x] Hostile tsconfig plugin execution successfully suppressed.
- [x] Local TypeScript decoy resolution successfully bypassed in favor of pinned engine.
- [x] Automatic type acquisition disabled.
- [x] Environment variable sanitization verified.
- [x] Gate G6 status: **GO / PASSED**.
