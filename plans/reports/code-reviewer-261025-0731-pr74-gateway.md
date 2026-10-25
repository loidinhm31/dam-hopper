# PR #74 — Gateway Code Review

## Scope and validation
- COMPLETE: assigned gateway static review; PR head `b031e6a40123d8c5169012e0b736ac8c4f1f6091` against base `45a51efe43ef6024dbd875d2498b456a7d4db110`.
- Primary files: `server/src/api/semantic_ws.rs`; `server/src/semantic/{gateway,protocol,uri,overlay,types,outbound,pressure}.rs`. These are additions in the specified diff.
- Supporting evidence: relevant lifecycle, cancellation, G5 provenance and containment/backpressure cases in `server/tests/semantic_{websocket,ws_auth_containment}.rs`; session caller/response contracts; `semantic_supervisor.rs:1301-1470`; frontend destination consumers; README, PDR, code standards and semantic protocol guide.
- Coverage: initialize allowlist/server-owned options; bidirectional URI traversal/symlink handling and metadata stripping; edit FIFO/version fence; cancellation and two-stage navigation; range/hash association; unknown-method handling; socket output reservations and blocked-writer shutdown. Session/supervisor lifecycle, auth admission and frontend defects remain their assigned reviewers' ownership.
- Validation: static source/diff inspection only. No tests, builds, linters, formatters, dependency installs or runtime reproductions executed. Test source and existing qualification reports are not passing-run evidence. Only this report written; no plan supplied or updated.

## Overall assessment
Three source-supported defects: one P1 freshness failure, two P2 protocol/navigation failures. No P0 finding. Highest risk: old coordinates can be emitted with a newer destination's matching SHA/version, defeating the client's freshness check.

## Findings

### G1 — P1: Preserve requery-proven content instead of replacing it with a later snapshot
- **Changed location:** `server/src/semantic/gateway.rs:1944-1951`.
- **Status/confidence:** conclusive static race; high confidence. Runtime interleaving not exercised.
- **Trigger:** destination D was unopened at original submission; after the first child reply resolves, the client opens D as U1 before `docs_before_pin` is captured. During requery completion, D changes to U2 after `docs_after_requery` is captured but before its awaited live overlay snapshot returns. Source document remains unchanged; old coordinates remain in bounds in U2.
- **Evidence chain:**
  1. Original absence selects the unopened path (`gateway.rs:1639-1678`); `docs_before_pin` may already contain U1 (`1759`). Session atomically selects that user overlay for the requery (`session.rs:1319-1335`).
  2. Session validates U1 at reply and returns its immutable `_damHopperProvenSnapshots` (`session.rs:1587-1618,1664-1684`).
  3. Gateway ignores that proof, captures `docs_after_requery`, then awaits the source snapshot (`gateway.rs:1898-1904`). Independent reader `didChange` commands can execute during these awaits.
  4. Cached before/after maps both describe U1, so `1927-1930` passes; `1944-1963` then replaces the provenance with live U2 text/hash/version/incarnation, while `final_raw_result` retains U1 coordinates (`1836-1838`). No later destination-version comparison exists: `1975-1977` checks only provenance membership; `1990-2004` checks authority.
  5. URI filtering validates those old ranges against U2's bounds and labels them with U2's hash (`uri.rs:644-657`). Client accepts matching current U2 wireVersion/hash (`packages/ui/src/api/semantic-client.ts:1105-1123`) and converts the supplied old range (`semantic-monaco.ts:200-215`).
- **Consumer impact:** Go to Definition/Implementation can reveal a different line/symbol while falsely presenting a fresh coordinate/content association. This bypasses, rather than merely trips, the stale-result defense.
- **Smallest correction:** consume the response-carried proven snapshots for pinned destinations. Never refresh proof from live text. Compare current identity/version against that immutable proof and reject changed destinations, retaining the proven hash for downstream fencing.
- **Suggested safe reproduction:** isolated temp project + deterministic test-only barriers: pause after first reply, open D with U1; let requery resolve; pause after `docs_after_requery`; send full `didChange` U2 inserting a blank line above the definition; resume. Assert no response pairs U1 coordinates with U2 SHA/version; expect stale rejection or U1 proof subsequently rejected by the client.

