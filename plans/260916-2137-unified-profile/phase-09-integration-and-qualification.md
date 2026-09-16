# Phase 09 — Integration and end-to-end qualification

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Target-specific integration and qualification: web Phases 01–07; native additionally Phase 08.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Qualification.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Complete atomic cutover with real two-server UI/remote-effect evidence and no unsafe host actions.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and release gate

Integration owner accepts frozen-contract patches and removes ambient paths for each complete shipped target. Web may release after its G1/G2 gates while native Phase 08/S13 remains explicitly pending or blocked. No individual feature phase is advertised as a complete workbench and no unqualified native package ships. This planning task has run no application tests, migrations or services; every command/scenario below is future implementation verification.

#### Disposable two-server fixture (real runtime, not mocked API)

Create a throwaway fixture under a unique temporary directory during implementation verification, never in the user's workspace/config. A fixture manifest records generated absolute paths and process handles; no bearer/password logging.

- A: `http://127.0.0.1:14801`; B: `http://127.0.0.1:14802`; frontend: `http://127.0.0.1:15173`. Reserve/check availability first, choose another documented port triplet if occupied; never terminate unrelated listeners.
- Both expose project named `web`, same relative paths `src/marker.txt`, image/video names and Git branch/worktree/submodule names, and terminal ID `shared-session`; contents/output distinguish `SERVER_A` and `SERVER_B`. Separate real Git repositories, configured absolute roots and worktrees, separate bare Git remotes for push/pull tests. Create marker files, a small/large text file, HTML/Markdown, known-good PNG and WebM copied from existing media browser fixtures.
- Each process gets distinct HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, TMPDIR, global registry/config, agent-store root, session DB and telemetry DB; preserve only required executable/library environment. Set explicit `--config`, run binary with cwd inside its fixture (main loads dotenv), strip inherited DAM_HOPPER_*, MongoDB and production variables unless explicitly supplied. Do not use repo `.env` or real SSH/Codex config. Separate JWT secret files are generated under isolated config dirs.
- Fixture TOML includes `[workspace] name="Fixture A"` / B, `[[projects]] name="web", path="<absolute owned repo>", type="custom"`; `[server] session_db_path="<own sessions.db>"`; `[server.telemetry] enabled=false, db_path="<own telemetry.db>"`; `[server.telemetry.collector] enabled=false, host="127.0.0.1", port=14811` / 14812; `[server.idle_suspend] enabled=false`. Give agent store a fixture-only path using existing config format. Enable telemetry only for S09 with distinct collector ports; no real provider secrets or external traffic.
- Build once using `cargo build --manifest-path server/Cargo.toml --bin dam-hopper-server`; launch resulting absolute binary twice with `--host 127.0.0.1 --port 14801|14802 --config <own config> --cors-origins http://127.0.0.1:15173`. Use supervised process handles and wait for `/api/health`, then authenticated `/api/projects` proving `web` maps to the expected absolute root. Readiness log alone is insufficient.
- Authentication gate uses disposable MongoDB, not a guessed fallback token: `auth.rs` login verifies enabled DB users. Use a loopback-only disposable Mongo container/service with isolated databases A/B, set `MONGODB_URI` and `MONGODB_DATABASE` per server. Register temporary credentials through `/api/auth/register`, enable only those fixture users via Mongo `users.isEnabled`, then log in through actual UI/API. A second enabled actor in A's database supports same-origin/different-credential duplicate-profile media testing. Passwords/tokens exist only in fixture memory/browser test profile; never commit or include in evidence. Container runtime availability must be established during execution; runtime availability must be checked during implementation; no container was started during this planning task.
- Separate no-auth gate restarts fixture servers with Mongo/prod variables absent and `--no-auth`; profile authType none obtains existing dev JWT. Do not claim no-auth checks prove authentication isolation, and do not use no-auth for host power acceptance.
- Start frontend with `pnpm --filter @dam-hopper/web dev --host 127.0.0.1 --port 15173 --strictPort`; unset production/managed VITE_DAM_HOPPER_SERVER_URL overrides so two explicit profiles aren't reconciled away. Use fresh browser context on that exact origin. Runtime manager/profile records use actual A/B URLs, not proxy aliases.
- Create both PTYs via existing authenticated `POST /api/terminal`: same `{id:"shared-session", project:"web", command:<fixture marker/echo loop>, cwd:<own root>, cols:80, rows:24, env:{}}`. Fixture command prints server marker plus its PID, accepts an input line and echoes owner-tagged acknowledgement, periodically emits output. Record authoritative incarnation and printed PID; never issue host process kill. Additional build/run/profile launches are generated through UI. Teardown uses only owned process handles and fixture session IDs.

