# Phase 04 — Qualification, Documentation, Rollout, and Rollback

## Context links

- [Plan](./plan.md) · [Phase 3](./phase-03-frontend-native-media-compatibility-and-deployment.md)
- [Browser research](./research/researcher-02-browser-cross-site-media.md)
- [System architecture](../../docs/system-architecture.md) · [PDR](../../docs/project-overview-pdr.md)
- Existing browser suites: `explorer-video-playback-download.browser.tsx`, `explorer-image-preview.browser.tsx`

## Overview

- Date: 2026-08-12
- Description: complete deterministic server checks and real Chromium native-media regression evidence, then document only observed support.
- Priority: P1
- Implementation status: DONE — 2026-08-13 10:06:21 +07:00; Phase 3 stale-profile prerequisite included
- Review status: APPROVED — 9.7/10, 2026-08-13 10:06:21 +07:00

## Key Insights

- jsdom cannot prove Partitioned cookie, top-level partitioning, native Range, anchor download, or WebView policy.
- Existing repository precedent separates deterministic server authorization checks from same-origin real-Chromium native-element regression tests; neither is mislabeled as cross-site CHIPS evidence.
- Multi-instance remains unsupported because tickets/sessions are in-memory. Restart intentionally invalidates all media.
- Tauri/WebView qualification remains a separate follow-up and is absent from initial support claims.

## Requirements

- Unit: store binding/no-touch, cookie attributes, TTL/capacity, actor/kind/purpose, logout/workspace/restart, CORS startup guards, log redaction.
- Integration: video + image GET/HEAD, full/single Range/If-Range, missing/foreign cookie, revoke/expiry/profile switch, exact authorization mode, and non-disclosing failures.
- Browser: repository Playwright/Vitest harness with real Chromium validates credentialed issue/HEAD ordering, native decode/seek, direct anchor download, retry, cleanup, and no Blob fallback.
- Edge runs only when a real installed `msedge` channel is available; otherwise it remains explicitly unsupported. Tauri is deferred.
- Docs: API/cookie/CORS/deployment/support matrix/multi-instance/TTL/capacity/logging/CSRF. Do not mark unexecuted engine or cross-site partition behavior as qualified.

## Architecture

- Server/router tests prove cookie+ticket authorization, exact headers, Range/HEAD, lifecycle, capacity, and generic denials with real temporary files.
- Browser fixture follows prior Explorer media plans: synthetic same-origin endpoints plus real Chromium native elements. It validates client/native behavior, not real CHIPS partitioning.
- Browser channel selection is explicit. The default may use an installed system Chromium; requested unavailable channels fail instead of silently substituting another engine.
- Safe operational invariant remains: never restore legacy bearer/capability-only media authorization.

## Related code files

- Modify `server/src/api/tests.rs` and `server/src/fs/media_ticket.rs` tests — complete security/lifecycle matrix.
- Modify `packages/ui/browser-tests/explorer-video-playback-download.browser.tsx` — credentialed native playback/seek/download gates.
- Modify `packages/ui/browser-tests/explorer-image-preview.browser.tsx` — credentialed image/decode/foreign-context gates.
- Modify existing image/video browser suites — session-cookie version, credentialed probe, native credential mode, fail-closed retry, and no-body download checks.
- Modify `packages/ui/vitest.browser.config.ts` — installed Chromium fallback and explicit optional browser channel selection; no engine substitution claim.
- Tauri/native qualification files: deferred; do not create or modify them in this phase.
- Modify `docs/system-architecture.md`, `docs/api-reference.md`, `docs/configuration-guide.md`, `docs/project-overview-pdr.md`, `docs/codebase-summary.md` — shipped design/support/operations after gates.
- Delete: obsolete capability-only assertions/comments only; no unrelated semantic-navigation files.

## Implementation Steps

1. Add deterministic store/API tests; assert foreign/missing lookup does not extend TTL and all failure bodies/status are indistinguishable.
2. Complete router/config assertions for exact ACAO/credentials/`Vary: Origin`, rejected origins, cookie attributes, `private,no-store` on every stream status, and sanitized failures/logging.
3. Extend existing browser tests using prior Explorer Playwright patterns: credentialed HEAD before native source, native seek/decode, direct anchor/no Blob, fail-closed retry, cleanup, and profile refresh.
4. Make browser selection explicit. Run installed Chromium; attempt Edge only when installed and otherwise record unsupported without substitution.
5. Load/capacity test issuance at limits; verify `429`, pruning, no unbounded memory, no TTL refresh from hostile replay.
6. Update architecture/API/config/PDR/summary only with observed results. State HTTPS production requirement, exact origins, cookie mode, 30m/8h defaults, caps, and sticky-routing limitation.
7. Run full deterministic validation and attach sanitized engine status to reviewer report. Tauri and real cross-site CHIPS qualification remain follow-ups.

## Todo list

- [x] Rust/unit/integration matrix green
- [x] Installed Chromium native-media browser gate green
- [x] Edge status recorded honestly; no substitution or unsupported claim
- [x] Tauri explicitly deferred with no support claim
- [x] Logging redaction and capacity checks green
- [x] Docs match observed support only
- [x] Fail-closed operational invariant documented
- [x] Security reviewer approved after warning fixes — 9.7/10, 2026-08-13 10:06:21 +07:00

## Success Criteria

- Server/router tests prove owning cookie succeeds for video/image GET+HEAD+Range while foreign/missing cookie receives identical `404` without TTL refresh; Chromium proves native seek/decode and direct anchor behavior separately.
- Logout/profile switch/workspace change/restart invalidate expected bindings. Remote HTTP and unsafe CORS config fail before media use/server start.
- Deterministic commands pass: `cd server && cargo test`; `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`; `pnpm build`; and `pnpm lint`. The aggregate `pnpm check` may stop only at the explicitly deferred Tauri signing gate when authorized `TAURI_SIGNING_PRIVATE_KEY` is absent; web/native compilation evidence before that stop is recorded. `BROWSER_CHANNEL=msedge ...` runs only when Edge is installed and otherwise records unsupported.
- `git diff --check` clean; `git diff --cached --quiet`; review report has no blockers.

## Risk Assessment

- CI lacks Edge/Tauri engine: record unsupported; do not substitute UA simulation or make support claims.
- Same-origin browser fixtures do not prove real CHIPS partitioning; documentation states this boundary.
- Server/client skew causes intentional media outage; rollback never restores legacy capability-only authorization.

## Security Considerations

- Review CSRF, exact origin parsing, cookie clearing symmetry, cache `private,no-store`, secret redaction, session fixation/rotation, race behavior.
- Treat ticket paths and cookies as credentials even though two-part binding limits replay.
- No multi-instance support claim; sticky routing is operational mitigation, shared store a separate future plan.

## Next steps

- Canary exact-origin deployments; monitor fixed-cardinality issue/probe/404/capacity counts without URLs, actors, cookies, or tickets.

## Unresolved questions

- None blocking. Edge, Tauri/WebView, Safari, Firefox, and real cross-site CHIPS behavior remain explicitly unsupported/pending.
