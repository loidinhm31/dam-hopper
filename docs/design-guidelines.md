# DamHopper OS Design Guidelines

This document outlines the visual identity, aesthetic principles, iconography standards, and user experience (UX) paradigms of DamHopper OS, with particular emphasis on the holographic desktop aesthetic, TopBar chrome iconography, and the client-side PIN privacy lock system.

---

## 1. Core Design Philosophy

DamHopper OS provides an AI-first web development operating environment combining modern desktop operating system conventions with developer-focused ergonomics. Its visual identity balances tactical, cyberpunk-inspired visual cues with strict engineering pragmatism:

1. **Clarity & Density Over Ornamentation:** Interfaces prioritize information density, monospace typography, and low cognitive overhead. Visual ornamentation must never obscure code, terminal output, or diagnostic state.
2. **Zero-CPU Decorative Overhead:** All decorative elements—including holographic grids, reticles, and scanlines—must be strictly non-blocking. Pure CSS and static inline SVGs with `pointer-events-none` and `aria-hidden="true"` guarantee zero JavaScript frame drops, animation loops, or layout recalculations.
3. **Fail-Closed Privacy Boundaries:** Visual privacy boundaries (Cognito Mode, Screen PIN Lock) operate with deterministic event interception and input containment, preventing data leakage to underlying processes or external observers.
4. **Theme Adaptability & Strict Contrast:** All UI components resolve colors dynamically through CSS custom properties (`--color-bg`, `--color-surface`, `--color-primary`, `--color-info`, `--color-border`, `--color-text`), maintaining high contrast and accessibility across dark themes.

---

## 2. Hologram-Inspired Desktop Background

The OS desktop canvas (`DesktopCanvas.tsx`) renders an ambient holographic background layer that establishes a tactile cybernetic workbench environment while running windows remain cleanly readable.

```
+-----------------------------------------------------------------+
|                       OS Desktop Canvas                         |
|                                                                 |
|     +-----------------------------------------------------+     |
|     |            Radial Vignette Boundary                 |     |
|     |                                                     |     |
|     |    +-------------------------------------------+    |     |
|     |    |        Dual-Scale Cyber Grid              |    |     |
|     |    |        (64px major / 16px minor)          |    |     |
|     |    |                                           |    |     |
|     |    |                  +---+                    |    |     |
|     |    |              -- /  |  \ --                |    |     |
|     |    |             |  |   +   |  |               |    |     |
|     |    |             |  Focal Reticle              |    |     |
|     |    |              -- \  |  / --                |    |     |
|     |    |                  +---+                    |    |     |
|     |    |                                           |    |     |
|     |    +-------------------------------------------+    |     |
|     |                                                     |     |
|     +-----------------------------------------------------+     |
|                                                                 |
+-----------------------------------------------------------------+
```

### 2.1 Dual-Scale Cyber Grid

The background grid (`.os-hologram-grid` in `os.css`) employs a nested dual-frequency grid pattern:
- **Major Grid (64px x 64px):** Rendered with a primary tint (`color-mix(in srgb, var(--color-primary, #3b82f6) 9%, transparent) 1px`). Major grid intersections provide macro alignment and spatial grounding.
- **Minor Precision Grid (16px x 16px):** Subdivides major cells with subtle border tint (`color-mix(in srgb, var(--color-border, #2a3a52) 18%, transparent) 1px`), giving high-precision tactical texture.
- **Radial Vignette Mask:** An elliptical mask (`radial-gradient(ellipse 80% 75% at 50% 50%, #000 25%, transparent 95%)`) softly fades the grid toward the viewport edges, preventing visual crowding behind dock, top bar, and window borders.

### 2.2 Center Focal Reticle & Coordinate Rings

Centered directly within the canvas is a precision vector reticle rendered as an inline SVG (`viewBox="0 0 400 400"`):
- **Outer Telemetry Ring ($r=180$):** 1px stroke with dashed telemetry pattern (`stroke-dasharray="4 8"`), operating at 14% theme primary opacity.
- **Segmented Arc Ring ($r=136$):** 1px info-colored segmented arc (`stroke-dasharray="48 16 12 16"`), creating dynamic visual rhythm without animation.
- **Inner Precision Ring ($r=72$):** 0.75px stroke with 70% opacity, framing the core desktop focal zone.
- **Cardinal Crosshairs:** 36px directional ticks extending inward from cardinal points $(0^\circ, 90^\circ, 180^\circ, 270^\circ)$.
- **Center Micro-Reticle:** A $3\text{px}$ center anchor dot and $5\text{px}$ offset crosshairs providing a central visual datum.

### 2.3 Scanline Shading & Ambient Glow

