---
phase: "02"
title: "SSH Passphrase Input from UI for Git Operations"
status: pending
effort: 4.5h
---

# Phase 02: SSH Passphrase Input from UI

> Parent: [plan.md](./plan.md)

## Overview

- **Date**: 2026-03-24
- **Priority**: P2
- **Implementation status**: Pending
- **Review status**: Pending

When git operations fail due to SSH auth (encrypted key not in agent), users see a generic error with no way to resolve it from the app. This phase adds: passphrase dialog → `ssh-add` via IPC → retry failed operation.

## Key Insights

- `GitError` with `category: "auth"` already exists in `errors.ts` — detects "permission denied", "authentication failed"
- Git ops return `GitOperationResult` with `success: false, error: GitError` — category field enables auth detection
- IPC pattern well-established: channel in `ipc-channels.ts` → handler in `main/ipc/` → bridge in `preload/index.ts`
- `ssh-add` reads from `/dev/tty` by default; programmatic use needs `SSH_ASKPASS` env var approach
- `guard()` function in `git.ts` prevents concurrent git ops — pairs well with retry-after-auth
- No SSH-related code exists in codebase yet

## Architecture

```
Renderer (React)                    Main Process (Electron)

GitPage / ProjectInfoPanel          IPC Handlers
  │                                   │
  ├─ git.fetch/pull/push ───────────► git.ts handlers
  │                                   │
  │  ◄── {success:false,  ───────────┘
  │      error:{category:"auth"}}
  │
  ├─ Detects auth error
  ├─ Opens PassphraseDialog
  │
  ├─ ssh.addKey(passphrase) ────────► ssh.ts handler
  │                                   │
  │                                   ├─ SSH_ASKPASS + ssh-add
  │                                   │
  │  ◄── {success: true} ────────────┘
  │
  ├─ Caches "agent loaded" (session)
  └─ Retries original git operation
```

## Related Code Files

| File | Role |
|------|------|
| `packages/electron/src/ipc-channels.ts` | Add SSH_ADD_KEY, SSH_CHECK_AGENT channels |
| `packages/electron/src/main/ipc/ssh.ts` | **New** — SSH service (ssh-add spawn, agent check) |
| `packages/electron/src/main/ipc/index.ts` | Register SSH handlers |
| `packages/electron/src/preload/index.ts` | Expose ssh.addKey, ssh.checkAgent in bridge |
| `packages/web/src/types/electron.d.ts` | Add ssh namespace to DevHubBridge type |
| `packages/web/src/components/organisms/PassphraseDialog.tsx` | **New** — modal for passphrase input |
| `packages/web/src/hooks/useGitWithSshRetry.ts` | **New** — encapsulate auth-error → dialog → retry pattern |
| `packages/web/src/api/queries.ts` | Add useSshAddKey mutation, useSshCheckAgent query |
| `packages/web/src/pages/GitPage.tsx` | Integrate passphrase dialog + retry |
| `packages/web/src/components/organisms/ProjectInfoPanel.tsx` | Integrate passphrase dialog for per-project git ops |
| `packages/core/src/git/errors.ts` | Optionally extend auth detection patterns |

## Implementation Steps

### Step 1: Add IPC channels (`ipc-channels.ts`)

```typescript
// In CH object:
SSH_ADD_KEY: "ssh:addKey",
SSH_CHECK_AGENT: "ssh:checkAgent",
```

### Step 2: Create SSH service (`packages/electron/src/main/ipc/ssh.ts`)

**`sshAddKey(passphrase: string, keyPath?: string)`**
- Use `node-pty` (already a dependency) to spawn `ssh-add` (or `ssh-add <keyPath>`) in a pseudo-terminal
- Listen for passphrase prompt, write passphrase to pty stdin
- Cross-platform: works on Linux, macOS, and Windows without platform branching
- Return `{success: boolean, error?: string}`

**`sshCheckAgent()`**
- Spawn `ssh-add -l`
- Parse output for key count
- Return `{hasKeys: boolean, keyCount: number}`

**`registerSshHandlers(holder: CtxHolder)`**
- `ipcMain.handle(CH.SSH_ADD_KEY, handler)`
- `ipcMain.handle(CH.SSH_CHECK_AGENT, handler)`

