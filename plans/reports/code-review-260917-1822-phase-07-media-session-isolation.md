# Code Review: Phase 07 — Media Session Isolation & Encrypted-Write Ownership

**Date:** 2026-09-17  
**Reviewer:** Phase07CodeReviewer (Senior Software Engineer)  
**Plan:** `plans/260916-2137-unified-profile/phase-07-media-isolation-and-encryption.md`  
**Score:** 9.5/10

---

## Code Review Summary

### Scope
- **Files reviewed:** 27 modified/added files across `server/` and `packages/ui/`:
  - Server: `server/src/fs/media_session.rs`, `server/src/fs/media_ticket.rs`, `server/src/fs/image_ticket.rs`, `server/src/fs/video_ticket.rs`, `server/src/api/fs_image.rs`, `server/src/api/fs_video.rs`, `server/src/api/media_session.rs`, `server/src/api/media_stream_response.rs`, `server/src/api/auth.rs`, `server/src/api/tests.rs`
  - Client API & Lib: `packages/ui/src/api/connections.ts`, `packages/ui/src/api/media-session.ts`, `packages/ui/src/api/media-session.test.ts`, `packages/ui/src/api/image-tickets.ts`, `packages/ui/src/api/image-tickets.test.ts`, `packages/ui/src/api/video-tickets.ts`, `packages/ui/src/api/video-tickets.test.ts`, `packages/ui/src/lib/start-video-download.ts`
  - Client UI & Hooks: `packages/ui/src/contexts/EncryptContext.tsx`, `packages/ui/src/contexts/EncryptContext.test.tsx`, `packages/ui/src/hooks/use-encrypted-write.ts`, `packages/ui/src/hooks/use-encrypted-write.test.tsx`, `packages/ui/src/components/organisms/ImagePreview.tsx`, `packages/ui/src/components/organisms/VideoPreview.tsx`, `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`, `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
  - Browser Fixtures & Config: `packages/ui/vitest.browser.config.ts`, `packages/ui/browser-tests/explorer-image-preview.browser.tsx`, `packages/ui/browser-tests/explorer-video-playback-download.browser.tsx`
- **Lines of code analyzed:** ~2,600 lines (+1,805 / -453)
- **Review focus:** Media v2 wire contract, namespaced session cookies, stream ticket authorization, fail-closed duplicate parsing, scoped revocation, `RemoteCleanupHandle`, encrypted write ownership (owner-generation keying, prompt queueing/dedup, collision-free OPAQUE IDs, single captured transport, freshness validation, key zeroing).
- **Updated plans:** `plans/260916-2137-unified-profile/phase-07-media-isolation-and-encryption.md` (100% completed).

---

## Overall Assessment

Phase 07 is thoroughly designed, robustly implemented, and comprehensively verified. All architectural and security constraints from the plan have been executed:
1. **Media V2 Contract:** Enforces UUIDv4 `mediaClientId` across all image/video issue/revoke and media session DELETE routes with `deny_unknown_fields` and 422 rejection for invalid/missing values.
2. **Cookie Namespacing & Stream Isolation:** Cookies use `damhopper-media-session-<uuid>`, with `Path=/api/fs`, `HttpOnly`, `SameSite=Lax`, and `Max-Age=28800`. Stream authorization resolves the trusted client ID from the server-stored ticket, never from client-controlled headers/queries. Duplicate cookies fail closed (404).
3. **Scoped Revocation & Cleanup:** Server `revoke_sessions_and_tickets_for_client` strictly scopes revocation to `(actor.subject, mediaClientId)`. `RemoteCleanupHandle` provides a bounded 5s, idempotent lease cleanup without general write capabilities.
4. **Encrypted-Write Ownership:** Encrypt state, passphrases, and OPAQUE sessions are indexed by owner-qualified keys (`${profileId}@${generation}:${project}`). In-flight prompts and handshakes are deduplicated. Freshness checks at each asynchronous await boundary ensure stale handshakes or connection changes immediately abort and zero mutable key buffers.

---

## Critical Issues

None. No security vulnerabilities, data corruption risks, or breaking contract regressions identified.

---

## High Priority Findings

None.

---

## Warnings List

1. **`mediaClientIdsByOwner` in `connections.ts` retains disconnected entries until full reset:**
   - In `packages/ui/src/api/connections.ts:73`, `mediaClientIdsByOwner` records `connectionKey(owner)` mapped to generated UUIDv4. When a connection reconnects or generation increments, a new key is added. While memory impact is negligible (~100 bytes per entry), disconnected keys remain in memory until `resetConnections()`.
   - *Recommendation:* Consider deleting the old key in `disconnectProfile` or `removeProfileConnection`.

---

## Suggestions List

1. **Defensive Delimiter Splitting in `extractOwnerFromKey`:**
   - In `packages/ui/src/contexts/EncryptContext.tsx:75`:
     ```ts
     const atIdx = prefix.indexOf("@");
     ```
   - If a `profileId` contains `@` (e.g. an email-formatted profile identity), `indexOf("@")` splits prematurely. Using `prefix.lastIndexOf("@")` is more defensive.
2. **Cookie Parsing Whitespace Trimming:**
   - In `server/src/fs/media_session.rs:157`, `part.trim().split_once('=')` trims the whole part before splitting. While RFC 6265 compliant browsers do not place spaces around `=`, trimming both `name.trim()` and `value.trim()` would be slightly more defensive against non-standard HTTP proxies.

---

## Positive Observations

- **Fail-Closed Stream Authorization:** `authorize_stream` and `finalize_stream_and_touch` in `server/src/fs/media_ticket.rs` resolve the namespace strictly from the stored ticket binding, completely eliminating parameter tampering / routing spoofing.
- **Timing Attack Resistance:** Digest comparisons use `subtle::ConstantTimeEq` across stored digests.
- **Strict Wire Schema:** All requests use `#[serde(deny_unknown_fields)]` and reject non-UUIDv4 inputs.
- **AES Key Zeroing:** `new Uint8Array(session.aesKey.buffer).fill(0)` is executed upon session eviction, lock disabling, connection drop, and stale handshake detection.
- **Comprehensive Test Coverage:** Edge cases thoroughly exercised in both Rust and Vitest (duplicate cookies, v1+v2 coexistence, foreign namespace rejection, origin fallback, prompt deduplication, connection drop invalidation).

