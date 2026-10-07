# Cloudflared persistence — runtime and review evidence

2026-10-07. Branch `feat/cloudflared-persistence-reminder`. Fresh debug Rust binary and production web bundle, isolated HOME/config/SQLite, loopback no-auth server. Real `/usr/local/bin/cloudflared`; only throwaway HTTP origins publicly exposed. No installed service/user configuration changed.

## Real connector lifecycle

First connector: port 40221, PID 1145361, ID `6a23099e-e308-43ef-973c-c77556aa849c`, startedAt 1791348079544. URL `https://junction-knew-regular-montreal.trycloudflare.com`.

- Detected/listening origin: public HTTP200, body `origin-v1`.
- Closed origin socket, original terminal still alive; port disappeared from real `/api/ports`. Connector PID/ID/URL/startedAt unchanged, status ready. Public HTTP502 while offline.
- Reopened same port with body `origin-v2`: public HTTP200 through unchanged URL/connector.
- Another PTY reported the same port: detection owner replaced, tunnel identity unchanged.
- New PTY naturally exited while origin stayed listening: identity unchanged.
- Explicitly killed original PTY, then reused its ID with a new incarnation: identity unchanged; fresh incarnation observed in detection.
- Manual tunnel without detected PTY (port34359): socket closed for >2 polling intervals and reopened, same live identity. Explicit REST Stop removed snapshot/reaped PID1153784.
- Removed final PTY and closed origin again: tunnel remained ready with due=false until clock advance.

## Actual server three-hour timer

A temporary LD_PRELOAD shim shifted only the selected server PID's monotonic clock by +10800 seconds. Child Cloudflared clocks and UTC time unchanged. No production flags or clock hooks added. This proves the real binary's scheduled path without claiming three hours were waited.

- Before supported clock jump: `reminderDue:false`.
- After jump: same PID/ID/URL/startedAt, `reminderDue:true`, exactly one observed WebSocket `{kind:"tunnel:reminder",payload:{id:"6a23099e-e308-43ef-973c-c77556aa849c"}}`.
- Reminder did not expire tunnel. Stopped manual tunnel remained absent.
- Graceful server SIGINT exit0 reaped active PIDs1145361 and1199022.
- A second +21600 probe attempt exceeded the throwaway shim's +10800 safety cap; no application failure inferred. Fresh isolated server run created two connectors before one supported +10800 jump; both became due. New server started with an empty tunnel list (no cross-restart persistence claim).

## Actual shared-app browser

Managed Chromium, actual production assets and REST/WS server; no fabricated tunnel API data. Fresh run connectors IDs `aeaf5380-cbe6-4660-a533-3ed11001b746` and `89b1ce5b-3a12-442e-aee6-026073121e99`, PIDs1215883/1215884.

- Reload caught up both real due snapshots.
- Dismiss port40221: only that browser reminder removed, both connector PIDs live and REST due=true unchanged. Reload kept dismissal; another fresh page session displayed both due reminders.
- Cognito activated via Ctrl+Alt+B: reminder DOM absent; app content inert and aria-hidden=true; masked screenshot observed. Toggle restored reminder.
- Retained Ports rows after detection/PTY loss: two origin-untracked rows, two URL/Stop actions, no terminal-Kill actions.
- Banner Stop selected port34359: REST removed only corresponding tunnel, child reaped; port40221 remained due/live.
- Retained-row Stop then removed/reaped port40221; REST list empty.
- Actual browser initially exposed layout bug: normal-flow banner added95px to full-height route; first wrapper hid outer scroll but route shell still extended below viewport due unlayered CSS precedence. Final explicit `.app-route-viewport > .app-screen-height {height:100%}` verified after fresh build.
- Final desktop1440×900: shell bottom900, no outer overflow. Narrow320×800 with two reminders: document320×800, shell bottom800, banner client height319 / scroll height540, client/scroll width320. URL wraps; stacked reminders scroll inside bounded region. Bottom workspace controls visible.
- Captures: [mobile reminder](reminder-mobile.webp), [desktop retained ports](retained-ports-desktop.webp). AI inspection only; mandatory human visual acceptance not synthesized.
- Browser request errors observed during intentional server shutdown/restart and cancelled host-resource requests; no browser page exception reported by `tab.errors()` in exercised flow.
- Screenshot save through raw `page.screenshot` timed out once; already-observed managed screenshots copied as evidence instead. No application diagnosis inferred from tool timeout.
- Both managed tabs closed. Second server SIGINT exit0; both origin listeners closed; isolated directory, clock shim, config, databases, and logs removed. No throwaway runtime left.

