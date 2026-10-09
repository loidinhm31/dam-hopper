# Agent Store, Port Forwarding, and Browser Debug Architecture

**Authority:** Multi-Profile Subsystems (`packages/ui/src/`, `server/src/agent_store/`, `server/src/port_forward/`, `server/src/tunnel/`, `server/src/browser_debug/`)  
**Status:** Maintained Architecture Specification  

This specification defines the frontend ownership boundary and server artifact/PTY admission boundary across the multi-profile workbench for the Agent Store, port detection, quick tunnels, and framed Browser Debug previews.

Server catalogs, projects, tunnels, PTYs, and artifact files remain authoritative on their owning server. A browser focus change never changes an operation's owner.

## 1. Agent Store Ownership

`AgentStorePage` resolves reactive tab/profile URL intent and offers an explicit profile selector. `/agent-store?tab=settings&profileId=<encoded-id>` retains that exact registered target; settings without a target requires deliberate profile choice, with tab changes disabled until selection. Ordinary untargeted entry may initially select a valid active/first profile. Invalid, removed, and disconnected targets never fall back to another profile or mount query-bearing features.

Only a registered target with a current connected `ConnectionRef { profileId, generation }` mounts the page-local feature subtree. Every Agent Store, project, memory, import, and health query receives that concrete owner. The subtree is keyed by `connectionKey(owner)` so a profile or generation replacement retires selected items, dialogs, and drafts. Local profile navigation never mutates the global active profile or automatically connects/installs integrations.

Agent item catalogs, item content, scans, distribution matrices, project lists, health results, and mutations are server-local. Owner-qualified React Query keys keep equal item/project names on two servers separate. Ship, unship, absorb, bulk ship, and health refreshes run through the captured owner and invalidate only that owner's cache. Cross-server distribution is not a supported operation.

### Memory Drafts

`MemoryEditor` identifies a draft with:

```text
{ profileId, projectName, agent }
```

The draft identity is kept in `draftTargetRef`. Fresh server data replaces the editor only when it belongs to the current identity and the draft is clean. Incoming data for another profile, project, or agent cannot overwrite a dirty editor. Switching project or agent explicitly confirms that unsaved content or edited template preview will be discarded. Template **Preview** only populates a local preview; **Save** is the separate owner-bound mutation.

### Import Scans

`ImportDialog` captures its owner when opened. A scan stores the server-owned `tmpDir`/`dirPath` together with a monotonically increasing `scanRevision`. Late scan results are ignored, and confirm sends the path only through the owner that produced it. Repository URLs and local directory paths are resolved by that server, not by the browser machine. The page closes open import/ship dialogs and clears selection when the profile selector changes, so server A's temporary path or draft cannot be confirmed against server B.

## 2. Port and Tunnel Aggregation

The aggregate `usePorts({ aggregate: true })` view queries every listed profile independently. A single-profile view accepts an explicit `owner` or `profileId`; it does not infer a mutation target from whichever profile is in focus. Query keys include the owner connection generation.

The semantic detected-port identity is:

```text
(profileId, port, terminalId, incarnation)
```

`PortEntry` carries `profileId`, `port`, `sessionId`, and PTY `incarnation`. Equal numeric ports, raw terminal IDs, and project names from different servers remain separate rows. Tunnel-only rows have no PTY identity and use `state: "unknown"` / origin untracked, never an invented listening state. Tunnel identity is `(profileId, tunnelId)`; joins stay within one owner.

Port and tunnel push events require the emitting `profileId` and connection generation; stale/ownerless callbacks cannot rebind to a current or ambient transport. Incarnation acceptance, confirmation, and retirement use profile-qualified terminal references. `port:lost` removes only the exact terminal/port/incarnation row. Connection subscriptions re-list current owners; disconnected profiles are not queried or rendered as live.

Create/Stop and terminal Kill capture the rendered owner, resolve its transport only at invocation, and guard post-await cache changes against reconnect. Existing Cloudflared installation behavior is unchanged.

Explicit tunnels have no PTY ownership fields. Origin-port loss/reopen, PTY exit/Kill/replacement, and another terminal reporting that port preserve the Cloudflared connector, URL, ID, and `startedAt`. Stop, connector exit/failure, and DamHopper shutdown still clean up. Tunnels are process-memory state, not restored after server restart; no automatic connector restart.

At three hours from creation, the server sets required `reminderDue: boolean` and broadcasts `tunnel:reminder` once. The global shared reminder catches up from REST, includes profile/port/URL, and offers Dismiss or Stop without expiring the tunnel. Dismissal is per profile/tunnel/browser session, backed by sessionStorage with memory fallback. Stop uses the captured generation; late REST snapshots are cancelled before reminder/Stop reconciliation. Cognito hides the reminder; stacked reminders scroll within a bounded area while routes retain the remaining viewport height.

Public exposure persists until Stop: an offline origin normally returns 502, and a later service binding the same port becomes publicly reachable. Quick Tunnel URLs last only for the connector's lifetime.

## 3. Browser Target Trust

A `BrowserDebugTarget` is a capability snapshot, not an address string:

