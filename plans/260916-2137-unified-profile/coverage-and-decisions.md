# Coverage and design decisions

[Plan](plan.md) · [Contracts](design-contracts.md) · [Execution map](execution-map.md) · [Verification ledger](verification-matrix.md)

The feature matrix below retains every feature row of the requested preplan, with user-approved changes to legacy reset, protocol compatibility and release policy. Phase 00 is an additional contract-freeze gate; original Phase 01–09 numbers and S01–S13 remain stable. All implementation and qualification statuses are pending. [Validated decisions](validation-decisions.md) supersede the corresponding original preplan choices.

## Coverage matrix and final decisions

### Scope and non-goals

Deliver one shared DamHopper workbench with simultaneous supported profile connections and `Profile → Project` navigation. Frontend server profile identity qualifies existing server-local resources; it is not a new backend workspace, project registry, authentication tenant or workflow database. No URL deduplication, app-per-profile remount, generic proxy/federation server, cross-server filesystem move, cross-server agent shipping, broad permission relaxation, new host power endpoint or feature-specific active-profile fallback.

All behavior below is proposed implementation, not a claim about current source. Source evidence is embedded in phase sections. Current docs occasionally describe older API paths/conditional feature gates; `api/router.rs`, client source and validated endpoint behavior take precedence.

### Feature-to-phase coverage

| Feature / entry point | Required ownership and behavior | Phase | Proof |
|---|---|---|---|
| Profile CRUD, autoConnect, login/logout/status | Independent runtime/token/intent; legacy true default; unsupported/offline partial shell | 01–02 | S01, S11 |
| HTTP, WS, filesystem chunks, PNG, reconnect | Captured ConnectionRef/endpoint/auth, abort and stale fences; no mutation replay | 01 | S01, S11 |
| Query cache, optimistic mutation, SSE/IPC events | Explicit profile+generation keys/envelopes; original-owner invalidation only | 01 | S03–S11 |
| Project picker, TopNav, Dashboard, deep links | Profile/project refs, URL/path disambiguation; no connection/config switch on focus | 02 | S02 |
| Backend workspace registry setup/switch | Existing server API in targeted Settings only; no new hierarchy | 02,06 | S02,S09 |
| Explorer tree, file CRUD, watchers, language scan | Target+owner+binding; owner-local scan epoch/availability | 03 | S03,S11 |
| Editor tabs, Monaco, dirty saves, diffs | Stable qualified model identity; request generation and root binding; preserve drafts | 03 | S03,S11 |
| File upload, streaming writes, drag/drop | Destination captured before async work; owner-specific progress/cancel; no cross-server move | 03,07 | S03,S07 |
| Large files, binary, HTML, Markdown | Bound reads; content-only renderers preserve sandbox/sanitization | 03 | S03 |
| Image/video preview and downloads | Per-connection media namespace; original cleanup; streaming/range policy preserved | 07 | S07 |
| Project/worktree and federated text/path search | Snapshot eligible owners, concurrency 4, combined cap 500, partial errors/truncation | 03 | S04 |
| Replace Next/All | Exact displayed selected targets, per-file results, dirty/conflict checks, no replay | 03 | S04,S11 |
| Git status/stage/commit/history/conflicts | Owner+target+root refs and matching editor reconciliation | 03 | S04 |
| Worktrees, nested Git roots/submodules | Existing normalized target/root semantics qualified by owner | 03 | S04 |
| Bulk fetch/pull/push and SSH authentication retry | Explicit per-profile partitions; retry failed auth targets only, captured credential prompt | 03 | S04,S11 |
| Terminal launch/build/run/custom/free/saved profile | Owner-bound dispatch; unchanged server ID/CWD/env/config semantics | 04 | S05 |
| Terminal attach/output/input/resize/rename/kill/remove | TerminalRef plus incarnation; one xterm per ref; detach is not kill | 04 | S05,S11 |
| IDE/traditional/Fleet/runtime/floating/maximized/compact layouts | Shared keep-alive lifetime; owner-qualified tabs/splits/pins/navigation | 04 | S05 |
| Terminal histories/suggestions/mobile accessories | Per-profile history and action owner; preferences may be shared | 04 | S05,S12 |
| Workflow Plan/Phase/Task/session/execution/notes | Per-profile server-local IDs/CAS/request UUIDs; preserve backend history | 04 | S06 |
| Workflow terminal/project links and unavailable targets | Exact owner+incarnation navigation; no same-name replacement | 04 | S06,S11 |
| Agent inventory/content/health/distribution/absorb | Explicit catalog profile; same-owner projects only | 05 | S06 |
| Agent repo/local import and memory/templates | Owner-bound tmpDir and draft/preview/confirm; no implicit remote copy | 05 | S06,S11 |
| Detected ports/tunnels/cloudflared install | Qualified rows/events/actions; server numeric-port semantics unchanged | 05 | S08 |
| Browser target/address history/bridge/extension | Explicit target independent of focus; exact-origin/source/nonce trust | 05,08 | S08,S13 |
| Capture/PNG/artifact cleanup/terminal handoff | Owner+target revision+TerminalInstanceRef; atomic server incarnation write | 05,07 | S08,S11 |
| Notifications/browser tags/shortcut navigation | Owner-qualified identity and safe labels; no reconnect on click | 04 | S12 |
| Diagnostics export and redaction | Explicit owner-filtered bundle; output consent; no cross-owner or secret leakage | 04,06 | S12 |
| Encryption prompts/passphrases/OPAQUE/key cache | Owner/project/generation lifetime; same transport through entire write | 07 | S07,S11 |
| Feature flags/capabilities/old server/unavailable resources | Mandatory protocol-2 admission, then per-profile feature availability; no healthy-server fallback | 02,05 | S01,S08,S10 |
| Preferences and keyboard/appearance settings | Explicit preference source; last snapshot offline; captured debounce chain | 06 | S09,S11 |
| Settings config/import/export/cache/reset | Independent editing target captured before dialog/file read; owner-labelled destructive effects | 06 | S09,S11 |
| Server-local ordering/pinned mounts | Use each server's existing UiConfig only in that owner group | 06 | S09 |
| Usage telemetry/session audit/retention/Codex | Explicit profile, separate data/config; no duplicate-endpoint totals | 06 | S09 |
| Host metrics/alerts/storage/fleet/suspend timing | Profile-labelled host snapshots/revisions; no averaging or cross-owner mutation | 06 | S10 |
| Force sleep and existing process-affecting actions | Captured owner+auth+revision/confirmation; existing server guards; fake execution only in checks | 06 | S10 |
| Native SSH scopes/credentials/trust/lifecycle | Concurrent admitted scopes; scoped teardown, true epoch global teardown | 08 | S13 |
| Native Browser/support matrix and host bootstrap | Shared UI runtime; one explicit Browser child lease; preserve platform restrictions | 02,08 | S13 |
| Legacy browser stores/cross-tab events/duplicate profiles | Drop old browser resources; idempotent fresh schemas; preserve coherent auth/profile records; no false tenancy | 01–02,04 | S01,S07,S12 |

