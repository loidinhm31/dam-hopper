---
title: "OS session management and interaction consistency"
status: approved
created: 2026-11-04
branch: main
scope: design-only
---

# OS session management and interaction consistency

## Decision and final artifact

**Approved by the user in this conversation.** Approval explicitly includes a narrowly scoped server-side termination identity guard. No implementation authorization. Planning consent is a separate gate, not implied by approval.

Final design artifact: this report. Expected implementation outcome: seven user concerns resolved through three bounded, parallel workstreams, with integrated application acceptance. No source, tests, configuration or infrastructure changed by this brainstorm.

Selected preferences:
- Terminal X asks **Close view / End session / Cancel** while the session is running.
- Hub opens an **adjacent ordinary OS terminal window**, not an embedded second terminal renderer.
- Workstreams proceed **in parallel** after shared contracts are established; one integrated acceptance checkpoint.

## Problem and evidence status

The user reports terminal accumulation after closing windows; opaque Recipe target fields and unmatched windows; ineffective Hub Review; fragmented terminal/harness management; inconsistent outside-click/Escape dismissal; identically placed floats; and missing title-bar double-click tile/float transitions.

Treat reported behavior as ground truth. Read-only source inspection explains mechanisms; intermittent keyboard behavior was not runtime-traced. Three read-only scouts completed; their results were inspected and screened against repository contracts. Initial branch state: clean `main`, ahead of `origin/main` by 17 commits. No tests, builds, formatter runs, runtime reproductions or deployment checks were performed. No new runtime-correctness claim.

Correction to earlier consultation: Recipes does not currently restore all app windows/layouts. The inspected executor creates backend terminal sessions; it does not implement complete app-step/window-layout adoption. Per-launch Web Locks do not establish global exactly-once run selection. These omissions remain separate known execution limitations.

## Scope and constraints

### In scope

1. Explicit close-versus-end policy and discoverable background sessions, including unobserved/non-agent workloads.
2. Recipe source desktop and canonical server/project suggestions, matching/excluded previews, actionable empty states.
3. Capability-qualified Hub Review with accurate unavailable states and protected-data retirement.
4. Central project/session/agent navigation in Hub and side-by-side ordinary terminal windows.
5. Consistent dismissal/focus for Target selector, Window List, Notification Center, Command Palette and custom profile/settings dialogs; preserve protected form/confirmation semantics.
6. Cascade placement for new unpositioned floats.
7. Title-bar background double-click tile/float transitions.
8. Atomic expected-session identity termination guard, shared by affected web End/Kill callers, necessary for safe destructive actions.

### Out of scope

- Full Recipe execution/layout-restoration, unknown-create/concurrency remediation, or certification of those existing gates.
- Automatic idle cleanup/expiry, command-name agent detection, automatic session eviction, broad process supervision changes.
- An embedded Hub terminal renderer, second terminal host, plugin/scheduler platform, or legacy shell resurrection.
- Android redesign, unrelated OS apps, broad server API redesign, changing review capture producers or enabling tracking automatically.
- Implementation, commits, releases, migrations, or executing an implementation command from this brainstorm.

### Invariants

- Explicit profile/generation ownership; immutable verified backend identity; no ambient transport fallback or silent rebinding.
- One visible live terminal claim per qualified PTY. Placement/tab/desktop operations retain the same xterm with zero placement-induced attach/replay/reset. Real reconnect is a separate owner-revalidated path.
- **Close is not a placement operation.** Current Close view disposes local xterm while backend PTY survives. Reopening may recreate the renderer and replay; it must not create a new backend PTY. No promise of same-xterm continuity across close/reopen.
- Hidden/background views never receive input or unnecessary rendering work. Cognito remains highest input/privacy boundary.
- Preserve existing terminal-layout:v3 keys and OS session compatibility. Do not persist credentials, output or runtime authority as portable layout state.
- No new third-party window manager; reuse current query, status, tile, claim and UI primitive conventions. No automatic relocation of another desktop's windows.
- Original redesign forbade API changes except Usage removal. This **approved remediation explicitly permits the narrow termination guard**; other API scope remains unchanged.
- No fixed delivery date or staffing constraint supplied. Do not infer one.

## Options and rationale

