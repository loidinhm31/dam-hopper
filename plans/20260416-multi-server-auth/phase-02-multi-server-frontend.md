# Phase 2: Multi-Server Connection Management (Frontend)

**Status**: ✅ DONE
**Completed**: 2026-04-16

**Goal**: Add UI for managing multiple server profiles and switching between them.

## Data Model

```typescript
// packages/web/src/api/server-config.ts

export interface ServerProfile {
  id: string;                    // UUID v4
  name: string;                  // "Local Dev", "Production", etc.
  url: string;                   // "http://localhost:4800"
  authType: "basic" | "none";    // Authentication method
  username?: string;             // For basic auth display (password never stored)
  createdAt: number;             // Unix timestamp
}
```

---

## Tasks

### 2.1 Update server-config.ts

Add profile management functions:

```typescript
const KEY_PROFILES = "damhopper_server_profiles";
const KEY_ACTIVE_PROFILE = "damhopper_active_profile_id";

// Generate UUID
function uuid(): string {
  return crypto.randomUUID();
}

// Get all profiles
export function getProfiles(): ServerProfile[] {
  try {
    const stored = localStorage.getItem(KEY_PROFILES);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

// Save all profiles
export function saveProfiles(profiles: ServerProfile[]): void {
  try {
    localStorage.setItem(KEY_PROFILES, JSON.stringify(profiles));
  } catch { /* ignore */ }
}

// Get active profile ID
export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(KEY_ACTIVE_PROFILE);
  } catch { return null; }
}

// Get active profile
export function getActiveProfile(): ServerProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return getProfiles().find(p => p.id === id) ?? null;
}

// Set active profile
export function setActiveProfile(id: string): void {
  try {
    localStorage.setItem(KEY_ACTIVE_PROFILE, id);
  } catch { /* ignore */ }
}

// Create profile
export function createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile {
  const profile: ServerProfile = {
    ...data,
    id: uuid(),
    createdAt: Date.now(),
  };
  const profiles = getProfiles();
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

// Update profile
export function updateProfile(id: string, data: Partial<ServerProfile>): void {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...data };
    saveProfiles(profiles);
  }
}

// Delete profile
export function deleteProfile(id: string): void {
  const profiles = getProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
  // If deleted active, clear active
  if (getActiveProfileId() === id) {
    localStorage.removeItem(KEY_ACTIVE_PROFILE);
  }
}

// Migration: convert single server config to profile
export function migrateToProfiles(): void {
  if (getProfiles().length > 0) return; // Already migrated
  
  const existingUrl = getServerUrl();
  const existingUsername = getAuthUsername();
  
  if (existingUrl && existingUrl !== `${location.protocol}//${location.host}`) {
    const profile = createProfile({
      name: "Default Server",
      url: existingUrl,
      authType: "basic",
      username: existingUsername || undefined,
    });
    setActiveProfile(profile.id);
  }
}
```

---

### 2.2 Create ServerProfilesDialog.tsx

New component for profile management:

```tsx
// packages/web/src/components/organisms/ServerProfilesDialog.tsx

import { useState, useEffect } from "react";
import { X, Plus, Server, Check, Trash2, Edit2 } from "lucide-react";
import {
  getProfiles,
  getActiveProfileId,
  setActiveProfile,
  deleteProfile,
  ServerProfile,
} from "@/api/server-config.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onEditProfile: (profile: ServerProfile | null) => void;
  onSwitchProfile: (profile: ServerProfile) => void;
}

