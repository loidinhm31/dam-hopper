---
parent: plan.md
phase: "01"
status: done
priority: P1
effort: 0.5h
depends_on: []
---

# Phase 01: API Client + Hooks

## Context

- Parent: [plan.md](./plan.md)
- Depends on: None
- Research: [exec-flow](./research/researcher-01-exec-flow.md)

## Parallelization Info

- **Group**: Foundation (must run first)
- **Blocks**: Phase 02, Phase 03
- **Can run with**: Nothing (first phase)

## Overview

Add exec command API method and React Query hooks to the web client. This is the
foundation that Phase 02 and 03 consume.

**Status:** done | **Review:** approved | **Date:** 2026-03-22

## Key Insights

- Server `POST /api/exec/:project` already works — takes `{ command: string }` (command name, not shell string)
- Returns `BuildResult` type (already defined in client.ts)
- SSE event type `command:progress` already streamed by server
- `useUpdateProject` hook already exists for `PATCH /config/projects/:name`

## Requirements

### 1. Add `api.exec` to client.ts

```typescript
exec: {
  run: (project: string, command: string) =>
    post<BuildResult>(`/exec/${enc(project)}`, { command }),
},
```

### 2. Add `useExecCommand` hook to queries.ts

```typescript
export function useExecCommand() {
  return useMutation({
    mutationFn: ({ project, command }: { project: string; command: string }) =>
      api.exec.run(project, command),
  });
}
```

No cache invalidation needed — exec is read-only (doesn't change project state).

## File Ownership

| File                              | Action                               |
| --------------------------------- | ------------------------------------ |
| `packages/web/src/api/client.ts`  | Add `exec` namespace to `api` object |
| `packages/web/src/api/queries.ts` | Add `useExecCommand` hook            |

## Implementation Steps

1. Add `exec.run` method to `api` object in `client.ts` (2 lines)
2. Add `useExecCommand` mutation hook in `queries.ts` (6 lines)
3. Verify types — `BuildResult` already exists in client.ts

## Todo

- [ ] Add `api.exec.run()` method
- [ ] Add `useExecCommand()` hook
- [ ] Verify TypeScript compilation

## Success Criteria

- `api.exec.run("project-name", "test")` calls `POST /api/exec/project-name` with `{ command: "test" }`
- `useExecCommand` returns mutation with `data: BuildResult`
- No type errors

## Conflict Prevention

- Only touches `client.ts` and `queries.ts` — no overlap with Phase 02/03 files

## Risk Assessment

- **Low**: Adding methods to existing files, no breaking changes
- Types already aligned between server and client

## Security Considerations

- Commands are resolved server-side from config — no shell injection risk from client
- Client sends command **name** (key), not shell string
