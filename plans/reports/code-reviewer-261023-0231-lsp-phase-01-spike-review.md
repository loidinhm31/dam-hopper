# Code Review — LSP Server Integration, Phase 01 (spike + gate artifacts)

Date: 2026-10-23 | Reviewer: EvcCodeReviewerPhase01 | Verdict: **NOT APPROVED — gate GO ledger not supported by evidence**

## Score: 3/10

Real-process G3/G7-graceful/partial G4 evidence is genuine and reproducible (harness re-run PASS). Remaining G-claims are asserted, untested, or contradict plan acceptance criteria. "ALL GATES GO" is premature.

## Critical issues

1. **G8 declared GO with zero browser execution.** `phase-01-web-navigation.md` is "architecturally qualified" (design + hand-written table; "Observed Behavior" column has no source run). Plan G8/step 8 require authenticated actual web app, fresh captures, human review, dirty-model/reconnect proof. None exist; tester report itself says G8 not exercised. Proposed fix also uses global `typescriptDefaults.setModeConfiguration({definitions:false,implementations:false})` — the exact global-collateral approach plan Success Criteria call STOP. JS defaults (`javascriptDefaults`) not addressed. Model URI (`<profileId>/<targetId>/path`) differs from frozen `dam-hopper://semantic/<session-target-id>/...`.
2. **G5 declared GO without testing.** Script never sends `damHopperDocumentVersion`, no stale-result rejection, no incarnation/generation, no unopened-destination test. "mtime/hash matches server cache" (report §3.4) is a proposal and is explicitly insufficient per plan (readable/authorized destination ≠ range matches content). G5 = unproven.
3. **G4 largely untested.** Script only sends range-less full `didChange` on a small doc; big doc is a plain `didOpen` (never an edit). No ranged incremental event, no crossing up/down, no empty doc, close/reopen/replay. Unicode check is weak: emoji on line 0, query on line 2 → never exercises UTF-16 offsets within a line containing non-BMP. Report claims "tested both directions" — false.
4. **G6 non-falsifiable.** Positive control is `node -e require(plugin)` — proves file write works, not that tsserver would load the plugin. Reviewer probe (TSLS 6.0.2/TS 5.9.3, local plugin at `node_modules/hostile-plugin`, tsconfig `plugins:[{name}]`): canary **not** fired even with NO suppression (`plugins:[]` absent). Harness fixture uses absolute-path plugin name + decoy tsserver with `tsserver.path` set → would pass unsuppressed too. Also not covered: Node preload/loader/`NODE_OPTIONS` inherited, ATA network (claimed "zero sockets/DNS" — never measured), `--allowLocalPluginLoads`/global plugin path. Plan demands sentinels that detect execution in the same path.
5. **G7 only graceful path tested; report claims crash/hung/forced.** Harness has no `setpgid`, no SIGTERM/SIGKILL, no parent-death test, no reparenting/escape characterization. Report asserts "PGID = TSLS PID", `PR_SET_PDEATHSIG`, "Stdio saturation and blocked consumer defenses verified" — nothing run. Descendant "typingsWorker.js" PID 138988 is unsubstantiated (harness only counts `pgrep -P`; observed 2 direct children, names never captured; ATA disabled → typings worker implausible). Process ids in report (138920/138963…) not from harness output.
6. **Performance baseline fabricated/unsourced.** No script measures p50/p95, sample counts (10/50), RSS/CPU, payload sizes. Harness runs once (4.5s). Numbers (340ms, 124 MiB, 52%…) cannot be traced. G2 "+47 KiB / +14.2 KiB gzip" likewise: no Vite build, no dependency added to `packages/ui` (0 refs to vscode-ws-jsonrpc/jsonrpc in `pnpm-lock.yaml`/`packages/ui/package.json`). Fabricated evidence violates plan rules ("raw evidence…without claiming unmeasured ceilings").
7. **G1 pins inconsistent/unsound.** (a) Report says "LTS candidate v22.14.0" but locked TSLS 6.0.2 `engines.node >=22.22.2` (spike `pnpm-lock.yaml`) → v22.14.0 invalid. (b) Node SHA-256 `b2959781…` is hash of local nvm binary (`sha256sum` confirmed), not checked against nodejs.org SHASUMS; no provenance. (c) "Pinned in root pnpm-lock.yaml" false: repo lock has none of these packages; tuple lives only in `/tmp/dam-hopper-spike-tuple` (ephemeral, untracked). (d) No release-script integration done (no `semantic-engine` in `deploy/release`; `assignRoles` change is prose). (e) TSLS "zero external runtime deps" vs spike lock snapshot listing `vscode-jsonrpc: 5.0.1` — unresolved; transitive licenses unverified. G2 lists alternate versions ("3.5.0 or 4.0.3 / 8.2.1 or 9.0.3") — not pinned; only 3.5.0/8.2.1 exist in tuple.
8. **G0 not enforced.** Policy claims watchdog (15 min), corpus ceilings (<50/120/30 KiB, 5/4/6 files), `tempfile::TempDir`, PGID isolation, tree poller. Harness: no watchdog, plain `mkdtemp`, corpus differs (3–4 tiny files; hostile uses ~4 files), no `try/finally`: any assertion failure leaks TSLS+tsserver processes and temp dirs.

