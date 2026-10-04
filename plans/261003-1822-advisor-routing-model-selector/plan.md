---
title: "Advisor routing editor and harness model selector"
description: "Edit primary and backup routes inline with safe account-policy persistence and harness-discovered model catalogs."
status: pending
priority: P2
effort: 34h
branch: feat/git-squash-commits
tags: [feature, frontend, backend, api, auth, advisor]
created: 2026-10-03
---

# Advisor Routing Editor

**Current overview:** [progress.md](./progress.md). This navigation exists before first capture. Captured plan/phase statuses are historical snapshots, not current completion authority. Parent alone owns controller runs, receipts, reconciliation, and progress publication.

## Preflight Contract

- Output: safe server policy-update API; four-harness discovery API; typed client/provider/REST mappings; inline `PolicySummaryCard` editor; unit, API integration, and browser interaction coverage.
- Acceptance: click **Edit Routing** on **Active Owner Policy**; choose `omp`, `codex`, `claude`, or `pi`; select discovered/fallback model or custom text; select effort; receive live duplicate-route validation; save atomically to effective HOME's `.evcrate/advisor-routing.json`; see committed policy/revision immediately.
- In scope: change existing V2 primary/backup backend/model/effort; dynamic harness discovery, fallback catalogs, custom model input.
- Out of scope: wait/history editing, missing-policy creation, invalid-policy repair, V1 migration, executing advice, new settings/history controls, plugins.
- Security contract: current authenticated admin + enabled Advisor; fixed server-owned path; symlink/non-regular rejection; recursive credential-field rejection; 16 KiB request/source/output limit; atomic same-directory replacement.
- Design: `PATCH /api/advisor/policy` accepts `{expectedRevision, advisor:{primary, backup}}`, returns `PolicyReadCurrentResultDto`; `POST /api/advisor/models` accepts `{backend}`, returns normalized models/efforts/source/diagnostic.
- Preserve raw disk `wait`/`history` snake_case values; camelCase DTO serialization must never become the persistence format. Catalog membership is advisory, not a custom-model admission gate.
- Edit only a `ready` V2 policy. Other statuses remain explicit read-only states; no invented runtime defaults or silent migrations.

## Phases — Initial Snapshot

| # | Phase | Status | Effort | Detail |
|---|---|---|---|---|
| 01 | Server policy update | Pending | 8h | [Policy persistence/API](./phase-01-server-policy-update.md) |
| 02 | Harness model discovery | Pending | 8h | [Discovery/fallback catalogs](./phase-02-server-harness-model-discovery.md) |
| 03 | Frontend transport/provider | Pending | 4h | [Typed owner-bound operations](./phase-03-frontend-transport-data-provider.md) |
| 04 | Inline card editor | Pending | 8h | [Editor/validation/styles](./phase-04-frontend-ui-inline-card-editor.md) |
| 05 | Verification/quality gates | Pending | 6h | [Tests/docs/qualification](./phase-05-verification-quality-gates.md) |

## Dependencies and Invariants

- 01 and 02 share `mod.rs`, `history.rs`, and API registration: one integration owner. 03 depends on frozen 01/02 DTOs; 04 depends on 03; 05 qualifies all landed changes once.
- Reuse native `AdvisorService`, current auth middleware, `ApiClient.advisor`, REST mapping, `NativeAdvisorProvider`, `POLICY_COMMIT`, and `.native-advisor` CSS scope. No alternate state service/transport.
- Workspace connection/profile owns policy and catalog requests; never use Settings target or arbitrary connected server. Fence late results by captured provider, context epoch, and operation sequence.
- Source evidence: [scout report](../reports/scout-261003-1822-advisor-routing-model-selector.md), [native architecture](../../docs/architecture/native-advisor.md), [configuration](../../docs/configuration/advisor.md), `AGENTS.md`, current package scripts.
- `docs/development-rules.md` and project-local `.omp` absent at authoring; use current repository rules and installed planning/advisor-mentoring guidance. Existing architecture read-only statements are intentionally superseded only by this narrow approved feature; reconcile docs during implementation.

## Side-Effect Review Checklist

- [ ] Only fixed account policy route values change; wait/history and unrelated JSON values survive.
- [ ] Failed validation/conflict/pre-rename I/O leaves original bytes intact; no symlink target or sibling file modified; temporary files cleaned.
- [ ] Discovery performs bounded read-only harness queries, never starts an inference/session or logs credentials/config/stdout/stderr.
- [ ] Auth, disabled default, history snapshots/filtering, evaluation behavior, Settings target, and workspace ownership unchanged.
- [ ] Cancel/revoke/disconnect/backend-switch cannot publish old-owner policy/catalog results; aborted writes are not falsely reported rolled back.
- [ ] Card is keyboard-accessible, responsive, theme-safe; no unscoped CSS, iframe, plugin, nested root, or new dependency.
- [ ] Unit/API/browser gates and typecheck/lint pass with recorded evidence; docs/changelog reflect actual landed behavior, not planned claims.
- [ ] Parent publishes authoritative completion receipts and updates uncaptured `progress.md`; sealed plan/phase files remain untouched.

## Unresolved Questions

None requiring user input. Harness command/version compatibility is an implementation evidence gate in Phase 02, not permission to invent a model-list command or silently drop a backend.
