# Code Review — Read-only OMP Session Changes Panel, Cycle 2

## Score: 4/10 — REQUEST CHANGES

Useful local fixes landed, but they do not close the original end-to-end safety defects. C1 is resolved at source level; C6's old-byte relabeling is repaired. The other critical areas remain open or partially repaired, including resource admission, capture/publication races, target authority, historical proof, truthful comparison and qualification.

## Scope / evidence

- Inspected all 11 requested files, plus relevant `main.rs`, `store.rs`, `binding.rs`, `root.rs`, `absence.rs`, `text_diff.rs`, query/client/decoder modules, read-only viewer, file list, adapter, router, selected tests and qualification artifacts.
- Compared against `plans/reports/code-review-261030-1534-session-changes-panel.md` and frozen `plans/261030-1215-session-changes-panel/contracts.md`.
- Source review only. No implementation/plan-state edits, builds, tests, linters or browser runs by this reviewer. This report is the only file created.
- Failure descriptions below are source-derived **[INFERENCE]**, not independently reproduced runtime failures. Confidence high unless noted. Source-level repair is not runtime qualification.
- `PostFixTestVerification` separately reports: 7 integration tests across five suites, 20 feature unit tests, six browser tests across three files passed; E2E typecheck had zero errors. Reports two Rust unused-import warnings and six React act warnings. These results are attributed peer evidence, not checks run by this reviewer. Peer confirms real host Arrow-key navigation and >200 rows are unexercised.

## Cycle 1 disposition

| ID | Cycle 2 disposition |
|---|---|
| C1 | Source-level resolved: router always mounted; handlers obtain late-wired service from runtime. Real-binary startup regression still desirable. |
| C2 | Partial: real connection generation captured; actual semantic ID used when available. Terminal-ID/default-profile fallbacks and missing retained-session selection remain. |
| C3 | Partial: binding precedes bearer activation; `.` filesystem fallback removed; preflight added. Binding still raw launch cwd, not authorized project/worktree/generation. |
| C4 | Open: no atomic reservation, identity operation fence, cancellation/publication fence or permit ownership in blocking work. |
| C5 | Partial: activation reuses receipt; receipt validates registration/baseline/nonce/TTL; old failure no longer directly destroys active from-now. Original failure latch, full control identity and settled recovery still incomplete. |
| C6 | Principal old-byte bug repaired: new inventory installed; comparison/revision reset. Full closure blocked by concurrent overwrite/root/failure-latch/accounting defects below. |
| C7 | Partial: from-now adds post-capture byte counter; directory vector capped. Pre-allocation/global identity/current/response accounting remains absent. |
| C8 | Partial: truncation invalidates directory certificate; nested `.git` directories pruned. Read errors/drift/descriptor-safe namespace proof remain unresolved. |
| C9 | Partial: refresh consults current trie; some nontext handling improves. Returned list/detail still contradict refresh, oversize equality/count/renderability defects remain. |
| C10 | Partial: list/detail check baseline before domain call. Refresh/publication/detail races, nondefault roots and pagination remain. |
| C11 | Partial: Radix dialog/focus primitives adopted; native listener moved to bubble. React delegated child keyboard handlers still blocked; earlier capture listeners unguarded. |
| C12 | Only files-loading spinner added. Initial refresh, settled recovery, truthful errors/current coverage and source-cache retirement remain absent. |
| C13 | Optional entrypoint assertion repaired. Real OMP/Monaco/race/bounds/lifecycle qualification and truthful evidence remain missing. |

## Critical issues — MUST FIX

### C2. Launcher still invents identity when semantic evidence is missing

**Evidence:** `packages/ui/src/components/pages/WorkspacePage.tsx:692-739` accepts a string, falls back to ambient/default profile at 696, and sets OMP session to `terminalId` at 730. Semantic row is not checked against selected terminal incarnation/current generation. Fallback list response is checked for connection generation, not a newly changed sessionMap incarnation. No retained-session selection occurs.

**Impact:** Exited/stale semantic sessions query the wrong baseline or create a from-now record under invented OMP identity. A fresh replacement can be paired with old metadata; a stale pane callback can attach to a newer connection.

