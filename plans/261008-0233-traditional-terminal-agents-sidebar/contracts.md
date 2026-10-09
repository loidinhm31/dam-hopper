# Frozen contracts — Traditional Projects + Agents

**Proposed only; pending review; not implemented.** Date 2026-10-08. Authoring contract for phases 1–3; phase 4 alone integrates. Main's [design contract](reports/02-planner-contract.md) prevails over research suggestions. No backend/database/protocol changes.

## Existing evidence and unchanged owners

- [Code analysis](reports/01-codebase-analysis.md); [Herdr UX](research/researcher-01-report.md); [harness research](research/researcher-02-report.md); [risk review](reports/03-design-risk-review.md).
- Existing DTOs: `packages/ui/src/api/agent-status-types.ts`; ownership helpers: `packages/ui/src/api/ownership.ts`; readonly store: `packages/ui/src/stores/agent-status.ts`.
- `DisplayTabEntry.session?.incarnation` is concrete terminal evidence. `MountedSession` has no incarnation. Nonreactive incarnation cache and status row itself are NOT substitutes.
- Existing project grouping has bare-ID mounted fallbacks. A group/profile label alone does NOT prove ownership. New roster enforces exact qualified tab/mounted membership independently; existing grouping remains unchanged.
- Existing root `use-agent-status-connections.ts` owns snapshot fetching, reconciliation, reporter/epoch fences and notification dispatch. Presentation never subscribes directly to transport, calls install/apply functions, or creates another poller.
- Existing shared `AgentStatusBadge` remains unchanged (`working` there still reads Running). New roster reads Working.
- Ordinary plan: no advice controller, sealed captures, or progress reconciliation initialized. Planning skill loaded directly from global fallback; local `.omp/skills` absent. Frontend/web-testing skill guidance applied only where consistent with current React Router/Radix/Tailwind conventions, not its generic MUI/TanStack Router examples.

## Phase 1 module: proposed `packages/ui/src/lib/traditional-terminal-agents.ts`

```ts
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import type { ConnectionRef, TerminalRef } from "@/api/ownership.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type {
  AgentStatusPresentationAvailability,
  useAgentStatusStore,
} from "@/stores/agent-status.js";

export type AgentStatusProfilesView =
  ReturnType<typeof useAgentStatusStore.getState>["profiles"];
export type TraditionalAgentStatusLabel =
  | "Working" | "Idle" | "Needs attention" | "Unknown"
  | "Unavailable" | "Platform unqualified" | "Unsupported";
export interface TraditionalTerminalAgentPresentation {
  readonly label: TraditionalAgentStatusLabel;
  readonly reasonLabel: "Approval" | "Question" | "Error" | null;
  readonly outcomeHint: "Done (turn ended)" | null;
  readonly sourceLabel: "Lifecycle observation" | "Hook observation";
  readonly coverageHint: string | null;
}
export interface TraditionalTerminalAgentRow {
  readonly key: string; // terminalInstanceKey({profileId,id,incarnation})
  readonly sessionId: string; // exact existing qualified tab ID
  readonly terminalRef: TerminalRef;
  readonly incarnation: number;
  readonly groupId: string;
  readonly projectLabel: string;
  readonly profileLabel: string;
  readonly terminalTitle: string;
  readonly harnessLabel: "OMP" | "Codex" | "Claude";
  readonly statusOwner: ConnectionRef; // provenance; never an API target
  readonly availability: AgentStatusPresentationAvailability | null;
  readonly status: TerminalAgentStatusRow; // original readonly DTO, no lossy copy
  readonly presentation: TraditionalTerminalAgentPresentation;
}
export interface BuildTraditionalTerminalAgentsInput {
  readonly groups: readonly TraditionalTerminalProjectGroup<DisplayTabEntry>[];
  readonly profiles: AgentStatusProfilesView;
  readonly connections: ReadonlyMap<string, ConnectionSnapshot>;
  readonly profileLabels: ReadonlyMap<string, string>; // registered profiles only
  readonly nowMs: number; // caller captures once per computation
}
export function buildTraditionalTerminalAgentRows(
  input: BuildTraditionalTerminalAgentsInput,
): readonly TraditionalTerminalAgentRow[];
```

Implementation imports `terminalInstanceKey`/`terminalKey`/`parseTerminalKey`; signatures above are frozen, not a generated schema. Store private `ProfileStatus` need not be exported. Do not widen readonly store maps to mutable `Map` parameters. No new shared foundation phase.

### Eligibility and identity algorithm