The canvas base layer (`.os-hologram-bg` in `os.css`) stacks two declarative gradients:
- **Scanlines:** A 4px repeating linear gradient (`repeating-linear-gradient(0deg, transparent 0px 3px, color-mix(in srgb, var(--color-info) 2%, transparent) 3px 4px)`) that subtly simulates CRT/holographic scanline phosphor textures.
- **Radial Ambient Glow:** A subtle radial gradient (`radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--color-primary) 8%, transparent) 0%, color-mix(in srgb, var(--color-info) 4%, transparent) 35%, transparent 70%)`) introducing soft depth at the focal center.

### 2.4 Zero-CPU Invariant

The holographic background must never consume CPU cycles or GPU render pipelines during active development:
- Strictly static SVG and CSS gradients.
- Fully non-interactive: `pointer-events-none`, `user-select: none`, and `aria-hidden="true"`.
- Zero `requestAnimationFrame`, CSS infinite keyframe animations, or canvas context operations.

---

## 3. TopBar Chrome & Iconography

The TopBar (`TopBar.tsx`) serves as the OS control strip, hosting profile navigation, virtual desktops, search, hardware metrics, alerts, and security controls.

### 3.1 TopBar Layout & Viewport Tiers

The TopBar scales across three responsive height tiers via CSS variable `--os-topbar-height`:
- **Standard ($\ge 1280$px):** 40px height. Full desktop switcher labels, keyboard shortcuts (`Ctrl+Alt+K`), and uncollapsed monitor meters.
- **Compact ($1024\text{--}1279$px):** 36px height. Compact desktop badges, condensed search bar.
- **Narrow Height ($640\text{--}767$px):** 34px height. Minimal padding, icon-focused controls.

### 3.2 Visual Structure & Iconography Standards

All iconography uses the Lucide React suite with consistent stroke weight (`1.5px` to `1.75px`), default size `14px`–`16px`, and aligned baselines:

| Area | Component / Trigger | Icon | Role & Interaction |
| --- | --- | --- | --- |
| **Profile** | Server Selector | `Server` (14px) | Displays active server profile name; opens `ServerProfilesDialog` / `ServerSettingsDialog`. |
| **Desktops** | Desktop Switcher | Custom Pill | Virtual desktop tabs with active highlight, inline double-click / `Enter` renaming, and context menu. |
| **Search** | Command Palette | `Search` (14px) | Quick search trigger displaying `"Search commands, agents…"` with `Ctrl+Alt+K` kbd indicator. |
| **Hardware** | Monitor Tray | `MonitorTray` | Live CPU (`C:`), Memory (`M:`), and Battery (`B:`) hardware telemetry. |
| **Alerts** | Notification Center | `Bell` (16px) | Unread activity/system alert counter with notification bell and popover. |
| **Privacy** | Screen Lock | `Lock` (16px) | Triggers instant screen lock when PIN is set, or opens `PinSetupDialog` if unconfigured. |

### 3.3 System Monitor Tray & Battery Telemetry

The `MonitorTray` component displays concise host health metrics in monospace text:
- **CPU & Memory:** `C: 14%` and `M: 42%` styled in muted labels and high-contrast numerical values.
- **Battery Meter (`B:` / `BAT`):** Rendered visually as `B: <value>%` (matching `C:` and `M:`) and labeled `BAT` in accessible titles/aria-labels. Rendered only when host reports valid battery hardware (`count > 0` integer, state `available` or `stale`, capacity percentage $0 \le \text{bat} \le 100$).
  - **Charging State:** Renders a warning-colored lightning bolt icon (`os-monitor-tray-battery-charging`) beside the percentage.
  - **Threshold Colors:**
    - $< 20\%$: Danger bold (`text-[var(--color-danger)] font-bold`).
    - $< 30\%$: Warning bold (`text-[var(--color-warning)] font-bold`).
    - $\ge 30\%$: Standard text color (`text-[var(--color-text)]`).
  - **Stale State:** Muted at 60% opacity (`data-stale="true"`) when telemetry lease is stale.

### 3.4 Cognito Privacy Mode Masking

Under Cognito Privacy Mode (`Mod+Alt+KeyB`):
- All hardware metrics (CPU, Memory, Battery) are masked to bullet placeholders (`●●●`) or suppressed.
- Active hostnames are masked to `protected-host`.
- Accessible `aria-label` and `title` attributes omit raw battery and metric numbers to prevent accessibility/DOM scraping leaks.

---

## 4. Client-Side PIN Privacy Lock UX

The client-side PIN lock system (`LockScreenOverlay.tsx`, `PinSetupDialog.tsx`, `useLockScreenStore.ts`) provides instantaneous walkaway physical privacy without terminating server PTY sessions or closing editors.