**Correction:** Carry exact displayed terminal owner/instance; validate incarnation after awaits and semantic row generation/incarnation. Missing live OMP identity must use the bounded retained selector or explicit unavailable state, never a terminal ID/default owner.

### C3. Production target binding remains outside the authorized-target contract

**Evidence:** `server/src/pty/manager.rs:1750-1759` binds only launch cwd plus optional names. `control.rs:149-160` and `api/session_changes.rs:170-197` treat that cwd as project root. `binding.rs:18-33` has no production caller; duplicate binding types persist. No query revalidates current configured project/worktree/workspace generation. Keys still independently admit different `root_id`s (`store.rs:14-20`).

**Impact:** Untargeted terminals in any Git directory can capture outside configured projects; valid subdirectory launches fail the direct `.git` requirement. Project/worktree changes leave prior source accessible. One OMP identity can acquire unrelated root records instead of rootMismatch.

**Correction:** Publish one canonical, authorized project/worktree target descriptor before credential activation; bound untargeted matching to configured roots. Revalidate it on controls and every public query; resolve selected root from that authority, not arbitrary launch cwd.

### C4. Concurrent or cancelled capture can still replace the original or resurrect removed records

**Evidence:** `capture.rs:66-98,196-199` checks records, awaits scan, then unconditionally inserts. No initializing reservation is installed. `mode` is never enforced; only Resume lifecycle is refused (`:31`); expiry merely checks already-expired arrival (`:35-41`) without remaining monotonic capture/publication deadline. `_permit` stays in async caller (`:89-100`); same pattern in `comparison.rs:45-55` and `api/session_changes.rs:199-214`. Preflight runs synchronously before scan admission (`capture.rs:42-57`, public `:181-197`). `fail_session_capture` cannot tombstone an absent record (`capture.rs:337-344`).

**Impact:** Concurrent preparations recapture/overwrite; removal/failure during scan does not prevent later publication. Cancelling an await releases a permit while blocking I/O continues; two permits do not bound actual scans. Lookup-mode prepare can capture; filesystem preflight can block Tokio workers outside admission.

**Correction:** Atomically reserve identity/capacity and exact operation generation before all filesystem work; enforce lifecycle/mode/monotonic deadline. Hold owned permit/accounting in blocking closure; invalidate reservation on cancellation/removal/failure; publish only against the exact surviving reservation. Apply equally to from-now/comparison.

### C5. Origin-qualified control state remains inconsistent

**Evidence:** Activation checks baseline/nonce but not registration (`capture.rs:243-275`). Failure rejects null epoch, ignores baseline/version and never inserts absent tombstone (`:329-344`). From-now explicitly resets `original_failed = false` (`api/session_changes.rs:297`). Lookup ignores known epoch/current target (`control.rs:286-344`). Settled checks baseline now, but ignores requested origin/version, deduplicates before detached scan and discards failures (`:389-422`); dirty hint has no production consumer. Receipt's TTL check also runs on already-received originals (`capture.rs:304-312`).

**Impact:** Fail-before-prepare remains resurrectable; original failure history is lost on fallback; stale controls are not fully origin-qualified. Busy/failed settled scans are accepted and deduplicated without recovery. A delayed duplicate receipt after TTL can turn an acknowledged ready baseline unavailable rather than be idempotent.

**Correction:** Preserve independent immutable original-attempt state and active review pointer. Check exact origin/registration/baseline/nonce/epoch/TTL in permitted transitions; received duplicates remain idempotent. Tombstone pre-prepare failures within capacity. Retain bounded latest-turn dirty recovery; reject stale origins/epochs before scheduling.

### C7. Hard storage/identity/response limits still do not bound real allocations

**Evidence:** Capture reserves storage only after bytes exist (`capture.rs:98-136`); from-now reserves after capture and clone (`api/session_changes.rs:211-242`) and never checks max retained identities. It retains duplicate source in `baseline_inventory` and `active_from_now` (`:232-296`). Comparison clones baseline before permit acquisition and then clones each file again (`comparison.rs:30-68`); current manifest is unaccounted (`:299`). List/detail clone source under global lock (`:311-335,530-554`). Page/detail byte/concurrency constants have no consumers. Inventory caps one directory vector at 10,000 but reads files before trie insertion/admission (`inventory.rs:86-104,190-262`); manifest/queued metadata do not share prospective trie accounting.