1. Iterate groups/tabs in current order; no status sorting. Index each group's mounted sessions by **exact qualified sessionId** once. Deduplicate emitted `terminalInstanceKey` values. Work O(tabs + mounted + profiles), excluding fixed-cost labels; no per-row scans of all profiles/sessions.
2. Resolve tab owner from concrete `tab.terminalRef` or `parseTerminalKey(tab.sessionId)`. Require `tab.sessionId === terminalKey(ref)`; optional tab `profileId`, parsed key and concrete ref must agree. Reject missing owner, bare ID, conflicting references or unregistered profile. Never derive owner from title, command, project name, global active profile or status.
3. Require an exact mounted entry with identical sessionId; validate its `terminalRef`, optional `profileId` and parsed sessionId against the same ref. If `group.profileId`/`group.projectRef.profileId` is present, it must agree too. A wrongly grouped bare-ID fallback must not admit an agent.
4. Require `tab.session`, `tab.session.id === ref.id`, `tab.session.alive`, and nonnegative safe-integer `tab.session.incarnation`. Missing incarnation fails closed; never get it from row or cache.
5. Read status via `profiles.get(ref.profileId)?.rows.get(ref.id)` and require exact incarnation. The profile view owner must identify the same profile; mismatched row/incarnation is excluded. No row means plain shell/not observed: exclude. Matching observed `unknown` remains a row. All admitted OMP/Codex/Claude kinds are included; installed-but-never-observed harnesses do not create runtime rows.
6. Compute readiness against **captured current connection**: connected, matching profile/generation, profile availability `ready`, baseline epoch non-null. `beginAgentStatusConnection` can retain old rows under a new owner; its unavailable marker MUST be honored even when owners match.
7. Exact-incarnation retained rows may remain visible as unavailable through disconnect/reconnect. If generation mismatch or connection absent/not connected, force effective availability `unavailable`; never expose a previous generation's ready semantics. Removed registered profile excludes row. Authoritative epoch replacement/snapshot replaces membership via the existing store; no presentation epoch cache.
8. Use `tab.title.fullText`, existing group label (including Free terminals), registered profile name or ID, and human harness name. No command/cwd/native session path/transcript/agentSessionId rendered or logged. Preserve raw status fields without displaying internal IDs unnecessarily.

### Presentation precedence (highest first)

| Condition | Primary label | Reason / secondary hint |
|---|---|---|
| Missing/not-connected/current-generation mismatch, null baseline availability | Unavailable | no reason or Done |
| Current platform-unqualified | Platform unqualified | no reason or Done |
| Current unsupported | Unsupported | no reason or Done |
| Ready row has `expiresAtMs <= nowMs` | Unknown | no reason or Done; raw DTO unchanged |
| Ready `unknown` | Unknown | no Done, even if stale lastOutcome says ended |
| Ready `working` | Working | no Done, even if stale outcome is present |
| Ready `blocked` | Needs attention | Approval / Question / Error if supplied; no Done |
| Ready `idle` | Idle | Done hint only under gate below |

`Done (turn ended)` gate: current ready baseline + exact identity/incarnation/generation + nonexpired evidence (when expiry provided) + `state === "idle"` + `lastOutcome === "ended"` + `turnId === undefined`. It is a secondary last-turn fact, NEVER task success, a wire state, unseen acknowledgment, or an alert. Other outcomes (`interrupted`, `error`, `unknown`, missing), active turn, blocked/working/unknown, lease expiry/disconnect/release/native Stop and unavailable hide it. A silent authoritative snapshot with explicit ended may display this hint silently; no transition detector/catch-up notifications.

Expiry guards use supplied wall-clock time on each computation. Existing server expiry/invalidation and app-root 15s reconciliation drive refresh; no client lease renewal, invented grace-period Idle, new timers or polling engine. This is not a guarantee of millisecond-exact local lease expiration.

Source explanation always retained, including unavailable rows: lifecycle -> Lifecycle observation; hook -> Hook observation + `Hook observation (limited coverage; quiet reasoning and long waits become Unknown)`. Status and reason use text/icon, not color alone; Done tooltip explicitly says last turn ended, task success unverified. Notification preferences cannot gate roster membership, hints, or badges.

## Phase 2 component interfaces

Proposed `packages/ui/src/components/molecules/traditional-terminal-agent-row.tsx` follows existing layer boundaries; kebab-case for new files, existing navigator name preserved.

