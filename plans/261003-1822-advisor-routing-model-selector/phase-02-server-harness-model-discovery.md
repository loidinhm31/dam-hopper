# Phase 02 — Server Harness Model Discovery

## Context Links

- [Plan/preflight](./plan.md); [current progress](./progress.md); [Phase 01 policy rules](./phase-01-server-policy-update.md); [Phase 03 DTO/provider](./phase-03-frontend-transport-data-provider.md).
- [Observed installed CLI contracts](../reports/scout-261003-1822-advisor-routing-model-selector.md#6-installed-harness-cli-help-observations-read-only).
- Primary sources: [Codex app-server initialization/model listing](https://developers.openai.com/codex/app-server#models); [Claude Agent SDK initialization/model info](https://code.claude.com/docs/en/agent-sdk/typescript#sdkcontrolinitializeresponse); [official Claude SDK control framing](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py); [official subprocess launch flags](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py).
- Inspected local producer source: `~/.evcrate/bin/lib/advisor/adapters/{omp,codex,claude,pi}.cjs`, `policy-schema.cjs`, `generated/advisor-contract-runtime.js`. Evidence informs copied contract constants/tests only; do not import sibling checkout or user's executable JS into Dam-Hopper.

## Overview

- Date: 2026-10-03. Priority: P2. Status: complete (implementation settled, reviewed 9.3/10). Effort: 8h.
- Add one authenticated server endpoint and small four-harness adapter service. Prefer dynamic native catalog, return explicit static fallback on unavailable/empty/unsafe/unsupported discovery, always allow custom model input.

## Key Insights

- No `server/src/advisor/models.rs`, existing model catalog, or model endpoint. Create the domain module, not `advisor/state.rs` or a reuse of `AgentKind` (which lacks `pi`).
- Installed help evidence: OMP 18.5.0 has `models` (`ls`, `find`, `refresh`, provider), JSON output; Pi 0.85.1 has offline `--list-models`, locally empty without login; Codex 0.160.0 and Claude Code 2.1.288 have no ordinary model-list command.
- **Do not invent `codex models` or `claude models`.** Codex documents stdio app-server `model/list`; Claude SDK documents `initialize` returning `models`, used by `supportedModels()`. Direct Rust control adapters avoid a new Node worker/SDK dependency.
- CLI help proves command availability only; docs prove protocol design, not installed runtime conformance. No Codex/Claude model control session or OMP catalog listing was exercised during planning. Save versioned synthetic/captured fixtures and qualify installed behavior in Phase 05.
- Installed producer enforces `provider/model` for OMP/Pi and thinking values `off|minimal|low|medium|high|xhigh|max`; OMP CLI's `auto` is not supported by this producer adapter.
- Producer V2 limits model to 256 UTF-8 bytes, effort to 64. Codex producer capability probes use `debug models --bundled`, but this is not established by installed root help; use only after bounded help/version evidence confirms support, otherwise documented app-server route.
- Pi's local docs describe `!command` credential/header values executing shell commands at request time. Listing must never accidentally resolve executable credential expressions or load extensions/hooks.

## Requirements

### Functional

1. `POST /api/advisor/models`, strict body `AdvisorModelsParamsDto { backend }`, accepts only `omp|codex|claude|pi`; unknown backend rejects before subprocess creation.
2. Return `AdvisorModelsResultDto { backend, source, models, efforts, defaultEffort, observedAt, issueCode? }`; models are `{id,label,efforts}`. No raw provider config, costs, credentials, stdout/stderr, auth/account objects, executable paths, or session IDs.
3. Normalize exact runnable model IDs: OMP `selector` or `provider + '/' + id`; Pi provider/model table columns; Codex `model`/slug; Claude `value` (not display label/resolved alias replacement).
4. A nonempty valid dynamic catalog wins; do not combine it with guessed extra models. Unavailable/empty/timed-out/malformed/version-incompatible/unsafe discovery returns server-side fallback and sanitized diagnostic, not a 500 or fake harness success.
5. Static catalogs are **unverified suggestions**, not claims of account access, executable compatibility, or current vendor availability. Custom model input remains available regardless of result.
6. Model-specific efforts where harness reports them; backend effort suggestions for custom models. `defaultEffort` is an explicit UI suggestion (`medium` when no observed default), never a claimed CLI default or silent replacement of current route effort.
7. New routes follow existing auth/admin/enabled guard. Catalog querying does not require the history directory or mutate routing policy/history/settings.

### Bounds / Side Effects

- 16 KiB request body. Closed server-owned program/argv/control frame maps; no model, effort, path, prompt, provider URL, executable, or extra argument accepted from request.
- Five-second whole discovery deadline including handshake/pages/shutdown; stdout aggregate at most 5 MiB, a JSON/table line at most 1 MiB, 500 normalized models, IDs/labels at most 256 UTF-8 bytes, bounded response at most 256 KiB. Policy's independent source/output limit remains 16 KiB.
- At most two concurrent discovery subprocesses per `AdvisorService`; wait time included in deadline. No unbounded queues, resident daemons, periodic refresh, background retry, inference, login, OAuth refresh, or catalog database refresh.
- Neutral private temporary cwd, no project context; locale `C`, `NO_COLOR=1`, bounded stdio. Stdin null for one-shot listings; protocol stdin accepts only fixed initialization/listing frames. Discard stderr safely; never accumulate unlimited `Command::output()`.
- Kill and reap child (and owned process group where needed) on timeout/output limit/cancel/protocol error; drop cleanup cannot leave a live Codex/Claude daemon.

## Architecture

Proposed symbols in new `models.rs`:

- `AdvisorBackend` closed enum, `AdvisorModelsParamsDto`, `AdvisorModelOptionDto`, `AdvisorModelsResultDto` (Serde camelCase).
- `HarnessModelService` with bounded semaphore and captured effective home; `discover_models(backend)`; `fallback_catalog(backend)`; small `parse_omp_models`, `parse_pi_models`, `parse_codex_models`, `parse_claude_models` functions.
- Fakeable `HarnessCommandRunner`/production implementation using the closed-command and bounded-output patterns in `server/src/linux_release/diagnostics/host_commands.rs`. Keep discovery-specific parsing/control sessions local; no broad cross-domain process framework refactor.
- `AdvisorService::list_models` delegates to that service; `models_list_handler` checks enabled then invokes it; register in `advisor_routes`.

### Concrete Discovery Map

| Backend | Fixed command/control | Parse / safe fallback |
|---|---|---|
| `omp` | `omp models ls --json --no-extensions`; append supported no-skills/no-rules flags only after help confirms syntax | Recognize versioned JSON catalog shapes, including `{models:[{provider,id,selector,thinking}]}` used by installed producer. No `models refresh`; validate provider-qualified selectors. Unknown schema -> fallback. |
| `pi` | `pi --offline --list-models --no-extensions` with supported resource-disable flags confirmed by help | Parse header-confirmed provider/model table; ignore separators, diagnostics, ANSI escapes. Exact provider/model join. Empty/no-login output -> fallback. No prompt/auth command; ensure listing does not execute config `!` expressions. |
| `codex` | Preferred documented `codex app-server --listen stdio://`; `initialize` -> matching success -> `initialized` -> `model/list` | Parse `result.data[].model`, `displayName`, `supportedReasoningEfforts[].reasoningEffort`, `defaultReasoningEffort`; bounded cursor pagination, ignore hidden entries. Never `thread/start`, `turn/start`, config writes, or `command/exec`. Feature-detected `codex debug models --bundled` is an allowed simpler read-only variant; not presumed installed. |
| `claude` | `claude --input-format stream-json --output-format stream-json --verbose --setting-sources= --settings '{"disableAllHooks":true}' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools '' --disable-slash-commands --no-session-persistence`; send only initialize control frame | Parse matching `control_response.response.response.models[]`: `value`, `displayName`, optional `supportedEffortLevels`. No `user` message/prompt/inference. Reject unexpected permission/tool requests; terminate. If installed flags/protocol cannot safely isolate initialization, report unsupported/unsafe and fallback. |

Shell-style quoting above illustrates argument values only: production uses literal argv arrays, never a shell string. OMP/Pi unsupported optional isolation flags are detected before launch; required isolation cannot be silently removed.

Codex fixed frames (wait for each response before dependent request):

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"dam_hopper_advisor_models","title":"Advisor model discovery","version":"<application version>"}}}
{"method":"initialized","params":{}}
{"id":2,"method":"model/list","params":{"limit":100,"includeHidden":false}}
```

Claude fixed frame (no user message):

```json
{"type":"control_request","request_id":"advisor-models-init","request":{"subtype":"initialize","hooks":{}}}
```

- Codex parser routes only matching response IDs; Claude parser requires matching request ID and `subtype: success`. Bound irrelevant notifications; never follow executable/tool/control requests from subprocess output.
- Use isolated ephemeral `CODEX_HOME` for catalog-only app-server startup when needed to exclude configured MCP/plugins/hooks. Bundled catalog discovery may differ from authenticated account catalog; label it harness catalog, not an entitlement check. Do not copy/read credentials into browser responses or introduce login/config-write actions.
- Claude excludes user/project setting sources and disables hooks/MCP/tools/session persistence. Validate these flags with installed help and a side-effect sentinel before accepting its dynamic adapter. Managed-policy behavior must not be bypassed; if a policy prevents safe isolation, fallback.

### Explicit Fallback Catalog / Effort Rules

Planned constant suggestions, not exercised availability evidence:

| Backend | Model IDs | Backend effort suggestions |
|---|---|---|
| `codex` | `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh` |
| `claude` | `sonnet`, `opus`, `haiku` | `low`, `medium`, `high`, `xhigh`, `max` |
| `omp` | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `pi` | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

- IDs referenced in primary docs above are example suggestions; aliases/provider catalog versions can change. Keep constants small and server-owned; preserve arbitrary valid custom identifiers instead of continually expanding hardcoded catalogs.
- OMP/Pi write validation uses inspected producer thinking set; do not expose `auto`. Claude suggestions use observed installed help/model-specific metadata. Codex model-specific efforts come from `model/list`; custom/fallback effort suggestions do not assert model availability.
- For a catalog model, expose reported compatible effort levels intersected with producer-supported levels. For custom model, use backend suggestions; persisted effort remains a bounded nonempty producer-compatible string. Do not reject a custom Codex model merely because its model-specific effort catalog cannot be obtained.
- Diagnostic set: `HARNESS_NOT_FOUND`, `HARNESS_CATALOG_EMPTY`, `HARNESS_DISCOVERY_TIMEOUT`, `HARNESS_OUTPUT_LIMIT`, `HARNESS_OUTPUT_INVALID`, `HARNESS_DISCOVERY_FAILED`, `HARNESS_PROTOCOL_UNSUPPORTED`, `HARNESS_DISCOVERY_UNSAFE`, `HARNESS_CATALOG_TRUNCATED`. No raw stderr in messages.

## Related Code Files

| Action | Repository path | Change |
|---|---|---|
| Create | `server/src/advisor/models.rs` | Closed backend map, DTOs, bounded one-shot/control discovery, parsers, fallback constants, unit tests |
| Modify | `server/src/advisor/mod.rs` | Register/export `models`; one owner with Phase 01 |
| Modify | `server/src/advisor/history.rs` | Captured-home model service, async `list_models`; initialize all constructors |
| Modify | `server/src/api/advisor.rs` | `models_list_handler` with enabled guard and exact DTO |
| Modify | `server/src/api/router.rs` | POST `/api/advisor/models`, 16 KiB body layer, existing auth/admin group |
| Modify | `server/tests/advisor_policy_evaluations.rs`, `server/tests/advisor_history_api.rs` | Deterministic fake-runner catalog/auth/disabled/invalid-backend integration |
| Create | `__fixtures__/native-advisor/models/{omp,pi,codex,claude}.*` | Sanitized version-tagged catalog/protocol/table fixtures; no real account data |
| Intentionally unchanged | `server/src/agent_status/types.rs`, `Cargo.toml`, browser SDK/runtime | No `Pi` AgentKind expansion, SDK install, or Node worker; current Tokio/Serde/process dependencies suffice |
| Delete | None | No legacy discovery shim |

## Implementation Steps

1. Record supported local CLI versions/help and primary protocol references in fixture metadata. Establish parsers for complete supported shapes; unknown shapes explicitly fall back. Do not scrape CLI binaries or read credential files to synthesize models.
2. Define phase-shared DTOs and backend parser before any child launch. Unknown/missing backend returns 400; reject unknown/credential-like request fields. Route request capped at 16 KiB.
3. Implement closed argv/control-session runner with bounded semaphore, deadline, stdout framing, no inherited interactive stdin, discarded stderr, neutral cwd, and cleanup. Reuse process patterns from `host_commands.rs`; capture effective home consistently with `AdvisorService`, not process-default user's home by accident.
4. Implement OMP JSON adapter using confirmed list action and isolation flags; no refresh/install/provider extension loading. Normalize selector/provider identity and thinking metadata.
5. Implement Pi offline table adapter. Verify `!` credential/header expressions, extension resource loaders, and login notices cannot cause shell execution or network generation; if safe read-only listing cannot be attested, return `HARNESS_DISCOVERY_UNSAFE` fallback. Do not evaluate or forward expressions.
6. Implement Codex app-server read-only session; handshake and model/list only, cursor cap within aggregate deadline/output/model limits; always close/terminate/reap. Prefer confirmed bundled debug listing if it offers equivalent safe metadata without startup side effects.
7. Implement Claude stream-json initialization-only session based on official SDK framing; disable hooks/config sources/MCP/tools and persistence. Extract only model metadata from initialization; account/auth fields discarded without logging. No `--print <prompt>` workaround or empty user inference request.
8. Normalize/deduplicate by exact ID, filter malformed/control/oversized entries, stable sort by label then ID, enforce response/model caps. If every entry unusable, fallback; truncation has explicit diagnostic. No arbitrary recursion through outputs looking for strings that resemble models.
9. Implement small fallback constants and backend effort rules; dynamic effort metadata enriches UI but does not turn catalog membership into a custom-model admission gate. Clearly distinguish observed default from deliberate medium UI suggestion; preserve existing route effort during editing.
10. Wire service/handler/router and deterministic fakeable construction used only by tests. Do not read history/status availability as a discovery prerequisite. No broad caching layer: request-local results plus card-local owner-bound reuse are enough.
11. Author parser/unit/API/subprocess safety fixtures/tests; parent executes after landing all phases. Add fixture cases for no-login Pi output, malformed protocol, pagination, credential-rich initialization discarded, and child cleanup.

## Todo List

- [x] Four backend enum/DTOs and fixed command/control map.
- [x] Bounded runner with isolation, no-inference framing, child cleanup, concurrency limit.
- [x] OMP JSON, Pi table, Codex model/list, Claude initialization parsers.
- [x] Small fallback catalog/effort contract and sanitized diagnostics.
- [x] Service/API/admin/enabled wiring and deterministic fixtures/tests.

## Success Criteria

- Each backend exercises either an actually parsed native catalog or explicitly labeled fallback; custom entry remains possible. A fake installed catalog proves dynamic path independently for all four adapters.
- Missing binary, empty catalog, unsupported protocol/flags, unsafe config, timeout, malformed/oversized output return deterministic usable fallback; unknown backend rejects without launching anything.
- Catalog labels/IDs/efforts contain only whitelisted bounded metadata. No account/config/credential data leaks from rich initialization responses.
- Test runner observes no prompts, user frames, thread/turn/config mutations, catalog refresh, extension/hooks/MCP tool execution, or surviving child on every termination path.
- Catalog requests honor effective-home/owner boundaries and never alter policy, server config, or history.

## Risk Assessment

- **Harness version drift:** versioned fixtures, schema-specific adapters, explicit unsupported diagnostic and fallback; not guessed CLI subcommands.
- **Startup side effects:** initialization can load configured hooks/MCP/extensions; isolation and sentinel tests are mandatory. Unsafe/version-incompatible harness returns fallback, never removes safety flags to make discovery appear successful.
- **Resource load:** Claude/Codex startup can be heavyweight; short-lived semaphore-bounded children, five-second deadline, no resident pool/background discovery.
- **Entitlement ambiguity/stale suggestions:** label source and fallback; never promise selected model works without execution. Model availability validation/inference is out of scope.
- **Pi executable config values:** offline is not proof against local shell expressions; specifically test discovery-only behavior.

## Security Considerations

- Admin/enabled gating before process creation; fixed program/argv/frames; input backend cannot become executable, path, shell expression, provider URL, or prompt.
- No API credential field support. Harness may use its own ordinary authenticated catalog mechanism; do not serialize credentials/auth account metadata or execute credential helper expressions on behalf of discovery.
- Suppress raw errors/output; subprocess response content is untrusted data. Unexpected protocol requests fail safely; bounded parsing, no arbitrary commands.

## Next Steps

Freeze DTO/effort rules with Phase 01/03; Phase 05 runs `cargo test --manifest-path server/Cargo.toml advisor::models` and authenticated API tests. Live read-only harness qualification must record actual source/result/side effects, not infer success from help or fallback. No discovery/inference session executed by this planner.

## Unresolved Questions

None requiring user input. Installed-version protocol/isolation conformance is an explicit implementation qualification gate with deterministic fallback, not an unresolved product choice.
