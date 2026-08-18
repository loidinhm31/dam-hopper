# Multi-Server Profiles User Guide

## Overview

The **Multi-Server Profiles** feature (Phase 2) stores server profiles locally. Browser API/media access is same-origin by default; a separate browser frontend must be added to the server's exact `DAM_HOPPER_CORS_ORIGINS` allowlist. Ticket issuance requires authentication, and media URLs remain short-lived actor/session-bound capabilities. Packaged native browser transport ignores separate-origin profiles until a native transport exists.

HTTP profiles are supported, but cleartext exposes Bearer tokens, cookies, ticket URLs, API actions, and media bytes to interception or modification; use HTTPS or a trusted encrypted network when needed.

## Creating Your First Profile

### Option A: Automatic Migration

On first app load, if you had a previously configured server URL, it's automatically migrated:

1. Legacy single-server config: `damhopper_server_url` in localStorage
2. Converted to profile: **"Default Server"** with your existing URL
3. Profile automatically set as active

You can then edit this profile or create new ones.

### Option B: Manual Creation

1. **Open the Profile Manager**
   - Click the **"Change Server"** button in the left sidebar (or current server profile name)
   - Opens the **Server Connections** dialog

2. **Create New Profile**
   - Click the **"+ New"** button at the bottom of the dialog
   - Opens **Profile Settings** form

3. **Fill in Profile Details**
   - **Profile Name**: `Local Dev`, `Production`, etc. (user-friendly display name)
   - **Server URL**: `http://localhost:4800` (auto-corrects format: strips trailing slash, adds `http://` if missing)
   - **Auth Type**: Select `Basic` (requires token) or `None` (open server)
   - **Username** (optional): Your display name for basic auth (password never stored locally)

4. **Save Profile**
   - Saved to browser localStorage immediately
   - Available for switching across all browser tabs

## Switching Between Profiles

1. **Click Profile Selector**: In the sidebar, click the active profile name or "Change Server"
2. **Choose Profile**: Select from the list in **Server Connections** dialog
3. **Confirm**: Profile becomes active immediately
   - If switching from a different server, the page may reload to fetch fresh data

### Host-resource status after a profile switch

The browser discards push listeners from the old server and attaches one set to
the replacement transport. Host-resource snapshots and alert history are then
refetched through REST, so a missed disconnect event cannot be treated as
current state. If the new server cannot provide deep metrics, the popover labels
that limitation and keeps compatible CPU/disk data when available. The popover
is read-only; switching profiles never authorizes a host operation.

## Working in a Git worktree

The Project panel's **Active target** selector lets you choose the configured
project root or one of its registered Git worktrees. The project name and
configuration stay unchanged; Explorer, search, replace, Git, editor/diff,
media, and new terminals use the selected target together.

Before removing a worktree, the app refreshes its Git registration and checks
for dirty editor tabs or live terminal sessions owned by that exact target.
Save or close those resources before retrying. Git also protects dirty or
untracked files, so the app never force-removes a worktree.

If a worktree disappears outside the app, its row remains visible as
unavailable and new operations return to the project root. Existing editor
tabs are kept, and live terminals are labelled **orphaned** while their
original working directory remains unavailable. Use **Refresh worktrees** or
**Reconnect unavailable worktrees** after restoring the directory.

## Managing Profiles

### Edit a Profile

1. Open **Server Connections** dialog
2. Click the **Edit** (pencil) icon on the profile
3. **Profile Settings** form opens
4. Update name, URL, or auth type
5. Click **Save** — changes persist instantly

### Delete a Profile

1. Open **Server Connections** dialog
2. Click the **Delete** (trash) icon on the profile
3. Confirm deletion
4. If you delete the active profile, the first available profile becomes active (or none if all deleted)

### View Profile Details

In the **Server Connections** dialog, each profile shows:

- Profile name
- Server URL
- Auth type (Basic/None)
- Created date
- Active indicator (✓ checkmark if current)

## Storage & Data Persistence

**All profiles are saved in browser localStorage:**

