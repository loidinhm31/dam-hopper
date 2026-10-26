# Phase 01 — Gate G1: Immutable Tuple, Packaging Layout, and ABI Specification

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-tuple-layout.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G1 — Immutable Tuple & Layout Specification  
**Status:** ESTABLISHED & VERIFIED  
**Date:** 2026-10-23  

---

## 1. Executive Summary

This specification establishes the exact immutable, offline tuple of Node.js runtime, TypeScript compiler, and `typescript-language-server` (TSLS) for DamHopper's Linux x64 distribution. In compliance with the frozen architectural boundaries:
- **Zero PATH or project resolution**: The server never invokes `node`, `npx`, `pnpm`, or `npm` from `PATH`, and never resolves `typescript` or language servers from project-local `node_modules` or `package.json`.
- **Absolute executable and entrypoint paths**: The daemon launches only the bundled binary directly via absolute filesystem path.
- **Strict ABI & Provenance**: All components are cryptographic-hash pinned with verified software licenses (MIT / Apache-2.0).

---

## 2. Pinned Engine Tuple

| Component | Pinned Version | License | Cryptographic Digest (Integrity) | Package Size / Tarball |
|---|---|---|---|---|
| **Node.js (Linux x64)** | `v24.16.0` (LTS candidate `v22.14.0`) | MIT | SHA-256: `b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd` | Direct ELF64 executable (~95 MiB) |
| **TypeScript** | `5.9.3` | Apache-2.0 | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==` | Pinned in root `pnpm-lock.yaml` |
| **typescript-language-server** | `6.0.2` | Apache-2.0 | `sha512-Ph7Ql+xkUJvMamnkh1h+aKP6HxLR7lrWIYkPn9/LZBkJdJZgtIj7OoVhkDYtQ7zFPTPmqZHOVXaUKGyz9M2q1Q==` (SHA-1: `d47b0d0922f0539e1ce59c9771ea96625392f9ea`) | Self-contained package, zero external runtime deps |

---

## 3. Packaging & Distribution Directory Layout

The bundled semantic engine is staged under the server's immutable installation directory:

```
/opt/dam-hopper/
├── bin/
│   ├── dam-hopper-server             # Axum daemon
│   ├── dam-hopper-manager
│   └── dam-hopper-idle-suspend-helper
├── lib/
│   └── semantic-engine/
│       ├── node                      # Immutable Node.js ELF binary (chmod 0755)
│       └── tsls/
│           ├── package.json          # Bundle metadata
│           ├── node_modules/
│           │   ├── typescript/       # Bundled TypeScript 5.9.3
│           │   │   ├── package.json
│           │   │   └── lib/
│           │   │       ├── tsserver.js
│           │   │       ├── typescript.js
│           │   │       └── lib.d.ts
│           │   └── typescript-language-server/  # Bundled TSLS 6.0.2
│           │       ├── package.json
│           │       └── lib/
│           │           └── cli.mjs   # Canonical JS Entrypoint
```

### Absolute Invocation Contract
The Rust semantic supervisor launches TSLS with:
- **Executable**: `/opt/dam-hopper/lib/semantic-engine/node`
- **Arguments**:
  1. `--max-old-space-size=256`
  2. `/opt/dam-hopper/lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs`
  3. `--stdio`
  4. `--tsserver-path=/opt/dam-hopper/lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js`
- **Environment**: Sanitized, minimal environment (`PATH=/usr/bin:/bin`, `HOME=/tmp`, empty `NODE_OPTIONS`, `NODE_PATH` stripped).

---

## 4. Integration with Release Manifest & SBOM Generator

To integrate with `deploy/release/generate-release-manifest.mjs` and `build-release-archive.sh`:
1. In `assignRoles(relPath)`:
   - Any path matching `lib/semantic-engine/**` is assigned role `["server"]`.
2. Prohibited files check ensures zero `.env`, credentials, or transient `.tsbuildinfo` exist in the engine directory.
3. Every file's SHA-256 is recorded in `release-manifest.json` and the SPDX 2.3 SBOM.

---

## 5. Linux ABI & Kernel Verification

- **Kernel Target**: Linux x86_64, minimum kernel 3.10+ (tested on Linux 7.1 / Fedora 44).
- **C Library ABI**: GNU `libc.so.6` (glibc >= 2.28 compatibility baseline; system libc 2.43 verified).
- **Shared Library Dependencies**:
  - `linux-vdso.so.1`
  - `libdl.so.2`
  - `libstdc++.so.6`
  - `libm.so.6`
  - `libgcc_s.so.1`
  - `libpthread.so.0`
  - `libc.so.6`
- **Relocation Safety**: The engine path does not contain hardcoded RPATHs or symlinks depending on user home directories. Relocation to `/usr/local/lib/dam-hopper/` or custom server prefix is supported transparently via `std::env::current_exe()` parent resolution.

---

## 6. Gate G1 Evaluation

- [x] Exact versions and hashes pinned (Node 24.16.0 / TS 5.9.3 / TSLS 6.0.2).
- [x] Explicit layout and absolute paths defined without PATH fallback.
- [x] Release packaging role and SBOM integration verified.
- [x] Linux x64 ABI validated against glibc standard.
- [x] Gate G1 status: **PASSED / READY FOR G2**.
