# PR #49 Review Remediation

**Result: all 16 review findings implemented; scoped Linux verification passed.** Independent reviewers closed substantive follow-up findings. Windows runtime and human visual approval remain unqualified, not synthesized.

- PR: https://github.com/loidinhm31/dam-hopper/pull/49
- Starting reviewed head: `6d6f16242885e40bc5a0cc8a26bf18d044c9a349`.
- [Original findings](code-review-261007-0803-pr49-project-plans-dashboard.md); [corrective plan](../261007-0904-pr49-review-remediation/plan.md).
- User-approved corrective scope; advice off. Historical dashboard phase/receipt/evidence artifacts untouched. No staging, commits, push, or controller mutation.
- Four parallel `fullstack-developer` implementation slices; four parallel `code-reviewer` slices. Defined actor models retained, no arbitrary `smol`/`med` substitution. Parent integrated, exercised runtime, handled qualification, and published current docs.

## Findings Closed

| Finding | Implemented behavior | Evidence |
|---|---|---|
| 1 — Windows linked ancestors | Strict native rooted single-component traversal rejects ancestor/leaf reparse traversal; pinned-handle enumeration | Source review and actual-module Windows cross-compilation; no Windows runtime claim |
| 2 — Quadratic trimming | Exact allocation-free serialization byte accounting; maximal whole sorted prefix under 2 MiB | Long-path/escaped-name API regression and real 1,500-directory listing |
| 3 — Lifetime churn | Consecutive unsettled accounting resets on settlement/scope/recovery | Hook transitions; six separated atomic saves in actual app |
| 4 — Replaced directory | Structural endpoints retire/rebind affected handles independently of DTO identity | Hook regression; identical directory replacement followed by visible new child |
| 5 — Reused progress row | Identity hints must agree; rows map one-to-one; duplicates/conflicts cannot decisively complete multiple phases | Parser/API regressions and live identity-conflict fixture |
| 6 — Unreadable progress fallback | Preserve phase identity/captured evidence; current statuses unknown/progress and completion null | Real symlink API fixture and live projection |
| 7 — Short GFM denominator | Optional edge pipes and bare single-cell body rows preserved with trailing padding | Parser/API regressions; live declared=2, completed=1, unknown=1, fraction=0.5 |
| 8 — Lost drafts | Retained overview failures show a banner without replacing manual form subtrees; initial no-data failure stays explicit | Six capture/edit/note regressions; desktop/mobile typed drafts through actual query failure/recovery |
| 9 — False recovery | Reconcile actually retries missing watches; live requires complete installed coverage and fresh read | Hook regression; real transport registration attempts 1→2 and repaired warning |
| 10 — Replaced named snapshot | Descriptor identity/size/high-resolution modification/change times plus named-entry/ancestor revalidation | Real filesystem tests; deterministic Linux read interposer returned changed/unknown/null, then fresh completed |
| 11 — Labelled prose | Supported whole completion grammar applies to Current status; malformed/negated restrictions remain unsupported; positive u32 identifiers with bounded range cardinality | Parser/API regressions; live supported, negated, and phase-129 reports |
| 12 — Status precedence | Explicit Current status precedes generic Status regardless of order | Parser/API regressions and live column-priority fixture |
| 13 — Encoded filenames | Split literal fragment, decode pathname once, validate decoded containment, resolve actual filename | Query/document regressions; actual encoded-space link loaded file contents |
| 14 — Retry no-op | Explicit document refetch replaces same-state navigation | Behavioral request/recovery test; actual Retry emitted strict `fs:read` requests |
| 15 — Overlapping setup | Serialized reconciliation with pending registration ownership and originating-generation cleanup | Deterministic pending/overflow/retirement/generation regressions |
| 16 — Silent watch cap | Required document ancestors retained in full requirements; exceeding 33 reports degraded/uncovered paths | Hook regression; actual 32-component plan plus external evidence rendered degraded coverage |

## Independent-Review Corrections

- Guarantee a distinct post-install request even when initial no-data reads remain pending.
- Missing `plans/` is live parent-only coverage; root creation installs new directory watches.
- Watch-only events supply optional authoritative `targetRelativePath`/`targetRelativeFrom`, including `.` for root-self. Existing absolute fields remain unchanged; generic events omit new fields. Legacy structural events conservatively rebind.
- Shared server watchers use directory-object-bound generations and exact subscription leases. Retained Explorer subscriptions cannot force replacement plans onto an old-inode watcher; old cleanup cannot release a new generation.
- Open directory pins prevent numeric identity recycling across deletion while old generations remain leased. Real OS regressions cover rename/replacement, Unix deletion/recreation, and sandbox-clear ownership.
- Whole bounded prose grammar rejects `incomplete`, leading negation, malformed ranges, and unsupported clauses; sparse/high phase identifiers remain supported. Independent exact administrative overall scalars retain their existing semantics.

