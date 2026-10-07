# Code Review: Phase 01 — Native Semantics and Contract Proof

## Code Review Summary

### Scope
- Files reviewed:
  - `plans/261005-2106-editor-git-blame-annotations/contracts.md`
  - `plans/261005-2106-editor-git-blame-annotations/plan.md`
  - `plans/261005-2106-editor-git-blame-annotations/progress.md`
  - `plans/261005-2106-editor-git-blame-annotations/phase-01-native-semantics-and-contract-proof.md`
  - `docs/architecture/workbench-files-editor-and-git.md`
- Lines of code analyzed: ~550 LOC (contracts, architectural docs, plan specifications)
- Review focus: Phase 01 native semantics and contract proof, security (path containment, bounds, zero-write immutability), performance (concurrency semaphore, debounce, memory ceilings), architecture (libgit2 ODB decoupling, event-driven refresh), YAGNI/KISS/DRY
- Updated plans:
  - `plans/261005-2106-editor-git-blame-annotations/phase-01-native-semantics-and-contract-proof.md`
  - `plans/261005-2106-editor-git-blame-annotations/plan.md`
  - `plans/261005-2106-editor-git-blame-annotations/progress.md`

### Overall Assessment
Score: **9.8/10**

Phase 01 establishes an exceptionally thorough, empirically verified contract foundation for native editor Git blame annotations. Rather than relying on documentation assumptions or CLI behaviors, the implementation ran a comprehensive 5-suite native probe against installed `git2 = 0.19` (`libgit2 1.8.1`).

Key native edge behaviors proven and codified into contracts:
1. **Empty buffer short-circuit**: `git_blame_buffer` requires non-empty buffer, returning `GenericError` (`invalid argument: 'buffer && buffer_len'`) on empty input. Codified server short-circuit directly returns status `empty` with 0 ranges.
2. **CRLF normalization**: Git ODB blobs normalize text lines with LF (`\n`). Raw CRLF (`\r\n`) in buffer causes native `blame_buffer` to diff `\r` against LF blobs, falsely marking 100% of lines as uncommitted zero OIDs. Codified server normalization strips `\r` before passing bytes to `blame_buffer`.
3. **Display-row mapping**: Trailing newline adds terminal empty row in Monaco; native blame emits explicit uncommitted range (`commitIndex: null`) rather than incorrectly inheriting attribution from preceding commit.
4. **Renames**: Libgit2 `blame_file` automatically tracks committed renames back to origin commit and path. Staged uncommitted renames resolve old path baseline via `repo.diff_tree_to_index` + `DiffFindOptions::renames(true)`.
5. **Arbitrary commit inspection**: `repo.find_commit(oid)` reads directly from ODB without branch reachability or mutation constraints, returning full body and signatures.
6. **Zero-write immutability**: Verified zero modifications to working tree, index, or Git refs. Disposable probe removed cleanly.

---

### Critical Issues
None.

---

### High Priority Findings (Warnings)
None.

---

### Medium Priority Improvements
1. **Client Empty-Buffer Range Handling (Phase 03/04)**:
   - When buffer is empty, server returns status `"empty"`, `bufferLineCount: 1`, and `ranges: []`.
   - In Phase 04 gutter rendering, ensure client logic handles `ranges: []` cleanly without attempting binary search or throwing index-out-of-bounds errors on line 1.
2. **Libgit2 Rename Matrix Boundary in Staged Renames (Phase 02)**:
   - `DiffFindOptions::renames(true)` via `diff.find_similar` can have quadratic complexity if an index contains tens of thousands of staged files.
   - When implementing Phase 02, consider constraining similarity search or setting sensible threshold limits on rename detection.

---

### Low Priority Suggestions (DRY / Minor Cleanup)
1. **Staged Rename Exact Target Path Verification**:
   - In staged rename handling, verify `delta.new_file().path()` strictly matches the validated repo-relative path before extracting `delta.old_file().path()`.
2. **Centralize Zero-OID Constant**:
   - Define a shared constant (e.g. `GIT_ZERO_OID = "0000000000000000000000000000000000000000"`) across Rust and TypeScript DTO layers to eliminate redundant magic strings.

---

### Positive Observations
- **Empirical Native Proof**: Real executable fixture probe (`git_blame_probe.rs`) executed and verified before locking wire contracts.
- **Clean Tooling Hygiene**: Probe created, executed, and deleted cleanly; no leftover development artifacts in repository.
- **Strict Concurrency & Memory Bounds**: Global 2-worker semaphore without unbounded queuing (returns 503 if busy); <5 MiB buffer ceiling; 32 MiB route-specific body limit; 250ms client debounce.
- **Event-Driven Refresh Architecture**: Avoids CPU/battery drain from background polling or file watchers; invalidation triggers strictly on window focus, visibility restoration, source remount, or explicit user refresh.
- **Clean Decoupling of Inspection vs Mutation**: Inspecting arbitrary commits via ODB does not weaken branch CAS or push lease invariants.

---

### Recommended Actions
1. Advance to Phase 02 (Native blame and read-only Git API endpoints).
2. Implement backend module `server/src/git/blame.rs` adhering strictly to the 13 native attribution steps in `contracts.md`.
3. Add permanent server unit tests covering the 5 probe scenarios (empty buffer, CRLF normalization, display row mapping, committed & staged renames, ODB lookup).

---

### Validation Commands & Results
| Command | Result | Details |
|---|---|---|
| `cargo test` | PASS | 1,800 passed, 0 failed, 6 ignored (55 suites) |
| `pnpm --filter @dam-hopper/ui test` | PASS | 2,325 passed, 0 failed (302 suites) |
| Native probe execution (`cargo run --example git_blame_probe`) | PASS | 5/5 test suites passed (Deterministic blame, Line endings/CRLF, Renames, Path frames, ODB reads) |
| `git status` | CLEAN | Disposable probe removed cleanly; expected plan/contract updates only |

