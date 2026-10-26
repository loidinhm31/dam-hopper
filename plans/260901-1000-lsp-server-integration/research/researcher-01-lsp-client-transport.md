# Research Report: Monaco LSP client and WebSocket transport

**Research date:** 2026-09-01  
**Scope:** source/API maturity and integration cost for the accepted filtered standard-LSP WebSocket (Rust TSLS child, Definition + Implementation MVP). No implementation.

**Historical input; conflicting decisions SUPERSEDED 2026-10-23.** Use the [current Validation Summary](../plan.md#validation-summary) and [Phase 01 STOP/GO gates](../phase-01-protocol-dependency-real-process-spike.md). Native/Tauri blocking proof, `/lsp/ws`, host-command opt-in and inferred package compatibility below are not current instructions. Canonical route is `/ws/semantic/v1`; exact pins, one-kind adaptive sync, source/destination freshness and stable model/provider behavior remain unproven gates.

## Executive summary

Use a **narrow in-house Monaco provider/adapter, backed by `vscode-ws-jsonrpc` (and its `vscode-jsonrpc` dependency)** for MVP. Keep the full TypeFox `monaco-languageclient` and Microsoft alpha client out of the production path. The small TypeFox transport package supplies battle-tested WebSocket JSON-RPC framing; our adapter owns the deliberately narrow provider surface, auth, URI policy, model lifecycle, reconnect/replay, and server filtering. This avoids importing TypeFox's VS Code-in-browser service graph while avoiding a hand-rolled JSON-RPC parser.

The accepted design already requires a dedicated authenticated WS and a filtered standard LSP contract. A short browser+Tauri spike is still a gate before committing: prove one canonical target-root URI through initialize → didOpen/didChange → definition/implementation → reconnect/replay, and prove bundle/dependency deltas. If the gate fails, adopt `vscode-ws-jsonrpc` transport unchanged and fix the adapter; do not silently widen to all LSP features.

## Repository fit (source-verified)

- UI already owns `monaco-editor` 0.55.1 + `@monaco-editor/react` 4.7.0 and lazy-loads `MonacoHost`; workers are configured once in `packages/ui/src/lib/monaco-setup.ts` ([package manifest](../../../packages/ui/package.json#L18-L45), [host](../../../packages/ui/src/components/organisms/MonacoHost.tsx#L1-L15), [workers](../../../packages/ui/src/lib/monaco-setup.ts#L1-L20)).
- `MonacoHost` currently passes `value`/`language`, but no stable URI/model to the editor ([MonacoHost](../../../packages/ui/src/components/organisms/MonacoHost.tsx#L288-L316)); LSP integration must introduce a canonical model registry or prove `@monaco-editor/react` `path` yields the same URI sent to TSLS.
- Tabs have immutable project/worktree target, relative path, decoded content, mtime, and request generations ([editor store](../../../packages/ui/src/stores/editor.ts#L115-L195)); this is enough state to track/replay open documents, but URI resolution must not expose absolute paths or cross target roots.
- Existing `/ws` is a `kind`-tagged terminal/FS protocol, not LSP; it puts bearer tokens in the query string and reconnects 1s→30s, rejecting pending work on close ([client](../../../packages/ui/src/api/ws-transport.ts#L1-L12), [connection](../../../packages/ui/src/api/ws-transport.ts#L1433-L1593), [close](../../../packages/ui/src/api/ws-transport.ts#L2043-L2075)). Use a separate `/lsp/ws` route/state machine, not a multiplexed `kind` envelope.
- Server `/ws` currently authenticates query token or cookie and checks Origin ([route](../../../server/src/api/ws.rs#L130-L186)); duplicate this policy for the dedicated route, retaining current auth and exact origin allowlist.

## Candidate findings

### Microsoft `@vscode/monaco-lsp-client`

- **Maturity:** repository README explicitly says alpha/many bugs; package is `0.1.0`, a local `monaco-editor` package with no verified public npm release. It has a peer on `monaco-editor-core` and three `@hediet/json-rpc*` dependencies ([manifest](https://raw.githubusercontent.com/microsoft/monaco-editor/main/monaco-lsp-client/package.json), [README](https://raw.githubusercontent.com/microsoft/monaco-editor/main/monaco-lsp-client/README.md)).
- **API/protocol:** `MonacoLspClient(transport)` immediately starts listening and privately starts `initialize`; initialize currently sends `rootUri: null`, then `initialized`. `createFeatures()` registers Definition, Implementation, and many other features by default ([source](https://raw.githubusercontent.com/microsoft/monaco-editor/main/monaco-lsp-client/src/adapters/LspClient.ts)). A subclass could narrow `createFeatures`, but there is no public readiness/dispose/reconnect API in this source.
- **Model/URI:** `TextDocumentSynchronizer` watches Monaco's global models, lowercases `model.uri.toString(true)`, emits full incremental LSP changes, and maps 0-based LSP positions to 1-based Monaco positions ([source](https://raw.githubusercontent.com/microsoft/monaco-editor/main/monaco-lsp-client/src/adapters/TextDocumentSynchronizer.ts)). This is useful mapping code but couples us to one Monaco core instance and its model URI.
- **Transport:** exported `WebSocketTransport` has `fromWebSocket`, `connectTo`, `close`, and `dispose`, but no reconnect/replay ([types](https://unpkg.com/@hediet/json-rpc-websocket@0.5.1/dist%2Findex.d.ts)); browser package also includes `isomorphic-ws` ([manifest](https://unpkg.com/@hediet/json-rpc-websocket@0.5.1/package.json)).
- **Cost/risk:** potentially small runtime, but high lifecycle risk (alpha, hidden init promise, null root URI, no session replay, core peer mismatch with current `monaco-editor`). Use only as a time-boxed experiment, not MVP dependency.

### TypeFox `monaco-languageclient` + `vscode-ws-jsonrpc`

- **Maturity:** stable published versions are `monaco-languageclient` 10.7.0 and `vscode-ws-jsonrpc` 3.5.0; current main is an unreleased `11.0.0-next.2` / `4.0.0-next.2` line. Stable engines require Node >=20.10/npm >=10.2.3; main requires Node >=22/npm >=10 ([stable client manifest](https://unpkg.com/monaco-languageclient@10.7.0/package.json), [stable transport manifest](https://unpkg.com/vscode-ws-jsonrpc@3.5.0/package.json), [main client manifest](https://raw.githubusercontent.com/TypeFox/monaco-languageclient/main/packages/client/package.json)).
- **API/protocol:** `LanguageClientWrapper` supports `WebSocketDirect`, `WebSocketParams`, and `WebSocketUrl`; creates `WebSocketMessageReader/Writer`, starts/stops a `MonacoLanguageClient`, and has explicit dispose/restart hooks ([connection types](https://raw.githubusercontent.com/TypeFox/monaco-languageclient/main/packages/client/src/common/commonTypes.ts), [wrapper](https://raw.githubusercontent.com/TypeFox/monaco-languageclient/main/packages/client/src/wrapper/lcwrapper.ts)). `vscode-ws-jsonrpc` itself is a clean browser `listen({webSocket,onConnection})` adapter ([README](https://raw.githubusercontent.com/TypeFox/monaco-languageclient/main/packages/vscode-ws-jsonrpc/README.md)).
- **Model/URI:** wrapper's normal path assumes the Monaco VS Code API/editor services and `LanguageClientOptions`; it is not a drop-in provider for this app's existing `@monaco-editor/react` host. `WebSocketUrl` creates one socket per start; network reconnect/reopen/replay remains application policy.
- **Weight/compatibility:** 10.7.0 declares 30+ `@codingame/monaco-vscode-*` runtime dependencies, language packs, `vscode-languageclient`, protocol types, and `vscode-ws-jsonrpc` ([manifest](https://unpkg.com/monaco-languageclient@10.7.0/package.json)). This is a large VS Code-in-browser service graph and likely duplicates/competes with the existing Monaco singleton/workers. Vite ESM can bundle it; Tauri WebView has the same browser WebSocket API, but CSP/TLS and query-token checks must be proved. `vscode-ws-jsonrpc` alone is small (runtime dependency only `vscode-jsonrpc` in 3.5.0).
- **Cost/risk:** lowest protocol coding if we accept its VS Code bootstrap; highest dependency/bundle and lifecycle coupling. Prefer transport-only, not full `monaco-languageclient`, for this bounded MVP.

### Narrow in-house provider + JSON-RPC adapter

- Register only `monaco.languages.registerDefinitionProvider` and `registerImplementationProvider`; translate the cursor to LSP 0-based position and map `Location`/`LocationLink` responses to Monaco locations. The standard methods are `textDocument/definition` and `textDocument/implementation` ([LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)).
- Keep a session object for initialize/initialized, tracked models, monotonically increasing request IDs, cancellation, pending requests, and disposal. On every reconnect: create a new connection, reinitialize with the same target root, replay full `didOpen` text for tracked models, then permit navigation; fail/drop requests from the old generation.
- Use a stable URI mapping `{profile, project, worktree, relativePath}` → canonical `file:` URI under the server-approved target root. Recheck every returned URI/range client-side; refuse external roots and never navigate to a URI from another target. Opening a result not currently modeled requires existing `fsRead`/editor-store load, then selection/reveal.
- **Cost:** medium one-time adapter/provider work and permanent ownership of reconnect, mapping, cancellation, and contract tests; low runtime weight and no VS Code service graph. `vscode-ws-jsonrpc`/`vscode-jsonrpc` keeps wire correctness out of custom code.

## Compatibility and decision gate (exact checks)

1. **Browser + Tauri:** Vite web and native Tauri WebView both connect to dedicated `/lsp/ws` using current auth query-token fallback; verify allowed Origin, CSP, TLS, close/error events, and no token in logs. Test Windows/native URL selection and same-origin behavior against `server-config.ts` ([URL policy](../../../packages/ui/src/api/server-config.ts#L89-L117)).
2. **Model identity:** create one Monaco model for an open tab and assert `model.uri`, language ID, version, and content map exactly to TSLS `didOpen`; edit once and assert range/version conversion; close and assert `didClose`. Test lowercase/percent-encoded URI edge cases.
3. **Handshake/root:** capture initialize payload and assert only accepted client capabilities plus non-null target-root `rootUri`/`workspaceFolders`; server rejects a path outside root. Then assert `initialized` precedes any document notification.
4. **Navigation:** TSLS fixture returns one in-root `Location` and one `LocationLink`; Definition and Implementation providers place correct 1-based selection. External/other-root result is dropped; unopened in-root result loads through the existing editor store.
5. **Reconnect/replay:** force close during a request and after edits; assert bounded backoff, old promises settle, fresh initialize, full replay of every tracked model, no duplicate providers/models, and navigation works after replay.
6. **Weight/maintenance:** compare Vite production chunk/dependency tree for (a) in-house + transport, (b) full TypeFox stable, (c) Microsoft source package; pin selected versions in pnpm lockfile and audit transitive MIT licenses. Keep Monaco lazy boundary intact.

## Recommendation

Ship the narrow in-house provider/session with **exactly pinned** `vscode-ws-jsonrpc@3.5.0` (or the compatible pinned `vscode-jsonrpc` version it resolves) as transport-only. Do not import `monaco-languageclient` 10/11 into the editor host. Do not ship Microsoft `0.1.0` alpha. The adapter's feature allowlist must remain Definition + Implementation, while server filtering remains authoritative; global toggle controls whether the dedicated session exists, and the pinned TSLS default/current auth/root containment/unsafe browser-command opt-in remain unchanged.

## Sources

Primary sources: Microsoft package manifest/README and `LspClient.ts`/`TextDocumentSynchronizer.ts`; TypeFox stable/main manifests, wrapper/common types, and `vscode-ws-jsonrpc` README; official LSP 3.17 specification. Local sources are linked above with line anchors.

## Unresolved questions

- Exact TSLS URI/root contract: canonical `file:` URI shape, case sensitivity, and whether workspace indexing needs unopened-file `didOpen`.
- Does the Rust dedicated route accept only query tokens (browser constraint) or also cookie auth, and what exact origin/CSP rules apply in each Tauri target?
- Should target switching dispose the session or support multiple target sessions; how is a stale navigation result identified across target generations?
- Which pinned `vscode-jsonrpc`/`vscode-ws-jsonrpc` pair is approved after the spike's bundle and license measurements?