## Exercised Verification

| Command/scenario | Observed result |
|---|---|
| `cargo test --lib fs::` | 71 passed, including strict snapshots and real notify ownership transitions |
| `cargo test --lib plans::` | 26 passed |
| `cargo test --lib fs_event_` | 2 passed: target-relative pump behavior and overflow cleanup |
| `cargo test --test plans_api --test ws_fs_subscribe --test fs_sandbox --test fs_mutate --test fs_write_streaming --test fs_upload` | 61 passed across six suites |
| Focused Vitest: plans query/hook/timeline, workflow integration/surface/deck/sheet, MarkdownPreview, document/dashboard/folder/overview/timeline organisms | 13 files / 124 tests passed |
| `pnpm exec tsc -p tsconfig.json --noEmit` | Passed |
| `pnpm exec tsc -p tsconfig.e2e.json --noEmit` | Passed after final journey selector correction |
| Exact-source isolated `cargo check --target x86_64-pc-windows-msvc --tests` | Secure-path/watcher/event modules and secure-path tests cross-compiled; current Windows identity helper included |
| Production image build from final source | Passed |
| `E2E_CAPTURE=0 CONTAINER_ENGINE=podman pnpm test:e2e project-plans-dashboard/project-plans-dashboard.spec.ts` | 1 passed; Playwright reported 11.9 s total |
| Actual Rust/Vite/Chromium | Saved updates, replacement directories/root, parent-only missing-root restoration, watch repair, target isolation, encoded document, Retry, retained desktop/mobile drafts, deep external-document coverage |
| Deterministic atomic named-file replacement during real read | First progress snapshot changed with unknown/null completion; next read readable/completed |
| Real long listing | 1,500 entries under a 1,937-byte path; 215 ms debug-server observation; 2,095,960-byte JSON; 1,050 retained entries; response-bytes diagnostic |

The listing observation is not a production benchmark or an identical-fixture speedup claim. Existing unrelated unused `atomic::Ordering` warning in PTY tests remains.

## Production Journey Corrections

- Fixture writer uses same-directory `mktemp` and atomic `mv`, with positional shell arguments and cleanup trap.
- Progress mutation asserts automatic in-progress→completed transition and phase counts without clicking Refresh.
- Manual mode creates a real typed unsaved draft and verifies it after switching away/back.
- Real project selection asserts the same relative plan inventory changes 5→1→5, rather than checking only a secondary REST response.
- Folder/document/timeline browsing, source-file non-mutation, and desktop/mobile/narrow viewport assertions passed against built SPA + production Rust + isolated MongoDB.
- Capture publishing disabled explicitly to preserve existing screenshots, evidence metadata, and human review record. Browser smoke visually inspected actual desktop/mobile surfaces; this does not constitute the required human ACCEPTED decision.

## Documentation and Cleanup

Updated current architecture, workflow client/surface, filesystem/WebSocket API references, and changelog. Corrected misleading initial complete-qualification/fallback claims without rewriting historical sealed phase/receipt artifacts.

All isolated API/browser services stopped; browser tab closed; temporary fixtures, syscall interposer, and Windows compile harness removed. Production fixture disposal completed through the passing application journey. Unrelated user files and Git index untouched; no source scaffolds retained.

## Qualification Limits / Next Steps

- Full Windows server cross-check blocked in `ring` native build: missing MSVC `lib.exe`. Actual changed modules/tests cross-compile; native Windows traversal, junctions, notification delivery, and timestamp behavior still require Windows execution.
- Unix ordinary delete/recreate fixture is not a Windows fixture: existing native Windows directory watchers retain handles and `RemoveDirectoryW` defers deletion until handles close ([Microsoft reference](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-removedirectoryw)). Rename/replacement and generation-clear regressions remain cross-platform.
- No full repository-suite claim. No universal native notify replace-and-restore ABA guarantee; notify registers by pathname with pinned-object checks before/after installation.
- Pre-existing WS subscription timeout/late-ack orphan-ID boundary unchanged and outside the reviewed pending-overflow hook fix. Successful late-resolution regressions do not certify universal transport leak-freedom.
- Human visual-review status remains pending. Obtain fresh human-reviewed captures separately before PR approval; do not infer approval from green assertions.

## Unresolved Questions

None requiring product choice. Review these corrections; commit/push only if explicitly requested.