### Minimal backend changes and breaking protocol decision

| Boundary | Change | Why required | Deployment contract |
|---|---|---|---|
| Auth status | Successful response includes `workbenchProtocol: 2`, normal and dev branches | Deterministic pre-WS rejection of old server contracts | New client requires exact marker after auth; missing/wrong means unsupported |
| Media | Required mediaClientId, actor-bound revoke, v2-only cookie/session response | Cookies collide by hostname/path; media cannot attach bearer | Delete v1 paths; missing namespace rejected; matched frontend/backend upgrade |
| Browser artifact | Required terminalIncarnation; authoritative response and atomic instance write | Raw ID can be replaced after frontend snapshot | Missing field/mismatch rejected before create; no old-client omission path |
| Native SSH IPC | Concurrent maps and explicit scope open/close/reconcile | Current manager enforces exclusive scope and global switch teardown | Bundled TS/Rust atomic cutover; persisted vault/trust/aliases unchanged |
| Other server resources | No new ownership/catalog/database protocol | Existing authenticated servers remain resource authority | Keep current IDs/permissions/sandbox/PTY/workflow history |

Breaking cutover is user-confirmed. No old-client/server compatibility branch or unsafe fallback; normal auth policy remains unchanged. Old-server profiles are upgrade-required before features, not partially usable. Duplicate profiles remain client owners, not actor tenants. Web and native release independently only after their own complete gates.

### Risks and mitigations