export function ServerProfilesDialog({ open, onClose, onEditProfile, onSwitchProfile }: Props) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProfiles(getProfiles());
      setActiveId(getActiveProfileId());
    }
  }, [open]);

  if (!open) return null;

  function handleSwitch(profile: ServerProfile) {
    setActiveProfile(profile.id);
    onSwitchProfile(profile);
    // Page will reload via onSwitchProfile handler
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this server profile?")) return;
    deleteProfile(id);
    setProfiles(getProfiles());
    setActiveId(getActiveProfileId());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-900 rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">Server Connections</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded">
            <X size={18} />
          </button>
        </div>

        {/* Profile List */}
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {profiles.length === 0 ? (
            <p className="text-zinc-500 text-center py-4">No server profiles yet</p>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  profile.id === activeId
                    ? "border-green-600 bg-green-900/20"
                    : "border-zinc-700 hover:border-zinc-600"
                }`}
              >
                <Server size={20} className="text-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{profile.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{profile.url}</div>
                  <div className="text-xs text-zinc-600">
                    {profile.authType === "none" ? "No auth" : `Basic (${profile.username || "—"})`}
                  </div>
                </div>
                <div className="flex gap-1">
                  {profile.id !== activeId && (
                    <button
                      onClick={() => handleSwitch(profile)}
                      className="p-1.5 hover:bg-zinc-800 rounded text-green-500"
                      title="Switch to this server"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => onEditProfile(profile)}
                    className="p-1.5 hover:bg-zinc-800 rounded"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(profile.id)}
                    className="p-1.5 hover:bg-zinc-800 rounded text-red-500"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800">
          <button
            onClick={() => onEditProfile(null)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Plus size={18} />
            Add Server
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### 2.3 Refactor ServerSettingsDialog.tsx

Update to work as profile editor:

**Key changes:**
1. Accept optional `profile: ServerProfile | null` prop
2. Add `name` field input
3. Add `authType` selector (radio or dropdown)
4. Conditionally show username/password for basic auth
5. Save creates/updates profile

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  closable?: boolean;
  profile?: ServerProfile | null;  // null = new profile
  onSaved?: (profile: ServerProfile) => void;
}

// Add name state
const [name, setName] = useState("");
const [authType, setAuthType] = useState<"basic" | "none">("basic");

// Auth type selector
<div className="flex gap-4 mb-4">
  <label className="flex items-center gap-2">
    <input
      type="radio"
      name="authType"
      value="basic"
      checked={authType === "basic"}
      onChange={() => setAuthType("basic")}
    />
    Basic Auth
  </label>
  <label className="flex items-center gap-2">
    <input
      type="radio"
      name="authType"
      value="none"
      checked={authType === "none"}
      onChange={() => setAuthType("none")}
    />
    No Auth (Dev Mode)
  </label>
</div>

// Conditionally show credentials
{authType === "basic" && (
  <>
    <input ... username />
    <input ... password />
  </>
)}
```

---

### 2.4 Update Sidebar.tsx

Add profile indicator and click handler:

```tsx
import { getActiveProfile } from "@/api/server-config.js";

// In component
const activeProfile = getActiveProfile();

// In render (near ConnectionDot)
<div className="flex items-center gap-2">
  <ConnectionDot status={status} collapsed={collapsed} />
  {!collapsed && activeProfile && (
    <span className="text-xs text-zinc-500 truncate max-w-24">
      {activeProfile.name}
    </span>
  )}
</div>
```

---

### 2.5 Add Migration on App Init

In App.tsx or main entry:

```tsx
import { migrateToProfiles } from "@/api/server-config.js";

// On app init
useEffect(() => {
  migrateToProfiles();
}, []);
```

---

## UI Mockup

```
┌─────────────────────────────────────┐
│ Server Connections            [X]   │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 🟢 Local Dev            [✓][✎][🗑]│
│ │     http://localhost:4800       │ │
│ │     No auth                     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ ⚪ Production             [✎][🗑]│
│ │     https://dam.example.com     │ │
│ │     Basic (admin)               │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│         [ + Add Server ]            │
└─────────────────────────────────────┘
```

---

## Verification

- [ ] Profile list displays correctly
- [ ] Can add new profile
- [ ] Can edit existing profile
- [ ] Can delete profile
- [ ] Switching profile reloads page with new connection
- [ ] Active profile indicator in sidebar
- [ ] Migration creates profile from existing config
- [ ] Auth type toggle shows/hides credentials fields
