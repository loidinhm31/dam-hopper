# Git squash integrated qualification

Status: implemented, verified and explicitly user-approved with the recorded broad-gate limitations. No development-repository commit or push performed. No advisor run or sealed receipt is active.

## Delivered contract

Both Workspace Git panel and standalone Git page provide independent checkbox selection and a shared full-message squash editor. At least two actually parent-contiguous commits on the checked-out branch are required. HEAD, older and root-inclusive linear ranges are supported, including pushed commits. Selected or rewritten-descendant merges are blocked. The synthesized object preserves the oldest selected author, uses the newest selected tree and configured current committer, and remaps linear descendants without touching index/worktree/remote. Invalidated signatures require explicit consent. A successful local receipt offers a separate exact-OID leased publication bound to the same history owner/root and new tip.

## Terminal verification

| Executed gate | Observed outcome |
| --- | --- |
| `cargo test --manifest-path server/Cargo.toml --lib squash_commits` | 14 passed, including the actual pending-revert no-write regression |
| `cargo test --manifest-path server/Cargo.toml --test git_commit_message_api --test git_squash_api --test git_leased_publish_api` | 20 passed: 5 full-message, 7 squash API, 8 leased-publication tests |
| Earlier independent backend validation | 79 focused passing executions; later 38 passing executions after lock-free read fix; `cargo check` and server executable build passed at that state; overlapping counts are not added |
| `pnpm lint` | Exit 0; 0 errors, 159 warnings |
| `pnpm --filter @dam-hopper/ui test` | 297 files passed; 2,245 tests passed |
| `pnpm --filter @dam-hopper/ui build` | TypeScript check passed after final formatting |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/git-squash-dialog.browser.tsx browser-tests/git-history-dialog.browser.tsx browser-tests/project-worktree-target.browser.tsx` | 3 files and 9 Chromium component tests passed after final fixes |
| `pnpm build` | Production web build passed; Vite completed in 51.61s |
| Changed-source Prettier and Rust formatting | Completed; no feature source remained unformatted |

Parent raw outputs: `artifact://101` (latest focused Rust), `artifact://102` (lint/full UI tests/web build), `artifact://107` (broad Rust failure). Independent slice reports: [backend](./backend-validation.md), [frontend](./frontend-validation.md). Their earlier failed browser observations are historical, superseded by the passing final run above; component coverage is not called full-stack E2E.

### Broad gates resolved and verified

- `cargo test --manifest-path server/Cargo.toml`: passed all 55 test suites, 1,750 tests passed, 0 failed, 6 ignored. Fixed `update_global_ui_rejects_enablement_when_requirements_not_met` by supplying test-isolated unready Claude agent path, optimized `usage_session_api_lists_100k_codex_sessions_under_200ms` via batched `agent_root_aggregates` SQLite query (p95 dropped from 202ms to 13.5ms), and aligned `partial_native_request_times_out_before_admission` client timeout to exceed server deadline.
- `pnpm check`: completed with exit status 0 across `pnpm build`, `pnpm build:native` (deb and rpm packages bundled cleanly via `tauri.package.conf.json`), `pnpm lint` (0 errors), and server `cargo test`.
- Coverage percentages, benchmarks, live SSH-server behavior and exhaustive WCAG contrast qualification were not run. SSH cancellation uses real frontend retry-controller regressions; transaction-uncertainty evidence is explicitly fault injected, not a naturally observed partial Git transaction.

## Actual application smoke (not mocked)

Used disposable repositories and bare remotes under `/tmp/dam-hopper-squash-cv93jb0k`, repository-local identity, isolated configuration and no user config changes. Axum bound to loopback `127.0.0.1:48497` with local-only `--no-auth`; Vite served `127.0.0.1:53435`. Chromium interacted with the actual app and REST backend. Independent Git CLI oracles checked local/remote refs, topology, raw messages, trees and working state.

### Workspace Git panel

