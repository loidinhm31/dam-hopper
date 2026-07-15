# Terminal Panel Shortcuts

Status: Completed  
Created: 2026-07-16 00:25  
Scope: configurable desktop IDE/terminal workspace shortcuts

## Outcome

Add configurable shortcuts for Git, Ports, and Fleet Terminal. Defaults:

- Git: `Ctrl+Shift+G` (`Mod+Shift+KeyG`)
- Ports: `Ctrl+Shift+P` (`Mod+Shift+KeyP`)
- Fleet Terminal: `Ctrl+Shift+M` (`Mod+Shift+KeyM`)

Each shortcut toggles its target. Activating one target closes the other two
targets, while unrelated Project/Explorer tools remain independent.

## Phases

| Phase | Status | Link |
| --- | --- | --- |
| 01 | Completed 2026-07-16 | [implementation and validation](./phase-01-implementation-and-validation.md) |

## Preflight Contract

- Output: persisted shortcut settings, keyboard routing from xterm/global window,
  mutually exclusive Git/Ports/Fleet panel activation, tests, and concise docs.
- Acceptance: defaults hydrate from old configs; settings capture/reset works;
  each shortcut opens/closes its panel; opening one target hides the other two;
  xterm does not send these bindings to the PTY; builds and focused tests pass.
- Scope: `packages/ui` client, Rust `UiConfig` serialization/merge tests, user
  configuration/component docs as needed.
- Non-goals: new backend routes, terminal process changes, mobile custom-keyboard
  redesign, arbitrary shortcut conflict detection beyond existing validation.
- Public/risk areas: global UI TOML keys and camelCase API fields are extended;
  existing configs must deserialize unchanged. No auth, database, or command
  execution paths change.
- Expected touch points: shortcut constants/normalization, settings store and
  settings UI, client/Rust UI config schema, `WorkspacePage`, `IdeShell`, shared
  xterm shortcut suppression, focused tests, docs.
- Testing: web shortcut/config/settings/workspace/shell tests, focused Rust
  `ui_config` tests, web build, and manual xterm/panel verification.
- Open questions: none; configurable bindings and toggle-on-repeat were confirmed.

## Side-effect Review

- Auth/session/permissions: unchanged; panel actions are local UI state.
- API/config compatibility: additive optional-on-read/defaulted fields; preserve
  existing camelCase and snake_case aliases.
- Data/migrations: no database migration; existing TOML receives new keys only
  after a user changes settings.
- Security/privacy: shortcut values are validated strings only; no secrets/logging.
- Performance/concurrency: three lightweight window listeners; no PTY lifecycle
  changes; preserve terminal keep-alive behavior.
- Docs/onboarding/deployment: update shortcut/configuration references; no new
  environment variables or deployment steps.
