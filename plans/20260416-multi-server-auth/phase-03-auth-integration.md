# Phase 3: Auth Type Integration

**Goal**: Connect frontend profile auth types with server behavior.

## Tasks

### 3.1 Profile-Aware getServerUrl

Update to use active profile:

```typescript
// packages/web/src/api/server-config.ts

export function getServerUrl(): string {
  // Priority 1: Active profile
  const activeProfile = getActiveProfile();
  if (activeProfile) {
    return activeProfile.url.replace(/\/$/, "");
  }
  
  // Priority 2: Legacy localStorage (for migration period)
  try {
    const stored = localStorage.getItem(KEY_URL);
    if (stored) return stored;
  } catch { /* ignore */ }
  
  // Priority 3: Env var
  const envUrl = (import.meta as any).env?.VITE_DAM_HOPPER_SERVER_URL as string | undefined;
  if (envUrl) {
    if ((import.meta as any).env?.DEV) {
      return `${location.protocol}//${location.host}`;
    }
    return envUrl.replace(/\/$/, "");
  }
  
  // Fallback: same origin
  return `${location.protocol}//${location.host}`;
}
```

---

### 3.2 Auth Type Aware Test Connection

Update ServerSettingsDialog test connection logic:

```typescript
async function testConnection() {
  if (!normalized || !urlSchemeValid) return;
  setTestState("testing");
  setTestError(null);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    try {
      // Different body based on auth type
      const bodyContent = authType === "none" 
        ? {} 
        : { username: username.trim(), password: password.trim() };
      
      const res = await fetch(`${normalized}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyContent),
        signal: controller.signal
      });
      
      const data = await res.json().catch(() => null);
      
      if (res.ok && data?.token) {
        setToken(data.token);
        setTestState("ok");
        
        // Show dev mode indicator if applicable
        if (data.dev_mode) {
          setTestError("✓ Dev mode active");
        }
      } else {
        setTestState("fail");
        setTestError(data?.error || `HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    setTestState("fail");
    setTestError(e instanceof Error ? e.message : String(e));
  }
}
```

---

### 3.3 Per-Profile Token Storage

Update token storage to be profile-aware:

```typescript
// Token key includes profile ID
function tokenKey(profileId?: string): string {
  const id = profileId || getActiveProfileId();
  return id ? `damhopper_auth_token_${id}` : KEY_TOKEN;
}

export function getAuthToken(profileId?: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(profileId));
  } catch {
    return null;
  }
}

export function setAuthToken(token: string, profileId?: string): void {
  try {
    sessionStorage.setItem(tokenKey(profileId), token);
  } catch { /* ignore */ }
}

export function clearAuthToken(profileId?: string): void {
  try {
    sessionStorage.removeItem(tokenKey(profileId));
  } catch { /* ignore */ }
}
```

---

### 3.4 Auto-Login for Dev Mode Profiles

When switching to a "none" auth profile, auto-login:

```typescript
// In profile switch handler
async function handleSwitchProfile(profile: ServerProfile) {
  setActiveProfile(profile.id);
  
  // For "none" auth, auto-fetch token
  if (profile.authType === "none") {
    try {
      const res = await fetch(`${profile.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.token) {
        setAuthToken(data.token, profile.id);
      }
    } catch {
      // Will fail on page reload — OK, login dialog handles it
    }
  }
  
  // Reload to apply new connection
  setTimeout(() => window.location.reload(), 300);
}
```

---

### 3.5 Login Dialog Awareness

Update login flow to check auth type:

```typescript
// In initial auth check (App.tsx or auth provider)
async function checkAuthStatus() {
  const profile = getActiveProfile();
  
  // No profile yet — show server settings
  if (!profile) {
    return { needsSetup: true };
  }
  
  // Has token — validate it
  const token = getAuthToken();
  if (token) {
    const res = await fetch(`${getServerUrl()}/api/auth/status`, {
      headers: buildAuthHeaders()
    });
    if (res.ok) {
      return { authenticated: true };
    }
    // Token invalid — clear and retry
    clearAuthToken();
  }
  
  // No token — behavior depends on auth type
  if (profile.authType === "none") {
    // Auto-login
    const res = await fetch(`${getServerUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.token) {
      setAuthToken(data.token);
      return { authenticated: true };
    }
    return { error: "Dev server not in no-auth mode" };
  }
  
  // Basic auth — show login dialog
  return { needsLogin: true };
}
```

---

### 3.6 UI Indicators for Dev Mode

Show visual cues when connected to dev mode server:

```tsx
// ConnectionDot or status display
function ConnectionStatus({ status }: { status: ConnectionStatus }) {
  const [isDevMode, setIsDevMode] = useState(false);
  
  useEffect(() => {
    // Check status endpoint for dev_mode flag
    fetch(`${getServerUrl()}/api/auth/status`, { headers: buildAuthHeaders() })
      .then(r => r.json())
      .then(d => setIsDevMode(!!d.dev_mode))
      .catch(() => {});
  }, [status]);
  
  return (
    <div className="flex items-center gap-1">
      <ConnectionDot status={status} />
      {isDevMode && (
        <span className="text-xs px-1 py-0.5 bg-yellow-500/20 text-yellow-500 rounded">DEV</span>
      )}
    </div>
  );
}
```

---

## Flow Diagrams

### Basic Auth Flow
```
User → Enter credentials → POST /api/auth/login → JWT token → Store → Authenticated
```

### No Auth Flow
```
Select profile → Auto POST /api/auth/login (empty) → Dev token → Store → Authenticated
```

### Profile Switch Flow
```
Click profile → setActiveProfile(id) → Clear old token → Auto-login if none auth → Reload page
```

---

## Error Handling

| Scenario | Error Message | Action |
|----------|---------------|--------|
| "none" auth but server has auth enabled | "Server requires authentication" | Show login dialog |
| "basic" auth but wrong credentials | "Invalid credentials" | Show error, retry |
| Server unreachable | "Connection failed" | Show reconnect option |
| Token expired | "Session expired" | Auto re-login or show dialog |

---

## Verification

✅ "none" auth profile auto-logs-in on switch
✅ "basic" auth profile shows login dialog
✅ Tokens stored per-profile (switching doesn't lose tokens)
✅ Dev mode indicator visible when connected to no-auth server
✅ Error when "none" profile connects to auth-required server
✅ Token refresh works for both auth types

---

## Status: ✅ COMPLETED

**Completed**: April 16, 2026  
**Code Review**: 7.5/10 (CODE_REVIEW_PHASE3_20260416.md)

**Implementation Notes:**
- All core functionality delivered
- TypeScript compilation: zero errors
- Auto-login implemented in App.tsx
- Profile-aware token storage functional
- Dev mode badge displayed in ConnectionDot
- Some improvement areas noted in code review (race conditions, error handling)
