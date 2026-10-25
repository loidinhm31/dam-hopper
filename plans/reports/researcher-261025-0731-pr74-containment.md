# PR #74 containment research — TSLS/tsserver trust boundary, plugins, process cleanup

Date 261025 · Scope: external docs only (2 calls), no repo scan · Review-only, no product edits.

## Sources (2 external calls)
- S1 TSLS README @ tag v5.1.3 — https://github.com/typescript-language-server/typescript-language-server/blob/v5.1.3/README.md (executeCommand surface: `typescript.tsserverRequest`, `_typescript.configurePlugin`, `_typescript.applyRefactoring`, `_typescript.applyRenameFile`).
- S2 TSLS `docs/configuration.md` @ master — https://github.com/typescript-language-server/typescript-language-server/blob/master/docs/configuration.md (initializationOptions: `plugins`, `tsserver.path`, `tsserver.fallbackPath`, `logDirectory`, `disableAutomaticTypingAcquisition`, `npmLocation`, `maxTsServerMemory`, `useSyntaxServer`).
- Not fetched (budget): TS `editorServices.ts` plugin probing; Linux man pages (setpgid(2), proc(5), cgroups(7)). Claims from them tagged `[UNVERIFIED-memory]` or `[INFERENCE]`.
- Version caveat: S1 pinned v5.1.3, S2 master. PR pins "TSLS 6.0.2"/TS version per scope brief — not checked against those tags. Treat option names as stable but re-confirm in pinned `node_modules`.

## Key findings

### F1 — Workspace `typescript` is preferred over fallback → workspace code exec (HIGH)
- S2 `fallbackPath`: used "when `tsserver.path` is unspecified/invalid **and the `tsserver` isn't available via the current workspace**". ⇒ resolution order: `tsserver.path` → workspace `node_modules/typescript` → `fallbackPath` → bundled.
- Consequence: if PR does not set `tsserver.path` to a server-owned, existing TS lib, opening a workspace with `node_modules/typescript/lib/tsserver.js` runs that file under Node = arbitrary code exec as dam-hopper uid.
- Also "invalid" path silently falls through to workspace copy → existence check alone at config time insufficient; path must be absolute, outside any workspace root, verified at spawn.

### F2 — Client-controlled init options are an RCE vector (HIGH)
- S2 `plugins`: `{name, location}` → tsserver "will try to import the plugin `name` using Node's `require` API" from `location`. `tsserver.path` likewise selects the executed JS.
- If the browser-side `initialize` (over `/ws/semantic/v1`) is forwarded with `initializationOptions` intact, a web client (or XSS / CSRF-ish cross-origin WS) picks executed code. Invariant: server must construct `initializationOptions` itself; drop/override all client-supplied values (`plugins`, `tsserver.*`, `npmLocation`, `maxTsServerMemory`, `locale`).

### F3 — `workspace/executeCommand` is a raw tsserver tunnel (MED–HIGH)
- S1 `typescript.tsserverRequest` sends arbitrary tsserver command + args; `_typescript.configurePlugin` reconfigures loaded plugins.
- `[INFERENCE]` tsserver protocol includes project/option mutation commands (`openExternalProject`, `compilerOptionsForInferredProjects`, `reloadProjects`, `configurePlugin`); whether any can load new plugin code at runtime is not verified here. Minimum: deny `typescript.tsserverRequest` + `_typescript.configurePlugin`; allowlist LSP methods actually needed for navigation (definition/references/hover/documentSymbol etc.).
- `_typescript.applyRefactoring` / `applyRenameFile` produce `workspace/applyEdit` → write-capable. If PR is "navigation only", block them or ensure server never applies edits to disk.

### F4 — tsconfig `compilerOptions.plugins` (MED, `[UNVERIFIED-memory]`)
- tsserver reads `plugins` from tsconfig; resolves via probe locations = TS install dir (`../../..` of tsserver.js) + `--pluginProbeLocations`; project dir only with `--allowLocalPluginLoads`. Global plugins via `--globalPlugins`.
- Consequence: with server-owned TS (F1) and no `--allowLocalPluginLoads`, a hostile tsconfig naming a plugin should fail to resolve. With workspace TS (F1 violated) the probe root is the workspace `node_modules` → plugin loads. F1 and F4 are coupled.
- Invariant: TSLS `plugins` option empty; no `--allowLocalPluginLoads`; no `pluginProbeLocations` inside workspace. Verify by reading pinned `typescript/lib/tsserver.js` `enablePlugins`/`getGlobalPluginSearchPaths`.

### F5 — Automatic Type Acquisition spawns npm (MED)
- S2 `disableAutomaticTypingAcquisition`, `npmLocation`: ATA fetches `@types` via npm. `[INFERENCE]` = extra child (typingsInstaller) + npm subprocess + network egress + writes to a global cache.
- Invariant: `disableAutomaticTypingAcquisition: true`; never accept `npmLocation` from client. Shrinks process tree (helps reaper) and removes network/npm-lifecycle surface.

### F6 — Log files land inside workspace by default (LOW–MED)
- S2 `logDirectory`: unset ⇒ logs "within the workspace, inside the `.log` directory" (when `logVerbosity` ≠ off).
- Invariant: `logVerbosity: 'off'` or `logDirectory` in server-owned dir. Otherwise: workspace pollution, git noise, and overlay content (unsaved buffers) persisted to disk.

