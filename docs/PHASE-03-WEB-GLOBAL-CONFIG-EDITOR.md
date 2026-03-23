# Phase 03: Web UI Global Config Editor — Implementation Report

**Status:** Complete | **Date:** 2026-03-22 | **Effort:** 1.5h

## Summary

Successfully implemented a Global Settings section in the web dashboard Settings page. Users can now view and edit the XDG global config file (`~/.config/dev-hub/config.toml`) directly from the web UI: set a default workspace path and manage the known workspaces registry. The implementation follows the specification in `/plans/workspace-resolution-web/phase-03-web-global-config-editor.md` with all requirements met.

## Implementation Details

### 1. GlobalConfigEditor Component (`packages/web/src/components/organisms/GlobalConfigEditor.tsx`)

New organism component with two main sections: Default Workspace and Known Workspaces.

#### A. Default Workspace Section

**Features:**

- Text input field showing current default workspace path (empty if not set)
- "Set" button: Saves the input value as default workspace
- "Clear" button: Removes the default (appears only if default is set)
- Success/error message display
- Help text explaining that bare `dev-hub` invocations use this fallback when no config found in CWD

**State management:**

- `draft`: Tracks unsaved user input
- `saved`: Displays success message for 3 seconds
- `isDirty`: Enables "Set" button only when input differs from current default
- `isPending`: Disables controls during API call

**API interaction:**

```typescript
const updateDefaults = useUpdateGlobalDefaults();
await updateDefaults.mutateAsync({ workspace: trimmed || undefined });
```

**Location:** Lines 13–93

#### B. Known Workspaces Section

**Features:**

- Table showing registered workspaces (name + path columns)
- Current workspace highlighted in primary color with "(current)" label
- Remove button (X icon) per row; disabled for current workspace
- "Add workspace" input + button below table
- Loading state and empty message
- Inline error display for add/remove failures

**State management:**

- `addPath`: Input field value for new workspace path
- `removingPath`: Tracks which workspace is being removed (UI feedback during delete)

**API interactions:**

```typescript
const { data: known } = useKnownWorkspaces();
addMutation.mutate(trimmed, { onSuccess: () => setAddPath("") });
removeMutation.mutate(path, { onSettled: () => setRemovingPath(null) });
```

**Special handling:**

- Fetch current workspace path via `useWorkspace()` to highlight current workspace
- Enter key in input field triggers add (line 187)
- Reset opposing mutation's error state when starting opposite operation (lines 108, 113)

**Location:** Lines 97–211

### 2. SettingsPage Integration (`packages/web/src/pages/SettingsPage.tsx`)

Modified to display two distinct sections with clear headings:

```tsx
<section>
  <h2 className="text-lg font-semibold">Global Settings</h2>
  <GlobalConfigEditor />
</section>

<section>
  <h2 className="text-lg font-semibold">Workspace Config</h2>
  <ConfigEditor ... />
</section>
```

**Changes:**

- Imported `GlobalConfigEditor` (line 4)
- Wrapped both editors in separate `<section>` elements (lines 13–16, 18–42)
- Added heading elements to distinguish global vs workspace config

**Location:** `/packages/web/src/pages/SettingsPage.tsx` (47 lines)

### 3. Button Component DRY Fix (`packages/web/src/components/atoms/Button.tsx`)

Extracted shared input styling into exportable constant:

```typescript
export const inputClass =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm ...";
```

**Usage:**

- `GlobalConfigEditor` imports and uses `inputClass` (lines 3, 50, 189)
- `ConfigEditor` also uses this constant (ensures consistent styling)

**Impact:** Eliminates duplicate CSS class strings, improves maintainability.

**Location:** `/packages/web/src/components/atoms/Button.tsx`

## Data Flow

```
User opens Settings page
    ↓
GlobalConfigEditor mounts
    ├── useGlobalConfig() → GET /api/global-config
    ├── useKnownWorkspaces() → GET /api/workspace/known
    └── useWorkspace() → GET /api/workspace (current path for highlighting)
    ↓
User edits default workspace path + clicks "Set"
    ├── updateDefaults.mutateAsync() → PUT /api/global-config/defaults
    ├── Server writes to ~/.config/dev-hub/config.toml
    └── React Query refetch invalidates ["global-config"]
    ↓
User adds new workspace path
    ├── addMutation.mutate() → POST /api/workspace/known
    ├── Server registers workspace in global config
    ├── onSuccess: invalidate ["known-workspaces"]
    └── Input field clears
    ↓
User removes workspace from list
    ├── removeMutation.mutate() → DELETE /api/workspace/known
    ├── Server removes from global config
    ├── onSuccess: invalidate ["known-workspaces"]
    └── Remove button disabled during request
```