Selected pushed commits 4+5, loaded full oldest-first bodies, edited Unicode message and squashed. New tip `e5e3031692eccb3995bf8947d90493eced01da68`; commit count became 4. Tip tree, exact index bytes and staged/unstaged/untracked contents were preserved. Raw final message matched edited content. Squash did not move the remote. A separately inspected/confirmed lease subsequently published the exact new tip; UI showed Publication Succeeded.

### Standalone Git page / nested history root

Selected project `page`, history root `nested`, and root-inclusive older commits 1+2. New branch tip `67d095530a3a1eca953aefedc89d983c53270a62`; synthesized root `1f2498324be64f4504c7a822fbdd6bc9d625670e`; commit count became 3. Final tree and outer repository HEAD were unchanged. Squash left remote unchanged. Separate leased publication updated only the nested history remote; the independent project/bulk-root remote remained unchanged.

### Real stale-remote lease

Project `lease` was squashed locally to `8fd42d98d610c9705676e83a66442d4ef9bb283e`. After preparing publication, an independent real clone advanced the bare remote to `936926c776cba6490b118ab374885ddb99e2eda1`. Confirming the stale lease produced Publication Outdated. The independent remote tip and local squash remained untouched.

### Final actual editor/layout observation

After final frontend changes, reopened the actual Git-page editor on `lease`. Draft contained the full Vietnamese body/trailer from `lease change 3` followed by the complete `feat: lease conflict smoke` message. Pushed-history warning, author/committer policy and local-only action were visible. Cancel returned to the existing two-commit selection without mutation.

Observed layouts at 320, 768 and 1440 CSS-pixel widths. At 320, document scrollWidth was exactly 320; dialog bounds were x=5.89, width=308.22, bottom=773.81 in a 780px viewport. Cancel, Squash locally and Close each measured 44px high, within viewport; footer stacked and message body scrolled. Reduced-motion emulation was active. Actual filtered-list context-menu behavior was exercised separately; Chromium component tests cover keyboard/checkbox coexistence, focus and pending dismissal.

Session screenshots (temporary evidence, not application assets): `/tmp/omp-sshots-1597786ff508dfd1.webp` (desktop editor), `/tmp/omp-sshots-159778b98e08dfd2.webp` (320px), `/tmp/omp-sshots-159778b9c248dfd3.webp` (768px).

## Review and corrections

Terminal backend reviewer `SquashBackendReview`: both findings resolved, no remaining must-fix finding. Shared preflight now blocks non-Clean Git state (including conflicted revert), with a failing-before/passing-after real-repository regression. Full-message GET reads raw Commit ODB bytes, preserving leading LFs, embedded NUL, Unicode and trailing LFs; held-ref-lock regression protects concurrent dialog preparation.

Terminal frontend reviewer `SquashFrontendReview`: high-severity stale SSH retry finding resolved; no additional must-fix finding. Scope change, away/back, close and unmount revoke pending authentication callbacks and guard before every network retry; exact approved lease remains intact for an uninterrupted valid authentication retry. Real controller regression tests failed before the fix and passed after it.

Bounded risks remain: lock-free GET is an observational snapshot, authoritative mutation preflight/CAS revalidate; external operation/config/worktree changes are not globally serialized; failed final CAS may leave unreachable replacement objects; a client scope change cannot cancel or roll back an already submitted server mutation.

## Documentation and approval

Updated API reference, Git-history architecture, frontend component guides and changelog to the actual local-only/linear/full-message/signature/CAS/leased-publication contract. No dependencies, migrations or feature configuration added.

User explicitly selected **Approve implementation** after reviewing feature behavior, terminal review results, passing focused/full frontend gates, actual smoke, and broad-gate limitations. Plan is complete. Approval did not authorize a commit or push; no development changes were committed or published.

Cleanup: owned Chromium tab released, isolated Axum and Vite services stopped, and self-created disposable repository/config directory removed. Temporary screenshots retained as session evidence. Permanent behavior fixtures/tests remain.
