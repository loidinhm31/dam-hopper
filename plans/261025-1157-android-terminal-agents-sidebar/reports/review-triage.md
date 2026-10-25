# Independent plan review triage

Status: accepted corrections propagated; [targeted follow-up](independent-plan-followup.md) closes F1–F4 and the Settings gap at plan-design level. Initial [review](independent-plan-review.md) preserved unchanged. One initial review and one bounded follow-up completed; no residual critical/high finding established in assigned revised surfaces. No product implementation or runtime evidence.

| Finding | Disposition | Required correction |
|---|---|---|
| F1 High — replacement WsConnection socket-value alias | Accept | Retained-host attachment incarnation in captured keys/receipts/targets; same-value replacement regression. Logical display-cache owner remains separate. |
| F2 High — Main/non-suspending check not runtime serialization | Accept | Explicit mutation/lock table and local commit linearization. Existing profile→registry admission, then bounded roster/socket-lifecycle/reducer try-admission; no waits/reentry/network in registry callback. Receipt commits with route/profile selection; contention visible, retirement releases gates before drain. |
| F3 High — reachable search/modal/root shortcut overlap omitted | Accept | Minimal exclusivity plus one actual-cover authority; compact Agents blocks route/search shortcuts; local dialogs/search/departure block opening Agents. Atomic covered transitions, topmost Back/Escape/cancellation, actual input/focus/resize checks. No general overlay framework. |
| F4 Medium — unsupported older-server setup and uncertain duplicate-ID setup | Accept | Deterministic test-owned caller-supplied IDs across two disposable current servers. Required typed404 coverage uses controlled real HTTP response through real ApiClient/reducer/projection; explicitly not older-version compatibility. |
| SettingsScreens second compiled caller/defaults | Accept | Freeze new initialHostSection=USAGE and onHostSectionChanged={} matching existing Host view behavior; active-root caller supplies explicit intent. No required-parameter surprise for dormant compiled caller. |

## Acceptance correction
The planner introduced mandatory older-server compatibility qualification without a requested compatibility target or verified artifact. Coordinator removes that unsupported additional gate, not the user's requested feature scope. Current-server MainActivity/two-profile qualification and required typed HTTP404 behavior remain mandatory; controlled HTTP404 is not older-server compatibility evidence. Current server's create request accepts a caller-supplied terminal ID (`server/src/api/terminal.rs:28-42,85-107`), so deterministic equal-ID tests are specified rather than treated as uncertain environment capability.

## Advisor consultation
Advisor reviewed correction direction; no source execution claim. Adopted: mutation/lock coverage, nonblocking nested admission/callback restrictions, visible contention, truthful postcommit receipt, no uncovered input between surfaces, actual topmost dismissal and no false older-version claim. Source inspected for feasibility: ProfileRepository mutex; ConnectionRegistry.admitCurrentOwner synchronous callback rules; WsConnection lifecycle mutex; reducer epoch mutex; active root shortcut/search overlap and existing Settings USAGE defaults.

## Current gate
Planner revised all affected seven authored files; coordinator inspected corrections and received complete independent follow-up. User then finalized recorded scope/layout decisions. [Final validation](final-validation.md) and [structural checks](structural-validation.md) record artifact-only outcomes. Existing unrelated plan writer-release/readiness prerequisites remain unverified, never inferred closed.