| Decision | Selected | Rejected alternative and trade-off |
|---|---|---|
| Close behavior | Ask Close view / End session / Cancel | View-only X stays easy but hides resource accumulation; terminate-by-default risks live work. Prompt adds interaction cost but exposes semantics. |
| Hub terminal placement | Adjacent ordinary terminal windows, tabbed in a side pane when useful | Embedded master-detail requires another host-membership/claim handoff path. Selected approach reuses current OS layout and renderer. |
| Recipe targets | Canonical selectors from actual desktop contexts, readable labels and counts | Raw-ID entry is error-prone; ambient independently selected defaults invent unmatched pairs. |
| Transient layers | Reuse coordinated accessible primitives and shared input precedence | Independent global listeners conflict over Escape, portals, focus and PTY isolation. No broad new overlay framework. |
| New floats | Small deterministic cascade and canvas-aware fitting | Identical defaults obscure windows; general overlap optimization is unnecessary and cannot guarantee unobscured terminals. |
| Double-click | Tile/float on noninteractive title bar | Native maximize convention differs, but user explicitly requested mode switching. Maximize remains separate. |
| Delivery | Parallel workstreams, shared prerequisite contracts | Serial delivery unnecessarily blocks independent selector and interaction work. Shared shell writers still require serialization. |

## Workstream A: session management, Review, adjacent terminals

### Shared inventory and presentation

- Reuse the existing server session inventory queries and verified agent status builders. Do not add a separate session authority or duplicate polling loop.
- Hub retains agent urgency overview and adds project grouping plus **All sessions / Agents / Background** filters.
- Include live backend sessions without open terminal views; ordinary workloads must remain discoverable. Background means no open terminal view, not idle/safe-to-kill.
- A session with no verified agent observation is labeled accordingly, not asserted to be a shell. Do not parse commands to decide agent status or destruction policy.
- Show server/project identity, process availability and whether/where an OS view exists. Metadata exposure follows Cognito redaction.
- Reuse navigator/grouping patterns rather than rebuilding the old monolithic WorkspacePage. System Monitor already supplies a session inventory; this design makes management prominent and coordinated rather than claiming none exists.

### Close and End

- Every affected explicit terminal-view Close entry, including window-list controls, follows the same policy.
- Running session: present Close view / End session / Cancel; initially focus Cancel. Unknown/disconnected identity must not enable destructive End.
- Close view removes presentation only; backend session stays discoverable as Background. Reopen binds the verified existing session; never launch a replacement merely because its view is absent.
- Exited session: close view without a running-process prompt. Exit state must be authoritative, not inferred from absent agent status.
- End targets the captured exact server session identity, not whichever process later occupies the same raw ID. Keep errors/status visible; remove the selected live presentation only after authoritative success. Server history/tombstone remains; no automatic kill-then-remove chain.
- If an End response is lost, show an unresolved outcome and reconcile the captured identity. Do not blindly retry, target a replacement, or imply that dismissing the UI undoes a dispatched termination.
- Component cleanup, desktop removal/reparenting, minimization and tab changes never issue End. End must act on the captured process, not look up a replacement after awaiting work.

### Destructive API guard

- Server validates expected incarnation and authoritative server-lifetime identity where needed, atomically with selecting the process to terminate. A client list check followed by bare-ID kill is insufficient.
- Mismatch/stale authority has no destructive effect. Client revalidates ownership after awaits and displays refusal rather than switching targets.
- Surface guard support explicitly; unsupported server capability disables safe End with upgrade guidance. Never send a guard to a server that can ignore it and then claim safety, and never fall back to bare-ID termination.
- Migrate affected web End/Kill paths to the guarded contract, including the existing System Monitor action. Preserve unrelated clients/routes through a narrowly scoped compatible contract; the approved outcome is safe web actions, not a claim that old clients acquire new guarantees.
- Exact wire fields/capability encoding are implementation-plan details constrained by this atomic identity contract, not permission for a broader API redesign.

### Side-by-side behavior

- Open beside Hub uses normal tile/window operations, arranging Hub and a terminal pane. Additional ordinary terminal windows may be tabs in that pane, avoiding a new renderer and float pile.
- Reuse/focus an existing qualified window. Same-desktop placement is an explicit consequence of Open beside; another-desktop window offers Go to window or explicit Move beside Hub.
- A minimized view is restored when selected. Minimize/background desktop membership is not confused with no open view.
- Transfer/place existing live views without duplicate claims, replacement PTYs or placement-induced xterm recreation/attach/replay. Preserve unrelated pane topology as far as the requested split requires; do not rebuild the whole desktop.

### Review