Concrete Linux PTY fixture: write `terminal_fixture.py` in each temporary root, set request env `FIXTURE_MARKER=SERVER_A` or `SERVER_B`, and command `python3 -u <absolute fixture path>`. Its loop uses only the owned PTY, not host power/process controls:

```python
import os
import select
import sys

marker = os.environ["FIXTURE_MARKER"]
print(f"{marker} pid={os.getpid()}", flush=True)
while True:
    ready, _, _ = select.select([sys.stdin], [], [], 1.0)
    if ready:
        line = sys.stdin.readline()
        if not line:
            break
        print(f"{marker} input={line.rstrip()}", flush=True)
    else:
        print(f"{marker} heartbeat", flush=True)
```

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 09A | Integrated explicit-owner candidate and reference audit per target | 01–07/shared for web; additionally 08 for native | Target G1; no ambient runtime path |
| 09B | Disposable real servers/auth/browser/PTY fixtures | Qualified candidate; recorded prerequisites | Isolated roots/users/processes; real authenticated readiness |
| 09C | S01–S12 web plus target-applicable S13; full native proof separately | 09B; native fixture for native release only | Independent G2-Web / G2-Native; blocked is never passed |
| 09D | Documentation, cleanup and rollback rehearsal | Successful live smoke; 09C evidence | No secrets/temp services; fresh-reset loss and mandatory upgrade documented; release notes accurate |

Create regression tests only for meaningful collisions/races/authority boundaries. Existing browser fixtures must follow the new contract before the browser suite can qualify the change; fixture tests do not replace real two-server/browser evidence. Do not report blocked as passed or as a partial scope waiver.


#### Integration sequence and ownership

1. Foundation owner freezes `ownership.ts`, runtime lifecycle, bound API signatures, query/event factories and cleanup handle. First milestone is contract availability; full Phase 01 acceptance is reached only after callers and shell integrate. Existing single-profile code may remain untouched while slices are being developed, but no compatibility accessor may dispatch implicitly and no concurrent connections are enabled until migration is complete.
2. In parallel after freeze: files/search/Git (03), terminals/workflow (04), agents/ports/Browser (05), settings/host (06), media/encryption/backend (07), native (08). Phase 02 shell/profile work proceeds under integration owner. Native Browser depends on the Browser target contract, not finished UI; media depends on the target contract, not finished editor. Server Browser incarnation and media changes own disjoint backend modules except any shared error/router edits, which backend integration owner serializes.
3. Single-writer shared boundaries: `api/client.ts`, `api/queries.ts`, `api/workflow-queries.ts`, `hooks/use-sse.ts`, `api/connections.ts`, `api/server-config.ts` belong to foundation/integration owner; `WorkspacePage.tsx`, app embed, TopNav and both bootstrap files to shell/integration owner. Feature owners submit exact signature/prop/query changes, not concurrent edits. Rust PTY write helper belongs to Browser backend owner; media backend owner does not edit it. No universal provider per profile, duplicate query clients or second ownership encoding.
4. Foundation owner migrates every exported caller, tests and hosts together; use LSP references where available (none configured during this planning task), otherwise exhaustive scoped import/symbol searches plus TypeScript compile. Reject zero-argument API/transport/auth/header/server-URL access outside private legacy migration; reject dynamic active-profile query hashing, unqualified remote events/caches and global connection-triggered query reset. Inspect indirect callbacks, dialogs, timers, retries, cleanup and user-supplied deep links, not only direct imports.
5. Deploy mandatory protocol contracts with matching frontend/backend builds: successful auth status marker 2, media-v2-only and required artifact incarnation. Existing workspace registry/sandbox/auth authority/PTY persistence/workflow DB remain unchanged. Native IPC cuts over atomically with its frontend; remove activateScope shim. Browser resource reset is deliberately lossy, idempotent and allowlisted; no backups/restoration or server schema migration. Qualified web release is independent from unqualified native builds.