```ts
import type { JSX } from "react";
import type { TraditionalTerminalAgentRow as TraditionalTerminalAgentRowModel } from "@/lib/traditional-terminal-agents.js";

export interface TraditionalTerminalAgentRowProps {
  readonly row: TraditionalTerminalAgentRowModel;
  readonly active: boolean;
  readonly onSelectAgent: (sessionId: string) => void;
  readonly touchOptimized?: boolean;
}
export function TraditionalTerminalAgentRow(
  props: TraditionalTerminalAgentRowProps,
): JSX.Element;

// Add to existing navigator props; keep its existing props/exports.
// Optional for additive authoring before integration; phase 4 passes all three.
interface AgentNavigatorProps {
  readonly agentRows?: readonly TraditionalTerminalAgentRowModel[]; // default []
  readonly activeSessionId?: string | null;
  readonly onSelectAgent?: (sessionId: string) => void;
  readonly agentSettingsHref?: string; // no URL policy inside renderer
}
```

- Projects first, all existing tabs/counts/Git summary/New terminal behavior intact. Agents visible second, flat cross-open-project list. Each section independently scrollable in bounded flex layout; no hard-coded status-dependent heights/order.
- Projects keep vertical `tablist` and current roving Arrow/Home/End selection. Agents use a distinct labeled `ul`/`li` of ordinary `button`s, not tabs or project panel controllers. Tab/Shift+Tab traverse agent buttons; Enter/Space select. `aria-current="true"` only on exact active session. No live region that announces every heartbeat.
- Row selection reports exact sessionId only; renderer does not open terminal, select profile, acknowledge notifications or mutate state. Disable row action if callback absent during isolated use. One button per row; do not nest links/buttons. Section Agent Settings link uses supplied href; row-owned link not introduced in this scope.
- Show harness/title/project/profile, primary status, available reason, source/limited coverage in accessible text/title, and gated outcome hint. Truncate visual context without losing accessible text. Every compact interactive target >=44px; reuse existing theme tokens/Radix components. Preserve keyboard focus/order across status updates.
- Empty state: `No observed agents in open terminals. OMP, Codex and Claude appear after supported integrations report status.` Include Agent Settings action; not installed inventory or proof no agent exists elsewhere. No filters/collapse/rollups/audio/summary text/manual tagging.

## Phase 3 navigation module and page boundary

Proposed `packages/ui/src/lib/agent-store-navigation.ts`:

```ts
export type AgentStoreTab = "store" | "memory" | "settings" | "import";
export type AgentStoreProfileRequest =
  | { readonly kind: "default" }
  | { readonly kind: "choose" }
  | { readonly kind: "explicit"; readonly profileId: string }
  | { readonly kind: "invalid" };
export interface AgentStoreLocation {
  readonly tab: AgentStoreTab;
  readonly profile: AgentStoreProfileRequest;
}
export function buildAgentSettingsHref(profileId: string | null): string;
export function parseAgentStoreLocation(search: string): AgentStoreLocation;
```

- Href for concrete ID: `/agent-store?tab=settings&profileId=${encodeURIComponent(profileId)}`. Encode value only, never entire URL/double encode. Null means `/agent-store?tab=settings`, profile choice required. Only supply concrete ID after checking registered target existence; disconnected registered target stays explicit.
- Parser uses URLSearchParams once. Recognized single `tab` sets initial tab; otherwise ordinary store default. Single nonempty profile value gives explicit request, empty/repeated profile values invalid. `tab=settings` with no profile means choose, **not ambient selection**. Ordinary route with neither target nor settings intent preserves current default selection behavior.
- Page consumes React Router `useSearchParams`/location reactively (including same-page links and Back/Forward). Existing tests wrap MemoryRouter. Explicit known target selects it locally; explicit unknown/removed target renders unavailable/invalid message with profile chooser, never silently first profile. Keep requested ID while disconnected; do not auto-connect/install/enable. Removed selected target also fails closed until user explicitly picks another profile.
- Use `useConnectionSnapshot(selectedId ?? "")` reactively, not profileId-only `getConnectionSnapshot` memo or synthetic generation 0. Profile subscription remains `useSyncExternalStore(subscribeToProfileChanges, getProfiles, stable-empty-snapshot)`.
- Page-local query-bearing child mounts **only** with registered target + `snapshot.status === "connected"`; pass concrete `snapshot.owner`. Key child by qualified connectionKey(owner), so item selection/dialog state/async child state retires on owner change. Local navigation/tab/profile chrome can remain visible when invalid/disconnected. `owner=undefined` is NOT a disabling mechanism: existing queries then choose ambient APIs. Do not edit query signatures to solve this.
- Keep existing inventory/memory/import/settings feature behavior; child receives `{ owner: ConnectionRef; profileId: string; activeTab: AgentStoreTab }`. Pass owner through every existing query/settings/memory/ship/import operation. Existing API guards recheck owner before work/publication; generation change remounts owner-bound children. Profile selection closes old dialogs/items without mutating global active profile or preferences.
- Route denial tests assert **no query-owning child/API work** on invalid/disconnected/removed targets, not merely empty visual results. Encoding tests include reserved characters and one decode round-trip.