1. **Indirect ambient authority:** compiler-required owners plus exhaustive API/query/event/storage inventory; no concurrent release before all slices integrate. Timers/dialogs/retries/cleanup are mandatory audit targets.
2. **Credential endpoint race:** atomic endpoint-bound credential record, pre-login endpoint revision fence and runtime retirement before replacement. Never reuse token because profile ID stayed equal.
3. **Cookie and third-party behavior:** real same-host/different-port browser matrix, namespace selection from stored ticket binding, actor-bound revoke even with blocked cookies, exact-origin fallback unchanged. Hostname cookies are not a new isolation boundary against an untrusted server on the same hostname; use separate trusted origins/HTTPS as appropriate.
4. **Lost in-flight mutations:** show unknown outcome, refresh only owner, never auto-replay; no fictitious cross-server transaction or rollback.
5. **Intentional browser-state loss:** drop old resource records with no backup/restore; explicit reset allowlist preserves profiles/native/server state. Inform users and make no recovery promise. Normal new-version dirty drafts retain lifecycle protection.
6. **Memory/connection cost:** one runtime/socket per intended supported profile, owner-filtered subscriptions, existing query poll intervals, bounded search/capture/media, keep-alive only intended open terminals; avoid O(profiles×all-resource) recomputation on each event.
7. **Native teardown security:** refactor admission and scope-keyed maps together, preserve global quotas and true epoch shutdown; Windows proof required, Linux compile not substitute.
8. **Preference/resource confusion:** explicit allowlist for shared preferences; ordering/pinned mounts/Codex/telemetry remain server-local. Source, settings target, project and Browser target never implicitly synchronize.
9. **Changed root or duplicate URL:** persistent attachment endpoint/root checks and explicit reopen; duplicate URL remains two client owners but one remote authority.
10. **Fixture collateral damage:** temporary homes/databases/configs/keys, loopback-only services, disabled real idle-suspend, FakeExecutor/FakeActionBackend for power/process assertions, teardown verified owned handles only.

### Decisions and external prerequisites

No unresolved product/design choice is deferred to implementation. Conservative defaults are explicit: legacy autoConnect=true, new=true; one shared shell/query client; explicit preference source; roots-only federated all-profile search; partial results; same-owner Browser handoff/agent shipping; one physical Browser surface; no replay; fresh browser resource reset; mandatory new protocol; per-platform release gates. Required execution prerequisites are disposable MongoDB for real auth, browser media/capture permission/capability, and Windows runner/device plus disposable SSH endpoints for native runtime qualification. If unavailable at implementation time, record the exact blocked gate and finish reachable work; do not label unexercised security/platform behavior complete.


## Analysis of the supplied preplan

### Preserved

All 39 feature areas and S01–S13 remain tracked. Stable-vs-generation identity, endpoint-bound credentials, no-replay policy, server authority, atomic Browser handoff, media namespace isolation and native admission security remain unchanged. No backend ownership/catalog redesign.

### Made executable

1. Phase 00 freezes contracts; G1-Web/G1-Native accept the respective complete caller sets. No circular prerequisite between foundation acceptance and caller migration.
2. Session-local artifacts replaced with repository-relative documents; per-phase packages and single-writer ownership explicit.
3. Current source audits confirm ambient client/query/event state, raw terminal IDs, fixed-cookie media and singleton native scopes; browser fixtures also require new-contract updates.
4. Auth status marker specifies mandatory upgrade admission without a broad capability API. Missing mediaClientId/incarnation requests are negative tests, not supported compatibility cases.
5. Native openClient retains true epoch teardown. Profile reconciliation does not call it.
6. Fresh-state reset replaces all old quarantine/restore work. Credential/profile schema conversion remains separate and endpoint-safe; server/native resources are not discarded.
7. Release evidence is partitioned: qualified web can ship while native remains explicitly pending/blocked. Shared security failures still block every affected target.

### User-confirmed departures from the preplan

| Original choice | Validated replacement | Phases |
|---|---|---|
| Keep legacy bytes and explicit verify/restore | Drop old browser resource state, fresh schemas, no archive/restore UI | 00,02,03,04,09 |
| Additive v1/v2 media and optional artifact incarnation | Required new protocol; v2-only media, required artifact incarnation, mandatory server upgrade | 00,01,05,07,09 |
| Unified release waits for all platform gates | Independent platform release after each complete gate | 00,08,09 |

### Explicit tradeoffs

- One runtime per profile, not URL deduplication: deliberate socket cost for ownership correctness; duplicate remote authority remains visible.
- Stable refs plus operation generations: UI continuity without stale work or silent endpoint/root retargeting.
- Fresh reset: less migration complexity, intentional loss of old browser tabs/layout/history. No hidden backup/recovery promise.
- Breaking protocol: fewer compatibility paths and mandatory coordinated upgrade; old profiles cannot be partially used until upgraded.
- Per-platform release: qualified web is not held by absent Windows runtime; native stays fully in scope and unshipped until its own proof.

## Unresolved questions

No unresolved product/design choice. Required runtime environments are not yet qualified: see Phase 09 and the verification ledger. User validation is complete; do not begin implementation as part of this planning task.
