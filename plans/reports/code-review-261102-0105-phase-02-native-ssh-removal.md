# Phase 02 P0a code review

## Verdict

**Score: 7/10 — changes required before acceptance.** Desktop/SSH deletion is broadly coherent; one retained Chromium suite still imports a deleted module. Cleanup incomplete in lockfile, browser-panel API and native profile identity helpers. No new critical security/data-loss issue identified.

Review only: no product/test/CI/plan edits, no checks rerun. Used published `code-review` skill and project development rules. Plan task status intentionally unchanged; coordinator owns tracking.

## Critical issues

None identified in inspected retained paths. This is not full application security certification.

## Warnings / findings

### H1 — Retained browser regression imports deleted context (high; merge blocker)

- Evidence: `packages/ui/browser-tests/app-zoom.browser.tsx:6` imports deleted `src/contexts/BrowserDebugHostContext.tsx`; lines 54–95 construct and mount its native adapter; lines 244–270 still assert native window-coordinate behavior.
- `packages/ui/vitest.browser.config.ts:416` includes this suite; `.github/workflows/pr-quality-gate.yml:99–100,253–256` runs and requires it.
- Impact: [INFERENCE] Vite cannot resolve the import, preventing this suite from loading and blocking the required Chromium gate. Unit tests and production typechecks do not cover it (`packages/ui/tsconfig.json:18–19`). Runtime failure not exercised by reviewer.
- Confidence: high; direct missing-module reference, not speculative product behavior.
- Correction: authorize this additional browser-test path, migrate geometry harness/assertions to the actual web iframe under app zoom. Preserve portal/responsive zoom tests. Do not restore native provider or skip/delete the whole suite. Phase02 explicitly requires checking all removed-export consumers and escalating unlisted owners (phase file lines 18–22).

### W1 — Desktop lock importer/dependencies remain (medium)

- Evidence: `pnpm-lock.yaml:54–104` retains `apps/native` importer with `@tauri-apps/api`, `plugin-notification`, `cli`; package records remain at lines 1365–1445 and snapshots at 4391 onward. Lockfile has no removal diff.
- Impact: incomplete `remove-native-build` requirement (phase file line 14), stale dependency graph and maintenance/audit noise. Not claiming a frozen-install failure or vulnerability without execution.
- Confidence: high.
- Correction: regenerate/prune workspace lockfile against retained packages; preserve unrelated dependency versions and existing patches. Generic `apps/*` workspace glob is still valid and need not change solely to manufacture a diff.

### W2 — Native-only Browser panel contract moved instead of removed (medium)

- Evidence: `BrowserDebugPanel.tsx:46–50,76,211,430–435` recreates native environment type/prop and unreachable native relay guidance. Sole production workspace caller no longer supplies environment (`WorkspacePage.tsx:1590–1596`). `BrowserDebugPanel.test.tsx:136–196` and `browser-tests/browser-debug-panel.browser.tsx:36–58,106–108` continue exercising native hosts.
- Impact: YAGNI/clean-cutover gap; unsupported host API and tests survive after deleting its only real host. New null checks at panel lines 418/423 are redundant with default environment at line 211.
- Confidence: high.
- Correction: remove native environment prop/type/copy and native permutations; keep existing real web viewport/extension/capture coverage. Obtain ownership extension for the two adjacent test files before edits.

### W3 — Native SSH profile identity subsystem now orphaned (medium)

- Evidence: `server-config.ts:17–18,459–637` retains native alias/tombstone persistence and six exported identity helpers; repository search across `packages`/`apps` found only `server-config.test.ts` consumers after native host/context deletion.
- Impact: roughly 180 lines of obsolete native persistence/exports remain in the shared web configuration module; needless maintenance surface and misleading native-store behavior.
- Confidence: high.
- Correction: remove orphan helpers/constants/types and native-only tests; retain UUID validation used by ordinary profile creation and all real profile/token isolation tests. No credential/store cleanup migration is needed or authorized.

### W4 — Browser/production acceptance not established (medium; evidence gap)

- Tester report explicitly excludes real-browser/E2E behavior (`plans/reports/tester-261102-0101-phase-02-p0a-test-suite.md:90`). Tester confirmed no build/lint/browser commands were executed in that validation pass; build/lint success comes from handoff context only.
- Phase02 lines 249–251 require browser-debug/login-device browser checks and Traditional agents/device-login production journeys. Full browser gate also matters because of H1.
- Correction: integration owner collects those gates after fixes, including app-zoom suite/full Chromium gate. Do not equate 3,093 jsdom tests with Chromium or production journey evidence.

## Suggestions

