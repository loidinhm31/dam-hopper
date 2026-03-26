---
parent: plan.md
phase: "01"
status: done
completed: 2026-03-27
effort: 3h
---

# Phase 01: Core — Command Database & BM25 Search Engine

## Context

- Parent: [plan.md](plan.md)
- Dependencies: None (foundational phase)

## Overview

Create the command definition database (static JSON per language/framework), a command registry to load and index definitions, and a BM25 search engine to rank commands by relevance to user queries.

## Key Insights

- Each project type maps to one or more command definition files
- BM25 needs an inverted index built at load time for fast queries
- Search corpus per command: name + command string + description + tags (concatenated, tokenized)
- No external dependencies — implement BM25 in ~80 lines of TypeScript

## Requirements

1. Define `CommandDefinition` and `CommandDatabase` types
2. Create JSON command definition files for all 5 project types (maven, gradle, npm, pnpm, cargo)
3. Implement BM25 search with tokenization, IDF, and term frequency scoring
4. Build a `CommandRegistry` that loads definitions and provides search API
5. Export search API from `@dev-hub/core`
6. Add unit tests for search accuracy

## Architecture

### Types (`commands/types.ts`)

```typescript
export interface CommandDefinition {
  name: string;           // "Build (skip tests)"
  command: string;        // "mvn clean install -DskipTests"
  description: string;    // "Build without running tests"
  tags: string[];         // ["build", "compile", "skip", "fast"]
}

export interface CommandDatabase {
  language: string;       // "java"
  framework: string;      // "maven"
  projectType: string;    // matches ProjectType enum
  commands: CommandDefinition[];
}

export interface SearchResult {
  command: CommandDefinition;
  score: number;
  projectType: string;
}
```

### BM25 Search (`commands/search.ts`)

BM25 parameters: k1 = 1.2, b = 0.75 (standard defaults).

**Index structure:**
```typescript
interface BM25Index {
  documents: Array<{
    command: CommandDefinition;
    projectType: string;
    tokens: string[];       // tokenized corpus
    length: number;         // token count
  }>;
  avgDocLength: number;
  idf: Map<string, number>; // inverse document frequency per term
  docCount: number;
}
```

**Tokenization:**
- Lowercase
- Split on spaces, hyphens, underscores, dots, slashes, colons
- Remove tokens < 2 chars
- Corpus = `${name} ${command} ${description} ${tags.join(' ')}`

**Search flow:**
1. Tokenize query
2. For each query term, compute BM25 score against each document
3. Sum scores per document
4. Sort by score descending
5. Return top N results (default 10)

### Command Definitions

**maven.json** (~12 commands):
- mvn clean install, mvn clean install -DskipTests, mvn test, mvn package
- mvn spring-boot:run, mvn dependency:tree, mvn clean, mvn verify
- mvn compile, mvn site, mvn deploy, mvn package -DskipTests

**gradle.json** (~10 commands):
- ./gradlew build, ./gradlew build -x test, ./gradlew test, ./gradlew clean
- ./gradlew bootRun, ./gradlew dependencies, ./gradlew assemble
- ./gradlew check, ./gradlew jar, ./gradlew run

**npm.json** (~10 commands):
- npm run build, npm start, npm run dev, npm test, npm run lint
- npm install, npm ci, npm run format, npm audit, npm outdated

**pnpm.json** (~10 commands):
- pnpm build, pnpm start, pnpm dev, pnpm test, pnpm lint
- pnpm install, pnpm format, pnpm audit, pnpm outdated, pnpm dlx

**cargo.json** (~10 commands):
- cargo build, cargo build --release, cargo run, cargo test, cargo check
- cargo clippy, cargo fmt, cargo doc, cargo bench, cargo clean

### Registry (`commands/registry.ts`)

```typescript
export class CommandRegistry {
  private index: BM25Index;

  constructor() {
    // Load all JSON definitions at construction
    // Build BM25 index
  }

  /** Search all commands across all project types */
  search(query: string, limit?: number): SearchResult[];

  /** Search commands filtered to a specific project type */
  searchByType(query: string, projectType: ProjectType, limit?: number): SearchResult[];

  /** Get all commands for a project type (no search, full list) */
  getCommands(projectType: ProjectType): CommandDefinition[];
}
```

## Completed Code Files

| File | Status |
|------|--------|
| `packages/core/src/commands/types.ts` | Created |
| `packages/core/src/commands/definitions/maven.json` | Created |
| `packages/core/src/commands/definitions/gradle.json` | Created |
| `packages/core/src/commands/definitions/npm.json` | Created |
| `packages/core/src/commands/definitions/pnpm.json` | Created |
| `packages/core/src/commands/definitions/cargo.json` | Created |
| `packages/core/src/commands/search.ts` | Created |
| `packages/core/src/commands/registry.ts` | Created |
| `packages/core/src/commands/index.ts` | Created |
| `packages/core/src/index.ts` | Updated: added commands export |
| `packages/core/src/commands/__tests__/search.test.ts` | Created |

## Implementation Steps

1. Create `commands/types.ts` with type definitions
2. Create all 5 JSON definition files with ~10 commands each
3. Implement BM25 tokenizer + index builder + scorer in `search.ts`
4. Implement `CommandRegistry` class loading JSON + exposing search
5. Export from `commands/index.ts` and `core/index.ts`
6. Write tests: tokenization, index building, search ranking accuracy, type filtering

## Completed Work

- [x] Create types.ts with CommandDefinition, CommandDatabase, SearchResult
- [x] Create maven.json (~12 commands)
- [x] Create gradle.json (~10 commands)
- [x] Create npm.json (~10 commands)
- [x] Create pnpm.json (~10 commands)
- [x] Create cargo.json (~10 commands)
- [x] Implement BM25 search (tokenize, index, score)
- [x] Implement CommandRegistry (load, search, searchByType, getCommands)
- [x] Export from core index
- [x] Write unit tests for search accuracy and edge cases

## Success Criteria

- `registry.search("build skip")` returns "mvn clean install -DskipTests" as top result for maven
- `registry.searchByType("test", "npm")` returns "npm test" as top result
- Search returns results in < 5ms for ~50 commands
- All JSON definitions valid and loadable
- Existing core tests still pass

## Risk Assessment

- **Low**: Additive module, no changes to existing code
- **Low**: BM25 is well-understood algorithm, straightforward implementation
- **Medium**: JSON bundling with tsup — may need `resolveJsonModule` or import assertion config

## Security Considerations

- Static data only, no user input in definitions
- Search queries are local, no external calls
