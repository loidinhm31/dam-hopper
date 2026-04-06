# Phase 10: CI/CD + Distribution

## Context
- Parent: [plan.md](./plan.md)
- Depends on: [Phase 09](./phase-09-cleanup.md)

## Overview
- **Priority**: P3
- **Status**: Done ✓
- **Effort**: 4h

Set up build pipeline for Rust binary + React SPA distribution.

## Requirements

- GitHub Actions workflow for Rust build + test
- Cross-compilation for Linux x86_64 and Windows x86_64
- Web app build as standalone static files
- Release artifacts: server binary + web dist tarball
- Docker image (optional): Rust server + pre-built web files

## Implementation Steps

1. GitHub Actions workflow:
   - Rust: `cargo test`, `cargo build --release` (matrix: linux-x86_64, windows-x86_64)
   - Web: `pnpm install && pnpm build`
   - Upload artifacts
2. Release workflow: tag-triggered, creates GitHub release with binaries
3. Dockerfile (optional):
   ```dockerfile
   FROM rust:1.82-slim AS builder
   COPY server-rs/ .
   RUN cargo build --release
   
   FROM node:22-slim AS web
   COPY packages/web/ .
   RUN pnpm install && pnpm build
   
   FROM debian:bookworm-slim
   COPY --from=builder /app/target/release/dev-hub-server /usr/local/bin/
   COPY --from=web /app/dist /opt/dev-hub-web/
   ```
4. Systemd service file for Linux deployment
5. Document deployment options in README

## Todo

- [x] GitHub Actions: Rust CI (.github/workflows/ci.yml — test + build matrix + web build)
- [x] GitHub Actions: Web CI (Vite build for Linux x86_64 + Windows)
- [x] Cross-compilation setup (matrix: ubuntu-latest, windows-latest)
- [x] Release workflow (.github/workflows/release.yml — tag-triggered with SHA256 checksums)
- [x] Docker image (Dockerfile — multi-stage: Rust + Node + debian:bookworm-20250317-slim runtime)
- [x] Deployment docs (deploy/dev-hub.service — hardened systemd unit)

## Success Criteria

- CI passes on every PR
- Release produces downloadable binaries for target platforms
- Binary starts and serves API without Node.js dependency

## Risk Assessment

- **Cross-compilation**: Windows build needs MSVC or `cross` toolchain. ConPTY dependency for portable-pty on Windows.
- **libgit2 linking**: git2 crate needs cmake + libgit2 at build time. Static linking preferred for portable binary.
- **Binary size**: Rust release binary with all deps could be 20-50MB. Acceptable for server.

## Implementation Summary

**CI Pipeline** (.github/workflows/ci.yml)
- Runs on push/PR: Rust test suite + build matrix (ubuntu-latest, windows-latest)
- Web build: pnpm install + pnpm build
- Artifacts uploaded for validation

**Release Pipeline** (.github/workflows/release.yml)
- Triggered on tag push (v*)
- Generates SHA256 checksums for binaries
- Publishes GitHub release with downloadable artifacts

**Binary Distribution**
- Cargo.toml: added `vendored` feature flag for libgit2 static linking
- Release profile: `strip = true` for smaller binaries
- Runtime: Debian bookworm slim (48MB base + ~30MB binary)

**Deployment**
- Dockerfile: multi-stage build (Rust binary + pre-built web dist)
- systemd service: hardened unit with security sandboxing
- Zero Node.js dependency at runtime

## Next Steps

Project complete. Monitor production stability.
