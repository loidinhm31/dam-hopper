# DamHopper OS — Initial UI/UX Architecture & Wireframe Specification

- **Status:** Proposed
- **Date:** 2026-11-01
- **Scope:** Desktop Web UI (`packages/ui/src`) redesign into **DamHopper OS** (design artifact only; zero code changes)
- **Target Viewports:** Primary `1440×900` & `1920×1080`; Supported `1024×640` minimum (`1024–1279` compact desktop rules; `<1024×640` out of scope)

---

## 1. Design Principles

1. **AI-First Fleet Telemetry (ROS Mental Model):** Server subsystems act as *nodes/services*, live SSE/WebSocket streams (`AgentStatusBridge`, `useMultiHostResources`, `worktree:changed`) act as *topics*, and workspace bootstraps act as *launch recipes*. AI agents (`OMP`, `Claude`, `Codex`) are first-class OS processes surfaced by semantic state (`Needs attention`, `Working`, `Idle`, `Unknown`) with strict provenance (`hook` 15s lease vs. `lifecycle`) and never conflated with raw PTY byte output or unverified task success.
2. **Zero-Ambient Context (Explicit Ownership Stamps):** No global ambient server or repo assumptions. Every window header stamps its immutable ownership tuple: `[profile] · [project:worktree]` for repo-bound apps, `[profile] · [Profile Scope]` for server-bound apps, or `[Fleet: N/M online]` for cross-server apps. Multi-server profiles coexist side-by-side on the same desktop canvas.
3. **Terminal-Safe, Remappable Keyboard Sovereignty:** OS window-management defaults use `Ctrl+Alt+<Key>` and existing `Mod+Shift+<Key>` chords chosen to avoid POSIX/readline/vim/tmux control codes (`Ctrl+A..Z`, `Alt+B/F/D/.`) and browser-reserved keys (`Ctrl+T/W/N/Tab`). Because `Ctrl+Alt` can still intersect existing zoom bindings (`Ctrl+Alt+Minus`, `Ctrl+Alt+Shift+Equal`), international `AltGr` layouts, or host Linux/Windows WMs, all OS chords are user-remappable via `ShortcutCapture`, bypass `AltGraph`/IME composition, and provide an explicit terminal-focus escape (`Ctrl+Alt+Escape`).
4. **Hybrid Tiling + Floating Topology with Keep-Alive Continuity:** Each virtual desktop combines a binary split tiling tree (with tabbed window groups per tile) and a z-ordered floating window layer. Moving windows across tiles, floating layers, minimized dock slots, or virtual desktops reparents DOM hosts via `TerminalKeepAliveHost` (`attachTerminalsToHost`) and `BrowserDebugKeepAliveHost` without unmounting live xterm PTYs or invalidating browser-bridge nonces.
5. **High-Density Monospace Precision (Adaptive Scale):** Full `JetBrains Mono` typography (`--app-font-size: 14px` base, scaling proportionally with `--app-zoom`), `1.75rem` (`28px` at 1×) window title bars, `1px` structural borders, and zero decorative chrome. Interactive controls expand to `44×44px` hit areas when required by accessibility or compact density rules.
6. **Fail-Closed Multi-Profile Resilience:** When a server profile disconnects or rotates connection generation, only windows owned by that `profileId` degrade into a `Disconnected-Profile` state. Secret/mutation surfaces (`Encrypt` OPAQUE/AES buffers, `SessionChangesPanel`) fail closed immediately and never silently reroute to another profile, while terminal scrollback remains inspectable read-only until the exact profile reconnects.

---

## 2. Existing Token & Component Inventory Reused

### 2.1 Color, Typography, Spacing & Surface Tokens (`packages/ui/src/index.css`, `fonts.css`, `styles.ts`)

> **Note on CSS source comments:** Several inline hex comments in `packages/ui/src/index.css` differ slightly from the actual `hsl(...)` values rendered by the browser. Implementation MUST reference the CSS variables (`var(--color-*)`), which resolve to the exact `hsl()` definitions below.

| Category | CSS Custom Property / Utility | Exact Source Value (`index.css`) | Computed Hex (`hsl` → sRGB) | Source Comment / Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas & Surfaces** | `--color-background` | `hsl(222, 47%, 5%)` | `#070B13` *(comment: `#0D1117`)* | Desktop root canvas, xterm host background |
| | `--color-surface` / `--color-card` | `hsl(217, 33%, 11%)` | `#131B25` *(comment: `#1E293B`)* | Window headers, dock, top bar, tiled panels |
| | `--color-surface-2` | `hsl(215, 25%, 17%)` | `#202B36` *(comment: `#1E2A3B`)* | Hover states, inactive tabs, pill backgrounds |
| | `--color-input` | `hsl(217, 33%, 9%)` | `#0F161E` | Command palette input, filter inputs |
| | `--color-border` / `--color-secondary` | `hsl(215, 25%, 22%)` | `#2A3746` *(comment: `#2A3A52`)* | `1px` split separators, unfocused window borders |
| **Typography & Ink** | `--color-text` / `--color-foreground` | `hsl(210, 40%, 98%)` | `#F8FAFC` *(comment: `#F1F5F9`)* | Primary window titles, active tab & body text |
| | `--color-text-muted` / `--color-muted-foreground` | `hsl(215, 20%, 55%)` | `#7689A2` | Unfocused window titles, metadata, chord hints |
| **Brand & Semantic** | `--color-primary` / `--color-ring` | `hsl(217, 91%, 60%)` | `#3B82F6` | Focused window border, active tab bar, focus ring |
| | `--color-primary-hover` | `hsl(217, 91%, 68%)` | `#639CF8` | Primary CTA hover |
| | `--color-accent` | `hsl(25, 95%, 53%)` | `#F97316` | Semantic orange highlight / recipes |
| | `--color-info` | `hsl(189, 94%, 43%)` | `#06B6D4` | `Working` agent status icon, git branch label |
| | `--color-success` | `hsl(142, 71%, 45%)` | `#22C55E` | Online connection dot, `Running` badge, git `+` |
| | `--color-warning` | `hsl(48, 96%, 53%)` | `#FACC15` | `Needs attention` (`blocked`), stale metrics, alerts |
| | `--color-danger` | `hsl(0, 84%, 60%)` | `#EF4444` *(comment: `#F87171`)* | Error connection dot, kill session, git `-` |
| **Selection & Glass** | `--color-selection` / `--color-selection-border` | `hsl(217, 91%, 60%, 0.28)` / `hsl(217, 91%, 65%)` | `rgba(59,130,246,0.28)` / `#5493F7` | `.workbench-selection` (`inset 3px 0 0` left bar) |
| | `.glass-card` / `.glass-card-blur` | `rgba(30, 41, 59, 0.92..0.95)` + `blur(12px)` | — | Floating windows, command palette, popovers |
| | `.border-glow` | `border: var(--color-primary)` + `0 0 12px rgba(59,130,246,0.15)` | — | Focused window frame highlight |
| **Font & Scale** | `--font-sans` / `--font-mono` | `"JetBrains Mono", ui-monospace, monospace` | Weights `200..800` (`fonts.css`) | `--app-font-size: 14px`; `--text-2xs` (`10px`) → `--text-2xl` (`24px`) |
| **Radii & Chrome** | `--radius` / `--radius-md` / `--radius-sm` | `0.5rem` (`8px`) / `6px` / `4px` | — | Floating window (`8px`), buttons (`4px`), badges (`2px` `rounded-sm`) |

### 2.2 SVG Wireframe Theme-Variable Alias Map

All inline `svg` wireframes in Sections 3 and 4 strictly use only the permitted wireframe variables, mapped to `packages/ui/src/index.css` as follows:

| Permitted SVG Variable | Mapped DamHopper Token (`packages/ui/src/index.css`) | Role in Wireframes |
| :--- | :--- | :--- |
| `var(--fg)` / `currentColor` | `var(--color-text)` (`hsl(210, 40%, 98%)`) | Primary labels, focused titles, active glyphs |
| `var(--muted)` | `var(--color-text-muted)` (`hsl(215, 20%, 55%)`) | Secondary metadata, unfocused chrome, keybinding hints |
| `var(--border)` | `var(--color-border)` (`hsl(215, 25%, 22%)`) | `1px` tile dividers, unfocused window frames, table rules |
| `var(--surface)` | `var(--color-surface)` (`hsl(217, 33%, 11%)`) | Top bar, left dock, window title bars, floating card fill |
| `var(--accent)` | `var(--color-primary)` (`hsl(217, 91%, 60%)`) | Focused window border, active desktop/tab indicator, snap zones |
| `var(--success)` | `var(--color-success)` (`hsl(142, 71%, 45%)`) | Online profile dot, `Working`/`Running` state, healthy meter |
| `var(--warning)` | `var(--color-warning)` (`hsl(48, 96%, 53%)`) | `Needs attention` (`!`) badge/border, memory pressure warning |
| `var(--error)` | `var(--color-danger)` (`hsl(0, 84%, 60%)`) | Offline/error profile dot, incident alert, kill action |

