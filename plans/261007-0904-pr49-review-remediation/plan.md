# PR #49 Review Remediation

- Date: 2026-10-07. Status: Complete — all 16 findings fixed, scoped Linux verification passed. Approval: user explicitly requested review fixes; human PR/visual approval not implied.
- Advice: off; no controller consultation or lifecycle mutation.
- Scope: all 16 findings in [review](../reports/code-review-261007-0803-pr49-project-plans-dashboard.md), plus meaningful regression/qualification corrections.
- Historical dashboard phases remain receipt-attested; controller not consulted. Do not reopen/rewrite historical plan, phase, receipt, or evidence artifacts. This is a new corrective scope.
- Parent owns integration, commands, current docs, and this overview. Children never stage/commit, mutate controller state, edit sibling files, or run builds/tests/lint/formatters mid-flight.
- Actor policy: user clarified that defined actor roles/models take precedence; smaller overrides are optional. Implementation uses `fullstack-developer` with its configured model, independent review uses `code-reviewer`. No unavailable `smol`/`med` alias or arbitrary replacement.

## Parallel Ownership

| Slice | Actor/model | Findings | Writable paths | Status |
|---|---|---|---|---|
| Secure snapshots | fullstack-developer / configured | 1, 10 | server/src/fs/secure_path.rs | Verified on Linux; Windows source/tests cross-compiled |
| Parser and bounded scanner | fullstack-developer / configured | 2, 5, 6, 7, 11, 12 | server/src/plans/parser.rs; scan.rs; tests.rs; server/tests/plans_api.rs | Verified; independent review closed |
| Owner-bound watchers | fullstack-developer / configured | 3, 4, 9, 15, 16 | UI hook/tests; server fs watcher/subsystem/utils helper; WS pump/protocol; UI FsEvent type | Verified; independent review closed |
| Workflow/document UI | fullstack-developer / configured | 8, 13, 14 | WorkflowContextDeck/Sheet/Surface, MarkdownPreview, ProjectPlanDocument, ProjectPlansDashboard and corresponding tests | Verified; independent review closed |
| Qualification/integration | Parent | All | E2E fixture/spec; current docs; new remediation reports | Passed; [completion evidence](../reports/fix-261007-0904-pr49-review-remediation.md) |

Existing public plan DTOs and generic filesystem mode retain their contracts. A parent-approved additive watch-only FsEvent extension supplies authoritative target-relative endpoints; generic events retain their absolute fields and omit the new fields. Shared server watcher generations are directory-object-bound and independently leased. Connection registry, manual persistence, historical evidence, and unrelated files remain protected. Additional paths were explicitly assigned before writes; no sibling overlap.

## Acceptance

- Secure rooted traversal rejects linked ancestors/leafs on Windows; descriptor/named-entry/ancestor changes reject snapshots on supported platforms. No blanket feature disabling or pathname-only race boundary.
- Bounded listings avoid per-entry full-response reserialization.
- Progress matches one-to-one, unreadable opt-in suppresses decisive current phase completion, valid short GFM rows survive, labelled corroborated prose parses, Current status wins regardless of column order.
- Settled saves remain live; directory replacement rebinds handles; manual recovery retries missing watches; overflow setup cannot leak handles; coverage never silently claims a truncated required watch set is complete.
- Background overview failures preserve manual drafts; encoded local links resolve actual filenames; document Retry performs a request.
- Deterministic consumer-visible regressions plus real Rust/React smoke. Windows runtime and human visual approval remain explicit qualification limits unless actually exercised.
- Existing E2E atomic-save/draft assertions corrected without overwriting historical captures/review metadata.

## Verification Order

1. All implementation workers settle; parent integrates APIs and resolves conflicts.
2. Format affected files once; focused Rust/UI tests and typecheck; real API/browser smoke.
3. Parallel independent review; resolve substantive findings and rerun affected verification.
4. Update current docs/changelog and publish a new fix report; preserve historical receipts.

## Exercised Evidence

- Final scoped Linux checks: 71 filesystem unit tests, 26 parser tests, 2 WS pump/overflow tests, and 61 filesystem/API integration tests passed.
- Final UI checks: 13 files / 124 tests passed; UI and E2E TypeScript checks passed.
- Actual Rust/Vite/Chromium: six settled atomic saves, identical directory replacement, shared Explorer/root replacement followed by plans replacement and visible progress change on the final pinned implementation, missing-root restoration, registration failure/Reconcile recovery, target isolation, encoded filename, real Retry requests, desktop/mobile retained drafts, and truthful degraded coverage for a 32-component plan plus external evidence document.
- Deterministic Linux named-file replacement during read: first projection changed/unknown/null completion; next read readable/completed.
- Long listing: 1,500 directories under a 1,937-byte path; 215 ms debug-server observation, 2,095,960-byte JSON, 1,050 retained entries, response-bytes diagnostic. Not a production benchmark.
- Actual secure-path/watcher/event modules and secure-path tests compile for Windows in an isolated harness. Full server check blocked by native `ring` build prerequisite `lib.exe`; Windows runtime remains unqualified. Ordinary delete/recreate regression is Unix-only because Windows native watchers already retain delete-pending directory handles.
- All isolated API/browser services stopped; browser tab closed; temporary fixtures, syscall interposer, and Windows compile harness removed.
- No universal native-watch ABA or transport-timeout leak-free claim: notify registers by pathname; pre-existing timed-out WS subscription/late-ack behavior is unchanged and outside these fixes.
- Production container journey passed (1 test, 11.9 s) against final built SPA/Rust/Mongo services with `E2E_CAPTURE=0`; existing visual review/captures were not republished. Atomic refresh, typed draft preservation, and actual target inventory assertions exercised.

## Unresolved Questions

None requiring product choice. Model availability and platform/tool prerequisites must be reported without substitution.
