# Execution map and integration contract

[Plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md) · [Qualification](verification-matrix.md) · [Validated decisions](validation-decisions.md)

## Scope decision

Implement the requested unified-profile preplan, not the older all-workspaces/backend-registry proposal linked in architecture docs. The latter remains separate, unimplemented work. No backend workspace UUID, new project registry, workflow migration, cross-server filesystem move, or generic federation service belongs here.

Preserve all nine original feature phases. Add Phase 00 for an explicit preparation gate. Each phase contains work packages, numbered implementation steps, file boundaries, pending checklist, acceptance, risks and security constraints. Work-package IDs are execution units, not independent product releases.

## Dependency graph

```text
00 contract freeze (G0)
  ├─ 01A ownership/API contracts ↔ 02A profile/auth schema contract
  │    ├─ 01B runtime/auth/cancellation
  │    └─ 01C query/event bridge
  ├─ 02B–D shell/navigation/fresh reset and web/native bootstrap
  ├─ 03 files/editor/search/Git
  ├─ 04 terminals/workflow/notifications/diagnostics
  ├─ 05 agents/ports/Browser + artifact backend
  ├─ 06 preferences/Settings/usage/host
  ├─ 07 media backend/helpers/encryption
  └─ 08 native scopes/IPC/Browser host (native release branch)
       all shipped-target callers + 01D removal + target shell
                         ↓
             G1-Web / G1-Native ownership cutover
                         ↓
             09 web/common proof + separate native proof
                         ↓
             G2-Web / G2-Native independent release gates
```

`↔` above is a contract agreement resolved in Phase 00, **not a runtime implementation dependency cycle**. Actual execution order: agree credential schema and registry API at G0 → implement 02A helpers and 01A types independently → 01B consumes both. Feature work consumes frozen interfaces; it does not wait for the whole Phase 01 acceptance checklist.

## Cross-slice producer/consumer contracts

| Producer | Consumer | Contract required before work | Implementation join |
|---|---|---|---|
| 01 + 02 | Every feature | Explicit refs, endpoint-bound credentials, generation/status, immutable snapshots, required auth-status protocol marker | Target G1 |
| 01 | 03–08 | Bound API/transport, owner query keys, decorated events, disposal | G1 |
| 02 | 03–06 | Qualified selected project; independent preferences/Settings selectors; explicit fresh-state reset key/version inputs | Feature UI integration |
| 04 | 05 | Stable `TerminalRef`, authoritative `TerminalInstanceRef`, exact-owner navigation | Handoff UI integration |
| 05 | 08 | Browser target owner, revision, URL/origin/source and one physical lease | Native Browser adapter integration |
| 07 + 01 | 03 + 05 | Media leases and narrow original-endpoint cleanup handle | Preview/capture integration |
| 03 | 07 | Qualified file target/tab binding and dirty-state rules | Encrypted write/preview integration |
| 05 backend | 05 frontend | Required create incarnation and matching response; atomic write admission | Matched protocol-2 deployment; missing field rejected |
| 07 backend | 07 frontend | Required mediaClientId; v2-only response and scoped actor/namespace revoke | Matched protocol-2 deployment; no v1 branch |
| 08 Rust | 08 TypeScript | Exact NativeScopeRef/open/close/reconcile command and counter validation | Atomic bundled native cutover |

Contract availability permits parallel implementation; runtime proof waits for both producer and consumer. Resolve shared-file edits through the assigned writer rather than allowing concurrent textual merges.

## Single-writer ownership