**Impact:** Many zero-byte from-now identities are unbounded; retained and transient memory exceeds the reported 512 MiB counter. Concurrent/rejected refreshes can allocate huge clones; source responses lack promised admission/leases. TempDir exists, but actual captured bytes remain Vecs (`store.rs:67`, `inventory.rs:21`).

**Correction:** Reserve identities/storage before reading/allocation, charge baseline/current/candidate/metadata/scratch/response leases, release exact owners, and share immutable artifacts instead of cloning source. Enforce serialized page/detail limits and actual detail leases.

### C8. Directory absence certificates still certify unobserved stability

**Evidence:** `inventory.rs:78-100` uses pathname read_dir and silently discards individual iterator errors. No before/after directory/ancestry or child-set revalidation occurs; certificate only uses `!dir_truncated` (`:262`). Negative proof trusts that certificate (`absence.rs:257-264`). Nested detection uses pathname `.exists()` (`inventory.rs:151`), not descriptor-safe boundary validation; no tracked/gitlink inventory is built.

**Impact:** A directory read error or concurrent namespace change can certify a missed path absent and later label existing content a new addition. Per-file secure reads do not establish directory/root stability. Pruning ordinary nested repositories is a useful repair, not complete namespace proof.

**Correction:** Descriptor-safe bounded enumeration; invalidate certificates on any error/drift; revalidate directory identity/ancestry/observed children before publication. Include tracked eligibility and explicit gitlink/nested boundaries without traversing them.

### C9. Refresh, list and detail still disagree; added text files cannot render

**Evidence:** Refresh now proves deletion (`comparison.rs:154-194`), but public rows are recomputed independently and still label every baseline-only path Deleted/Absent (`:383-402`). Current trie is discarded at publication (`:299`). Oversize files have empty bytes and empty digest (`inventory.rs:190-204`); refresh compares nontext digests (`comparison.rs:81-85`), list compares empty bytes (`:344`). Added counts ignore kind/limit result (`:207-228,417-435`); countsComplete starts true without baseline/current coverage (`:74`). Missing detail sides are always Absent (`:538-563`). Newly added text rows have Unknown original kind, but renderable requires Text original (`:429,566-568`).

**Impact:** Ignored/unreadable/limited current files still display as deleted; two changed oversize files disappear as equal. Unsupported additions get confident zero/counts. Unknown original presence becomes absent. Every genuine added text file is withheld from Monaco. Text rendering limits are not applied consistently.

**Correction:** Build and retain one authoritative immutable row/detail artifact during admitted comparison. Separate known presence from admitted bytes; no empty placeholder equality. Use coverage-aware aggregate completeness and kind/text bounds for every change type; allow absent-to-present text diffs while preserving unknown sides.

### C10. Baseline/revision checks remain non-atomic; rows beyond 200 remain inaccessible

**Evidence:** Refresh ignores requested baseline (`api/session_changes.rs:305-332`). Scan reads baseline then publishes into whichever current record exists (`comparison.rs:30-41,279-299`). List/detail API prechecks release lock before domain lookup; detail itself lists, unlocks and reacquires without revision recheck (`:510-528`), then echoes requested revision (`:574`). Detail requests 100,000 rows but pagination clamps to 200 (`:480,510`). Panel always requests cursor null, limit 200 and ignores nextCursor (`SessionChangesPanel.tsx:69-85`). Public status/refresh/files/detail hardcode root `.` (`api/session_changes.rs:104,329,376,447`).

**Impact:** Old scan/content can be returned under replacement baseline/new metadata; detail row R can accompany R+1 bytes. >200th file returns fileMissing and is unreachable in UI. Nondefault root records cannot be read/refreshed.

**Correction:** Fence exact baseline/root/incarnation/operation on publication and response handoff; retain indexed immutable revision artifact. Detail must index all rows independent of pagination; UI must consume cursor pages. Resolve stored selected root consistently rather than hardcode `.`.

### C11. Native bubble isolation still prevents React child keyboard delivery

