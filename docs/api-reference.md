# API Reference

Base URL: `http://localhost:4800`

## Authentication

All requests require Bearer token in Authorization header:
```
Authorization: Bearer {token}
```

Token stored at `~/.config/dev-hub/server-token`.

## REST Endpoints

### Projects

**GET /api/projects**
List all projects in workspace.

Response: `{ projects: [ { name, path, type } ] }`

### Terminals

**POST /api/pty/spawn**
Create new PTY session.

Body: `{ project, profile, env_overrides? }`

Response: `{ sessionId: uuid }`

**GET /api/pty/:sessionId**
Stream PTY output (Server-Sent Events).

**POST /api/pty/:sessionId/send**
Send input to running PTY.

Body: `{ input: string }`

### Git Operations

**POST /api/git/:project/clone**
Clone a repository.

Body: `{ url: string, recursive?: bool }`

**POST /api/git/:project/push**
Push commits.

Body: `{ branch?: string, force?: bool }`

**GET /api/git/:project/status**
Repository status.

Response: `{ branch, ahead, behind, modified: [], untracked: [] }`

### IDE File Explorer (Feature-gated: ide_explorer)

**GET /api/fs/list?project=NAME&path=REL**
List directory contents.

Response:
```json
{
  "entries": [
    {
      "name": "file.ts",
      "kind": "file",
      "size": 1024,
      "mtime": 1712577600,
      "isSymlink": false
    }
  ]
}
```

**GET /api/fs/read?project=NAME&path=REL[&offset=N&len=M]**
Read file content (text or binary detection).

- Text: returns body with Content-Type: text/*
- Binary: returns `{ binary: true, mime: "..." }`
- Max 10MB per read

**GET /api/fs/stat?project=NAME&path=REL**
File metadata.

Response:
```json
{
  "kind": "file",
  "size": 1024,
  "mtime": 1712577600,
  "mime": "text/typescript",
  "isBinary": false
}
```

**Error Responses:**
- 400: Invalid path (outside sandbox)
- 404: Project/path not found
- 503: Feature disabled or filesystem unavailable

### Agent Store

**GET /api/agent-store/distribution**
Shows which projects have which skills/commands.

**POST /api/agent-store/import**
Import `.claude/` items from remote repo.

Body: `{ repoUrl: string }`

**POST /api/agent-store/ship**
Create symlinks to distribute items.

Body: `{ items: string[], projects: string[] }`

### Workspace Management

**POST /api/workspace/switch**
Change active workspace.

Body: `{ path: string }`

**GET /api/workspace/config**
Current workspace configuration.

## WebSocket Endpoint

**WebSocket /ws**

Protocol: JSON frames. Client sends commands, server broadcasts PTY events + git progress.

Messages:
- `{ type: "pty:spawn", project, profile, env_overrides? }`
- `{ type: "pty:send", sessionId, input }`
- `{ type: "pty:kill", sessionId }`
- `{ type: "subscribe:pty", sessionId }` — listen to output
- `{ type: "subscribe:git", project }` — listen to git progress