### G2 — P2: Keep cancellation ownership until the entire navigation finishes
- **Changed location:** `server/src/semantic/gateway.rs:1533-1540`.
- **Status/confidence:** conclusive static defect; high confidence. Reproduction not executed.
- **Trigger:** a cross-file request enters pin-and-requery after its initial child response; client cancels while that second request remains pending.
- **Evidence chain:** first reply removes both client/internal ID entries at `1533-1540`, before destination inspection or requery. The second request receives a new internal ID at `1760-1767`, but no client mapping is installed. `handle_cancel_request` only consults the removed `client_to_internal` entry (`2141-2150`), so cancellation cannot reach that active request or cancel work in the gap between stages.
- **Consumer impact:** cancelled requests keep their gateway in-flight permit until final completion/deadline (`1500,1518-1524,1829-1834`), occupying the eight-request budget and potentially rejecting subsequent navigation (`1281-1292`). The logical request can still return success instead of the documented `REQUEST_CANCELLED`; duplicate client IDs are also admitted during this interval because the duplicate check uses the same removed map (`1266-1278`). This is broken application cancellation ownership, not a claim that LSP requires cancellation to interrupt completed work.
- **Smallest correction:** retain one logical request registration/cancellation token through both stages and terminal response; update its active child ID for requery. Cancellation during the inter-stage gap must prevent the requery from starting. Remove registration only on terminal completion.
- **Suggested safe reproduction:** extend the existing isolated G5 fixture to answer its first query immediately but hold its second query. After observing second-query admission, send `$/cancelRequest` using the original client ID. Assert one `-32800` response, released logical capacity and cancellation of the active requery; also assert ID reuse before terminal response remains rejected.

### G3 — P2: Recognize lone CR when validating destination ranges
- **Changed location:** `server/src/semantic/uri.rs:462-465`; corresponding edit-coordinate defect at `server/src/semantic/overlay.rs:48-52`.
- **Status/confidence:** conclusive static coordinate mismatch; high confidence. End-to-end reproduction not executed.
- **Trigger:** an unopened in-target TS/JS destination uses standalone `\r` line endings and its definition is after the first line. Direct protocol clients sending such overlay text also hit the edit-coordinate variant.
- **Evidence chain:** gateway reads raw UTF-8 disk text and pins it unchanged (`gateway.rs:1723-1747`). Pinned TypeScript 5.9.3 treats standalone CR as a line break in `computeLineStarts`; pinned TSLS 6.0.2 preserves TS line coordinates through `Range.fromLocations` (sources below). Rust instead splits only on `\n` and merely strips a trailing CR, counting a CR-only document as one line. `uri.rs:650,688-693` rejects valid line>0 locations, which `587` silently drops. The overlay offset helper uses the same LF-only split and rejects valid ranged edits on later CR-delimited lines.
- **Consumer impact:** valid Definition/Implementation results become empty despite the bundled engine resolving the symbol; raw-LSP ranged updates can evict the document after the position error (`gateway.rs:1154-1159`).
- **Smallest correction:** share a lossless line iterator for LF, CRLF and standalone CR between overlay mapping and range validation; preserve UTF-16 columns and byte offsets rather than normalizing text after hashing.
- **Suggested safe reproduction:** temp `dest.ts` containing `// header\rexport const needle = 1;\r`, LF source importing/using `needle`; open only source and navigate. Inspect endpoint result before Monaco normalization: expected `dest.ts` line 1; current validator drops it. Separately send a valid ranged edit on line 1 of a CR-only overlay and check it remains navigable.
- **Pinned implementation sources inspected:** [TypeScript 5.9.3 typescript.js](https://unpkg.com/typescript@5.9.3/lib/typescript.js), `computeLineStarts`, lines 11653-11681; [TSLS 6.0.2 cli.mjs](https://unpkg.com/typescript-language-server@6.0.2/lib/cli.mjs), `Range.fromLocations`, line 21735, and definition mapping at 25613-25669. These replace the mismatched-version research leads for this finding.

## Evidence gaps and positive observations
- `semantic_websocket.rs:1047-1062` cancels immediately and accepts either completion/cancellation; it does not exercise cancellation during the second query. G5 case `1488-1774` validates sequential open/unopened provenance, not the G1 interleaving.
- Containment cases `semantic_ws_auth_containment.rs:156-482` cover fixed traversal/symlink/root replacement vectors. Backpressure source at `739-792,1281-1385` observes real pending socket sends and independent cutoff/reap stages. Neither source establishes a passing run here.
- Client initialization is validated but not forwarded: child initialization/options are server-owned (`gateway.rs:619-644,794-795`; `session.rs:937-975`). Unknown methods are not forwarded. Output construction strips unknown result metadata; byte permits survive active sends (`semantic_ws.rs:411,464-500`; `outbound.rs:66-78`).
- No additional containment finding established in this static review. No unsupported RCE/sandbox claim inferred from generic TSLS documentation.

## Recommended actions
1. Fix G1's immutable proof association before relying on stale-reveal guarantees.
2. Extend logical cancellation across both navigation stages.
3. Align CR/LF coordinate handling and add targeted regressions for these three paths.

## Metrics
- Findings: P0 0; P1 1; P2 2; P3 0.
- Test/type coverage and lint counts: not measured; no execution authorized.

## Unresolved questions
- Runtime frequency of G1/G2 interleavings remains unmeasured; proposed deterministic reproductions are suggestions, not executed evidence.
