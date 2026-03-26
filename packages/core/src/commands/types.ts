export interface CommandDefinition {
  name: string;
  command: string;
  description: string;
  tags: string[];
}

export interface CommandDatabase {
  language: string;
  framework: string;
  projectType: string;
  commands: CommandDefinition[];
}

export interface SearchResult {
  command: CommandDefinition;
  score: number;
  projectType: string;
}
