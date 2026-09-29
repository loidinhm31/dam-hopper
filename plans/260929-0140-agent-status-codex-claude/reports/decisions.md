# Rollout decisions

Date: 2026-09-29. Source: planning-session user interview.

## Confirmed
- User selected **Yes, native hooks** after comparing native hooks, screen fallback, and complete-fidelity controlled launch modes.
- Approved boundary: normal Codex/Claude CLI usage; removable managed integration; explicit Unknown when native events cannot establish state; documented lifecycle gaps. No screen fallback or app-server launch-mode replacement.
- Reporting uses silent command hooks only. No model calls, prompt/agent hooks, context injection, permission decisions, or stop-continuation decisions. No intended incremental model token usage; small local process/IPC overhead remains.
- Hook files live on the terminal server in the chosen native configuration directories: CODEX_HOME (default ~/.codex) and CLAUDE_CONFIG_DIR (default ~/.claude). Existing OMP integration remains.
- Managed uninstall must remove DamHopper registrations and launcher completely after agent reload/restart, preserve unrelated hooks/settings, report modified-file conflicts and partial failures explicitly, and never leave a broken active registration while claiming success.

## Main-agent design decisions
- Reuse backend reducer/registry, protected public status transport, browser ownership and badge surfaces. Do not add a daemon, screen parser, transcript reader, or generic plugin framework.
- One-shot hooks need their own bounded private ingress/evidence lease; do not pretend a helper heartbeat proves the native agent is still working. OMP persistent WebSocket/5s heartbeat/15s lease stays unchanged.
- Final Stop is not proven by a fixed debounce because other hooks can continue. No hook-generated normal turn-ended alert without qualified final-settle evidence. During validation user requested **remove OSC9 too**: remove DamHopper OSC9 handling and automatic Codex TUI sync, preserve unrelated user notify/config, present Codex as status-only rather than promising completion alerts.
- Local observed versions: Codex CLI 0.158.0, Claude Code 2.1.250. These are qualification targets, not claims of already qualified integrations or minimum compatible versions.
- Linux first; preserve non-Linux compilation and current platform-unqualified behavior.

## Validation interview
- Executed `/cmd-plan__validate` instructions against this plan; 3 questions.
- User confirmed **15-second expiry** even while real work can continue silently.
- User replaced coexistence with **complete DamHopper OSC9 removal**.
- User confirmed **restart-aware removal** before final launcher cleanup.
- All decisions incorporated into the design, phases and acceptance criteria; no pending plan revision.

## Unresolved questions
No remaining architecture choice. Runtime event ordering, effective runtime identity, exact-version support, and final-settle evidence are implementation qualification gates, not approval to infer state.
