# Phase 3 — Integration, verification, review

## Context links
[Parent plan](plan.md), [phase 1](phase-01-backend-lifetime-reminder.md), [phase 2](phase-02-shared-ui-reminder.md).

## Overview
2026-10-07. P2. Implementation/verification: complete. Review: source approved; parent runtime confirmation passed. User approved implementation and scoped commit, no push/deployment. Owners: orchestrator, configured `tester` and `code-reviewer` roles/models retained.

## Key insights
Tests alone cannot certify connector persistence or browser actions. Use freshly built server and real throwaway origin sockets; no active service/user domain touched.

## Requirements
All parent acceptance criteria; exact exercised evidence; complete code review; explicit approval/commit handling, no automatic commit.

## Architecture
Parent integrates disjoint actor work after terminal results; no mid-flight build/test. Ordinary new off-mode plan, no controller state or historical plan mutation. Parent solely owns plan/docs and finalization.

## Related code files
Phase 1/2 changed files; `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/CHANGELOG.md`, applicable existing API/user docs; this plan only.

## Implementation steps
1. Collect both implementation outputs, inspect contracts, compile/typecheck, run focused Rust/UI behavior suites. Run one independent review alongside read-only verification slice when feasible.
2. Run freshly built isolated server/real Cloudflared socket and PTY lifecycle smoke. Confirm same ID/URL/PID, reopening recovery, explicit Stop and shutdown cleanup.
3. Open actual web app in managed browser, inspect retained port and reminder, click Dismiss/Stop, verify error/owner/privacy behavior as applicable. Use throwaway controlled-time proof for reminder; no permanent test knobs.
4. Address verified findings, rerun affected checks; report limitations precisely.
5. After smoke proof, finish architecture/changelog/API docs and ordinary plan status. Ask user review approval and whether to commit. Commit only with explicit confirmation.

## Todo list
- [x] Compilation/typecheck and behavior tests.
- [x] Real connector/socket lifecycle smoke.
- [x] Actual browser visualization/actions.
- [x] Independent review and corrections.
- [x] Docs/status and explicit approval/commit question; user selected Approve and commit.

## Success criteria
Every named acceptance met with evidence; no throwaway data/processes left; no unrequested release/config changes or commit.

## Risk assessment
Probe clock acceleration must not imply three hours were waited. URL-parsed Ready is not public HTTP success; verify separately or state limit. Existing unrelated failures must be isolated rather than suppressed.

## Security considerations
Loopback unauthenticated probes only, sanitized empty environment/HOME, throwaway publicly exposed sockets only. No private services, tokens, or production config.

## Next steps
Evidence in [runtime/review report](reports/runtime-and-review.md) and [tester report](../reports/tester-261007-1140-cloudflared-persistence-reminder.md). Probe processes/data cleaned, docs/changelog/API updated. User approved scoped commit; no push/deployment. Existing Clippy/rustfmt gates remain non-green; native desktop/Windows/full Rust/Docker E2E not qualified.
