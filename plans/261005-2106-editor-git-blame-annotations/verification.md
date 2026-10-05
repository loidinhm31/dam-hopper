# Verification matrix and execution recipe

Parent [plan](./plan.md); [contracts](./contracts.md). **All runtime/test commands here are planned, not executed during plan creation.** Proposed new paths must exist after corresponding phase implementation.

## Acceptance traceability

| ID | Observable criterion | Primary phase | Required proof |
|---|---|---|---|
| A01 | Line-number right-click toggles annotation; right-click never invokes diff; code/fold menu preserved |04/06 | Real Monaco pointer/keyboard scenario + full-app gutter capture |
| A02 | Known author/date/offset/full hash/subject correct; compact author-only retains full hover/focus metadata |01/02/04 | Native exact-OID fixture + normal/compact actual hover/focus surface |
| A03 | Insert/edit/delete/undo/redo current unsaved buffer preserves unaffected authors; stale replies cannot paint; disk unchanged |01/02/03/06 | Native/API fixture, controlled race regressions, real dirty-buffer journey |
| A04 | Rows align through fold/scroll/font/resize/model switch; full/compact mode follows wrapper width and markers remain usable |04/06 | Public geometry ≤1 CSS px;639/640, bounded column and wide-viewport/narrow-split assertions + visual observation |
| A05 | Exact commit/body/files opens read-only Workspace Git inspection outside200-row history/filter; already-open stays open; real history actions preserved |02/05/06 | Detached/unmerged ODB read; old-commit/full-body journey in three layouts + inspect/history action transition |
| A06 | Same names on different profiles, generations, worktrees, nested roots never collide |02/03/05/06 | Real root/worktree fixtures + delayed response/profile reconnect scenarios |
| A07 | New/untracked/empty/unborn/non-repo/unavailable/shallow/CRLF/trailing boundaries honest |01/02/06 | Native/API behavior table + UI edge-state smoke |
| A08 | Existing added/modified/deleted marker primary-click file diff remains; no popup/click overlap |04/06 | Actual gutter input test and application diff smoke |
| A09 | Normal/degraded + Markdown/HTML Edit/Split work; Preview/unsupported surfaces pause/explain |03/06 | Actual source-pane switching, ≥1MiB supported text, unsupported network-negative scenario |
| A10 | Off/hidden sources no work; no feature-added polling; focus/manual external refresh; bounded requests/cache/native workers and no logs/storage leak |02/03/07 | Worker lifetime, deterministic refresh/no-periodic-work regressions, app network counters and storage/log inspection |
| A11 | Built full-app journey and fresh local evidence; human visual review, honest runtime limits |07 | Canonical evidence manifest/screenshots/review + exercised command report |

## Behavioral regression inventory

### Native/API (real temporary repositories)

- Two authors + full body + timezone offsets; exact OID attribution, current buffer insertion/replacement/deletion/undo.
- Empty, CRLF, terminal newline/no newline, unicode, authored negative offset. No source copying or incidental wording assertions.
- Valid unborn repository vs damaged/not-Git state; new/untracked and deleted worktree file with held buffer; staged rename unique mapping, committed whole-file rename, ambiguity fail closed.
- Configured project nested below repo, nested Git root, registered linked worktree/detached HEAD, uninitialized submodule, shallow boundary.
- `..`/absolute/drive/NUL path, escaping symlink, binary/symlink/gitlink modes, arbitrary worktree, wrong project auth.
- Decoded buffer at/over5MiB, valid JSON escaping above10MiB but below32MiB, >32MiB body, bounded response and arbitrary oversized commit details; unaffected route cap unchanged.
- Refs/index/file bytes unchanged; root/HEAD changes during work return stale; worker permit survives dropped HTTP caller, busy third request has no queued work.
- Exact arbitrary commit details accepts detached/unmerged/old OID/body; malformed/missing/non-commit OID error; edit/squash/leased-publication gates remain unchanged.

### Client/store/hook (deterministic headless)

- Controlled promises/fake timer debounce, not sleeps: old reply after edit/tab/root/generation change; response echo mismatch; range/commit-index validation.
- Close/reopen same key, source-model replacement, dirty stale resource binding, same project/path on2 profiles, worktree scope.
- Toggle omitted from persistence/hydration, active source only, preview/off/hidden stops work, rAF/disposables retired.
- Busy/error no retry loop; latest-only intent. External HEAD change with unchanged mtime is discovered on window focus/visibility restoration or manual Refresh; unchanged HEAD does not suppress these intents. Own root-refetch completion/duplicate restoration coalesce, unrelated cache updates do not reblame. No feature-added periodic root/blame requests during active focused idle time; advance controlled timers without incidental events. Edit/save/reload/relevant FS/in-app Git invalidation remain separate working triggers; dirty bytes unchanged.
- Reveal nonce/root readiness/generation race; inspection independent of history resets, no mutation controls in inspect mode; selecting a real history row restores canonical eligible actions without fabricated metadata.

### Actual Monaco browser

- Public hit-test targeted right-click, exactly1 menu; code retains Monaco menu; markers left/right; folds independent.
- First/last/viewport-scrolled/folded lines align ≤1 CSS pixel; font zoom/resizing/tab/model changes.
- Stable whole-wrapper inner width (before column):639 → author-only `min(120px, wrapperWidth / 3)`;640 →220px author/date. Normal→compact→normal, widths below360 and narrow Split inside wide viewport; exact bounded allocation, date/full hover/focus metadata, no overflow/resize feedback or blame requests, cursor/scroll/dirty bytes preserved. Update dimensions here with contracts/phases if actual visual proof requires tuning.
- Keyboard ContextMenu/Shift+F10/Escape focus restoration; row actions disabled after buffer invalidation.
- Enabled line-number Refresh Annotations works in ready/busy/error states and obtains latest root/buffer; unavailable owner/source disables with a reason. Menu/tooltip focus does not create window-restoration refreshes.
- Read-only/Android policy and Cognito isolation remain; no source changes from mode/navigation.

