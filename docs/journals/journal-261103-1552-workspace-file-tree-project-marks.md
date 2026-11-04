# OS workspace file tree and marked projects — approved design

- **Mode:** decision-summary
- **Problem & outcome:** Files currently requires configured projects, preventing whole-workspace browsing. Outcome: approved workspace-first Files, explicit folder "Mark as Project", dual Workspace/Projects navigation modes, and Git operations restricted to marked projects.
- **Key decisions & trade-offs:** Workspace mode defaults to the full authorized browse root; Projects mode filters to all marked roots or a single project. Reuses existing project metadata without automatic registration, discovery, or git init. Shared file identity across navigation routes prevents duplicate dirty editor buffers. Deliberate Git registration and authoritative server/client contracts chosen over a UI-only filter or arbitrary-repository Git. Amends original OS no-new-API constraint; OS-only scope with zero Android changes (document affected contracts for later redesign).
- **Design status:** **Approved** (explicitly in conversation). Referenced report: [plans/reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md](../../plans/reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md).
- **Planning consent & result:** User explicitly selected "Defer planning". Router not invoked; no implementation plan created (`none`).
- **Evidence limits:** Grounded in read-only source inspection; no product files changed, no implementation performed, and no runtime, test, or visual qualification claimed.
- **Next step:** User can later request central planning from the approved report.