### Todo list

- [ ] All feature matrix rows have implementation owner, contract, scenario and actual evidence.
- [ ] Two real servers satisfy same-name/ID collision, independent auth and stale-generation checks.
- [ ] Browser UI and remote file/PTY effects agree; required native runtime proof is recorded separately.
- [ ] No real host power/process action or developer config/credential mutation occurred during qualification.
- [ ] All affected callers/tests/docs migrated; no ambient remote authority, obsolete switch/reload path or permanent shim remains.
- [ ] Product behavior is complete before release; unsupported platforms/features are explicit, not fake success.

### Success Criteria

See [verification-matrix.md](verification-matrix.md) for future evidence status and command prerequisites. All statuses start pending; no build/test/service was run during planning. Compilation and document-link validation are different evidence categories.

G2-Web requires S01–S12 and applicable browser-host/bridge restrictions; G2-Native also requires target-native S13 and common behavior on that target. Every coverage row remains tracked. Windows blockage holds native only; shared/auth/media failure blocks all affected platforms. No native completion claim from web evidence.

### Risk Assessment

A passing compile or mock suite does not prove continuity/auth/cookie/native behavior; run named scenarios.

### Security Considerations

Temporary homes/configs/DBs/credentials only; power/process execution faked; sanitized evidence only.

### Next steps

#### Live scenarios and observable proof

