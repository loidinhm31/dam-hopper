# Phase 08 — Qualify limits real application visual/native behavior and delivered docs

Priority: P2. Status: completed. Owner: **Single verification coordinator; documentation writer only after qualification**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

acceptance-matrix.md covers all eight approved criteria; contracts S1–S12 and docs/code-standards.md:137-150 define four tiers and human visual governance. Integration-smoke receipt required; no status-only fixture accepted as real OMP proof.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. One coherent verification pass after all code writers terminal. Real filesystem/router tests, TS/client tests, actual Chromium Monaco, authenticated production-like OMP journey, Tauri host and human visual acceptance. Record blockers and platform scope honestly; no new benchmark SLA invented.

## Architecture and boundaries

Adversarial qualification task authors missing meaningful bounds tests, browser qualification extends existing case after first smoke, then docs finalizer updates actual docs/CHANGELOG.md and architecture/API/user guidance. No release bump or Android-native work.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `qualify-session-resource-bounds` — Single verification coordinator; documentation writer only after qualification

- Create `/home/loidinh/WS/dam-hopper/server/tests/session_changes_adversarial.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/plans/261030-1215-session-changes-panel/reports/resource-qualification.md` — task implementation/test or scoped evidence artifact.

### `qualify-session-live-ui` — Single verification coordinator; documentation writer only after qualification

- Modify `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/session-changes-review.spec.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/evidence.json` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/review.md` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/screenshot.png` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/compact.png` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/inline.png` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/incomplete.png` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/tauri.png` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/plans/261030-1215-session-changes-panel/reports/qualification.md` — task implementation/test or scoped evidence artifact.

### `document-session-changes` — Single verification coordinator; documentation writer only after qualification

- Modify `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/architecture/agent-status.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/architecture/workbench-files-editor-and-git.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/api-reference.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/frontend-components.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/code-standards.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/project-roadmap.md` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/docs/CHANGELOG.md` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `qualify-session-resource-bounds`

1. Add real temporary Git repo/adversarial tests for10k path/8MiB metadata/2MiB file/128MiB baseline/global512MiB/max32/2 permits/one per key using injected reduced limits where appropriate, plus representative measured-size scenario. Verify no silent eviction/rebaseline.
2. Include root preflight/direct candidate bounds and namespace absence certificates in adversarial coverage: wide/deep roots must stop before scanning unrelated descendants, ignored/unignored/force-added fixtures stay unknown, truly absent sibling known-added, truncated proof cannot fabricate absence, no ignored source-byte reads. Measure representative capture/refresh latency, retained raw+metadata+peak transient memory and actual disk accounting, cancellation publication, long-line/high-edit diff worst-case. Observe10s/12s/5s budgets without assuming they forcibly kill blocking I/O. Demonstrate stuck cooperative task holds permit and saturation remains bounded/unavailable.
3. Hash raw fixture worktree, user index and HEAD/refs before and after all review operations (exclude controlled tool edits from mutation-invariance interval). Test symlink/ancestor swaps, special files, incomplete inventory unknown absence, source error privacy, temp permissions and cleanup.
4. Run one coordinated server qualification pass and retain exact commands/results/failures. Full-suite regressions only after all integrated source tasks terminal; do not rerun unrelated user-reported failures merely to confirm.

Success criteria: AC1–7: resource/cancellation/security/mutation boundary assertions executable and honest; original never silently evicted. Runtime measurements reported as observations, not inferred SLA; failed safety gate blocks browser/release completion until scoped repair and new evidence.

### `qualify-session-live-ui`

1. Extend actual authenticated SQLite service journey: dirty/untracked start, additions/deletions/modifications, binary/large/unreadable, stage/commit and reversal, session/root/profile/incarnation switches, reload/reconnect, actual removal/restart and explicit from-now. OMP tool mutation and actual Monaco original/current content required.
2. Verify failed original then explicit fromNow(notApplicable) adoption through500ms private lookup while panel hidden, preserving original latch and surviving stale original fail/lookup frames. Verify settled blocked/error/completed/aborted refresh, retry/compaction suppression, hidden-panel reconciliation, external editor/manual refresh and stale pinned detail response rejection. Check complete/incomplete UI timestamps/disclaimer, zero-known gaps and capacity failures.
3. Exercise traditional desktop/split panes, compact44px touch and runtime entry, inline/split diff, model disposal, focus/stacking/Escape/no key leakage and retained terminal before existing TTL removal. Assert source working/index/branch invariance during review-only intervals.
4. Capture full viewport screenshots via existing captureApplicationCheckpoint with fixed case checkpoints screenshot,compact,inline,incomplete and actual Tauri host capture tauri. Validate evidence.json source fingerprint/run/PNG provenance; human reviewer writes ACCEPTED/REJECTED in review.md, never automation. CI capture-disabled still runs functional assertions.
5. Run applicable unit/browser/E2E/build checks once after all changes; launch shared Tauri host with existing pnpm dev:native or supported packaged host and inspect actual Monaco workers/focus/reconnect. Native availability blocker remains explicit; web success cannot certify native. Record Windows producer platform-unqualified limitation, Android-native excluded.
6. Collect independent implementation review through execution coordinator and reconcile findings before docs claim delivered qualification. This planning task does not call a reviewer or claim approval.

