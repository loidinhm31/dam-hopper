# Researcher 02 — Web client (React 19 + Vite + Tailwind v4)

Stack: React 19, Vite 6, TanStack Query 5, existing `WsTransport`. No web tests today. Bundle currently lean — Monaco will dwarf everything else.

## 1. Monaco in Vite

- Use **`@monaco-editor/react`** (~5KB wrapper) over raw `monaco-editor`. Handles loader lifecycle. For offline/self-host override with `loader.config({ monaco })`.
- Vite worker pattern (mandatory, no AMD loader):
```ts
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker  from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker    from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
self.MonacoEnvironment = { getWorker(_, label) {
  if (label === "json") return new JsonWorker();
  if (label === "typescript" || label === "javascript") return new TsWorker();
  return new EditorWorker();
}};
import { loader } from "@monaco-editor/react";
loader.config({ monaco });
```
- **Dynamic import** the editor module from a route-level lazy boundary so terminal-only users skip ~3MB: `const Editor = lazy(() => import("./editor/MonacoHost"))`.
- Only import language workers actually needed. Each is hundreds of KB.
- Add `build.rollupOptions.output.manualChunks` to split `monaco-editor` into its own chunk (HMR + caching).
- Refs: https://github.com/suren-atoyan/monaco-react ; https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md ; https://vite.dev/guide/features.html#web-workers

## 2. Three-pane resizable layout

- **Pick `react-resizable-panels`** (Brian Vaughn, ~9KB). Mature, a11y, touch + keyboard, persistence via `autoSaveId`. Supports nested groups.
- `allotment` = literal VS Code split-view port — heavier (~60KB), opinionated. Skip unless we want exact VS Code feel.
- Hand-rolled grid + pointer events: a11y/touch/keyboard non-trivial. Don't.
- Mobile collapse: `panel.collapsible` + `collapsedSize={0}` + media-query hook calling `panelRef.current?.collapse()` below ~768px.
- Skeleton:
```tsx
<PanelGroup direction="horizontal" autoSaveId="ide-main">
  <Panel defaultSize={18} minSize={10} collapsible><FileTree/></Panel>
  <PanelResizeHandle className="w-px bg-border hover:bg-primary" />
  <Panel>
    <PanelGroup direction="vertical" autoSaveId="ide-center">
      <Panel defaultSize={70}><EditorTabs/></Panel>
      <PanelResizeHandle className="h-px bg-border" />
      <Panel defaultSize={30} collapsible><TerminalPanel/></Panel>
    </PanelGroup>
  </Panel>
</PanelGroup>
```
- Refs: https://github.com/bvaughn/react-resizable-panels

## 3. File tree component

- **Pick `react-arborist`**. Virtualized (react-window), keyboard nav, multi-select, drag-drop, inline rename, controlled tree data, ~30KB. Handles 100k+ nodes.
- `rc-tree`: antd-flavored. `@minoru/react-dnd-treeview`: requires react-dnd (heavy). Custom + react-window: weeks of DnD/keyboard work — YAGNI fail.
- Lazy-load children via `node.children = null` + fetch on `onToggle`.
- Refs: https://github.com/brimdata/react-arborist

## 4. WS subscription state (server-push)

- Existing `WsTransport.onEvent(channel, cb)` already supports push. Need a thin `useFsSubscription` hook + new server-side subscribe/unsubscribe control messages.
- **TanStack Query as cache + WS for invalidation/deltas**. `useQuery` does initial REST snapshot; WS push events apply deltas via `queryClient.setQueryData`. Avoid Zustand for tree.
- New WS messages: `{type:"fs:subscribe", path}`, `{type:"fs:unsubscribe", path}`, push `{type:"fs:event", payload:{kind, path}}`. Add `fsSubscribe()`/`fsUnsubscribe()` methods on `WsTransport`.
```ts
function useFsSubscription(path: string) {
  const qc = useQueryClient();
  const transport = useTransport();
  useEffect(() => {
    transport.fsSubscribe(path);
    const off = transport.onEvent("fs:event", (p: FsEvent) => {
      if (!p.path.startsWith(path)) return;
      qc.setQueryData(["fs-tree", path], (prev) => applyFsDelta(prev, p));
    });
    return () => { off(); transport.fsUnsubscribe(path); };
  }, [path, transport, qc]);
}
```
- `applyFsDelta`: pure, walks immutable tree, splices node by parent path. Refetch full snapshot if delta arrives for unknown parent (drift recovery).
- Refs: https://tkdodo.eu/blog/using-web-sockets-with-react-query

## 5. Editor tab management

- **Hand-rolled with Zustand** (~1KB).
```ts
type Tab = { path: string; original: string; current: string;
             viewState?: monaco.editor.ICodeEditorViewState; };
type Store = {
  tabs: Tab[]; activePath: string | null;
  open(path: string, content: string): void;
  setContent(path: string, content: string): void;
  save(path: string): Promise<void>;
  close(path: string): void;
};
const isDirty = (t: Tab) => t.current !== t.original;
```
- Cmd/Ctrl+S: register on Monaco instance via `editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save(activePath))`. Don't use global keydown — Monaco swallows.
- Close-unsaved confirm: reuse `PassphraseDialog` pattern. Don't use native `confirm()`.
- Persist `viewState` per tab on blur via `editor.saveViewState()`, restore on focus — preserves cursor + scroll across tab switches.

## 6. Chunked / large-file load into Monaco

- Monaco perf cliff: ~5MB / 100k lines. Past ~20MB unusable.
- Strategy via metadata first (`size` in tree node or `HEAD /api/fs/file?path=…`):
  - `< 1MB` → fetch + `editor.setValue(text)`.
  - `1MB ≤ size < 5MB` → fetch + setValue, disable expensive features: `wordWrap:"off"`, `minimap.enabled:false`, `folding:false`, `largeFileOptimizations:true`.
  - `≥ 5MB` → refuse Monaco. Non-Monaco fallback `<pre>` chunked viewer fetching range chunks (`GET /api/fs/file?path=…&offset=0&len=65536`) rendered with `react-window`. Read-only.
- Binary detection on server (NUL bytes in first 8KB); client shows hex preview / "open externally".
- Avoid streaming into Monaco — `setValue` requires full string.
- Refs: https://github.com/microsoft/monaco-editor/issues/1788

## Bundle / file map

- New deps: `@monaco-editor/react`, `monaco-editor`, `react-resizable-panels`, `react-arborist`, `zustand`.
- Wire `manualChunks` in `packages/web/vite.config.ts`.
- Extend `packages/web/src/api/ws-transport.ts` with `fsSubscribe`/`fsUnsubscribe` + `fs:*` channels in `channelToEndpoint`.
- New folders: `packages/web/src/components/ide/` (FileTree, EditorTabs, MonacoHost, LargeFileViewer), `packages/web/src/stores/editor.ts`, `packages/web/src/hooks/useFsSubscription.ts`.

## Unresolved questions

1. Language IntelliSense (TS/JSON workers) or just syntax highlighting? +~1MB bundle.
2. Multi-root workspace — one sub per project vs one per workspace root?
3. Theme: Monaco `vs-dark` vs custom matching Tailwind v4 tokens?
4. Save conflict UX when external modify hits dirty tab — warn + reload-discard?
5. Mobile breakpoint behavior — hide IDE pane entirely?
