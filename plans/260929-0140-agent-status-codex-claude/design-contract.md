# Native-hook design contract — proposed

Parent: [plan](./plan.md). All behavior below is proposed, not delivered. [User decisions](./reports/decisions.md) approve native-only tracking with gaps.

## 1. Scope and non-goals
Support ordinary interactive Codex and Claude Code within managed Linux PTYs. No wrappers replacing their TUI, app-server host, screen reconstruction, output heuristics, transcript access, cross-session task completion, automatic approvals, new daemon, or hook framework. Keep OMP unchanged. Existing process/output indicators and suspend/usage/workflow systems remain separate.

Silent command hooks must never return native decision JSON, additionalContext, stdout messages, prompts, or blocking exit codes. No prompt/agent hooks or LLM call. CLI reporting failures exit successfully and silently; management commands still return actionable errors. Reporting cannot change AI work.

## 2. Data flow and lifetime
1. Existing PTY spawn injects collector URL and terminal-incarnation token privately.
2. Native agent emits event and starts managed launcher. Without valid capability/env, launcher is dormant.
3. Launcher executes `dam-hopper-server integration <codex|claude> report-hook`. Dispatch occurs before normal server/database/auth startup, like current OMP management commands.
4. Rust subcommand streaming-parses native stdin; retains only allowlisted metadata, ignores text values without materializing them, validates local root-process identity, and sends one bounded request to the existing private collector.
5. Collector authenticates and validates native event, identity and freshness; provider adapter normalizes it through the existing registry/reducer. Only admitted observations update public status.
6. Existing protected snapshot/WebSocket and app-root profile watcher deliver rows and qualified attention. No per-tab reporter.

Private route: proposed `POST /v1/agent-hooks` on the existing loopback listener, not public API/tunnel routing. The subcommand derives that route only from a validated injected loopback `/v1/agent-status` URL; token stays in Authorization, never URL/argv/config. Reject browser Origin, non-loopback peers, wrong Host/path/query, malformed/oversized/unsupported input. Reuse existing 4KiB normalized payload, 32 pre-auth concurrency, 20/s burst-40 limits; rate-limit by terminal capability/claim rather than a fresh per-request identity. Hook CLI deadline 250ms for local delivery, no retries/history queue; payload overflow/failure => no report, eventual Unknown. Native stdin has a separately bounded streaming limit (initial 1MiB, qualification can tighten); never forward the raw body.

Hook event evidence expires **15 seconds after the last accepted observation**. No timer resends cached state. Loss, inactivity, registry eviction, or retirement emits Unknown without attention. A native process exit can invalidate earlier when an existing trusted lifecycle signal exists, but do not add process polling merely to manufacture semantic liveness. OMP keeps its separate 5-second heartbeat/15-second connection lease and immediate disconnect invalidation.

UI must label these as **hook observations / limited coverage**, show observation age or expiry in tooltip/details, and explain that quiet reasoning and long waits become Unknown. Fifteen seconds bounds staleness; it does not prove an unobserved cancellation did not occur during that window. Do not call this continuous authoritative parity.

## 3. Identity, ordering, and privacy
- One owner per `{terminalId, incarnation}` across OMP and native hooks; native hook admission cannot evict live OMP authority.
- Private hook envelope: `version:1`, `agentKind:codex|claude`, `adapterVersion`, random `eventId`, native `event`, opaque `agentSessionId`, optional native `turnId`/`toolCallId`, closed `reason`/`notificationType`, and private root-process identity `{pid,startTimeTicks}`. No message, prompt, tool arguments/results, cwd, transcript path, or arbitrary error text.
- Root identity derives from actual launcher ancestry, not a native payload PID or executable label. On Linux, qualify a bounded per-invocation ancestry check against the owning PTY's tracked process identity/group; PID start time prevents reuse. This is targeted process identity validation, not output/process activity polling. Never publish PID, argv, environment, or ancestry. Reuse existing process-identity helpers if applicable; no `/proc` I/O under the PTY-manager/runtime mutex.
- Payload `agent_id`/`agent_type` child markers cause a no-op; inspect only their presence/allowed root shape. Reject nested agent processes under another agent, ambiguous ancestry, detached/background/noninteractive launches, and unmatched runtime homes rather than letting them claim the parent. Linux PID namespaces/containers without verifiable ancestry remain unsupported.
- Use exact provider turn/prompt IDs when available. If qualification cannot correlate an event to the current root turn, it may invalidate to Unknown but cannot settle a turn or clear a newer blocker. Do not guess correlation from delivery time.
- SessionStart is a silent baseline, not automatically Idle. Native resume/clear/compact/fork events reset only a verified current session transition; compact does not end work. Delayed startup hooks must not reset a newer prompt.
- Server assigns reporter epoch and sequence at admitted ingress; bounded event-ID dedupe handles identical deliveries. Receipt order does not prove causal order: maintain current session/turn and retired identifiers; late previous-turn/session callbacks are ignored. Correlation-less Stop cannot override a newer turn. Claim lifetime/retired IDs are bounded by terminal incarnation and existing capacity limits.
- SessionEnd releases only its matching claim; expiry becomes Unknown. Same native session reused by a different root process needs a fresh epoch and silent baseline. Competing live roots in one PTY are unsupported, not merged.
- Server restart revokes old capabilities. Existing native processes require fresh managed PTY/restart, just as current capability architecture; do not reconnect with a stale token or replay missed attention.

