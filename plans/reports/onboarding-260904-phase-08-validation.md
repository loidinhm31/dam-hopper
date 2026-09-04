# Onboarding Check — Linux Release Installer Architecture (Phase 08 Validation)

**Date:** 2026-09-04  
**Phase:** Phase 08 (Behavioral, Security, and Failure-Injection Validation)  

## Result

No new developer onboarding requirements were introduced by Phase 08.

- **Developer Tooling:** Standard developer workflow continues using `pnpm install`, `pnpm dev`, and `cargo test`.
- **Scoped Verification Scripts:** Added contributor verification commands in `package.json`:
  - `pnpm release:package-twice`: Exercises deterministic release archive generation and byte-for-byte SHA comparison.
  - `pnpm release:rootless-smoke`: Exercises dual-process API and web host serving on unprivileged dynamic ports.
  - `pnpm release:evidence-check`: Validates evidence JSON schemas and commit binding.
  - `pnpm test:deploy`: Runs all modular deployment test journeys.
- **Environment Invariants:** Local development continues using existing `~/.config/dam-hopper/dam-hopper.toml` and credentials. No `.env` files or tokens are ever packaged or leaked into release evidence.

## Host & Toolchain Requirements

- **Production Target:** Fedora 44, x86_64, systemd 259+, glibc 2.43+, SELinux Enforcing.
- **Prerequisites for Target Hosts:** `curl`, `tar`, `gzip`, `sudo`, `systemd`. (`gh` CLI optional for GitHub attestation verification).
- **Target Host Ports:** API server on `4801`, dedicated web host on `4802` (legacy port `4800` retired).

## Next Steps

1. Proceed to Phase 09 (Documentation, Roadmap, Changelog, and Release Cutover).
2. Rewrite `docs/linux-systemd.md` and update `README.md` to reflect the verified release architecture.
