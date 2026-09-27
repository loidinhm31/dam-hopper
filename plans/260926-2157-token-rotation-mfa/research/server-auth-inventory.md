# Server authentication inventory

Date: 2026-09-26. Read-only application inspection; no runtime/test evidence claimed.

## Observed implementation

| Boundary | Evidence | Consequence |
| --- | --- | --- |
| User account | `server/src/api/auth.rs:251-286` | MongoDB users, bcrypt passwordHash, isEnabled, role. No MFA or auth epoch. |
| JWT | `server/src/api/auth.rs:48-52,126-155` | Claims sub/exp; default jsonwebtoken validation; expires after 30 days. No session ID/revision or deliberate zero-leeway policy. |
| Password login | `server/src/api/auth.rs:408-490` | Verifies enabled account, immediately sets full token/cookie. Must become challenge-only. |
| Registration | `server/src/api/auth.rs:365-405` | New accounts disabled pending approval. Preserve policy; make insert/hash failures explicit while adding required auth state. |
| HTTP auth | `server/src/api/auth.rs:161-195` | Checks signed JWT, no current account/session lookup. |
| Status/logout | `server/src/api/auth.rs:491-560` | Status checks role/enablement when DB exists. Logout clears cookie/revokes plugin actor, but JWT remains valid. |
| WebSocket | `server/src/api/ws.rs:130-208,213-270,313,1699-1701` | Query-token/cookie admission validates JWT once; reader loop and pumps live beyond admission. Existing teardown revokes plugin epoch. |
| Plugin epoch | `server/src/api/ws.rs:173-179` | Bound to actor and JWT expiry; must also cap at MFA deadline and session revocation. |
| Media routes | `server/src/api/router.rs:466-492` | Ticket issue/revoke protected; native streams intentionally outside bearer middleware. |
| Media auth | `server/src/api/media_stream_response.rs:33-102,336-353` | Authorizes ticket, opens/revalidates file, finalizes lease, then streams file without auth deadline guard. |
| Media state | `server/src/fs/media_ticket.rs:21-22,177-263` | Independent 15-minute idle/8-hour absolute ticket TTL; media sessions bind actor/client, not full auth session. |
| Mongo bootstrap | `server/src/main.rs:333-353` | Existing optional MongoDB configuration. Production requires DB; no-auth skips connection. |
| State guards | `server/src/state.rs:270-308` | Rejects no-auth with DB/production settings. Preserve guards. |
| Secret precedent | `server/src/crypto/opaque.rs:41-89` and `main.rs:571-645` | Existing disk secret-file loaders; use permission conventions, do not reuse cryptographic keys. |
| Dependencies | `server/Cargo.toml:149-172`; `packages/ui/package.json:40` | Existing AES-GCM/RNG/hash/zeroize and react-qr-code. No reason for external QR service. |

## Cutover inventory

Production auth consumers located: `api/auth.rs`, `api/ws.rs`; router groups include general, explorer, plugin management and independent media stream authorization. Exported actor consumers include plugin authorization and security-sensitive routes. Re-run symbol references at implementation if LSP becomes available; planning LSP reported no configured server.

Legacy signed-JWT fixtures located in:

- `server/src/api/tests.rs`
- `server/src/bin/dam-hopper-plugin-test-server.rs`
- `server/tests/browser_debug_artifacts.rs`
- `server/tests/fs_mutate.rs`, `fs_upload.rs`, `fs_write_streaming.rs`, `ws_fs_subscribe.rs`
- `server/tests/plugin_admin_api.rs`, `plugin_api_integration.rs`
- `server/tests/settings_import_export.rs`
- Direct actor construction in `server/tests/plugin_authorization.rs`.

Update affected harnesses with isolated real MongoDB user/session fixtures or explicit no-auth only for tests whose subject genuinely excludes auth. Never add a production test bypass or accept legacy JWTs to keep tests green. Service-only plugin actor tests may remain independent where they exercise grants rather than middleware; preserve their actual behavior assertions.

## Documentation evidence

- [Current API contract](../../../docs/api-reference.md#authentication) describes immediate login token issuance.
- [Architecture](../../../docs/system-architecture.md#authentication--security) now separates observed baseline from proposed MFA design.
- [Code standards](../../../docs/code-standards.md#authorized-plugin-api-and-context-standards-phase-d03) require non-secret actor context and bound plugin epochs.
- `docs/codebase-summary.md` generated 2026-09-25; fresh enough to skip stale-summary scouting.
- Targeted file lookup found no `docs/development-rules.md` or design-guidelines document. Applied loaded repository rules and existing code standards.

## Planning workflow evidence

Loaded global OMP `/cmd-plan__hard` and planning/backend-development instructions. Local `.omp` assets absent; used published global script. `node /home/loidinh/.omp/agent/evcrate/scripts/set-active-plan.cjs plans/260926-2157-token-rotation-mfa` returned success with warning: `EVCRATE_SESSION_ID not set - session state will not persist`. No false claim of runtime activation.

## Unresolved questions

None preventing planning. Actual MongoDB topology, deployment key provisioning, and native auth behavior require implementation qualification, not assumptions of success.
