# Phase 01: Core Contracts, Stores & CSS

## Objective
Establish the shared types, stores, intent payloads, and CSS classes required for the 5 OS enhancements.

- `server/src/config/schema.rs` (server UiConfig dock_position)
- `server/src/config/global.rs` (server global normalize dock_position)
- `packages/ui/src/lib/ui-config.ts`
- `packages/ui/src/stores/settings.ts`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/os/intents.ts`
- `packages/ui/src/stores/lock-screen.ts` (new)
- `packages/ui/src/stores/lock-screen.test.ts` (new)
- `packages/ui/src/os/os.css`

## Changes
1. **`lib/ui-config.ts`**:
   - Define `export type DockPosition = "left" | "right" | "top" | "bottom";`
   - Define `isDockPosition(val: unknown): val is DockPosition`
   - Define `normalizeDockPosition(val: unknown): DockPosition`
   - Add `dockPosition: "left"` to `DEFAULT_UI_CONFIG` and `withUiConfigDefaults`.
1b. **`server/src/config/schema.rs` & `global.rs`**:
   - Add `dock_position: String` with default `"left"` to `UiConfig` with aliases `dockPosition` and `dock_position`.
   - Validate in `validate_appearance` that `dock_position` is `"left" | "right" | "top" | "bottom"`.
   - Add `"dockPosition" | "dock_position" => "dock_position"` in `normalize_ui_json_for_toml`.
2. **`stores/settings.ts` & `api/client.ts`**:
   - Add `dockPosition: DockPosition;` to `PersistedSettingsState` and `UiConfigDto`.
   - Update `applySnapshotToStore` to parse and apply `dockPosition` with `normalizeDockPosition`.
3. **`os/intents.ts`**:
   - In `IntentPayloadMap["git:status"]`, add optional `mode?: WindowMode;` (where `WindowMode = "tile" | "float"`).
4. **`stores/lock-screen.ts`**:
   - Create Zustand store `useLockScreenStore`:
     - State: `isLocked: boolean`, `hasPin: boolean`, `pinLength: number`, `isCooldown: boolean`, `cooldownUntil: number | null`, `failedAttempts: number`, `isVerifying: boolean`.
     - Methods: `init()`, `lock()`, `verifyAndUnlock(pin: string): Promise<boolean>`, `setPin(pin: string): Promise<void>`, `removePin(currentPin: string): Promise<boolean>`, `changePin(currentPin: string, newPin: string): Promise<boolean>`.
     - Cryptography: PBKDF2-SHA256 with 100,000 iterations and 16-byte random salt using WebCrypto (`crypto.subtle`).
     - Persists to `localStorage`:
       - `dam-hopper:os-lock-verifier`: `{ version: 1, salt: string, hash: string, length: number, updatedAt: number }`
       - `dam-hopper:os-lock-active`: `"1"` when locked.
       - `dam-hopper:os-lock-cooldown`: string timestamp when throttled.
     - Cooldown after 5 consecutive failed attempts: 15s cooldown deadline persisted in localStorage.
     - Verification fence: `isVerifying` guard prevents concurrent/overlapping submissions.
## Acceptance Criteria
- `pnpm --filter @dam-hopper/ui test run packages/ui/src/stores/lock-screen.test.ts` passes.
- Types compile cleanly without diagnostics.
