# DamHopper plugin-platform repository analysis

Date: 2026-09-20. Scope: planning evidence only; no build, test, formatter, or runtime command executed.

## Current implemented boundaries

- `server/src/api/auth.rs:54-60,128-153` defines `AuthenticatedActor { subject }` and inserts it only after protected-route JWT validation. `--no-auth` inserts synthetic `dev-user`; plugin handlers must reject that mode explicitly.
- `auth.rs:237-276` registers MongoDB users disabled by default. `auth.rs:209-220` can recheck enabled accounts. Registration/login is not an administrator role.
- `server/src/api/router.rs:63-70,97-430` keeps `/ws` public at routing level with its own handshake checks; protected REST routes receive `require_auth`. There is no plugin route today.
- `server/src/api/ws.rs:130-186` validates a WS token only as a boolean, then drops the JWT subject before `handle_socket`. Plugin WS epochs therefore require an actor-carrying handshake refactor and expiry/revocation handling.
- `server/src/api/host_actions.rs:19-41,217-255` is the closest sensitive-operation pattern: enabled actor checks, no-auth denial, bearer/cookie distinction, exact-origin CSRF checks, and actor-bound operations. Plugin management should be bearer-only initially rather than add a cookie mutation bypass.
- `server/src/state.rs:38-130` composes services in `AppState`; no runner client, registry cache, plugin context service, or revocation sink exists.
- `server/src/state.rs:155-165` resolves a named project/worktree through `WorkspaceTargetResolver`. `workspace_target.rs:194-249` canonicalizes the configured root and accepts explicit worktrees only from a fresh registered-worktree snapshot; missing targets do not fall back to root.
- `packages/ui/src/api/ownership.ts:5-47,66-91,212-264` defines `ConnectionRef`, qualified project targets, profile-stripping server projection, tuple keys, and owner checks. Browser `profileId` is local routing identity, not server authorization.
- `packages/ui/src/api/connections.ts:161-212,318-458` increments generation on drops/reconnects, destroys old transports, and builds one `WsTransport`/`ApiClient` per captured owner.
- `packages/ui/src/api/ws-transport.ts:1-12,1333-1605` combines bearer-authenticated REST with a persistent WS and captures endpoint/token/generation for transport lifetime. Channel mapping is closed; no plugin operations/events exist.
- `packages/ui/src/lib/navigation.ts:12-38` returns fixed base entries plus one compiled SSH-forward entry. `TopNavRouteMenu.tsx:19-64` renders that array. `dam-hopper-app.tsx:77-107,346-428` lazy-loads a compiled route tree. Dynamic plugin navigation/route hosting is absent.
- `packages/ui/src/stores/workspace.ts:5-68` persists selected `{profileId, project}` and increments navigation revision. Worktree selection lives in the existing project-target store; plugin host must consume both rather than create a second selector.
- `server/src/web_host/router.rs:26-179` is a non-writing static SPA host with safe path resolution and cache classification. It does not emit a shell CSP and must not serve plugin HTML as navigable `text/html`.
- Combined API/static serving in `server/src/api/router.rs:486-495` uses `ServeDir` and SPA fallback. Plugin bytes need a reserved protected API endpoint so neither static host path can execute them directly.
- Existing HTML preview is an opaque-origin iframe but permits broader sandbox capabilities and workspace markup. It is evidence for `srcdoc` mechanics, not a reusable plugin security policy.

## Release and Linux patterns to reuse carefully

- `server/src/linux_release/archive.rs:109-248` streams bounded gzip/tar validation, rejects duplicate paths and non-file/directory entries, and verifies manifest size/digest. Plugin package limits and case-collision rules are stricter and belong to a separate runner-owned registry.
- `linux_release/archive_extract.rs:14-113` validates before role-projected extraction. Never extract plugin bytes with generic `tar` or execute before complete inventory verification.
- `linux_release/durable_fs.rs`, `state.rs`, `state_record.rs`, `transaction.rs`, `activate.rs`, `rollback.rs`, and `recovery.rs` provide atomic state/journal/rollback patterns. Runner registry is separate durable authority; API keeps only revision-tagged cache.
- `linux_release/state_record.rs:98-158` records explicit transaction phases. Plugin lifecycle needs its own installation-scoped journal because package rollback must not roll back host release state.
- `linux_release/layout.rs:25-47` supports real and rooted test layouts. New runner state/layout should offer the same injection seam and remain owner-account state, not API HOME data.
- `deploy/systemd/dam-hopper-api.service.in:7-36` runs the API as configurable non-root UID with production auth and release-root binary. `docs/linux-systemd.md:49-81` confirms dedicated API/web identities and release-manager ownership.
- `linux_release/constants.rs:26-62`, `deploy/release/build-release-archive.sh:169-183`, and `check-release-assets.mjs:56-63` enumerate current binaries/units. Runner binary, service, tmpfiles-provisioned runtime directory, pinned Node runtime, manifest schema, SBOM, health, rollback, and recovery all need coordinated updates.
- Current release manager supports immutable role releases, exact health gates, n-1 host rollback, and root-only activation. It currently has no advisor-owner input, plugin admin subjects, Node >=22.19 component, runner unit, or owner-created runner socket health.
- Root installer may provision units, group/socket permissions, immutable runtime, and owner state. Browser/API must never construct sudo commands or scan HOME for owners.

