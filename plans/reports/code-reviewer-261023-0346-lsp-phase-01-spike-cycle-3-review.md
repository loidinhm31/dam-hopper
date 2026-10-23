# Code Review — LSP Phase 01 Spike, Cycle 3 (final)

Reviewer: EvcCodeReviewerPhase01Cycle3 | Verdict: **NOT APPROVED — Phase 02 NOT unblocked** | Score: **4/10** (cycle 2: 5/10)

Cycle 3 fixed G7 mechanics (pre-recorded PIDs, non-empty forced-tree list, SIGTERM→SIGKILL), watchdog now runs cleanup. Rest of cycle-2 criticals unresolved; G5 "fence" regressed to a tautology; reports still carry claims no run produced.

## Critical issues

1. **Plan gating still violated.** Plan: all gates pass before Phase 02. Ledger: G8=STOP + "Option A (Approved Plan Exception)" → proceed 02–06. No approval evidence anywhere; `plan.md` / phase-01 file still "Pending 0%", todos unchecked, phase text says G8 STOP = "Halt … explicit replan". Ledger header "G0–G7 GO" overstates (see 2–6). Only plan owner/user can grant exception; ledger can't self-approve.
2. **G5 GO is unsupported — test is tautological.** `spike-lsp-test.mjs:361-385`: `gatewayModelVersion=2`, `clientReqVersion=1`, `if (1 !== 2) forwardedResult = null; assert(forwardedResult === null)`. Two local constants; no gateway, no child result discarded, no incarnation/generation, no concurrent-edit race, no destination content association. Unopened-destination test only shows disk resolution (plan: that alone ≠ proof). Report `phase-01-sync-version.md` §3 + ledger claim "active stale version fence … verified". FIFO claim = sleeps+await, not ordering proof.
3. **G6 still non-falsifiable.** Unchanged from cycle 2: positive control = `node -e require(plugin)` (proves a file write, not tsserver loading); plugin referenced as `./malicious-plugin.js` relative name (tsserver resolves plugins from node_modules/`pluginProbeLocations`, so canary stays absent even unsuppressed); `tsserver.path` explicit so decoy can't win; hostile spawn sets `NODE_OPTIONS:""`/`NODE_PATH:""` (empty, never poisoned), no `LD_PRELOAD`/loader vector; harness sends only `didOpen` and asserts no response → never proves project actually loaded. Report claims "zero socket connections or DNS lookups" and "env sanitization verified" — nothing measures either. Report fixture strings (`PWNED AT`, `DECOY_TSSERVER_EXECUTED.txt`) ≠ harness (`CANARY FIRED`, `DECOY_FIRED.txt`).
4. **G2 / perf provenance missing.** `grep vscode-ws-jsonrpc|vscode-jsonrpc` in `pnpm-lock.yaml`, `packages/ui/package.json` = 0 hits (repo clean except untracked plan/script). No build with the transport was ever run, yet ledger says "verified via real `pnpm build` (+14.2 KiB gzip)", transport report states +47 KiB/+14.2 KiB/"0 bytes initial". Perf md itself calls it "Estimated". Transport versions given as "3.5.0 (or 4.0.3)", "8.2.1 (or 9.0.3)" — not an exact pin. G2 should be NOT RUN/PARTIAL.
5. **G7 GO overstated; process-tree report contains fabricated detail.** (a) `phase-01-process-tree.md` §2 lists `…/tsserver-helper/typingsWorker.js` (PIDs 926710/926711); harness prints PIDs only, never names, and TS 5.9.3 `lib/` has no such file (`find` → only `typingsInstaller.js`). (b) `getDescendants` = `pgrep -P` (direct children only): depth-2 not covered. (c) "zero zombies in OS process table" — no check in harness (`kill(pid,0)` succeeds on zombies only for non-reparented; no `/proc/<pid>/stat` state test, no `kill(-pgid,0)` ESRCH check). (d) Plan-required crash/hung-parent/SIGKILL-parent-only/SIGSTOP/daemon-death/escape-reparenting scenarios untested; report §4 table is design prose labelled "Implemented Defense". (e) Observed now: 2 direct children [partialSemantic+full tsserver] — report tree shows different shape.
6. **G1 contradictions.** Tuple says Node `v24.16.0 (LTS candidate v22.14.0)` — not a single pin; 22.14.0 < TSLS 6.0.2 `engines.node >=22.22.2` (verified in `/tmp/.../typescript-language-server/package.json`). Ledger claims "satisfying `engines.node >= 22.22.2`" but repo `package.json:46` is `">=20"`; no reconciliation. SHA-256 `b2959781…cbcd` = the local nvm binary (verified: matches `~/.nvm/.../v24.16.0/bin/node`), not checked against official SHASUMS256.txt. "Pinned in root `pnpm-lock.yaml`" false: tuple exists only in untracked `/tmp/dam-hopper-spike-tuple` (+ its own lock); harness not reproducible from repo. Tuple report says `--tsserver-path=` CLI arg; harness uses `initializationOptions.tsserver.path` → production invocation untested. No `deploy/release` change; "integration verified" is prose.

