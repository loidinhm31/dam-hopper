# Browser native tabs/session UX — planner report

## Terminal result
**Authoring complete; not ready for implementation.** Independent review and final optional interview remain coordinator-owned/pending. Maintained architecture Gate 1 publication remains first future task; implementation/verification not authorized or performed.

## Exact artifacts
All under `/home/loidinh/WS/dam-hopper/plans/261111-0943-browser-native-tabs-session-ux/`:
- `plan.md` — canonical overview, frontmatter, scope, phase order, ownership and gate status.
- `design.md` — proposed architecture written before phases; runtime/disk schemas, privacy, lifecycle/failure contracts, compact wireframe, acceptance matrix A01–A15.
- `phase-01-owner-and-state-contracts.md` — maintained Gate 1 publication, verified identity and canonical tab model.
- `phase-02-persistence-and-lifecycle.md` — projections, local remembered groups, operation guards, single-flight creation and reference-aware close/reconciliation.
- `phase-03-tab-root-resources.md` — exact-tab snapshot/popup sync and stable active-only root viewers.
- `phase-04-native-chrome-and-launches.md` — compact tabs/address/New Tab/tools/recovery, existing launch semantics, recipe metadata cutover only.
- `phase-05-qualification-and-docs.md` — affected fixture migration, planned targeted/live full-app checks, final drift/docs/changelog ownership.
- `reports/planner-report.md` — this terminal report.

Existing evidence reports read-only; no product code, maintained docs, unrelated plans or task state written.

## Decisions propagated
- Live-only app reload/network reconnect; exact existing session reattach, no automatic target recreation after restart/missing target.
- Explicit OS close destroys only unshared targets and saves ordinary committed address order/active index; default no-window/no-URL reopen creates selected fresh page lazily. New Window blank; URL/deep links preserve explicit new-window semantics.
- Default target/viewer budgets remain 2; inactive tabs keep native pages alive with zero media/control attachment/audio. No eviction/background audio/backend registry.
- Owner scope uses current server-verified auth-status `user` and prod/dev flag plus profile and normalized endpoint; no editable username/JWT trust. Unknown identity fails closed.
- Ordinary HTTP(S) URL query/hash retained as local plaintext metadata, potentially sensitive; popup provenance excluded for lifetime; userinfo/non-HTTP addresses not persisted; drafts/runtime credentials never serialized. Clear action survives reload/autosave through durable owner suppression.
- Single-flight create holds immutable key/request in memory. Durable intent markers contain no URL/key/authority. Unknown create never replays POST or guesses by URL; empty inventory is not settlement. Exact late results adopted only by original current tab or enter reference-checked cleanup.
- Existing API cannot look up creation key; 600s idempotency TTL/restart can defeat POST replay. Accepted fail-closed boundary: visible owner notice, affected automatic group restore blocked, explicit selected-inventory actions or fresh-start duplicate-risk acknowledgment; unresolved notice remains.
- Storage failure blocks lifecycle mutation before dispatch; known-ID GET reconnect and memory drafts remain usable. No false saved/closed/cleared claim.
- Root host identity window+tab, active-only sockets/PCM/input, guarded popup admission/completion without focus steal. Secondary control/selection/terminal handoff/diagnostics retained.
- **Recipe correction accepted from coordinator:** current `executeRecipeLaunch` executes terminal steps only. Leave missing app-step execution unchanged; only Browser capture/schema/import/export metadata migrates. No Browser-special-case recipe executor or claim recipes instantiate pages.

## Source/path evidence
Direct source reads confirmed connection/auth fields, existing auth-status dev flags, Browser app/host/sync/store APIs, persistence modes, default/New Window/URL/deep-link construction, recipe projection/execution, idempotency retention and typed `browserBusy`/`nativeCloseUnconfirmed` errors.
- Actual normalization import: `packages/ui/src/api/server-config.ts`.
- Actual UI scripts: `packages/ui/package.json`; Vitest/browser filters package-relative.
- Existing live fixture/config: `packages/ui/e2e/fixtures/host-browser-app.ts`, `host-browser-journey-driver.ts`, `capture-policy.ts`, `capture-evidence.ts`, `packages/ui/playwright.config.ts`.
- Existing navigation/selection full-app specs and targeted input/Android-web/selection/lifecycle/stream/PCM test paths confirmed. New modules/specs explicitly enumerated in literal task allowlists; they do not exist yet.
- Existing OS Browser import has no assumed byte bound; proposed Browser metadata/recovery bound explicitly 1,048,576 bytes, reject not truncate. OS/Recipe outer versions unchanged.

## Artifact self-check actually exercised
Read actual canonical overview and all five linked phases through read tool; parsed their JSON fences in an in-memory structural check.
- Overview 57 lines (<80); all required YAML keys present; five linked phase artifacts exist.
- Exactly one `evcrate-tasks` JSON array per phase; 11 unique stable lowercase IDs; every record exactly seven required fields.
- Matching task markers; nonempty acceptance/verification arrays; normalized literal allowlists without globs/unsafe paths.
- Dependency graph acyclic. Shared maintained-doc writers explicitly dependency-ordered; single BrowserIntegrator serializes source ownership and cross-plan overlaps.
- Proposed new paths enumerated; existing writable/test/config paths checked. No `tasks.json` created.
- These are **plan artifact checks**, not product test/build/typecheck/visual passes.

## Not exercised / pending
No product tests, builds, linters, formatters, installs, Git commands, task hydration, runtime browser smoke, external research, independent review or interview executed by planner. Future commands and live/full-viewport evidence criteria are in phase 05; binary/runtime availability not asserted.

Coordinator reports active-plan setter could not persist because `EVCRATE_SESSION_ID` unset; explicit canonical path remains usable. No active-plan activation claimed.

## Blockers and unresolved questions
- No unresolved product decisions or authoring blockers.
- Readiness gates pending: independent plan review, coordinator's optional interview offer/final disposition; future maintained Gate 1 publication and implementation authorization.
- Known API recovery limitation intentionally bounded above, not a promise of guaranteed remote cleanup.
