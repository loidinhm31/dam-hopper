# Code Review — LSP Phase 02 (Framing + Child Owner)

Score: **4/10 — NOT APPROVED** (happy-path works; lifecycle/bounds/security contract of phase not met)
Plan: `plans/260901-1000-lsp-server-integration/phase-02-lsp-framing-and-child-owner.md` (still Pending 0%; not edited by reviewer)

## Scope
`server/src/lib.rs`, `semantic/{mod,framing,launch,reaper,types,child}.rs`, `tests/fixtures/lsp-test-server.mjs`, `tests/semantic_child_process.rs` (~1450 LOC)

## Validation (executed)
- `cargo test --lib semantic::` → 12/12 pass
- `cargo test --test semantic_child_process` → 8/8 pass (8.05s)
- `cargo clippy --lib --tests` → no diagnostics in semantic/ or the new test (output filtered; pre-existing warnings elsewhere)
- `ps` after run: 0 leftover `lsp-test-server` processes
- Passing ≠ contract met: tests do not exercise the failure vectors below.

## Critical (block phase)
1. **Malformed/oversized stdout does not fail the owner** — `child.rs:148-166` reader just `break`s on `FramingError`; child keeps running, no event, no cleanup, consumer hangs. Plan: malformed protocol ⇒ bounded cleanup + terminal.
2. **Raw child bytes logged** — `child.rs:160` logs `FramingError` Display; `InvalidContentLength(String)` carries up to 8 KiB of child-controlled header text. Violates "never log raw protocol". Remove payload from error.
3. **Stderr drain unbounded + fragile** — `child.rs:114-133` `lines().next_line()` has no per-line cap (newline-free multi-GB stderr = memory DoS); non-UTF-8 stderr returns `Err` → `while let Ok(Some)` exits, drain stops, pipe closes. `recent_snippet` is raw, unsanitized stderr (plan: sanitized; policy: credential redaction) and is emitted to consumers.
4. **Tree ownership = PGID only** — `reaper.rs`. `setsid`/`setpgid` escapes are unowned; `get_all_descendants`/`get_proc_children` are dead code (never called, no identity/starttime tracking); no PID-reuse-safe identity; exit branch (`child.rs:184-202`) SIGKILLs `-pgid` *after* leader was reaped (pgid number may be recycled once group empty) and **discards `verify_pgid_reaped` result** → publishes `Exited` even on leak. Plan: cleanup failure observable + blocks reuse. Phase 01 G7 explicitly deferred crash/reparent/escape qualification to this phase.
5. **No graceful LSP stage** — G7 contract (shutdown RPC → 1.5s → exit → close stdin) not implemented; "graceful" == SIGTERM to group (`reaper.rs:98`). `GRACEFUL_SHUTDOWN_TIMEOUT` misnamed.
6. **Cleanup not strictly bounded** — `terminate_and_reap_tree`: 2s term + up to 3s verify + `child.kill().await`/`child.wait().await` (no timeout) + 3s verify ⇒ ~8s+ vs 2s+3s policy. Hardcoded 500 ms magic at `child.rs:233`.
7. **No owner panic/drop-guard recovery; no cleanup on rx drop/reader failure/runtime shutdown** — owner is a detached `tokio::spawn`; only `kill_on_drop` (direct child). Dropping `event_rx` (child stays alive until handle dropped), reader death, runtime teardown leave descendants. Plan step 8 unmet.
8. **Event path not byte-bounded** — `mpsc(32)` of up to 4 MiB bodies ⇒ ~128 MiB/child vs 4 MiB policy (`ByteBudgetCounter` only guards outbound). Full queue blocks stdout reader indefinitely (child stalls, nothing escalates) and blocks terminal `send().await`; `is_terminated()` flips true before delivery succeeds.
9. **Public launch surface** — `pub mod semantic`, `pub BundledLaunchSpec::new`, `with_extra_args`, all fields `pub` (executable/entrypoint/extra_args mutable post-validation). Plan: no public launch-spec constructor / fixture override. No production caller yet so not remotely exploitable, but blocks Phase 03 gating. Gate via `pub(crate)` + in-crate tests or `#[doc(hidden)]`/`test-support` feature.

