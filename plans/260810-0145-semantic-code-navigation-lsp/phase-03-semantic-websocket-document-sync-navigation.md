# Phase 03 — Trust-Aware Semantic WebSocket, Sync, and Navigation

## Context links

- [Plan overview](./plan.md)
- [Phase 02 lifecycle](./phase-02-registry-supervisor-and-resource-lifecycle.md)
- [Existing WS handler](/mnt/data/ws/sharing/dam-hopper/server/src/api/ws.rs)

## Overview

- Priority: P1
- Status: completed — final review approved 9.5/10
- Effort: 24h
- Add authenticated semantic transport, project-relative sync/navigation, server-authoritative trust transitions/status, and cleanup that contains revocation and workspace races.

## Key Insights

- Semantic traffic stays off `/ws`, preventing LSP backpressure from affecting terminals, saves, and filesystem events.
- A socket may request a trust transition but cannot supply its policy. Transition remains challenge-bound, persisted, and version-checked.
- Results bind to epoch, document version, and trust policy revision; a trusted result cannot arrive after revocation.

## Requirements

- Add `/ws/semantic` with existing auth/no-auth policy and a typed handshake exposing only sanitized bundle/trust availability.
- Add challenge/transition/revocation API paths without bundle paths, executable details, checksum data, raw output, or policy internals.
- Support bounded `project`, document open/change/close, navigation/cancel, status/progress/error, replay, and same-project location mapping.
- Revocation, project close, workspace replacement, and shutdown cancel old work, release sessions, and notify clients with safe reasons.

## Architecture

- Connection gets opaque client ID, session epoch, and trust policy revision. `ProjectSandbox` resolves all `{ project, path }` inputs and returned URIs before browser mapping.
- Per-document snapshots retain language, text, versions, and lifecycle state. Navigation flushes changes and binds work to epoch/version/policy revision.
- Capability events publish trust deltas; workspace switch/revocation closes sessions before restricted new work is admitted.

## Related code files

- Create: `server/src/api/{semantic_ws,semantic_trust}.rs` and `server/src/semantic/{protocol,path_mapper}.rs`.
- Modify: `server/src/semantic/{session,supervisor}.rs`, `server/src/api/{mod,router,ws,workspace}.rs`.
- Create: `server/tests/ws_semantic_navigation.rs`.
- Delete: none.

## Implementation Steps

1. Implement bounded camelCase DTOs and safe errors; extract shared WS authentication without sharing queues.
2. Implement challenge/transition/status/revocation against `ProjectTrustStore`, with authenticated project scope, expiry, atomic policy revision, and audit reason.
3. Implement handshake, writer/reader limits, UTF-16 document state, resync, internal URI mapping, target bounds, and cancellation/deadlines.
4. Bind every dispatch and writer emission to policy revision; on revocation/workspace replacement cancel/reset sessions before client closure.
5. Test auth, isolation, unsaved edits, replay, version races, external omissions, cancellation, restricted→trusted, expiry, persistence, revocation during navigation, and `/ws` independence.

## Completion record

- [x] Handshake exposes only sanitized availability.
- [x] Trust transitions persist and are challenge-bound.
- [x] Paths and full-snapshot sync are bounded, project-relative, and fenced without absolute-path leakage.
- [x] Revocation/workspace switch leaves no old-policy session.
- [x] Final code review approved 9.5/10.
- [x] Validation: full Rust suite, semantic unit/integration/stress coverage, shared/UI/browser-bridge tests, TypeScript/build/lint/Prettier, and diff checks passed. Strict Clippy remains blocked by pre-existing unrelated repository warnings; coverage tools are unavailable.

## Success Criteria

- Unsaved edit changes next result without disk write.
- Old epoch/version/profile/workspace/policy/canceled work cannot navigate.
- Invalid semantic/trust traffic cannot degrade primary WebSocket, save, or terminal.

## Risk Assessment

- Revocation races with response. Mitigation: policy revision check before dispatch and before write.
- Consent retry can consume state twice. Mitigation: one-time challenge IDs and idempotent terminal transition response.

## Security Considerations

- Authenticate before upgrade; sandbox every path/result. Never trust language, desired trust, or initialization options to select command/policy.

## Next steps

- Phase 4 consumes trust/capability state, owns dwell timing, and presents non-modal navigation UX.
