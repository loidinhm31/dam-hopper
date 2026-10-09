# Planner contract — Traditional terminal Projects + Agents

Date 2026-10-08. Plan directory `plans/261008-0233-traditional-terminal-agents-sidebar/`.
Root `/home/loidinh/WS/dam-hopper`; Linux 7.1.10-200.fc44.x86_64 x64; pnpm monorepo; timezone Asia/Saigon. Branch verified `feat/cloudflared-persistence-reminder`.

## Inputs
- Research: `research/researcher-01-report.md`, `research/researcher-02-report.md`.
- Main source analysis: `reports/01-codebase-analysis.md` (authoritative over speculative report suggestions).
- Required current docs: `docs/codebase-summary.md`, `docs/code-standards.md`, `docs/system-architecture.md`, `docs/project-overview-pdr.md`.
- Architecture-first gate completed in `docs/system-architecture.md` proposed section, clearly pending review/not implemented.
- No scout: summary mtime 2026-10-07 is within three days. Do NOT run scout or invent scout paths.
- planning skill loaded: `/home/loidinh/.omp/agent/skills/planning/SKILL.md`; refs plan-organization.md/output-standards.md/solution-design.md already read by main. Use those conventions, user format below.
- Primary Herdr README/concepts/agents independently read by main. Herdr per-client done/unseen, pane navigation and cross-machine agent list verified. Conceptual inspiration only, NO code copy/dependency.

## Fixed scope and design
User: Traditional terminal left sidebar currently project items; split to an Agents section showing integrated AI harness idle, working, done, etc, referencing Herdr. Plan only, no implementation.
Keep Projects first and its complete terminal membership, Git summaries, counts and existing project tab semantics. Add visible second Agents section, flat cross-open-project roster of admitted OMP/Codex/Claude harness sessions; stable session order, harness/title/project/profile context, status/reason/source/availability. Do not adopt rollups, audio, summaries, unseen acknowledgment, launch, orchestration, generic adapters or manual tagging just because research suggests them.
All available integrated harnesses represented when observed; installed-but-never-running harnesses are settings inventory, not invented runtime rows. Plain shells excluded; observed Unknown rows retained. Empty state explanatory with Agent Settings link. Do not silently shrink scope to OMP only.
One row per terminal incarnation; exact owner-qualified id join and concrete current incarnation from terminal metadata, not status row itself. Generation/epoch handling inherited from existing root bridge/store; presentation must not expose ready data from retired generation. Do not match by command/name/bare id.
State working presented Working in the new roster, idle Idle, blocked Needs attention + approval/question/error, unknown Unknown. Availability override is stronger than semantic state. Native hook limited coverage remains explained. A SECONDARY `Done (turn ended)` hint when ready + matching idle + explicit lastOutcome ended + no active turn; snapshot can show explicit last-turn outcome silently. Never task success, never native Stop/lease/disconnect-derived Done, never unseen state. Existing shared badges need not change vocabulary.
Click exact session via existing handleSelectTab/selection hook; switch project, preserve layout/buffer/PTY, target tab in split pane, close compact sheet. Reuse existing sheet with both sections, maintain Radix focus restoration and min44px touch targets. No second terminal mount. No status-driven reordering/focus changes.
Agent Store link `/agent-store?tab=settings&profileId=<encoded-profile>`: encode separately, validate target exists, retain explicit disconnected profile as unavailable, removed/unknown explicit target fails closed (NOT first-profile fallback), re-resolve that profile's current generation reactively before API work. For mixed-profile roster use current selected project profile for section-level link and row-owned context for row links if exposed; if no unambiguous owner, ask user to choose profile on Agent Store rather than inventing one. Do not mutate global active profile/notification policy/install automatically.
No backend/database/status DTO or protocol changes. Backend API/hooks are intentionally unchanged.