- Determine availability from owning-server configuration and authoritative session-change metadata, not the harness badge alone.
- Resolve exact profile, originating generation, terminal ID/incarnation, OMP capture identity, server epoch and verified review root as supported by the existing metadata contract. Do not hardcode a guessed root or fill a missing generation from a newer connection.
- Loading, disabled tracking, unsupported capture, missing baseline/root and disconnected/retired identities have explicit reasons. Link to exact server Settings when appropriate; never auto-enable tracking or imply historic capture can be reconstructed.
- Revalidate at action time. A valid action opens/focuses the exact read-only review. No silent window creation followed by immediate disappearance.
- Disable/disconnect/retirement cancels requests and removes protected review content/cache. A content-free unavailable explanation may remain outside the live viewer subtree. This intentionally replaces silent auto-close presentation, not fail-closed data retirement.
- Closing one review does not purge unrelated active review identities. Owner retirement/config disable can invalidate all protected data for that owner as required.

## Workstream B: Recipe target and capture usability

- Provide explicit **Source desktop -> Server -> Project** selection. Capture source is visible; navigating elsewhere does not silently replace the chosen capture source or discard authored commands.
- Build eligible `(profileId, projectId)` pairs from actual source-desktop window contexts, including same-project worktrees. Show readable server names and window counts; matching uses canonical identities. Duplicate display names must remain distinguishable.
- Choose a valid desktop default with matching windows, otherwise the sole eligible context. Mixed contexts require explicit choice. Never synthesize a pair from unrelated ambient profile/project fallbacks.
- Configured/discovered projects can supplement suggestions but cannot imply that a matching window exists. Present match counts and source-context suggestions first.
- Preserve disconnected/missing-profile window identities with unavailable indicators; local capture need not require a live connection. Launch availability remains separately gated.
- Async discovery populates choices only; never overwrite deliberate selection. No manual internal-ID entry needed for normal use.
- Preview included windows and explicit exclusions before save. Exclude contextless/fleet utility windows, including the Recipes manager itself, rather than capturing it accidentally.
- Empty states distinguish no project windows, a different context and a different desktop. Offer valid context/source choices; no automatic rebinding, window moves or empty recipe saves.
- Preserve required authored command review, inert JSON import, and export warnings. User-authored commands/paths can contain secrets; exporting is **not** guaranteed secret-free.
- Clearly distinguish captured layout specifications from currently incomplete execution/layout restoration. Do not mark existing Recipe execution gates complete.

## Workstream C: dismissal, placement and title-bar gestures

### Coordinated transient dismissal

- Scope: Target selector, Window List, Notification Center, Command Palette, and custom Server Profiles/Server Settings dialogs. Existing nested Select/context menus and protected confirmation dialogs participate in the same precedence without blanket behavior changes.
- Outside pointer interaction dismisses nonmodal transient menus. Mouse leave alone does not. Escape closes only the topmost dismissible layer.
- Use existing accessible Dialog/Select/menu patterns and actual layer/portal ownership, not unrelated global handlers or a selector treating every Radix portal as inside every popup.
- Palette captures focus immediately, traps it while modal, supports outside/backdrop dismissal, and restores the invoking focus on keyboard close. Avoid a timed-focus gap.
- Outside-click dismissal of a nonmodal menu preserves the intended clicked target. Modal backdrop dismissal consumes the interaction instead of delivering it to an underlying terminal.
- Keyboard dismissal restores the trigger/previous valid focus. Closing a nested selector does not also close its parent or emit Escape to xterm.
- Preserve dirty-form save/discard and destructive-confirmation cancel protections. Do not silently discard form edits or claim an already-dispatched operation was cancelled by dismissal.
- Integrate actual modal/Cognito state with shell arbitration and terminate active gestures on privacy activation. Radix adoption alone is not proof of input isolation.

### Float placement

- New floats without explicit/saved bounds cascade approximately 28px from an existing origin, wrapping within the destination desktop canvas.
- Fit usable canvas rather than whole browser viewport; account for shell bars/dock through existing canvas geometry. Keep title bar and controls reachable at supported sizes and zoom.
- Preserve explicit/restored/user-positioned bounds; any viewport adaptation is non-destructive to saved topology/geometry.
- Use the same sensible initial placement when first converting a tile without prior float bounds. Reuse prior float placement when available.
- Cascade reduces exact stacking, not all overlap. Do not move existing windows automatically or add a packing optimizer.

### Double-click and drag