## Phase 4 integration behavior

- Display subscribes once to status map using `useAgentStatusStore(state => state.profiles)`, reactively to registered profile metadata, and to connection registry using the existing aggregate hook pattern: stable JSON tuple signature of `[profileId, status, generation]` through `useSyncExternalStore(subscribeConnections, getSignature, () => "")`; never `getAllConnectionSnapshots()` directly as an unstable external-store snapshot. Capture each distinct registered profile snapshot into one map per computation.
- Memoize pure builder over typed DisplayTabEntry groups, status profiles, connection signature, profile labels. Capture `Date.now()` inside builder computation. No per-row subscriptions/polling, terminal content reads, or duplicate status state.
- Section settings target is selectedGroup's explicitly validated registered profile. Do not use ambient active profile or another connected profile; ambiguous/projectless owner -> null chooser href. Removed target -> chooser, not another profile; explicit URL to removed target remains denial on Agent Store. Optional future row link would have to use row-owned profile, but no row link is planned.
- Freeze display-local handler `handleSelectAgent(sessionId: string): void`: its render closure captures the offered row/key; compare that incarnation key against a ref holding latest committed roster membership and latest tab-selection handler. Missing/changed key or nonlive tab fails closed, including callbacks retained from a removed/restarted row. Then call existing `handleSelectTab(sessionId)`/selection hook and close compact sheet. Never `handleSelectGroup` (would select remembered tab), never new terminal mount. Preserve split target via existing MultiTerminalDisplay selection effect, buffers/PTY/layout keys/pinned membership and New terminal target behavior.
- Integrator alone supplies agentRows, activeSessionId, onSelectAgent and agentSettingsHref to both navigator instances. Update compact opener/title/description to convey both sections without changing project panel tab semantics.
- Existing opener sits outside Dialog Trigger; do not assume automatic Radix restoration. Add opener ref and `DialogContent.onCloseAutoFocus` preventing default and restoring that connected opener (or equivalent existing DialogTrigger linkage within this same file). Cover Escape, project arrow selection, agent activation and Tab/Shift+Tab focus trap/dismissal. Do not replace sheet or introduce another dialog/surface.
- Apply >=44px minimums locally to compact opener/New terminal controls, navigator add/settings/row controls and DialogContent's direct-child close button (scoped `[&>button]:min-h-11 [&>button]:min-w-11` utilities). Keep shared Dialog wrapper unchanged; reserve header space so the enlarged close control does not obscure heading/actions.

## Qualification and ownership

[Plan ownership matrix](plan.md#exclusive-file-ownership) is authoritative: 26 authorized implementation paths, one owner each. Files read here but absent there are intentionally unchanged. Phases 1–3 may author against these signatures concurrently; no mid-flight builds/tests/formatters. Phase 4 owns integrated targeted suites and actual-app smoke, publishes full-viewport wide/compact evidence and human review. Mock/browser component fixtures do not certify real supported harness integration.

Execution reconciliation: the command requires batch A validation/review/approval/completion before dependent phase 4 dispatch. Checks therefore run after all batch A writers settle, not mid-flight. The ownership matrix now includes one parent-owned proposed deletion of the incidental filename spelling test; frozen runtime interfaces and row filenames remain unchanged. Actual-app/live-harness qualification remains exclusively phase 4.

Parent finalization for phase 3 also owns `docs/architecture/agent-store-ports-and-browser.md`: its selected-profile-removal fallback statement conflicts with the new denial contract and must be reconciled after approval. All other phase 4 documentation ownership stays unchanged.

## Risks and unresolved questions

- Highest risks: qualified identity colliding across profiles; retained rows under new generation; explicit route fallback; compact focus restoration; native hook coverage mistaken for task completion.
- Actual-app real-harness transitions require available supported OMP/Codex/Claude launchers and credentials for chosen harmless prompts; do not fake ingress or loosen native peer checks. Missing credentials/runtime is a qualification blocker, not permission to omit required gates.
- User confirmed 2026-10-08: fixed Projects-first sections, flat global roster, secondary `Done (turn ended)` wording. [Validation interview](reports/06-validation-interview.md). Identity/Unknown/no-success/privacy constraints remain mandatory; no contract or phase design changes required.