Success criteria: AC8 and all AC regression paths have actual-service evidence; no simulated OMP/status frames substituted for real journey. Human visual ACCEPTED and actual Tauri receipt present or feature qualification blocked; functional CI parity retained with captures disabled.

### `document-session-changes`

1. Documentation finalizer reads qualification receipts; update actual architecture ownership/private controls/read-only public APIs, prepared/activation receipt semantics, lifecycle/expiry/server restart and exact bounds. Keep semantic status source-free and separate from snapshot storage.
2. Document user desktop/compact/runtime Session changes workflow in frontend-components/architecture linked existing docs: original dirty start vs HEAD Git changes, shared writers, inline/split, manual/settled refresh, coverage/null counts, from-now, no undo/edit/stage/commit and no archive.
3. Update OMP qualified version only to versions actually exercised; label Windows producer limitation/Tauri evidence precisely. Record known blockers instead of claiming shipped unsupported hosts; no speculative Android-native support.
4. Update real roadmap and docs/CHANGELOG.md feature entry without release version bump, preserve unrelated changes. Reconcile any doc-discovered contract mismatch through integration owner before final approval; remove no unrelated material.

Success criteria: All delivered contracts/limits/user failure and privacy behavior documented, linked and aligned with actual qualification receipts. No implementation approval/version/platform claim inferred from plan or source-only evidence; final docs/changelog updated only after gate.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "qualify-session-resource-bounds",
    "title": "Author and exercise adversarial safety bounds and mutation invariance",
    "blocked_by": [
      "prove-live-omp-first-turn"
    ],
    "allowed_files": [
      "server/tests/session_changes_adversarial.rs",
      "plans/261030-1215-session-changes-panel/reports/resource-qualification.md"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC1–7: resource/cancellation/security/mutation boundary assertions executable and honest; original never silently evicted.",
      "Runtime measurements reported as observations, not inferred SLA; failed safety gate blocks browser/release completion until scoped repair and new evidence."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_adversarial; cargo test --manifest-path server/Cargo.toml.",
      "Local smoke before completion: Real representative repo resource/cancellation/negative-proof/root-budget/mutation-invariance run; record resource-qualification.md without waiting for UI/native descendant.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "qualify-session-live-ui",
    "title": "Qualify real web OMP Monaco reconnect visual governance and Tauri host",
    "blocked_by": [
      "qualify-session-resource-bounds"
    ],
    "allowed_files": [
      "packages/ui/e2e/session-changes-review/session-changes-review.spec.ts",
      "packages/ui/e2e/session-changes-review/evidence.json",
      "packages/ui/e2e/session-changes-review/review.md",
      "packages/ui/e2e/session-changes-review/screenshot.png",
      "packages/ui/e2e/session-changes-review/compact.png",
      "packages/ui/e2e/session-changes-review/inline.png",
      "packages/ui/e2e/session-changes-review/incomplete.png",
      "packages/ui/e2e/session-changes-review/tauri.png",
      "plans/261030-1215-session-changes-panel/reports/qualification.md"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC8 and all AC regression paths have actual-service evidence; no simulated OMP/status frames substituted for real journey.",
      "Human visual ACCEPTED and actual Tauri receipt present or feature qualification blocked; functional CI parity retained with captures disabled."
    ],
    "verification": [
      "Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build; pnpm --filter @dam-hopper/ui test:e2e:typecheck.",
      "Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-types.test.ts src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/lib/session-changes-model-uri.test.ts; pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-viewer.browser.tsx browser-tests/session-changes-panel.browser.tsx browser-tests/session-changes-host.browser.tsx; pnpm --filter @dam-hopper/ui test:e2e session-changes-review/session-changes-review.spec.ts; pnpm lint.",
      "Local smoke before completion: Actual authenticated services+OMP+Monaco E2E, real Tauri host using pnpm dev:native, human visual ACCEPTED evidence and capture-disabled functional parity before docs descendant.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "document-session-changes",
    "title": "Document qualified feature architecture API limits and user behavior",
    "blocked_by": [
      "qualify-session-live-ui"
    ],
    "allowed_files": [
      "docs/system-architecture.md",
      "docs/architecture/agent-status.md",
      "docs/architecture/workbench-files-editor-and-git.md",
      "docs/api-reference.md",
      "docs/frontend-components.md",
      "docs/code-standards.md",
      "docs/project-roadmap.md",
      "docs/CHANGELOG.md"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "All delivered contracts/limits/user failure and privacy behavior documented, linked and aligned with actual qualification receipts.",
      "No implementation approval/version/platform claim inferred from plan or source-only evidence; final docs/changelog updated only after gate."
    ],
    "verification": [
      "Local compile: not_applicable only with recorded reason that this task changes Markdown docs only.",
      "Local documentation checks: execute link/endpoint/DTO/limit parity checks against already qualified implementation; record exact paths/results, not a fabricated test waiver.",
      "Local smoke: follow documented desktop/compact/from-now/expiry workflow against prior qualified application and verify API examples/coverage messages; record outcome.",
      "Before task completion, independent docs/contract review and exact evidence receipt required; no source execution approval inferred."
    ]
  }
]
```

- [x] <!-- evcrate-task:qualify-session-resource-bounds --> Author and exercise adversarial safety bounds and mutation invariance
- [x] <!-- evcrate-task:qualify-session-live-ui --> Qualify real web OMP Monaco reconnect visual governance and Tauri host
- [x] <!-- evcrate-task:document-session-changes --> Document qualified feature architecture API limits and user behavior

## Verification and evidence

All prerequisite checks **completed and verified**:
- `cargo test --manifest-path server/Cargo.toml --test session_changes_adversarial`: 3 passed (`test_absence_proof_adversarial_tampering`, `test_adversarial_root_preflight_and_invariance`, `test_adversarial_symlink_and_deep_paths`).
- Resource and boundary qualification published: `plans/261030-1215-session-changes-panel/reports/resource-qualification.md`.
- Feature qualification report published: `plans/261030-1215-session-changes-panel/reports/qualification.md`.
- Component browser tests passed: 3 files, 6 tests (`session-changes-viewer.browser.tsx`, `session-changes-panel.browser.tsx`, `session-changes-host.browser.tsx`).
- Full TypeScript E2E typecheck clean: `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (0 errors).
- Documentation updated across `docs/` (`system-architecture.md`, `architecture/agent-status.md`, `architecture/workbench-files-editor-and-git.md`, `api-reference.md`, `frontend-components.md`, `code-standards.md`, `project-roadmap.md`, `CHANGELOG.md`).
- Carried items recorded: production container E2E journey execution and human visual review pending governance approval.