- Primary-button double-click on noninteractive title-bar background toggles tile/float exactly once.
- If maximized, exit maximization and change mode in one coherent action. Maximize/Restore remains a separate control.
- Exclude buttons, selectors, links, inputs, resize handles and app content. Ignore gestures that became an actual drag; apply a small movement threshold and primary-button/privacy guards.
- Reuse existing mode/layout actions, preserving focus, owned resource identity and valid placement. Explicit controls remain the accessible non-pointer alternative.

## Parallel boundaries and touchpoints

Shared prerequisite contracts: session identity and guarded End; Hub focus/place intent; modal/input precedence; canvas placement inputs. A consumes the server guard before enabling destructive calls. B and C need not wait for A's implementation. Shared `OsShell.tsx`, window state and UI primitive edits need a single integration owner or serialized handoff, not racing writers.

| Workstream | Likely touchpoints |
|---|---|
| A | `packages/ui/src/os/apps/AgentHubApp.tsx`, `TerminalsApp.tsx`, `SessionChangesApp.tsx`, `SystemMonitorApp.tsx`; `OsShell.tsx`, `OsResourceHost.tsx`, `WindowFrame.tsx`, `WindowList.tsx`, `agent-hub.ts`, resource claims/intents/window store; existing aggregate session/agent queries and Traditional navigator helpers; terminal API client, `server/src/api/terminal.rs`, `server/src/pty/manager.rs`. |
| B | `packages/ui/src/os/recipes/RecipeEditor.tsx`, `recipe-engine.ts`, `packages/ui/src/os/apps/RecipesApp.tsx`; existing profiles and aggregate project discovery; schema/persistence only where capture projection requires it. |
| C | `TopBar.tsx`, `WindowList.tsx`, `NotificationCenter.tsx`, `CommandPalette.tsx`, `WindowFrame.tsx`, `window-ops.ts`, `window-store.ts`, `input-arbiter.ts`, `DesktopCanvas.tsx`; existing Dialog/Select/menu primitives and custom profile/settings dialogs. |
| Acceptance/docs | Existing OS browser/component and application journeys; meaningful server termination race tests; architecture/frontend/API documentation and changelog for implemented behavior. No historic qualification ledger is fabricated as fresh acceptance. |

No external service or new database is needed. Likely extension is the termination API's guarded contract, not authentication/session persistence redesign. Use existing engineering/testing workflows for future implementation; no implementation workflow was invoked here.

## Acceptance criteria and validation

Future validation must exercise real authenticated root `/` or `/os`, not only isolated fixtures. Supported baseline viewports: 1440x900 and 1024x640; include zoom/resize, repeated actions, equal raw IDs across profiles, reconnect/owner retirement, and Cognito. Production full-viewport captures require actual human review; passing automated checks do not imply acceptance.

| Concern | Observable acceptance |
|---|---|
| 1 | Start a real long-running terminal, X -> Cancel changes nothing; Close view leaves the exact backend PTY alive and discoverable; reopen creates no PTY; End stops only the confirmed identity. Exercise all relevant Close entry points. Replacement/restart during confirmation or request cannot terminate the replacement; unsupported guard is fail-closed. No idle auto-kill or tombstone eviction. |
| 2 | A single eligible context saves without typing IDs; mixed contexts show explicit counted choices. Names and IDs cannot be confused. Changing source, delayed discovery, offline contexts, no candidates and fleet-only desktops behave accurately. Preview includes all exclusions and source windows remain unchanged. |
| 3 | Eligible Review opens exact owner/session/root data; unsupported/disabled/missing states explain refusal. Retirement mid-await blocks dispatch/completion, stops protected reads and removes sensitive content. Closing one review preserves another identity's cache. |
| 4 | Hub lists agent and unobserved sessions, including no-view sessions. Open beside reuses/adopts the correct PTY into an ordinary pane/tab without duplicate creates/claims; another desktop is not silently rearranged. Placement preserves the same xterm and zero extra attach/replay/reset. |
| 5 | Each named transient dismisses appropriately via outside interaction and Escape. Nested portaled menu closes first; palette traps/restores focus; outside clicks do not accidentally type/interact with underlying PTYs. Confirmations and dirty forms retain protections. Physical PTY-byte oracle proves consumed shortcuts never reach a shell. Cognito blocks all layers. |
| 6 | Consecutive unpositioned floats receive distinct origins when canvas space permits; wrap/fit keeps controls reachable. Existing explicit/saved bounds remain intact, including shrink/widen behavior and first tile-to-float placement. No promise of zero overlap. |
| 7 | Double-click title-bar background toggles mode once, including maximized case; control clicks, text interaction, secondary clicks, actual drags and privacy-blocked input do not. Keyboard controls remain available. Same resource identity and zero placement attach/replay/reset. |

