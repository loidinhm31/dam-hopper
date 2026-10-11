# Enhancement: Color-Coded Badges for Agent Harness, Project, and Profile

Worktree: `/home/loidinh/WS/worktrees/dam-hopper-traditional-terminal-agents-sidebar`
Branch: `feat/traditional-terminal-agents-sidebar`

## Preflight Contract

- **Output:**
  1. `AgentHarnessBadge` atom (`packages/ui/src/components/atoms/AgentHarnessBadge.tsx`) rendering distinct brand/system colors for agent types:
     - OMP: Purple / Violet (`bg-purple-500/15 text-purple-300 border-purple-500/30`)
     - Codex: Emerald (`bg-emerald-500/15 text-emerald-300 border-emerald-500/30`)
     - Claude: Amber / Warm terracotta (`bg-amber-500/15 text-amber-300 border-amber-500/30`)
     - Default: Sky (`bg-sky-500/15 text-sky-300 border-sky-500/30`)
  2. `ProjectBadge` atom (`packages/ui/src/components/atoms/ProjectBadge.tsx`) rendering deterministic color-hashed micro-badges for project labels, truncated cleanly with full hover title and accessible `role="status"` + `aria-label`.
  3. `ProfileBadge` integration: Reuse existing `ProfileBadge` atom (`packages/ui/src/components/atoms/ProfileBadge.tsx`) for the profile badge on each agent item, passing `profileId` and `name`.
  4. `TraditionalTerminalAgentStatusGroup` update: Expose `profileId: string` on the group model populated from `first.terminalRef.profileId`.
  5. `TraditionalTerminalAgentGroupRow` updated layout:
     - Line 1: `AgentHarnessBadge`s + terminal title (if single agent)
     - Line 2: `ProjectBadge` + `ProfileBadge`
     - Line 3: Status badge (icon + label) + Count badge + Reason label
     - Line 4: Outcome hint (if unanimous)
     - Line 5: Source label / coverage explanation
  6. Preserved contracts:
     - Button `aria-label` remains strictly `${subject}; ${where}; ${label}${reasonLabel ? `: ${reasonLabel}` : ""}`.
     - Button `title` remains `${subject}; ${where}`.
     - Button `textContent` preserves all expected substrings (`terminalTitle`, `harnessLabel`, `projectLabel`, `profileLabel`).
     - Stale and replaced PTY gating (`handleSelectAgent`) completely unchanged.

- **Acceptance Criteria:**
  - Micro-badges share unified typography scale (`text-[9px] font-mono font-medium tracking-wide border rounded-sm px-1.5 py-0.5`).
  - Colors are distinct, WCAG-contrast accessible on dark/light surfaces, with subtle 15% fill and 30% border opacity.
  - Narrow 224px sidebar layout does not overflow or wrap awkwardly; badges truncate with ellipsis and full titles.
  - Full UI unit test suite (`pnpm test`) passes.
  - Chromium browser test suite (`terminal-traditional-projects.browser.tsx`) passes (35/35).
  - TypeScript typechecks clean (`pnpm exec tsc --noEmit -p .`).

- **Scope Boundary:**
  - Changes strictly in `packages/ui` presentation layer and docs.
  - No server, database, or WebSocket protocol modifications.

- **Risk & Mitigation:**
  - Risk: Badge styling might inflate element height or overflow narrow sidebar.
  - Mitigation: Compact `py-0.5` micro-badge geometry matching `ProfileBadge`, with flex items and truncating spans.

- **Testing Strategy:**
  - Unit tests for `AgentHarnessBadge.test.tsx` and `ProjectBadge.test.tsx`.
  - Molecule tests in `traditional-terminal-agent-group-row.test.tsx`.
  - Group model tests in `traditional-terminal-agent-groups.test.ts`.
  - Browser tests in `terminal-traditional-projects.browser.tsx`.
