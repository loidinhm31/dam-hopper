# Phase 04 — Documentation and Release Gate

## Context links

- [Plan](./plan.md) · [Phase 3](./phase-03-security-and-browser-regression-matrix.md)
- [Configuration](../../docs/configuration-guide.md) · [Architecture](../../docs/system-architecture.md) · [API](../../docs/api-reference.md)
- [Profiles guide](../../docs/user-guide-multi-server-profiles.md) · [Linux deployment](../../docs/linux-nohup.md)

## Overview

- Date: 2026-08-13
- Description: replace mandatory-HTTPS claims with precise HTTP support/risk/topology guidance; run repository release gates.
- Priority: P1
- Implementation status: Pending
- Review status: Required; docs/security/release owner

## Key Insights

- “All HTTP deployments” means server/client no longer block HTTP; browser cookie rules still make cross-site HTTP technically unavailable under secure authorization semantics.
- SameSite is schemeful. Frontend/API can be same-origin or same-site over HTTP; an HTTP/HTTPS scheme split is cross-site and unsupported by Lax cookie delivery.
- Docs must distinguish application-layer authorization from transport security. Opaque tickets do not protect intercepted traffic.
- Historical plans/change records should remain historical; update current normative docs only.

## Requirements

- Document HTTP as allowed for authenticated binds, server profiles, media issue/revoke/probe/stream, including non-loopback deployments.
- Remove `DAM_HOPPER_TRUSTED_TLS_PROXY`, `--trusted-tls-proxy`, mandatory CORS, exact-HTTPS-only, Secure/Partitioned cookie, and HTTPS-only revoke claims from current docs/examples.
- CORS contract: unset for same-origin; exact comma-separated HTTP/HTTPS origins only when cross-origin; credentials; no wildcard/reflection; required methods/headers/exposed Range fields.
- Cookie contract: media host-only `HttpOnly; SameSite=Lax; Path=/api/fs`; auth fallback host-only `HttpOnly; SameSite=Strict; Path=/`; both non-Secure for HTTP compatibility. Bearer remains primary protected-API auth.
- Prominent risk statement: HTTP exposes Bearer/auth/media cookies, ticket URLs, API payloads, media bytes, terminal/file/git actions to interception/replay/modification. Use HTTPS or a trusted encrypted network when risk is unacceptable.
- Topology matrix: same-origin HTTP supported/qualified; schemefully same-site HTTP status based on tests; cross-site HTTP unsupported because `SameSite=None` requires `Secure`; HTTPS cross-site/CHIPS behavior no longer implied by removed Partitioned policy.
- Retain TTL/capacity/revalidation/revocation, process-local/sticky-routing, native Range/HEAD, no bearer/blob fallback, and browser-evidence boundaries.
- Update examples to run default HTTP without TLS-proxy assertion; show optional exact HTTP CORS for separate frontend origin.

## Architecture

- Update existing media sequence and security section before release. Diagram should show Bearer on protected issue/revoke and cookie-only stream over either HTTP or HTTPS.
- No new docs file unless an existing file cannot host the content; KISS favors current configuration/API/profile guides.

## Related code files

- Modify `docs/system-architecture.md` — normative auth/cookie/CORS/media topology and Mermaid sequence.
- Modify `docs/configuration-guide.md` — CLI/env/examples, optional CORS, HTTP risk and deployment matrix.
- Modify `docs/api-reference.md` — exact set/clear cookies, protected vs stream auth, HTTP revoke/topology.
- Modify `docs/user-guide-multi-server-profiles.md` — HTTP profile support, cleartext token/media risk, transition revocation.
- Modify `docs/linux-nohup.md` — authenticated non-loopback HTTP example and trusted-network warning; no TLS-proxy env.
- Modify `docs/codebase-summary.md`, `docs/project-overview-pdr.md`, `docs/code-standards.md` — current concise invariants.
- Modify root `README.md` and `docs/README.md` only where setup/security summaries contradict the shipped contract.
- Do not modify completed plan files or unrelated changelog history.
- Delete: none.

## Implementation Steps

1. Search current docs/code help for `trusted-tls-proxy`, `TRUSTED_TLS_PROXY`, mandatory `HTTPS`, `SameSite=None`, `Partitioned`, HTTPS-only revoke, and exact-HTTPS CORS; classify historical vs normative references.
2. Update architecture first: two-part auth invariant, HTTP-compatible cookies, schemeful-site limitation, transport threat model, process-local state.
3. Update CLI/config examples: authenticated `0.0.0.0` works directly; CORS optional for same-origin; separate HTTP frontend uses exact origin. Retain no-auth loopback guard.
4. Update API/profile docs with endpoint-specific credential table and revocation ordering. Explicitly say Bearer is not accepted as stream fallback.
5. Add deployment support matrix with exact evidence from Phase 3. Do not advertise cross-site HTTP or unexecuted engines/topologies.
6. Update summaries/standards/README references; avoid duplicating long explanations—link to configuration/security section.
7. Run full format, test, build, lint, diff, and secret checks. Record environment: Linux, Chromium executable/version, Asia/Saigon, 2026-08-13.
8. Side-effect checklist: preserve unrelated `.gitignore`, `.codegraph/`, `.worktree/`, media/key/cert files; no staging/commit; no generated browser screenshots unless an intentional assertion changed.

## Todo list

- [ ] Architecture updated before final implementation sign-off
- [ ] CLI/env/CORS examples match runtime
- [ ] Cookie and endpoint credential tables exact
- [ ] HTTP interception warning prominent
- [ ] Cross-site HTTP limitation explicit
- [ ] Full test/build/lint gates green
- [ ] Unrelated worktree state preserved
- [ ] Docs/security/release reviewers approve

## Success Criteria

- `rg "trusted-tls-proxy|TRUSTED_TLS_PROXY|SameSite=None|Partitioned|INSECURE_MEDIA_SERVER" server/src packages/ui/src docs README.md` returns no current-contract leftovers (historical changelog exceptions reviewed).
- Docs never say opaque/session-bound auth makes HTTP confidential or tamper-proof.
- Full commands pass: `cargo fmt --manifest-path server/Cargo.toml -- --check`; `cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings`; `cargo test --manifest-path server/Cargo.toml`; `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`; `pnpm --filter @dam-hopper/ui build`; `pnpm build`; `pnpm lint`; `git diff --check`.
- `git status --short` contains only intended target changes plus untouched pre-existing unrelated entries; index remains unchanged.

## Risk Assessment

- Docs overpromise “global HTTP”: mitigate with topology matrix and observed-evidence wording.
- HTTPS recommendation mistaken for requirement: label it risk mitigation, not runtime guard.
- Broad format command touches unrelated files: format/check named files or use check-only commands; review diff immediately.

## Security Considerations

- State threat model plainly: on-path attacker can steal/replay Bearer/auth/media credentials and alter responses over HTTP.
- Recommend HTTPS, VPN/Tailscale, or otherwise trusted network; never imply CORS/SameSite/opaque tickets replace encryption.
- Preserve secret-redaction, no-store, TTL/caps, revocation, file revalidation, and sticky-routing caveats.

## Next steps

- Coordinated server/UI release. Roll back only to prior session-bound pair; never restore capability-only or Bearer-stream fallback.

## Unresolved questions

- None.
