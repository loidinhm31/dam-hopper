# Phase 05 — Agents, Ports, and Browser

**Status:** DONE — 2026-09-17  
**Scope:** Unified multi-profile Agent Store, port/tunnel aggregation, Browser
Debug target trust, terminal handoff, and owner-local availability.  
**Evidence:** 44/44 targeted tests, the UI TypeScript build, and `cargo check`
passed. See the [QA report](../plans/reports/qa-260917-1517-phase-05-agents-ports-browser-validation.md)
and [Cycle 2 review](../plans/reports/code-review-260917-1522-phase-05-cycle2.md).
Phase 09 live S06/S08/S11 and Browser/Playwright evidence passed within the
S01–S12 web gate. Windows-native S13 remains blocked; this guide does not make
a native runtime claim.

This is an implementation guide for the frontend ownership boundary and the
server artifact/PTY admission boundary. Server catalogs, projects, tunnels,
PTYs, and artifact files remain authoritative on their owning server. A browser
focus change never changes an operation's owner.

## 1. Agent Store ownership

`AgentStorePage` has an explicit profile selector. It chooses an effective
`profileId`, captures the current `ConnectionRef { profileId, generation }`, and
passes that owner to every Agent Store, project, memory, import, and health
query. If the selected profile is removed, the selector chooses another
listed profile; it does not reuse a global active-profile request.

Agent item catalogs, item content, scans, distribution matrices, project lists,
health results, and mutations are server-local. Owner-qualified React Query
keys keep equal item/project names on two servers separate. Ship, unship,
absorb, bulk ship, and health refreshes run through the captured owner and
invalidate only that owner's cache. Cross-server distribution is not a
supported operation.

### Memory drafts

`MemoryEditor` identifies a draft with:

```text
{ profileId, projectName, agent }
```

The draft identity is kept in `draftTargetRef`. Fresh server data replaces the
editor only when it belongs to the current identity and the draft is clean.
Incoming data for another profile, project, or agent cannot overwrite a dirty
editor. Switching project or agent explicitly confirms that unsaved content or
edited template preview will be discarded. Template **Preview** only populates
a local preview; **Save** is the separate owner-bound mutation.

### Import scans

`ImportDialog` captures its owner when opened. A scan stores the server-owned
`tmpDir`/`dirPath` together with a monotonically increasing `scanRevision`.
Late scan results are ignored, and confirm sends the path only through the
owner that produced it. Repository URLs and local directory paths are
resolved by that server, not by the browser machine. The page closes open
import/ship dialogs and clears selection when the profile selector changes, so
A's temporary path or draft cannot be confirmed against B.

## 2. Port and tunnel aggregation

The aggregate `usePorts({ aggregate: true })` view queries every listed profile
independently. A single-profile view accepts an explicit `owner` or
`profileId`; it does not infer a mutation target from whichever profile is in
focus. Query keys include the owner connection generation.

The semantic detected-port identity is:

```text
(profileId, port, terminalId, incarnation)
```

`PortEntry` carries `profileId`, `port`, `sessionId`, and PTY `incarnation`.
Therefore equal numeric ports, equal raw terminal IDs, and equal project names
from different servers remain separate rows. Tunnel-only rows have no PTY
identity and are still kept under their profile. Tunnel identity is
`(profileId, tunnelId)`; a tunnel is joined to a detected port only within the
same owner.

Port push events use the event's `profileId` to patch that profile's query
cache. Incarnation admission rejects delayed observations and `port:lost`
removes only the matching `(sessionId, port, incarnation)` row. Reconnects
invalidate the affected owner's port/tunnel data and re-list it; one profile's
missed event or error cannot clear another profile's rows.

Create/stop tunnel, kill terminal-port session, and cloudflared installation
capture the target profile before invoking transport. Manual ownerless tunnel
operations require an explicit profile. Server-side port detection and tunnel
platform constraints remain unchanged.

## 3. Browser target trust

A `BrowserDebugTarget` is a capability snapshot, not an address string:

```text
{ owner: ConnectionRef, url, origin, source, tunnelId?, revision }
```

`resolveBrowserDebugTarget` accepts HTTP loopback URLs or an exact origin of a
currently ready tunnel belonging to the captured owner. Credentials, the
parent origin, unready/stale tunnel URLs, and arbitrary external URLs are
rejected. Address history is partitioned by `profileId` and stores display
addresses only. Redirects and bridge messages still pass the existing exact
origin/source/nonce/request checks.

An explicit navigation increments the target revision and clears selection,
picker state, bridge capabilities, console entries, pending capture, and
bridge status. Tunnel loss or revalidation failure invalidates only a target
owned by that profile. Selecting a project or changing terminal focus alone
does not replace the Browser target or its owner.