## Parallel phase design (main owns top-level design)
Freeze consumer interfaces/types/export signatures in plan or contracts BEFORE execution; no generated schema/shared foundation phase solely to enable parallelism.
Recommended genuine slices: (1) pure roster identity/status presentation + focused behavioral edge tests; (2) Projects/Agents navigator rendering + distinct reusable agent-row component + navigator behavior tests; (3) Agent Store profile-qualified deep-link handling + route behavior tests; (4) Traditional display integration, browser/application qualification, docs/changelog, dependent on 1-3. First three can be authored independently against frozen interfaces; integrated runtime/build verification waits for 4. Do not falsely claim connected runtime is independent. Integrator exclusively owns display glue; components phase must not touch it. Test files and docs have exactly one owner.
Define complete data shape and builder API consistent with readonly existing profile store view; builder consumes captured connections or a caller-filtered generation-safe input explicitly. Avoid nonreactive incarnation fallbacks and expensive per-row full scans.
No source edits during planning. Do not invent broad module refactors. New source paths may be declared as proposed, existing paths must be verified.

## Exact outputs
- `plan.md` starts YAML frontmatter title/description/status:pending/priority:P2/effort:<sum>/branch:feat/cloudflared-persistence-reminder/tags:[...]/created:2026-10-08.
- `plan.md` generic <80 lines (count all); include phases, dependency graph, dependency MATRIX, execution strategy, exclusive file ownership matrix, acceptance criteria, key risks and unresolved product questions. Detailed design can live in `contracts.md`.
- `cmd-plan.md` generic <80 lines, access overview; each phase with status, progress (0%), parallelization group, link.
- `phase-XX-name.md` required ordered sections: Context links; Parallelization Info; Overview (date, description, priority, implementation status, review status); Key Insights; Requirements; Architecture; Related code files (exclusive to this phase; external reads via Context links); File Ownership (explicit each path/action); Implementation Steps; Todo list; Success Criteria; Conflict Prevention; Risk Assessment; Security Considerations; Next steps.
- Every existing/new source, test, docs/changelog, fixture or qualification artifact path modified must belong to ONE phase only, match all matrices. Do not assign directory wildcards; list exact paths. Prefer paths repo-relative in overview; full absolute in detailed ownership consistent with planning skill. New paths labeled Create/proposed.
- `contracts.md` for frozen TypeScript shapes, row eligibility/status precedence, click/compact behavior and URL/generation handling. Clearly state proposals not current code.
- Reports concise <=150 lines; questions at end. Planning files only under this plan dir; docs updated by main already.

## Verification contract
No build/lint/tests/formatters during planning or mid-flight implementation slices. After integrating slices run existing targeted behavioral tests once and actual app smoke; component mocks don't certify full integration. Commands from UI package manifest; exact test filters. Keep permanent tests only for plausible consumer behavior/edge bugs: identity collisions/incarnation/generation, unknown/expired outcome precedence, navigation, compact dismissal, explicit invalid profile denial. Delete incidental wording/wiring tests, not re-pin. Shared screenshots full actual app wide+compact, real supported harness transition working->idle/explicit ended and attention; record native hooks expiry/reconnect, disabled notifications, duplicate ids across profiles, split-pane focus and xterm continuity. No fake completion or synthetic app qualification. List manual/human review gates and platform/version limits. Implementation docs/changelog update only after runtime smoke; no release version bump needed.

## Resolved research suggestions
- Unknown MUST remain Unknown; do not ask to override it with fabricated Idle.
- No new audio alerts, seen/unseen synchronization or status summaries; existing notification subsystem unchanged.
- Projects membership retained; roster alternate index.
- Any semantic no-success/identity/privacy constraints are not user-overridable styling preferences.

## User review questions at end
Layout fixed sections vs collapsible; global roster vs project filter; preferred explicit turn-ended hint wording. Defaults above enable planning without unanswered prerequisite. Final main offers optional validation interview (mode prompt, 3-8 questions); no implementation until reviewed.
