# Acceptance scenarios — agent status, OMP first

Status: planned; none of these dam-hopper feature scenarios has run. Prior upstream Herdr smoke is not a substitute.

| ID | Scenario / stimulus | Required observation | Evidence owner |
|---|---|---|---|
| C01 | Start installed OMP in managed shell; submit safe prompt, including interval without PTY output | Initial idle has no finished alert; turn working independent of output dot; explicit normal settle yields idle + one opted-in turn-ended event | Adapter/reducer tests + real OMP + browser |
| C02 | Approval request/resolution/denial; duplicate callbacks; overlapping approval and ask | Needs-attention once on first blocker; keys dedupe; remains blocked until final blocker resolved; denied/cancelled work not claimed successful | Adapter tests + real approval/ask |
| C03 | Automatic continuation, retry delay longer than 2.5 seconds, retry success, exhausted retry, cancellation | No transient successful finish; working through continuation/retry, failure needs attention, interruption distinct from success | Deterministic events + real retry/interrupt boundary |
| C04 | agent_end stopReason error/aborted/length/toolUse/absent; duplicate/late end; unmatched turn | Error attention or interrupted/unknown, never normal completion for unproven outcome; at most one attention per settled turn | Adapter/reducer tests |
| C05 | Session switch/new/resume/reload mid-run; begin from existing active session | Session identity resets safely; snapshot doesn't synthesize completion; old timers/blockers/connection cannot alter new session | Adapter test + real OMP switch/reload |
| C06 | OMP exits/crashes while parent shell alive; reporter shutdown hook skipped | Immediate unknown on socket close, no false completed alert; PTY remains usable | Real OMP kill/exit + live shell |
| C07 | Hung reporter or paused heartbeat, despite live process/socket | Unknown by 15-second lease (+ bounded scheduler tolerance); long healthy working operation stays working with valid heartbeat | Fake clock + socket pause smoke |
| C08 | Nested OMP via OMP tool shell; print/RPC/non-UI; adapter outside managed terminal; no-extensions | No root overwrite/network attempt from excluded modes; documented explicit -e opt-in works; ordinary installed root reports | Adapter guard tests + real nested launch |
| C09 | Old/duplicate/conflicting sequence, old reporter epoch, session/terminal incarnation reuse | Stale reports ignored/rejected; duplicate event not re-alerted; old close cannot clear new reporter | Reducer/socket tests |
| C10 | Same terminal ID on two profiles; reconnect replaces connection generation; late snapshot resolves | No cross-profile overwrite/rate-limit collision/navigation; stale owner result discarded | UI contract + two-profile browser smoke |
| C11 | Event arrives before/during/after initial snapshot; reconnect after unseen offline completion; periodic fetch races | Baseline silently installs latest status; only events newer than baseline may notify; offline completion not replayed; no state regression | Deterministic reconciliation tests + browser reconnect |
| C12 | Noisy PTY output, semantic broadcast lag, bounded bootstrap overflow, malformed public payload, old server 404 | PTY stays responsive; resnapshot restores state without alerts; unknown/unsupported not idle; bounded memory/no endless 404 retry | Socket/decoder/overflow tests + smoke |
| C13 | Installer absent/current/outdated/locally modified/symlink/nonregular paths; repeated update/uninstall | Exactly one managed file changes atomically; modified/unmanaged/symlink refused; unrelated OMP/Herdr files untouched | Real temp-profile filesystem + CLI |
| C14 | Default/named/custom OMP agent directory, server service-user home, server-host vs browser-host install | Explicit --agent-dir targets intended profile; no accidental root/browser profile install; already-running sessions documented restart | Packaged CLI/profile smoke |
| C15 | Build/package Rust server with asset embedded; use installer without source tree or runtime npm dependency | Complete TS adapter installed from binary; server service integrated, no Herdr daemon, no OMP/Bun required at Rust compile time | Build/package smoke |
| C16 | Notification master/channel toggles, default OMP off, focus/hidden, permission denied; duplicate delivery | Badges independent; one history entry per live attention/client; enabled channels follow always policy; no permission auto-prompt; two devices may each notify | Store tests + actual browser |
| C17 | Legacy terminalCodex* values/older alias; explicit new settings wins; save/export/import roundtrip | Codex behavior retained, OMP not silently enabled; only new canonical shape written; no stale live aliases | Migration tests + Settings UI |
| C18 | Wrong/missing/revoked token; browser Origin/non-loopback attempt; rapid/oversized frames; spawn/restore/respawn failure; bind unavailable | Reporter rejected or unknown; credentials absent from API/SQLite/templates/logs; PTY usability preserved; no capability routed through public API/tunnel | Auth/socket/PTY tests + canary-secret inspection |
| C19 | Existing Codex OSC9, shell suggestions, terminal output/process status, workflow and suspend behavior | No semantic reinterpretation; existing contracts retain behavior; badge absent on ordinary shells; correct navigation from history to still-current incarnation | Existing focused suites + browser/runtime smoke |

## Planned verification commands

Execute only during implementation, after integrated changes; exact new test names follow phase files.

```sh
cargo test --manifest-path server/Cargo.toml agent_status
cargo test --manifest-path server/Cargo.toml --test agent_status_runtime
cargo test --manifest-path server/Cargo.toml --test agent_status_integration
bun test server/tests/omp-agent-status.test.ts
pnpm --filter @dam-hopper/ui test
pnpm build
pnpm lint
cargo test --manifest-path server/Cargo.toml
cargo build --manifest-path server/Cargo.toml --release --bin dam-hopper-server
```

Also run actual server + OMP + Chromium scenarios; tests do not prove live hook coverage or badge rendering. Use installed provider credentials only for safe live prompts; evidence must omit credential values and transcripts. Windows compilation runs in supported CI/toolchain, not claimed by Linux commands. Windows runtime qualification remains separate by user decision.

## Release proof vs plan proof

This planning session checks documents: frontmatter pending, all five phases linked, section order, local links and C01–C19 coverage. It does not run the future feature, unit suites or application builds. Existing upstream smoke and OMP source evidence remain correctly scoped.

## Unresolved questions

None requiring user input. External prerequisites at implementation time: usable OMP qualification version/provider access, Chromium, Rust/PNPM/Bun toolchains, isolated server/profile configuration and Windows compile CI. Missing prerequisites must be recorded explicitly instead of calling unexercised scenarios passed.