| ID | Actions | Required observation |
|---|---|---|
| S01 Connections/auth | Boot A valid, B logged out, third saved profile autoConnect=false, fourth unreachable, and a profile whose authenticated status lacks protocol marker 2. Login B, connect/disconnect explicitly, edit inactive profile, logout A, reload. | Shell always usable; B independent; no autoConnect=false traffic; legacy profiles default true; editing does not reload app; A logout doesn't invalidate B. Missing/wrong protocol marker blocks that profile before WS/features with upgrade guidance; compatible peers remain usable. Tokens never sent to other endpoint, keys contain no token. |
| S02 Navigation/identity | Same project name/paths on A/B; switch project picker repeatedly, open qualified deep links and an ambiguous legacy link; select empty/unsupported profile. | Grouped profile→project identity and URL/path labels; stable sockets/resource owners; no workspace:switch, auth change or implicit first-project fallback; unqualified legacy link is rejected with fresh-navigation guidance. |
| S03 Files/editor/uploads | Open A/B equal file paths, make A dirty, select B, save A, upload to A while focusing B; rename/delete A target; exercise large/binary/HTML/Markdown. | Distinct Monaco models/view state; only A filesystem changes; dirty B untouched; A target-unavailable doesn't affect B; previews remain sandboxed and owner-bound. |
| S04 Search/replace/Git | Federated root search with shared needle, B offline/slow; cancel/new query, exceed cap; replace selected A/B matches with dirty-file conflict. Create equal worktrees/submodules; stage/commit/push selected A and authenticate failed B bulk target. | Partial labelled results/truncation; stale results suppressed; exact per-file replace outcomes; no undisplayed writes; root/worktree/submodule scopes preserved; successful bulk A is not replayed when retrying B. |
| S05 Terminal continuity | Stream shared-session on A/B; type/resize each. A→B→A through IDE/traditional/Fleet/runtime/floating/maximized/standalone/compact and Settings; disconnect/reconnect A; close/kill a fixture terminal explicitly. | Owner-specific acknowledgements and continuous other-owner output; same printed PIDs/incarnations through navigation; layout/pins restored; no navigation-triggered create/kill/remove; close/remove and kill retain distinct semantics. |
| S06 Workflow/agents | Create same-named workflow items/sessions/notes on A/B; navigate terminal link while B selected; edit A note during B navigation. Ship/unship item in A, scan import in A then display B, edit separate memory drafts. | Histories/UUIDs/targets/notes remain owner-bound; link reaches A incarnation; unavailable links stay unavailable; A scan tmpDir never confirmed on B; distribution never crosses server catalogs. |
| S07 Media/encryption | Preview/download A/B same image/video path concurrently on same hostname different ports. Add A2 pointing to A with second actor. Logout A; block third-party cookies and test exact-origin fallback. Start encrypted A save, switch B; lock/reconnect A during handshake. | B/A2 media remains usable; A namespace revoked; wrong actor/namespace denied; old server rejected at protocol admission; no v1 path; encryption prompts/keys/session IDs never shared, stale handshake cannot upload or repopulate cache. |
| S08 Ports/Browser | Expose same port numbers in isolated network namespaces/hosts where needed; otherwise use seeded detector fixture for collision and real distinct ports for traffic. Open A loopback/ready tunnel target; select B project, then explicitly B Browser target. Capture/prepare artifact, replace terminal ID incarnation, submit handoff. | Rows/tunnels distinguish owners; project focus doesn't change Browser; explicit switch resets trust/capture; DOM-forged routing ignored; old-incarnation artifact denied and new PTY receives no text. Real public tunnel test uses disposable approved endpoint only, no production service exposure. |
| S09 Preferences/settings/usage | Preference A, Settings B, project A; change font then B config; switch target during delayed file import/debounced save. Pin B mount/order, configure fixture usage/Codex location, export config and delete only B fixture usage range. | Preference save only A; server config/pin/order/usage only B; target switch doesn't reroute old transaction; unavailable preference source retains snapshot and disables writes; no global telemetry sum/double-count. |
| S10 Host safety | In fake-executor API fixture, open A sleep dialog then navigate B; change A generation/revision; simulate conflict and lost response. Mix available/unsupported host metrics. | Dialog never changes owner; stale confirmation rejected, refreshed fleet belongs A; exactly zero real power/process actions; no ambiguous replay; no-auth rejection and enabled-actor/origin/inhibitor checks preserved. |
| S11 Lifecycle races | Delay A read, save response, upload, media issue, login/test, Git credential prompt and Browser artifact; change A URL/token/remove while B healthy, then release. Crash/restart only A server, send old WS event/disposer. | No old-token/new-URL request; new A/B state ignores old generation; cleanup targets original endpoint; unknown writes not replayed; B unaffected; endpoint/root replacement cannot revive detached drafts/terminal refs. |
| S12 Notifications/reset/diagnostics | Equal terminal IDs send notifications; click A while B focused. Seed old tabs/layout/pins/history and associated quarantine backups; upgrade/reload, interrupt storage writes, deny storage, edit tokens cross-tab. Export A diagnostics. | Click reaches A; old browser resource records dropped without archive/restore/remote effect; new-version entries and profiles/auth/native stores survive retries; denied storage never means empty profiles; only A output with existing consent/redaction, no secrets/history/env. |
| S13 Native | Windows two disposable SSH scopes; equal imported IDs, independent markers, port conflict; focus changes, close/delete/fail A; actual openClient epoch transition. Native Browser explicit target switching/stale relay/security negatives. | Both scopes survive focus; A teardown doesn't affect B; global quotas/port conflicts and vault/trust/main-window guards hold; true epoch stops all. Windows artifact-bound runtime evidence required; Linux unsupported SSH generates no invoke/fallback. |

