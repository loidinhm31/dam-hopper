# Phase 06 — Hardening, Tests, Documentation, and Manual Gate

## Context links

- Parent: [plan.md](./plan.md)
- Brainstorm acceptance: [report](../../reports/brainstorm-260724-0114-browser-debug-embedded-selection.md)
- Architecture: [system architecture](../../docs/system-architecture.md)
- Standards: [code standards](../../docs/code-standards.md)

## Overview

- Date: 2026-07-24
- Description: Close security, reliability, browser-compatibility, and
  documentation gaps before calling the feature releasable.
- Priority: P1
- Implementation status: Complete (2026-07-25 16:02 +07)
- Review status: Reviewed 7.5/10; user approved (2026-07-25 16:02 +07)

## Key Insights

- Headless browser tests cannot exercise the real screen-share chooser.
- DOM text is a prompt-injection and terminal-control boundary.
- Existing diagnostics export can contain sensitive terminal tails; browser
  bundles must remain outside it.

## Requirements

- Unit, component, Rust integration, and Chromium browser coverage.
- Hostile fixtures: controls/ANSI, prompt injection, huge text, malformed
  messages, nested frames, navigation, denied capture.
- Keep-alive fixtures: mode/tool/compact transitions preserve the same iframe
  node; Browser close stops capture tracks but leaves the iframe off-screen.
- Auth/TTL/cleanup/size/MIME/atomicity/tunnel lifecycle coverage.
- Manual Chromium check for permission chooser, crop, zoom, HiDPI, and real
  xterm agent insertion.
- Update API, frontend, configuration/bridge, and security docs.

## Architecture

Tests must observe the planned invariants: exact origins/source/nonce, active
tunnel allowlist, server-generated ephemeral paths, no project writes,
metadata-only diagnostics, live-session validation, no auto-submit, and cleanup
on expiry/shutdown. Add no production fallback that weakens these boundaries.

## Related code files

- Create/modify `/mnt/data/ws/sharing/dam-hopper/server/tests/browser_debug_artifacts.rs`.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/tunnel/tests.rs`.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/ws_protocol.rs` tests
  only if new envelopes are added.
- Create/modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/browser-debug-panel.browser.tsx`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.test.tsx`.
- Create/modify focused UI tests from phases 01–05.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md`.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md`.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/configuration-guide.md`.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/CHANGELOG.md`.
- Keep `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` aligned
  with implementation; update Mermaid if data flow changes.

## Implementation Steps

1. Add unit tests for protocol, origin, capture geometry, handoff escaping,
   store expiry, artifact API, and tunnel allowlist.
2. Add real-temp integration tests for atomic files, permissions, expiry,
   delete races, stale sessions, and shutdown.
3. Add browser tests with mocked media APIs and real iframe message sources.
4. Record native Chromium permission chooser, HiDPI, live-tunnel, and real-xterm
   checks as manual release follow-up; these checks are not passed here.
5. Run hostile-page tests and inspect diagnostic exports for absence of payloads.
6. Record automated validation: UI 689 tests, Chromium 39 tests, Rust 494
   tests, build pass, and lint pass.
7. Update docs with supported origins, CSP snippet, bridge install, fallback
   behavior, artifact TTL, and known limitations.
8. Review diff against architecture and record any intentional drift.

## Todo list

- [x] Verify all automated acceptance coverage and release checks.
- [x] Verify no new dependency violates dependency policy.
- [x] Run changed-file lint and full tests.
- [ ] Complete native Chromium permission chooser, HiDPI, live-tunnel, and
  real-xterm release checks; not passed yet.
- [ ] Perform final manual security/release review.

## Success Criteria

- Automated release gate passes without ignored failures: UI 689, Chromium 39,
  Rust 494; build and lint pass.
- Native Chromium permission chooser, HiDPI, live-tunnel, and real-xterm checks
  remain manual release follow-up, not passed.
- Unsupported framing/capture/tunnel/session states fail closed and explain why.
- Docs accurately describe the extension-assisted client setup, parent-origin
  allowlist, cooperative framing requirement, and no target-app installation.

## Risk Assessment

- Browser-version variance may force DOM-only/manual screenshot as supported
  fallback.
- Tunnel URL lifecycle can race browser navigation; event invalidation must win.
- Test stubs may hide permission/coordinate issues; manual gate is mandatory.

## Security Considerations

- Review prompt injection, CSP, XSS, CSRF, SSRF, path traversal, and terminal
  escape handling as one end-to-end boundary.
- Verify the extension archive's configured parent-origin allowlist and reject
  unapproved parent handshakes; broad target match patterns must not become
  broad DamHopper parent authorization.
- Keep browser artifacts out of logs, diagnostics, persistence, project trees,
  and commits.
- Confirm auth middleware covers every new route and no token enters URLs.

## Next steps

After this phase, request final plan validation/review, then implementation
can begin phase-by-phase with code review after each substantial phase.

## Unresolved questions

- Final browser support matrix and artifact TTL/size values may be adjusted by
  feasibility/manual results, but any change must update architecture and plan.
