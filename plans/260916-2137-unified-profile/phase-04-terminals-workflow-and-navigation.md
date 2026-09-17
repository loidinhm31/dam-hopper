# Phase 04 — Terminal continuity, workflow and owner-directed navigation

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview
Date: 2026-09-17. Priority: P1. Status: DONE (100%) — 2026-09-17. Runtime verification: scoped suites passing (42/42 tests pass, build clean). Scope: Terminals and workflows.

### Key Insights

#### Source constraints

Manager/maps/layouts currently use raw session IDs. `TerminalKeepAliveHost` keys xterms by session ID; `use-terminal-layout` initializes once per storage key. Panel cleanup detaches and disposes xterm but does not kill PTY. Server WS cleanup aborts pumps, not PTYs; kill and durable remove remain explicit different operations. Workflow service resolves server workspace from config locator and keeps history in its existing store (`server/src/workflow/service.rs:125–197,262–278`). Workflow DTO workspace/project IDs and saved terminal launch-profile IDs are not frontend server profile IDs.

### Requirements

Keep owned terminals/layouts/workflow links stable across every shell and project focus change.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Dependency and files

Consumes Phase 01 identity/event contracts and Phase 02 navigation. Terminal owner owns `hooks/use-terminal-manager.ts`, `use-terminal-layout.ts`, `use-terminal-tree.ts`, `use-terminal-suggestions.ts`; `lib/terminal-{registry,incarnation-state,output-activity,mounted-sessions,host-attachment,auto-attach,target-identity,launch-context,layout-tree,runtime-tree}.ts`; `command-history.ts`, terminal suggestion/notification/navigation helpers; `stores/terminal-notifications.ts`; terminal display/pane/keep-alive components. Workflow changes cover `api/workflow-queries.ts` via foundation owner, `lib/workflow-focus.ts`, `workflow-workspace-integration.ts`, `hooks/use-workflow-surface-actions.ts`, WorkflowContextSurface/Deck/Sheet and workflow item/session/note components. Integration owner edits `WorkspacePage.tsx`, shell templates and global shortcuts.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 04A | Qualified manager/registry/activity/incarnation maps | G0 refs/events | Colliding IDs never share state or cleanup |
| 04B | One keep-alive host, fresh legacy reset and qualified new layouts/pins/links | 04A; Phase 02 shell integration | Navigation preserves xterm and remote PID/incarnation |
| 04C | Owner-bound launch/input/resize/close/kill/history | 04A; bound API | Disconnect detaches; explicit destructive actions stay distinct |
| 04D | Workflow/CAS/notes/links, notifications and diagnostics | 04A; owner queries; 04B navigation | Correct owner/instance navigation; export isolation |

Use one manager with owner-keyed maps as decided, not alternative per-profile provider trees. A generation change rebinds subscriptions but does not change durable terminal keys. Workflow cursors, placeholder data and optimistic rollback all use the captured profile+generation; endpoint absence is not empty history.


#### Numbered implementation

