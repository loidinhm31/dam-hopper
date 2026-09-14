# Validated warning report — integrated reference

Date: 2026-09-10. Implementation status: Pending.

The validation changes are incorporated directly into the [shared design contract](design-contract.md#authenticated-measurement-warning) and all eight phase files. This document records the user decision; it is not an overriding amendment or a separate task list that implementers must merge.

## Confirmed decisions

- Keep the existing 900-second (15-minute) quiet default.
- Select `agent-activity` explicitly at startup; upgrades keep `empty-fleet` semantics.
- Unknown or unsupported measurement blocks automatic suspend and produces a warning.
- Through authenticated, no-store status/UI, show the reason, continuous blocked duration, attributable PID and safe executable/entrypoint identity without arguments.
- Never expose prompts, credentials, argument strings, environment or terminal content. No warning identities in logs, audit or WebSocket hints.

## Integrated ownership

| Phase                                 | Integrated responsibility                                                         | Estimate |
| ------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| [01](phase-01-policy-contracts.md)    | Confirmed defaults/startup authority; no warning configuration surface            | 6h       |
| [02](phase-02-pty-observation.md)     | Private qualified root evidence; no reporting work on PTY hot paths               | 8h       |
| [03](phase-03-process-discovery.md)   | Bounded safe process evidence and representative socket ownership                 | 14h      |
| [04](phase-04-tcp-observation.md)     | Implicated-socket failure context without new scans or public socket details      | 14h      |
| [05](phase-05-sampler-coordinator.md) | Continuous blocked interval, same-sample evidence join and warning DTO            | 20h      |
| [06](phase-06-api-ui.md)              | Strict warning decoder and accessible PID/identity/duration display               | 10h      |
| [07](phase-07-verification.md)        | Warning auth/privacy, duration/recovery, identity/truncation and browser evidence | 26h      |
| [08](phase-08-docs-rollout.md)        | Warning documentation, observation-only qualification and redaction               | 13h      |

Total: 111h, included directly in phase estimates and the overview. No additional amendment surcharge or deferred phase rewrite.

## Unresolved questions

None from validation. Deployment permissions, kernel support and latency still require the qualification already specified in the implementation phases.
