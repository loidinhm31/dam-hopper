# Session changes panel

Status: **Approved design; not implemented.** User explicitly selected “Approve this design” after reviewing behavior, scope, retention, risks, and acceptance criteria. Separately selected **Defer planning**; central planning router not invoked; no implementation plan created.

## Problem and final artifact

OMP runs inside DamHopper's server-managed PTY and browser xterm surface. User wants to review code changes associated with that conversation without switching to VS Code.

Approved artifact: read-only **Session changes** panel associated with an OMP terminal session in the shared web/Tauri UI. Changed-file list, additions/deletions, and Monaco inline/side-by-side diffs. Compare actual on-disk session-start contents against current on-disk contents.

User decisions:
- Review **changes since session start**, not attribution to one agent or per-prompt history.
- Review in **DamHopper's changes panel**, retaining OMP's terminal chat.

## Scope and constraints

In scope:
- One selected Git root within the server-validated terminal project/worktree.
- Tracked files and non-ignored untracked files, with bounded capture/storage/comparison.
- Existing dirty contents form the baseline; subsequent net changes appear.
- Baseline acknowledged before the first model turn; explicit capture failure state.
- Browser reload/reconnect retains the baseline while the server remains alive.
- Refresh on demand and after an OMP turn settles; comparison timestamp and coverage state visible.
- Session/profile/root isolation and private server-side snapshot storage.

Out of scope:
- Agent-only attribution, dedicated worktree provisioning, per-prompt history, chat UI reconstruction.
- Keep/undo, edit/save from the session viewer, staging, automatic commits.
- Historical archive across server restarts; Android-native UI; multiple Git roots per session.
- Retroactive reconstruction of sessions that started without a baseline.
- Tracking ignored files, outside-root targets, or transient edits fully reversed before comparison.

Retention: current server lifetime, released on terminal removal. Explicitly unavailable after restart/expiry/removal; do not silently establish a replacement baseline labelled as the original. Existing sessions may explicitly start tracking **from now**.

No delivery timeline supplied. Existing terminal operation must remain usable when review tracking is unavailable. Do not claim complete tracking after capture failure.

## Options and rationale

| Approach | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Existing Git changes views | Available immediately; no new integration | HEAD/index-based; includes pre-existing edits; commits alter visibility | Workaround only |
| DamHopper session baseline | Correct dirty-start semantics; keeps current worktree and terminal workflow | Snapshot resource cost; includes concurrent writers | Approved |
| Dedicated worktree per session | Isolates cooperating sessions' work | Adds launch/dependency/merge workflow | Rejected for selected scope |

Do not derive changes by parsing ANSI terminal output or scraping chat/tool transcripts. xterm remains a renderer. OMP contributes lifecycle/session identity; DamHopper owns bounded filesystem capture and comparison.

## Behavior and interfaces

1. OMP extension identifies the root session and requests tracking for the canonical project/worktree/root. Server validates scope; untrusted reported directories never confer filesystem authority.
2. Capture starting on-disk contents, including dirty tracked files and eligible untracked files. A HEAD hash alone is insufficient. Store snapshot material outside the worktree with private permissions.
3. Acknowledge baseline readiness before the first model turn proceeds. The existing asynchronous status notification alone is not this readiness barrier. Failure must leave review explicitly unavailable/incomplete rather than silently lose early edits.
4. Terminal **Changes** action opens file list and read-only Monaco comparison. Keep HEAD-based local Git changes distinct from session review.
5. Compare against the original baseline even after staging or committing. Content changes later reversed disappear from the net diff.
6. Refresh after settled turns or explicit user request; show comparison time. Baseline/current content changes require revision-qualified responses so an obsolete response cannot replace a newer view.
7. New OMP session identity receives a distinct baseline; reconnect does not reset a known baseline. Bind state to terminal incarnation, OMP session identity, and canonical root; retain browser profile/generation ownership.
8. Shared worktree warning: edits by another terminal/editor also appear. This is a time-baseline comparison, not proof of authorship or task success. Current-side reads can also include later external edits; no frozen historical session-end archive is promised.

Proposed interface responsibilities, not finalized endpoint names:
- Private authenticated tracking registration/readiness handshake separate from status-only frames.
- Authenticated server queries for baseline availability/coverage, changed files, and selected file content.
- Browser state distinguishes initializing, ready, incomplete, unavailable, and expired/missing; incomplete is never rendered as zero changes.

## Resource, data, and security constraints

- Explicit file-count, byte, capture-time and comparison bounds; exact defaults selected during implementation planning with repository-size evidence.
- Binary/oversized/excluded paths have explicit indicators rather than fabricated text diffs. Do not imply complete content coverage.
- Never follow symlinks outside the selected root. Reuse canonical target/sandbox checks and profile/generation ownership conventions.
- No stash, reset, branch update, user-index mutation, or working-file write during tracking/review.
- Snapshot contents may contain sensitive source. Keep private permissions; no source/prompt/transcript content in status frames or diagnostics.
- Filesystem scanning is not an atomic repository snapshot. Detect observed instability and report incomplete capture; do not promise isolation from arbitrary external writers.

## Likely touchpoints