## Warnings

- **Security (harness):** hard-coded `/tmp/dam-hopper-spike-tuple` (predictable, world-writable parent) executed as code (`node …/cli.mjs`, tsserver.js). Local user could pre-plant. Use repo-owned dir / `mkdtemp` 0700 + owner check, or lockfile-verified install. `execSync("node -e 'require(\"${pluginScript}\")'")` = shell interpolation + PATH `node`, contradicting "no PATH" principle; use `spawnSync(process.execPath,…)`.
- `NODE_BIN = process.execPath` = whatever runs the script, not the pinned tuple/bundled Node; no version/hash assertion → G1 not tied to harness. Tests 1/2 pass `PATH: process.env.PATH`; plan: minimal explicit env.
- Harness writes into `plans/…/reports/phase-01-performance-baseline.json` via absolute `/home/loidinh/WS/worktrees/…` path: non-portable, side-effecting; re-run overwrote JSON with new value (restored by me). `metrics.counts` hard-coded (6/5/1), `memory` `{}` (no RSS ever measured; plan G-step 9 requires CPU/RSS).
- Perf numbers inconsistent/unsourced: handshake 66.98 ms (md/protocol report) vs 69.48 ms (committed JSON) vs 64.92 ms (my run). "~600 ms graceful shutdown / forced escalation / threshold crossing" = fixed `setTimeout` sleeps (600/600/…), not measurements; "~22 ms unopened lookup" not recorded in JSON.
- No SIGINT/SIGTERM/`uncaughtException` handler: Ctrl-C leaves detached PGIDs + temp dirs. `_onData` throws on bad header inside event handler (bypasses `finally`). No 8 KiB header / 4 MiB body cap in framing reader although G0 declares them; stderr discarded (`on("data",()=>{})`), startup failures invisible.
- `serverRequests` collected, never asserted/printed; unknown server requests auto-replied `null` (fail-open) — G3 needs a request inventory and fail on unexpected. Config reply `{}` per item leaves TSLS defaults unspecified; report shows `[{}]` and `[{},{}]` in different places; "Observed" initialize result in report is abridged/hand-written.
- Fixed sleeps (300–800 ms) instead of event waits → flake under load; `kill(pid,0)` PID-reuse risk.
- **G4 assertions weak:** expanded-symbol and post-edit-large checks only `length>0` (self-declaration returns non-empty for stale or fresh text); astral test queries col 53 of a 12-char identifier at 51–63 → any of UTF-16/code-point/UTF-8 interpretations land inside identifier (1 astral = 1-unit shift) → not discriminating; no ranged-vs-full result equality; no ranged edit after a non-BMP char on same line; no exact 65535/65536/65537 boundary; no didClose/reopen replay with stale-version assertion. Report text (`astralVal`, query col 50) ≠ harness (`astralTarget`, col 53).
- Wire examples in reports use `dam-hopper://semantic/...` URIs; harness only uses `file://` — URI mapping untested.
- G8 Candidate A depends on global `typescriptDefaults.setModeConfiguration({definitions:false})` + delegation — the plan's explicit STOP condition ("global collateral effects"). [INFERENCE, unverified: Monaco TS mode config may have no `implementations` key; confirm in Phase 07 spike.]
- Policy doc inconsistencies: shutdown budget G0 (2 s + 3 s) vs G7 (1.5 s RPC + 1 s SIGTERM + …); G0 claims `tempfile::TempDir` / Rust enforcement but harness is Node `mkdtemp`; corpus sizes (5/4/6 files) not matched to harness; 8-process trigger and 2 h aggregate not exercised; G0 omits cgroup/transient-copy rows from plan table. `PR_SET_PDEATHSIG` is per-thread (Tokio multi-thread hazard) — flag for Phase 02.
- Reports use templated "PASSED / READY FOR Gn" checklists and "Advisor guidance" as authority instead of command recipe + digests + reviewer disposition. Plan says delete disposable harness after extraction; ledger says "preserved" while it hard-depends on `/tmp`.

