# Plan validation

Date: 2026-09-29. Workflow: `/cmd-plan__validate plans/260929-0140-agent-status-codex-claude/plan.md`, loaded and executed as session instructions. Planning only.

## Interview — 3 questions
| Decision | User answer | Incorporated result |
|---|---|---|
| Evidence freshness | 15-second expiry | Hook observations expire to Unknown, including long silent work/waits; no invented heartbeat. |
| Completion notification policy | “remove OSC9 too” | Clean DamHopper OSC9 handler/parser/caller/test and automatic Codex TUI-sync removal. Codex status-only; no Stop-based completion. Existing user native notify/TUI values preserved, no unsupported activation controls. |
| Full uninstall | Restart-aware removal | Deregister first; show restart-required while native process may cache definitions; finalize owned assets only after restart/verified absence. |

Earlier discussion confirmed native hooks over screen detection, no model/context work, server-side installation paths, preservation of user hooks and complete managed removal.

## Plan revisions completed
- Updated plan overview, architecture proposal, design contract, decisions, Phases 04–06 and acceptance N20 for OSC9 removal. Research reports are historical inputs, not final product decisions; their coexistence recommendations are superseded here.
- Phase 05 identifies TerminalPanel attachment/callback removal, parser/reference cleanup, server sync deletion and preserved native preferences. No no-op shim or fallback.
- Existing OMP behavior remains out of removal scope. Codex legacy channel values migrate for data integrity but do not imply an available alert capability.
- Kept all six phases pending; 32 acceptance scenarios pending implementation.

## Verification evidence
- Read current Rust/UI implementation and official Codex/Claude/Herdr documentation.
- Executed read-only probes: `codex --version` → 0.158.0; `claude --version` → 2.1.250; `codex features list` → hooks stable true.
- No application build/test/formatter, model turn, hook installation or native config modification performed.
- Active-plan helper exited 0 but could not persist session activation: `EVCRATE_SESSION_ID` absent. Explicit plan path required.
- Document validation passed: 16 documents, six phase files with all 12 required sections in order, 51 local links resolving, 32 consecutively numbered acceptance scenarios, required plan frontmatter, overview/research length limits; zero issues.

## Unresolved questions
No unresolved product decisions. Implementation qualification gates remain: exact-version hook semantics, causal/root attribution, effective trust/policy/path readiness, and real installed CLI/browser behavior. These are not claims of already implemented or qualified support.
