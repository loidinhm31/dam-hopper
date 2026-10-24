# Client-Side Profile Management

Profile metadata and endpoint-bound credentials live in the browser. The profile runtime is client-side; the server participates through its normal authentication and WebSocket endpoints. The shared shell does not require a profile connection to mount.

For the end-user guide, see the [Multi-Server Profiles User Guide](../user-guide-multi-server-profiles.md). For REST endpoints, see the [REST Endpoint Reference](./rest-endpoints.md).

## Data Model

```typescript
export interface ServerProfile {
  id: string; // UUID v4
  name: string;
  url: string; // normalized HTTP(S) URL
  authType: "basic" | "none";
  username?: string; // display value; password is never stored
  createdAt: number; // Unix timestamp
  autoConnect: boolean;
}

export interface ProfileAuthV2 {
  version: 2;
  serverUrl: string;
  authType: "basic" | "none";
  token: string;
}
```

`ProfileAuthV2` is stored under `damhopper_profile_auth_v2_<profileId>`. Reads require a profile ID and verify the saved URL and auth type against the current profile. A legacy `damhopper_auth_token_<profileId>` record is migrated only when its profile still exists; an unbound legacy single-server token is not copied to an unrelated endpoint.

## Profile Configuration Functions

All functions are located in `packages/ui/src/api/server-config.ts`:

- `readServerProfiles(): KnownServerProfiles` distinguishes available storage from an unavailable storage backend.
- `getProfiles(): ServerProfile[]` reads available profiles.
- `createProfile(data): ServerProfile` defaults `autoConnect` to `true`.
- `updateProfile(id, data): boolean` updates metadata, including `autoConnect`.
- `deleteProfile(id): boolean` clears credentials and removes local profile state; it does not delete remote server data.
- `migrateToProfiles(): void` converts the legacy URL/token configuration and preserves explicit profile choices.
- `getAuthToken(profileId?): string | null`, `setAuthToken(token, profileId?): boolean`, and `clearAuthToken(profileId?): boolean` are profile-explicit at runtime; missing IDs do not fall back to a global token.
- `isSameOriginProfile(profile): boolean` applies the native platform origin restriction before auto-login or connection traffic.

The `damhopper_active_profile_id` record remains a compatibility/default endpoint input for legacy helpers. It is not the owner of connection state. `connections.ts` exposes `connectProfile(profileId)`, `disconnectProfile(profileId)`, and `removeProfileConnection(profileId)` for independent profile runtimes.

`getMediaClientId(owner)` returns an in-memory UUIDv4 for the exact `{ profileId, generation }`. `getMediaClientIdForProfile(profileId)` uses the current snapshot when connected and creates a stable generation-1 fallback when the profile is disconnected, so profile removal/logout cleanup still addresses the original namespace. `removeProfileConnection` deletes all serialized owner tuple keys for that profile; malformed keys are ignored.

## Connection Contract

```typescript
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "login-required"
  | "offline"
  | "unsupported";

export interface ConnectionSnapshot {
  owner: { profileId: string; generation: number };
  status: ConnectionStatus;
  intent: boolean;
  serverUrl: string;
  error?: string;
}
```

`connectProfile` first checks URL validity, native origin support, and `GET /api/auth/status`. The response must include `workbenchProtocol: 2`. Generation and owner checks prevent a previous profile runtime from publishing results after edit, removal, logout, or replacement.

## Persistence Breakdown

| Key | Storage | Scope |
| --- | --- | --- |
| `damhopper_server_profiles` | `localStorage` | All profile metadata; shared by tabs |
| `damhopper_profile_auth_v2_<id>` | `localStorage` | Endpoint-bound auth per profile |
| `damhopper_active_profile_id` | `localStorage` | Compatibility/default endpoint input |
| `dam-hopper:workspace-state` | Zustand persistence | Qualified `selectedProject` |
| `dam-hopper:preferences-source:v1` | Zustand persistence | Independent preference/settings/browser IDs |
| TanStack Query and connection state | Memory only | Owner/generation-qualified |

No client query cache is persisted to localStorage. The fresh-state reset removes allowlisted legacy browser-resource records, never calls `localStorage.clear()`, preserves profiles/auth/server data, and rejects unqualified `project`/`session` links that lack `profileId`.