### Step 3: Register handlers (`main/ipc/index.ts`)

Import and call `registerSshHandlers(holder)`.

### Step 4: Expose in preload bridge (`preload/index.ts`)

```typescript
ssh: {
  addKey: (passphrase: string, keyPath?: string) =>
    ipcRenderer.invoke(CH.SSH_ADD_KEY, passphrase, keyPath),
  checkAgent: () => ipcRenderer.invoke(CH.SSH_CHECK_AGENT),
},
```

### Step 5: Update types (`electron.d.ts`)

Add `ssh` namespace to `DevHubBridge` interface.

### Step 6: Create PassphraseDialog component

- Modal overlay with password input + SSH key file dropdown
- Scan `~/.ssh/` for key files (filter out `.pub` files, `known_hosts`, `config`, `authorized_keys`)
- Props: `open`, `onSubmit(passphrase, keyPath)`, `onCancel`, `loading`, `error?`
- Auto-focus passphrase input, submit on Enter
- Add IPC channel to list SSH keys: `ssh.listKeys` → scan `~/.ssh/` directory
- Never store passphrase in persistent state

### Step 7: Add query hooks (`queries.ts`)

- `useSshAddKey()` — mutation calling `window.devhub.ssh.addKey`
- `useSshCheckAgent()` — query with 60s staleTime

### Step 8: Create `useGitWithSshRetry` hook

Encapsulates: attempt git op → detect auth error → show dialog → ssh-add → retry.

- Manages dialog open/close state
- Stores failed operation type + args for retry
- Session-level flag: once ssh-add succeeds, skip dialog for future ops
- Returns `{ PassphraseDialogElement, executeWithRetry(fn) }`

### Step 9: Integrate into GitPage.tsx

- Wrap git mutations with `useGitWithSshRetry`
- On auth error in fetch/pull/push results → trigger passphrase dialog
- On success → retry the original operation

### Step 10: Integrate into ProjectInfoPanel.tsx GitSection

- Same pattern for per-project fetch/pull/push buttons
- Reuse `useGitWithSshRetry` hook

## Security Considerations

- **Never persist passphrase** to disk, electron-store, or localStorage
- **node-pty stdin** — passphrase written to pty stdin, never as CLI argument (visible in `ps aux`)
- **Clear from memory** after ssh-add completes
- **No logging** of passphrase value in main process
- **Session-only cache** — only cache boolean "keys loaded", not the passphrase itself

## Todo

- [ ] Add SSH_ADD_KEY, SSH_CHECK_AGENT to ipc-channels.ts
- [ ] Create ssh.ts service with sshAddKey and sshCheckAgent
- [ ] Register SSH handlers in main/ipc/index.ts
- [ ] Expose ssh namespace in preload bridge
- [ ] Update DevHubBridge types in electron.d.ts
- [ ] Create PassphraseDialog component
- [ ] Add useSshAddKey and useSshCheckAgent hooks
- [ ] Create useGitWithSshRetry hook
- [ ] Integrate into GitPage.tsx
- [ ] Integrate into ProjectInfoPanel.tsx GitSection
- [ ] Optionally extend auth patterns in errors.ts
- [ ] Test: SSH key with passphrase triggers dialog
- [ ] Test: correct passphrase loads key and retries op
- [ ] Test: cancel dismisses dialog and shows error
- [ ] Test: subsequent ops skip dialog after successful ssh-add

## Success Criteria

- SSH auth failure triggers passphrase dialog instead of generic error
- Correct passphrase loads key via ssh-add and retries the operation
- After successful ssh-add, subsequent git ops work without re-prompting
- Passphrase never persisted to disk or visible in process listing
- Cancel dismisses dialog, shows original error
- Works on Linux (primary target)

## Risk Assessment

- **Medium risk**: SSH agent behavior varies across platforms
- **node-pty approach**: mitigates cross-platform stdin issues — pty emulates real terminal interaction
- **Agent unavailable**: if ssh-agent not running, show clear error with instructions (confirmed decision)
- **Multiple keys**: key file picker included in dialog (confirmed decision)
- **macOS Keychain**: macOS may use Keychain instead of ssh-agent — consider platform detection
