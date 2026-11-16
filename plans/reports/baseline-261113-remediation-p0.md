# Remediation P0 baseline (2026-11-13, before any T1+ edit)

Machine: Linux 6.12.107 (needs >=6.9), Chromium 156.0.8078.79 at /usr/bin/chromium. Node 24.22.3 via nvm (Node 26 causes 48 false UI failures: use 24).

## Commands (use exactly)
```bash
# Rust (cwd server/)
export DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium
cargo test --features vendored --test browser_host_<suite> ...      # vendored: no pkg-config/libssl-dev here; never commit it as default
# UI unit (cwd packages/ui)
N=~/.nvm/versions/node/v24.22.3/bin; PATH=$N:$PATH pnpm exec vitest run [files]
# UI browser mode (cwd packages/ui)
PATH=$N:$PATH pnpm exec vitest run --config vitest.browser.config.ts browser-tests/<file>
```

## Baseline results
| Surface | Result |
|---|---|
| Rust browser_host_* (16 suites) | all pass: adapter 18, admission 24, auth 10, bounds 6, compat 2, gateway 16, input 9, lifecycle 22, logout 12, media 20, platform 6, process 27(+1 helper), screencast 20, security 7, selection 21, shutdown 4 |
| UI unit (Node 24, full) | 3939 passed, 0 failed (1119 suites) |
| UI browser: host-browser-{lifecycle,input,decoder,android,logout,selection}, os-lifecycle, browser-tools-quality-keyboard | 50/50 pass after fixing stale oracle in host-browser-decoder (mock WS counted Phase 04 quality/mute status sends; now counts frameAck/frameDiscarded only). Before fix: 3 failures (pre-existing from Phase 04) |
| Known flaky | Phase 01 notes one geometry test flaky; record if it appears, rerun isolated, do not retry into green |