## 4. Capability and event mapping
Current primary docs are ahead of some installed releases. Qualify the actual target binaries before enabling each mapping. This table deliberately distinguishes candidates from authoritative final outcomes.

| Input | Codex mapping | Claude mapping |
|---|---|---|
| SessionStart | Silent Unknown baseline; bind only verified root/session | Same; asynchronous startup ordering must be checked |
| UserPromptSubmit | Observed Working for correlated root turn | Observed Working; preserve native prompt correlation where supported |
| PreToolUse | Observed Working except known input-request candidate; no tool content | Observed Working except question candidate; no content |
| PermissionRequest | Candidate only: Unknown, no attention; another hook may auto-resolve | Same; can also represent noninteractive auto-denial |
| Explicit visible-wait notification | Enable only if exact API/version documents and smoke proves it; otherwise unsupported | `Notification(permission_prompt)` can establish observed Blocked/approval; delayed and no resolution guarantee |
| Explicit question wait | No generic documented hook; Unknown | Qualify native `agent_needs_input`/elicitation metadata if present; PreToolUse AskUserQuestion alone is only a candidate |
| PostToolUse | Correlated observed Working; not completion or blanket blocker-clear | Same; PostToolUseFailure is tool-level activity, not terminal failure |
| Stop | Unknown; no normal completion alert | Unknown; `stop_hook_active` cannot prove other hooks will not continue |
| Interrupt | Correlated Interrupted/Idle observation; no completion alert, then expires | No documented general Escape/interrupt hook: evidence expires to Unknown |
| StopFailure | No generic documented terminal-error hook: unsupported | Qualified root API-failure event => Blocked/error, one needs-attention; discard error text |
| PreCompact/PostCompact | Observed Working only within verified active turn; never completion | Same |
| Subagent hooks | Ignore for root status/attention | Ignore for root status/attention |
| SessionEnd / expiry | Release / Unknown; no completion | Same |

Do not promise persistent Idle, universal question detection, immediate approval-resolution detection, or reliable final-stop outcomes. No fixed 250ms debounce can establish finality when another hook may run for seconds/minutes. Unsupported callbacks and unknown schema versions do not renew the lease.

## 5. DTOs, settings and source arbitration
- Expand Rust/TS AgentKind to `omp|codex|claude`; keep existing state/outcome enums and public v1 route. Matched releases required; older clients reject new agent enums rather than being claimed compatible.
- Add public observation metadata: `source: lifecycle|hook`, server `observedAtMs`, nullable `expiresAtMs`. OMP uses lifecycle, hook observations use hook; heartbeat/repeated unchanged observation must not cause unbounded UI rerenders. Choose revision updates only when source/state changes or freshness needs publishing; client derives display age from bounded timestamps. Decoder accepts old OMP rows as legacy lifecycle only; never defaults a missing Codex/Claude evidence contract to ready.
- Separate installation (`absent|current|outdated|modified`) from readiness (`ready|restart-required|trust-required|policy-disabled|path-mismatch|permission-denied|unsupported-version|unverified`). No fake readiness from file presence. Browser eligibility is strict booleans/enums, not `Boolean(untrustedValue)`.
- Preferences: `terminalAgentNotifications.version=2`, retain codex/omp policy values exactly and add claude default disabled. One-way migration from v1/legacy inputs; unknown future versions refused. Update Rust JSON/TOML normalization, imports/exports and all UI stores/callers; no dual-writing legacy fields.
- Paths add `claudeDir` to existing `agentSettingsPaths`; camelCase API/snake_case TOML. Save paths independently of enablement, against explicit owner/profile generation. Native installation readiness and saved policy are separate.
- Delivery eligibility uses fresh server verification tied to agent, profile/generation, saved canonical path and managed install revision. Verify filesystem/policy outside locks at bounded intervals and before accepting attention; UI clears eligibility on disconnect/path/install/policy/source changes. Maximum cache lifetime 15s; expose expiry, do not claim instantaneous detection of arbitrary external edits. Unknown/expired eligibility suppresses all channels but never badges. Direct backend enable writes revalidate, not just the UI.
- For per-PTY native events, runtime HOME/config dir comes from actual reporting process context and is compared with selected installation identity, not the API account's guessed home. Profile-level verification alone cannot authorize mixed environments.
- **User-validated clean OSC9 removal:** Codex hook adapter provides status only in this rollout; remove DamHopper OSC9 notification registration/parser and all obsolete attach callers/no-op callbacks. No OSC9 fallback and no native Stop completion. Remove `sync_codex_tui_config`, master-toggle-triggered TUI writes and test-only legacy path overrides made obsolete by this cutover; keep actual native installation path verification. Preserve user `notify` and existing TUI values on disk: previous DamHopper writes have no ownership history sufficient to restore a guessed original. Those values cannot trigger DamHopper alerts after handler removal. Document optional user-managed cleanup for effects in other terminals, never silently disable native preferences globally. Preserve Codex channel values through migration for data integrity but disable/hide unsupported notification activation with a status-only explanation; do not advertise usable alert channels. No compatibility shim.
- OMP retains semantic attention. Claude uses only qualified explicit needs-attention/error events; no normal-turn-ended promise. Shared dispatcher selects agent-specific policy/title from matching row+attention agentKind and current owner; existing bounded attention ID dedupe remains.

