# Phase 09 Documentation and Release Cutover Summary

**Date:** 2026-09-04  
**Phase:** 09 — Documentation, Roadmap, Changelog, and Release Cutover  
**Status:** PASS (documentation scope)  
**Owner evidence:** Phase 08 tester/reviewer handoff; maintained-document audit

## Current State Assessment

Maintained documentation now describes the attested Fedora 44 x86_64 release
installer as the supported Linux production path:

`bootstrap -> PENDING staging -> sudo dam-hopper start -> health-gated commit`

The operator contract separates `server`, `web`, and `both` roles; API
`dam-hopper-api.service` on `0.0.0.0:4801`; dedicated non-writing
`dam-hopper-web.service` on `0.0.0.0:4802`; root boot recovery; exact health
probes; automatic/manual rollback; and exact format-2 migration. Direct/Docker
port `4800`, Pages, desktop, and legacy nohup ownership remain explicitly
separate from the release manager.

## Scope Reviewed

- `deploy/release/dam-hopper-install.sh`
- `README.md`
- `docs/linux-systemd.md`
- `docs/linux-nohup.md`
- `docs/user-guide-multi-server-profiles.md`
- `docs/api-reference.md`
- `docs/system-architecture.md`
- `docs/code-standards.md`
- `docs/codebase-summary.md`
- `docs/project-overview-pdr.md`
- `docs/project-roadmap.md`
- `docs/CHANGELOG.md`
- `docs/linux-release-manager.md`
- `docs/configuration-guide.md`
- `docs/README.md`

## Changes and Consistency Checks

- README quickstart uses the downloaded bootstrap, role selection, pending
  status, explicit `sudo dam-hopper start`, rollback, and recovery. It states
  that target hosts need no compiler, Node.js, pnpm, Cargo, or Rust toolchain.
- `docs/linux-systemd.md` is the authoritative Fedora operator guide. It is
  313 lines and includes `curl`, `tar`, `gzip`, `sha256sum`, `sudo`, and
  `systemd` prerequisites; role/unit ownership; API/web health schemas; the
  20-second readiness plus 20 x 500 ms stability gate; durable state; retention;
  failure states; rollback; boot recovery; and format-2 migration.
- `docs/linux-nohup.md` labels nohup as unsupported legacy/recovery only and
  warns against manager-owned ports, SQLite files, and systemd units.
- Configuration/profile docs agree on machine-local runtime config, optional
  `apiUrl`, managed deployed profile precedence, token clearing on managed URL
  changes, exact credentialed origins, and no origin guessing from `Host` or
  port `4802`.
- API, architecture, code standards, PDR, and codebase summary agree on the
  API-only default, explicit Docker `--web-dir`, dedicated web host, root API
  MVP risk, unprivileged web account, Manifest v1, durable activation, and
  machine-local secret/database exclusion.
- `docs/codebase-summary.md` now records the generated Repomix snapshot and
  the actual Axum 0.8 / Axum WebSocket extractor stack.
- `docs/README.md` now points component readers at `packages/ui` and retargets
  the terminal lifecycle link to the existing `#session-status-helpers`
  heading.
- Roadmap and changelog record Phase 09 complete, Phase 08 evidence, and the
  breaking removal of checkout-runner scripts, fixed unit, fixture, and
  `linux:production` / `linux:reset` aliases.

## Verification Evidence

| Check | Result |
|---|---|
| `repomix -o repomix-output.xml` | PASS: 1,580 files; 3,279,350 tokens; 4 security-sensitive files excluded by the scanner. |
| `bash -n deploy/release/dam-hopper-install.sh` | PASS, exit 0. |
| Bootstrap `--help` | PASS: usage and all supported options emitted; the script intentionally exits 1 from `usage()`. |
| Manager `--help` and subcommand help | PASS: `fetch`, `install`, `role set`, `start`, `status`, `rollback`, `recover`, `validate`, and `version` grammar observed from implemented Clap help. |
| Relative file links | PASS: 145 references across root README + `docs/*.md`; 0 missing targets. |
| Anchor links | PASS: 18 checked; 0 missing anchors after CHANGELOG and `docs/README.md` retargeting. |
| Markdown smoke structure | PASS: 20 Markdown files; 546 fenced blocks with balanced delimiters; no empty Markdown links. |
| `node /home/loidinh/.omp/agent/evcrate/scripts/validate-docs.cjs docs/` | PASS with heuristic warnings: 19 files and 138 internal links reported working. |
| `wc -l docs/*.md` | PASS for the Phase 09 gate: `docs/linux-systemd.md` is 313 lines (<800). |

Phase 08 release evidence remains the implementation gate: Rust 1,018/1,018,
UI 1,447/1,447, clean UI/web builds, 11 shell syntax checks, deterministic
package-twice digest equality, rootless dual-process smoke, six deployment
journeys, and reviewer approval 9.8/10. This docs pass did not rerun the
project-wide suites.

## Stale Reference Audit

Search covered maintained docs plus README for the retired scripts, fixed unit,
old aliases, format-1 markers, musl claims, and implicit systemd SPA serving.
Remaining old names occur only in clearly labeled migration, rejection,
retirement, nohup warning, or changelog-history text. No runnable obsolete
checkout-runner command block remains in maintained operator guidance.

The validator's code-reference (550) and config-key (248) warnings are heuristic
false positives concentrated in historical changelog/API prose and protocol
terms such as `GET`, `PATCH`, `HEAD`, `PENDING`, and `RECOVERY_REQUIRED`; the
independent path/anchor checker found no broken links.

## Gaps and Recommendations

1. Five existing docs exceed the default 800-line maintenance target:
   `docs/system-architecture.md` (3,246), `docs/api-reference.md` (1,999),
   `docs/code-standards.md` (1,095), `docs/frontend-components.md` (1,041),
   and `docs/configuration-guide.md` (871). Splitting is future maintenance
   work; the Phase 09 acceptance gate applies the <800 requirement to the
   rewritten systemd operator guide.
2. The Repomix security scanner excluded four files; review those files
   separately when doing a security audit. Exclusion is not a documentation
   failure and no secrets were copied into docs.
3. Protected-host runtime evidence, DNS/TLS, firewall/Tailscale, external
   MongoDB, and unsupported distro qualification remain explicitly deferred;
   documentation does not claim those gates passed.
4. The docs validator should eventually distinguish Markdown code/protocol
   identifiers from function and environment-key references to reduce warning
   noise.

## Unresolved Questions

None.
