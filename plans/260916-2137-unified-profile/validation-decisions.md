# Confirmed validation decisions

Validated: 2026-09-16. Four primary questions plus one compatibility clarification. [Plan](plan.md).

These user-confirmed changes supersede the original preplan's legacy-restoration, additive-protocol-compatibility and unified-release decisions. Corresponding phase/contracts/qualification documents are updated; this is not an override hiding contradictory implementation instructions. No application implementation is authorized by this planning interview.

## Confirmed decisions

| Topic | User answer | Final contract |
|---|---|---|
| Ownership model | Profile-only ownership | Existing server resources remain authoritative; no backend workspace UUID/catalog redesign |
| Legacy browser resources | “Force drop old and fresh use” | Drop old browser resource state and start fresh; no archive/quarantine/restore UI or resource migration |
| Compatibility | “Force change and use”; clarified as “New contracts only” | Breaking frontend/backend cutover; mandatory new protocol, no media-v1 or optional-incarnation branch; old clients/servers unsupported |
| Release policy | Release per platform | Qualified web can release independently; native remains blocked until its own gates pass |

## Fresh-state reset boundary

Reset only enumerated old browser resource stores: selected project, editor tab/model metadata and any old resource draft records, explorer state, project-target/search resource state, terminal layout/pins, command history and Browser address history. Remove associated old resource quarantine backups if present. Start new selected project, preference source and Settings target unset; require explicit selection. Preserve existing presentation-only widths/modes/defaults as appropriate.

Do **not** clear all localStorage. Preserve saved connection profiles, correctly endpoint-bound credentials, native scope aliases/vault/trust, server files/configuration, PTYs and workflow/usage history. Profile `autoConnect` and endpoint-bound auth-record conversion remain necessary configuration/schema changes, not resource restoration. No automatic remote terminal creation, kill, save or delete during reset.

Reset is deliberately lossy for old browser resources: no backup/archive or restoration promise. First-run notice states this. New-version live dirty drafts retain the normal preservation rules on disconnect/logout/endpoint change. Existing new-schema records survive later startups; partial reset/storage failure must not erase valid new records or report success falsely. An unreadable profile store is never treated as an empty profile list.

## Breaking protocol boundary

- Add `workbenchProtocol: 2` to successful existing `GET /api/auth/status` responses, including no-auth/dev mode. This exact marker acknowledges the mandatory unified-profile contract; not a capability catalogue or guessed semantic version.
- After bound authentication, require marker 2 before opening WS/enabling feature requests. A successful status response with missing/different marker leaves that profile `unsupported` with mandatory-upgrade guidance. Authentication failure remains `login-required`; network failure remains offline. Other compatible profiles remain usable.
- All media issue/ticket-revoke/session-revoke requests require valid `mediaClientId`; only namespaced `session-cookie-v2` is implemented. Missing/invalid namespace fails; no fixed-cookie v1 authorization branch.
- Artifact create requires `terminalIncarnation`; missing/mismatch rejected before persistence. Response must acknowledge the matching incarnation; handoff uses atomic instance-checked write. No old-client omission/default path.
- Remove obsolete compatibility code/tests/docs rather than maintaining dual paths. Existing ordinary bearer/cookie authorization policy is not globally redesigned; old clients are unsupported, not a claim that every unchanged endpoint can fingerprint and reject an old application.
- Deploy frontend/backend as a compatible version set. A rolling mismatch produces explicit unsupported connections, not hidden partial use. Native TS/Rust IPC ships atomically.

## Platform release gates

- **G1-Web:** shared ownership foundation, all shipped web callers/hosts and Phases 02–07 integrated; no ambient fallback in shared/web paths.
- **G2-Web:** S01–S12 plus browser-host/bridge/support restrictions applicable to web from S13; real auth/media/PTY gates passed; web/extension builds and focused/full web/UI/backend checks passed. Windows runtime access is not a web release prerequisite.
- **G1-Native:** G1 shared contracts plus Phase 08 adapters/IPC/native bootstrap integrated for that native target.
- **G2-Native:** common scenarios on the target and native-specific S13 runtime/security evidence. Windows SSH proof cannot be replaced by Linux compilation; unqualified native packages are not shipped.
- Phase 08 stays fully in scope. A web release does not mark native implementation complete. Platform status/evidence is reported separately; shared failures block every affected target.

## Rollback and risk acceptance

Rollback uses a mutually compatible frontend/backend build set. Old browser tabs/layout/history intentionally cannot be recovered by the application after reset. Connection login may need renewal when reverting auth storage formats; never restore an old bearer to a different endpoint. No server database ownership migration is introduced. Release notes explicitly announce browser-state reset and coordinated upgrade requirement.

## Unresolved questions

None. Execution prerequisites remain: disposable authenticated fixtures and browser capabilities for web; target-native environments, including Windows plus disposable SSH endpoints for native release.
