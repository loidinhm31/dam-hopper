# Phase 1: Backend Project Discovery API

**Status:** ✅ COMPLETED  
**Priority:** High

## Context Links
- [Main Plan](plan.md)
- [discovery.rs](../../server/src/config/discovery.rs) - Existing project detection logic
- [workspace.rs](../../server/src/api/workspace.rs) - Workspace endpoints

## Overview

Add a new endpoint to discover projects in a given directory on the server filesystem.

## Requirements

1. New endpoint `GET /api/workspace/discover` that:
   - Accepts `path` query parameter (directory to scan)
   - Returns list of discovered projects with type/name/path
   - Handles permission errors gracefully

2. Modify `POST /api/workspace/init` to:
   - Accept optional `projects` array
   - Create `dam-hopper.yaml` config file
   - Initialize workspace with discovered projects

## Implementation Steps

### Step 1: Add discover endpoint to workspace.rs

```rust
// GET /api/workspace/discover?path=/home/user/projects
#[derive(Deserialize)]
pub struct DiscoverQuery {
    pub path: String,
}

#[derive(Serialize)]
pub struct DiscoverResponse {
    pub projects: Vec<DiscoveredProject>,
    pub path: String,
}

pub async fn discover_projects_endpoint(
    Query(q): Query<DiscoverQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let path = std::path::PathBuf::from(&q.path);
    let projects = discover_projects(&path);
    Ok(Json(DiscoverResponse {
        projects,
        path: q.path,
    }))
}
```

### Step 2: Register route in router.rs

```rust
.route("/api/workspace/discover", get(workspace::discover_projects_endpoint))
```

### Step 3: Add transport mapping in ws-transport.ts

```typescript
case "workspace:discover":
  return { method: "GET", url: `/api/workspace/discover?path=${encodeURIComponent(data)}` };
```

### Step 4: Add client API method

```typescript
discover: (path: string) => 
  getTransport().invoke<{ projects: DiscoveredProject[]; path: string }>("workspace:discover", path),
```

### Step 5: Add TypeScript types

```typescript
export interface DiscoveredProject {
  name: string;
  path: string;
  projectType: ProjectType;
  isGitRepo: boolean;
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `server/src/api/workspace.rs` | Add `discover_projects_endpoint` handler |
| `server/src/api/router.rs` | Register `/api/workspace/discover` route |
| `server/src/config/discovery.rs` | Make `DiscoveredProject` serializable |
| `packages/web/src/api/ws-transport.ts` | Add mapping |
| `packages/web/src/api/client.ts` | Add `api.workspace.discover()` |

## Todo

- [ ] Add Serialize derive to DiscoveredProject
- [ ] Create discover endpoint handler
- [ ] Register route
- [ ] Add WS transport mapping
- [ ] Add client API method  
- [ ] Add query hook `useDiscoverProjects(path)`

## Success Criteria

- [ ] `GET /api/workspace/discover?path=/path` returns project list
- [ ] Empty array returned for paths with no projects
- [ ] Error handling for invalid/inaccessible paths
