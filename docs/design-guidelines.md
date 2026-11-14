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

---

## 7. Native Browser Tab Chrome, Navigation, Recovery & Accessibility (Implemented — Phases 01–05)

> **Status:** Implemented UX Guidelines (Phases 01–04 Implemented; Phase 05 Test Authoring & Reconciled, Live Visual Acceptance Gate Pending). Phase 01 owner/identity and pure tab-state model contracts, Phase 02 canonical persistence and Web Locks recovery, Phase 03 tuple-keyed stream slots and active-only streaming, Phase 04 modular native chrome (`BrowserTabStrip`, `BrowserAddressBar`, `BrowserNewTabPage`, `BrowserTools`, `BrowserRecoveryPanel`), and Phase 05 browser component and E2E qualification suites are authored, with live visual review receipt remaining the final gate.

### 7.1 Utilitarian Native Chrome & Tab Strip Geometry

- **Chrome Dimensions & Adaptive Ergonomics:** Keep the OS `WindowFrame` title bar unchanged. Inside the Browser window, stack a ~34px horizontal tab strip above a ~36px compact navigation/address bar using existing semantic theme tokens and adaptive typography (`10–32px`), scaling control targets to $\ge 44\text{px}$ under coarse pointers (`pointer: coarse`). Reuse existing Lucide icons (`Globe`, page/navigation controls) with zero new fonts, external assets, third-party dependencies, or CPU animation loops.
- **Tab Sizing, Overflow & Fixed `+` Trigger:** Render tabs at `120–220px` width, shrinking to a `96px` minimum at narrow widths with horizontal scrolling confined strictly to the tab strip (`scrollIntoView` on active focus) and a fixed `+` new-tab button anchored outside the scroll track.
- **Readable Identification & Always-Visible Close:** Label priority follows live `title` $\rightarrow$ committed URL hostname $\rightarrow$ `"New Tab"` fallback (never icon-only tabs that obscure identity), alongside an always-visible sibling close affordance (`×`) per tab and an honest pending indicator only during real in-flight navigation/create requests.
- **Honesty / Anti-Ornamentation Rules:** Omit third-party favicon fetches, fabricated page-load progress percentages, invented TLS/security lock verdicts, guessed `canGoBack`/`canGoForward` state (enable Back/Forward strictly while live and not pending), and fabricated `"playing"` audio badges without runtime evidence (retain the visible viewer-local `"Audio"` / `"Muted"` / `"Unlock Audio"` button).

### 7.2 In-Tab New Tab Panel, Draft Continuity & Tools/Recovery Disclosure

- **In-Tab New Tab Panel:** Render New Tab inside the active `role="tabpanel"` rather than a whole-window modal chooser (keeping other tabs accessible; `Escape` cancels editing and never closes the OS window). Provide an address field + explicit Open button, URL-only helper clarifying HTTP(S) and scheme-less host/port convenience (`https://` default; explicit `http://localhost:port` preserved; userinfo and phrase/search engine queries rejected), explicit local-plaintext continuity warning (noting ordinary query/hash retention locally and in exports/recipes), and **Clear remembered pages** (explicitly stating metadata clearance neither closes live pages nor resets server Chromium cookies/profiles).
- **Per-Tab In-Memory Drafts & Navigation:** Store input drafts per tab in memory (`dirty` flag) so drafts survive tab switches and window placement transitions without disk persistence or logging. Clean snapshots update clean drafts (`dirty === false`) without clobbering dirty edits; `Escape` restores the newest `committedUrl`; live `Reload` reloads `committedUrl` ignoring dirty drafts; `unavailable` `Reload` / validated `Enter` dispatches one explicit fresh-create intent (after resolving/acknowledging blockers); `Enter` is ignored while `isComposing` (IME) or an action is pending; `409` conflicts surface retry guidance without replay.
- **Accessible Tools & Recovery Disclosure:** Collapse secondary controls behind a keyboard-accessible disclosure preserving existing cooperative Control/Release lease status and actions, CDP DOM selection start/cancel, selection preview & terminal artifact handoff, active session diagnostics, **Clear remembered pages**, and the **Recovery Inventory** panel (pending/unknown notices, `Check close status / Retry close`, manual owner-qualified live session listing for explicit selected-ID attach/reveal or close without URL matching, and explicit duplicate-risk acknowledgment retaining unresolved notices).

### 7.3 ARIA Tablist Semantics, Scoped Keyboard & Focus Restoration

- **Tablist Structure:** Implement `role="tablist"` (`aria-label="Browser tabs"`) with separate interactive siblings per tab: a selectable `role="tab"` (`aria-selected`, `aria-controls`, unique tab/panel IDs, roving `tabIndex`) and a sibling close `<button>` with a privacy-safe tab `aria-label` (never nested `<button>` elements). Keep only the selected `role="tabpanel"` active and non-inert; inactive panels remain hidden/`inert`.
- **Scoped Keyboard Navigation:** Support `ArrowLeft`, `ArrowRight`, `Home`, `End` (selection/focus movement) and `Delete` (close focused tab) strictly when focus is inside the tablist, plus standard button activation on `+`. Handlers MUST NOT intercept address bar typing/IME, remote canvas/IME input, modal dialogs, or outer shell shortcuts; add no new global chords.
- **Predictable Focus Restoration:** Closing a tab moves focus to the nearest surviving tab (or the resulting New Tab); closing the Tools disclosure restores focus to its trigger; activating `+` moves focus to the address field.

