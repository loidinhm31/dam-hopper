# Enhanced instructions for `/cmd-plan__hard`

Create a comprehensive implementation plan only. No source changes, builds, tests, or runtime modification during planning.

Goal: add commit-message history search to Workspace page's Git panel and standalone Git page; persist selected project and history branch across navigation, component remounts, and browser reloads. Preserve Git page's current empty-selection-means-all and multi-project bulk-operation behavior.

Research current Rust history traversal, REST/WebSocket transport mapping, owner-scoped query keys, branch/root/worktree selection, Zustand persistence, and existing history actions before specifying edits. Use current repository evidence, not historical memory. Search must find matching commits beyond the initial 200-row page and apply before pagination. Specify full-message versus subject behavior, case/literal semantics, request shape, empty input, query invalidation, pagination, filtered graph appearance, and UI loading/error/empty states.

Persistence must reuse the profile-qualified Workspace selected project and existing project-target ownership, distinguish local/remote history branches from actual checkout, retain follow-active versus pinned-branch intent, and isolate branch state by profile/project/worktree/VCS root. Define hydration, unavailable/offline profile, removed project/worktree/root/branch, stale response, and cross-page synchronization behavior. Do not change repository checkout automatically or create an unowned project alias.

Deliver under `plans/261001-2003-git-history-search-persistence/`: YAML-frontmatter plan.md, cmd-plan.md overview under 80 lines, ordered phase files with exact code files/symbols, shared contracts, dependencies, numbered actions, per-phase success criteria, risk/security notes, and end-to-end validation instructions for lower-capability agents. Define implementation file ownership and which slices can run in parallel. Document conservative defaults and unresolved questions; no invented test results.

Workflow: apply loaded global cmd-plan__hard.md and planning SKILL.md instructions directly; native slash-dispatch tool not exposed in this session. Two independent bounded research slices; parent owns synthesis and final plan. Local `.omp/` absent. Global plan activation helper was run, but EVCRATE_SESSION_ID is absent, so active-plan session persistence is unavailable.

Environment: Linux 7.1.10-200.fc44.x86_64, x64; pnpm monorepo; repository `/home/loidinh/WS/dam-hopper`; injected branch main; local timezone Asia/Saigon. Environment startup reports CPU 2% user / 1% system and memory 5MB/23823MB; spawn only two independent research workers. Language-server status: no servers configured. Planning skill loaded directly from `/home/loidinh/.omp/agent/skills/planning/SKILL.md`.