**Evidence:** `SessionChangesHost.tsx:37-42` installs native bubble stopPropagation on dialog content; Radix portal wraps children (`:55-83`). List navigation uses React delegated `onKeyDown` (`SessionChangedFilesList.tsx:55-76`). Host test only asserts body does not see key `a` (`session-changes-host.browser.tsx:96-108`).

**Impact:** Native stop at content prevents events reaching the portal container's React delegated bubble listener, so child React Arrow handlers do not run. Document/window capture handlers already ran before content and remain unisolated. Moving capture listener to bubble fixes native target delivery, not React delegation or upstream shortcut ownership. Dialog competitors/exact invoker restoration remain unaddressed.

**Correction:** Preserve React child delivery; gate workspace/PTY/global dispatch using modal input ownership and contain synthetic bubbling appropriately. Close competing accessory/sheet/dialog states; preserve exact surviving opener. Test Arrow selection through real host plus actual Monaco find/copy/Tab/Escape and document capture listeners.

### C12. Fresh baselines still show false empty success; open/settled/cache lifecycle is absent

**Evidence:** Receipt/from-now leave comparison null (`capture.rs:312-326`, public `:293-295`). Panel only refreshes on manual button (`SessionChangesPanel.tsx:118-132`), gates files on revision (`:81`) and displays no changes for empty data (`:289-294`). Query hooks have only ordinary queries/mutation invalidation, not settled/open/reconnect recovery or close source purge (`session-changes-queries.ts:93-324`). Mutation/query errors are not rendered; catches claim handled state without displaying it (`SessionChangesPanel.tsx:129-145`). Workspace host state is not retired on owner/profile/incarnation change (`WorkspacePage.tsx:676-742,2964-2975`).

**Impact:** Ready baseline with no comparison reports no changes until manual refresh. Hidden settled revisions/initializing promotion are not reliably reconciled; current-incomplete scans can appear confidently empty. Closing retains source query cache; stale owner source can remain visible. Failed refresh/from-now has no actionable feedback.

**Correction:** Authoritative status then admitted refresh on open/recovery; exact settled invalidation and owner/request/revision acceptance guards. Render loading/error/unknown/current coverage separately; cancel/purge source queries/models on close/retirement. Do not infer empty success without a completed valid comparison.

### C13. Qualification evidence still claims unexercised and absent artifacts

**Evidence:** E2E button is now mandatory (`session-changes-review.spec.ts:27-33`), but rest only takes screenshots (`:34-54`). Fixture stages Git bytes only; no OMP/managed PTY/model turn (`omp-session-fixture.ts:17-64`), no Monaco contents/read-only/immutability assertions. Lifecycle test manually inserts/removes service records (`server/tests/session_changes_lifecycle.rs:57-80`), not PTY transitions. `reports/qualification.md:10,14,17` cites absent capture/store/absence tests and marks E2E verified. `resource-qualification.md:22-24` still claims 100,000 nodes/temp-stored bytes; actual node constant is 10,000 and bytes are Vecs. Case directory contains no PNG files, while evidence.json marks passed and names screenshots (`:16-43`). review.md lists pending human/native receipts. Roadmap still says automated/runtime complete (`docs/project-roadmap.md:9`); plan overview says completed while phases pending (`plan.md:4,32-39`).

**Impact:** Passing small seam tests does not establish the accepted production behavior. Current release claims remain unsupported; new mandatory button assertion removes one false-pass path only.

**Correction:** Provision actual pinned OMP and controlled first tool edit; assert exact server/Monaco original/current bytes, read-only behavior and repository invariance. Cover failure/race/lifecycle/bounds/denials and >200 files. Report actual executed results/artifacts, separating blocked OMP/native/human gates; reconcile completion claims rather than certify missing evidence.

## Warnings — SHOULD FIX