## Warnings
- Tests hardcode `/home/loidinh/.nvm/...` and fall back to `which node` (system Node/PATH) — non-portable, contradicts bundled-only rule.
- Weak tests: stuck-shutdown fixture doesn't ignore SIGTERM (node dies on SIGTERM; SIGKILL path unexercised; comment false); descendants handle SIGTERM (no setsid/ignore-TERM/reparent vector); descendant test uses 300 ms sleep, no readiness handshake or PID capture; normal-lifecycle accepts `Exited(None)`; no tests: malformed stdout, huge/binary stderr, saturated event queue, rx drop, stdin timeout (`STDIN_WRITE_TIMEOUT`), owner panic, byte budget, startup failure. `StderrSummary` only at EOF → `test_stderr_flood` can race Terminated.
- `send_message` doesn't validate size/UTF-8/JSON at enqueue; invalid payload fails at write time and kills the whole child (`child.rs:212-215`).
- `encode_frame` validates UTF-8 but not JSON (plan: validated UTF-8 JSON).
- Header grammar loose: lines without `:` ignored; `usize::parse` accepts `+5`; header limit split-dependent (no-delimiter check counts delimiter bytes, completed-header check doesn't) — add exact-boundary tests.
- Owner is blind to stop/exit while inside a 2 s stdin write (`child.rs:210`); select write against stop.
- Limits are file-level consts (`framing.rs`, `types.rs`) not a passed policy struct; `MAX_BODY_SIZE` vs `MAX_QUEUE_BYTES` duplicate semantic.
- Non-unix: `is_pgid_empty` returns `true` ⇒ false success; add `compile_error`/explicit unsupported.
- `PATH=/usr/bin:/bin` injected (`launch.rs:110`) despite "no PATH" rule — confirm intent.

## Suggestions (YAGNI/KISS/DRY/perf)
- `ChildStatus::{Starting,Running,ShuttingDown}` unused; split state from terminal result (`TerminalStatus`). `ChildError::{Framing,Reaper,MissingStdio}` partially unused.
- `AtomicBool` + `compare_exchange` redundant with single owner task + one `return`; keep only if `is_terminated` semantic is fixed.
- `SemanticChildOwner` unit struct → free fn / `SemanticChild::spawn`.
- `pub use super::types::{…}` in child.rs duplicates types paths.
- `parse_frame`: `serde_json::Value` DOM for validation → `IgnoredAny`; `drain().collect()` + `split_off` = 2 extra 4 MiB copies → `split_to`/`BytesMut` or `drain` tail; `AsyncLspReader` copies via 8 KiB stack chunk → `read_buf`.
- `get_all_descendants` uses `Vec::contains` O(n²); replace by HashSet or delete.
- Fixture header doc lists `crash` and coalesced-frame modes; implemented modes are `crash-now`/`crash-on-msg` and no coalescing mode — align doc or add coalesced case.

## Positives
- Clean typed codec errors; surplus bytes preserved; fail-closed; astral/split/coalesced unit coverage.
- Direct spawn, `env_clear`, abs-path validation, `process_group(0)`, `kill_on_drop`.
- Real-process integration harness + deterministic fixture; no zombie leftovers observed.
- Biased select prioritises stop; outbound byte+count budget correct with release on all error paths.

## Recommended actions (order)
1. Reader/rx/panic failure → owner cleanup + single terminal with sanitized reason; panic guard/`JoinHandle` supervisor.
2. Cap stderr per-line (read bytes into bounded buf, lossy UTF-8, sanitize/redact); never log header values.
3. Implement G7 tree tracking (descendant PID+starttime snapshots, `/proc` verify, escape detection → failure) or document explicit fail-closed qualification; fix exit-branch verify handling and signal-before-reap.
4. Implement shutdown/exit RPC stage; wrap all kill/wait in deadlines totalling policy budget.
5. Byte-bound event queue; non-blocking terminal publication.
6. Make launch types non-public; remove hardcoded node path; add the missing tests (SIGTERM-ignoring child, setsid helper, malformed stdout, newline-free/binary stderr, rx drop, saturated queue).
7. Update phase-02 plan status (still 0%/Pending) after fixes.

## Unresolved questions
- Must Phase 02 own escaped (setsid) descendants now, or is bounded-PGID + documented fail-closed qualification acceptable under the Phase 01 "BOUNDED PASS" exception?
- Is `PATH=/usr/bin:/bin` intended in sanitized env?
- Should limits come from a Phase 01 policy struct (plan) or stay consts?
- Integration tests require `pub` API — accept feature-gated `test-support` export?
