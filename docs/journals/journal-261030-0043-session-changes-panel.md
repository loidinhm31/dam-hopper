# Session changes panel — approved design

- **Mode:** decision-summary
- **Problem & outcome:** Review code changes from an OMP chat in DamHopper PTY/xterm; user explicitly approved a read-only Session changes panel comparing actual session-start on-disk contents against current contents.
- **Key decisions:** Read-only changes panel in web/Tauri UI with Monaco diffs; baseline captures dirty tracked and eligible untracked files before the first model turn; baseline verified before turn execution.
- **Trade-offs & constraints:** Concurrent shared-worktree edits are included in net diff; no agent-only attribution, undo, per-turn history, or Android UI; snapshot retention limited to current server lifetime without cross-restart archiving.
- **Design status:** **Approved** by explicit user choice. See the [approved design report](../../plans/reports/design-261030-0043-session-changes-panel.md).
- **Planning consent & router result:** User explicitly selected "Defer planning"; router not invoked; plan path: none.
- **Next step:** Retain approved design; author implementation plan only upon subsequent explicit user request. No product implementation.