### 2.3 Component Reuse vs. Adaptation vs. New Infrastructure Matrix

| Classification | Existing Source Path (`packages/ui/src/...`) | DamHopper OS Role & Architectural Contract |
| :--- | :--- | :--- |
| **Reuse Unchanged** | `components/atoms/ProfileBadge.tsx` | Deterministic 8-palette hash (`PROFILE_COLOR_PALETTES`) stamped in every window header & hub row |
| **Reuse Unchanged** | `components/atoms/ProjectBadge.tsx` | Deterministic 8-palette hash (`PROJECT_COLOR_PALETTES`) stamped in repo-scoped window headers |
| **Reuse Unchanged** | `components/atoms/AgentHarnessBadge.tsx` | `OMP` (purple), `Codex` (emerald), `Claude` (amber) badges in Agent Hub, Terminals, and Recipes |
| **Reuse Unchanged** | `components/atoms/AgentStatusBadge.tsx` | Fenced `terminalRef` + `incarnation` status (`Run`, `!`, `Idle`, `?`, `Off`, `Unqual`, `Unsup`) |
| **Reuse Unchanged** | `components/atoms/ConnectionDot.tsx` | `online` (green glow), `connecting` (yellow pulse), `offline` (muted), `error` (red) + `DEV` pill |
| **Reuse Unchanged** | `components/organisms/TraditionalTerminalProjectsDisplay.tsx` | Internal body of **Terminals** app window (`224px` resizable project/agent navigator + `SplitLayout` right) |
| **Reuse Unchanged** | `components/organisms/{HostResourceGlance,HostResourceDiagnosis,HostResourceFleetDeck,HostIdleSuspendStatus}.tsx` | Composed directly inside **System Monitor** window (fleet cards, CPU/mem/storage/temp/battery, pressure diagnosis, idle-suspend) |
| **Reuse Unchanged** | `components/organisms/{SessionChangesPanel,ReadonlyMonacoDiffViewer,SessionChangedFilesList}.tsx` | Hosted inside standalone **Session Changes** window (retains `profileId:generation:terminalId:incarnation:ompSessionId:rootId` fencing) |
| **Reuse Unchanged** | `components/organisms/CognitoModeOverlay.tsx` | Full-viewport `z-index: 10000` privacy mask (`black-screen` / `heavy-blur`) + `useCognitoModeInputGuard` |
| **Adapt Presentation** | `components/organisms/{TopNav,TopNavUtilityStrip}.tsx` | **OS Top Bar** (`40px`): adds Virtual Desktop Switcher (`1..9`), Global Context Switcher, Command Palette trigger, and compact CPU/MEM tray |
| **Adapt Presentation** | `components/organisms/ActivityBar.tsx` | **OS Left Dock** (`48px`): pinned app launchers, running instance pips, and aggregated agent attention badges (`!N`) |
| **Adapt Presentation** | `components/molecules/WorkflowContextRibbon.tsx` | Embedded into Top Bar center-left as compact **Workflow Ribbon**; clicking opens/focuses **Workflow & Plans** window |
| **Adapt Presentation** | `components/organisms/MergeConflictEditor.tsx` | Launched from **Git** window as an independent **Conflict Resolver** window (tiling or floating) |
| **Adapt Presentation** | `components/pages/DashboardPage.tsx` + `HostResourcePopover.tsx` | Merged into **System Monitor** app window (adds `SessionRow` table with `Kill` + `HostResourcePopover` drilldowns) |
| **New Infrastructure** | *(Proposed)* `components/os/DesktopWindowManager.tsx` | Generalizes `SplitLayout.tsx` + `PaneContainer.tsx` + `TerminalDockPreview.tsx` (`@dnd-kit/core` + `react-resizable-panels`) to host arbitrary OS app windows in a per-desktop binary split tree + floating layer |
| **New Infrastructure** | *(Proposed)* `components/os/{AgentHubWindow,LaunchRecipesWindow,CommandPalette}.tsx` | New **Agent Hub** home desktop app, **Launch Recipes** manager/editor, and `Ctrl+Alt+K` **Command Palette** |

---

## 3. Shell Anatomy Wireframe (`1440×900`)

