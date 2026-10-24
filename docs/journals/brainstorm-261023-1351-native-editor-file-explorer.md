# Native editor and file explorer — approved design

- **Problem/outcome:** The active Android project host exposes login, projects, and terminal; retained Files/Editor modules are unreachable, and the visible editor is a basic Compose `TextField`. The approved outcome is a reachable native Terminal / Files / Editor workspace.
- **Key decisions:** Reuse the current terminal and native feature modules; use a native Sora `CodeEditor` with one document/undo authority; provide a lazy file tree and remote file CRUD/move/copy. Do not mount the dormant 12-panel workbench or embed a WebView.
- **Safety design:** Include scoped tabs, conditional saves and dirty-state resolution, plus necessary lifecycle, ownership/incarnation, watcher, mutation, and save-race corrections. Encryption requests fail closed; no new encryption system or server policy.
- **Trade-offs/exclusions:** Transfers, global search, Git tools, rich previews, TypeScript semantics, and durable offline drafts are outside this increment, not removed from the broader release contract.
- **Design status:** **Approved** by explicit user choice. See the [approved design report](../../plans/reports/brainstorm-261023-1351-native-editor-file-explorer.md); this entry summarizes rather than duplicates it.
- **Planning:** The user explicitly chose **Defer planning**. The router was not invoked; no new plan was created (actual plan path: none).
- **Risks and next step:** Verify exact Sora dependency/version, IME and performance behavior, and LGPL compliance as implementation/release gates. Process-death draft recovery is excluded. Keep the approved design and await a later explicit implementation-planning request; no implementation is authorized here.