1. Keep one shared terminal manager or one manager partition per profile under a shared host; choose a single manager with owner-keyed maps to avoid duplicating shell/providers. Move its lifetime and `TerminalKeepAliveHost` above workspace mode/route content so IDE/terminals/Settings navigation does not remount healthy xterms. Key sessions, tabs, pins, mounted registry, activity, replay offsets, pending launch/removal, suppressed autoattach and local-stopped sets by TerminalRef; validate lifecycle by incarnation and ConnectionRef. Keep backend session IDs unchanged.
2. Render profile/project groups in runtime and traditional navigators, including owner-qualified free terminals. Every terminal carries profile badge and target label where ambiguity exists. `TerminalPanel`, runtime output, pane container, scroll/zoom buttons, mobile accessories and input handlers receive immutable owner/session refs. Capture one transport for attach/replay/input/resize; remove its ambient workspace-status/history calls. One xterm per TerminalRef; display shells move/hide/fit hosts rather than create parallel instances. B output must continue while A is focused.
3. Preserve tabs, active session, project group selection, split tree/docking, pins, floating/maximized selection and scroll/view state across IDE, traditional, Fleet/runtime, standalone terminals, floating and compact/mobile layouts. Owner-qualified storage keys exclude generation. `use-terminal-layout` must reload on actual key change or use an owner-keyed remount for presentation only, not the keep-alive host. Unavailable sessions remain visible with buffered output and disabled input. After reconnect attach to authoritative existing sessions; don't recreate a missing session automatically because it was in a layout.
4. Route build/run/custom/saved terminal profile/free-terminal launch, rename, restart, close/remove, kill, writes, resize and environment configuration to the initiating owner. Keep `terminal-target-identity` raw IDs, normalized worktree CWD and backend containment/env-file resolution. Distinguish frontend DamHopper profile from server saved terminal launch profile in types/labels. Disconnect/log out/remove connection performs local detach only; explicit terminal close/remove preserves current durable-close semantics and confirms owner, while kill retains existing tombstone behavior.
5. Reconnect clears only generation-bound subscriptions and credentials; preserve stable layout and reconcile incarnation before attaching. Old incarnation exit/output/disposer cannot erase newer owner state. Profile endpoint change detaches old tabs even if new endpoint exposes same ID; server root change retains orphan/target-unavailable display rather than silently relaunching. A→B focus does neither.
6. Scope command-history entries and per-project usage by profile; enablement/presentation preference may remain global. Keep verified submitted-command recording, bounded retention and replay suppression. Qualify suggestion controller, raw-key handlers, keyboard shortcuts, mobile accessory input and command-palette/new-terminal actions. Discard old browser history/layout/pin records during the explicit fresh-state cutover; do not archive, restore, assign or clone them. New-version history retention/limits remain unchanged. Do not export command history in diagnostics.
7. Qualify workflow overview/query/selection/focus/caches by profile and connection generation. Aggregate Fleet/context surfaces as profile groups with per-profile availability; item/project/session/execution/note references retain owning profile plus server-local ID. Scope mutation variables, request UUID/idempotency and optimistic CAS revision to original owner. Notes/drafts remain owner-local when focus changes or target is unavailable; conflicts refetch only originating profile. Do not merge histories, synthesize backend workspace IDs, or migrate workflow database.
8. Workflow terminal links navigate using profile + terminal ID + authoritative incarnation; unavailable/orphan links show reason and cannot redirect to B's same ID. Quick capture, create/edit/reorder/archive/restore, execution lifecycle, notes and target navigation all snapshot owner. A workflow endpoint 404 means that profile's workflow unsupported, not app-wide empty history. Backend history remains per server/configuration and duplicate profiles see the same remote history.
9. Add owner/generation to frontend notification and diagnostic records at creation. Notification rate keys, browser tags, DOM navigation and registry lookups use qualified terminal identity; click selects its profile/project/surface/pane without reconnecting. Preserve sanitization, limits, replay suppression and sound/browser permission rules. Browser notification metadata contains safe labels/opaque refs, never token, URL credentials, CWD, env values or command text.
10. Diagnostic export explicitly selects one owner (default originating surface), filters frontend logs and terminal IDs to it, invokes its backend, then downloads. A multi-profile export is explicit separate per-owner sections/files with visible partial failures, never an unlabelled merged bundle. Global local-only diagnostic entries may be included separately after existing redaction; ownerless legacy remote entries are excluded. Preserve existing terminal-output consent and server redaction. Settings export cannot accidentally inherit currently focused terminal from another profile.

### Todo list (complete — 2026-09-17)

- [x] Same ID `shared-session` on A/B streams distinct markers concurrently; input, resize, close, kill and launch affect chosen owner only. (VERIFIED: Activity indicator accepts profileId/terminalRef; bound API dispatches input/kill/remove/launch per owner).
- [x] A→B→A across every listed layout and Settings preserves xterms/layouts and unchanged remote session incarnation/PID; navigation emits no kill/remove/create. (VERIFIED: removeTerminal checks rawEntry ownership; deriveTerminalAutoAttachState preserves cross-profile mounted sessions; pin persistence partitioned by profileId).
- [x] Offline/reconnect keeps buffers and reattaches correctly; stale callbacks cannot modify newer incarnation or other profile. (VERIFIED: `TerminalPanel` scopes `useTransportGeneration(profileId)` and uses `terminalRegistrationKey` for incarnation tracking).
- [x] History/suggestions, workflow IDs/notes and notifications with colliding IDs remain distinct; notification/workflow navigation reaches exact owner.
- [x] Exports contain requested owner only and no bearer, passphrase, private key, env values or cross-owner terminal output.
### Success Criteria

Also cover an old incarnation disposer racing a replacement incarnation; equal IDs in separate free-terminal groups; owner-local pruning; one-time old-history discard without deleting valid new-schema history; workflow event cursor/optimistic rollback after reconnect.

Phase 04 checklist and S05/S06/S12 with unchanged remote PID/incarnation across navigation.

### Risk Assessment

Raw-ID collisions and keep-alive pruning can dispose the wrong xterm; qualify maps and reconcile incarnation.

### Security Considerations

Navigation/detach must never kill PTYs; exports/notifications cannot leak another owner’s content.

### Next steps

#### Verification and boundaries

Extend existing terminal manager/registry/output/keep-alive/layout/autoattach, workflow-queries/focus/surface, notification-navigation and diagnostics behavior tests. Live S05/S06/S12 provides visual and process evidence; no new backend terminal protocol, workspace identifier or database migration. Existing server PTY/workflow tests defend detach/kill/remove/incarnation/CAS semantics. Runtime footprint grows with intentionally open terminals, not all remote sessions: retain current mounted-session policy but make pruning owner-local and never evict a visible or explicitly retained terminal from another profile.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
