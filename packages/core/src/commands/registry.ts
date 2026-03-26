import type { ProjectType } from "../config/schema.js";
import type { CommandDatabase, CommandDefinition, SearchResult } from "./types.js";
import { buildIndex, searchIndex } from "./search.js";
import type { BM25Index } from "./search.js";

// Static imports of all JSON command databases
import mavenData from "./definitions/maven.json";
import gradleData from "./definitions/gradle.json";
import npmData from "./definitions/npm.json";
import pnpmData from "./definitions/pnpm.json";
import cargoData from "./definitions/cargo.json";

const ALL_DATABASES: CommandDatabase[] = [
  mavenData as CommandDatabase,
  gradleData as CommandDatabase,
  npmData as CommandDatabase,
  pnpmData as CommandDatabase,
  cargoData as CommandDatabase,
];

export class CommandRegistry {
  private readonly index: BM25Index;
  private readonly byType: Map<string, CommandDefinition[]>;

  constructor() {
    const entries: Array<{ command: CommandDefinition; projectType: string }> = [];
    this.byType = new Map();

    for (const db of ALL_DATABASES) {
      this.byType.set(db.projectType, db.commands);
      for (const command of db.commands) {
        entries.push({ command, projectType: db.projectType });
      }
    }

    this.index = buildIndex(entries);
  }

  search(query: string, limit = 10): SearchResult[] {
    return searchIndex(this.index, query, limit);
  }

  searchByType(query: string, projectType: ProjectType, limit = 10): SearchResult[] {
    return searchIndex(this.index, query, limit, projectType);
  }

  getCommands(projectType: ProjectType): CommandDefinition[] {
    return this.byType.get(projectType) ?? [];
  }
}