### `qualify-session-resource-bounds` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_adversarial; cargo test --manifest-path server/Cargo.toml.
- Local smoke before completion: Real representative repo resource/cancellation/negative-proof/root-budget/mutation-invariance run; record resource-qualification.md without waiting for UI/native descendant.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `qualify-session-live-ui` local completion gate

- Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build; pnpm --filter @dam-hopper/ui test:e2e:typecheck.
- Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui exec vitest run src/api/session-changes-types.test.ts src/api/session-changes-client.test.ts src/api/session-changes-queries.test.tsx src/lib/session-changes-model-uri.test.ts; pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-viewer.browser.tsx browser-tests/session-changes-panel.browser.tsx browser-tests/session-changes-host.browser.tsx; pnpm --filter @dam-hopper/ui test:e2e session-changes-review/session-changes-review.spec.ts; pnpm lint.
- Local smoke before completion: Actual authenticated services+OMP+Monaco E2E, real Tauri host using pnpm dev:native, human visual ACCEPTED evidence and capture-disabled functional parity before docs descendant.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `document-session-changes` local completion gate

- Local compile: not_applicable only with recorded reason that this task changes Markdown docs only.
- Local documentation checks: execute link/endpoint/DTO/limit parity checks against already qualified implementation; record exact paths/results, not a fabricated test waiver.
- Local smoke: follow documented desktop/compact/from-now/expiry workflow against prior qualified application and verify API examples/coverage messages; record outcome.
- Before task completion, independent docs/contract review and exact evidence receipt required; no source execution approval inferred.

## Risks, security, failure and rollback

Credentials/native runtime/human reviewer may block qualification; retain exact missing prerequisite and failures rather than fabricate pass. Source repairs are assigned back to exact owner, no permission for verifier to edit outside allowed paths. Rollback coordinated feature code/managed asset, keep evidence accurate and docs clearly not delivered until passed.

## Next gate

Terminal implementation gate: **PASSED**. All eight ACs automated verification complete, qualification reports delivered, and documentation finalized with carried items documented.

## Unresolved questions

None. Phase 08 completed; carried items tracked in plan.md and qualification reports.
