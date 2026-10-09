# Traditional terminal Agents sidebar — codebase analysis

Date: 2026-10-08. Planning only; no runtime qualification claimed.

## Evidence and workflow
- Required docs read: `docs/codebase-summary.md`, `docs/code-standards.md`, `docs/system-architecture.md`, `docs/project-overview-pdr.md`.
- Summary filesystem mtime: 2026-10-07 11:48:46 +0700, within three days. Inventory header remains 2026-10-05; source inspected for this feature. Conditional `/cmd-scout` skipped; no scout report.
- Optional `docs/development-rules.md` and `docs/design-guidelines.md` absent. Use code standards and auto-loaded repository rules.
- LSP status: no configured language servers; direct source reads used.
- Planning, research, docs-seeker and mermaidjs-v11 skill instructions read. Context7 lookup for Herdr returned documentation-not-found; use primary repository research, not repeated discovery guesses.
- Plan directory: `plans/261008-0233-traditional-terminal-agents-sidebar/`. Active-plan script exists globally, not locally; global invocation exited zero but warned EVCRATE_SESSION_ID missing. Every agent receives directory explicitly.
- Observed branch: `feat/cloudflared-persistence-reminder`.

## Actual changed surface
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx:93-231`: actual project-only Traditional left sidebar. Width controlled externally; vertical project tablist with roving Arrow/Home/End selection; project counts, profile badge, optional Git summary, New terminal action.
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:90-149,169-309`: groups, selection and callbacks; renders navigator on desktop and within compact Dialog; uses shared terminal surface and persisted per-project layouts. `handleSelectTab` selects the exact session and remembers project; compact agent selection should also close Dialog.
- `packages/ui/src/hooks/use-traditional-terminal-project-selection.ts`: selected group follows qualified activeSessionId; remembers last session by project. Reuse; do not create another selection store.
- `packages/ui/src/lib/traditional-terminal-projects.ts`: existing project groups retain ALL sessions. Add Agents as alternate index; do not remove AI sessions from their project or change layout storage keys.
- `packages/ui/src/components/pages/WorkspacePage.tsx:1824-1829`: composition entry into Traditional display. Existing callbacks sufficient unless an explicit new prop is required; avoid modifying this large file needlessly.
- `TerminalWorkspaceShell.tsx` wraps workspace/floating tools, NOT the project sidebar. `TerminalRuntimeNavigator*` is Runtime-mode navigation; do not accidentally implement there instead.

