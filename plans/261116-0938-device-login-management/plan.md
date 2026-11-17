---
title: "Move login-device management out of Server Settings"
description: "Keep account login-session management in OS Settings > Login Devices and remove its duplicate login-dialog integration."
status: pending
priority: P2
effort: 3h
branch: main
tags: [refactor, frontend, auth]
created: 2026-11-16
---

# Device login management surface cutover

## Outcome and decisions
- Canonical journey: web OS Settings app → **Login Devices** tab → existing `DevicesPage` → `LoginDevicesSection`.
- Remove device inventory/revocation and the device-specific callback/draft protocol from `ServerSettingsDialog`, not its cross-surface credential safety. Keep login, MFA, profile persistence, logout and Browser-data reset; retain a small local credential-baseline/Save-ownership guard with no device UI or callback.
- Reuse the existing Settings manifest/tab and page; no new Devices app, manifest, route, auth API/DTO, backend, storage migration or dependency.
- Smallest change: remove duplicate mounting/notification plumbing, preserve stale-credential and replacement-token protection in ordinary Save/rollback, strengthen page/app tests and migrate browser/real-connection coverage. No redesign, generic auth framework or new global state.

## Acceptance
1. Opening/editing saved, legacy or new server profiles never renders Login devices or requests `/api/auth/sessions`, including after connection testing and ambient-profile changes.
2. Settings > Login Devices still lists/refreshes/revokes sessions through the real existing section for the selected server; Cancel sends no DELETE, confirmed other-session revocation preserves current and unrelated logins.
3. Real `DevicesPage` integration preserves exact-owner self logout, replacement-token protection, connection generations, socket/4401 ordering and actionable cleanup failures. Retain cross-surface real-dialog regressions: revoked A cannot be restored; external B cannot be overwritten; ACK during awaited media cleanup aborts stale Save with/without B.
4. Fresh successfully authenticated/MFA credentials remain saveable after prior self-revocation, including the existing challenge/verified-before-ACK cases. Check the captured verification owner/persisted-token baseline before Save; freeze operation ownership and recheck after awaits, before credential writes/reconnect and rollback. Never rebase an in-flight Save onto another flow's token or restore revoked A.
5. Controlled profile selection/`noLayout`, login/MFA/save/logout/Browser reset, narrow layout and keyboard confirmation remain covered; no orphan helper calls or hidden dialog session requests. Failure is actionable, never “Saved!”, close/reload or stale reconnect.

## Phase
| # | Phase | Status | Effort |
|---|---|---|---|
| 01 | [Cut over surface, regressions and qualification](./phase-01-device-login-surface-cutover.md) | Pending | 3h |

## Evidence and architecture decision
- Initial source evidence: the dialog mounted the section and contained `CredentialDraftScope`, callback and Save guards for that integration. Remove that coupling, but the Advisor's later actual-code finding establishes that its stale-credential/replacement behavior cannot be deleted; use the phase's local general Save guard instead.
- `DevicesPage.tsx` already renders `variant="page"` with controlled profile/noLayout props; `SettingsApp.tsx` already mounts it under Login Devices. No production page/app changes indicated.
- Initial tests inspected: dialog device cases at `ServerSettingsDialog.test.tsx:524–587`; page/app tests mocked their child boundary; browser coverage mounted the dialog. `login-devices-connections.test.tsx` was omitted from writable ownership despite being a required verification target; this revision corrects that gap.
- Existing `LoginDevicesSection.test.tsx` covers real section list/revoke, exact-owner self logout, replacement credentials, stale profile/URL/generation/unmount results, no-auth and cleanup retry. Preserve these checks alongside the migrated real-connection suite.
- Architecture Gate 1 evidence: existing `docs/system-architecture.md` and `docs/code-standards.md` require exact-owner async fencing. Dataflow becomes SettingsApp → DevicesPage → existing section/owner/hook → unchanged auth client; dialog independently owns verified credential/Save snapshots. No new route, storage or global ownership state machine.
- Architecture/user-guide placement text is already cut over, per prior review. Docs owner must reconcile final placement plus the retained general Save/rollback safeguard and fresh-login recovery; distinguish removed device callback state from preserved security behavior. Preserve unrelated edits, historical qualification status and existing correct passages; changelog must not claim all guards were removed.

