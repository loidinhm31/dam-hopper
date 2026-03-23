# Phase 03: Integration Testing

## Context Links
- [Plan](./plan.md)
- [Phase 01](./phase-01-electron-main-changes.md)
- [Phase 02](./phase-02-welcome-page-ui.md)

## Overview

- **Date**: 2026-03-23
- **Description**: Validate welcome page flow end-to-end with manual test scenarios.
- **Priority**: P2
- **Implementation status**: done
- **Review status**: done
- **Completed**: 2026-03-23

## Key Insights

- No Electron E2E test framework currently in project
- Core package has Vitest tests; web/electron have none
- Manual testing is pragmatic; document scenarios for future automation

## Requirements

1. Document manual test scenarios covering all welcome page flows
2. Verify backward compatibility: existing users with persisted workspace skip welcome
3. Verify error handling for invalid paths, missing config, canceled picker
4. Verify workspace:changed event triggers proper transition

## Architecture

Test matrix:

| Scenario                              | Expected Behavior                        |
| ------------------------------------- | ---------------------------------------- |
| Fresh install, no electron-store      | Welcome page shown                       |
| Fresh install, pick folder via dialog | Loads workspace, shows dashboard         |
| Fresh install, click recent workspace | Loads workspace, shows dashboard         |
| Fresh install, cancel folder picker   | Stays on welcome page                    |
| Existing user with persisted path     | Skips welcome, shows dashboard           |
| Persisted path invalid/deleted        | Welcome page shown (auto-resolve fails)  |
| Select folder without dev-hub.toml    | Auto-discovers projects, creates config  |
| Select invalid/empty folder           | Error message shown on welcome page      |

## Related Code Files

- `packages/electron/src/main/index.ts` -- startup flow
- `packages/web/src/App.tsx` -- workspace gate
- `packages/web/src/pages/WelcomePage.tsx` -- welcome UI

## Implementation Steps

### Step 1: Test fresh install flow
- Clear electron-store
- Launch app -> verify welcome page appears
- Click "Open Workspace" -> verify OS folder picker opens
- Select valid workspace folder -> verify dashboard loads
- Verify workspace persisted for next launch

### Step 2: Test recent workspaces flow
- Ensure global config has known workspaces
- Launch fresh (clear electron-store) -> verify recent list populates
- Click a recent workspace -> verify it loads

### Step 3: Test error scenarios
- Select folder with no projects and no dev-hub.toml -> verify auto-init
- Cancel folder picker -> verify stays on welcome page
- Test with non-existent persisted path -> verify welcome page shown

### Step 4: Test backward compatibility
- Launch with valid persisted workspace -> verify welcome page never flashes
- Verify existing workspace switching from sidebar still works

## Todo List

- [ ] Clear electron-store and test fresh launch
- [ ] Test folder picker -> workspace load -> dashboard transition
- [ ] Test recent workspaces click -> load
- [ ] Test cancel folder picker
- [ ] Test invalid folder selection
- [ ] Test auto-init for folder without dev-hub.toml
- [ ] Test existing user with persisted workspace (no welcome page)
- [ ] Test workspace switch from sidebar after initial load
- [ ] Verify no regressions in existing workspace IPC handlers

## Success Criteria

- All manual test scenarios pass
- No regressions in existing workspace management features
- Welcome page -> dashboard transition is smooth
- Error states are clear and recoverable

## Risk Assessment

- **No automated tests**: Manual-only risks regressions. Document scenarios for future automation.
- **Platform differences**: electron-store path varies by OS. Test on target platform.

## Security Considerations

- No additional security surface in testing phase
- Ensure no debug flags or dev-only bypasses left in production code

## Next Steps

- Consider adding Playwright Electron E2E tests in future
- Consider "Create New Workspace" wizard as follow-up feature