## Design consequences

- Runner is the sole durable installation/source/grant authority and sole worker supervisor. API is an authenticated façade plus revision cache; no API-side writable registry.
- Every invoke must recheck current enabled actor session, grant revision, installation generation, target binding, and allowed operation. `context.open` alone is insufficient.
- Initial admin mutations should require explicit bearer authentication; runner independently verifies root-seeded admin subjects and current security revision. Allowlist default is empty.
- Management upload should stream bounded chunks across the private runner channel; no whole 32 MiB artifact buffer and no browser-selected server path. Runner rehashes, safely stages, exposes review metadata, then commits approval.
- Exact project/source identity is not “helpful realpath.” Host resolves the configured target; runner/worker must enforce evcrate's normalize + reject symlink + native-realpath-equality contract and report mismatch/unavailable without rehash or root fallback.
- UI package bytes use a protected `application/octet-stream`, `nosniff`, non-navigable endpoint. Host verifies digest, injects restrictive CSP, creates opaque `srcdoc`, transfers one nonce-bound port, and releases no context/data until acknowledgement.
- D00 publishes an immutable generic contract candidate first; E00 consumes its version/digest and returns domain candidate/fixtures; G0 jointly pins the pair. Stable publication cannot be a circular prerequisite.
- D01 plus E02 must exchange an early real package candidate for G1. E04 remains the later production publication/lifecycle artifact, not a prerequisite for the first vertical slice.
- One worker per enabled installation; generic runner frame/context/concurrency limits and cancellation/control reservation remain domain-agnostic. E02 owns one active history scan, single evaluation parse, snapshot retention and stricter data budgets; the 64 MiB runner frame/serialization cap is separate.
- Rollback restores the compatible package pair and only compatible non-security settings. Current revoked grants, disabled intent, source bindings, and authorization revision always win, including concurrent update failure.
- No loader-only completion: G1 requires the real evcrate worker, G2 the four real views, G3 lifecycle recovery, G4 Linux/LAN/workload/deployment evidence.

## Proposed primary touchpoints

- Contracts/SDK: new `packages/plugin-sdk/`; `server/src/plugins/{contract,framing,manifest}.rs`; cross-language fixtures.
- Runner/registry: new `server/src/plugins/{registry,package,journal,runner_server,worker_supervisor}.rs` and `server/src/bin/dam-hopper-plugin-runner.rs`.
- API/auth: `server/src/{state,main}.rs`, `server/src/api/{auth,router,ws,ws_protocol,plugins}.rs`, current target resolver.
- Browser: `packages/ui/src/api/{client,ws-transport,query-client,connections}.ts`, new plugin host/bridge/hooks, `packages/ui/src/lib/navigation.ts`, `packages/ui/src/components/organisms/TopNavRouteMenu.tsx`, `packages/ui/src/embed/dam-hopper-app.tsx`.
- Lifecycle UI: `packages/ui/src/components/pages/SettingsPage.tsx`, a new settings-page management section, and bearer-only admin client methods.
- Deployment: Cargo binary target, systemd runner service, tmpfiles runtime directory, release manifest/publisher/inventory, release manager units/state/health/recovery, deploy qualification scripts/docs.

## Validation status

No runtime validation performed. Commands in phase plans are future gates and are labeled existing versus proposed-after-created.

## Unresolved questions

- Deployment inputs: advisor-owner UID/account/home, configured project/worktrees, admin/read subjects, approved history/policy/evaluation sources, Linux distribution, artifact handoff, HTTPS termination, LAN client, hardware.
- G0 must choose and qualify the immutable Node >=22.19 distribution strategy; no PATH/HOME fallback is assumed.
- Staffing and hardware are absent; effort remains unestimated.