- Remove unused `BrowserDebugHost`/`BrowserDebugHostEvent` type imports in `BrowserDebugKeepAliveHost.test.tsx:10–13`; no remaining use. ESLint marks unused variables as warnings, not errors (`eslint.config.js:30`).
- Refresh nearby obsolete comments: `scripts/bump-version.mjs:4` still says 13 locations; `browser-debug-host.ts:71–74`, `browser-debug-keep-alive.ts:65–68`, `browser-debug-protocol.ts:10–13` still describe native adapters/WebViews. Preserve protocol types/functions actually used by iframe host; do not delete the web trust contract wholesale.
- Add a meaningful `/ssh-forwarding` deep-link regression asserting retirement guidance and no obsolete app mount; currently changed embed test only covers Cognito root behavior.
- README/PDR still advertise Tauri; intentionally deferred to Phase03 `document-removals` (phase03 lines 27–29), not a request to edit unrelated documentation in Phase02. Ensure required Tauri/SSH removal documentation lands before P0 publication.

## Security, performance and architecture assessment

- Web-only pruning does not change ordinary web profile URL/token selection. Connection generation/owner lifecycle remains in retained connection machinery.
- Iframe trust boundary retained: `BrowserDebugIframeHost.tsx:125–166,270–330` renews nonce/trust on navigation and parses messages through `browser-debug-protocol.ts:25–33` (source, origin, nonce, issued request ID). No new bypass identified.
- Terminal change removes only Windows native WebGL suppression; non-100% zoom disabling, visible-session gating, keyboard/focus policy remain (`TerminalKeepAliveHost.tsx:31–40,88–94`).
- Browser keep-alive now delegates to one iframe without native observer/listener branch; Cognito hiding remains. No avoidable new allocation/computation introduced by the meaningful changes.
- Deleted release workflow was desktop-only (`desktop-v*`, Tauri matrix). Retained Linux/server/Android workflow files untouched; retained Windows/server jobs still required. Root Android scripts and remote Git SSH retry consumers remain.
- Version manifest now processes eight non-lock files plus server Cargo.lock = nine locations; fixture expectations match. Alignment checker already references only server/web, so no native-pruning change required there.

## Reviewed files

All 29 modified text-file diffs reviewed; deletion inventory checked, not every removed implementation line audited (~48k removed lines).

- `.github/workflows/pr-quality-gate.yml`; deleted `.github/workflows/release.yml` content; `package.json`.
- `packages/ui/src/api/{connections,server-config,transport-utils}.ts` and their three `.test.ts` files.
- `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx` and `.test.tsx`; `BrowserDebugPanel.tsx`; `TerminalKeepAliveHost.tsx` and `.test.tsx`; `TopNavRouteMenu.tsx`; `login-devices-owner.ts`.
- `packages/ui/src/components/pages/WorkspacePage.tsx`; `packages/ui/src/embed/dam-hopper-app.tsx` and `.test.tsx`; `packages/ui/src/index.css`.
- `packages/ui/src/lib/browser-debug-host.ts`; `browser-debug-keep-alive.ts` and `.test.ts`; `navigation.ts` and `.test.ts`.
- `scripts/{bump-version,release-version-manifest,release-version-semver}.mjs`; `scripts/run-all-tests.sh`; `tests/deploy/bump-version.test.mjs`.
- Supporting: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `deploy/release/check-version-alignment.mjs`, UI package/typecheck/browser configurations, `BrowserDebugIframeHost.tsx`, `browser-debug-protocol.ts`, `BrowserDebugPanel.test.tsx`, `browser-tests/{app-zoom,browser-debug-panel}.browser.tsx`, retained Git SSH consumers, README/PDR/code standards, Phase02/03 and acceptance contracts, tester report.

## Validation commands / results

No build/test/lint executed by reviewer. Results below attributed to existing tester report, not independently rerun. Source inspection commands `git status --short`, `git diff --stat`, retained-file `git diff`, deleted-workflow `git show`, and specialized read/grep completed.

| Command | Recorded result |
|---|---|
| `node --test tests/deploy/bump-version.test.mjs` | Exit 0; 1 test, six sub-checks |
| `node deploy/release/check-version-alignment.mjs` | Exit 0; v0.15.5 server/web alignment |
| `pnpm --filter @dam-hopper/ui test -- <seven affected suites>` | Exit 0; CLI `--` caused full unit run: 330 files / 3,093 tests |
| `pnpm --filter @dam-hopper/ui test <seven affected suites>` | Report records exit 0; 7 files / 65 tests |
| `pnpm --filter @dam-hopper/shared test` | Exit 0; 6 tests |
| `pnpm --filter @dam-hopper/browser-bridge test` | Exit 0; 19 tests |
| `pnpm build`; `pnpm lint` | Handoff reports pass; no raw artifacts in tester pass |
| `pnpm --filter @dam-hopper/ui test:browser` / scoped browser checks | Not executed; H1 static blocker |
| `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- traditional-terminal-agents device-login-management` | Not executed |

Type/test coverage percentages and total lint counts not measured. Test report notes non-failing jsdom navigation and React act warnings.

## Unresolved questions

No product-design questions. Additional browser-test ownership authorization and browser/E2E evidence remain outstanding integration prerequisites. Main notified of scope escalation; no unowned files edited.
