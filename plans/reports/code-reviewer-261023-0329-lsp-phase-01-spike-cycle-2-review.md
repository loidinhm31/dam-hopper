# Code Review — LSP Phase 01 Spike, Cycle 2

Reviewer: EvcCodeReviewerPhase01Cycle2 | Verdict: **NOT APPROVED — Phase 02 NOT unblocked** | Score: **5/10** (up from 3/10)

Improved vs cycle 1: G8 honestly STOP; harness has try/finally + PGID kill + watchdog; ranged edit, empty doc, same-line astral, unopened-destination tests added. But the G0–G7 "GO" ledger still outruns the evidence, and several reports contain numbers/claims no run produced.

## Critical issues

1. **Ledger violates plan gating.** Plan: "Every gate must pass before Phase 02"; failed gate = explicit replan. `phase-01-gate-disposition.md` has G8=STOP yet says "Phases 02–06 can proceed" and tester says "formally transition to Phase 02". `plan.md`/phase file still "Pending 0%", todos unchecked. G8 STOP is honest but is a blocker, not a deferral; deferring G8 to Phase 07/10 needs explicit plan reconciliation (user/plan-owner decision), not a ledger edit. Also unresolved: plan says G8 STOP if Monaco controls need global disable — report's Candidate A relies on global `setModeConfiguration` (the STOP condition).
2. **Performance baseline unsourced / fabricated.** Harness records `metrics` (handshake ms, RSS) but never prints/writes them (`runHardenedTests()` return value discarded). No script does 5-sample loops, per-op latencies (14/12/18/22/38/500 ms), tree RSS (104/136 MiB), or tsserver RSS. Tester measured handshake 63.6 ms; report says 73.4 ms. Report claims "real `pnpm build`" sizes, but no build is shown and no transport dep exists in repo (`grep vscode-ws-jsonrpc|vscode-jsonrpc` = 0 in `pnpm-lock.yaml`, `packages/ui/package.json`, `apps/web/package.json`). Same for G2 "+14.2 KiB gzip / +47 KiB / initial chunk 0 bytes" — never measured. Plan rule: no unmeasured claims.
3. **G7 graceful check is non-discriminating.** `getDescendants(proc1.pid)` after TSLS exit uses `pgrep -P <dead pid>`; orphans reparent to init/subreaper, so result is always 0 even if tsserver leaked. Must walk by PGID/session or record child pids before and test liveness.
4. **G7 forced test is vacuous.** Harness output (re-run): `Forced Child PID …, Descendants: []`; `aliveDesc===0` over an empty list. TSLS pid itself not checked; no crash/SIGKILL-parent-only, SIGSTOP/hung, daemon-death/reparenting/escape test, no uncooperative child. Report claims all of these + "0 zombies" (no zombie check in harness). Plan G7 requires them.
5. **G7 report facts contradict observation.** Report shows descendant `typingsWorker.js` (PIDs 926710/926711, not from harness output). Reviewer /proc probe (same tuple): TSLS has exactly two direct children, both `tsserver.js` (`--serverMode partialSemantic` and full), no typings worker. Without `disableAutomaticTypingAcquisition:true` the full-mode tsserver spawned a grandchild (observed, depth 2), so (a) direct-child-only `pgrep -P` misses depth, (b) ATA flag propagation matters and is untested by G6/G7.
6. **G6 still non-falsifiable.** Positive control = `node -e require(plugin)` (proves file write only). `plugins:[{name:"./malicious-plugin.js"}]` relative name is never resolved by tsserver (plugins load from node_modules / `pluginProbeLocations`), so canary also stays absent *unsuppressed* (cycle-1 probe: 0/3 variants fired, incl. baseline). Decoy tsserver can never win when `tsserver.path` is explicit. Not covered: Node preload/`NODE_OPTIONS=--require`/`LD_PRELOAD` poisoned in the *parent* env (hostile spawn sets `NODE_OPTIONS:""` — empty, never poisoned), ATA/network (report claims "zero sockets/DNS", unmeasured), `--allowLocalPluginLoads`. Report fixture text (`PWNED AT`, `DECOY_TSSERVER_EXECUTED.txt`) doesn't match harness (`CANARY FIRED`, `DECOY_FIRED.txt`). Tester admits "unsuppressed positive control missing".
7. **G5 GO unsupported.** Harness "fencing" is a literal field deletion before `request` — no stale-result rejection, no incarnation/generation, no concurrent edit race, no destination-content association. Unopened-destination test only shows the disk file resolves (plan: "freshly authorized/readable destination alone does not prove" match). Report claims `damHopperDocumentVersion` fencing "verified". Tester: G5 ~40%, "stale cache rejection not covered".
8. **G4 assertions too weak to discriminate.**
   - Empty-doc: reopened text `export const reopened…` and edit text `fromEmpty` both cover col 15 — either content yields a definition; only `length>0` asserted.
   - Astral test: second `astralVal` at UTF-16 cols 48–56; query col 50 sits inside it under UTF-16 (48), code-point (49) and UTF-8 (50) interpretations. Doesn't prove UTF-16. Query at last char or use many preceding astral chars.
   - Threshold-shrink assertion: definition on a self-declaration returns non-empty on stale or fresh text; assert returned range/line.
   - Never compares ranged vs full results for same doc; no replay/resync; no non-BMP edit range.