### 3.1 Inline SVG Wireframe (`1440×900`, Theme-Variable-Only)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" width="100%" height="100%" role="img" aria-labelledby="os-shell-title os-shell-desc" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11" fill="none">
  <title id="os-shell-title">DamHopper OS Shell Anatomy at 1440x900</title>
  <desc id="os-shell-desc">Top bar (40px) with desktop switcher, context selector, workflow ribbon, command palette trigger, and system tray; Left dock (48px) with app launchers and attention badges; Workspace canvas (1392x860) with binary tiled windows and a floating window overlay.</desc>
  <!-- 1. OS TOP BAR (1440 x 40) -->
  <rect x="0.5" y="0.5" width="1439" height="899" stroke="var(--border)" stroke-width="1"/>
  <rect x="1" y="1" width="1438" height="39" fill="var(--surface)" stroke="var(--border)" stroke-width="1"/>
  <text x="14" y="25" fill="var(--accent)" font-weight="700" font-size="12">DH//OS</text>
  <line x1="68" y1="8" x2="68" y2="32" stroke="var(--border)"/>
  <rect x="76" y="7" width="70" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="84" y="24" fill="var(--muted)">1:Hub</text>
  <circle cx="136" cy="20" r="3" fill="var(--warning)"/>
  <rect x="152" y="7" width="112" height="26" rx="3" stroke="var(--accent)" stroke-width="1.5" fill="none"/>
  <text x="160" y="24" fill="var(--fg)" font-weight="600">2:dam-hopper*</text>
  <rect x="244" y="12" width="14" height="15" rx="2" stroke="var(--warning)" fill="none"/>
  <text x="247" y="23" fill="var(--warning)" font-size="9" font-weight="700">!1</text>
  <rect x="270" y="7" width="66" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="278" y="24" fill="var(--muted)">3:core</text>
  <circle cx="326" cy="20" r="3" fill="var(--success)"/>
  <rect x="342" y="7" width="26" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="351" y="24" fill="var(--muted)">+</text>
  <line x1="376" y1="8" x2="376" y2="32" stroke="var(--border)"/>
  <rect x="384" y="7" width="286" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <circle cx="395" cy="20" r="3.5" fill="var(--success)"/>
  <text x="404" y="24" fill="var(--accent)" font-size="10">prod-eu</text>
  <text x="452" y="24" fill="var(--muted)">/</text>
  <text x="462" y="24" fill="var(--fg)" font-weight="600">dam-hopper</text>
  <text x="540" y="24" fill="var(--muted)">:</text>
  <text x="548" y="24" fill="var(--success)" font-size="10">wt:feat-os ▾</text>
  <rect x="678" y="7" width="248" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="688" y="24" fill="var(--accent)" font-size="10">◆ Plan: OS Shell</text>
  <text x="794" y="24" fill="var(--muted)" font-size="10">[3/5 · 18m]</text>
  <text x="872" y="24" fill="var(--fg)" font-size="10">+Note</text>
  <rect x="934" y="7" width="154" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="944" y="24" fill="var(--muted)" font-size="10">⌘ Command...</text>
  <text x="1026" y="24" fill="var(--accent)" font-size="9">^⌥K</text>
  <rect x="1096" y="7" width="128" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="1104" y="19" fill="var(--muted)" font-size="9">CPU 42%</text>
  <rect x="1104" y="23" width="46" height="4" stroke="var(--border)" fill="none"/>
  <rect x="1104" y="23" width="20" height="4" fill="var(--success)"/>
  <text x="1158" y="19" fill="var(--muted)" font-size="9">MEM 78%</text>
  <rect x="1158" y="23" width="46" height="4" stroke="var(--border)" fill="none"/>
  <rect x="1158" y="23" width="36" height="4" fill="var(--warning)"/>
  <circle cx="1214" cy="15" r="3.5" fill="var(--warning)"/>
  <rect x="1230" y="7" width="54" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="1237" y="24" fill="var(--muted)" font-size="10">☾ 24m</text>
  <rect x="1290" y="7" width="44" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="1298" y="24" fill="var(--warning)" font-weight="700" font-size="10">🔔 2</text>
  <rect x="1340" y="7" width="54" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <circle cx="1350" cy="20" r="3.5" fill="var(--success)"/>
  <text x="1358" y="24" fill="var(--fg)" font-size="10">3/3</text>
  <rect x="1400" y="7" width="32" height="26" rx="3" stroke="var(--border)" fill="none"/>
  <text x="1407" y="24" fill="var(--muted)" font-size="10">👁</text>
  <!-- 2. LEFT DOCK / LAUNCHER (48 x 860) -->
  <rect x="1" y="40" width="47" height="859" fill="var(--surface)" stroke="var(--border)" stroke-width="1"/>
  <rect x="6" y="48" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <circle cx="3" cy="66" r="2" fill="var(--fg)"/>
  <text x="14" y="70" fill="var(--fg)" font-size="10">HUB</text>
  <circle cx="38" cy="52" r="5" fill="var(--warning)"/>
  <text x="36" y="55" fill="var(--surface)" font-size="8" font-weight="700">1</text>
  <rect x="6" y="92" width="36" height="36" rx="4" stroke="var(--accent)" stroke-width="1.5" fill="none"/>
  <line x1="2" y1="98" x2="2" y2="122" stroke="var(--accent)" stroke-width="2"/>
  <text x="12" y="114" fill="var(--accent)" font-weight="700" font-size="10">&gt;_</text>
  <circle cx="38" cy="96" r="5" fill="var(--warning)"/>
  <text x="36" y="99" fill="var(--surface)" font-size="8" font-weight="700">1</text>
  <rect x="6" y="136" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <circle cx="3" cy="154" r="2" fill="var(--fg)"/>
  <text x="12" y="158" fill="var(--fg)" font-size="10">DIR</text>
  <rect x="6" y="180" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <circle cx="3" cy="198" r="2" fill="var(--fg)"/>
  <text x="12" y="202" fill="var(--fg)" font-size="10">EDT</text>
  <rect x="6" y="224" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <circle cx="3" cy="242" r="2" fill="var(--fg)"/>
  <text x="12" y="246" fill="var(--fg)" font-size="10">GIT</text>
  <rect x="6" y="268" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="290" fill="var(--muted)" font-size="10">DIF</text>
  <rect x="6" y="312" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="334" fill="var(--muted)" font-size="10">SRC</text>
  <rect x="6" y="356" width="36" height="36" rx="4" stroke="var(--border)" stroke-dasharray="2 2" fill="none"/>
  <circle cx="3" cy="374" r="2" fill="var(--muted)"/>
  <text x="12" y="378" fill="var(--muted)" font-size="10">WEB</text>
  <rect x="6" y="400" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="422" fill="var(--muted)" font-size="10">PRT</text>
  <rect x="6" y="444" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="466" fill="var(--muted)" font-size="10">PLN</text>
  <line x1="10" y1="690" x2="38" y2="690" stroke="var(--border)"/>
  <rect x="6" y="702" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="724" fill="var(--accent)" font-size="10">RCP</text>
  <rect x="6" y="746" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="768" fill="var(--warning)" font-size="10">MON</text>
  <rect x="6" y="790" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="812" fill="var(--muted)" font-size="10">AGT</text>
  <rect x="6" y="834" width="36" height="36" rx="4" stroke="var(--border)" fill="none"/>
  <text x="12" y="856" fill="var(--muted)" font-size="10">CFG</text>
  <!-- 3. DESKTOP WORKSPACE AREA (1392 x 860) -->
  <rect x="52" y="44" width="830" height="852" rx="4" stroke="var(--accent)" stroke-width="1.5" fill="none"/>
  <rect x="52" y="44" width="830" height="28" fill="var(--surface)" stroke="var(--accent)" stroke-width="1"/>
  <text x="62" y="62" fill="var(--fg)" font-weight="700">&gt;_ Terminals</text>
  <rect x="160" y="49" width="210" height="18" rx="2" stroke="var(--border)" fill="none"/>
  <text x="166" y="61" fill="var(--accent)" font-size="10">prod-eu · dam-hopper:feat-os</text>
  <rect x="378" y="49" width="128" height="18" rx="2" stroke="var(--warning)" fill="none"/>
  <text x="384" y="61" fill="var(--warning)" font-size="10">Claude · ! Attention</text>
  <text x="728" y="62" fill="var(--muted)" font-size="10">[↗] [⊟] [⊞] [—] [□] [×]</text>
  <line x1="276" y1="72" x2="276" y2="896" stroke="var(--border)"/>
  <text x="64" y="92" fill="var(--muted)" font-size="10">// AGENTS (3) [Filter: All ▾]</text>
  <rect x="60" y="100" width="208" height="48" rx="2" stroke="var(--warning)" fill="none"/>
  <text x="66" y="116" fill="var(--warning)" font-weight="600" font-size="10">[Claude] dam-hopper #1 · !</text>
  <text x="66" y="132" fill="var(--muted)" font-size="9">prod-eu · Approval needed</text>
  <rect x="60" y="154" width="208" height="44" rx="2" stroke="var(--border)" fill="none"/>
  <text x="66" y="170" fill="var(--success)" font-size="10">[OMP] dam-hopper #2 · Run</text>
  <text x="66" y="186" fill="var(--muted)" font-size="9">prod-eu · Lifecycle stream</text>
  <text x="64" y="222" fill="var(--muted)" font-size="10">// PROJECTS &amp; WORKTREES</text>
  <rect x="60" y="230" width="208" height="58" rx="2" stroke="var(--accent)" fill="none"/>
  <text x="66" y="246" fill="var(--fg)" font-weight="600" font-size="10">● dam-hopper [prod-eu] (2)</text>
  <text x="66" y="262" fill="var(--accent)" font-size="9">⎇ feat/os-shell · wt:feat-os</text>
  <text x="66" y="276" fill="var(--muted)" font-size="9">↳ a91f20c Wireframe shell</text>
  <rect x="277" y="72" width="605" height="26" fill="var(--surface)" stroke="var(--border)"/>
  <text x="286" y="89" fill="var(--fg)" font-size="10">⠿ ● [Claude·!] dam-hopper #1 📌 ×</text>
  <text x="518" y="89" fill="var(--muted)" font-size="10">| ⠿ ● [OMP·Run] dam-hopper #2 ×</text>
  <text x="760" y="89" fill="var(--accent)" font-size="10">[Δ Changes]</text>
  <text x="290" y="124" fill="var(--fg)" font-size="11">$ claude "Refactor SplitLayout into DesktopWindowManager"</text>
  <text x="290" y="146" fill="var(--warning)" font-size="11">? Allow tool execution: bash(pnpm test)? [y/n]</text>
  <line x1="885" y1="44" x2="885" y2="896" stroke="var(--border)" stroke-width="2"/>
  <rect x="888" y="44" width="548" height="380" rx="4" stroke="var(--border)" fill="none"/>
  <rect x="888" y="44" width="548" height="28" fill="var(--surface)" stroke="var(--border)"/>
  <text x="898" y="62" fill="var(--fg)" font-weight="600">DIR Files*</text>
  <text x="974" y="62" fill="var(--muted)">| SRC Search</text>
  <rect x="1068" y="49" width="196" height="18" rx="2" stroke="var(--border)" fill="none"/>
  <text x="1074" y="61" fill="var(--muted)" font-size="10">prod-eu · dam-hopper:feat-os</text>
  <text x="1334" y="62" fill="var(--muted)" font-size="10">[↗] [—] [□] [×]</text>
  <text x="902" y="94" fill="var(--fg)" font-size="10">▾ packages/ui/src/components/</text>
  <text x="918" y="114" fill="var(--accent)" font-size="10">▸ os/ (proposed)</text>
  <text x="918" y="134" fill="var(--fg)" font-size="10">▾ organisms/</text>
  <text x="934" y="154" fill="var(--fg)" font-size="10">  SplitLayout.tsx [M]</text>
  <text x="934" y="174" fill="var(--fg)" font-size="10">  TopNav.tsx [M]</text>
  <line x1="888" y1="427" x2="1436" y2="427" stroke="var(--border)" stroke-width="2"/>
  <rect x="888" y="430" width="548" height="466" rx="4" stroke="var(--border)" fill="none"/>
  <rect x="888" y="430" width="548" height="28" fill="var(--surface)" stroke="var(--border)"/>
  <text x="898" y="448" fill="var(--fg)" font-weight="600">GIT Git*</text>
  <text x="964" y="448" fill="var(--muted)">| DIF Changes (4)</text>
  <rect x="1084" y="435" width="196" height="18" rx="2" stroke="var(--border)" fill="none"/>
  <text x="1090" y="447" fill="var(--muted)" font-size="10">prod-eu · dam-hopper:feat-os</text>
  <text x="1334" y="448" fill="var(--muted)" font-size="10">[↗] [—] [□] [×]</text>
  <text x="902" y="480" fill="var(--success)" font-size="10">* a91f20c (HEAD -&gt; feat/os-shell) Wireframe shell</text>
  <text x="902" y="500" fill="var(--accent)" font-size="10">* 71e04b2 (origin/main) Merge worktree delta</text>
  <text x="902" y="516" fill="var(--muted)" font-size="10">| * 4c82d19 SessionChangesHost tuple fence</text>
  <!-- 4. FLOATING WINDOW LAYER (Z-ORDERED OVERLAY) -->
  <rect x="460" y="536" width="620" height="314" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/>
  <rect x="460" y="536" width="620" height="28" rx="8" fill="var(--surface)" stroke="var(--border)"/>
  <text x="474" y="554" fill="var(--fg)" font-weight="700">EDT Editor — SplitLayout.tsx</text>
  <rect x="678" y="541" width="196" height="18" rx="2" stroke="var(--border)" fill="none"/>
  <text x="684" y="553" fill="var(--accent)" font-size="10">prod-eu · dam-hopper:feat-os</text>
  <text x="942" y="554" fill="var(--accent)" font-size="10">[↙ Snap] [—] [□] [×]</text>
  <text x="476" y="584" fill="var(--muted)" font-size="10">  1 | import { Group, Panel, Separator } from "react-resizable-panels";</text>
  <text x="476" y="604" fill="var(--success)" font-size="10">+ 2 | import type { OsWindowNode } from "@/types/os-layout.js";</text>
  <text x="476" y="624" fill="var(--fg)" font-size="10">  3 | export function SplitLayout({ root, layout }: SplitLayoutProps) {</text>
  <text x="476" y="836" fill="var(--muted)" font-size="9">Ln 2, Col 42 · UTF-8 · TypeScript React · Blame: loidinh (2m ago)</text>
</svg>
```

### 3.2 ASCII Fallback & Spatial Coordinate Budget (`1440×900`)

```text
+----------------------------------------------------------------------------------------------------------------------+
| DH//OS | [1:Hub !] [2:dam-hopper* !1] [3:core ●] [+] | [● prod-eu / dam-hopper : wt:feat-os ▾] | ◆ Plan: OS [3/5]    |
|        | [⌘ Command... ^⌥K]                        | [CPU 42% ████░░ MEM 78% ███████░ ●] [☾ 24m] [🔔 2] [● 3/3] [👁] |
+--------+-------------------------------------------------------------------------------------------------------------+
| [HUB!1]| +-- [>_ Terminals*] [prod-eu · dam-hopper:feat-os] [Claude · !] -------------- [↗][⊟][⊞][—][□][×] --+       |
| [>_ !1]| | // AGENTS (3)          | ⠿ ● [Claude·!] dam-hopper #1 📌 × | ⠿ ● [OMP·Run] #2 ×     [Δ Changes]   |       |
| [DIR]  | | [Claude] #1 · !        |--------------------------------------------------------------------------|       |
| [EDT]  | | [OMP]    #2 · Run      | $ claude "Refactor SplitLayout into DesktopWindowManager"                |       |
| [GIT]  | | // PROJECTS            | ? Allow tool execution: bash(pnpm test)? [y/n]                           |       |
| [DIF]  | | ● dam-hopper [prod-eu] |                                                                          |       |
| [SRC]  | |   ⎇ feat/os-shell      |         +=== [EDT Editor (Floating)] [prod-eu · dam-hopper:feat-os] ===+ |       |
| [WEB.] | |                        |         | 1 | import { Group, Panel } from "react-resizable-panels";   | |       |
| [PRT]  | +------------------------+---------| +2| import type { OsWindowNode } from "@/types/os-layout";   | |       |
| [PLN]  | +-- [DIR Files*] | [SRC Search] [prod-eu · dam-hopper:feat-os] --------------- [↗][—][□][×] --------+       |
| ------ | | ▾ packages/ui/src/components/os/                                                                  |       |
| [RCP]  | +---------------------------------------------------------------------------------------------------+       |
| [MON!] | +-- [GIT Git*] | [DIF Changes (4)] [prod-eu · dam-hopper:feat-os] ------------ [↗][—][□][×] --------+       |
| [AGT]  | | * a91f20c (HEAD -> feat/os-shell) Wireframe shell                                                 |       |
| [CFG]  | +---------------------------------------------------------------------------------------------------+       |
+--------+-------------------------------------------------------------------------------------------------------------+
```

- **Top Bar (`1440×40px`, `--top-nav-height: 2.5rem`):** Fixed top landmark (`z-index: 50`), `.glass-card`, `1px` bottom border.
- **Left Dock (`48×860px`):** Fixed left rail (`z-index: 40`), `var(--color-surface)`, `1px` right border. Top group: workspace apps (`HUB`, `>_`, `DIR`, `EDT`, `GIT`, `DIF`, `SRC`, `WEB`, `PRT`, `PLN`). Bottom group: system/meta apps (`RCP`, `MON`, `AGT`, `CFG`).
- **Desktop Canvas (`1392×860px`):** `4px` outer padding, `4px` gap (`Separator` `w-1`/`h-1` hit area, `1px` visible line) between tiled nodes. Floating layer sits at `z-index: 30..39` above tiled nodes (`z-index: 1..10`) and below popovers/command palette (`z-index: 60`) and `CognitoModeOverlay` (`z-index: 10000`).

---

## 4. Core Desktop, App & Chrome Wireframes

### 4.1 Desktop 1 (HOME): Agent Hub Across Profiles

Agent Hub is the default window on Desktop 1 (`1:Hub`). It aggregates live rows from `useAgentStatusStore` across all connected profiles, ordered strictly by urgency: **`Needs attention` (`blocked`) → `Working` → `Idle` → `Unknown` / `Unavailable`**.

```text
+======================================================================================================================+
| [HUB Agent Hub — Fleet Home] [Fleet: 3/3 Profiles Online]                                        [↗ Float] [□] [×]   |
+----------------------------------------------------------------------------------------------------------------------+
| Filter: [All Profiles ▾] [All Harnesses: OMP | Claude | Codex] [Search agent/project/task...]   [+ Launch Agent ^⌥N] |
| Summary: [! 2 Needs Attention]  [● 4 Working]  [○ 3 Idle]  [? 1 Unknown (Hook Lease Expired)]   [⚡ Recipes (4)]      |
+----------------------------------------------------------------------------------------------------------------------+
| ▼ ! NEEDS ATTENTION (2) — Immediate user approval, question, or error intervention required                          |
| | [Claude] [prod-eu] [dam-hopper] wt:feat-os · "dam-hopper #1"                        ! Needs attention · 01m 12s  | |
| |   Reason: Tool approval (`bash: pnpm test`) · Hook observation · Plan: ◆ OS Shell (3/5)                          | |
| |   Actions: [⏎ Jump to Terminal (Desktop 2)]  [Δ Review Session Changes (6 files)]  [◆ Open Workflow Item]        | |
| | [OMP]    [gpu-lab] [vision-nav] wt:main    · "vision-nav #1"                        ! Needs attention · 04m 05s  | |
| |   Reason: Subagent blocked (`CUDA_VISIBLE_DEVICES`) · Lifecycle · Plan: ◆ CUDA Port (1/4)                        | |
| |   Actions: [⏎ Jump to Terminal (Desktop 3)]  [Δ Review Session Changes (2 files)]  [◆ Open Workflow Item]        | |
|----------------------------------------------------------------------------------------------------------------------|
| ▼ ● WORKING (4) — Active turn or tool execution in progress                                                          |
| | [OMP]    [prod-eu] [dam-hopper] wt:feat-os · "dam-hopper #2"   ● Running (08m 40s) · Lifecycle · [Δ Changes (3)] | |
| | [Codex]  [prod-eu] [dam-hopper] wt:api-v2  · "dam-hopper #3"   ● Running (02m 11s) · Hook (status-only, 15s TTL) | |
|----------------------------------------------------------------------------------------------------------------------|
| ▼ ○ IDLE (3) — Last turn ended; task success has NOT been verified (reuses `outcomeExplanation` contract)            |
| | [OMP]    [local]   [docs-site]  wt:main    · "docs-site #1"    ○ Idle (12m ago) · [⏎ Jump] [Δ Changes (+142/-18)]| |
|----------------------------------------------------------------------------------------------------------------------|
| ▼ ? UNKNOWN / UNAVAILABLE (1) — Quiet reasoning, hook lease >15s expired, or profile disconnected                    |
| | [Codex]  [staging] [auth-svc]   wt:main    · "auth-svc #1"     ? Unknown · Hook lease expired (quiet wait >15s)  | |
+======================================================================================================================+
```

### 4.2 Feature Desktop: Tiled Terminals (60%) + Files & Git (40%) + Floating Editor

Shown in the Section 3.1 SVG (`Desktop 2: dam-hopper*`). Key composition rules:
- **Left Tile (`60%` width): `Terminals` window** hosting `TraditionalTerminalProjectsDisplay` unchanged (`224px` left project/agent navigator with `TraditionalTerminalWorktreeSelect` + `TraditionalProjectGitSummary`, right binary `SplitLayout` with `TabBar`, `AgentStatusBadge`, and `[Δ Changes]` launch button).
- **Right Top Tile (`40%` width, `45%` height): `Files` + `Search` tab group.** Clicking a file opens/focuses the `Editor` window (either tiled or floating per user layout).
- **Right Bottom Tile (`40%` width, `55%` height): `Git` + `Changes` tab group.** Displays `GitLogTree`, `GitBranchControl`, worktree manager, and a `[⚔ Resolve Conflicts (2)]` button that spawns `MergeConflictEditor` as its own window.
- **Floating Overlay: `Editor` window** (`Monaco` + `EditorGitBlameRow` gutter + `EditorStatusBar`) or **`Session Changes` window** (`SessionChangesPanel` + `ReadonlyMonacoDiffViewer` side-by-side diff, converted from modal `SessionChangesHost` into an independent OS window).

### 4.3 System Monitor App (Replaces Dashboard + Host Resources Popover)

Unifies `DashboardPage.tsx` (`OverviewCard`, `SessionRow` with kill, activity stream) and `HostResourcePopover.tsx` (`HostResourceFleetDeck`, `HostResourceGlance`, `HostResourceDiagnosis`, `HostResourceStorageDetails`, `HostResourceIncidentDetails`, `HostIdleSuspendStatus`, `ForceSleepDialog`).

```text
+======================================================================================================================+
| [MON System Monitor] [Fleet: 3/3 Profiles · Inspecting: prod-eu]                                [↗ Float] [□] [×]   |
+----------------------------------------------------------------------------------------------------------------------+
| FLEET OVERVIEW DECK (`HostResourceFleetDeck` — click card to filter drilldown below, or [All Fleet])                 |
| +-----------------------------------+ +-----------------------------------+ +--------------------------------------+ |
| | [● prod-eu]  ONLINE · SSE Live    | | [● gpu-lab]  ONLINE · SSE Live    | | [○ staging]  OFFLINE · Reconnecting  | |
| | CPU 42% | MEM 78% ! | DSK 61%     | | CPU 88% ! | MEM 54% | TMP 79°C    | | Last seen 4m ago · 2 PTYs preserved  | |
| | Projects: 4 (3 clean) · PTYs: 6   | | Projects: 2 (1 dirty) · PTYs: 3   | | [↻ Reconnect] [⚙ Profile Settings]   | |
| +-----------------------------------+ +-----------------------------------+ +--------------------------------------+ |
+---------------------------------------------------------+------------------------------------------------------------+
| HOST TELEMETRY & PRESSURE (`prod-eu`)                   | ACTIVE TERMINAL SESSIONS (9 alive across fleet)            |
| +-----------------------------------------------------+ | Filter: [prod-eu ▾] [All Types ▾]        [Export Diag .zip]|
| | Memory used: 18.7 GiB / 24.0 GiB (78%) [████████░░] | | +--------------------------------------------------------+ |
| |   ↳ Deep total - available · Pressure: ELEVATED     | | | >_ [prod-eu] dam-hopper · claude (#1)    14m ↻0  ● [■] | |
| | CPU usage:   42.0%                     [████░░░░░░] | | | >_ [prod-eu] dam-hopper · omp (#2)       08m ↻0  ● [■] | |
| | Storage (/): 244 GiB / 400 GiB (61%)   [██████░░░░] | | | 🔨 [prod-eu] dam-hopper · pnpm dev       42m ↻1  ● [■] | |
| |   ↳ Pinned mount: [/ ▾] · Overall: 58%              | | | >_ [gpu-lab] vision-nav · omp (#1)       19m ↻0  ● [■] | |
| | Temps & Battery: CPU Die 64°C · NVMe 48°C · AC 100% | | +--------------------------------------------------------+ |
| +-----------------------------------------------------+ | ([■] = Kill PTY session; click row = Jump to Terminal)     |
| MEMORY PRESSURE DIAGNOSIS (`HostResourceDiagnosis`)     +------------------------------------------------------------+
| | Top Consumers: rust-analyzer (2.8G), node (1.9G)    | | IDLE SUSPEND & INCIDENTS (`HostIdleSuspendStatus`)         |
| | Swap: 1.2 GiB / 8.0 GiB · PSI some avg10=4.2%       | | Status: Active inhibitor (2 running agents) · Timeout: 30m |
| | Active Alert: ! High memory utilization (unread)    | | Controls: [☾ Force Sleep Host...]  [⏱ Configure Timing]    |
| | [✓ Mark Alert Read]  [▾ Expand 4 Past Incidents]    | | Recent Event: [prod-eu] [worktree:changed] dam-hopper      |
+=========================================================+============================================================+
```

### 4.4 Launch Recipe Editor (ROS `.launch` Inspired)

Enables capturing the current desktop's window tree + agent commands or authoring a declarative multi-window, multi-agent workspace bootstrap that launches into a new Virtual Desktop.

```text
+======================================================================================================================+
| [RCP Launch Recipes] [Global Recipe Store · 4 Saved Recipes]                                    [↗ Float] [□] [×]   |
+----------------------------------+-----------------------------------------------------------------------------------+
| SAVED RECIPES                    | RECIPE EDITOR: "Full-Stack Feature Sprint"                                        |
| +------------------------------+ | Name: [Full-Stack Feature Sprint        ]  Default Profile: [prod-eu           ▾] |
| | ★ Full-Stack Feature Sprint* | | Default Project: [dam-hopper            ▾]  Worktree Strategy: [Prompt / New ▾]   |
| |   3 Terms · 3 Apps · 2 Splits| +-----------------------------------------------------------------------------------+
| | ◆ Multi-Repo Agent Review    | | STEP 1 — TERMINAL NODES & AGENT HARNESSES (`session` spawns)                      |
| |   2 Profiles · 4 OMP Agents  | | +-------------------------------------------------------------------------------+ |
| | ⚡ Triage & Conflict Fix      | | | #1 | Profile: [prod-eu ▾] | Proj: [dam-hopper] | WT: [feat/*] | Tile: [Left]  | |
| |   1 Claude · Git + Diff      | | |    | Harness: [OMP ▾]     | Cmd: `omp`         | Pin: [✓]                     | |
| | 🖥 Clean Monorepo Dev         | | | #2 | Profile: [prod-eu ▾] | Proj: [dam-hopper] | WT: [feat/*] | Tile: [Left]  | |
| +------------------------------+ | |    | Harness: [Claude ▾]  | Cmd: `claude`      | Pin: [ ]                     | |
| [+ New Blank Recipe]             | | | #3 | Profile: [prod-eu ▾] | Proj: [dam-hopper] | WT: [feat/*] | Tile: [Left]  | |
| [📸 Capture Current Desktop 2]   | |    | Harness: [Shell ▾]   | Cmd: `pnpm dev`    | Pin: [✓]                     | |
| [📥 Import / Export JSON]        | | +-------------------------------------------------------------------------------+ |
|                                  | | [+ Add Terminal Node]                                                           |
| PRE-FLIGHT CHECKS                | | STEP 2 — WINDOW TOPOLOGY & APP BINDINGS (`binary split tree` + `float layer`)     |
| [✓] Profile `prod-eu` online     | | • Root Split: Horizontal `60% / 40%`                                            |
| [✓] Project `dam-hopper` exists  | |   ├─ Left Tile (`60%`):  `Terminals` (hosts #1, #2, #3)                         |
| [✓] `omp` & `claude` qualified   | |   └─ Right Split (`40%`): Vertical `45% / 55%`                                  |
|                                  | |      ├─ Top (`45%`):     Tab Group [`Files*`, `Search`]                         |
|                                  | |      └─ Bottom (`55%`):  Tab Group [`Git*`, `Changes`, `Workflow & Plans`]      |
|                                  | | • Floating Layer: `Editor` (`620×330` at bottom-right, hidden until file click) |
|                                  | +-----------------------------------------------------------------------------------+
|                                  | [💾 Save Recipe]   [🧪 Dry-Run Validate]   [🚀 Launch -> New Desktop (Desktop 4)]  |
+==================================+===================================================================================+
```

### 4.5 Command Palette (`Ctrl+Alt+K` / `DoubleShift`)

```text
                  +==================================================================================+
                  | ⌘ > _                                                        [Esc to close]      |
                  | Modes: `>` Commands  `@` Agents (9)  `#` Windows/Desktops  `/` Files  `!` Launch |
                  +----------------------------------------------------------------------------------+
                  | ! NEEDS ATTENTION                                                                |
                  | ▸ [Claude · !] Jump to dam-hopper #1 (Tool approval)   [prod-eu] [D2]    ^⌥A     |
                  | ▸ [OMP · !]    Jump to vision-nav #1 (Blocked)         [gpu-lab] [D3]            |
                  | -------------------------------------------------------------------------------- |
                  | WINDOW & DESKTOP OPERATIONS                                                      |
                  | ▸ Window: Pop Out / Snap Back Focused Window                             ^⌥F     |
                  | ▸ Window: Split Focused Tile Right (50/50) / Down (50/50)       ^⇧5 / ^⌥\     |
                  | ▸ Window: Open Session Changes Review for Active Terminal                ^⌥D     |
                  | ▸ Launch Recipe: Full-Stack Feature Sprint -> New Desktop                !sprint |
                  +==================================================================================+
```

### 4.6 Window Chrome States (7 Canonical States)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 310" width="100%" height="100%" role="img" aria-labelledby="chrome-states-title" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10" fill="none">
  <title id="chrome-states-title">Seven Canonical Window Chrome States in DamHopper OS</title>
  <rect x="10" y="10" width="380" height="82" rx="3" stroke="var(--border)" stroke-width="1"/>
  <rect x="10" y="10" width="380" height="26" fill="var(--surface)" stroke="var(--border)"/>
  <text x="20" y="27" fill="var(--muted)">DIR Files</text>
  <rect x="92" y="14" width="168" height="17" rx="2" stroke="var(--border)"/>
  <text x="98" y="26" fill="var(--muted)" font-size="9">● prod-eu · dam-hopper:main</text>
  <text x="286" y="27" fill="var(--muted)">[↗] [—] [□] [×]</text>
  <text x="20" y="56" fill="var(--muted)">1. Tiled (Unfocused): 1px --border, muted title</text>
  <rect x="410" y="10" width="380" height="82" rx="3" stroke="var(--accent)" stroke-width="1.5"/>
  <rect x="410" y="10" width="380" height="26" fill="var(--surface)" stroke="var(--accent)"/>
  <line x1="410" y1="36" x2="510" y2="36" stroke="var(--accent)" stroke-width="2"/>
  <text x="420" y="27" fill="var(--fg)" font-weight="700">&gt;_ Terminals*</text>
  <rect x="512" y="14" width="168" height="17" rx="2" stroke="var(--accent)"/>
  <text x="518" y="26" fill="var(--accent)" font-size="9">● prod-eu · dam-hopper:main</text>
  <text x="686" y="27" fill="var(--fg)">[↗] [—] [□] [×]</text>
  <text x="420" y="56" fill="var(--fg)">2. Focused: 1.5px --accent (.border-glow), bold --fg</text>
  <rect x="814" y="14" width="376" height="82" rx="8" stroke="var(--border)" stroke-dasharray="2 2"/>
  <rect x="810" y="10" width="376" height="82" rx="8" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5"/>
  <text x="824" y="27" fill="var(--fg)" font-weight="700">EDT Editor (Float)</text>
  <text x="1062" y="27" fill="var(--accent)">[↙ Snap] [—] [□] [×]</text>
  <text x="824" y="56" fill="var(--fg)">3. Floating: 8px radius, .glass-card-blur, 8-way resize</text>
  <text x="824" y="74" fill="var(--muted)">Clamped to viewport bounds on resize/zoom</text>
  <rect x="10" y="112" width="380" height="82" rx="0" stroke="var(--accent)" stroke-width="1.5"/>
  <rect x="10" y="112" width="380" height="26" fill="var(--surface)" stroke="var(--accent)"/>
  <text x="20" y="129" fill="var(--fg)" font-weight="700">Δ Session Changes [MAXIMIZED]</text>
  <text x="266" y="129" fill="var(--accent)">[↙ Restore ^⌥M] [×]</text>
  <text x="20" y="158" fill="var(--fg)">4. Maximized: Fills 1392x860 canvas; hides split gaps</text>
  <text x="20" y="176" fill="var(--muted)">Underlying tile tree preserved in memory</text>
  <rect x="410" y="112" width="380" height="82" rx="3" stroke="var(--border)" stroke-dasharray="4 2"/>
  <text x="424" y="138" fill="var(--muted)">5. Minimized to Left Dock:</text>
  <rect x="424" y="148" width="44" height="32" rx="4" stroke="var(--accent)"/>
  <text x="434" y="168" fill="var(--fg)">[WEB]</text>
  <rect x="476" y="146" width="300" height="36" rx="3" fill="var(--surface)" stroke="var(--border)"/>
  <text x="484" y="168" fill="var(--fg)">↳ Minimized: Browser (localhost:5173) [Restore]</text>
  <rect x="810" y="112" width="380" height="82" rx="3" stroke="var(--warning)" stroke-width="2"/>
  <rect x="810" y="112" width="380" height="26" fill="var(--surface)" stroke="var(--warning)"/>
  <text x="820" y="129" fill="var(--warning)" font-weight="700">! &gt;_ Terminals — Needs Attention</text>
  <rect x="1038" y="116" width="142" height="17" rx="2" stroke="var(--warning)"/>
  <text x="1044" y="128" fill="var(--warning)" font-size="9">Claude · ! Approval</text>
  <text x="820" y="158" fill="var(--warning)">6. Attention: 2px --warning border (.status-glow-orange)</text>
  <text x="820" y="176" fill="var(--muted)">Clears immediately when terminal receives focus or input</text>
  <rect x="10" y="214" width="1180" height="86" rx="3" stroke="var(--error)" stroke-width="1.5" stroke-dasharray="5 3"/>
  <rect x="10" y="214" width="1180" height="26" fill="var(--surface)" stroke="var(--error)"/>
  <text x="20" y="231" fill="var(--fg)" font-weight="700">GIT Git — dam-hopper</text>
  <rect x="176" y="218" width="250" height="17" rx="2" stroke="var(--error)"/>
  <circle cx="186" cy="226.5" r="3.5" fill="var(--error)"/>
  <text x="194" y="230" fill="var(--error)" font-size="9">staging · OFFLINE (gen #4 disconnected)</text>
  <text x="20" y="262" fill="var(--error)" font-weight="600">7. Disconnected-Profile Banner: Profile "staging" is offline. Mutations &amp; encrypted/diff actions disabled (fail-closed).</text>
  <text x="20" y="282" fill="var(--muted)">Terminal scrollback remains read-only. Never auto-reroutes to another profile.   [↻ Reconnect staging]  [⚙ Connection Diagnostics]</text>
</svg>
```

---

## 5. Interaction Specification

### 5.1 Window Lifecycle & Tiling/Floating Operations

- **Open / Focus:** Clicking a Left Dock icon focuses the existing window on the current desktop; `Shift+Click` or middle-click spawns a new window instance (e.g., a second `Terminals` or `Editor` window scoped to a different profile/project).
- **Pop-Out to Float (`[↗]` / `Ctrl+Alt+F`):** Detaches the window (or active tab from a tiled tab group) into the Floating Layer at centered bounds (`min(720px, 65vw) × min(520px, 65vh)`). The underlying binary split node collapses its empty branch so the sibling panel expands to `100%` of the parent split.
- **Snap Back to Tile (`[↙ Snap]` / `Ctrl+Alt+F`):** Docks a floating window back into its last tiled slot (or splits the currently focused tile `50/50` horizontal if prior slot no longer exists).
- **Maximize (`[□]` / `Ctrl+Alt+M`):** Expands the window to fill the desktop workspace area (`1392×860` at `1440×900`) without destroying the binary split tree. Pressing `Ctrl+Alt+M` or `[↙ Restore]` returns it to its exact tile or float coordinates.
- **Minimize to Dock (`[—]` / `Ctrl+Alt+H`):** Hides the window host (`isViewportVisible={false}` for `BrowserDebugKeepAliveHost`; `cancelScheduledTerminalFit` for xterm) while keeping PTYs and WebSocket subscriptions alive. Displays a dashed pip on the Left Dock icon; clicking the Dock icon restores the window and calls `scheduleTerminalFit`.

### 5.2 Keyboard Map, Conflict Matrix & Input Precedence

#### Event Capture & Terminal Isolation Chain
1. **`useCognitoModeInputGuard` (Root window capture, priority 1):** When Cognito mode is active, consumes all keyboard/pointer/IME events except the exact frozen dismissal chord (`Mod+Alt+KeyB` default).
2. **IME, Dead-Key & AltGr Guard (priority 2):** Any event with `event.isComposing === true`, `event.key === "Dead"`, `event.key === "Process"`, `event.keyCode === 229`, `event.repeat === true`, or `event.getModifierState?.("AltGraph") === true` is ignored by OS shortcut matchers so international layouts and CJK composition never misfire.
3. **Shortcut Capture Bypass (priority 3):** Elements with `data-shortcut-capture="true"` (`SettingsKeyboardShortcutsSection`) receive raw chords while Cognito is inactive.
4. **OS Window Manager & Global Chords (priority 4):** Evaluated in `PaneContainer.attachCustomKeyEventHandler` (returning `false` to prevent xterm consumption) AND at the document level when non-terminal apps are focused.
5. **Terminal Escape Hatch (`Ctrl+Alt+Escape`):** Moves keyboard focus out of the inner xterm `<textarea>` / Monaco editor onto the containing **OS Window Header Frame**, allowing arrow-key window navigation (`ArrowLeft/Right/Up/Down`) or `Enter` to return focus inside the app.

#### Proposed Default Keyboard Map & Existing Binding Coexistence Table

All OS bindings below are **proposed defaults and user-remappable** in `Settings > Keyboard Shortcuts`:

| Action | Proposed Default Chord | Existing `shortcuts.ts` / `PaneContainer` Binding | Conflict & Coexistence Resolution |
| :--- | :--- | :--- | :--- |
| **Command Palette** | `Ctrl+Alt+KeyK` (or `DoubleShift`) | `DOUBLE_SHIFT_SHORTCUT` (`DoubleShift`) | Reuses `DoubleShift` detector + adds `Ctrl+Alt+KeyK` (avoids browser `Ctrl+K` address bar focus and shell `Ctrl+K` kill-line) |
| **Focus Escape to Window Frame** | `Ctrl+Alt+Escape` | None | Safe in browser; escapes xterm/Monaco focus trap without sending `ESC` (`\x1b`) to PTY |
| **Jump to Next Needs-Attention Agent** | `Ctrl+Alt+KeyA` | None | Instantly switches to target Desktop, focuses `Terminals` window, selects tab, and focuses xterm |
| **Cycle Window Focus (Prev / Next)** | `Alt+ArrowLeft` / `Alt+ArrowRight` *(inside pane)*; `Ctrl+Alt+BracketLeft` / `BracketRight` *(OS windows)* | `Alt+ArrowLeft/Right` (`PaneContainer.tsx:189`) | Retains `Alt+Left/Right` for intra-terminal pane cycling; uses `Ctrl+Alt+[` / `]` for OS window cycling |
| **Cycle Tabs in Focused Window** | `Ctrl+Shift+BracketLeft` / `BracketRight` | `Ctrl+Shift+BracketLeft/Right` (`PaneContainer.tsx:232`) | **Reused unchanged** across all tabbed OS windows |
| **Split Focused Tile Right / Down** | `Ctrl+Shift+Digit5` (Right) / `Ctrl+Alt+Backslash` (Down) | `Ctrl+Shift+Digit5` (`PaneContainer.tsx:178`) | **Reused unchanged** for right split (`^⇧5`); adds `Ctrl+Alt+Backslash` (`^⌥\`) for down split |
| **Launch New Agent Terminal** | `Ctrl+Alt+KeyN` | None | Opens new agent terminal prompt in active project/worktree without colliding with browser `Ctrl+N` |
| **Open Session Changes Review** | `Ctrl+Alt+KeyD` | None | Launches/focuses `Session Changes` window for active terminal owner tuple |
| **Pop Out to Float / Snap Back** | `Ctrl+Alt+KeyF` | None | Remappable if host Linux WM binds `Ctrl+Alt+F` |
| **Maximize / Restore · Minimize · Close** | `Ctrl+Alt+KeyM` (Max) / `Ctrl+Alt+KeyH` (Min) / `Ctrl+Alt+KeyW` (Close) | `Mod+Shift+KeyM` (`DEFAULT_FLEET_TERMINAL_SHORTCUT`) | Distinct from `Mod+Shift+KeyM` (`Agent Hub`), terminal `Ctrl+H`, and browser tab close `Ctrl+W` |
| **Switch Virtual Desktop 1..9** | `Ctrl+Alt+Digit1..Digit9` | None | Switches desktop; `Ctrl+Alt+Shift+Digit1..9` moves focused window to Desktop `1..9` |
| **Existing Tool & Zoom Shortcuts** | `Mod+Shift+KeyF` (Search), `Mod+Shift+KeyE` (Files), `Mod+Shift+KeyG` (Git), `Mod+Shift+KeyP` (Ports), `Mod+Shift+KeyZ` (Projects), `Mod+Alt+KeyB` (Cognito), `Ctrl+Alt+Minus` / `Ctrl+Alt+Shift+Equal` (Font Zoom) | Defined in `packages/ui/src/lib/shortcuts.ts` | **Preserved 100% unchanged.** `Ctrl+Alt+Minus` and `Ctrl+Alt+Shift+Equal` remain reserved for terminal font zoom and are never assigned to window minimize/maximize. |

### 5.3 Drag-to-Tile Snap Zones (`TerminalDockPreview` Extended)

Dragging any window header or tab (`@dnd-kit/core` `PointerSensor` with `8px` activation distance) activates drop zones across the desktop:
- **Per-Tile 5-Zone Overlay (reuses `TerminalDockPreview.tsx` geometry):**
  - `edge:top` (`left 24%, right 24%, top 12px, height 18%`): **Split Up** (`50/50` vertical split).
  - `edge:bottom` (`left 24%, right 24%, bottom 12px, height 18%`): **Split Down** (`50/50` vertical split).
  - `edge:left` (`left 12px, top 24%, bottom 24%, width 18%`): **Split Left** (`50/50` horizontal split).
  - `edge:right` (`right 12px, top 24%, bottom 24%, width 18%`): **Split Right** (`50/50` horizontal split).
  - `center` (`left 24%..76%, top 24%..76%`): **Tab-Merge** into target window's tab bar (for compatible window/tab types) or **Swap Tiles**.
- **Root Canvas Edge Strips (`12px` outer perimeter of the `1392×860` workspace):** Dropping on a root edge splits the entire binary tree root (`Left 40%`, `Right 40%`, `Top 40%`, `Bottom 40%`).
- **Drop Outside All Zones (or Hold `Shift` While Dragging):** Places the window in the **Floating Layer** at the pointer drop coordinates.

### 5.4 Attention Flow (End-to-End Fenced Routing)

```text
[Server UDS Hook / Lifecycle]
       │  (Fenced by profileId : connectionGeneration : serverEpoch : terminalId : incarnation : attentionRevision)
       ▼
[AgentStatusBridge] ──► [useAgentStatusStore]
       │  • OMP: turn-ended + needs-attention
       │  • Claude: qualified needs-attention ONLY (approval / question / error; normal turn-ended suppressed)
       │  • Codex: status-only (Working/Idle/Unknown w/ 15s lease expiry; NO attention alerts, NO OSC 9)
       ├────────────────────────────────────────┬────────────────────────────────────────┐
       ▼                                        ▼                                        ▼
[1. Ambient Shell Chrome]              [2. Transient Toast & Bell]              [3. Agent Hub & Window Chrome]
• Left Dock: `!N` warning badge on     • Top-Right `TerminalNotificationToast`  • `Agent Hub` (Desktop 1): row rises to
  `HUB` and `>_` icons                   (max 3, 6s; redacted/hidden under        top of `Needs attention` group
• Top Bar Desktop Pill: `[2:dam* !1]`    Cognito overlay while active)          • Target `Terminals` window border turns
  shows attention on background desktop• Top Bar Bell (`🔔 N`) records 50-item    `var(--color-warning)` (`Attention`)
       └────────────────────────────────────────┴────────────────────────────────────────┘
                                                │
                        User clicks Toast / Hub `[⏎ Jump to Terminal]` / presses `Ctrl+Alt+A`
                                                ▼
       [Switches to Desktop N -> Restores/Focuses `Terminals` Window -> Selects Group & Tab -> Focuses xterm]
```

### 5.5 Context Badge Behavior When Profile Disconnects

Every window header renders an explicit ownership badge. When `getConnectionSnapshot(profileId).status` leaves `"connected"`:
1. **Header Badge Transition:** `ConnectionDot` inside the window's context pill transitions immediately to `connecting` (pulsing yellow) or `disconnected`/`error` (red `var(--color-danger)`), appending `(OFFLINE)` to the `ProfileBadge`.
2. **Fail-Closed Secret & Diff Isolation:**
   - `SessionChangesPanel` immediately cancels in-flight queries, purges its owner query cache, and closes/disables diff inspection (preserving the existing `SessionChangesHost` fail-closed contract).
   - `Encrypt` clears memory-only OPAQUE passphrases and zeroes mutable AES key buffers for `profileId@generation:project` on connection retirement; encrypted file writes fail closed without plaintext fallback.
   - Mutating actions (file save, git commit/push, branch checkout, new terminal spawn) inside windows owned by that profile are disabled.
3. **Read-Only Preservation & Zero Silent Rerouting:** Terminal scrollback in `xterm` and open read-only buffers remain visible so the developer never loses diagnostic output. Windows **never** silently fall back or rebind to another connected profile.
4. **Generation-Fenced Recovery:** When the profile reconnects (`newGeneration`), `AgentStatusBridge` and query clients re-fetch fresh snapshots; the `Disconnected-Profile` banner dismisses automatically once the window's target resource is verified under the new generation.

---

## 6. Responsive Rules (`1024–1279px` vs. `>=1280px`)

| Dimension / Surface | Standard Desktop (`>=1280px`, Primary `1440×900` / `1920×1080`) | Compact Desktop (`1024–1279px`, Min `1024×640`) | Short-Height Compression (`640–767px` height) |
| :--- | :--- | :--- | :--- |
| **Top Bar** | `40px` height; shows Desktop Switcher labels (`1:Hub`, `2:dam-hopper*`), full `[profile/project:wt]`, Workflow Ribbon, Command trigger, CPU+MEM bars | `36px` height; Desktop Switcher shows compact numbers (`[1] [2* !1] [3]`); CPU/MEM bars collapse into single `[⚡ 78% ●]` pill | `34px` height; Workflow Ribbon collapses to `[◆ 3/5]` badge |
| **Left Dock** | `48px` width (`36×36px` icon buttons with `10px` 3-letter code + tooltip) | `44px` width (`44×44px` hit targets per compact accessibility contract, icon-only, hover/focus tooltip) | Dock middle area scrolls vertically (`compact-scroll-region`); bottom system icons pin |
| **Tiling Tree Capacity** | Arbitrary binary splits (`minSize=10%`, minimum tile width `260px`) | **Max 2 columns × 2 rows**; new windows open **Maximized** by default (or tab-merge into active tile) | Max 2 columns × 1 row (side-by-side only); vertical splits auto-tab-merge |
| **Terminals Navigator** | `TraditionalTerminalProjectsNavigator` docked left (`224px` default, resizable `220–520px`) | Collapses into a slide-over drawer (`projectsSheetOpen`) triggered from the `Terminals` window header | Drawer mode with compact `min-h-11` (`44px`) rows |
| **Floating Windows** | Free placement; min size `360×240px`; clamped inside canvas on resize/zoom | Opening a float auto-snaps or centers at `85%×80%` canvas; clamped to `[44px..vw, 36px..vh]` | Auto-maximizes or docks into tab group |

*(Viewports `<1024×640` are out of scope for DamHopper OS tiling and display a single-window maximized fallback notice.)*

---

## 7. Accessibility (`Focus Ring`, `Roles`, `Reduced Motion`)

1. **Focus Rings & Keyboard Navigation:**
   - Focused OS window frame uses `1.5px solid var(--color-primary)` + `.border-glow`.
   - Focused interactive controls inside windows preserve `.workbench-selection:focus-visible` (`outline: 2px solid var(--color-selection-border); outline-offset: -2px`) or `focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]` — never `outline: none` without a replacement ring.
   - `Ctrl+Alt+Escape` moves focus from xterm/Monaco to the Window Header (`tabIndex={0}`), enabling keyboard-only users to move, split, float, minimize, or close windows via toolbar buttons or chords.
   - Split separators (`react-resizable-panels` `<Separator>`) expose `role="separator"`, `aria-label="Resize split pane"`, and keyboard arrow-key resizing (`useResizeHandle` `keyboardResizeEnabled: true`).
2. **ARIA Landmarks, Roles & Live Regions:**
   - **Top Bar:** `<header role="banner" aria-label="DamHopper OS Top Bar">` containing Virtual Desktop Switcher (`role="tablist" aria-label="Virtual desktops"`, each desktop `role="tab" aria-selected`).
   - **Left Dock:** `<nav aria-label="OS Application Dock">`.
   - **Desktop Workspace:** `<main aria-label="Desktop Workspace Canvas">`; each window is `<section role="region" aria-label="{AppName} — {ProfileLabel} {ProjectLabel}">`.
   - **Live Announcements:** A single polite live region (`aria-live="polite"`) announces virtual desktop switches, window tile/float state changes, and `OMP`/`Claude` turn transitions; an assertive live region (`aria-live="assertive"`) announces `Needs attention` blocks and profile disconnections.
   - **Cognito Privacy Isolation:** `CognitoModeOverlay` (`z-index: 10000`) portals to `document.body` **outside** the OS shell wrapper that receives `inert` and `aria-hidden="true"`, keeping the overlay's own focus target accessible while trapping focus. While Cognito is active, transient toasts and live-region announcements suppress/redact project and agent text (or render below `z-index: 10000`) so sensitive workspace identities cannot leak visually or aurally.
3. **Reduced Motion, Transparency & Contrast Requirements:**
   - `@media (prefers-reduced-motion: reduce)`: Disables desktop switch slide transitions, floating window pop-in transforms, `.animate-pulse-slow`, `.animate-glow`, and `.scanline-effect::before`. Status indicators use static high-contrast borders and icons (`!`, `●`, `?`).
   - `@media (prefers-reduced-transparency: reduce)`: `.glass-card`, `.glass-card-blur`, and floating windows replace `backdrop-filter: blur(...)` with solid opaque `var(--color-surface)` (`hsl(217, 33%, 11%)`); `CognitoModeOverlay` `heavy-blur` falls back to opaque `#000000` (existing `index.css:566` contract).
   - **Contrast & Font Requirements:** Primary `#F8FAFC` on `#131B25` (`15.8:1`) and muted `#7689A2` on `#070B13` (`5.4:1`) exceed WCAG 2.1 AA (`>= 4.5:1` text, `>= 3:1` UI chrome); translucent badge tints (`/15`), `.glass-card` surfaces, and `--color-warning` (`#FACC15`) pairings MUST be verified at runtime against WCAG 2.1 AA thresholds. `JetBrains Mono` woff2 bundles render Latin + Vietnamese diacritics with `line-height: 1.5`.

---

## 8. Unresolved UX Questions

1. **Desktop Context Binding Model:** Should switching the Top Bar's `[profile / project : worktree]` selector re-scope *all* repo-bound windows on the current Virtual Desktop (unless a window's context pill is explicitly pinned `[📌]`), or should the Top Bar selector only set the *default context for newly opened windows*?
2. **Terminal Session Ownership Across Multiple `Terminals` Windows:** If a user opens two `Terminals` app windows on the same or different Virtual Desktops, can a single PTY `sessionId` be viewed in only one `Terminals` window at a time (reparenting via `attachTerminalsToHost`), or should each `Terminals` window filter to a distinct `[profileId + project]` group?
3. **Launch Recipe Worktree Provisioning:** When a Launch Recipe specifies a feature worktree that does not yet exist on the target server profile, should launching the recipe automatically invoke the 3-way delta worktree creation flow (`WorktreeAddForm` API) or pause in a pre-flight prompt?
4. **Minimized Window Placement:** Should minimized windows live exclusively as badge pips + hover/click popovers on their Left Dock app icon, or should the bottom of the Left Dock also render individual thumbnail icons for each minimized window instance?
5. **Virtual Desktop Persistence Scope:** Should the Virtual Desktop list and binary tiling layout persist strictly in browser `localStorage` (per client device, like `traditional-terminal-projects-navigator-width`), or sync across devices via the server UI config store (`useUpdateUiConfig`)?
6. **Auto-Float Heuristics:** Should transient utility windows (`Session Changes`, `Conflict Resolver`, `Ports & Tunnels`) open in the **Floating Layer** by default when triggered from a terminal or git action, or split the current tile tree?
