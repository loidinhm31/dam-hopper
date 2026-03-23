# Research: Web UI Components for Commands

## ConfigEditor.tsx (`packages/web/src/components/organisms/ConfigEditor.tsx`)

### CommandsForm (lines 91-156)

- Manages custom commands as key-value pairs (Record<string, string>)
- Add: generates unique `cmd1`, `cmd2` keys with empty values
- Edit: inline rename keys, update values
- Remove: × button per entry
- Currently ONLY used in ConfigEditor → Settings page

### ServiceForm (lines 33-87)

- Manages buildCommand/runCommand per service
- 3-column grid: name, buildCommand, runCommand
- Both commands optional strings

### ProjectForm (lines 160-323)

- Wraps ServiceForm + CommandsForm
- Custom commands section at bottom (lines 303-318)
- `project.commands ?? {}` passed to CommandsForm

## BuildLog.tsx (`packages/web/src/components/organisms/BuildLog.tsx`)

- Listens to SSE `build:progress` events via useEffect + EventSource
- Line buffer (max 5000 lines) with timestamps
- Auto-scroll + copy/clear toolbar
- Filters by project name
- **Reusable pattern for command output**

## SettingsPage.tsx

- Uses `useConfig()` + `useUpdateConfig()` hooks
- Renders ConfigEditor with full DevHubConfig
- Save → `PUT /api/config`

## API Client Gaps

- No `api.exec` method exists
- No `useExecCommand` hook exists
- BuildResult type already defined in client.ts (reusable for exec results)

## Current ProjectDetailPage

- Build tab: single "Build" button → `build.mutate(name)` → no command display
- Run tab: Start/Stop/Restart buttons → no command display
- No "Commands" tab exists
- No way to see what command will execute

## Design Implications

- CommandsForm can be extracted/imported for reuse in ProjectDetailPage
- BuildLog SSE pattern adaptable for `command:progress` events
- `PATCH /config/projects/:name` exists for per-project updates (already wired)
