# Phase 08 Compilation and Unit-Test Repairs

## Executive Summary

Concrete blockers from [qualification report](tester-261104-1916-phase-08-qualification.md) repaired. Requested server compilation, UI type build, workspace lint, and full UI unit-test gates now pass. This is not browser/E2E or Rust runtime qualification.

## Changes and Contract Rationale

- `server/src/pty/manager.rs`: evaluate fleet/replacement predicates before mutable dead-session borrows; preserve atomic admission/mutation under the existing mutex. Cancel failed-source fleet restart only after exact incarnation and restart-state guards. Bind successful-respawn recorder from the current supervisor recorder.
- `server/src/api/tests.rs`: pass owned CORS origin vector.
- `OsShell.tsx`: restore provider closing JSX; synchronize latest inventory ref in an effect.
- `review-retirement.tsx`: synchronize target ref in an effect before subscription-effect processing.
- `TerminalPanel.tsx`: read current Cognito shortcut settings inside the keyboard callback; restore missing optional terminal-order prop.
- Additional errors exposed after JSX repair: complete boolean failure returns in `ServerSettingsDialog`; contextually type frozen termination errors; widen reconciliation local variable to its actual transition union; restore palette imports; use canonical atom Button and supported variant; type native React 19 button ref forwarding; use `client.config.get()`; type Agent Hub's existing Unobserved presentation and translate blocked-reason labels.
- Terminal fixtures: use actual per-section JSON schema (`input` is the eligibility row itself, `input.terminationState`, endpoint `body`, `incomingObservation`). Supply explicit observation owner and assert epoch mismatch cannot reconcile an old action. Endpoint cases now reach effective assertions rather than checking nonexistent expected fields. Two server-only signal/wait descriptors previously generated assertion-free frontend tests; frontend reconciliation loop now registers only loss-reconciliation fixtures, without claiming server signal/wait coverage.
- Context menu tests: add workspace-status mock and select production `file-tree-item-*` row identifiers rather than a mock identifier overridden by `NodeRenderer`.
- Other stale expectations: object media targets; server configuration wording; 40px visible titlebar bound; exact custom-command IDs with longer-key rejection; correct authored recipe step key while retaining the `cargo build` assertion.
- `docs/code-standards.md`: document fixture schema and Rust test-target compilation requirements.

## Risk and Evidence Map

| Behavior / risk | Existing evidence and gap | Layer / oracle / rejected defect | Action / result |
|---|---|---|---|
| Restart cancellation and failed respawn ownership | Existing PTY/API tests could not compile | Rust type checking; rejects overlapping borrows and unbound recorder | Ordinary and test-target compilation pass; runtime races not exercised |
| Shell/providers and termination state unions | JSX blocked deeper UI diagnostics | TypeScript build; canonical prop/API/type contracts | Repair exposed errors, then build passes |
| Render-time ref mutation / current keyboard preferences | ESLint and existing TerminalPanel tests | Lint plus component unit tests; rejects render writes and missing shortcut binding | Lint no errors; full unit suite passes |
| Exact terminal fixture/epoch contract | Frozen fixtures, previously wrong field accesses and vacuous endpoint checks | Unit schema oracles; rejects numeric fallback, invalid echoed responses, cross-epoch completion | Full unit suite passes |
| File-row menu actions | Existing download/rename/delete/cancel tests | Component tests using real row renderer; rejects absent row/action behavior | Repair mock export and stale selector; full suite passes |
| Bounds, commands, media/settings copy | Existing pure/component tests; stale inputs/expectations | 40px projection contract, exact command key, scoped media target | Update harness/expectations; full suite passes |

## Execution History

Environment: existing Linux x64 checkout and installed workspace dependencies; local compiler/headless unit runners only. No deployment, browser session, credential changes, or dependency installation.

| Command / attempt | Result | Evidence |
|---|---|---|
| `cargo check --manifest-path server/Cargo.toml` | PASS, warnings remain | `artifact://44` |
| `cargo check --manifest-path server/Cargo.toml --tests` | PASS, warnings remain | `artifact://46` |
| First UI build after syntax repair | FAIL: deeper type errors exposed in dialog, terminal props/actions/context, palette, Hub | Original failure retained in execution transcript |
| Second UI build after type repairs | FAIL: canonical Button did not expose native `ref` in props | Repaired native React 19 button prop typing |
| Subsequent UI build | PASS | Followed by final combined build/lint gate below |
| First `pnpm lint` after initial repairs | FAIL: newly reachable `OsShell` render-time observation-ref mutation; 313 warnings | `artifact://50` |
| First `pnpm --filter @dam-hopper/ui test` | FAIL: 7 tests in ContextMenuConsumers; 329/330 files pass | `artifact://52`; production row identifier superseded mock identifier |
| Final `pnpm --filter @dam-hopper/ui test` | PASS: 330 files, 3,166 tests; 23.24s runner duration | Fresh post-selector-repair result in execution transcript |
| Final `pnpm --filter @dam-hopper/ui build && pnpm lint` | PASS: TypeScript succeeds; lint 0 errors, 315 warnings | `artifact://54` |

UI suite printed two jsdom unsupported-navigation diagnostics while exiting successfully. These do not establish navigation correctness. No assertions, lint rules, retries, or timeouts were weakened to obtain a passing gate. Warning cleanup remains outside concrete failure-repair scope.

## Remaining Qualification Boundaries

- Main qualification should execute affected Rust PTY/API runtime tests; `cargo check --tests` establishes compilation only.
- Browser Vitest, Playwright E2E, and full root `pnpm check` not executed in this repair assignment.
- Original report's vacuous lifecycle/recipe/browser assertions and weak cutover survival/deduplication evidence are not repaired here; those are separate qualification-quality findings, not the listed unit/build failures.
- Advisor consulted before implementation and after repairs. No additional repair-blocking issue identified in shown evidence; broader qualification gaps retained above.

## Unresolved Questions

None for this repair scope. Media object targets and server-config wording match current authoritative implementation; no compatibility shim added.
