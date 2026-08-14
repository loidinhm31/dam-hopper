# Phase 04 — Tests, docs, validation, and review

## Context links
- [Rust API tests](../../server/src/api/tests.rs), [config tests](../../server/src/config/tests.rs), [semantic WS tests](../../server/tests/ws_semantic_navigation.rs).
- [UI component tests](../../packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx), [query tests](../../packages/ui/src/api/queries.test.ts), [transport tests](../../packages/ui/src/api/ws-transport.test.ts), [semantic tests](../../packages/ui/src/api/semantic-transport.test.ts), [browser Settings tests](../../packages/ui/browser-tests/settings-usage-insights.browser.tsx).
- [Configuration guide](../../docs/configuration-guide.md), [API reference](../../docs/api-reference.md), [system architecture](../../docs/system-architecture.md), [semantic release safety](../../docs/semantic-navigation-release.md).
- [Development rules](../../docs/code-standards.md) and repository test commands in `AGENTS.md`.

## Overview/date/priority/status
- Date: 2026-08-14; priority: P1; status: completed (2026-08-14 15:28 +07:00).
- Prove the acceptance contract, document the narrow API/config/lifecycle change, and pass reviewer/UI-UX gates without widening scope.

## Key Insights
- This feature is cross-layer; a green component test alone cannot prove active TOML persistence or live server cleanup.
- Existing semantic release docs already state signed-bundle/fail-closed/no-PATH behavior; update references rather than redesigning release/deployment.
- Browser coverage must use a valid signed semantic fixture for the enable/editor path and an unavailable-bundle fixture or controlled response for the disabled explanation path.
- `no-staged-files` is expected for this planning-only run; implementation review must separately report its changed files.

## Requirements
- Rust unit/API/lifecycle tests cover default false, API protection, body validation, active TOML-only persistence, unavailable conflict/no write, live off cleanup, live on admission, late-result fencing, config reload, and workspace switch.
- WS tests cover authenticated upgrade remains required, disabled handshake/admission, valid bundle enable, active session closure, prewarm cancellation, reconnect/fresh generation, trust/revocation preservation, and bundle invalid/missing mapping.
- UI tests cover typed endpoint mapping, query/mutation invalidation, default off, disabled reason/disabled Switch, pending/error rollback, and no localStorage/global UI mutation.
- Browser test covers Settings visibility, no-bundle disabled reason, valid bundle off→on, editor navigation after enable, on→off cleanup/no stale target, and persisted state after reload/workspace re-open.
- Run TypeScript build, lint, formatting check, Rust format/check/tests, and browser suite. Do not start or contact production port `4800`.
- Reviewer gate required; UI-UX designer review during `/code`; no unresolved questions.

## Architecture
- Documentation should describe one source of truth: active workspace TOML `[server.semantic].enabled`; protected endpoint; mutable supervisor gate; generation/epoch cleanup event; signed bundle availability precondition.
- Update `docs/system-architecture.md` with the semantic lifecycle state/data flow before implementation. Update `docs/api-reference.md` with GET/PATCH payload, 409 behavior, auth, and safe reason semantics. Update `docs/configuration-guide.md` with default/off and active TOML ownership. Only update `docs/semantic-navigation-release.md` if a cross-reference is needed; do not alter bundle production/deployment behavior.
- Keep browser/manual notes explicit: valid bundle is required for on/editor path; unavailable bundle is an expected safe state, not a PATH fallback or port issue.

## Related code files
- Test/modify: `server/src/config/tests.rs`, `server/src/api/tests.rs`, `server/tests/ws_semantic_navigation.rs`, supervisor tests, and relevant UI tests/browser spec.
- Docs modify during `/code`: `docs/system-architecture.md`, `docs/api-reference.md`, `docs/configuration-guide.md`; no `docs/linux-nohup.md` change unless a direct wording correction is unavoidable.
- No generated bundle, migration, deployment script, Java runtime, unrelated Settings refactor, or source edit in this planning run.

## Implementation Steps
1. Add focused Rust unit tests for capability mapping and supervisor transition cleanup.
2. Add API tests with temporary active TOMLs: default false, protected route, exact key preservation, atomic persistence, conflict/no write, and reload synchronization.
3. Extend WS integration tests using existing signed test resolver to prove off/on session and fence behavior; retain unauthenticated rejection.
4. Add UI unit tests for channel mapping/query cache and `SettingsAppearanceSection` states; test error rollback and disabled explanation.
5. Add browser Settings/editor regression with stable selectors and workspace reload persistence.
6. Update architecture/API/config docs with exact contract and no deployment redesign.
7. Run formatter/lint/type/build/Rust/browser commands; inspect diff for source scope, secrets, port `4800`, and unrelated Settings churn.
8. Request code reviewer after implementation and ui-ux-designer review; resolve blockers, then re-run affected tests.

## Todo list
- [x] Rust schema/API/supervisor/WS/config tests.
- [x] UI query/channel/component tests.
- [x] Browser Settings/editor flow (fixture-dependent; live run recorded as residual).
- [x] Architecture/API/config docs.
- [x] Format, lint, build, Rust, and browser validation (live browser validation recorded as residual).
- [x] Code reviewer and UI-UX review; record findings.

## Completion record
- **Completed:** 2026-08-14 15:28 +07:00.
- **Evidence:** API/config/architecture docs updated; Rust 813 passed (1 ignored), UI 1,038 passed, TypeScript/build/lint/format/diff checks passed; approved review 8/10 recorded no critical/high blocker and no staged files.
- **Approved residuals:** TOML comments/trivia rewrite risk; stale availability after bundle mutation; incomplete live browser/signed-bundle validation; no production port `4800` contact.

## Success Criteria
- Every preflight acceptance bullet has automated evidence or an explicit browser/manual note.
- No production port contact, PATH fallback, bundle/deployment redesign, Java enablement, or per-project/profile setting.
- Docs and implementation agree on API, ownership, lifecycle, and fail-closed semantics.
- Review reports no blockers; final diff contains only planned code/tests/docs.

## Risk Assessment
- Browser environment may lack a signed bundle; keep unavailable-state test independent and mark valid-bundle editor test fixture-dependent rather than weakening safety.
- Full suite may be costly; run focused tests first, then required package/server suites before claiming completion.
- Documentation drift can hide lifecycle assumptions; compare implementation against phase 01/03 contracts during review.

## Security Considerations
- Verify auth tests for both HTTP settings and semantic WS; verify no sensitive fields in response/error/docs.
- Treat invalid bundle as safe disabled behavior and ensure direct API/WS attempts cannot bypass it.
- Ensure tests do not use real credentials, committed `.env`, production URLs, or host PATH tools.

## Next steps
- `/code` executes phases 01–03, then this phase's tests/docs/review gates.
- Final implementation handoff must report changed files, tests added/updated, commands/results, residual risks, and staged-file status.