For each scenario retain sanitized screenshot(s), relevant request endpoint/method/owner correlation without tokens/query secrets, expected/actual marker or file diff, terminal incarnation/PID where relevant, and pass/fail. A request log alone does not prove UI continuity or correct filesystem effect. Use actual Chromium UI through browser automation, screenshots for visual grouping/layout, and API/filesystem observation for remote effects. Runtime fault injection may delay/drop responses in test browser/network layer; don't add production debug switches.

#### Focused regression and command gates

Run after integrated ownership migration, not concurrently against partially edited shared files. Update broken existing tests; add permanent tests for plausible collisions/races/authority boundaries, not implementation strings or wording. New planned files are explicitly new: `packages/ui/src/api/connections.test.ts`, encrypted-owner regression beside existing hook/context, and a browser multi-profile regression under the existing browser-test discovery pattern if the scenario needs permanent browser coverage. A throwaway fixture driver is proof machinery, not a new product subsystem.

Commands from repository root. Shared/UI/backend/web/extension commands are web gates. Native tests/builds, `pnpm check` Linux packaging prerequisites and Windows commands are target-native/whole-repository gates, not blockers for an otherwise qualified web release. Also run `pnpm build` and `pnpm lint` for the standalone web gate:

```text
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/ws-transport.test.ts src/hooks/use-sse.test.ts
pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/stores/project-target.test.ts src/hooks/use-search-panel-replace.test.tsx src/hooks/use-fs-upload.test.tsx
pnpm --filter @dam-hopper/ui test src/api/image-tickets.test.ts src/api/video-tickets.test.ts src/api/media-session.test.ts
cargo test --manifest-path server/Cargo.toml media
cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts
cargo test --manifest-path server/Cargo.toml --test workspace_targets --test project_worktree_lifecycle --test workflow_api --test settings_import_export --test auth_no_auth
cargo test --manifest-path server/Cargo.toml --test idle_suspend --test idle_suspend_phase07
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
pnpm --filter @dam-hopper/native test
pnpm --filter @dam-hopper/native build
pnpm build:extension
pnpm check
```

`pnpm check` includes web build, native Linux deb/rpm build, lint and backend tests; requires platform dependencies. Run Windows-native `cargo test --manifest-path apps/native/src-tauri/Cargo.toml` and `pnpm --filter @dam-hopper/native test:e2e:ssh-forward` on Windows with disposable SSH fixture, plus existing `smoke:ssh-forward --runtime` and `--validate-evidence` workflow and native Browser `tauri:probe`/`smoke:evidence`. A smoke script prerequisite report is not a pass; record actual behavior first. Select only one configured Chromium channel/executable for UI browser suite as its config requires. Format touched files with project Prettier/Rust formatter once at integration; avoid repo-wide unrelated reflow.

#### Completion, documentation and rollback

After live smoke proves behavior, update existing `docs/user-guide-multi-server-profiles.md`, `system-architecture.md`, `api-reference.md`, `configuration-guide.md`, `frontend-components.md`, `workflow-client-state.md`, `workflow-context-surface.md`, `native-browser-debug-support.md`, `ws-protocol-guide.md` where ownership—not wire identifiers—changes, and `docs/CHANGELOG.md`. Explain independent connection actions, startup autoConnect, explicit preference/Settings targets, duplicate-profile shared authority, intentional old browser resource loss, mandatory matched frontend/backend upgrade, removed v1/optional-incarnation contracts and per-platform release status. During this planning task, only plan documents and an explicitly proposed architecture section are changed; application files remain untouched. Remove throwaway fixture scripts/secrets/services and retain sanitized evidence; keep only justified regressions.

Rollback deploys a mutually compatible previous frontend/backend set; deliberate deletion means old browser tabs/layout/history cannot be restored by the application. Saved profiles/server resources remain separate; auth format rollback may require fresh login, never copying a bearer across endpoints. No server DB ownership migration is needed; media/artifact state remains ephemeral and native persistence unchanged. Web can release when G2-Web passes; Windows-native release remains blocked until real S13 proof passes. Report platform status independently.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Windows runner/device and browser runtime access must be established at execution; unexercised platform gates remain blocked.
