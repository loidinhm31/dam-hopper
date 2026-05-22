import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcRoot = new URL(".", import.meta.url);

const kebabCaseFile = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.(ts|tsx)$/;
const pascalCaseFile = /^[A-Z][A-Za-z0-9]*(?:\.test)?\.(ts|tsx)$/;

function listFiles(relativeDir: string): string[] {
  const rootPath = new URL(relativeDir, srcRoot);
  const files: string[] = [];
  const dirs = [rootPath];

  while (dirs.length > 0) {
    const currentDir = dirs.pop();
    if (!currentDir) continue;

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(new URL(`${entry.name}/`, currentDir));
        continue;
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(entry.name);
      }
    }
  }

  return files.sort();
}

describe("packages/web filename conventions", () => {
  it("uses kebab-case for hooks, stores, and support modules", () => {
    const supportFiles = [
      ...listFiles("api/"),
      ...listFiles("hooks/"),
      ...listFiles("lib/"),
      ...listFiles("stores/"),
      ...listFiles("types/"),
    ];

    for (const file of supportFiles) {
      expect(file).toMatch(kebabCaseFile);
    }
  });

  it("uses PascalCase for React component-style modules", () => {
    const componentFiles = [
      ...listFiles("components/"),
      ...listFiles("contexts/"),
      "App.tsx",
    ];

    for (const file of componentFiles) {
      expect(file).toMatch(pascalCaseFile);
    }
  });
});
