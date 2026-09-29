# Acceptance scenarios — native-hook rollout

Parent: [plan](./plan.md). Every row is **pending**. Scenario expectations use approved limited native-hook coverage, not OMP-equivalent continuous status. Backend fixture tests complement, never replace, native CLI/browser proof.

## Setup
Use isolated existing CODEX_HOME and CLAUDE_CONFIG_DIR, benign throwaway workspace, actual packaged server, Linux managed PTYs and real browser. Targets observed during planning: Codex 0.158.0, Claude 2.1.250. Record exact versions at qualification; do not store account credentials or raw event text. Prepopulate unrelated user hooks/settings; capture their semantic values for preservation checks.

| ID | Scenario | Required observable result |
|---|---|---|
| N01 | Install from CLI and Agent Settings into explicit custom directories | Same resolved target; managed registrations/launcher installed; no writes to guessed API HOME or browser home. Current install and live readiness shown separately. |
| N02 | Codex hook definition awaiting trust or updated after trust | Trust-required until native review in `/hooks` and live qualified reporting; no trust-store edits or dangerous bypass flag. |
| N03 | Claude disableAllHooks, managed-only policy, CLI/project overrides | Explain disabled/unverified readiness; no silent policy modification; absent runtime evidence never shown Ready from file existence. |
| N04 | Native user prompt and successful tool calls | Correct terminal gets hook-source Working observation; no child/other-profile row change; no prompt/tool data in collector/public APIs. |
| N05 | Silent reasoning or approval wait exceeding 15 seconds | Last native observation expires to Unknown within scheduler tolerance; no fake heartbeat, Idle, completion or continued-working guarantee. UI explains limited coverage. |
| N06 | PermissionRequest auto-approved/denied by another hook | No false needs-attention alert from request candidate alone. Later correlated evidence updates status; no approval or denial decision from DamHopper. |
| N07 | Real visible Claude approval wait and delayed notification | Qualified native visible-wait event yields Blocked/approval once; prompt text discarded; duplicate event does not duplicate attention. Long wait expires honestly. |
| N08 | User approves/rejects; tool runs long or no resolution hook | Do not claim immediate resolution without evidence. Correlated next activity may show Working; missing resolution remains Unknown after expiry. Unrelated parallel tool cannot clear another blocker. |
| N09 | Codex Escape/Interrupt during active turn | Matching turn records interrupted/Idle observation, no normal completion alert; observation later expires. Old interrupt cannot settle newer turn. |
| N10 | Claude Escape without Stop | No false completion; previous observation expires to Unknown. Absence of hook documented, not treated as test failure to hide or screen-detection opportunity. |
| N11 | Another Stop hook requests continuation or runs slowly | DamHopper never sends normal turn-ended attention from Stop/debounce/silence. Later work observations remain valid. Reporting emits no context or continuation decision. |
| N12 | Claude qualified StopFailure; tool-level failure; unknown native event | Root API failure may yield one error attention; ordinary tool failure not mislabeled terminal error; unknown event does not renew evidence lease. No raw error details leaked. |
| N13 | Root spawns native subagent/nested CLI | Child event/stop/error cannot claim or settle parent row. Unverifiable ancestry/noninteractive/background roots rejected with safe readiness reason, no content logging. |
| N14 | Resume/clear/compact and delayed SessionStart/old Stop | Verified session transition silently resets state; compact not completion; late previous session/turn cannot overwrite current state or alert. Missing correlation => conservative no-op/Unknown, never guessed settle. |
| N15 | Agent exits, shell survives; another agent launches in same PTY | Matching end releases authority; missing end expires. New claim has fresh epoch; old callbacks cannot change replacement. No dead root retained as Working. |
| N16 | PTY restart/token revocation/server restart | Old capabilities rejected; stale inc/epoch cannot report. New managed PTY establishes fresh silent baseline. No historic catch-up attention. |
| N17 | Hook invoked outside DamHopper or collector unavailable/slow | Silent bounded exit 0; no output/context injection, no model request or decision, no native workflow interruption. No daemon/process leak. |
| N18 | Malformed/oversized payload, wrong Origin/Host/path, public/tunnel access, burst | Private ingress rejects safely; rate limits cannot reset per invocation; no prompt/token/raw request logs; ordinary terminal still works. |
| N19 | Live OMP reporter and native hook contend for same terminal | Native hook cannot evict live OMP; OMP heartbeat, reconnect, blockers and semantic notifications remain unchanged. Separate PTYs work concurrently. |
| N20 | Complete Codex OSC9 removal; feed live/replayed OSC9 and change preferences | Zero DamHopper history/toast/sound/browser alerts from OSC9 or native Stop. Native hook status still works. Automatic TUI-sync removed; native notify/TUI values unchanged by preference saves/install/remove. No fallback/no-op attach API; Codex clearly status-only, unsupported alert activation unavailable. |
| N21 | Two profiles share terminal IDs; switch during save/install/verification | Mutations target captured owner + saved normalized path, never new selected profile or unsaved draft. Late generation responses discarded; notification opens correct incarnation/profile. |
| N22 | Saved path changes, installer removed/tampered, API disconnect, verification expires | Eligibility invalidated immediately for own changes/disconnect; external changes blocked within stated 15s freshness bound. No stale channel delivery; badges remain visible. Invalid booleans/DTOs fail closed. |
| N23 | v1/legacy config migration, v2 reload/import/export, unknown future version | Preserve OMP/Codex enabled/channel/volume/pattern values; Claude disabled initially. Write only v2; unsupported future versions rejected; disabling works when native config missing. |
| N24 | Missing root, symlinked ancestor/target, malformed config, permission denial | Status is read-only; installer refuses unsafe writes. Service identity and target produce actionable errors; no sudo, chmod/chown or broad HOME provisioning. |
| N25 | Install twice/update with unrelated native hooks; concurrent config edit | Idempotent owned registration; unrelated hooks and settings preserved. Input revision conflict prevents lost update. Codex inline + JSON not duplicated. |
| N26 | Modified owned launcher/registration or missing manifest | Refuse destructive overwrite/removal; show exact conflict and no false success. No unmanaged Herdr/user hook removed. |
| N27 | Failure between asset staging and registration, or during uninstall | Honest partial/restart-required state; no claimed current install with missing executable; no registered dangling command on claimed successful removal; recoverable narrow operations. |
| N28 | Uninstall while native agent may cache hooks, then restart/finalize | Registrations removed first; restart-required disclosed; assets removed only when no cached invocation can occur. After completion/restart, no DamHopper launcher/manifest/registrations or execution remains. Other hooks still work. |
| N29 | Uninstall twice; owned empty directory/file vs preexisting directory/file | Repeated removal succeeds idempotently. Only proved-owned empty artifacts deleted; existing agent config and nonempty hooks directory preserved. |
| N30 | Packaged upgrade and explicit rollback | Stable launcher invokes available packaged binary; path changes show outdated/restart-required. Rollback restores compatible preference snapshot before older binary; never overwrites concurrent user native config with whole backup. |
| N31 | Agent Settings accessibility and actual badge/notification surfaces | Keyboard labels, trust/restart/conflict actions and limited-coverage help work; tabs/splits/Fleet show correct agent + Unknown freshness. Master off suppresses channels, not status. |
| N32 | Linux qualification vs unsupported versions/platforms | Only exercised version/OS combinations advertised; non-Linux compilation preserved, runtime platform-unqualified unchanged. Unknown/version gates do not block ordinary terminal use. |

## Evidence requirements
For each row record command/scenario, result, binary/OS, relevant profile/incarnation, safe screenshot or content-free observation, and regression test if applicable. Never mark real-native scenarios passed solely from synthetic callback injection. No task-success language for turn end. Timing checks use bounded scheduler tolerance and monotonic server durations, not fragile exact wall-clock assertions.

## Unresolved questions
No product scope choice outstanding. If exact native APIs cannot prove a proposed mapping or root identity, gate that mapping/readiness and document it; approved Unknown behavior is required, not permission to fabricate evidence.