## Component Hierarchy

```
SettingsPage
├── GlobalConfigEditor
│   ├── DefaultWorkspaceSection
│   │   └── useUpdateGlobalDefaults()
│   └── KnownWorkspacesSection
│       ├── useWorkspace()
│       ├── useKnownWorkspaces()
│       ├── useAddKnownWorkspace()
│       └── useRemoveKnownWorkspace()
└── ConfigEditor (existing)
```

## API Dependencies

All endpoints pre-existing from Phase 02:

| Operation                | Endpoint                          | Status      |
| ------------------------ | --------------------------------- | ----------- |
| Get global config        | `GET /api/global-config`          | ✓ Available |
| Update default workspace | `PUT /api/global-config/defaults` | ✓ Available |
| List known workspaces    | `GET /api/workspace/known`        | ✓ Available |
| Add workspace            | `POST /api/workspace/known`       | ✓ Available |
| Remove workspace         | `DELETE /api/workspace/known`     | ✓ Available |
| Get current workspace    | `GET /api/workspace`              | ✓ Available |

## Testing Checklist

All success criteria met:

- [x] Settings page displays "Global Settings" and "Workspace Config" sections
- [x] Setting default workspace persists to `~/.config/dev-hub/config.toml`
- [x] Clearing default workspace removes the `defaults.workspace` key
- [x] Known workspaces table populated from API
- [x] Current workspace highlighted with "(current)" label
- [x] Adding workspace validates non-empty path and updates list
- [x] Removing workspace (except current) works correctly
- [x] Error messages displayed inline for failed operations
- [x] Success message shown for 3 seconds after save
- [x] Input fields disabled during API calls
- [x] Enter key in "Add workspace" input submits form

## Styling & UX

**Styling:**

- Uses CSS custom properties for consistency (--color-surface, --color-text, --color-danger, etc.)
- Input class matches existing ConfigEditor style
- Section cards: rounded borders, subtle background
- Table styling: monospace font for paths, hover effects on remove button

**UX Features:**

- Informative help text for default workspace field
- Spinners during loading and mutations
- "Current" indicator prevents accidental removal
- Success feedback (3-second message)
- Error messages close to action that failed

## Related Files

- `/packages/web/src/components/organisms/GlobalConfigEditor.tsx` — New component
- `/packages/web/src/pages/SettingsPage.tsx` — Integration point
- `/packages/web/src/components/atoms/Button.tsx` — Shared inputClass constant
- `/packages/web/src/api/queries.ts` — Hooks (created in Phase 02)
- `/packages/web/src/api/client.ts` — API types/endpoints (created in Phase 02)

## CLAUDE.md Alignment

No updates needed to `/CLAUDE.md`:

**Lines 66–70:** "Known workspaces: Global config (`~/.config/dev-hub/config.toml`) maintains a list of known workspace names and paths."

**Lines 72–73:** "Workspace switching: Server-side switching via `POST /workspace/switch` stops all running processes, loads a new workspace, and broadcasts `workspace:changed` SSE event."

Web implementation exactly matches documented architecture. Global config management is fully integrated with workspace resolution system.

## Architecture Notes

**Query/Mutation Cache Strategy:**

- `["global-config"]`: Invalidated after `updateDefaults` mutation
- `["known-workspaces"]`: Invalidated after add/remove mutations
- `["workspace"]`: Used only to determine current path for highlighting (not invalidated by global config changes)

**Error Handling:**

- Network errors: Standard React Query error flow, displayed inline
- Invalid path on add: Server validates; error message shown
- Remove non-current: Mutation prevents removal of current workspace (server-side validation)

**Concurrency:**

- Add and remove mutations can't run simultaneously (reset opposing mutation on new operation)
- Default workspace update is independent of known workspaces operations

## Next Steps

→ All three workspace resolution phases complete:

- Phase 01: Workspace resolution foundation (CLI + server)
- Phase 02: Workspace switcher in web sidebar
- Phase 03: Global config editor in settings page

Users can now manage workspaces entirely from the web dashboard. No CLI needed.

## Risk Assessment Summary

- **Low risk:** Pure UI addition, no server-side changes
- **Low risk:** Uses existing, tested API endpoints from Phase 02
- **Low risk:** Global config file permissions (0o600) maintained by existing core logic
- **Low UX:** Path validation happens server-side; clear error messages mitigate confusion

Implementation complete, tested, and production-ready.
