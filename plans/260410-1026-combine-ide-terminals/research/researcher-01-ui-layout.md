# UI Layout & Component Structure Research

## IdeShell Template
- 3-panel flexbox: Sidebar → FileTree (resizable) → Right panel (editor top / terminal bottom)
- Props: `{ tree: ReactNode, editor: ReactNode, terminal: ReactNode }`
- Horizontal resize: `useResizeHandle()` hook, storage `devhub:ide-tree-width`, 140-480px, default 240px
- Vertical resize: custom mousedown/mousemove handler, percentage-based (20-85%, default 70%), storage `devhub:ide-editor-height-pct`
- Root: `flex h-screen overflow-hidden gradient-bg`, dragging adds `select-none`

## MultiTerminalDisplay
- Props: `{ activeSessionId, mountedSessions[], onSessionExit?, onNewTerminal? }`
- Renders all mounted sessions as absolute-positioned containers, toggles `display: flex/none`
- Preserves xterm state by keeping DOM mounted; sessions persist server-side on unmount

## TerminalTabBar
- Props: `{ tabs: TabEntry[], activeTab, onSelectTab, onCloseTab, savePrompt?, onSaveTab?, onSavePromptChange?, onSavePromptSubmit?, onSavePromptCancel? }`
- Horizontal scrollable strip with status dot + label + close button
- Inline save prompt below tab strip when `savePrompt !== null`
- TabStatusDot: green (alive), red (error exit), orange (clean exit)

## TerminalDock (IDE-specific)
- Props: `{ project: string, className? }`
- Generates stable session ID via `useRef()`: `ide:shell:{project}`
- Single terminal per project, no tabs — just wraps TerminalPanel

## useResizeHandle Hook
- Interface: `{ min, max, defaultWidth, storageKey? }` → `{ width, handleProps, isDragging }`
- Reads/writes localStorage, clamps on mount, immediate state updates during drag

## Key Integration Insight
- To combine: IdeShell's terminal slot receives TerminalTabBar + MultiTerminalDisplay instead of TerminalDock
- Terminal pane needs `flex flex-col` wrapper: tab bar on top, multi-terminal display fills remaining space
- IdeShell's percentage-based vertical split accommodates this naturally