## 6. Management and rollback
Proposed CLI: `dam-hopper-server integration {codex|claude} {install|status|uninstall} --agent-dir <absolute-existing-config-dir> [--json]`. Internal `report-hook` takes native JSON on stdin and no credential arguments. Existing OMP CLI stays intact.

Proposed authenticated management: GET/POST/DELETE `/api/agent-status/integrations/{codex|claude}` with explicit agentDir, existing owner transport and status DTO patterns; `/api/agent-status/paths` extends with claudeDir/readiness and strict verification. Do not introduce a generic integration registry; match the two concrete agents.

Install stores a managed launcher at `<configDir>/hooks/dam-hopper-agent-status`, plus a private managed ownership manifest (proposed `<configDir>/hooks/dam-hopper-agent-status.manifest.json`). Manifest tracks exact owned entries/content hashes, schema version, created-file ownership and prior values only for explicitly changed feature keys; no whole user config, credentials or prompt data. Launcher uses a trusted stable absolute installed binary path, safely quoted; verify executable availability for the actual agent user. Release path changes produce outdated/restart-required, not silent PATH resolution.

Codex: prefer `hooks.json`; if that layer already uses inline `[hooks]`, append owned entries in that existing representation instead of creating a second representation/startup warning. Never duplicate hook registration across representations. Preserve TOML comments where editing inline tables. Respect explicitly disabled features; expose required operator action. Do not write trust stores or use `--dangerously-bypass-hook-trust`. User reviews `/hooks`; definition updates may require review again.

Claude: merge only owned command handlers into native `hooks`; preserve matcher siblings, plugins and arbitrary unrelated settings. Respect disableAllHooks, managed-only policy and effective CLI/project overrides; where effective settings cannot be verified, show Unverified until a live qualified handshake, not Ready from inspecting one file.

Filesystem: require existing config root, reject symlinked ancestors/targets, verify ownership/permissions and regular files, use directory-relative no-follow operations where supported, serialize per-installation mutations and recheck input revisions before same-directory atomic replace. Stage launcher/manifest first, publish configuration registration last; failures never leave a claimed current install with missing executable. Crash recovery inspects owned fragments and reports partial state. Do not attempt cross-file atomicity with independent renames and call it transactional.

Uninstall: disable delivery/readiness; remove exact owned registrations first; reload/restart agent before deleting a launcher that a cached handler may still invoke. If stopped-session proof is unavailable, return `restart-required` removal state and complete cleanup through explicit recheck/finalize; never claim fully removed early. Missing/modified ownership refuses destructive removal, offers exact conflict path, preserves user changes. Remove launcher/manifest only after no managed references/live cached definition remain; delete an empty file/dir only if manifest proves DamHopper created it. Repeated uninstall is idempotent. Verify no invocation after restart. No tombstone shim or permanent service.

Rollback uses pre-migration DamHopper preference snapshot before old binary restore; native configurations receive narrow inverse edits, never whole-file restoration over user changes. Hooks outside DamHopper do nothing when credentials absent; unrelated hooks keep their previous behavior.

## 7. Unresolved qualification gates
Prove required event schemas and IDs on Codex 0.158.0 and Claude 2.1.250, safe root ancestry/session selection, hook trust/policy visibility, stable binary invocation and installed-user permissions. When evidence is insufficient, disable that mapping/readiness with a concrete reason. No silent screen fallback, fabricated heartbeat or complete-parity claim.