## Existing data sources
- `packages/ui/src/stores/agent-status.ts`: Zustand profiles map, owner `{profileId,generation}`, ready/unavailable/platform-unqualified/unsupported states, row map by remote terminal id, incarnation/reporter fences and silent authoritative snapshots. Use readonly inputs/selectors; no second polling/subscription engine.
- `packages/ui/src/api/agent-status-types.ts:10-62`: harnesses `omp|codex|claude`; semantics `unknown|idle|working|blocked`; reason approval/question/error; `lastOutcome` ended/interrupted/error/unknown; `turnId`, reporterEpoch, agentSessionId and observation/expiry metadata.
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx`: existing presentation Running/Idle/Needs attention/Unknown plus availability overrides, human harness names and limited-hook-coverage tooltip. Do not change shared badge wording just to implement a Traditional-specific section.
- `TerminalTabBar.tsx:11-24`: `DisplayTabEntry` has `session?: SessionInfo`, `terminalRef`, qualified `sessionId`, and title context. Current incarnation is in session metadata, NOT MountedSession.
- `MultiTerminalDisplay.tsx:19-28`: MountedSession has profile/ref/project/sessionId but no incarnation. NEVER join bare terminal IDs across servers or infer incarnation from status row itself.
- `packages/ui/src/lib/terminal-incarnation-state.ts`: existing qualified incarnation helper available if necessary; choose session metadata as primary evidence and fail closed when identity cannot be established.
- `server/src/agent_status/reducer.rs`: OMP TurnStarted clears last_outcome; SessionChanged/authority replacement clears outcome; TurnEnded stores outcome and idle for ended; snapshots may silently preserve explicit outcome. Native mappings remain provider-specific. No wire `done` state.

## Agent Store connection
- `packages/ui/src/components/pages/AgentStorePage.tsx:52-95`: local selectedProfileId and activeTab default store; no deep-link query handling. Captured owner passed to queries/settings. Add deliberate `/agent-store?tab=settings&profileId=<encoded-profile>` support; explicit invalid/missing requested profile must NOT silently fall back to first profile.
- `packages/ui/src/components/organisms/AgentSettings.tsx`: installation/path verification and native readiness; existing OMP/Codex/Claude configuration already implemented. No installer rewrite needed.
- `docs/architecture/agent-store-ports-and-browser.md`: catalog artifacts are server-local distribution inventory, not running agents or task identities.

## Recommended design constraints
- Two labeled sections: existing Projects plus Agents listing observed integrated harness sessions across open Traditional groups, one row per exact terminal incarnation, with harness, terminal title, project and profile context.
- Keep stable existing session order; status changes must not steal focus or reshuffle keyboard targets. No launch/task orchestration, generic adapter loader, transcript/VT parsing or new backend/database.
- Working maps current working state; Idle means input-ready. Blocked gives Needs attention with reason; Unknown and unavailable stay explicit. Preserve full hook-limited-coverage explanation.
- Satisfy requested done visibility through a SECONDARY `Done (turn ended)` outcome hint only for matching ready idle rows with explicit `lastOutcome=ended` and no active turn. It is not a semantic state and never verified task success. Hide on new work, blocked/unknown/authority loss, mismatch or unavailable. Other harnesses without explicit ended evidence stay Idle/Unknown, not fake Done. Product review can choose wording; absence of evidence cannot be overridden.
- Agent Settings link captures intended profile, doesn't mutate ambient profile selection, doesn't turn notifications on or install anything automatically.
- Compact navigation reuses the same sections in the existing sheet, min 44px targets and no second terminal mount. Projects retain existing tab semantics; Agents use a separate labeled list of buttons, not fake tabs controlling project panels.

## Verification planning
- Existing behavioral unit suites: `TraditionalTerminalProjectsNavigator.test.tsx`, `AgentStorePage.test.tsx`, agent-status store tests. Delete incidental wording assertions if encountered; do not re-pin.
- Existing real-browser coverage: `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx` and its fixture. Extend for exact cross-project agent selection, compact sheet dismissal, keyboard and pane continuity.
- Existing app E2E pattern under `packages/ui/e2e/`; package scripts: `test`, `test:browser`, `test:e2e`, `test:e2e:typecheck`, `build`.
- Implementation MUST later exercise actual shared web app: existing managed harness transition working -> idle/explicit ended, attention, hook expiry, reconnect, two profiles with colliding ids, disabled notifications, split panes, compact and wide screenshots. Component mocks alone cannot qualify integration.

## Primary-reference verification
- Main independently read [Herdr README](https://github.com/herdrdev/herdr), [Concepts](https://herdr.dev/docs/concepts/) and [Agents](https://herdr.dev/docs/agents/) on 2026-10-08. Documentation selector reports Latest 0.9.3.
- Verified: combined agent navigation, workspace state rollups, per-client Done as unseen finished turn, supported harness detection/integration, native OMP state requiring integration, screen-manifest fallback limits. These are reference features, not requirements to copy.
- Adopt direct terminal navigation and separate agent roster; reject unseen acknowledgment, screen scraping, sounds and task-success inference for this scoped change. Research recommendations about those features remain alternatives, not approved scope.

## Unresolved questions
- User validation: preferred Projects/Agents order and `Done (turn ended)` wording vs `Last turn ended`; safe default retains Projects first and never presents successful task completion.
- Runtime qualification is not performed during planning; harness versions beyond current documented Linux qualifications remain unqualified.
