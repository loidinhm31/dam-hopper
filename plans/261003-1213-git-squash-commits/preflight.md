# Git squash preflight

## Output
Squash selected consecutive commits from Workspace Git panel and standalone Git page, including already-pushed commits. Complete backend, typed API/client, shared UI, safe separate publication, docs and actual validation.

## Acceptance criteria
- Select at least two commits and squash a contiguous oldest-to-newest chain on the active checked-out branch. Both graph/list presentations retain normal details selection and accessible checkbox selection. Selection is transient and clears with target/profile/worktree/root/branch/generation/filter/page changes.
- Selected merge commits and any merge among descendants that must be rewritten are blocked with explanation. User explicitly selected linear-history-only boundary.
- Default editor draft concatenates full UTF-8 commit messages oldest-first with a blank line between messages; never compose from subject-only log rows. Final message is nonempty, preserves user body, and ends with LF. Reuse existing full-message reads: all responses must match branch/head, freeze request scope and ordered hashes, mutation revalidates the snapshot. No extra prepare endpoint required.
- Support a range ending at HEAD, an older range with linear descendants, and a root-inclusive range. Synthesized commit uses newest selected tree, oldest selected predecessor (or no parent), oldest selected author, current repository committer; descendants preserve trees, metadata and messages while remapping parent OIDs. Final branch-tip tree must equal original.
- ODB rewrite leaves index and working tree unchanged, including dirty state. Move only active local branch with existing locked HEAD/branch compare-and-swap; no reset/rebase subprocess and no remote changes.
- Pushed commits remain eligible. Warn that selected commits and descendants get new IDs and collaborators may be affected; removal of invalidated signatures needs explicit existing consent mechanism covering every affected object.
- Reject malformed/duplicate/single/noncontiguous/unreachable OIDs, stale branch/head, detached/unborn HEAD, active operations, linked-worktree ownership conflicts and existing unsafe-history conditions without moving refs. Preserve existing typed error/recovery/uncertainty semantics.
- Successful squash clears obsolete selection/details and invalidates target/root history, branches/status/diffs/editor consumers. Offer safe Publish rewritten branch using existing prepare/preview/confirm flow bound to the exact history target/root; never use independent Git-page bulk root. No auto-push or unconditional force.
- Exact-OID lease prevents overwrite when remote/local/upstream changes; report unknown publication honestly and do not retry blindly.

## Scope boundary
In: Rust Git rewrite and authenticated root-aware REST endpoint, client REST mapping/query hook, shared selection/action/dialog, both host surfaces, real behavioral regressions and smoke, docs/changelog. Out: cross-project/bulk squash, arbitrary nonconsecutive selection, selected/rewritten-descendant merges, remote branch rewriting, force push bypass, persistent squash state, automatic commits/pushes, assets or new dependencies. No user configuration required.

## Risk/public contract areas
Commit/ref integrity and root/owner routing; public camelCase DTOs; worktree/branch concurrency; signature invalidation; stale async UI scope; full-message/metadata fidelity; remote publication. Existing auth applies, no new permissions, DB migration or configuration. ODB writes may leave unreachable objects on failed CAS; existing publication-uncertain handling is authoritative, never fake rollback.

## Affected files/systems
Backend: server/src/git/{commit_message_rewrite.rs,types.rs,mod.rs,tests.rs}, focused new squash module if needed, server/src/api/git.rs and route registration discovered by executor, server/tests Git API and leased publication tests.
Frontend: packages/ui/src/api/{client.ts,queries.ts,ws-transport.ts}, hooks/use-git-history-view.ts, hooks/use-leased-git-push.ts if actually needed, components/organisms/{GitLogTree.tsx,GitHistoryActions.tsx,WorkspaceGitPanel.tsx}, components/pages/GitPage.tsx, existing related tests/browser harness. Prefer focused squash dialog/module rather than growing unrelated files; reuse existing patterns.
Docs: docs/api-reference.md, docs/architecture/git-history-search.md, docs/frontend-components/terminal-and-ide.md, docs/CHANGELOG.md; system architecture only relevant focused section if needed. Do not alter prior sealed plan/report snapshots.

## Testing strategy
Run focused Rust unit and in-process Axum integration tests against real temporary repos; validate trees, topology, metadata, raw full messages, index/worktree and no-ref-change errors with Git CLI oracles. Use real bare remote for pushed squash plus leased publication and stale-remote protection. UI behavior tests for invalid selection, draft/body retention, pending/consent/scope-reset/stale completion/publication root; no source-text or mock-forwarding tests. UI typecheck/build and focused existing regressions. Actual isolated server/web Chromium journey on both surfaces, disposable repos only; observe resulting local and remote OIDs/trees. Record visual/runtime limits rather than imply mocks are E2E.

## Side-effect checklist
- Auth/session/permissions: existing authenticated REST and qualified client owner; no widening.
- API compatibility: additive DTO/route/client method, unchanged edit/drop/normal push contracts, REST mapper includes mutation.
- Data: no DB changes; only checked-out branch ref changes after CAS, other refs unchanged.
- Business meaning: linear squash semantics, explicit current branch, pushed warning, separate publication.
- Security/privacy: no shell-interpolated commit text/OIDs, no secret logging, consent for invalidated signatures.
- Performance/concurrency: bounded selection to current loaded page, no avoidable copies; reuse raw objects and locked publication; fence UI by scope/generation.
- Docs/config/onboarding/deploy: update current docs/changelog after verified feature; no new setup/dependencies/assets; no commit or push of this development work without user approval.

## Decisions and lifecycle
WORK_ARGUMENTS: add feature for squash commit in Git panel and Git page. Default advice mode; no applicable active advisor context supplied, no named checkpoint invoked. Stay stateless unless required stuck escalation. New ordinary default plan, no historical captured files modified. Root cmd-cook owns discovery/plan only; cmd-code owns source edits, tests/smoke, review approval, docs/status and completion. All phases are authorized by feature request; continue dependency order, do not stop after backend phase. User review approval belongs inside cmd-code before substantive finalization. No automatic repository commit/push.

## Evidence
- ../reports/scout-261003-1213-squash-backend.md
- ../reports/scout-261003-1213-squash-frontend.md
- User decisions: include pushed commits; linear history only.

## Open questions
None. Executor resolves internal helper/module details against code without broadening scope.
