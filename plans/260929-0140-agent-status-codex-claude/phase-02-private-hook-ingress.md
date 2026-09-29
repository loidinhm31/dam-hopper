# Phase 02 — Private hook ingress and lifetime

## Context links
[Plan](./plan.md) · [Contract §§2–3](./design-contract.md) · [Phase 01](./phase-01-capabilities-and-observation-contract.md)

## Overview
Date: 2026-09-29. Priority P1. Estimate 10h. Implementation Complete; review Approved (Cycle 2 remediated; 54 unit, 5 hook integration, 8 runtime tests passing).
Add passive one-shot reporting without faking persistent OMP connections.

## Key Insights
Command hooks are short-lived. Reconnecting one WebSocket per event would mark state Unknown on every close. Blindly heartbeating old state would hide native-event gaps.

## Requirements
Same private capability/Host/Origin boundary; independent bounded POST ingress; one root authority; no normal server startup from reporting command. All failures silent for native agent, actionable for management UI. Evidence expires after 15s with no fake heartbeat.

## Architecture
`report-hook` → private `POST /v1/agent-hooks` → root/turn validation → provider normalization → existing registry/public pushes. Keep OMP WebSocket untouched. Root process ancestry validation occurs off locks. Reject arbitrary root PIDs supplied in JSON.

## Related code files
Modify:
- `server/src/main.rs`: concrete native management/report-hook dispatch before config/listener/database startup.
- `server/src/agent_status/{mod.rs,collector.rs,runtime.rs,reducer.rs,types.rs}`: bounded ingress, shared admission and evidence expiry.
- `server/src/pty/manager.rs`: expose only required private incarnation/process identity and actual spawn environment facts; retain reserved env filtering.
- `server/tests/agent_status_runtime.rs`: cross-transport admission and retirement tests.
Create:
- `server/src/agent_status/hook_reporter.rs`: stdin allowlist reader and bounded local request client.
- `server/src/agent_status/hook_ingress.rs`: private request validation/root claim normalization; concrete native kinds, not plugin abstraction.
- `server/tests/agent_status_hooks.rs`: consumer-visible transport/lifecycle cases.
Delete: no existing OMP transport.

## Implementation Steps
1. Locate reusable Linux process identity/ancestry APIs before writing a second implementation; LSP references before changes. Preserve Unix cfg boundaries and non-Linux platform-unqualified behavior.
2. Add internal report-hook CLI. Read credentials only from private env, validate loopback URL, native stdin limits and schema, derive ancestry; no capabilities in argv/logs. Dormant without credentials.
3. Add collector POST route with body/time/concurrency/rate limits; never mount on authenticated public API router or tunnel discovery.
4. Normalize root identity and runtime config path; verify against actual PTY incarnation. Root/child ambiguity and conflicting owner reject safely. Native hooks cannot evict a live OMP reporter.
5. Use current native session/turn correlation, epoch/sequence and bounded event dedupe. Reject old session/turn callbacks; no receipt-order-as-causality assumption.
6. Extend existing lease scheduler for event evidence. Expiry marks Unknown without attention; OMP disconnect/heartbeat rules retain existing semantics.
7. Prove with a throwaway isolated collector/report-hook execution: accepted event visible through snapshot; idle time expires; revoked token rejected; native reporting exits 0 silently on unreachable collector. Remove throwaway fixtures after proof.
8. Run focused tests after coherent edits, including existing OMP runtime cases. No concurrent test/build over half-integrated shared files.

## Todo list
- [x] Silent bounded reporting CLI and private ingress.
- [x] Verified root/incarnation/correlation and expiry.
- [x] Real subcommand/collector smoke and regression tests.

## Success Criteria
Only current terminal's admitted native root can update its row. Duplicate callbacks are idempotent; delayed old callbacks cannot alter a new turn. Quiet native observations expire in 15s; OMP remains authoritative with its own heartbeat. No browser Origin or public API can invoke native ingress.

## Risk Assessment
PID reuse, asynchronous hooks, containers, multiple agents per PTY and rate-limit resets are easy failure modes. Reject unverifiable identity and retain Unknown. Oversized native payload can drop status but cannot block agent work.

## Security Considerations
No shell-built request commands, raw-body diagnostics, token persistence, prompts or transcripts. Reuse existing dependencies; no daemon or external interpreter runtime. Avoid allocation of discarded JSON fields.

## Next steps
Phases 03/04 can proceed against the stable CLI/admission interfaces. Qualification must observe silent reporting outside DamHopper and collector failure inside it.
