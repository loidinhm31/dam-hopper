# Phase 03 — Integrated qualification and finalization

## Context links
[Overview](./plan.md), [preflight and side-effect checklist](./preflight.md), [backend](./phase-01-backend-squash.md), [shared UI](./phase-02-shared-squash-ui.md), [prior real-runtime qualification](../reports/qualification-261002-0245-git-history-qualification.md).

## Overview
Date: 2026-10-03. Priority: P2. Status: complete; qualification and terminal review finished, findings resolved, user explicitly approved implementation with recorded broad-gate limitations. [Observed evidence and limits](./reports/qualification.md).

## Key Insights
Tests do not prove actual app interaction. Destructive scenarios must use disposable repositories, never this working repository or user projects. Existing component Chromium harness is not full-stack E2E. Existing leased push is explicit and must address the same history root.

## Requirements
Verify full preflight acceptance; record only actually observed commands/scenarios. Keep regression tests deterministic and consumer-visible; no source-text assertions, copied-field wiring tests or mock echoes. Existing frontend wording/implementation tests made obsolete by changes are removed, not repinned. Finish review approval before final status.

## Architecture
Disposable Git repositories and bare remote → isolated loopback Axum config → actual Vite web app → shared Git history surfaces → local squash → optional explicit lease prepare/publish. Independent Git CLI oracles verify local/remote refs and trees; browser observes accessibility, body editing, pending state, warnings and focus. Test-only synthetic fixtures may supplement difficult focus/race edges, not replace this journey.

## Related code files
Modify only affected real behavior test files from earlier phases as needed. After smoke, update docs/api-reference.md, docs/architecture/git-history-search.md, docs/frontend-components/terminal-and-ide.md, docs/CHANGELOG.md and narrowly relevant system-architecture section if necessary. Publish current-run reports under this plan's reports/. Update ordinary plan/phase statuses, never historical sealed reports/plans. No new standalone design guide, images, deps or config.

## Implementation Steps
1. Integrate both implementation slices. Inspect exported-symbol references (LSP if available; startup status reported no servers configured) and ensure additive API client/mapping/query DTO matches server. Preserve edit/drop/reset/normal push behavior and profile-bound ownership. Resolve real conflicts, no compatibility shims.
2. Run formatting only on changed Rust/TS/TSX/Markdown paths. Run focused Rust squash behavior/API and existing message-rewrite/leased-publication regressions; run affected UI behavior suites, UI build/typecheck and web build. Select actual new test targets from implementation rather than claiming nonexistent targets.
3. Use tester for independent validation/reporting; debugger only for observed failures needing diagnosis, no reruns merely to confirm user-reported errors. Children skip checks while implementation writers active; parent runs once afterward. Preserve exact outputs and exit status.
4. Build two real disposable linear repos (at least 4 commits with multiline bodies), nested root and local bare remote. Record HEAD/tree/index/worktree fingerprints. Set repository-local author/committer identity. Push original branch to bare remote and retain second clone for stale-remote scenario. Configure isolated app project registration; no edits to user's local config. Launch server explicitly on unused loopback port with temporary HOME/config and --no-auth only in local fixture environment. Discover actual CLI/config syntax first. Launch Vite on unused loopback port, route it to fixture server through existing runtime configuration.
5. Chromium Workspace panel: select >=2 commits; check count/eligibility/full oldest-first draft/body; edit final text; observe pushed warning and separate signature consent when appropriate; submit; verify success, cleared old details and reduced history. Assert Git CLI commit count, final HEAD tree, full final message, unaffected descendant metadata and unchanged index/worktree. Also verify narrow/compact layout visually, without claiming native-platform qualification.
6. Chromium Git page: one available project/root → select consecutive older range and squash; verify same semantics. Nonconsecutive visible/filtered selection remains blocked, not silently expanded. Changing root/project/branch/query/page clears selection/dialog and stale async results cannot operate on new scope. Nonactive branch view has no actionable squash. Multi/unavailable project modes stay fail-closed.
7. Real publication journey: after pushed squash choose Publish rewritten branch, inspect prepared destination/expected remote/source OIDs, explicitly confirm; assert bare remote now matches rewritten local HEAD. In separate fixture prepare lease then advance remote from second clone: publish must fail stale without overwriting remote. Verify squash itself never moved remote. Never click unconditional force or auto-publish.
8. Run integrated complete suites and broad pnpm check when prerequisites available. Report pre-existing/toolchain blockers exactly, finish reachable focused verification; never imply a blocked check passed. Capture actual browser screenshots/evidence in plan-specific reports/artifacts and retain concise runtime observations.
9. Call code-reviewer after implementation+validation with exact changed paths and risks; wait terminal result. Fix actionable critical findings and rerun affected checks before completion. Under default cmd-code gate display findings and obtain user approval; if a named checkpoint activates advice, preserve that same lifecycle/run and follow canonical dispatcher/state rules before further mutations. No invented scores, no automatic approval.
10. After successful smoke and appropriate review approval, update focused docs/changelog to actual contract/limits, including linear-only range, dirty-worktree preservation, author/committer policy, full message, CAS/signatures, pushed warning and separate same-root leased publication. Remove throwaway scripts/fixtures/services/tabs we created; retain useful regressions. Ask before committing/pushing development changes; no automatic Git index transitions. Record current-run statuses and final report with exact verification/limitations and usage.

## Todo list
- [x] Integrate additive API and both shared UI surfaces.
- [x] Run Rust/UI checks and independent tester validation.
- [x] Exercise real local squash via both actual Chromium surfaces.
- [x] Exercise real explicit leased publish and stale-remote protection.
- [x] Obtain user approval; terminal code review complete and findings resolved.
- [x] Update feature docs/changelog and ordinary plan statuses after proof.

## Success Criteria
All preflight cases implemented and verified; no ref movement on blocked/error inputs; local squash leaves remote/index/worktree untouched; separate exact-OID lease publishes only to confirmed same-scope destination. Actual screenshots/observed browser flow for both surfaces and CLI oracle results. Reviewer terminal evidence and user approval recorded. Final output does not call component mocks full-stack proof or claim unrun broad/native checks.

## Risk Assessment
Configuration/profile routing can accidentally target real repos: use isolated config and verify project path before first mutation. Concurrency/stale snapshots and root mismatch can overwrite wrong history: fixture tests and exact request/remote OID observation. Signed commits and root-inclusive ranges need raw Git evidence. Resource usage/services must be cleaned up without touching unrelated user processes.

## Security Considerations
Loopback only for no-auth server; no production credentials/environment, no tokens in logs/screenshots, no shared-history rewrite outside fixture. Existing authenticated routes and server root/registered-worktree validation stay authoritative. Do not store messages or signature-consent grants in persistent UI preferences.

## Next steps
cmd-code owns all substantive implementation/finalization. Default mode ordinary plan, no active advisor context; invoke no automatic named checkpoint for routine work. Complete entire feature then report startup instructions (no configuration needed), observed validation and any limits. Open questions: none.
