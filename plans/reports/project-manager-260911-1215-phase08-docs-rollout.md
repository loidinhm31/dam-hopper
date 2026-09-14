# Phase 08 Project Status Report — Documentation, Controlled Rollout, and Rollback

**Recorded:** 2026-09-11  
**Parent plan:** `plans/260910-1604-agent-activity-idle-suspend/`

## Status

- Phase 08: **DONE (2026-09-11); 100%**.
- Parent plan: **complete; 8/8 phases; 111/111h; 100%**.
- Frontmatter verified: required `title`, `description`, `status`, `priority`, `effort`, `branch`, `tags`, and `created` fields present; `status: complete`, `effort: 111h`.
- Phase table verified: Phases 01–08 each `DONE (2026-09-11)` and `100%`.

## Documentation and Roadmap

- Corrected the parent plan validation summary so it no longer says Phase 08 is pending; records documentation, rollout, rollback, and evidence handoff closed on 2026-09-11.
- Updated `docs/project-roadmap.md` with Phase 08 delivery evidence, report links, 100% progress, and the explicit Operations gate for any real-host automatic-suspend canary.
- Phase 08 documentation/runbook work covered 14 repository assets, including the docs index: operator guidance, API/configuration/security references, architecture and standards maps, systemd/release procedures, root/UAT routing, changelog, and roadmap.

## Evidence

- Boundary verifier: **14/14** checks passed.
- Idle-suspend integration: **20/20** active tests passed; ignored live Linux PTY/TCP observer smoke passed in **0.74s** in the QA run (review rerun: 0.73s).
- Protected status UI Chromium tests: **16/16** passed.
- Full UI package suite: **1606/1606** passed across 233 files.
- Code review: **9.6/10, approved**, no critical issues; reviewer re-check of the docs index (`docs/README.md`) also found zero issues.
- Automated validation used fake suspend outcomes; no real suspend, RTC mutation, root installation, or external model API call claimed.

Reports: [QA](qa-260911-1207-phase08-idle-suspend-rollout.md) · [Code review](code-review-260911-1208-phase08-docs-rollout-rollback.md).

## Operational Gate / Risks

- Real-host automatic suspend canary is **not** claimed complete. Operations must designate a Linux host, owner, maintenance window, bounded wake/recovery path, exclusive RTC ownership, and rollback authority.
- Before enablement, run direct proc/netlink qualification under the deployed service context, observe a disabled `agent-activity` soak, sanitize/archive evidence, and retain `empty-fleet` or `enabled = false` when capability, transport, namespace, latency, or privacy gates fail.
- Rollback remains startup policy selection (`automatic_policy = "empty-fleet"`) plus API restart; emergency disable additionally sets `enabled = false`; full helper reset is separate and broader.

## Next Steps

1. Operations review rollout artifacts and assign the first target-host observation soak.
2. Execute dark release with existing `empty-fleet`/default-off configuration.
3. Complete target-host qualification and warning-transition soak before any bounded automatic canary.
4. Approve and run one bounded canary, reconcile status/audit/resume exactly once, then expand one host at a time only on clean evidence.

## Unresolved Questions

1. Which Linux production host, Operations owner, maintenance window, and physical/out-of-band recovery path will own the first soak/canary?
2. Which access-controlled archive will retain sanitized per-host qualification evidence?
3. Do representative production agents use UDP/QUIC, separate namespaces, or external proxy delegation that makes observation unavailable?
4. Will target service contexts consistently finish proc/netlink sampling and join within the one-second budget under load?
