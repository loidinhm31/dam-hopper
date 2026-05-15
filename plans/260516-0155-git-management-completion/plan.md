---
title: "Git Management Completion"
description: "Complete F-09 with branch checkout/create controls, commit amend support, and history cherry-pick/reset actions."
status: pending
priority: P2
effort: 5d
branch: main
tags: [git, frontend, rust, f-09]
created: 2026-05-16
---

# Git Management Completion

## Summary

Complete backlog item F-09 and adjacent history actions. The repo already has commit creation and branch listing, so implementation focuses on missing branch checkout/create APIs, history mutation actions, commit amend, and shared branch controls in the Git panel and Explorer header.

## Phases

1. [Phase 01: Backend Git Operations](./phase-01-backend-git-operations.md)
   - Status: DONE 2026-05-16 02:20
   - Progress: 100%
   - Adds checkout, branch create, cherry-pick, reset, and amend support.

2. [Phase 02: Frontend Branch And History UI](./phase-02-frontend-branch-and-history-ui.md)
   - Status: pending
   - Progress: 0%
   - Adds shared branch controls, checkout dialogs, create branch, and history context actions.

3. [Phase 03: Verification And Documentation](./phase-03-verification-and-documentation.md)
   - Status: pending
   - Progress: 0%
   - Runs focused tests, builds, and updates relevant docs/changelog if implementation changes public behavior.

## Key Decisions

- Branch controls appear in the Explorer header and Git panel.
- Dirty checkout flow shows options: Normal, Stash then checkout, Force checkout, Cancel.
- Reset flow shows Soft, Mixed, Hard, Keep options using user-requested descriptions.
- No merge, rebase, PR, push enhancement, or stash-management browser is in scope.

## References

- Backlog: `plans/report/2026-04-15-feature-backlog.md`
- Codebase analysis: `reports/codebase-analysis.md`
- Git semantics: `research/git-operation-semantics.md`
- UI workflow: `research/ui-workflow-research.md`
- Scout: `scout/git-files-scout.md`