1. **Private HTTP guards/rate admission absent.** `control.rs:60-98` authenticates bearer only; loopback Host/peer/Origin/query guards remain local to WS handler (`collector.rs:168-194`). Only prepare uses control semaphore (`control.rs:127`). No per-bearer limiter/reserved completion admission. Reuse existing guards and bounded rate pattern; this is defense-in-depth/protocol compliance, not a claim of unauthenticated bearer bypass.
2. **Diff runs unbounded synchronous work on async handlers/global lock.** `text_diff.rs:123-127` checks elapsed time only after libgit2 finishes; work-unit constant unused. `comparison.rs:311-464` clones/recomputes full rows/diffs under global lock for every list/detail. Precompute once in admitted blocking work with algorithm work bounds and short source locks.
3. **Destructive PTY transitions still leak old source.** Only `remove_with_expected` releases records (`manager.rs:2342-2348`); winning replacement (`:1735-1759`), durable eviction (`:2650-2693`) and dispose (`:2769-2809`) do not. Release exact destroyed identities after successful authority transition; normal process exit must continue retaining records.
4. **Real typed HTTP errors still decode as networkError.** Client inspects `err.response` (`session-changes-client.ts:50-76`); real ApiRequestError exposes details (`client.ts:105-114`, `ws-transport.ts:3171-3176`). Decode details and preserve code/currentRevision/retryability. Server refreshRequired still omits currentRevision (`api/session_changes.rs:18-24`).
5. **Runtime decoders still coerce malformed values.** `session-changes-types.ts:366-415,463-543` accepts unchecked enum casts, Boolean/Number/String coercions and unbounded arrays/text. Invalid row change can crash badge rendering (`SessionChangedFilesList.tsx:85,106`). Validate exact bounded types/enums/identity/source invariants before render.
6. **Adapter barrier/freshness defects remain.** Session ID sanitation truncates/collides (`omp-agent-status.ts:155-165`); session switch/shutdown do not cancel prior attempt tokens (`:345-368,710-715`). Response checks lack full identity (`:607-654`); remaining deadline floors to one second and adds fail await (`:631-705`). Initial freshness tests path truthiness, not actual file existence, and missing capabilities can look fresh (`:1126-1128`). Implement exact IDs, verified freshness, cancellable attempt liveness and one monotonic deadline; do not invalidate already-acknowledged bytes merely because final receipt response was lost.
7. **UI/wire truthfulness and accessibility still incomplete.** Panel disclaimer always says session start, including fromNow (`SessionChangesPanel.tsx:218`); no coverage reasons/current timestamp/error detail, several controls below 44px. List selection still shifts border/no active-descendant (`SessionChangedFilesList.tsx:73-98`). Rust nullable DTO fields omit nulls; requests lack strict unknown-field/ID bounds; public routes inherit global body limit (`types.rs:226-276,376-391`, `api/router.rs:300-319,625`). Align frozen contract and existing selection/input standards.

## Suggestions — NICE TO HAVE

1. Delete duplicate/dead ownership representations after correctness repair: two BoundTerminalTarget types, source-owning FromNowRecord duplication, unused ComparisonArtifact/FileRowInternal retention scheme. One immutable artifact and one classifier are simpler and prevent refresh/list drift.
2. Give Monaco models one owner using existing keep-current/deferred-disposal convention. Viewer currently disposes global matching models directly (`ReadonlyMonacoDiffViewer.tsx:116-144`) while DiffEditor has no matching model paths/keep-current options (`:255-272`). Add mounted-model lifecycle assertions rather than toolbar-only qualification.
3. Keep regression scenarios aligned with repaired failures: real startup late wiring, wrong/stale registration, fail-before-prepare, cancellation keeping permits, failed-original → from-now → late controls, inconsistent namespace/current omissions, unsupported additions, >200 details, real host keys, and close/owner-retirement source purge. Prefer these focused invariants to more abstraction or broad happy-path test counts.

## Positive observations

- Always-mounted private controls with runtime service lookup remove the startup router snapshot defect.
- Binding precedes credential activation; arbitrary `.` fallback is gone.
- From-now now installs actual captured bytes and resets comparison state.
- Activation receipt reuse, receipt identity/TTL checks, baseline prechecks and required E2E entrypoint are concrete improvements.
- Existing authenticated-account public routing and capability-free/read-only viewer separation remain intact; no additional per-user PTY ACL is claimed.

## Unresolved evidence

Real-binary collector + installed OMP first-turn ordering; authenticated full application Monaco journey; cancellation/resource measurements and namespace races; destructive PTY lifecycle; >200-row retrieval; real keyboard/read-only model assertions; native Tauri capture and human visual acceptance. No product clarification needed: contracts already define these behaviors. Implementation/release qualification remains incomplete.