```
+-----------------------------------------------------------------+
|                       LockScreenOverlay                         |
|                           (z-[9990])                            |
|                                                                 |
|                             14:25                               |
|                       FRI, NOV 7, 2026                          |
|                                                                 |
|                           [ Shield ]                            |
|                          DamHopper OS                           |
|                                                                 |
|                         ●  ●  ○  ○                              |
|                      (PIN Dot Indicators)                       |
|                                                                 |
|                         [ 1 ] [ 2 ] [ 3 ]                       |
|                         [ 4 ] [ 5 ] [ 6 ]                       |
|                         [ 7 ] [ 8 ] [ 9 ]                       |
|                         [ C ] [ 0 ] [ ⌫ ]                       |
|                                                                 |
+-----------------------------------------------------------------+
```

### 4.1 Mental Model & Architectural Boundaries

It is critical to distinguish the three security and privacy perimeters:

1. **Server Authentication (Auth Store):** Account credentials, JWT tokens, and TOTP MFA. Protects remote API and WebSocket communication. Logging out terminates server sessions.
2. **Cognito Privacy Mode (Cognito Store):** Quick visual mask (`blur(16px)` + black screen) for shoulder-surfing protection during screen sharing. Ephemeral, non-blocking, cleared with shortcut chord.
3. **Client-Side PIN Privacy Lock (Lock Screen Store):** Walkaway physical barrier for local workstation unattended privacy. PTY terminals continue running, long-running agent tasks proceed, and Monaco models remain in memory. Unlocking requires a verified cryptographic PIN.

### 4.2 Lock Screen Overlay Experience (`LockScreenOverlay.tsx`)

- **Layering & Z-Order:** Rendered at `z-[9990]` via React Portal, sitting above all desktop windows, floating panels, modals, and the Dock, but subordinate to Cognito Mode (`z-[9999]`).
- **Clock & Date:** Large tabular numerals (`text-5xl font-light tracking-tight`) displaying current local time (`HH:mm`) and capitalized date string (`formatLockDate`).
- **PIN Dot Indicators:** Discrete circular dots corresponding to the configured PIN length (4 to 8 digits). Unfilled dots render as border rings; entered digits render as solid primary-colored dots.
- **Numeric Keypad:** 3x4 touch-friendly keypad with large hit targets ($\ge 48\text{px} \times 48\text{px}$) supporting digits 0–9, Clear (`C`), and Backspace (`⌫`).
- **Physical Keyboard Input:** Physical numerical keys (0–9), numpad keys, Backspace, Delete, and Escape (clear) are seamlessly mapped into the input buffer.
- **Shake Error Feedback:** Incorrect PIN entry triggers the `.os-lock-shake` keyframe animation (380ms ease) and an accessible error notice ("Incorrect PIN. Please try again.").
- **Focus Trapping & Restoration:** While locked, keyboard focus is strictly contained within the overlay. Upon successful unlock, focus is restored to the element that was focused prior to locking (`priorFocusedElementRef`).
- **Trailing Keystroke Leakage Prevention:** To prevent the final unlocking keystroke (or rapid subsequent keystrokes) from leaking into underlying live terminal PTYs or active Monaco editors, the overlay installs a capture-phase trailing release guard that intercepts and discards lingering physical `keydown` and `keyup` events during dismissal.

### 4.3 Brute-Force Throttling & Cooldown UX

To prevent automated PIN enumeration:
- **Maximum Attempts:** 5 consecutive failed attempts trigger lock throttling.
- **15-Second Cooldown:** The store records a timestamp deadline (`cooldownUntil = Date.now() + 15_000`) persisted in `localStorage` under `dam-hopper:os-lock-cooldown`.
- **Live Countdown Display:** While cooldown is active, keypad buttons are disabled, and a live ticking countdown ("Too many failed attempts. Try again in 14s…") is displayed.
- **Persistence Across Refresh:** Browser refresh or tab duplication reads `LOCK_COOLDOWN_STORAGE_KEY` and maintains the remaining cooldown period without resetting attempts.

### 4.4 Cryptographic PIN Storage & Verification

```
+------------+       crypto.getRandomValues(16)
| User PIN   | --------------------+
+------------+                     |
                                   v
+------------+          +-----------------------+          +------------------------+
| Salt (Hex) | -------> |     PBKDF2-SHA256     | -------> | 256-bit Hash (Hex)     |
+------------+          |  100,000 iterations   |          +------------------------+
                        +-----------------------+                      |
                                                                       v
                                                        +-----------------------------+
                                                        | localStorage:               |
                                                        | dam-hopper:os-lock-verifier |
                                                        +-----------------------------+
```

