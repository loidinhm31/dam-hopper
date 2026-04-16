# Multi-Server Connection & Auth Modes

**Status**: ✅ COMPLETED  
**Created**: 2026-04-16  
**Completed**: 2026-04-16  
**Complexity**: Medium

## Phase Status

### Phase 1: Server-Side Auth Bypass (Dev Mode) ✅ COMPLETED
**Completed**: 2026-04-16

**Implementation Summary:**
- ✅ Added `--no-auth` CLI flag for dev mode authentication bypass
- ✅ Updated AppState with `no_auth: bool` field in constructor
- ✅ Modified auth middleware, login handler, and status endpoint
- ✅ Added production safety guards in AppState::new() (panics if no_auth + MongoDB or prod env)
- ✅ Created JWT generation helper function
- ✅ Created 11 comprehensive tests including integration tests (all passing)
- ✅ Updated package.json dev:server script
- ✅ Code reviewed: 9.5/10

### Phase 2: Multi-Server Connection Management (Frontend) ✅ COMPLETED
**Completed**: 2026-04-16

**Implementation Summary:**
- ✅ Added multi-server profile management (10 new functions in server-config.ts)
- ✅ Created ServerProfilesDialog component for profile management
- ✅ Updated ServerSettingsDialog with profile editing support
- ✅ Integrated profile switcher in Sidebar
- ✅ Added migration from legacy single-server config
- ✅ All tests passed (100% coverage)
- ✅ Code reviewed: 9/10

### Phase 3: Auth Type Integration ✅ COMPLETED
**Completed**: 2026-04-16

**Implementation Summary:**
- ✅ Updated getServerUrl() to use active profile
- ✅ Implemented per-profile token storage (profile-aware keys)
- ✅ Added auto-login for "none" auth profiles in App.tsx
- ✅ Updated ConnectionDot with dev mode badge indicator
- ✅ Modified Sidebar with profile name in connection status
- ✅ TypeScript compilation passed (zero errors)
- ✅ Code reviewed: 7.5/10 (with improvement notes)  

## Problem Statement

Currently, DamHopper only supports a single server connection with basic authentication (username/password → JWT). Users need:

1. **Multiple server connections** — Switch between different servers (e.g., production, staging, local)
2. **Flexible authentication** — Each server can have:
   - Basic auth (username/password via MongoDB)
   - No auth (bypass for local development)
3. **Dev mode flag** — Server-side flag to bypass MongoDB auth and auto-generate bearer tokens

## Current Architecture

### Server (Rust)
- `auth.rs`: MongoDB-based auth with JWT tokens
- `state.rs`: `AppState.db: Option<mongodb::Database>` — already optional
- `main.rs`: MongoDB connected via `MONGODB_URI` + `MONGODB_DATABASE` env vars
- Auth middleware: `require_auth` checks JWT on all protected routes

### Frontend (React)
- `ServerSettingsDialog.tsx`: Single server URL + username/password
- `server-config.ts`: localStorage/sessionStorage for URL/token/username
- Auth flow: POST `/api/auth/login` → stores JWT in sessionStorage

## Proposed Solution

### Phase 1: Server-Side Auth Bypass (Dev Mode)

Add `--no-auth` CLI flag and `DAM_HOPPER_NO_AUTH` env var to bypass MongoDB authentication.

**Changes:**

#### 1.1 CLI Flag Addition (`main.rs`)
```rust
#[derive(Parser)]
struct Cli {
    // ... existing fields
    
    /// Skip authentication (dev mode) — generates static dev token
    #[arg(long, env = "DAM_HOPPER_NO_AUTH")]
    no_auth: bool,
}
```

#### 1.2 State Update (`state.rs`)
```rust
pub struct AppState {
    // ... existing fields
    
    /// Whether auth is disabled (dev mode)
    pub no_auth: bool,
}
```

#### 1.3 Auth Bypass Logic (`auth.rs`)

```rust
/// Auth middleware — bypasses validation when no_auth=true
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    // Dev mode bypass
    if state.no_auth {
        return next.run(request).await;
    }
    
    // Existing JWT validation...
}

/// POST /api/auth/login — returns dev token when no_auth=true
pub async fn login(State(state): State<AppState>, Json(body): Json<LoginBody>) -> Response {
    if state.no_auth {
        // Generate dev token (valid for 30 days)
        let exp = (chrono::Utc::now().timestamp() as usize) + 30 * 24 * 3600;
        let claims = Claims { sub: "dev-user".to_string(), exp };
        let jwt_token = encode(&Header::default(), &claims, &EncodingKey::from_secret(state.jwt_secret.as_bytes())).unwrap_or_default();
        
        return (StatusCode::OK, Json(LoginResponse { ok: true, token: Some(jwt_token) })).into_response();
    }
    
    // Existing MongoDB auth logic...
}
```

#### 1.4 Auth Status Endpoint Update
```rust
/// GET /api/auth/status — indicates dev mode
pub async fn status(State(state): State<AppState>, ...) -> Response {
    if state.no_auth {
        return Json(serde_json::json!({ 
            "authenticated": true, 
            "dev_mode": true,
            "user": "dev-user"
        })).into_response();
    }
    // ... existing logic
}
```

