# Phase 2: Frontend Workspace Setup Wizard

**Status:** ✅ COMPLETED  
**Priority:** High

## Context Links
- [Main Plan](plan.md)
- [Phase 1](phase-01-discovery-api.md)
- [App.tsx](../../packages/web/src/App.tsx) - Entry point
- [ServerSettingsDialog.tsx](../../packages/web/src/components/organisms/ServerSettingsDialog.tsx) - Reference for dialog styling

## Overview

Create a multi-step workspace setup wizard that guides users through:
1. Selecting a workspace root directory
2. Reviewing discovered projects
3. Configuring workspace name
4. Initializing the workspace

## Requirements

1. **WorkspaceGuard** - HOC that checks workspace readiness
2. **WorkspaceSetupWizard** - Multi-step wizard dialog
3. **DirectoryBrowser** - Remote filesystem browser
4. **ProjectSelector** - Discovered project selection

## UI/UX Design

### Wizard Steps

```
┌─────────────────────────────────────────────────────────────┐
│        🏗️ Set Up Your Workspace                            │
│                                                             │
│  ○─────○─────○─────●                                        │
│  Path  Projects  Name  Done                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: Select Workspace Directory                         │
│  ─────────────────────────────────────                      │
│                                                             │
│  📁 /home/user/                                             │
│  ├── 📁 projects          ← Click to expand                │
│  │   ├── 📦 my-app        (npm)                            │
│  │   ├── 📦 api-server    (cargo)                          │
│  │   └── 📁 experiments                                    │
│  ├── 📁 work                                               │
│  └── 📁 documents                                          │
│                                                             │
│  Selected: /home/user/projects                              │
│                                                             │
│  [× Cancel]                                   [Next →]     │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Create WorkspaceGuard component

```tsx
// packages/web/src/components/guards/WorkspaceGuard.tsx
export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const { data: status, isLoading, isError } = useWorkspaceStatus();
  const [setupComplete, setSetupComplete] = useState(false);
  
  if (isLoading) return <LoadingScreen />;
  if (isError) return <ErrorScreen />;
  
  if (!status?.ready && !setupComplete) {
    return <WorkspaceSetupWizard onComplete={() => setSetupComplete(true)} />;
  }
  
  return <>{children}</>;
}
```

### Step 2: Create WorkspaceSetupWizard

```tsx
// packages/web/src/components/organisms/WorkspaceSetupWizard.tsx
interface Props {
  onComplete: () => void;
}

type Step = "path" | "projects" | "name" | "done";

export function WorkspaceSetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("path");
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  
  // ... step rendering logic
}
```

### Step 3: Create DirectoryBrowser

```tsx
// packages/web/src/components/organisms/DirectoryBrowser.tsx
interface Props {
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function DirectoryBrowser({ onSelect, initialPath }: Props) {
  // Uses fs:list API to browse directories
  // Shows folder icons
  // Highlights detected projects
}
```

### Step 4: Create ProjectSelector

```tsx
// packages/web/src/components/molecules/ProjectSelector.tsx
interface Props {
  projects: DiscoveredProject[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function ProjectSelector({ projects, selected, onChange }: Props) {
  // Checkbox list with project type icons
  // Select all / deselect all buttons
}
```

## Files to Create

| File | Description |
|------|-------------|
| `components/guards/WorkspaceGuard.tsx` | Workspace readiness check |
| `components/organisms/WorkspaceSetupWizard.tsx` | Main wizard |
| `components/organisms/DirectoryBrowser.tsx` | Remote FS browser |
| `components/molecules/ProjectSelector.tsx` | Project selection |

## Files to Modify

| File | Changes |
|------|---------|
| `App.tsx` | Wrap routes with WorkspaceGuard |
| `api/queries.ts` | Add `useDiscoverProjects` hook |

## Todo

- [ ] Create WorkspaceGuard component
- [ ] Create WorkspaceSetupWizard component
- [ ] Create DirectoryBrowser component
- [ ] Create ProjectSelector component
- [ ] Add useDiscoverProjects hook
- [ ] Style components with existing design system
- [ ] Handle loading/error states

## Success Criteria

- [ ] Wizard appears when workspace not ready
- [ ] User can browse remote directories
- [ ] Projects are discovered and displayed
- [ ] User can select/deselect projects
- [ ] Workspace initializes successfully
- [ ] Wizard closes and app loads normally
