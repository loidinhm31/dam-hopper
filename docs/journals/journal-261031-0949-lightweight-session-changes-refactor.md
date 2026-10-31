# Lightweight session changes refactor — approved design & plan

- **Mode:** decision-summary
- **Problem & outcome:** PR #81 (`plans/261030-1215-session-changes-panel/plan.md`) ran eager whole-repo traversal, baseline RAM scans, and 100k-node `AbsenceTrie`, creating unnecessary server load for persistent PTYs. Approved Option 3: pure tool-event tracking refactor on branch `feat/session-changes-omp`.
- **Key decisions:** Default-OFF setting (`server.session_changes_enabled = false`) on `SettingsPage` (`targetOwner`). Physical extension lifecycle: toggling ON writes dedicated `extensions/dam-hopper-session-changes.ts`; toggling OFF deletes file, fences requests, and purges RAM. Per-file pre-edit snapshots (`<= 1.5s` fail-open) for `write`, Hashline `edit`, concrete-path `ast_edit`; zero background diffs; lazy diff calculation on UI view.
- **Trade-offs:** Enabling requires restarting active OMP sessions to load extension; arbitrary `bash`/`eval` mutations omitted from session changes, remaining in `GitLocalChanges`.
- **Design status:** **Approved** by user. See the [approved design report](../../plans/reports/design-261031-0949-lightweight-session-changes-refactor.md).
- **Planning consent & router result:** User consented ("Yes, create implementation plan") and accepted validated plan; plan reviewed (0 blockers / 0 high / 0 medium). Plan path: [plan.md](../../plans/261031-0949-lightweight-session-changes-refactor/plan.md).
- **Next step:** Execute `/evc-cmd-code /home/loidinh/WS/dam-hopper/plans/261031-0949-lightweight-session-changes-refactor/plan.md` when ready to implement.