- `server/src/agent_status/assets/omp-agent-status.ts`: lifecycle/session identity, tracking handshake, settled-turn refresh signal. Managed adapter packaging/installation in `server/src/agent_status/integration.rs`.
- `server/src/api/terminal.rs` and PTY lifecycle: canonical project/worktree target, incarnation fencing, cleanup.
- `server/src/git/` and Git API layer: snapshot capture/comparison and bounded, authenticated review queries. Existing `diff.rs` is HEAD/index-oriented and cannot simply be relabelled.
- `packages/ui/src/components/organisms/TerminalPanel.tsx`: likely entry point; exact placement requires implementation-planning inspection.
- `packages/ui/src/components/organisms/GitLocalChanges.tsx`, `DiffViewer.tsx`, and query/transport ownership utilities: reuse file-list/Monaco presentation without enabling existing discard/save actions for session diffs.
- Existing server Git/API test patterns, UI browser/application journeys, agent integration qualification; architecture/API/user docs and changelog when implemented.

These are design touchpoints, not a completed caller/reference audit or implementation plan.

## Feasibility and stakeholders

Existing OMP session hooks and DamHopper's canonical terminal targets establish a plausible integration seam. Existing Monaco rendering supports the review surface. New substantive work: bounded snapshot correctness, readiness ordering, lifetime management, and session-scoped API/UI state.

User: fewer context switches, correct exclusion of pre-existing dirty edits; accepts shared-worktree ambiguity.
Maintainers: reuse current renderer and ownership patterns; avoid second chat stack or provider transcript parser.
Operators: bounded private storage and capture work; no cloud service or new daemon required.

No product code or implementation prototype changed. Runtime end-to-end feasibility remains an implementation acceptance gate; source evidence validates the architecture, not delivered behavior.

## Acceptance and validation

1. Start with dirty tracked content and an existing untracked file. Unchanged starting content is absent from session diff; subsequent edits appear against those starting bytes.
2. Subsequent additions/deletions/modifications render correct original/current contents. Binary/large/unreadable/excluded cases report coverage explicitly.
3. Stage and commit during the session; net session diff remains visible until content returns to baseline.
4. Switch OMP sessions, terminal incarnations, Git roots, and server profiles; never reuse an unrelated baseline or accept stale responses.
5. Browser reload/reconnect retains the original baseline. Server restart/removal/missing capture is explicit, never silently rebased.
6. Review opening/refresh leaves working files, user index, and branch unchanged.
7. First-turn edits occur only after acknowledged baseline readiness, or review reports unavailable/incomplete. Capture instability and bounds are observable.
8. Live browser journey: OMP in a managed PTY changes files; open panel, inspect actual Monaco diff, reconnect, and refresh after a turn. Existing UI visual-review governance applies; component assertions alone do not certify integration.

Validation performed for this brainstorm: inspected current repository/source/docs; ran `omp --help` and `omp git --help` successfully. Observed installed OMP version 18.13.3 and built-in Git UI options. No tests or live session-review scenario run because no implementation exists.

## Evidence and gaps

- `README.md`: web/Tauri shared UI, PTY and Git architecture.
- `docs/architecture/agent-status.md`: session identity, terminal incarnation, protected loopback producer, semantic-only status channel; documented full OMP qualification is 18.4.1, not installed 18.13.3.
- `server/src/agent_status/assets/omp-agent-status.ts:738-775`: session start/switch and agent lifecycle callbacks; current connection does not await filesystem capture.
- `server/src/api/terminal.rs:85-115,175-237`: canonical project/worktree resolution and scoped cwd validation.
- `server/src/api/git_diff.rs:23-42,92-117`: project/worktree/root-scoped diff endpoints.
- `server/src/git/diff.rs:308-325,537-613`: index/worktree list and HEAD-to-workdir file comparison.
- `packages/ui/src/components/organisms/DiffViewer.tsx:48-164`: Monaco viewer props, Git queries, and mutation/read-only behavior requiring separation for session review.
- `packages/ui/src/components/organisms/GitLocalChanges.tsx:21-38`: existing Git changed-file list.
- Installed OMP source at `/home/loidinh/WS/oh-my-pi`: `docs/extensions.md` describes session hooks/first-request loading; bundled `review/target.ts:4-32,70-81` targets commits, base branches, and uncommitted changes rather than session baselines.
- Installed OMP `docs/tools/checkpoint.md:78-87`: checkpoint is conversation metadata, not a filesystem snapshot. Do not use it as code-baseline storage despite its advertised tool summary.
- Documentation lookup via docs-seeker found no Context7 OMP documentation; local source/docs used instead.
- Not inspected: exact terminal button placement, full reference/caller graph, complete OMP startup event/error ordering, finalized storage schema/quotas, live browser integration. Resolve in separately authorized planning/implementation; no claim these gates already pass.

## Questions and next gate

No unresolved product decision blocks this approved scope. Implementation details above remain planning work. User explicitly deferred planning; router not invoked; no plan created. Native journal workflow completed: [decision-summary journal](../../docs/journals/journal-261030-0043-session-changes-panel.md), writer terminal result received and file verified. Next step: retain approved design; create an implementation plan only on a later explicit request.
