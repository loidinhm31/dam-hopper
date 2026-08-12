# Phase 04 — Qualification, Documentation, Rollout, and Rollback

## Context links

- [Plan](./plan.md) · [Phase 3](./phase-03-frontend-native-media-compatibility-and-deployment.md)
- [Browser research](./research/researcher-02-browser-cross-site-media.md)
- [System architecture](../../docs/system-architecture.md) · [PDR](../../docs/project-overview-pdr.md)
- Existing browser suites: `explorer-video-playback-download.browser.tsx`, `explorer-image-preview.browser.tsx`

## Overview

- Date: 2026-08-12
- Description: prove cross-site cookie binding in server/unit/real browser/Tauri, update contracts, stage rollout with fail-closed rollback.
- Priority: P1
- Implementation status: Pending; blocked by Phases 1–3
- Review status: Required; security reviewer + release owner sign-off

## Key Insights

- jsdom cannot prove Partitioned cookie, top-level partitioning, native Range, anchor download, or WebView policy.
- Test two top-level origins and isolated browser contexts; curl/no-cookie is a server assertion, not a CORS test.
- Multi-instance remains unsupported because tickets/sessions are in-memory. Restart intentionally invalidates all media.
- Rollback must never reactivate capability-only authorization. Safe rollback disables media or rolls server/client together with explicit risk acceptance.

## Requirements

- Unit: store binding/no-touch, cookie attributes, TTL/capacity, actor/kind/purpose, logout/workspace/restart, CORS startup guards, log redaction.
- Integration: video + image GET/HEAD, full/single Range/If-Range, seek/decode, attachment anchor, missing/foreign partition/cookie, revoke/expiry/profile switch.
- Browser: trusted frontend A/API B over HTTPS; foreign top-level C; two contexts; Chromium and installed Edge channel; third-party-cookie restrictions enabled.
- Tauri: packaged selected OS/WebView build against HTTPS API; playback seek, image, download, profile switch/logout; capture exact OS/WebView versions and sanitized network/status evidence.
- Docs: API/cookie/CORS/deployment/support matrix/multi-instance/TTL/capacity/logging/CSRF/rollout/rollback. Do not mark unexecuted engine as supported.

## Architecture

- Test fixture serves exact origins with trusted local TLS and real server; server gets only A allowlisted. C and second context attempt same ticket.
- Acceptance sequence: issue → inspect Set-Cookie → credentialed HEAD → image decode/video metadata+seek/Range → direct download → deny copied URL in C/context/curl → logout deny.
- Rollout: validate config and gates → atomically/coordinately deploy session-bound server+client. Independently hosted clients use an explicit media maintenance window during version skew. No deployment ordering can preserve media without a forbidden fallback.
- Rollback: keep media disabled during skew or restore a previously qualified session-bound server+client pair; never switch to legacy bearer-only. Restart revokes all active state.

## Related code files

- Modify `server/src/api/tests.rs` and `server/src/fs/media_ticket.rs` tests — complete security/lifecycle matrix.
- Modify `packages/ui/browser-tests/explorer-video-playback-download.browser.tsx` — credentialed native playback/seek/download gates.
- Modify `packages/ui/browser-tests/explorer-image-preview.browser.tsx` — credentialed image/decode/foreign-context gates.
- Create `packages/ui/browser-tests/session-bound-cross-site-media.browser.tsx` — HTTPS multi-origin/partition/copy/logout matrix.
- Modify `packages/ui/vitest.browser.config.ts` — explicit Chromium and Edge channel selection; no engine claim from Chromium emulation alone.
- Create `apps/native/scripts/qualify-session-bound-media.mjs` — evidence validator/run instructions for packaged selected WebView; no mocked success.
- Modify `docs/system-architecture.md`, `docs/api-reference.md`, `docs/configuration-guide.md`, `docs/project-overview-pdr.md`, `docs/codebase-summary.md` — shipped design/support/operations after gates.
- Delete: obsolete capability-only assertions/comments only; no unrelated semantic-navigation files.

## Implementation Steps

1. Add deterministic store/API tests; assert foreign/missing lookup does not extend TTL and all failure bodies/status are indistinguishable.
2. Build real HTTPS three-origin fixture. Assert exact ACAO/credentials/`Vary: Origin`, rejected C, cookie attributes, `private,no-store` on every stream status, and no raw ticket/cookie in captured logs.
3. Extend browser tests for Chromium and installed Microsoft Edge: two contexts/top-level sites, privacy restriction, GET/HEAD/Range/seek/decode/download/copy/curl-like denial/logout/restart.
4. Run packaged Tauri Windows WebView2 (first recommended engine) against same fixture. Record actual packaged top-level origin, partition key behavior, runtime version, and pass/fail; Linux WebKit/macOS remain unsupported until separately executed.
5. Load/capacity test issuance at limits; verify `429`, pruning, no unbounded memory, no TTL refresh from hostile replay.
6. Update architecture/API/config/PDR/summary only with observed results. State HTTPS, exact origins, cookie mode, 30m/8h defaults, caps, sticky-routing limitation.
7. Rehearse coordinated rollout and rollback in staging, including independently hosted client maintenance window. Prove both skew directions fail closed and media stays disabled rather than using capability fallback.
8. Run full validation; attach command outputs and sanitized engine matrix to reviewer report. Obtain required reviewer/release-owner gate.

## Todo list

- [ ] Rust/unit/integration matrix green
- [ ] Chromium real cross-site gate green
- [ ] Microsoft Edge real cross-site gate green
- [ ] Selected packaged Tauri engine gate green
- [ ] Logging redaction and capacity checks green
- [ ] Docs match observed support only
- [ ] Rollout/rollback rehearsal complete
- [ ] Reviewer/release owner approve

## Success Criteria

- Owning partition succeeds for video/image GET+HEAD+Range and direct download; foreign context/site/curl/no-cookie receives `404` and cannot refresh expiry.
- Logout/profile switch/workspace change/restart invalidate expected bindings. Remote HTTP and unsafe CORS config fail before media use/server start.
- Commands pass: `cd server && cargo test`; `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`; `BROWSER_CHANNEL=msedge pnpm --filter @dam-hopper/ui test:browser`; `pnpm build:native`; `node apps/native/scripts/qualify-session-bound-media.mjs --evidence <file>`; `pnpm check`.
- `git diff --check` clean; `git diff --cached --quiet`; review report has no blockers.

## Risk Assessment

- CI lacks Edge/Tauri engine: keep release blocked or explicitly unsupported; do not substitute UA simulation.
- TLS/local partition behavior differs from production: stage with production-equivalent domains/proxy headers.
- Server/client skew causes intentional media outage: use coordinated deployment or maintenance window. Rollback restores only a qualified session-bound pair or keeps media disabled.

## Security Considerations

- Review CSRF, exact origin parsing, cookie clearing symmetry, cache `private,no-store`, secret redaction, session fixation/rotation, race behavior.
- Treat ticket paths and cookies as credentials even though two-part binding limits replay.
- No multi-instance support claim; sticky routing is operational mitigation, shared store a separate future plan.

## Next steps

- Canary exact-origin deployments; monitor fixed-cardinality issue/probe/404/capacity counts without URLs, actors, cookies, or tickets.

## Unresolved questions

- Release owner must name minimum Chromium, Edge, Windows, and WebView2 versions plus evidence retention location.
- Decide whether Safari/Firefox/Linux WebKit are explicit unsupported targets or blockers for initial release.
