---
title: "Command Suggestions with BM25 Search & Env File Support"
description: "Autocomplete command suggestions from a per-language predefined database with BM25 ranking and automatic env file loading"
status: pending
priority: P2
effort: 7h
branch: main
tags: [terminals, commands, search, ux, presets]
created: 2026-03-26
---

# Command Suggestions with BM25 Search & Env File Support

## Problem

Users repeatedly type common commands per project type (e.g., `mvn clean install -DskipTests`, `cargo build --release`). There's no autocomplete or suggestion system — users must remember exact syntax. Additionally, environment variables from env files should be auto-loaded when commands run.

## Solution

Build a **command suggestion system** with:

1. **Static command database** — JSON files bundled in the app, organized per language/framework (Maven, Gradle, npm, pnpm, Cargo, etc.)
2. **BM25 text search** — rank suggestions as user types in any command input field
3. **Autocomplete UI** — dropdown suggestions in terminal creation inputs AND existing command inputs throughout the tree
4. **Env file auto-loading** — project-level `env_file` automatically loaded into terminal environment when running any command

## How It Works

```
User types in command input:
  "mvn skip" → BM25 search → ranked results:
    1. mvn clean install -DskipTests    (score: 4.2)
    2. mvn package -DskipTests          (score: 3.8)
    3. mvn test -DskipTests=true        (score: 3.1)

User selects → command fills input → launch → env auto-loaded from project env_file
```

## Command Database Format

```json
// packages/core/src/commands/definitions/maven.json
{
  "language": "java",
  "framework": "maven",
  "projectType": "maven",
  "commands": [
    {
      "name": "Build",
      "command": "mvn clean install",
      "description": "Full build with tests",
      "tags": ["build", "compile", "install"]
    },
    {
      "name": "Build (skip tests)",
      "command": "mvn clean install -DskipTests",
      "description": "Build without running tests",
      "tags": ["build", "compile", "skip", "fast"]
    },
    {
      "name": "Run (Spring Boot)",
      "command": "mvn spring-boot:run",
      "description": "Start Spring Boot application",
      "tags": ["run", "start", "spring", "boot", "server"]
    }
  ]
}
```

## Architecture

```
@dev-hub/core
├── commands/definitions/    → Static JSON command databases per language
│   ├── maven.json
│   ├── gradle.json
│   ├── npm.json
│   ├── pnpm.json
│   └── cargo.json
├── commands/registry.ts     → Load & index command definitions
├── commands/search.ts       → BM25 search implementation
└── commands/types.ts        → CommandDefinition, SearchResult types

@dev-hub/electron
├── ipc/commands.ts          → IPC handler for search queries

@dev-hub/web
├── components/atoms/CommandSuggestionInput.tsx → Autocomplete input component
├── hooks/useCommandSearch.ts                  → Debounced search hook
└── (integration into TerminalTreeView, TerminalsPage)
```

## Implementation Phases

| Phase | Name | Status | Effort | File |
|-------|------|--------|--------|------|
| 01 | Core: Command Database & BM25 Search | DONE (2026-03-27) | 3h | [phase-01-core.md](phase-01-core.md) |
| 02 | Electron + Web: Autocomplete UI | pending | 3h | [phase-02-ui.md](phase-02-ui.md) |
| 03 | Integration & Env Loading | DONE (2026-03-27) | 1h | [phase-03-integration.md](phase-03-integration.md) |

## Design Decisions

1. **Static JSON bundled in app** — no network dependency, fast lookup, updated with app releases
2. **BM25 search** — proven text ranking algorithm, searches command string + name + description + tags
3. **Project-level env_file auto-loaded** — no per-command env override needed, keeps it simple
4. **Suggestions everywhere** — available in terminal creation AND existing command inputs in the tree

## Validation Summary

**Validated:** 2026-03-26
**Questions asked:** 4

### Confirmed Decisions
- UI: Input field autocomplete in terminal creation (+ existing command inputs)
- Data: Static JSON files bundled in app
- Env: Project env_file auto-loaded (no per-command override)
- Scope: Suggestions available everywhere (not just new terminal creation)
