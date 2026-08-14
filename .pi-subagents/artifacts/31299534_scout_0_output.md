## scout-260813-1852-phase-05-host-context-native-adapter

### Findings / ownership

- **Shared contracts — create**
  - `packages/ui/src/lib/ssh-forward-host.ts`
  - `packages/ui/src/lib/ssh-forward-host.test.ts`
  - Pattern: `packages/ui/src/lib/browser-debug-host.ts` (host DTO/parser boundary). Keep all Tauri imports out of `packages/ui`.

- **Context + bridge — create**
  - `packages/ui/src/contexts/SshForwardHostContext.tsx`
  - `packages/ui/src/contexts/SshForwardHostContext.test.tsx`
  - Pattern: `packages/ui/src/contexts/BrowserDebugHostContext.tsx` provides nullable `{host:null, environment:{kind:"web"}}`.
  - Composition/export owner: `packages/ui/src/embed/dam-hopper-app.tsx`; currently re-exports BrowserDebug provider and owns app-level composition.

- **UI state — create**
  - `packages/ui/src/hooks/use-ssh-forward.ts`
  - `packages/ui/src/hooks/use-ssh-forward.test.tsx`
  - Pattern: Browser Debug host consumers subscribe in effects and gate events by generation: `packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`.

- **Server profile changes — modify**
  - `packages/ui/src/api/server-config.ts`
  - `packages/ui/src/api/server-config.test.ts`
  - Existing `getProfiles()` collapses unavailable storage/read failure to `[]`; Phase 05 needs `readServerProfiles()` explicit availability.
  - Existing `subscribeToProfileChanges(callback)` is untyped. Add typed `activeChanged` and `deleted` events only after successful commits.
  - `deleteProfile()` is the emission point; retain transactional rollback behavior.

- **Native adapter — create**
  - `apps/native/src/native-ssh-forward-host.ts`
  - `apps/native/src/native-ssh-forward-host.test.ts`
  - Pattern: `apps/native/src/native-browser-debug-host.ts` is sole native Tauri adapter: direct `invoke`/`listen`, cached state, listener lifecycle, operation gate, `dispose`.
  - **Severity: blocker if copied directly:** Browser Debug serializes work through `queue` and `dispose()` calls `destroy()`/native invoke. SSH adapter must issue activation A/B/C immediately and `dispose()` must only invalidate/unlisten.

- **Native app composition — modify**
  - `apps/native/src/main.tsx`
  - Existing composition constructs `NativeBrowserDebugHost`, wraps `DamHopperApp` in provider, and disposes on `beforeunload`.
  - Phase 05 should construct SSH host only on desktop, pass null on mobile/non-Tauri, and unload only unlistens.

- **Native tests/setup — modify**
  - `apps/native/package.json`, `pnpm-lock.yaml`
  - Native package has no `test` script or Vitest dev dependency despite existing `apps/native/src/native-browser-debug-host.test.ts`.
  - UI already supports `vitest run` via `packages/ui/package.json`.

### Minimal implementation order

1. Create shared decimal-string DTO/parsers and contract fixture tests.
2. Add server-config available/unavailable reader plus typed active/delete subscriptions/tests.
3. Create nullable SSH host context + bridge; export/mount from UI app surface.
4. Add native Vitest setup, then desktop-only adapter factory and exact 12-command-map test.
5. Implement open-client/listen ordering, `BigInt` activation tokens, response/context gates.
6. Add snapshot/error/hint reconciliation and mutation binding.
7. Wire native `main.tsx`; add deletion deactivate-then-purge bridge tests and mobile zero-call tests.
8. Add UI hook state tests for stale results, refetch coalescing, no mutation replay.

### Residual risks

- Phase 04 runtime blocker is deferred; Phase 05 frontend ordering tests cannot establish Rust runtime behavior.
- Existing Browser Debug environment uses `"native"` whereas Phase 05 requires `"nativeDesktop" | "nativeMobile"`; do not reuse that type unchanged.
- `server-config` currently considers storage failure empty; changing it must not regress existing fallback getters.

### Unresolved questions

- None beyond the plan’s release-support question for desktop OS/agent combinations.