## Independent source review

Configured `code-reviewer` role; read-only full changed-source/contract audit. No critical backend defect found. Important findings corrected and reread:

1. Strict transport resolved during disconnected `useTunnels` render → enabled current-owner query; transport resolved at invocation; captured actions/post-await fences.
2. Older REST response could erase one-shot due or resurrect stopped item → exact-key query cancellation and authoritative reconciliation; deferred-response behavior regressions pass.
3. Raw terminal incarnation keys collided across profiles → qualified TerminalRef admission/confirmation/retirement and collision regression.
4. Global banner occupied extra viewport height → bounded scroll region/shared viewport allocation plus explicit unlayered route-height override; actual rebuilt-browser geometry proves correction.
5. New copy/forwarding tests removed/replaced with meaningful retained URL/Stop/no invented Kill, isolation, reload, error/retry, and transition boundaries.

Final reviewer result: `approve_source_pending_parent_validation`, important unresolved0. Parent subsequently completed browser geometry/action validation and full UI suite. Reviewer executed no checks; validation claims are parent/tester evidence only.

## Commands and limits

- `cargo check --all-targets -j 2`: pass.
- `cargo test --lib tunnel:: -j 2`:20 pass.
- `cargo test --lib port_forward:: -j 2`:15 pass.
- `cargo test --lib api::ws_protocol::tests -j 2`:11 pass.
- `cargo test --lib pty:: -j 2`:172 pass,1 ignored.
- `cargo build --bin dam-hopper-server -j 2`:pass.
- `pnpm --filter @dam-hopper/ui build`:pass, TypeScript0 errors.
- `pnpm build`:pass, final web rebuild includes explicit height CSS.
- Targeted UI:57 tests across9 files pass; see [tester report](../../reports/tester-261007-1140-cloudflared-persistence-reminder.md).
- Full `pnpm --filter @dam-hopper/ui test`:324 files /2560 tests pass after updating stale root server-config mock. Existing jsdom navigation-not-implemented diagnostics emitted; suite exit0.
- Scoped ESLint:0 errors,12 warnings; no blanket warning-free claim.
- `cargo clippy --lib --bin dam-hopper-server -j 2 -- -D warnings`:fails125 existing diagnostics across advisor/agent-status/git/workflow/other code. None in tunnel/port-forwarding modules; no suppressions added. Raw output `artifact://120`.
- `cargo fmt --check` and scoped main check:existing formatting differences outside feature edits. Scoped main diff at native integration command lines186/198/216/236/248/266 and HTTP drain code922/943/959. No unrelated reformat applied; raw main diff `artifact://125`.
- Commit whitespace gate detected CRLF/trailing-line-ending differences in edited Rust/TS files. Scoped rustfmt/Prettier normalized only those feature files before commit; untouched main/other formatting debt left unchanged.
- After scoped format normalization: UI TypeScript pass and 30 focused tests across5 files pass; Rust tunnel20 + port15 tests pass. Final staged whitespace check pass.

Linux server / Chromium web exercised. Native desktop, Windows runtime, Docker application E2E, and full Rust suite not qualified. Persistence across connector/server restart and automatic connector recovery intentionally out of scope. User explicitly approved implementation and scoped commit; no push/deployment or automatic Git decision.
