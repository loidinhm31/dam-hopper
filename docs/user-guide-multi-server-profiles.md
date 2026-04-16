# Multi-Server Profiles User Guide

## Overview

The **Multi-Server Profiles** feature (Phase 2) lets you manage and switch between multiple dam-hopper server configurations without restarting the application. This is useful for development workflows that involve:

- Local development server (usually `localhost:4800`)
- Staging server (e.g., `https://staging.example.com`)
- Production server (e.g., `https://damhopper.example.com`)
- Team server at a different IP

All profiles are **stored in your browser's localStorage** — no server involvement, instant switching, automatic migration from legacy config.

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

| Item | Storage | Persistence |
|------|---------|-------------|
| All profiles (JSON) | localStorage | Survives browser close, shared across tabs |
| Active profile ID | localStorage | Survives browser close, shared across tabs |
| Auth token | sessionStorage | Cleared on tab close, isolated per tab |

**Browser Tabs:** All tabs in the same browser share the profiles list. Switching profiles in one tab shows the new active profile in all open tabs.

**Browser Close:** Profiles persist indefinitely until manually deleted.

**Private Browsing:** Depending on browser, localStorage may be unavailable or cleared on session end.

## Security Notes

- **Passwords are never stored** locally. Only the username for display purposes.
- **Auth tokens** (Bearer tokens) are stored in sessionStorage, which **clears on tab close** — not persisted permanently.
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

Open multiple browser tabs with different profiles:
- Tab 1: "Local Dev" (localhost:4800)
- Tab 2: "Staging" (staging server)
- Tab 3: "Production" (prod server)

Each tab maintains its own token and can operate independently.

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

All functions in `packages/web/src/api/server-config.ts`:

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
