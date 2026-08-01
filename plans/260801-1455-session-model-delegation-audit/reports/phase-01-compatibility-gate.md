# Phase 01 Compatibility Gate

Date: 2026-08-01  
Codex version: `codex-cli 0.146.0`  
Decision: **FAIL — use flat OTel-only rows with `lineage_unavailable`**

## Failed invariant

A separate stdio app-server can enumerate the concurrently active standalone CLI session, but `thread/list` always returns content-bearing fields. The generated 0.146.0 schema has no response projection or `includeTurns` parameter and requires `cwd`, `preview`, and `turns` on every thread object; `path` is also exposed. Therefore a read-only adapter cannot satisfy the requirement that preview/path/turn content never crosses its input boundary.

The probe stopped at this first required failure. It did not create child sessions, inspect rollouts, call turn/item endpoints, persist raw responses, or attempt an OTel identity join. Under the plan's hard-gate rule, missing downstream evidence cannot be interpreted as a pass.

## Evidence matrix

| Invariant | Result | Evidence |
|---|---|---|
| Exact CLI version | PASS | `$CODEX_BIN --version` returned `codex-cli 0.146.0` |
| Separate app-server sees standalone CLI | MANUAL PASS | One bounded stdio observation initialized and listed the active CLI thread; not automated because retaining a response would cross the failed boundary |
| Prompt-free list boundary | FAIL | `ThreadListResponse` requires `preview`, `cwd`, and `turns`; optional `path` is present |
| Explicit root/child edges | NOT RUN | Stopped after required privacy failure |
| OTel identity mapping | NOT RUN | Stopped after required privacy failure |
| Child token/replay semantics | NOT RUN | Stopped after required privacy failure |
| Resume/fork/compaction | NOT RUN | Stopped after required privacy failure |

## Reproduction

```bash
CODEX_BIN=${CODEX_BIN:-codex}
"$CODEX_BIN" --version
schema_dir=$(mktemp -d)
"$CODEX_BIN" app-server generate-json-schema --experimental --out "$schema_dir"
jq '.properties | keys' "$schema_dir/v2/ThreadListParams.json"
jq '.. | objects | select(.properties?.preview?) | {required, properties: (.properties | keys)}' "$schema_dir/v2/ThreadListResponse.json"
cargo test --manifest-path server/Cargo.toml --test codex_app_server_compatibility -- --ignored
```

## Pinned sanitized artifacts

- `ThreadListParams.json`: `ccc09fa6d5d89fa76afd474f6d7ef8cf14edbe0e037d8a52aebf5bd14f435c5b`
- `ThreadListResponse.json`: `0c12f87cf3ab2c5fed95152a1e36873e6e56dadae39f46096267371ad65d1321`
- `ThreadReadParams.json`: `db97080f82facc3259dbb9404e9f0df81e360619f4cd73983a9d99d25f5089ee`

Only a hand-authored contract summary and provenance are retained. They contain no raw provider IDs, markers, session paths, cwd values, prompts, responses, titles, commands, environment values, or tool content. The combined schema bundle is not checksum-pinned because its serialization order changes across generations; the three relevant individual schemas are stable and mechanically verified by the ignored probe.

The planned matching OTLP delegation fixture was intentionally not created: the first mandatory privacy invariant failed before any child or OTLP capture. Creating a synthetic or unmatched binary would misrepresent unavailable evidence.

## Consequence

- Phase 03 exact metadata adapter is not applicable for Codex 0.146.0.
- Phase 02 may proceed only for opt-in correlation/model types needed by flat OTel summaries.
- Phases 04-07 must expose flat OTel model/token rows with `lineage_unavailable` and must not create or infer parent edges.
- Re-open exact lineage only if a later pinned app-server contract adds a metadata-only projection that excludes preview, cwd, path, turns, and items before transport.

## Unresolved questions

- None for the 0.146.0 binary decision. A future version requires a new compatibility gate.