## Suggestions

1. Re-label ledger honestly: G0 GO (policy), G3 GO (real), G1 PARTIAL, G2 NOT RUN, G4 PARTIAL, G5 NOT-GO, G6 NOT-GO, G7 PARTIAL, G8 STOP → Phase 01 = NOT ALL-GO; plan owner decides explicit reconciliation. Update phase/plan status lines accordingly.
2. G5: implement real stub gateway (or at least real child race): issue definition, apply didChange before response, assert gateway drops it; include open-incarnation/generation + destination-content check.
3. G6: put canary plugin in resolvable `node_modules` + `allowLocalPluginLoads`/`pluginProbeLocations` so it fires unsuppressed through TSLS (real positive control), then suppressed; poison parent `NODE_OPTIONS=--require canary`, `LD_PRELOAD`; assert a definition response from hostile project; measure network via `strace -f -e connect` or netns.
4. G7: record tree recursively (`/proc/*/stat` ppid walk or `pgrep -g PGID`) with names from `/proc/<pid>/cmdline`; assert `kill(-pgid,0)` ESRCH and no `Z` states; add SIGKILL-TSLS-only, SIGSTOP hang, harness-death cases.
5. G1/G2: commit lockfile/recipe + SHASUMS-verified Node ≥22.22.2 (or 24.x) single pin; add transport dep on a throwaway branch, run `pnpm build`, commit raw chunk sizes; else delete numbers.
6. Perf: emit all metrics (N≥5 runs, tree RSS) into JSON from harness; stop hand-typed numbers; remove sleep-derived "latencies".
7. Harness: repo-relative output path, `spawnSync(process.execPath…)`, signal handlers, try/catch parse, stderr ring, assert expected tuple versions/hash at start, event-driven waits.

## Positive observations

- G3 real handshake (Incremental=2, definition/implementation providers) reproducible.
- G8 honestly STOP; no fake browser claim.
- G7 harness now discriminating on graceful path (non-empty pre-recorded list asserted; survivors counted); forced test no longer vacuous.
- Watchdog now calls `cleanupAll()` before exit; try/finally, detached PGID, temp-dir tracking.
- G0 policy table has 20 concrete finite limits recorded before execution.
- No tracked repo files modified; no residual processes/temp dirs after run.

## Validation

| Command | Result |
|---|---|
| `node scripts/spike-lsp-test.mjs` (Node v24.16.0) | exit 0, ~6.0 s; PASS G3/G4/G5/G6/G7, G8 STOP; handshake 64.92 ms (JSON restored to committed 69.48 ms afterwards) |
| `pgrep -af 'tsserver\|typescript-language-server'`; `ls /tmp \| grep lsp-test` after run | none |
| `sha256sum node` | matches reported digest (local nvm binary; no official SHASUMS check) |
| TSLS `engines.node` | `>=22.22.2`; repo `package.json:46` `>=20` |
| grep transport pair in `pnpm-lock.yaml`/`packages/ui/package.json` | 0 hits |
| `find typescript/lib -name 'typings*'` | only `typingsInstaller.js` (no `typingsWorker.js`) |
| `git status --short` | only untracked plans/reports + `scripts/spike-lsp-test.mjs` |
| Not run: cargo/pnpm tests, lint, browser (out of scope, spike is Node-only) |

## Metrics

Gate coverage by discriminating harness assertions: G3 ~100%, G4 ~50%, G5 ~0% (tautology), G6 ~20%, G7 ~50%, G0/G1/G2 0% executable, G8 0% (STOP). Type/lint: n/a (.mjs, not linted).

## Unresolved questions

1. Is deferring G8 to Phases 07/10 (Option A) an approved plan change? Who approves?
2. Which single Node pin satisfies TSLS `>=22.22.2` and repo engines policy; what is its official SHASUMS256 digest?
3. Does `--tsserver-path` or `initializationOptions.tsserver.path` govern selection in production (confirm via `/proc/<pid>/cmdline`)?
4. Provenance of `+14.2 KiB/+47 KiB` and tree shape/`typingsWorker.js` — any uncommitted run? If so commit raw output.
5. Which tsserver plugin resolution path makes a canary fire unsuppressed through TSLS?
6. Does Monaco's built-in TS mode config cover Implementation (affects G8 scope)?
