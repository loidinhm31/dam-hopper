# Diagnostic Report: Codex CLI Unrecognized Hook Schema in ~/.codex/hooks.json

- **Report ID**: `debugger-261001-2031-codex-hook-schema-unrecognized`
- **Target**: Codex CLI hook integration for `dam-hopper` in `~/.codex/hooks.json`
- **Date**: 2026-10-01
- **Status**: Completed (Investigation & Root Cause Diagnosis)

---

## 1. Executive Summary

### Issue Description & Business Impact
When users inspect registered hooks in Codex CLI via the interactive `/hooks` command, the DamHopper agent status integration (`dam-hopper-agent-status`) does not appear in the hook inventory.
However, DamHopper's CLI (`dam-hopper integration status codex`) reports:
```json
{
  "status": "Current",
  "readiness": "TrustRequired"
}
```
This misleads users into expecting an approval prompt in Codex TUI that never appears. As a consequence:
1. Codex CLI never invokes `dam-hopper-agent-status`.
2. Agent status telemetry (turns, tool use, idle/active transitions) for Codex sessions is completely uncollected.
3. Users cannot review, trust, or enable the hook via `/hooks` because Codex CLI discards it during startup discovery.

### Root Cause
A fundamental AST / schema mismatch between Codex CLI's deserializer and DamHopper's config serializer:
- **Codex CLI Expected Schema**: Each event in `hooks.json` or `config.toml` maps to an array of **Matcher Groups** (`MatcherGroup`). Each matcher group contains an optional `"matcher"` regex/glob and a required `"hooks"` array of **Hook Handlers** (`HookHandlerConfig`). Each handler is an internally-tagged enum requiring `"type": "command"` along with `"command": "..."`.
- **DamHopper Output**: `server/src/agent_status/codex_integration.rs` naively appends `{ "command": "/path/to/launcher" }` directly to the event array, omitting both the `"hooks"` wrapper array and the `"type": "command"` tag.
- **Deserialization Failure**: During startup discovery (`hooks/src/engine/discovery.rs`), Serde fails to deserialize `{ "command": "..." }` into `MatcherGroup` due to the missing required field `"hooks"`. The invalid group is discarded, leaving the hook unindexed and invisible to `hooks/list`.

---

## 2. Technical Analysis & Findings

### 2.1 File & Schema Comparison (`~/.codex/hooks.json`)

Pre-existing user hooks in `~/.codex/hooks.json` demonstrate Codex's actual schema:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "sh /home/loidinh/.codex/hooks/run-node-hook.sh /home/loidinh/.codex/hooks/session-start.cjs"
          }
        ]
      },
      {
        "command": "/home/loidinh/.codex/hooks/dam-hopper-agent-status"
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh /home/loidinh/.codex/hooks/run-node-hook.sh /home/loidinh/.codex/hooks/user-prompt-submit.cjs"
          }
        ]
      },
      {
        "command": "/home/loidinh/.codex/hooks/dam-hopper-agent-status"
      }
    ]
  }
}
```

- **User Hooks**: Correct two-level hierarchy (`event -> [ MatcherGroup { hooks: [ Handler { type, command } ] } ]`).
- **DamHopper Hooks**: Flat `{ "command": "..." }` pushed directly into the `MatcherGroup` list.

### 2.2 Codex CLI Binary Reverse-Engineering (v0.159.3)

Static binary inspection and protocol schema generation from `/home/loidinh/.local/bin/codex` (via `codex app-server generate-json-schema`) revealed the Rust types:

1. **Matcher Group Structure**:
   `struct MatcherGroup` (also referenced in binary symbols as `HookHandlerConfigMatcherGroup` / `ConfiguredHookMatcherGroup` with 2 elements):
   - `matcher`: `Option<String>` (regex / tool glob pattern)
   - `hooks`: `Vec<HookHandlerConfig>` (array of hook handlers)

2. **Hook Handler Structure**:
   `enum HookHandlerConfig` (internally-tagged enum by `"type"`):
   - Variant `Command` (6 fields):
     - `type`: `"command"`
     - `command`: `String`
     - `commandWindows`: `Option<String>`
     - `timeout`: `Option<u64>`
     - `async`: `Option<bool>`
     - `statusMessage`: `Option<String>`
     - `additionalContextLimit`: `Option<usize>`
   - Variant `McpTool` (5 fields): `type = "mcpTool"`, `server`, `tool`, etc.
   - Variant `Prompt` / `Agent`.

3. **Discovery & Deserialization Outcome**:
   In `hooks/src/engine/discovery.rs`:
   When Serde deserializes the outer event array `Vec<MatcherGroup>`, it attempts to map `{ "command": "..." }` to `MatcherGroup`.
   Because the `"hooks"` key is absent, deserialization fails. The entry is skipped.

### 2.3 Proof via `~/.codex/config.toml` `[hooks.state]`

Inspection of `~/.codex/config.toml` provides concrete proof of Codex's internal indexing mechanism:

```toml
[hooks.state]