9. **G1 provenance/layout not substantiated.** (a) "LTS candidate `v22.14.0`" conflicts with TSLS 6.0.2 `engines.node >=22.22.2` (cycle-1 finding, unresolved). (b) Node SHA-256 is of the local nvm binary, no nodejs.org SHASUMS check. (c) "Pinned in root `pnpm-lock.yaml`" false; tuple only in untracked `/tmp/dam-hopper-spike-tuple`, no recipe/lock in repo → harness not reproducible. (d) Report says `--tsserver-path` CLI arg; harness uses `initializationOptions.tsserver.path`; which governs unproven. (e) "zero external runtime deps" vs lock listing `vscode-jsonrpc`. (f) Release integration is prose only; no `deploy/release` change.

## Warnings

- Watchdog timer calls `process.exit(124)` → skips `finally`, leaks detached PGIDs (children survive harness). Also no SIGINT/SIGTERM handler.
- `getDescendants` = `execSync` shell `pgrep -P ${pid}`; positive-control `execSync("node -e …${path}")` uses PATH `node` + shell interpolation (contradicts "no PATH node" principle).
- Test 1/2 spawn env passes `process.env.PATH`; stderr dropped (`on("data",()=>{})`) → startup failures invisible, 64 KiB cap untested.
- `_onData` throws in event handler (uncaught crash path, not caught by try/finally); no 8 KiB header / 4 MiB body caps modelled.
- Fixed `setTimeout` sleeps (300–800 ms) instead of event-driven waits → flaky under load; `kill(pid,0)` PID-reuse risk.
- `serverRequests` collected, never asserted/printed; unknown server requests auto-replied `null` (fail-open); G3 requires full request inventory. Config reply `[{},{}]` leaves TSLS defaults unspecified; report example capabilities abridged but labelled "Observed"; report shows `[{}]` in one place, `[{}, {}]` in another.
- Policy docs: shutdown budget inconsistent (G0 2s+3s vs G7 1.5s+1s+…); `PR_SET_PDEATHSIG` is per-thread (Tokio multi-thread hazard) — flag for Phase 02; G0 omits cgroup/transient-copy/aggregate rows; "tempfile::TempDir" claimed, harness uses `mkdtemp`.
- Reports cite "Advisor guidance" as authority; not evidence. Templated "PASSED / READY FOR Gn" checklists substitute for command recipe + digests + reviewer disposition.
- Plan says delete disposable harness after extraction; ledger says "preserved" while it hard-depends on `/tmp/...`.
- `execSync` import, `readFileSync` of `/proc/<pid>/statm` (RSS of one process only; tree RSS claimed).

## Suggestions

