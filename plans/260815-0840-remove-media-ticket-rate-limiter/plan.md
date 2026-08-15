---
title: "Remove media-ticket issuance capacity gates"
description: "Make bound and non-bound media-ticket issuance independent of stored ticket and session counts."
status: complete
priority: P1
effort: 2h
branch: main
tags: [backend, api, security, bugfix]
created: 2026-08-15
---

# Remove Media-Ticket Issuance Capacity Gates

## Overview

Remove global, per-actor, per-session ticket, and session-count admission checks. Preserve expiry cleanup, consume-once behavior, session/actor binding, authorization, generation invalidation, and random-collision safety.

## Preflight Contract

- **Output:** unthrottled media-ticket issuance in `server/src/fs/media_ticket.rs`, with aligned tests and exact contract docs.
- **Acceptance:** bound and non-bound issuance succeeds regardless of stored ticket/session count; all non-capacity safety behavior remains unchanged; obsolete cap tests are replaced; affected tests pass.
- **Scope:** media-ticket issuance logic and unit tests; affected API tests; only exact documentation claims made false by this change.
- **Out:** storage redesign, TTL/security changes, unrelated dirty edits, schema/config/auth changes.
- **Public contract risk:** issuance no longer returns capacity-derived `429`/`Retry-After`; keep defensive variants/mappings inert unless compilation or source compatibility requires a narrower cleanup.
- **Resource risk:** live in-memory state may grow until ordinary expiry/revocation/cleanup; do not remove cleanup that is unrelated to admission.
- **Open questions:** none. “Unthrottled” means removal of ticket and media-session admission caps.

## Phase

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---|---|---|
| 1 | Remove issuance capacity gates and validate | Complete | 100% | 2h | [phase-01](./phase-01-remove-issuance-capacity-gates.md) |

## Completion Evidence

- Removed ticket/session count admission gates while retaining ticket lifecycle safeguards.
- Rust formatter passed; focused media-ticket tests passed.
- Image/video API threshold regression tests passed beyond former count limits.
- Final review scored 9.5/10 with no critical findings; user approved the change.

## Side-Effect Review

- **Auth/session/permissions:** retain authentication, actor/session ownership, revocation, and cookie binding.
- **API compatibility:** remove capacity rejection behavior; preserve unrelated status/error contracts.
- **DB/data:** none; store remains process-local and in-memory.
- **Business logic:** issuance count ceases to be an admission condition only.
- **Security/privacy/logging:** retain opaque tokens, collision retries, indistinguishable stream failures, and no secret logging.
- **Performance/concurrency/resources:** preserve locking and cleanup; document bounded-lifetime but newly unbounded-count memory risk.
- **Docs/config/deploy:** no config/deploy changes; correct exact cap/429 claims where present.

## Dependencies

- Existing media-ticket store and API test harness.
- Implementation must inspect and preserve unrelated dirty edits in `server/src/fs/media_ticket.rs`.

## Unresolved Questions

None.