[hooks.state."/home/loidinh/.codex/hooks.json:pre_tool_use:0:0"]
trusted_hash = "sha256:6dbcbfbe47e56873457ec04fa707e1e926778a1914c404ed8eb8fd755fc0d51c"

[hooks.state."/home/loidinh/.codex/hooks.json:pre_tool_use:0:1"]
trusted_hash = "sha256:8bdb11ec7c1fa586aeacf0d4f31a2972e291e9be59580c062a69b1fc6755f9e8"

[hooks.state."/home/loidinh/.codex/hooks.json:permission_request:0:0"]
trusted_hash = "sha256:e446e62960c222fa85605f85a4892e610cc3aac9cfab8158d33ac4369b0ad2f4"

[hooks.state."/home/loidinh/.codex/hooks.json:session_start:0:0"]
trusted_hash = "sha256:3d3012bffbbda1df18af0a89b4a0a3e83b21afcb9a73b8e51075049b39145f4d"

[hooks.state."/home/loidinh/.codex/hooks.json:user_prompt_submit:0:0"]
trusted_hash = "sha256:b9df0c241ccad6c920bc22fcbaa278bfdc1dcd78916318b4badea70f4bfb1d54"
```

- **Key Format**: `<file_path>:<event_snake_case>:<group_index>:<hook_index>`.
- **Evidence**:
  - `pre_tool_use:0:0` = Matcher Group 0, Hook Handler 0 (`pretool-scout-block.cjs`).
  - `pre_tool_use:0:1` = Matcher Group 0, Hook Handler 1 (`pretool-privacy-block.cjs`).
  - DamHopper is element index 1 in the outer array. If it had been recognized, it would be registered as `:pre_tool_use:1:0`.
  - No `:1:0` index exists anywhere in `[hooks.state]`.
  - For events where DamHopper was the sole hook (`PostToolUse`, `PreCompact`, `PostCompact`, `Stop`, `Interrupt`, `SessionEnd`), there are zero entries in `[hooks.state]`.

### 2.4 Why DamHopper's Unit Tests Did Not Catch This

Inspection of `server/src/agent_status/codex_integration.rs` and `server/tests/agent_status_integration.rs` revealed self-confirming test tautology:

1. **Parser in `codex_integration.rs`**:
   `check_hooks_registered` (lines 484-494) and `check_all_hooks_registered` (lines 543-552) look directly for `item.get("command")`:
   ```rust
   for event in CODEX_MANAGED_EVENTS {
       let registered = hooks_obj.get(*event).and_then(|entry| entry.as_array()).map(|arr| {
           arr.iter().any(|item| {
               item.get("command").and_then(|c| c.as_str()) == Some(launcher_str.as_ref())
           })
       }).unwrap_or(false);
       if !registered { return Ok(false); }
   }
   ```
   Both functions check for the naive flat format rather than Codex CLI's actual nested structure.

2. **Synthetic Fixtures in Unit Tests**:
   In `server/tests/agent_status_integration.rs:268-359` (`test_codex_hooks_json_lifecycle`), the test mocks existing user hooks using DamHopper's naive schema:
   ```rust
   let initial_user_json = serde_json::json!({
       "hooks": {
           "SessionStart": [
               { "command": "/usr/local/bin/user-session-hook" }
           ],
           "CustomUserEvent": [
               { "command": "/usr/local/bin/custom-event-hook" }
           ]
       }
   });
   ```
   The test asserts that `install_codex` appends `{ "command": launcher_str }` and that `check_codex_status` returns `Current`.
   The test suite was verifying adherence to an imaginary schema, completely disconnected from Codex CLI's real binary AST.

3. **Same Defect in TOML Serializer**:
   `register_hooks_in_config_toml` (lines 708-711) writes:
   ```rust
   let mut inline = InlineTable::new();
   inline.insert("command", launcher_str.clone().into());
   arr.push(Value::InlineTable(inline));
   ```
   This generates `[[hooks.SessionStart]] command = "..."` instead of `[[hooks.SessionStart]] hooks = [{ type = "command", command = "..." }]`, meaning `config.toml` integrations suffer identical failure.

---

## 3. Actionable Recommendations

### 3.1 Immediate Implementation Steps (Priority: High / P0)

1. **Update `register_hooks_in_hooks_json`**:
   Format each managed entry as a compliant `MatcherGroup`:
   ```json
   {
     "hooks": [
       {
         "type": "command",
         "command": "/path/to/dam-hopper-agent-status"
       }
     ]
   }
   ```
   Ensure idempotency check checks whether any group contains a hook handler whose `"command"` matches `launcher_str`.

2. **Update `register_hooks_in_config_toml`**:
   In TOML, construct the nested structure:
   ```toml
   [[hooks.SessionStart]]
   hooks = [
       { type = "command", command = "/path/to/dam-hopper-agent-status" }
   ]
   ```

3. **Update Detection & Deregistration Helpers**:
   - `check_hooks_registered` & `check_all_hooks_registered`:
     Inspect `item.get("hooks")` array for `{ "type": "command", "command": launcher_str }`.
     Retain fallback checks for legacy `{ "command": launcher_str }` to detect and migrate unparsed legacy installations.
   - `deregister_hooks_in_hooks_json`:
     Filter out handlers from the nested `"hooks"` array. If the parent `MatcherGroup` has an empty `"hooks"` array, prune the group. Clean up legacy flat objects as well.

4. **Update Unit Test Fixtures**:
   Update `test_codex_hooks_json_lifecycle` and `test_codex_config_toml_inline_lifecycle` in `server/tests/agent_status_integration.rs` to use Codex CLI's real schema:
   ```rust
   serde_json::json!({
       "hooks": {
           "SessionStart": [
               {
                   "matcher": "*",
                   "hooks": [
                       { "type": "command", "command": "/usr/local/bin/user-session-hook" }
                   ]
               }
           ]
       }
   });
   ```

### 3.2 Long-Term Improvements & Preventative Measures (Priority: Medium / P1)

1. **Schema Validation Against Official Schema**:
   Codex CLI can generate its protocol schema on demand via `codex app-server generate-json-schema`. Integrate this or maintain a static JSON Schema snapshot in `server/tests/fixtures/codex-hooks.schema.json` to validate serialized outputs during CI.
2. **Migration Cleanup**:
   Provide automatic migration in `install_codex` that detects existing malformed `{ "command": ... }` entries in `~/.codex/hooks.json` and upgrades them to valid `MatcherGroup`s.

---

## 4. Supporting Evidence Summary

| Component | DamHopper Implemented | Codex CLI Required | Result |
| :--- | :--- | :--- | :--- |
| **Hook Entry Container** | Direct element of event array | Nested in `MatcherGroup.hooks` array | Serde error: missing field `hooks` |
| **Handler Type Tag** | Omitted | Mandatory `type = "command"` | Tag missing if deserialized directly |
| **Matcher Property** | None | Optional string on `MatcherGroup` | Valid if omitted on group |
| **Config TOML Table** | `Event = [{ command = "..." }]` | `[[hooks.Event]] hooks = [...]` | Toml deserializer drops entry |
| **Config Index Key** | Expects 1-level `:event` | Produces `:event:group:hook` | Group 1 never indexed into `[hooks.state]` |
| **Test Assertion** | `h["command"] == launcher` | Never validated nested AST | False-positive test pass |

---

## 5. Unresolved Questions

- None. Root cause is fully verified through static binary inspection of Codex CLI v0.159.3, active daemon introspection, `config.toml` state tracking, and source code tracing in `codex_integration.rs`.