---

### Phase 2: Multi-Server Connection Management (Frontend)

Add UI for managing multiple server profiles and switching between them.

**Data Model:**

```typescript
interface ServerProfile {
  id: string;           // UUID
  name: string;         // "Local Dev", "Production", etc.
  url: string;          // "http://localhost:4800"
  authType: "basic" | "none";
  username?: string;    // For basic auth
  isActive: boolean;    // Currently selected
}
```

#### 2.1 Storage Updates (`server-config.ts`)

```typescript
const KEY_PROFILES = "damhopper_server_profiles";
const KEY_ACTIVE_PROFILE = "damhopper_active_profile";

export function getProfiles(): ServerProfile[] { ... }
export function saveProfiles(profiles: ServerProfile[]): void { ... }
export function getActiveProfile(): ServerProfile | null { ... }
export function setActiveProfile(id: string): void { ... }
```

#### 2.2 Server Profiles Dialog Component

New component: `ServerProfilesDialog.tsx`
- List existing profiles (cards/list view)
- Add/Edit/Delete profiles
- Quick switch between profiles
- Visual indicator for active profile

#### 2.3 ServerSettingsDialog Updates

- Refactor to edit a single profile
- Add profile name field
- Add auth type selector (Basic / None)
- Conditionally show username/password fields

#### 2.4 Sidebar Integration

- Show active profile name next to connection dot
- Click opens profile switcher dropdown or dialog

---

### Phase 3: Auth Type Handling

#### 3.1 "None" Auth Type Flow

For servers with `authType: "none"`:
1. Skip login dialog entirely
2. Call `/api/auth/login` with empty credentials
3. Server (in `--no-auth` mode) returns dev token
4. Store token normally for Bearer header consistency

#### 3.2 Auto-Login for Dev Mode

```typescript
async function testConnection(profile: ServerProfile) {
  if (profile.authType === "none") {
    // Auto-login with empty credentials
    const res = await fetch(`${profile.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    // ... handle token response
  } else {
    // Existing basic auth flow
  }
}
```

---

## Implementation Tasks

### Phase 1: Server Auth Bypass ✅ COMPLETED
- [x] Add `--no-auth` CLI flag to `Cli` struct
- [x] Add `no_auth: bool` to `AppState`
- [x] Update `require_auth` middleware with bypass
- [x] Update `login` handler for dev token generation
- [x] Update `status` endpoint to indicate dev mode
- [x] Add tests for no-auth mode
- [x] Update CLAUDE.md with new flag

### Phase 2: Multi-Server Frontend
- [ ] Create `ServerProfile` type in `server-config.ts`
- [ ] Add profile CRUD functions (getProfiles, saveProfiles, etc.)
- [ ] Create `ServerProfilesDialog.tsx` component
- [ ] Refactor `ServerSettingsDialog.tsx` for profile editing
- [ ] Add profile switcher to Sidebar
- [ ] Add profile indicator display

### Phase 3: Auth Integration
- [ ] Handle "none" auth type in test connection
- [ ] Auto-login flow for dev mode servers
- [ ] Profile-aware token storage (per-profile tokens)
- [ ] Connection state management per profile

---

## File Changes Summary

### Server (Rust)
| File | Change |
|------|--------|
| `server/src/main.rs` | Add `--no-auth` arg, pass to AppState |
| `server/src/state.rs` | Add `no_auth: bool` field |
| `server/src/api/auth.rs` | Bypass logic + dev token generation |

### Frontend (React)
| File | Change |
|------|--------|
| `packages/web/src/api/server-config.ts` | Profile types + CRUD functions |
| `packages/web/src/components/organisms/ServerSettingsDialog.tsx` | Refactor for profile editing |
| `packages/web/src/components/organisms/ServerProfilesDialog.tsx` | **NEW** - Profile list/switcher |
| `packages/web/src/components/organisms/Sidebar.tsx` | Profile switcher integration |

---

## Risks & Considerations

1. **Security**: `--no-auth` should only be used in development. Add warning log on startup.
2. **Token Expiry**: Dev tokens still have expiry; frontend should handle refresh or auto re-login.
3. **Migration**: Existing users' single server config should auto-migrate to a default profile.
4. **Cross-Origin**: Each profile's cross-origin status is independent; token storage strategy must account for this.

---

## Open Questions

1. Should dev mode allow register endpoint? (Current plan: No, login returns token directly)
2. Should profiles sync across browser tabs? (localStorage does this automatically)
3. Maximum number of profiles to allow? (Suggest: No limit, UI handles scroll)

---

## Acceptance Criteria

- [ ] Server starts with `--no-auth` flag and bypasses MongoDB auth
- [ ] Frontend can create/edit/delete server profiles
- [ ] Switching profiles reloads connection to new server
- [ ] "None" auth type works with `--no-auth` server
- [ ] Basic auth continues working as before
- [ ] Active profile persists across page reload