---
### Evidence-to-Contract Mapping Table
| Contract Rule | Contract Section & Pinned Algorithm | Exact Probe Input | Assertion | Result |
|---|---|---|---|---|
| **Empty buffer** | `contracts.md` §2 (`GitBlameResponse`), §4.3 (Empty buffer short-circuit) | `blame.blame_buffer(b"")` against valid text file blame baseline | `match blame.blame_buffer(b"") { Err(err) => { assert_eq!(err.code(), ErrorCode::GenericError); assert!(err.message().contains("invalid argument: 'buffer && buffer_len'")); } }` | PASS — libgit2 returned `GenericError` (`invalid argument: 'buffer && buffer_len'`), proving zero-length buffer reject and validating server short-circuit (`status: "empty"`, `ranges: []`, `commits: []`, `bufferLineCount: 1`) without native invocation |
| **CRLF normalization** | `contracts.md` §4.4 (Line ending normalization) | Raw CRLF: `blame.blame_buffer(b"line1\r\nline2\r\n")` vs committed LF blob; Normalized LF: `blame_crlf.blame_buffer(b"crlf1\ncrlf2\n")` vs committed blob | Raw CRLF: `b_crlf.get_line(1).unwrap().final_commit_id().is_zero() == true` (100% false uncommitted); Normalized LF: `assert_eq!(b_lf_matching.get_line(1).unwrap().final_commit_id(), c_crlf)` | PASS — Raw CRLF marked 100% lines uncommitted zero OID (`0000000000000000000000000000000000000000`) due to `\r` diff against LF blobs; stripping `\r` matched committed OID `505fe47810b1fbde13ab84655646369ec0da0c7f` cleanly across all lines |
| **Display rows** | `contracts.md` §2 (`GitBlameRange`), §4.5 (Trailing newline & display rows) | Single newline: `blame.blame_buffer(b"\n")`; No trailing newline: `blame.blame_buffer(b"line1\nline2")` vs committed `b"line1\nline2\n"` | Single newline: `b_blank.get_line(1).unwrap().final_commit_id().is_zero() == true`; No trailing newline: line 1 committed, line 2 uncommitted (`final_commit_id().is_zero() == true`) | PASS — Single newline produced 1 hunk with zero OID; omitting trailing newline emitted 2 hunks (line 1 committed, line 2 zero OID); validates Monaco display-row partition and explicit uncommitted terminal range (`commitIndex: null`) without inheriting previous commit |
| **Committed renames** | `contracts.md` §4.8 (Committed renames) | `original.txt` committed as `c1`, renamed to `renamed.txt` committed as `c2`; `repo.blame_file(Path::new("renamed.txt"), Some(&mut opts))` | `assert_eq!(blame_renamed.get_line(1).unwrap().final_commit_id(), c1)` and `hunk.path() == Some("original.txt")` | PASS — 1 hunk covering lines 1-3 attributed to original commit `a5ab42c12db446381f951032232c751807103e1d` with origin path `"original.txt"` tracked automatically across commits without reserved flags or manual history walking |
| **Staged renames** | `contracts.md` §4.9 (Staged renames) | `renamed.txt` staged as `staged_rename.txt` in index (HEAD has `renamed.txt`); `diff_tree_to_index` with `find_similar(Some(&mut diff_opts))`; blame old path at HEAD + `blame_buffer(b"alpha\nbeta\ngamma\nline4_staged\n")` | `blame_file("staged_rename.txt")` returns error at HEAD; `diff.find_similar` yields `delta.status() == Delta::Renamed` and `delta.old_file().path() == Some("renamed.txt")`; `blame.blame_buffer(new_bytes)` attributes lines 1-3 to commit `c1` and line 4 to zero OID | PASS — Staged rename baseline resolved to `Some("renamed.txt")` via HEAD→Index diff; blaming old path at HEAD with new buffer attributed lines 1-3 to commit `a5ab42c1...` and line 4 as uncommitted zero OID |
| **ODB reads** | `contracts.md` §2 (`GitCommitDetails`), §4.12 (Arbitrary commit read via ODB) | Arbitrary/detached commit `c1` with multiline body and timezone offset (`offset_minutes: 60`), detached HEAD; query via `repo.find_commit(c1)` | `author.name() == "Alice Author"`, `author.when().offset_minutes() == 60`, `summary == "feat(test): summary line"`, `body.contains("Detailed multiline body paragraph 1.")` and `body.contains("Paragraph 2 with more info.")` | PASS — Exact ODB lookup retrieved full commit body and author metadata/timezone for arbitrary OID without local branch reachability constraints or lock contention, preserving clean decoupling from mutation CAS gates |
| **No-write immutability** | `contracts.md` §1 (Scope and defaults), §4.1-4.2 (Native attribution immutability) | Working tree statuses (`repo.statuses(None)`), index checksum / tree OID, HEAD target OID, and reflog inspected before and after blame/inspection operations | `repo.statuses(None).unwrap().len() == 0`, HEAD OID pre == post, index tree pre == post, working directory file contents byte-identical | PASS — `git status` completely clean (0 changes); working tree, index, refs, and HEAD verified unchanged; zero subprocess spawning (pure native `git2`), zero disk mutations, and clean disposable probe removal |

---

### Metrics
- Score: **9.8/10**
- Type / Architecture Safety: 100% compliant with monorepo invariants
- Test Pass Rate: 100% (1,800 backend tests, 2,325 frontend tests)
- Critical Issues: 0
- Warnings: 0
- Suggestions: 2 medium, 2 low

---

### Unresolved Questions
None.