- **Algorithm:** PBKDF2 with SHA-256 and 100,000 iterations via Web Cryptography API (`crypto.subtle`).
- **Salt Generation:** 16 cryptographically random bytes via `crypto.getRandomValues`.
- **Verifier Record Format:** Stored under `dam-hopper:os-lock-verifier`:
  ```json
  {
    "version": 1,
    "salt": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "length": 4,
    "updatedAt": 1762489200000
  }
  ```
- **Plaintext Security:** The plaintext PIN is never written to disk, session storage, or telemetry logs. Verification compares computed hex digest against stored hash.

### 4.5 PIN Management Workflows (`PinSetupDialog.tsx`)

The PIN setup dialog handles three modal workflows:
1. **Setup Mode:** Invoked when no PIN is configured. Prompts for New PIN (4–8 numeric digits) and PIN Confirmation.
2. **Change Mode:** Prompts for Current PIN, New PIN, and New PIN Confirmation. Validates current PIN against stored hash before deriving new salt/hash.
3. **Remove Mode:** Prompts for Current PIN to remove the privacy lock verifier and restore unconfigured status.

**UI Invariant Protection:**
- **Session Mode Freezing:** The dialog freezes its effective mode for the duration of the open dialog session, preventing UI flickering if store state updates in background.
- **Submission Generation Fencing:** Uses a synchronous ref guard (`submissionGenerationRef`) to discard late async returns if the user closes or resets the form mid-hash derivation.

---

## 5. 4-Way OS Dock Positioning Ergonomics

The OS Dock (`Dock.tsx`) provides persistent application launchers and running window indicators.

```
       Top Dock: [App] [App] [App]
   +---------------------------------+
   |                                 |
 L |                                 | R
 e |                                 | i
 f |         Desktop Canvas          | g
 t |                                 | h
   |                                 | t
 D |                                 |
 o |                                 | D
 c |                                 | o
 k |                                 | c
   +---------------------------------+ k
      Bottom Dock: [App] [App] [App]
```

### 5.1 Dock Orientations

Configurable via Settings > Appearance (`SettingsAppearanceSection.tsx`) under `dockPosition`:
- **`left` (Default):** Vertical dock pinned to left margin. Preserves vertical editor space on widescreen displays.
- **`right`:** Vertical dock pinned to right margin. Preferred by multi-monitor setups with left-side system trays.
- **`top`:** Horizontal dock positioned directly beneath TopBar.
- **`bottom`:** Horizontal dock anchored to the bottom edge in traditional desktop OS style.

### 5.2 React Fiber & Keepalive Layout Invariant

Changing `dockPosition` MUST NOT remount or re-render child components of active windows.
- In `OsShell.tsx`, `<Dock>` and `<main>` maintain strict JSX element order:
  ```tsx
  <div className={`flex ${workspaceFlexClass} flex-1 min-h-0 min-w-0 w-full overflow-hidden`}>
    <Dock onLaunchApp={handleLaunchApp} position={dockPosition} />
    <main className="flex-1 min-h-0 min-w-0 relative overflow-hidden" role="main">
      <DesktopCanvas ... />
    </main>
  </div>
  ```
- The layout orientation is toggled purely via CSS flex directions on the parent container (`workspaceFlexClass`):
  - `left`: `flex-row`
  - `right`: `flex-row-reverse`
  - `top`: `flex-col`
  - `bottom`: `flex-col-reverse`
- This ensures React Fiber node stability across dock moves, preventing xterm PTY disconnects or Monaco editor model re-initialization.

---

## 6. Accessibility, Motion & Ergonomics

### 6.1 Reduced Motion Support

All animations honor user operating system preferences via `@media (prefers-reduced-motion: reduce)`:
- `.os-lock-shake` error animation is disabled (`animation-duration: 0.01ms !important`).
- Overlay fade and window transition durations are forced to `0.01ms`.
- Background pulse effects and decorative glow rings remain strictly static.

### 6.2 Keyboard Operability & ARIA Semantics

- **Modal Boundaries:** All dialogs (`PinSetupDialog`, `CommandPalette`, `NotificationCenter`) implement `role="dialog"`, `aria-modal="true"`, and automatic focus containment.
- **Lock Screen ARIA:** Fullscreen overlay defines `role="dialog"` with `aria-label="Screen Locked"`. Keypad buttons have explicit `aria-label` values (`"Digit 1"`, `"Backspace"`, `"Clear PIN"`).
- **Decorative Elements:** The holographic grid and focal reticle specify `aria-hidden="true"` and `pointer-events-none` to guarantee screen reader transparency.