```text
{ owner: ConnectionRef, url, origin, source, tunnelId?, revision }
```

`resolveBrowserDebugTarget` accepts HTTP loopback URLs or an exact origin of a currently ready tunnel belonging to the captured owner. Credentials, the parent origin, unready/stale tunnel URLs, and arbitrary external URLs are rejected. Address history is partitioned by `profileId` and stores display addresses only. Redirects and bridge messages pass exact origin/source/nonce/request checks.

An explicit navigation increments the target revision and clears selection, picker state, bridge capabilities, console entries, pending capture, and bridge status. Tunnel loss or revalidation failure invalidates only a target owned by that profile. Selecting a project or changing terminal focus alone does not replace the Browser target or its owner.

Native desktop adapters consume this exact `BrowserDebugTarget` as a lease input without inferring an owner from current SSH scopes or project focus. See [Native SSH Forwarding Architecture](./native-ssh-forwarding.md).

## 4. Same-Profile Terminal Handoff

Workspace capture/handoff uses one owner and one physical Browser surface:

1. Require a mounted, registered, live terminal candidate and reject a different `profileId` before creating an artifact.
2. Snapshot the Browser `ConnectionRef`, target `revision`, and `TerminalInstanceRef { profileId, id, incarnation }`.
3. Call the owner-bound `browser-debug:create` with `terminalId`, `terminalIncarnation`, and the validated selection. The response repeats the server-bound terminal incarnation.
4. After the create await, re-read the Browser target and terminal candidate. A generation, owner, revision, or incarnation change deletes the artifact and aborts.
5. Optionally upload the bounded PNG through the same owner. Re-check all three fences after the upload await; stale artifacts are deleted.
6. Build the terminal reference from server-generated artifact paths only, strip terminal controls, and stop the capture stream.
7. Before insertion, revalidate target readiness and artifact terminal identity. `browser-debug:handoff` claims the artifact once, then performs the server atomic incarnation-checked PTY write.
8. A successful response must acknowledge `inserted: true`. Any failure is surfaced; there is no raw-ID or active-profile fallback.

### Server Artifact and PTY Admission

Create rejects a missing terminal or a supplied incarnation that is not the currently live incarnation (`409`, structured code `TERMINAL_INCARNATION_MISMATCH`) before storing the artifact. Artifact metadata persists the authoritative `terminalId` and `terminalIncarnation`; JSON/PNG files stay in a private expiring store. An artifact can be claimed once, and a failed write releases the claim for a retry.

`PtySessionManager::write_if_incarnation` holds the manager lock across liveness lookup, incarnation comparison, input-revision admission, and the actual write. It retains handoff/closing/disposing guards and rolls back the input revision/timestamp when the PTY write fails. If a public terminal ID was replaced between capture and handoff, the old artifact receives a conflict and neither replacement PTY bytes nor the global input revision changes. This atomic admission closes the replacement-PTY race that separate `is_alive`/`write` calls would leave open.

## 5. Owner-Local Feature Availability

`useFeatureAvailability(flag, { owner })` derives state from the selected profile's connection snapshot and subscribes to connection changes:

| Connection State | Availability | Meaning |
| --- | --- | --- |
| no profile | `unknown` | No owner was selected |
| no snapshot | `loading` | Connection state is not loaded |
| `connecting` | `loading` | The owner is reconnecting |
| `connected` | `available` | Owner connection supports dispatch |
| `offline`, `disconnected`, `login-required`, `unsupported` | `unavailable` | Do not dispatch for this owner |

The hook returns a reason for non-available states and `useFeatureFlag` is the boolean projection. Availability is never inferred from another profile, from a version string, or from an ambient active-profile cache. Endpoint-level unsupported responses remain owner-local and do not disable a healthy peer.

## 6. Source Map and Maintenance Rules

| Contract | Source |
| --- | --- |
| Agent Store queries/client owner binding | `packages/ui/src/components/pages/AgentStorePage.tsx`, `packages/ui/src/api/queries.ts`, `packages/ui/src/api/client.ts` |
| Draft and import identity | `packages/ui/src/components/organisms/MemoryEditor.tsx`, `ImportDialog.tsx` |
| Port/tunnel aggregation | `packages/ui/src/hooks/use-ports.ts`, `use-tunnels.ts` |
| Browser target trust | `packages/ui/src/hooks/use-browser-debug.ts`, `packages/ui/src/lib/browser-debug-origin.ts` |
| Capture/handoff fences | `packages/ui/src/components/pages/WorkspacePage.tsx`, `packages/ui/src/lib/browser-terminal-handoff.ts` |
| Artifact/PTY admission | `server/src/api/browser_debug.rs`, `server/src/browser_debug/store.rs`, `server/src/pty/manager.rs` |
| Availability state | `packages/ui/src/hooks/use-feature-flag.ts` |

Preserve owner and generation capture across every await. Never add a raw terminal-ID fallback, cross-profile catalog merge, ownerless tunnel mutation, or browser URL routing decision. Keep `terminalIncarnation` mandatory for new artifact creates and preserve the structured conflict/error behavior.
