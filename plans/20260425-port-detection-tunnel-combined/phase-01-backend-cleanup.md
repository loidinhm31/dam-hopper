# Phase 01 — Backend Cleanup

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Depends on: Phase 00 (git rebase complete)
- Scout: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md` §2

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | Delete proxy/proxy_token files, clean router.rs wiring, verify build+tests pass |
| Priority | P1 (blocks Phase 02+) |
| Implementation status | done |
| Review status | done — 2026-04-25 |
| Effort | ~0.5h |

## Key Insights

- After Phase 00 rebase, `proxy.rs` and `proxy_token.rs` may still exist if they were in the working tree before rebase (depends on rebase behavior with untracked vs tracked). Verify and delete.
- `router.rs` imports and wires these modules at lines 20-22, 96, and 145-164 — all must go.
- `ws-transport.ts` line 268 still maps `proxy-token:get` channel — remove.
- `api/mod.rs` likely re-exports `proxy` and `proxy_token` — clean up.
- `server/src/api/tests.rs` may test proxy endpoints — remove those tests.
- No changes to `port_forward/`, `tunnel/`, or any other module.

## Requirements

**Functional:**
- `cargo test` passes with no failures.
- `cargo check` emits zero errors.
- No `/proxy/*` routes, no `/api/proxy-token` route in router.
- `pnpm build` passes.

**Non-Functional:**
- Minimal diff — only deletions and removal of proxy wiring.

## Architecture — File Changes

| File | Action | Detail |
|---|---|---|
| `server/src/api/proxy.rs` | DELETE | entire file |
| `server/src/api/proxy_token.rs` | DELETE | entire file |
| `server/src/api/mod.rs` | EDIT | remove `pub mod proxy;` and `pub mod proxy_token;` |
| `server/src/api/router.rs` | EDIT | remove proxy/proxy_token imports (line 20-22), proxy_token route (line 96), proxy_routes block (lines 144-164), `proxy_routes` from final `Router::new().merge(...)` |
| `server/src/api/tests.rs` | EDIT | remove any test functions that call `/api/proxy-token` or `/proxy/*` |
| `packages/web/src/api/ws-transport.ts` | EDIT | remove `proxy-token:get` channel mapping (line 268) |
| `packages/web/src/api/client.ts` | EDIT | remove `ProxyTokenResponse` interface (lines 106-109) |

## Related Code Files

| File | Lines | Content |
|---|---|---|
| `server/src/api/router.rs` | 20-22 | `proxy, proxy_token` in use statement |
| `server/src/api/router.rs` | 96 | `.route("/api/proxy-token", get(proxy_token::proxy_token_handler))` |
| `server/src/api/router.rs` | 142-164 | proxy_routes block + `.merge(proxy_routes)` |
| `packages/web/src/api/ws-transport.ts` | 268 | `case "proxy-token:get": return { method: "GET", url: "/api/proxy-token" };` |
| `packages/web/src/api/client.ts` | 106-109 | `ProxyTokenResponse` interface |

## Implementation Steps

1. **Delete proxy source files** (if still present after rebase)
   ```bash
   rm -f server/src/api/proxy.rs server/src/api/proxy_token.rs
   ```

2. **Edit `server/src/api/mod.rs`** — remove `pub mod proxy;` and `pub mod proxy_token;`

3. **Edit `server/src/api/router.rs`**
   - Remove `proxy, proxy_token` from the use statement at top.
   - Remove `.route("/api/proxy-token", get(proxy_token::proxy_token_handler))` line.
   - Remove the entire `// Proxy routes —` comment block and `proxy_routes` variable (lines 142-158).
   - Remove `.merge(proxy_routes)` from the final router assembly.

4. **Edit `server/src/api/tests.rs`** — find and delete any test functions containing `/api/proxy-token` or `/proxy/`.

5. **`cargo check`** — must be zero errors.

6. **`cargo test`** — must pass.

7. **Edit `packages/web/src/api/ws-transport.ts`** — remove the `proxy-token:get` case.

8. **Edit `packages/web/src/api/client.ts`** — remove `ProxyTokenResponse` interface.

9. **`pnpm build`** — must pass.

## Todo List

- [x] Delete `server/src/api/proxy.rs`
- [x] Delete `server/src/api/proxy_token.rs`
- [x] Remove `pub mod proxy` and `pub mod proxy_token` from `api/mod.rs`
- [x] Remove proxy/proxy_token imports from `router.rs`
- [x] Remove `/api/proxy-token` route from `router.rs`
- [x] Remove proxy_routes block from `router.rs`
- [x] Remove `.merge(proxy_routes)` from router assembly
- [x] Remove proxy-related tests from `tests.rs`
- [x] `cargo check` — zero errors
- [x] `cargo test` — passes (209 lib + 49 integration = 258 total; 0 failures)
- [x] Remove `proxy-token:get` case from `ws-transport.ts`
- [x] Remove `ProxyTokenResponse` from `client.ts`
- [ ] `pnpm build` — not verified in this review (web build not run)

## Success Criteria

- `cargo test` passes (all existing tests green).
- `pnpm build` passes.
- `grep -r "proxy" server/src/api/` returns only port_forward (not proxy.rs references).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cargo dependencies on reqwest/tungstenite added only for proxy | Low | Medium | Check `server/Cargo.toml` — if `reqwest` and `tokio-tungstenite` are only used by proxy.rs, remove those deps too; otherwise they are used elsewhere |
| tests.rs references to proxy break test compilation | Low | Low | Remove those test functions entirely |

## Security Considerations

Removal only — reduces attack surface by eliminating the unauthenticated-path proxy code. Positive security change.

## Next Steps

Phase 02: design the combined panel (ASCII mockup, state machine).