Layered future gates: focused pure layout/state boundary tests, real server expected-identity race/error tests, rendered portal/focus browser checks, and actual application PTY flows with physical-input and attach/replay counters. Run project checks across the integrated change set; remove throwaway validation scaffolds. No test counts or pass claims are assigned before execution.

## Feasibility, stakeholders and risks

- Feasible using current inventory/status, tile panes/tabs, claims, owner-bound APIs and UI primitives. This is integration and contract remediation, not a new OS runtime.
- Users gain explicit process lifetime and central navigation; prompt cost on live Close is an accepted trade-off. Operators retain old clients but need guarded-capability support for new safe web End behavior.
- Backend process identity race is real at the contract level: current DELETE kill uses bare ID. A client-side preflight is not an adequate mitigation.
- Agent observation absence proves neither idle nor non-agent status. Keep classification honest and operations explicit.
- Plain backend survival is not local renderer survival. Distinguish close/reopen from placement in docs and validation.
- Dismissal changes cross focus, portals, frame capture, Monaco, xterm and Cognito; source inspection alone cannot prove reliable Escape or privacy behavior.
- New End API capability/version handling must not silently degrade on an old server. Server-lifetime identity cannot be guessed from unrelated status counters.
- Recipe target UX does not close existing AC8/F1 execution gates. Retain their explicit unresolved status without expanding this approved scope into a hidden execution rewrite.
- Existing project architecture docs mix historical and current reachability claims. Future implementation documentation must describe exercised current behavior, not reuse historic test counts.

## Evidence references

- `plans/261101-1738-ai-dev-os-redesign/plan.md:14-17,33-40`: ownership/lifecycle/creation invariants and carried qualification gaps.
- `plans/261101-1738-ai-dev-os-redesign/acceptance.md:11-17,23-25`: live resource, qualified actions, Recipe subset and navigator contracts.
- `packages/ui/src/os/OsResourceHost.tsx:184-209`: terminal renderer membership derived from terminal windows.
- `packages/ui/src/os/WindowFrame.tsx:204,323-418`; `window-ops.ts:231-260`: view Close and window removal; header lacks double-click mode handling.
- `server/src/api/terminal.rs:370-390`: bare-ID kill; remove is separate kill+evict.
- `packages/ui/src/os/apps/AgentHubApp.tsx:238-248,533-549`: unqualified availability of Review and dispatched payload.
- `packages/ui/src/os/apps/SessionChangesApp.tsx:24-52,81-114`: captured identity, guessed-root default, auto-close/cache paths.
- `packages/ui/src/api/session-changes-types.ts:121-136`: authoritative metadata includes server epoch, incarnation, capture identity and root.
- `packages/ui/src/os/recipes/RecipeEditor.tsx:54-59,249-319`: independent target defaults, raw text fields, empty warning.
- `packages/ui/src/os/recipes/recipe-engine.ts:41-100,454-504`: source membership and exact matching; terminal-only executor.
- `packages/ui/src/os/TopBar.tsx:116-216`, `CommandPalette.tsx:406-444`: custom menu and bubble-only palette Escape/backdrop gaps.
- `packages/ui/src/os/window-ops.ts:23-46`: identical float defaults and partial viewport clamp.
- `docs/system-architecture.md:48-79`: historical navigator and review contracts; source remains authoritative.
- Completed read-only consults in this session: `agent://TerminalHubSurface`, `agent://RecipeTargetSurface`, `agent://ShellInteractionSurface`. These session-local outputs are supporting analysis, not persistent runtime evidence.
- Advisor review screened the candidate design, requiring exact termination/root authority, no claim of same-xterm close/reopen, no silent movement, and coordinated dismissal rather than ad-hoc listeners.

## Assumptions and unresolved questions

- User approved the seven-concern design and narrow server termination guard after selecting the three preferences above.
- Existing server session metadata can support inventory navigation; destructive capability must be verified at the server, not inferred from that inventory.
- No material design-choice question remains. Exact wire encoding, minimal internal extraction and test selection belong to separately authorized planning under these constraints.
- **Planning explicitly deferred by the user after design approval.** Central planning router not invoked; no implementation plan created; implementation remains unauthorized. The decision journal records this actual outcome separately.