### F7 — tsserver reads beyond workspace root (MED, `[INFERENCE]`)
- Type-checking does not execute workspace code, but module resolution/`/// <reference path>`/tsconfig `extends`/`paths`/`typeRoots` read any file the uid can read. Results (definition targets, hover text, diagnostics) can expose out-of-root paths/content.
- Invariant: response path rewriting to virtual URIs must reject/redact `file://` targets outside allowed roots (not just map in-root ones); test with symlink + `../` + absolute reference.

### F8 — Process group / cgroup / sanitized env = resources & lifecycle, NOT a sandbox (HIGH for claims)
- Process group (`setsid`/`setpgid`, `kill(-pgid)`): cleanup convenience only. Any child can `setsid()`/`setpgid()` to leave the group (Node `spawn({detached:true})` does setsid) `[UNVERIFIED-memory]`; double-fork escapes. No FS, network, or syscall restriction.
- cgroup v2: resource limits (`memory.max`, `pids.max`, `cpu.max`) + robust whole-tree kill (`cgroup.kill`, kernel ≥5.14) `[UNVERIFIED-memory]`. Cannot be escaped by setsid, but still zero FS/network isolation. Needs delegated subtree (e.g. systemd user scope) — unprivileged service may lack it.
- Sanitized env: prevents secret inheritance via `process.env`, but same-uid code can read `/proc/<ppid>/environ` of the dam-hopper server and any `~/.ssh`, `~/.config`, tokens on disk `[INFERENCE]`. Hygiene, not containment.
- Actual containment (if ever required): separate uid, bubblewrap/user+mount+net namespaces, Landlock, seccomp, systemd `ProtectHome=`/`PrivateNetwork=`. None implied by "process group reaper".
- Review invariant: docs/PR text must not call PG/cgroup/env scrub a "sandbox"; trust model = "enabling semantic nav on a workspace ≙ running Node in that workspace as server uid", gated by default-OFF admin toggle + reauth.

### F9 — Process-tree cleanup specifics (MED)
- `[INFERENCE]` tree = Node(TSLS) → tsserver semantic + tsserver syntax (`useSyntaxServer: 'auto'`, S2) → typingsInstaller (if ATA on) → npm. TSLS forks tsserver; whether TSLS passes `detached` is unverified.
- Two-stage reaper (SIGTERM pgid → grace → SIGKILL pgid) is correct only if: (a) leader created with new session/pgid before exec; (b) pgid recorded, not re-read from a possibly-dead pid; (c) kill sent even if leader already exited (orphans keep pgid); (d) wait/reap leader to avoid zombie; (e) server crash path — `PR_SET_PDEATHSIG` on leader only covers direct child; grandchildren survive server SIGKILL unless cgroup used.
- `maxTsServerMemory` (S2) = V8 old-space per tsserver, not RSS cap; ×2 with syntax server. Real cap needs cgroup `memory.max` or rlimit.

## Concrete review invariants (checklist)
1. `tsserver.path` (or TS lib dir) set server-side, absolute, outside every workspace root; spawn fails closed if missing — never falls back to workspace TS. (F1)
2. `initializationOptions` fully server-built; client `initialize` params for `plugins`/`tsserver`/`npmLocation`/`maxTsServerMemory` stripped. (F2)
3. LSP method allowlist at WS proxy; `workspace/executeCommand` denied or allowlisted excluding `typescript.tsserverRequest`, `_typescript.configurePlugin`; edit-producing commands blocked if nav-only. (F3)
4. No `--allowLocalPluginLoads`, no workspace-local `pluginProbeLocations`/`globalPlugins`; `plugins: []`. (F4)
5. `disableAutomaticTypingAcquisition: true`. (F5)
6. tsserver logging off or redirected out of workspace. (F6)
7. Outbound URIs: out-of-root targets dropped/redacted; symlink + `..` cases tested. (F7)
8. Docs/threat model label PG/cgroup/env as resource+lifecycle controls; no "sandbox" wording; untrusted-workspace usage explicitly unsupported. (F8)
9. Reaper kills by stored pgid after leader exit; covers server-crash orphan case or documents it; syntax server + typingsInstaller accounted for. (F9)
10. Memory cap claims distinguish `--max-old-space-size` from RSS/cgroup limits. (F9)

## Severity summary
- Blockers if violated: 1, 2, 3 (each = RCE or arbitrary tsserver control from browser client).
- Should-fix: 4, 5, 7, 8. Nice: 6, 9, 10.

## Validation status
- Two external sources read; F1/F2/F3/F5/F6 directly supported by S1/S2 text. F4/F8/F9 parts from memory, tagged. No repo files inspected (per scope); whether PR satisfies invariants is for ReviewScope/Main to check.

## Unresolved questions
1. Exact TSLS + TS versions pinned by PR — does TSLS 6.0.2 (if that is the TSLS version) keep the S2 resolution order (`path` → workspace → `fallbackPath`)?
2. Does pinned tsserver `enablePlugins` probe only TS-install dir without `--allowLocalPluginLoads` (F4)? Needs read of pinned `tsserver.js`.
3. Can any tsserver protocol command reachable via `tsserverRequest` load plugin code at runtime?
4. Does TSLS fork tsserver with `detached`/new pgid (would break pgid reaper)?
5. Is cgroup v2 delegation available in the target deploy (systemd user vs system service)?