| Writer | Owned shared files | Coordination rule |
|---|---|---|
| Foundation/integration | `packages/ui/src/api/{ownership,connections,transport,client,query-client,queries,workflow-queries,ws-transport}.ts`; `hooks/{use-sse,use-sse-events,use-transport-generation}.ts`; `server/src/api/auth.rs` protocol-marker response | Feature owners supply explicit signature/key/event needs; writer applies and migrates exports/callers |
| Profile/shell integration, coordinated with foundation | `packages/ui/src/api/server-config.ts`; `embed/dam-hopper-app.tsx`; `components/pages/WorkspacePage.tsx`; TopNav/Dashboard/project and profile selectors; `apps/{web,native}/src/main.tsx` | One shared shell; no per-profile root remount or duplicate QueryClient |
| Files/Git (03) | Editor/target/tree/search state, file/preview consumers, search/replace/upload and Git hooks/components | Use Phase 07 helpers; do not duplicate media/crypto protocols |
| Terminal/workflow (04) | Terminal manager/registry/layout/keep-alive/history; workflow UI; notification/navigation/diagnostic ownership | Shell owner integrates host placement; foundation owns workflow query exports |
| Agents/Browser (05) | Agent store/import UI, ports/tunnels, Browser UI/trust/capture; Rust artifact store/API and PTY incarnation-write helper | Preserve shared bridge protocol; no native generic IPC |
| Settings/host (06) | Settings preference store/page/sections, config editors, usage and host UI/state | Shell owner integrates selectors and ordering consumers |
| Media/encryption (07) | Ticket helpers, Image/VideoPreview media lifecycle, EncryptContext/encrypted-write/OPAQUE; Rust media store/API/stream authorization; browser media fixture routes | Files owner changes outer preview/tab props; agree exact component hunk ownership before edits |
| Native (08) | Native SSH/Browser adapters; shared SSH host/context/hooks/page; Rust manager/model/commands/registry/vault/trust; Tauri command/permission manifests | Shell owner alone changes native main; preserve Windows guards |
| Final integrator (09) | Cross-slice acceptance, remaining caller inventory, docs and qualification evidence | Run integration validation after shared mutations settle |

Bracketed file families denote existing files except the explicitly new Phase 01 `ownership.ts` and `connections.ts`. Do not create placeholder modules for every family. Keep existing module layout; split only when a real concern demands it.

## Integration discipline

1. Develop in an implementation branch, not a production toggle retaining ambient authority. Deploy matching frontend/backend protocol contracts. A complete qualified web cutover may release independently of native; do not ship incomplete caller migration on any target.
2. No fake `getTransport()`/`api` facade that reads current selection. No old-path alias to make incomplete callers compile. No dormant old active-profile dispatch in the final bundle.
3. Queries retain existing polling/stale-time policy. Async callbacks carry owner plus their operation revision; freshness is checked after every relevant await and on rejection.
4. One socket/runtime per intended supported profile; one xterm per mounted qualified terminal; one physical Browser surface. No deduplication by URL or per-profile application tree.
5. Every phase marks implementation pending until its behavior is exercised. Phase 01 acceptance requires every shipped-target caller; shared code cannot retain ambient authority. Feature completion alone does not satisfy that target’s G1/G2; native acceptance stays pending until Phase 08.
6. Run focused regressions for newly integrated behavior; run project-wide format/lint/build/test once after shared edits settle. Do not use tests that merely pin wiring, wording or defaults.
7. Finish smoke proof before documentation/temporary-fixture cleanup. Retain only security/behavior regressions and sanitized evidence. No application implementation occurs during this planning task.

## Release and rollback

- New frontend requires successful `GET /api/auth/status` field `workbenchProtocol: 2` before WS/features. Missing/wrong marker gives unsupported/upgrade-required, not partially working old-server mode. Other compatible profiles remain independent. Authentication errors are not mislabeled protocol errors.
- Media-v1 is removed; mediaClientId and artifact terminalIncarnation are required. No old-client request branch. Ordinary bearer/cookie auth, routes, permission checks and existing server identity authority remain; old apps are unsupported without claiming all unchanged endpoints fingerprint client versions.
- Native IPC ships atomically with its TypeScript host. No old activation shim; native persisted vault/trust/store formats remain unchanged.
- Drop only allowlisted old browser resource records and associated quarantine backups; no archive/restoration. Preserve profiles/auth/native/server data; valid new-schema records survive reset retry. Rehearse storage failure without broad clearing.
- Rollback uses a compatible frontend/backend set. Deleted old tabs/layout/history do not return. Authentication may need fresh login if reverting credential formats; never reuse a token for another endpoint.
- G2-Web: S01–S12 plus web-applicable host/bridge restrictions and web/extension/UI/backend checks. Windows runtime is not a web prerequisite.
- G2-Native: common target behavior plus Phase 08/native S13, target builds and security/runtime evidence. Missing Windows proof blocks Windows/native shipping only; report it explicitly and keep native work pending. Shared failures block every affected target.

## Unresolved questions

No product/design question remains after adopting the supplied preplan. Execution prerequisites: disposable MongoDB and authenticated users, browser capture/media/cookie capability, Windows runner/device and disposable SSH endpoints. Record actual availability in Phase 09 before declaring qualification.