## Warnings

- **Gate ledger vs plan state**: `plan.md` and phase file still "Pending 0%", todos unchecked, `Next steps` says "documentation revision only". Ledger says "100% COMPLETE & VERIFIED" and "temporary workspaces deleted" — plan requires deleting disposable harness (`scripts/spike-lsp-test.mjs` still present/untracked) after extraction, retaining reproducible fixture recipe. `scripts/` hardcodes `/tmp/dam-hopper-spike-tuple` with no recipe to rebuild it (no lock/tarball in repo) → not reproducible by reviewers.
- Harness security/robustness:
  - `execSync(\`node -e 'require("${path}")'\`)` – PATH `node`, shell interpolation of path; contradicts "no PATH node" principle (harmless in spike but copy-paste hazard). Use `spawnSync(process.execPath, [...])`.
  - Test 1 spawn env passes full `process.env.PATH`; only hostile run uses `/usr/bin:/bin`. Env sanitation (LD_PRELOAD, NODE_OPTIONS, NODE_PATH) not checked against *inherited* values in the parent (tester shell may have none).
  - Stderr silently dropped (commented log) → protocol/startup failures invisible; no 64 KiB cap tested.
  - Header parser throws inside `data` handler (uncaught); no body/header size caps (policy: 8 KiB/4 MiB) → harness doesn't model those bounds.
  - Fixed `setTimeout` sleeps (600/400/800/1200 ms) → flaky on loaded hosts; PID reuse possible in `kill(pid,0)` liveness checks; `pgrep -P` shows only direct children, not full tree (G7 requires complete tree).
  - Hostile "auto-reply `null` to unknown server requests" is a fail-open default; production must reject (report itself says unknown requests never cross).
  - `client/registerCapability`, `window/workDoneProgress/create`, etc. replied with `null` — G3 requires recording *every* server request; harness collects `serverRequests` but never prints/asserts them. Report lists only `workspace/configuration` — completeness unverified.
  - G3 report example `initialize` response lists only 7 capabilities; the real response contains more; presented JSON is abridged but labeled "Observed". Config reply `[{},{}]` vs "server-owned fixed config" — empty objects leave TSLS defaults (inlay hints, plugins, preferences) unspecified.
  - Report says tsserver path via `--tsserver-path` CLI (G1) but harness uses `initializationOptions.tsserver.path`; which one governs is unproven (G3 requires actual tsserver selection evidence, e.g. `/proc/<pid>/cmdline` of the grandchild).
- `PR_SET_PDEATHSIG` fires on death of the *spawning thread*, not process; with Tokio multi-thread runtime this can kill the child early. Plan Phase 02 must spawn from a dedicated long-lived thread or use another daemon-death mechanism. `libc::waitpid(-1, …)` in G7 text would steal other children's statuses in a Tokio daemon — must target the known pid/pgid only.
- Plan G0 vs report G0: policy table drops "bounded transient edit copies", "2h aggregate", and cgroup candidate (768 MiB/50%/16 tasks) rows; "all 20 dimensions" count unsubstantiated. Sync: policy says full below 64 KiB / incremental at/above; sync report flips fine, but there's no spec for `rangeLength`/deprecated field handling.
- Process-tree report: shutdown budget inconsistent (G0: 2s+3s; G7: 1.5s shutdown RPC + 1s SIGTERM + …).
- Reports claim "Advisor consultation guidance" as authority; advisor input is not evidence.
- 8 near-duplicate templated report headers/checklists ("PASSED / READY FOR GN"): checkbox ceremony substitutes for evidence; no command/fixture recipe, version digests per run, or reviewer disposition as plan requires per gate.

## Suggestions