| Item                | Storage      | Persistence                                |
| ------------------- | ------------ | ------------------------------------------ |
| All profiles (JSON) | localStorage | Survives browser close, shared across tabs |
| Active profile ID   | localStorage | Survives browser close, shared across tabs |
| Auth token          | localStorage | Per-profile, survives browser close        |

**Browser Tabs:** All tabs in the same browser share the profiles list. Switching profiles in one tab shows the new active profile in all open tabs.

Media issue/revoke calls use Bearer credentials and `credentials: include`; native stream GET/HEAD uses only the host-only media cookie and opaque ticket. Profile switch, delete, and logout attempt bounded session revocation before local token removal.

Profile selection and profile tokens are therefore shared by tabs in the same browser storage area. Use separate browser profiles or containers when you need independent simultaneous server sessions.

**Browser Close:** Profiles persist indefinitely until manually deleted.

**Private Browsing:** Depending on browser, localStorage may be unavailable or cleared on session end.

## Security Notes

- **Passwords are never stored** locally. Only the username for display purposes.
- **Auth tokens** (Bearer tokens) are stored in localStorage under a profile-specific key so Android/browser recreation does not discard the login. Tokens are readable by JavaScript; use trusted HTTPS deployments and do not store passwords.
- **Server URL or token changes** attempt remote media-session revocation during the credential transition; logout does so before normal logout. The request is bounded to five seconds, so local cleanup proceeds if the server is unreachable and its old matching cookie/tickets can remain usable until the 30-minute idle timeout (eight-hour absolute maximum). If remote revocation succeeds but local token persistence or removal fails, the remote session remains revoked intentionally; restore or retain the local login if needed, then reissue media before streaming.
- **Server URL changes** clear the profile token and require login again. Equivalent formatting changes, such as trailing slashes, do not clear it.
- **URLs are stored in plain text** in localStorage. Keep your browser secure.
- **No data sent to server** for profile management — entirely client-side.

## Using Profiles in Development

### Common Workflow

```
1. Create profiles:
   - "Local Dev" → http://localhost:4800
   - "Staging" → https://staging.damhopper.example.com
   - "Production" → https://damhopper.example.com

2. During development:
   - Work locally with "Local Dev"
   - Test changes on "Staging" by switching profile
   - Deploy and verify on "Production"

3. All without app restart!
```

### Multi-Tab Setup

For simultaneous independent sessions, open separate browser profiles or containers:

- Container 1: "Local Dev" (localhost:4800)
- Container 2: "Staging" (staging server)
- Container 3: "Production" (prod server)

Ordinary tabs share the active profile and profile-scoped token storage.

## Troubleshooting

### Profile Not Saving?

- localStorage might be disabled in your browser
- Try: Settings → Privacy → Allow localStorage (varies by browser)
- Check available storage space (localStorage has ~5-10MB limit)
- Try private browsing mode (may not persist)

### Can't Switch to a Profile?

- Verify the server URL is reachable
- Check your auth token is still valid
- Try closing and reopening the profile dialog
- Verify browser has active internet connection

### Profile List Empty After Browser Restart?

- localStorage was cleared by browser settings or privacy mode
- Recreate profiles manually or restore from backup (if saved elsewhere)

### Legacy "Single Server" Profile Doesn't Exist?

- Automatic migration only runs once on app load
- If you deleted all profiles, you can manually recreate the default by setting URL via the create profile form

## API Reference (For Developers)

All functions in `packages/ui/src/api/server-config.ts`:

```typescript
// Get all profiles
const profiles = getProfiles(): ServerProfile[]

// Get currently active profile
const profile = getActiveProfile(): ServerProfile | null

// Create new profile
const newProfile = createProfile({
  name: "My Server",
  url: "http://example.com",
  authType: "basic",
  username: "myuser"
})

// Update existing profile
updateProfile(profileId, { name: "Updated Name" })

// Delete profile
deleteProfile(profileId)

// Switch active profile
setActiveProfile(profileId)

// Auto-migrate legacy config on first load
migrateToProfiles()
```

See [API Reference](./api-reference.md#client-side-profile-management-phase-2) for complete details.