1. Keep ledger honest: G0 GO(policy doc), G3 GO (real), G1 PARTIAL, G2 NOT RUN, G4 PARTIAL, G5 NOT-GO, G6 NOT-GO (non-falsifiable), G7 PARTIAL, G8 STOP. Plan-owner decides whether to proceed with Phase 02 under explicit reconciliation.
2. Delete or re-measure perf/G2 numbers: add harness JSON output (N runs, `/proc` tree RSS), or mark "not measured".
3. G7: record full tree (recursive `/proc/*/stat` ppid walk or `pgrep -g PGID`) *before* signals; test SIGKILL TSLS-only (tsserver orphan), SIGSTOP hang, harness-death with PGID cleanup; assert PGID empty via `kill(-pgid,0)` ESRCH.
4. G6: put plugin in a resolvable location with `pluginProbeLocations`/`--allowLocalPluginLoads` so canary fires unsuppressed through TSLS, then suppressed; poison parent `NODE_OPTIONS=--require canary.js` and `LD_PRELOAD`; measure network with `strace -f -e connect` or netns.
5. G4/G5: assert exact returned ranges/URIs; distinct text across reopen; astral chars before query on same line; run same doc via ranged vs full and diff results; add a real gateway-stub version-fence test.
6. G1: commit lock/recipe, verify Node via SHASUMS256.txt, pick Node ≥22.22.2 or 24.x, confirm `--tsserver-path` vs init option via `/proc/<pid>/cmdline` (observed: tsserver cmdline shows `--serverMode partialSemantic`/full pair).
7. Harness: `spawnSync(process.execPath…)`, kill PGIDs in watchdog before exit, catch parse errors, capture stderr ring.

## Positive observations

- G8 flipped to honest STOP; no false browser claim.
- Re-run PASS, exit 0, 5.4 s; no residual tsserver/TSLS processes or `lsp-test-*` dirs afterwards.
- G3 handshake, Incremental (2) advertisement, definition/implementation providers real and reproducible.
- try/finally cleanup + PGID kill + `detached` spawn are now present; policy table has 20 concrete finite limits.
- `disableAutomaticTypingAcquisition:true` observed to remove ATA grandchild — useful hardening fact (reviewer probe).
- No tracked repo files modified.

## Validation

| Command | Result |
|---|---|
| `node scripts/spike-lsp-test.mjs` (Node v24.16.0) | exit 0, 5.41 s; PASS G3/G4/G5/G6/G7, G8 STOP; cleanup ok |
| `pgrep -af 'tsserver\|typescript-language-server'`, `ls /tmp \| grep lsp-test` after run | none |
| Reviewer /proc probe (deleted): TSLS child tree | 2× tsserver (partialSemantic + full); with ATA not disabled full tsserver had a grandchild; none after SIGKILL PGID |
| `grep` transport pair in lock/ui/web package.json | 0 matches (dep never added) |
| astral offset check | second `astralVal` UTF-16 start 48, UTF-8 byte start 50; query col 50 inside identifier under all interpretations |
| Not run: cargo/pnpm tests, lint (tester report: Rust 1464 pass, UI 3134 pass; unrelated to spike) |

## Metrics
Type coverage n/a (.mjs, no lint run). Gate coverage by harness (discriminating assertions): G3 ~100%, G4 ~50%, G5 ~15%, G6 ~20%, G7 ~30%, G0/G1/G2 0% executable, G8 0% (STOP).

## Unresolved questions
1. Is deferring G8 to Phases 07/10 an approved plan change? Plan says all-GO before Phase 02 and treats G8-STOP as replan.
2. Provenance of perf/G2 numbers — was an uncommitted measurement run done? If yes, commit raw output.
3. Which Node pin satisfies TSLS `engines` (≥22.22.2) and what is its official digest?
4. Does `--tsserver-path` or `initializationOptions.tsserver.path` govern selection (confirm via grandchild cmdline)?
5. Which tsserver plugin-resolution path can make a canary fire unsuppressed through TSLS (falsifiable G6 control)?