Phase 08's native Browser adapter consumes this exact `BrowserDebugTarget` as a
lease input. It does not infer an owner from the current SSH scope, project
focus, or active-profile compatibility state. Replacing the target destroys
only the child WebView bound to the captured owner; SSH scope lifecycle remains
independent. See [Phase 08 Native Scope Concurrency and Platform Integration](./phase-08-native-scope-concurrency.md).

## 4. Same-profile terminal handoff

Workspace capture/handoff uses one owner and one physical Browser surface:

1. Require a mounted, registered, live terminal candidate and reject a
   different `profileId` before creating an artifact.
2. Snapshot the Browser `ConnectionRef`, target `revision`, and
   `TerminalInstanceRef { profileId, id, incarnation }`.
3. Call the owner-bound `browser-debug:create` with `terminalId`,
   `terminalIncarnation`, and the validated selection. The response repeats the
   server-bound terminal incarnation.
4. After the create await, re-read the Browser target and terminal candidate.
   A generation, owner, revision, or incarnation change deletes the artifact
   and aborts.
5. Optionally upload the bounded PNG through the same owner. Re-check all three
   fences after the upload await; stale artifacts are deleted.
6. Build the terminal reference from server-generated artifact paths only,
   strip terminal controls, and stop the capture stream.
7. Before insertion, revalidate target readiness and artifact terminal identity.
   `browser-debug:handoff` claims the artifact once, then performs the server
   atomic incarnation-checked PTY write.
8. A successful response must acknowledge `inserted: true`. Any failure is
   surfaced; there is no raw-ID or active-profile fallback.

### Server artifact and PTY admission

Create rejects a missing terminal or a supplied incarnation that is not the
currently live incarnation (`409`, structured code
`TERMINAL_INCARNATION_MISMATCH`) before storing the artifact. Artifact metadata
persists the authoritative `terminalId` and `terminalIncarnation`; JSON/PNG
files stay in a private expiring store. An artifact can be claimed once, and a
failed write releases the claim for a retry.

`PtySessionManager::write_if_incarnation` holds the same manager lock across
liveness lookup, incarnation comparison, input-revision admission, and the
actual write. It retains handoff/closing/disposing guards and rolls back the
input revision/timestamp when the PTY write fails. If a public terminal ID was
replaced between capture and handoff, the old artifact receives a conflict and
neither replacement PTY bytes nor the global input revision changes. This
atomic admission closes the replacement-PTY race that separate
`is_alive`/`write` calls would leave open.

## 5. Owner-local feature availability

`useFeatureAvailability(flag, { owner })` derives state from the selected
profile's connection snapshot and subscribes to connection changes:

| Connection state | Availability | Meaning |
| --- | --- | --- |
| no profile | `unknown` | No owner was selected |
| no snapshot | `loading` | Connection state is not loaded |
| `connecting` | `loading` | The owner is reconnecting |
| `connected` | `available` | Owner connection supports dispatch |
| `offline`, `disconnected`, `login-required`, `unsupported` | `unavailable` | Do not dispatch for this owner |

The hook returns a reason for non-available states and `useFeatureFlag` is only
the boolean projection. Availability is never inferred from another profile,
from a version string, or from an ambient active-profile cache. Endpoint-level
unsupported responses remain owner-local and must not disable a healthy peer.

## 6. Source map and maintenance rules

| Contract | Source |
| --- | --- |
| Agent Store queries/client owner binding | `packages/ui/src/components/pages/AgentStorePage.tsx`, `packages/ui/src/api/queries.ts`, `packages/ui/src/api/client.ts` |
| Draft and import identity | `packages/ui/src/components/organisms/MemoryEditor.tsx`, `ImportDialog.tsx` |
| Port/tunnel aggregation | `packages/ui/src/hooks/use-ports.ts`, `use-tunnels.ts` |
| Browser target trust | `packages/ui/src/hooks/use-browser-debug.ts`, `packages/ui/src/lib/browser-debug-origin.ts` |
| Capture/handoff fences | `packages/ui/src/components/pages/WorkspacePage.tsx`, `packages/ui/src/lib/browser-terminal-handoff.ts` |
| Artifact/PTY admission | `server/src/api/browser_debug.rs`, `server/src/browser_debug/store.rs`, `server/src/pty/manager.rs` |
| Availability state | `packages/ui/src/hooks/use-feature-flag.ts` |

Preserve owner and generation capture across every await. Never add a raw
terminal-ID fallback, cross-profile catalog merge, ownerless tunnel mutation,
or browser URL routing decision. Keep `terminalIncarnation` mandatory for new
artifact creates and preserve the structured conflict/error behavior.