## Observed implementation feedback and bounded repair
- Parent-supplied focused run: exactly **15 failures**, all in `packages/ui/src/components/organisms/login-devices-connections.test.tsx`; each queries the removed dialog-owned section at line 70 and fails before its substantive assertions. This proves stale hosting, not passing owner/connection safety or fifteen production regressions.
- Earlier UI build reported an orphan `requireCredentialOwnership` at line 859; parent now reports deletion of that dangling call only. The TS2304 repair is not proof of credential safety or a current compile receipt. Earlier browser **3/3** qualifies neither the amended guard nor unit/build/full-app visual behavior.
- New Advisor actual-implementation finding: dialog validated with A can restore it after page self-revocation; stale Save/rollback across awaited media cleanup can overwrite external B. Current dialog lacks an ownership guard after callback removal. Treat as a targeted security/lifecycle implementation correction, not permission to restore dialog devices or `onSelfRevoked`.
- Storage evidence: `server-config.ts:255–322` resolves explicit profile credentials and rejects endpoint/authType mismatch; `:326–360` writes/clears notify profile/connection listeners synchronously. Bind `{profileId, normalized endpoint, tested baseline token}` using existing APIs; account for own metadata/token transitions and listener effects without duplicating the token store.
- Test agent has migrated the integration suite to real `DevicesPage` plus separately scoped real `ServerSettingsDialog`/QueryClientProvider. Retain current cases at approximately 219–261 (stale A, external B, media-await ACK with replacement false/true) and 202–217 (fresh MFA challenge/verified remains saveable). Their presence is observed/supplied evidence, not a passing receipt; earlier directions to replace Save regressions are superseded.

## Dependencies, ownership and related plans
- One sequential UI integration owner; docs owner receives an explicit handoff. `detach-dialog-devices` owns production dialog guard/rollback and dialog unit tests; `prove-settings-device-surface` owns cross-surface integration regressions; callback retirement remains isolated. All six `blocked_by` arrays remain empty with unchanged disjoint file lists. Coordinator enforces serial handoffs and five-edit join, retaining edit tasks `in_progress` until joined qualification/review.
- Related plan: `plans/261022-0322-device-login-management/plan.md` is **informational; superseded only for dialog placement**. Its Phase 02 says keep UI in ServerSettingsDialog; this request changes that presentation decision only.
- Related evidence: that overview lines 24–27, 62–66 and `phase-03-validation.md:65–69` record earlier implementation/automated evidence and a pending human visual gate. Preserve backend contracts, qualification status and that human gate; no inferred completion, edits, imports or required backend dependency.
- Read-only overlap with broader OS plans is informational: reuse delivered Settings/Devices surfaces; do not reopen shell/catalog work. Serialize any actual conflicting runtime writer before implementation.

## Planning gates and handoff
- Selected fast route; supplied local evidence sufficient, external research unnecessary. No repeated research or nested planner invocation; parent retains the review/validation gates below.
- Prior independent plan challenge and its one targeted follow-up accepted **R1 High**'s serial-orchestration deadlock correction: [review report](./reports/plan-review.md). Preserve it. The initial-plus-one-follow-up plan-review budget is exhausted; **this new credential safeguard has not received independent plan review**. Do not invoke another plan reviewer or reuse earlier acceptance for it. Parent treats it as a targeted implementation correction and requires final independent code/docs review on the joined tree; unresolved material security findings block completion.
- Authoring gate: inspect actual linked artifacts and validate exact task schema/IDs/literal paths/DAG/marker parity using installed read-only task-source parser. Existing `tasks.json` is read-only to this author; no hydration or state approval.
- Parent-only state reconciliation: all six stable IDs are currently `in_progress` under `device-login-coordinator-main`, per supplied context. Collect terminal affected workers before deliberate hydrate; overview/full-phase semantic changes stale all six fingerprints and invalidate current claims/evidence/mappings. Preserve every history event, including detach's earlier `main-device-login-implementation` claim/start and the current coordinator history; never hand-edit state. Reopen with this targeted-correction reason, retrieve current fingerprints, claim/start exact IDs in phase serial order without premature completion; `list`/`next` may offer all six. After five-edit/docs join, qualify while edits remain active, then complete each only with current-fingerprint joined verification and passing implementation/docs review. No author hydration or old-fingerprint completion.
- Final validation/interview remains parent-owned; **pending-validation/unreviewed amendment**, not implementation approval or a ready claim. No genuine new product question; do not invent another interview. Earlier review/verification receipts do not validate this safeguard.
- No product tests, builds, browser runs or implementation performed by this author. Observed failures/pass above are supplied evidence; phase commands remain parent-owned verification requirements, not new passing receipts.
- Active context on intake: none. Explicit selected path overrides later naming suggestions; if session setter cannot persist, carry this exact path explicitly.

## Unresolved questions
None.