1. Re-open G4–G8 (+ G6 fixture, G7 forced/crash) as NOT-GO; keep G3 (real) and partial G1/G7-graceful as evidence. Do not unblock Phase 02 until fixed.
2. Harness: wrap in `try/finally` with process-group kill (`detached:true` + `process.kill(-pid)`), global 15-min `setTimeout(...).unref` watchdog, `spawnSync(process.execPath…)`, event-driven waits (diagnostics/response) instead of sleeps, recursive `/proc` tree walk, assert serverRequests whitelist, print capabilities and serverRequests.
3. G4: add ranged incremental tests (same doc via both representations → identical definition results), crossing up/down with edits, empty doc, close/reopen/replay, non-BMP before the queried column on the same line.
4. G6: make controls falsifiable — place plugin where tsserver does resolve (`node_modules` + `--allowLocalPluginLoads`/`globalPlugins`) and demonstrate canary fires without suppression and not with it; add `NODE_OPTIONS=--require`/`LD_PRELOAD` parent-env poison test; verify ATA via `strace -f -e connect` or network namespace.
5. G7: SIGKILL TSLS while tsserver alive; hung parent (SIGSTOP); measure orphans after daemon kill; record process-group/session behavior.
6. G2/perf: actually add pinned deps in a throwaway branch, run `vite build`, record gzip chunk sizes; run a measurement script (N runs, `/proc` sampling) and commit raw JSON.
7. G1: pull Node tarball + `SHASUMS256.txt` verification; choose Node ≥22.22.2 or 24.x LTS and drop "LTS candidate 22.14.0"; commit a lockfile/recipe under `plans/…/reports/` so tuple is reproducible; confirm TSLS deps/licenses via `pnpm licenses list`.
8. G8: run the actual app with a throwaway provider, capture screenshots, test model-scoped suppression without global `setModeConfiguration` (or record STOP and replan); include `javascriptDefaults`.
9. After fixes, update phase todos/plan status; delete `scripts/spike-lsp-test.mjs` after extraction to Phase 02 per plan.

## Positive observations

- Harness (re-run): real TSLS 6.0.2 handshake, `textDocumentSync: 2` confirmed, definition/implementation results correct, `didChange` full replacement under Incremental accepted, graceful shutdown leaves no processes/temp dirs; runtime 4.5s bounded.
- Tuple integrity strings (TS 5.9.3, TSLS 6.0.2, vscode-ws-jsonrpc 3.5.0, vscode-jsonrpc 8.2.1) match `/tmp/dam-hopper-spike-tuple/pnpm-lock.yaml`; Apache-2.0/MIT licenses match installed `package.json`.
- Design intent (absolute paths, no PATH, forced `plugins:[]`, ATA off, bounded queues, model-scoped provider concept) is aligned with plan; no production code changed.

## Validation

| Command | Result |
|---|---|
| `node scripts/spike-lsp-test.mjs` (Node v24.16.0) | exit 0, 4.5s, G3/G4/G5/G6/G7 harness assertions PASS; no residual `lsp-test-*` dirs or tsserver/TSLS processes |
| `/tmp/review-g6-probe.mjs` (reviewer, deleted after run) | plugin canary fired in 0/3 variants, incl. unsuppressed baseline → G6 negative result is non-discriminating |
| `sha256sum $(command -v node)` | `b2959781…cbcd` = report digest (local nvm binary, not nodejs.org-verified) |
| `grep` repo for vscode-ws-jsonrpc/jsonrpc/typescript-language-server in `pnpm-lock.yaml`, `packages/ui/package.json` | 0 matches (claimed pin absent) |
| `git status --short` | only untracked: plan dir, brainstorm + tester reports, `scripts/spike-lsp-test.mjs`; no tracked edits |
| Not run (read-only review; no code changed): cargo/pnpm builds, lint, typecheck. Tester reports Rust 2015 pass, UI 3134 pass (unrelated to spike) |

## Metrics
- Type coverage: n/a (plain .mjs). Lint: not run on `scripts/spike-lsp-test.mjs`. Test coverage of Phase-01 gates by harness: G3 full, G4 ~30%, G5 ~0%, G6 weak, G7 graceful-only, G0/G1/G2/G8 0%.

## Unresolved questions
1. Is a reviewer-accepted "architecture-only" G8 intended? Plan says actual web + human review; current text conflicts.
2. Which Node pin: v24.16.0 vs v22.x (TSLS engines ≥22.22.2)? Official tarball digest source?
3. Does TSLS 6.0.2 actually accept `initializationOptions.tsserver.path` vs `--tsserver-path`; which wins, and is a tsserver grandchild cmdline confirmed?
4. Provenance of performance-baseline numbers: was a separate (uncommitted) measurement run done? If so, commit raw output.
5. Can `damHopperDocumentVersion` extension on Definition/Implementation survive `vscode-ws-jsonrpc` typed params (G2/G5 interplay)?
