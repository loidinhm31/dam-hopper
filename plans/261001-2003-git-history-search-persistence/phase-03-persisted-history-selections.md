# Phase 03 — persisted project/root/history-branch selections

## Context links

- [Plan](./plan.md); [design §§3–4](./design-contract.md); [persistence research](./research/selection-persistence-research.md).
- [Frontend ownership](../../docs/frontend-components.md#unified-shell-and-profile-navigation-phase-02).
- Dependency: frozen design contract; independent of server and transport changes.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: pending. Review: pending.
- Add only missing Git preferences; reuse persisted Workspace project focus and in-memory target selection.

## Key Insights

- `workspace.ts` already persists selected `{profileId, project}`. Git page currently copies it into an in-memory checkbox Set and clears canonical focus on multi/Clear.
- `project-target.ts` is in-memory and owns unavailable worktrees. Do not expand its persistence or restore a stale worktree as configured root.
- Branch API has `name`, `isRemote`, `isCurrent`, `lastCommit`, not canonical ref; derive local/remote fully-qualified refs to disambiguate collisions.
- `workbench-selections.ts` provides `deleted` profile lifecycle subscription precedent; generic `dataChanged` is not profile deletion.

## Requirements

- Create versioned Git preference store with only fields defined in design contract: `gitPageSelection`, `rootByTarget`, `branchByScope`, `selectionRecoveryRequired`.
- `gitPageSelection`: null never initialized; [] explicit all; nonempty selected qualified keys. Preserve unavailable keys rather than accidentally enabling bulk-all.
- Persist branch mode follow-active or pinned canonical ref per profile/project/worktree/root. Every explicit branch selection pins, even when it matches active checkout; only explicit Follow checked-out branch enables tracking. Root selection per qualified target restores corresponding branch.
- Safe synchronous/browser hydration and storage-denied behavior; validate unknown JSON and versions before exposing records.
- Existing Workspace focus remains sole selected-project scalar; compatibility unowned legacy keys remain unused.

## Architecture

`Zustand persist(version 1, dam-hopper:git-history-state) → schema-checked merge → qualified selection actions → shared history controller`.

Use `projectKey`, `parseProjectKey`, `projectTargetKey`, normalized worktree path and JSON tuple root scope. Branch canonical ref helper: local `refs/heads/<name>`, remote `refs/remotes/<name>`. Do not store lastCommit.

Hydration readiness is transient; failed storage completes readiness in memory. Unknown version/invalid data becomes safe defaults, but partial corruption drops invalid entries only. Never use allProjects default empty arrays to prune records.

## Related code files

Create:

- `packages/ui/src/stores/git-history.ts`: typed persisted state/actions, branch/scope helpers if small, hydration readiness, profile deletion subscription.
- `packages/ui/src/stores/git-history.test.ts`: isolated storage/schema/selection behavior.

Read/reuse; intentionally unchanged unless minimal correction necessary and coordinator approves:

- `packages/ui/src/stores/workspace.ts`: canonical selection action/storage.
- `packages/ui/src/stores/project-target.ts`: existing worktree availability/normalization helpers.
- `packages/ui/src/stores/workbench-selections.ts`: profile event pattern only.
- `packages/ui/src/api/ownership.ts`, `server-config.ts`: existing key and profile APIs.
- `packages/ui/src/lib/fresh-state-reset.ts`: new qualified store is not a legacy key; don't add it to deletion allowlist.

## Implementation Steps

1. Read persisted store patterns, ownership helpers, safe-storage precedent, profile notifications and reset classification. Avoid adding a new generic storage utility when existing safe wrapper fits.
2. Implement typed state/actions from design. Require qualified nonempty profile/project keys. Serialize selected keys as sorted/deduplicated array while preserving null versus []; record maps must not accept unowned keys.
3. Store root per `projectTargetKey`; branch per JSON tuple including normalized target/root. Absence means default '.'/follow-active; avoid writes just to persist defaults on every render.
4. Implement branch canonical-ref construction and resolution helper using Branch.name + isRemote; ensure local `origin/main` differs from remote `origin/main`. Do not assume name prefix alone identifies remote.
5. Add `persist` name/version/partialize and checked merge. Validate record shapes/discriminants/canonical prefixes and qualified tuple structure. Drop malformed root/branch entries individually. For corrupt/unknown-version present selection or invalid selected keys, set persisted `selectionRecoveryRequired=true`: bulk operations and null first-use seeding blocked until explicit valid selection/Clear resets it, never convert corruption to all even after another preference write/reload. No nonexistent legacy Git migration.
6. Expose hydration readiness via store or Zustand persist lifecycle subscription; no initialization write until ready. Storage parse/access/write errors leave usable in-memory state and settle readiness rather than permanent spinner.
7. Subscribe to actual profile `deleted` notification once using existing module convention. Clear that profile's root/branch maps; retain selected project keys as unavailable tombstones. Never turn last selected removed project into []/all. Profile endpoint data edits keep logical intent pending fresh discovery; do not clear on every dataChanged event.
8. Create deterministic tests with isolated memory Storage and reset singleton state between cases: hydrate selected projects, explicit [], root/branch scopes, pinned/follow-active intent, local/remote collision, malformed records individually dropped, corrupt/unknown-version selection requires explicit recovery, unavailable storage, deletion isolation. Tests verify restored behavioral state and subsequent updates, not storage key text/serialization copies.
9. Controller integration, missing-branch reconciliation, and Git-page changes are Phase 04/06 ownership; do not edit those files here.
10. Report action names, typed store surface, hydration contract and test cases; no worker checks mid-flight.

## Todo list

- [ ] Create only missing Git selection state with qualified keys.
- [ ] Implement validated hydration and denied-storage in-memory fallback.
- [ ] Disambiguate branch identity and preserve follow-active intent.
- [ ] Handle profile deletion without broadening bulk selection.
- [ ] Add isolated persistence/identity behavior regressions.

## Success Criteria

- Store instance hydration restores project checkbox set, selected root and branch intent in correct scope.
- Two profiles with same project/worktree names never share preference entries.
- Explicit all remains explicit all; unavailable nonempty selection never becomes all.
- Pinned branch identity differs from active tracking; new branch tips resolve later, not frozen SHAs.
- Malformed storage / unavailable localStorage does not crash or create an unowned request.
- Existing Workspace focus and worktree behavior intentionally unchanged by this slice.

## Risk Assessment

- Hydration overwrites: readiness gate and no default initialization writes before merge.
- Mount effects create loops: stable selectors/equality no-op updates; absence-as-default.
- Recreated root/worktree at same path: restore only as read-only intent after current discovery; mutation safety still current-state validated.
- Persistent stale project cannot be resolved: retain unavailable state until explicit user action, not random project fallback.

## Security Considerations

Browser preferences contain identity and branch intent only; no credentials/commit contents/generation. Validate untrusted storage. Persist only explicitly qualified keys; profile deletion touches only its own preferences.

## Next steps

Phase 04 consumes frozen store; Phase 06 consumes selected checkbox set. Unresolved questions: none; endpoint edit follows existing logical-profile identity and revalidation rules.