### 7.4 Responsive Layout Tiers & Privacy Masking

- **Responsive Widths (`400px`, `640px`, `1024px+`):** Keep the address field flexible and collapse secondary tools into the disclosure trigger **first** before core navigation, close, or `+` controls. Enforce zero overlapping hit targets across `10–32px` text sizes and coarse pointers, preserve usable viewport canvas height, and confine horizontal scrolling to the tab strip. Live/status announcements use concise ARIA live regions.
- **Cognito Mode & PIN Lock Masking:** When Cognito Privacy Mode or the client-side PIN screen lock is active, synchronously mask tab titles, URLs, hover `title` tooltips, ARIA labels, drafts, and recovery inventory items from DOM/accessibility inspection, and enforce synchronous audio flush (`PcmPlayer.flush()`) with zero active streaming sockets.

### 7.5 Colocated Visual Acceptance Gate (Pre-Code Governance)

- **Colocated Evidence (`packages/ui/e2e/os-host-browser/tabs-visual/`):** Full-viewport Playwright captures via `capture-evidence.ts` across `400×800`, `640×900`, and `1440×900` viewports (exercising narrow overflow, New Tab, unavailable/capacity placeholders, tools/recovery disclosure, privacy masking, large text, and coarse pointers) publish in one evidence session to `packages/ui/e2e/os-host-browser/tabs-visual/` (`checkpoint.png`s, `evidence.json`, `review.md`; optional attachment duplicates do not replace colocated files or create golden baselines).
- **Mandatory Human Decision Receipt:** Automation initializes/resets `review.md` to `PENDING_HUMAN_REVIEW` only. Visual qualification strictly requires an independent **actual-human** `ACCEPTED` entry in `review.md` recording operator identity, timestamp, matching source fingerprint / Git HEAD / run ID, every inspected image SHA-256 digest, and visual notes. `PENDING_HUMAN_REVIEW`, `REJECTED`, missing, or mismatched hashes/metadata block visual qualification regardless of automated test results.

---

## 8. Native Android Agent Hub Design System & First Page Architecture

### 8.1 Landing Screen Philosophy
The Android Native client (`native/android-app/`) First Page / Landing Screen establishes a high-density, multi-zone developer workbench directly inspired by DamHopper's web Agent Hub:
- **Left Agents Zone:** Ambient cross-project agent observation (OMP, Codex, Claude), 7-status filter chips, urgency counters (`!N`, `●N`, `○N`), and direct jump-to-terminal routing.
- **Center Projects Stage:** Core workspace project cards, Git worktree context (`⎇ wt: branch · #hash`), live terminal counts, zero-session open targets with safe dismissal, and direct capability launch triggers (`[Files]`, `[Terminal]`, `[Git]`).
- **Right Workspace File Tree Zone:** Contextual file tree and Git file changes overview bound to the selected project, enabling one-tap file opening into `EditorPanelScreen` with canonical `DocumentId` leases.

### 8.2 Form Factor & Breakpoint Rules
- **Compact Phone (`< 600dp`):** Single active stage. Center stage occupies 100% width. Left Agents Sidebar and Right Workspace File Tree open as modal drawers / bottom sheets with `50%` dark scrim. All interactive controls enforce minimum `48x48dp` touch targets.
- **Foldable / Landscape (`600–839dp`):** Dual-column layout with a pinned collapsible left navigation rail (`240–280dp`) and center project stage (`weight(1f)`, `>= 360dp`). Right file tree operates as an expandable slide-over side sheet.
- **Expanded Tablet / DeX (`>= 840dp`):** 3-column hybrid layout (Left Agents 240dp | Center Projects flex 1, ~380-480dp | Right File Tree 280-320dp, collapsible via toggle).

### 8.3 Mandatory Touch & Contrast Invariants
- **Minimum Touch Target:** Inviolable `48x48dp` for all buttons, tabs, chips, and dismiss icons (`sizeIn(minWidth = 48.dp, minHeight = 48.dp)`).
- **Safety Gaps:** Minimum `8dp` spacing between adjacent destructive/dismiss actions and primary triggers.
- **WCAG 2.1 AA Contrast Compliance:** Text contrast exceeds `4.5:1` (Primary Text `#F0F6FC` on Canvas `#0D1117` = `15.8:1`; on Card `#161B22` = `14.2:1`). UI components exceed `3:0:1` (Accent `#58A6FF` on Card = `6.4:1`).
- **IME Safety:** Pinned top chrome (`56dp` compact / `48dp` expanded) never wraps; virtual keyboard resizes center content smoothly via `WindowInsets.ime`.
