# Resolver acceptance and evidence matrix

**Status: all implementation checks pending.** Brainstorm probes are historical raw-Git evidence only, not DamHopper feature proof. No feature tests/prototypes/builds run during planning. Source: [brainstorm AC 1–12](../reports/brainstorm-261019-1326-git-conflict-resolver.md#acceptance-criteria-and-planned-validation). Contract: [design](./design-contract.md).

## Required coverage

| Source AC | Required behavior and negative boundary | Owning phases | Concrete evidence / pass oracle |
| --- | --- | --- | --- |
| AC1 | CLI-started merge/rebase/cherry-pick/revert opens from Changed Files or operation status into dedicated floating panel, never editor tab | 02,04,07,08,09 | Generate each real conflict through terminal in isolated app repository; activate both entry points; inspect floating root/operation labels and unchanged editor tab inventory |
| AC2 | Drag/resize/maximize/hide/reopen retains text/history; focus, stacking and shortcuts; narrow pane selection | 05,07,09 | Actual app, IDE/terminal/compact shell transitions; files/tool/resolver overlap; Monaco widgets consume Escape before resolver; no terminal input leakage; narrow viewport all actions reachable; window resize/font/zoom layout |
| AC3 | Immutable sources; accept left/right, ignore, both orders, whole-file, base compare, nonconflicting changes; manual cross-block edits plus undo/redo preserve text AND decisions | 01,06,07,09 | Deterministic source/result byte fixtures; real Monaco typing, paste, boundary edit, toolbar/native shortcut/context-menu undo/redo; metadata-only Ignore/Mark reviewed; empty text, branch-after-undo; sources stay unchanged |
| AC4 | Existing partial worktree resolutions survive open/switch/hide; destructive replacement/close confirmation | 01,05–09 | CLI edits before open; partially removed/diff3/zdiff3/literal markers and marker-free edits; open/switch shell/target/file without byte loss; cancel rebuild/discard leaves draft; capacity refusal does not evict dirty draft |
| AC5 | Explicit file Apply & stage only intended file/deletion; separate Continue; repeated rebase stop | 03,04,08,09 | Query `git ls-files --stage`, `git ls-files -u`, blob OID/mode and worktree bytes before/after; unrelated conflicted/staged file preserved; last-file apply does not continue; continue opens next stop in same panel |
| AC6 | Binary whole-side exact blob + checkout-compatible worktree; delete/modify safe; complex cases visible with truthful handoff | 01–03,08,09 | Real binary conflicts choose each side; stage-0 OID/mode equals chosen stage and filesystem equals qualified checkout representation; choose deletion on either missing side; symlink/gitlink/complex rename/invalid path visible and no unsafe action |
| AC7 | LF/CRLF/no-final-newline, modes and qualified attributes round trips; unsupported encodings not lossy | 01–03,06,09 | Exact raw byte assertions, Git blob/mode assertions; LF/CRLF/mixed endings/lone CR/BOM/Unicode/trailing newline/executable; clean/smudge round-trip only if explicitly qualified; unknown filter/encoding rejects before write |
| AC8 | Stale preconditions reject and preserve drafts; truthful write-success/stage-failure; no unsafe rollback or isolation claim | 01–03,05,08,09 | Change stages/worktree/type/attributes/HEAD/operation after snapshot; assert zero mutation on rejection; injected failure **after** successful worktree write; inspect disk/index response facts; external edit afterward not rolled back; lost HTTP outcome refreshes without replay |
| AC9 | Profile/generation/project/worktree/nested-root isolation; unavailable targets disable writes without discarding draft | 02–05,07–09 | Two servers with same names/paths; delayed old responses; reconnect/server URL change/root switch; same file in linked worktrees/nested roots; stale apply never hits replacement target; unrelated root/index/ref state unchanged |
| AC10 | Four operation-specific continue/abort; configured-editor terminal handoff; hooks/signing and dirty drafts/history preserved | 01,04,05,08,09 | Real four-operation/repeated-stop/sequencer/git-am cases, failing hook, signing success/failure and bounded hanging child; required message editing uses Git's configured editor in captured owner/server/repository/worktree/root terminal, no message form/adapter, handler interactive editor or PTY injection. Inspect operation/full-index/worktree after every attempt and terminal return, including cancellation and hook-modified bytes; handoff is not completion/zero-write. Failed refresh stays unknown/no replay; retain stale recovery until explicit fresh-snapshot import/review. Changing stage-0 after status requires stale/no command |
| AC11 | Measured total payload/line/editor/draft bounds; over-limit entries visible without freezing | 01,02,05–07,09 | Record required web/Linux Tauri hardware/version, payload/lines/max line length/hunks/drafts, CPU/main-thread stall and heap metrics; boundary/over-bound fixtures; grow existing dirty text/history and visibly refuse prospective over-budget input without losing accepted edits or Undo/Redo; no eager all-blob summary; responsive cancel/handoff; Windows-native measurements separately Pending/unqualified |
| AC12 | Real application web AND Linux-native host qualification for initial release; fresh local captures plus explicit human review; Windows-native client separately pending | 07–09 | Production SPA/server/auth fixture E2E plus actual Linux Tauri launch and interactions; full-viewport PNG/evidence.json/review.md per policy; human records explicit `ACCEPTED`/`REJECTED` verdict (`ACCEPTED` required to pass; missing shared safety, Linux, or human visual proof blocks initial release). Windows-native client qualification is separately Pending, nonblocking, and explicitly unqualified; cannot claim resolver Windows support qualified until executed. Client OS exception does not waive backend/server OS process safety. Shared web/native architecture unchanged |

## Additional discovered cutover invariants

| ID | Boundary | Evidence |
| --- | --- | --- |
| CUT1 | No generic per-row/context/bulk stage of unmerged entries, including direct app stage endpoint | Mixed batch preflight rejects before any path stages; nonconflict staging still works; terminal `git add` treated as external action |
| CUT2 | One coordinated UI/server cutover contract and one production renderer; no legacy fallback or compatibility shim | Reference inventory before export changes, compile all consumers simultaneously, old unchecked request denied, remove obsolete parser/export/dead comments; zero legacy resolver write fallback or compatibility shim in server API; zero incompatible intermediate deployment; preserve Android input suppression behavior |
| CUT3 | Successful response cannot erase newer typing or auto-close new conflict | Delay apply response, type new draft edit, return response; capture submitted revision and retain later edit; operation changes refresh without stale callback side effects |
| CUT4 | Summary/detail/body limits and path safety enforced server-side | Oversize requests return documented status, limits applied before blob materialization; traversal, symlink/reparse ancestors, unsupported raw index paths cannot escape root or map to empty path |
| CUT5 | Coordinated application index/ref mutations without self-deadlock | Concurrent apply/stage/operation commands for actual same index serialize/reject; linked worktree indices independent where safe; shared-ref operation coordinated; Git subprocess not invoked under manually held index.lock |

## Authoritative qualification matrix

All runtime evidence currently **Pending**. Required/deferred describes release policy, not satisfied checks; [Phase 01](./phase-01-feasibility-and-contract-gates.md) inventories early availability and [Phase 09](./phase-09-qualification-and-documentation.md) collects final proof.

| Scope / Platform | Initial release rule | Evidence status | Mandatory criteria / Boundaries |
| --- | --- | --- | --- |
| Authenticated production web | Required / Blocking | Pending | Production SPA/server/auth fixture; real entry, draft, write and operation flows |
| Linux-native client (Tauri) | Required / Blocking | Pending | Actual Linux Tauri interactions/lifecycle/input/focus/terminal return; Chromium is not native proof |
| Fresh local captures | Required / Blocking | Pending | Fresh full-viewport artifacts and evidence metadata under existing capture policy |
| Human visual review | Required / Blocking | Pending | Recorded human ACCEPTED; missing/REJECTED blocks, automation cannot synthesize it |
| Applicable supported-server safety | Required / Blocking | Pending | Bounded process/output/cleanup, path containment and Git locking for advertised server support; client deferral supplies no waiver or new server-platform support promise |
| Core acceptance & cutover invariants | Required / Blocking | Pending | AC1–12/CUT1–5 within approved initial scope; no omitted core safety or incompatible deployment |
| Windows-native client (Tauri) | Deferred / Nonblocking | Separately Pending | Explicitly unqualified until separately tested; cannot claim resolver Windows-native support qualified |

Initial release/Phase 09 may pass only when every required row passes, even if Windows-native client qualification remains separately Pending. Linux/human/shared-safety gaps never qualify for that exception.

## Fixture inventory to construct during implementation

1. Real temporary repositories, deterministic local identity, per-fixture isolation and explicit tool/platform versions. Configure hooks/signing **only per scenario**: neutral fixture setup is not evidence of production hook/signing handling. Authenticated production web and Linux-native host fixtures are required; Windows-native client fixture is separately deferred and nonblocking.
2. At least two conflicted files plus unrelated staged and unstaged files, preserving every untouched stage/OID/mode/path.
3. Four operation fixtures, repeated rebase and multi-commit cherry-pick/revert; conflictless active operations, no active operation with unmerged entries, unsupported `git am`, unknown metadata state. Real editor-required commit handoff scenario: hand off to exact owning repository/worktree terminal, configured editor invocation, preserved hooks and signing; post-terminal return and post-command attempt authoritative refresh of operation, index, and worktree state (including a fixture where a hook or interrupted command modifies worktree bytes without completing the operation); retained stale drafts requiring refreshed review before application.
4. Text shapes: repeated lines, adjacent deletions, overlapping/same-offset insertions, add/add absent base, multiple separated blocks, empty source/result, whitespace-only, EOF insertion/deletion and long line. Include differing EOLs/BOM/final newline and mode change.
5. Binary and delete/modify, unsupported invalid UTF-8/encoding/custom filter, symlink/submodule/rename, non-UTF-8/path edge where platform supports it.
6. Two profile targets, linked worktrees and nested repos; obsolete owner/generation/server URL, missing target/root, delayed snapshot/apply responses.
7. Controlled read-change/mutation races and boundary failure injection. Preexisting lock normally proves busy rejection, not necessarily post-write failure; inject correct phase.

## Verification commands to specialize after implementation

Run focused checks once edits for a phase settle; no repeated broad suites mid-edit. Actual filters/paths use newly introduced test names, not imaginary existing tests.

```sh
# Backend: new conflict/operation module behavioral tests, then affected integration suite
cargo test --manifest-path server/Cargo.toml git::conflict
cargo test --manifest-path server/Cargo.toml git::operation
# Shared UI: model/store focused tests and real Monaco component scenarios
pnpm --filter @dam-hopper/ui test -- <changed-test-paths>
pnpm --filter @dam-hopper/ui test:browser -- <resolver-browser-test-path>
pnpm --filter @dam-hopper/ui build
# Full application evidence; proposed spec name, create in Phase 09
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- git-conflict-resolver/git-conflict-resolver.spec.ts
# Actual native host; not certified by browser tests
pnpm dev:native
```

Git-state assertions use argument-array commands in fixture code, including `git ls-files -u/-s -z`, `git rev-parse`, `git cat-file` and raw filesystem bytes. Do not parse line-delimited paths unsafely. CLI probes and actual host interactions are required in addition to passing tests. Use existing E2E authentication/seed/application fixture; `--no-auth` only for explicit isolated loopback smoke, not authenticated E2E claims.

Final gate: run relevant server/UI checks and real app scenario covering changed paths, inspect local captures, update implementation docs/changelog with **actual** support boundaries. Record command, result, commit/source fingerprint, versions/platform, fixture and evidence artifact per run. Authenticated web, Linux-native launch, and human visual `ACCEPTED` verdict are mandatory for initial release; missing Linux, shared safety, or human proof blocks release. Windows-native client qualification remains separately Pending, nonblocking, and explicitly unqualified. A failed or unavailable required gate prevents all-AC completion; never silently waive it.

## Unresolved technical gates

Exact resource budgets, engine/history implementation, filter/encoding support, safe noninteractive subprocess execution with editor-required detection, and platform qualification (web + Linux-native host required; Windows-native client separately Pending) are Phase 01/09 evidence-based decisions, not additional product scope. No acceptance row is satisfied merely by writing this plan.