### Full application / visual

- Built SPA + production Rust server + Mongo + existing authenticated fixture. Synthetic real Git repos, no mocked attribution.
- Main dirty-buffer flow and old commit (>200) with multiline body. Three layouts: IDE/terminal/compact.
- Source Markdown/HTML Edit/Split/Preview, clean file/no changed-file entry, nested/worktree route, two same-name profiles and reconnect where feasible. External Git change with unchanged file mtime refreshes separately through manual action and window focus/visibility; no feature-added periodic requests, distinct from unrelated Git observers.
- Capture normal author/date, compact author-only/full metadata, dirty/menu/full-body and narrow Split on wide viewport through canonical helper; human ACCEPTED/REJECTED explicit. Inspect exposes read-only message/files/diffs; real history-row selection retains eligible actions. No fabricated review.

## Commands

Run once after relevant integrated edits settle; adjust test filenames only if implementation deliberately changes proposed names. Cwd is explicit. Use project-supported commands; avoid repeated broad checks during parallel edits.

| Cwd | Command | Purpose |
|---|---|---|
| `server` | `cargo run --example git_blame_probe` | Phase01 disposable native behavior probe; remove example after evidence |
| `server` | `cargo test git_blame` | Native bounded attribution/regressions |
| `server` | `cargo test --test git_blame_api` | Actual HTTP auth/target/body/worker/commit read integration |
| repo root | `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-editor-git-blame.test.tsx src/lib/editor-git-blame.test.ts` | New freshness/line/range behavior |
| repo root | `pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/WorkspaceGitPanel.blame.test.tsx` | Exact inspection vs history mode races |
| repo root | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx` | Real Monaco component assertions |
| repo root | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Application scenario types |
| repo root | `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e editor-git-blame/editor-git-blame.spec.ts` | Authenticated built-app journey + local captures |
| repo root | `CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e editor-git-blame/editor-git-blame.spec.ts` | Same functional scenario with no visual artifact generation, if CI parity qualification requested |
| repo root | `pnpm --filter @dam-hopper/ui test` | Shared UI regression suite |
| repo root | `pnpm --filter @dam-hopper/ui test:browser` | Existing actual-browser regressions, including second config |
| `server` | `cargo test` | Backend regression gate, including mutation safety |
| `server` | `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` | Backend format/lint after all changes; do not hide preexisting failures |
| repo root | `pnpm build` and `pnpm lint` | Built web + shared TS and lint gate |

- Root `pnpm check` additionally builds native app and repeats web/backend gates; use when native build prerequisites available, not as proof of native interactive runtime.
- If fixing formatting, format only touched files; never root `pnpm format` as an unrelated mass restyle.
- Container prerequisites: Docker or Podman, production/test images/build toolchain, Mongo image, usable Chromium. Existing playwright config supports `BROWSER_CHANNEL` or `BROWSER_EXECUTABLE_PATH` (not both); defaults may use system Chromium.
- Do not run auth E2E with no-auth. Development smoke may use no-auth only with an isolated loopback trusted server and production/Mongo guards absent.

## Actual runtime smoke recipe

1. Start isolated real server/app or canonical E2E services. Register synthetic repository with deterministic authors/body. No production credentials/projects modified.
2. Use bound API to POST unsaved snapshot, observe exact committed/uncommitted rows; GET exact details observe multiline body. Read disk/index/HEAD and prove no writes.
3. Open app in browser, actual Explorer file, line-number right-click, annotate and inspect author/time metadata.
4. Insert/delete text; observe old links disappear before request completes, then correct uncommitted/retained rows. Scroll/fold/zoom/resize and visually inspect alignment.
5. Choose a retained annotation commit; observe correct Workspace Git surface/root/hash/body/files. Repeat when Git already open and hash outside filter/page. Return to intact dirty file/cursor.
6. Repeat terminal/compact and Markdown/HTML source modes. Resize actual wrapper across639/640 and narrow Split on wide viewport; inspect full/compact author/date metadata and alignment without cursor/scroll/dirty-state loss or resize-triggered requests. Off/Preview/hidden no feature requests; same-name secondary profile cannot receive primary attribution.
7. Make an external commit changing an attributed line but preserving source-file mtime; use enabled line-number Refresh Annotations and observe new committed/uncommitted mapping against current dirty buffer, no save/reload. Repeat with another external change and window focus/visibility restoration. Confirm in-app Git/editor changes still refresh; idle focused source adds no feature polling. Separate background traffic from other existing Git observers.
8. Inspect annotation-opened commit: full message/files/diffs without mutation controls. Select a real history row and verify existing eligible actions return with canonical metadata.
9. Capture fresh full-viewport screenshots with canonical helper; human review required. Close browser, dispose owned containers/temp data; report actual versions/results/limitations.

## Evidence reporting

- Each completed phase records command + cwd + exercised scenario + observed result + artifact path. No pass counts from old reports.
- Separate CLI/native/API/component/full-app/native-host claims. Planned command list is not evidence.
- Worker/load measurements are observations, not invented latency SLA. Long-history CPU may occupy permits; HTTP timeout is not native cancellation.
- Docs plan links/phase statuses validated structurally during planning; feature tests not run until implementation authorized.

## Unresolved questions

- Product decisions: none. Native semantic gate, container/browser prerequisites, available desktop runtime and human visual approval are future execution dependencies.