---

## Reviewed Files & Test Results

### Validation Commands & Results
1. **Rust Server Tests (`dam-hopper-server`):**
   - Command: `cargo test media` (in `server/`)
   - Result: 29 passed, 0 failed (38 suites, 1392 filtered)
   - Command: `cargo test image` (in `server/`)
   - Result: 9 passed, 0 failed
   - Command: `cargo test video` (in `server/`)
   - Result: 17 passed, 0 failed
   - Command: `cargo check --all-targets` (in `server/`)
   - Result: 0 errors, 0 warnings
2. **TypeScript & UI Test Suite (`@dam-hopper/ui`):**
   - Command: `pnpm --filter @dam-hopper/ui test src/api/media-session.test.ts src/api/image-tickets.test.ts src/api/video-tickets.test.ts src/contexts/EncryptContext.test.tsx src/hooks/use-encrypted-write.test.tsx src/components/organisms/ImagePreview.test.tsx src/components/organisms/VideoPreview.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx`
   - Result: 8 test files passed (8), 50 unit tests passed (50), 0 failed
   - Command: `pnpm --filter @dam-hopper/ui build`
   - Result: Exit code 0, 0 TypeScript compiler diagnostics

---

## Metrics
- **TypeScript Typecheck:** 100% clean (0 errors)
- **Unit Test Success Rate:** 100% (50/50 UI tests, 55/55 server media/image/video tests)
- **Code Standards Alignment:** 100% compliant with `./docs/code-standards.md` and Phase 07 contracts

---

## Unresolved Questions

None.
