import { describe, it, expect, beforeEach } from "vitest";
import { tokenize, buildIndex, searchIndex } from "../search.js";
import { CommandRegistry } from "../registry.js";
import type { CommandDefinition } from "../types.js";

// --- tokenize ---
describe("tokenize", () => {
  it("lowercases input", () => {
    expect(tokenize("MVN Clean")).toContain("mvn");
    expect(tokenize("MVN Clean")).toContain("clean");
  });

  it("splits on non-alphanumeric characters", () => {
    expect(tokenize("spring-boot:run")).toEqual(["spring", "boot", "run"]);
    expect(tokenize("./gradlew build")).toEqual(["gradlew", "build"]);
    expect(tokenize("skip_tests.fast")).toEqual(["skip", "tests", "fast"]);
    expect(tokenize("Build (skip tests)")).toContain("skip");
    expect(tokenize("Build (skip tests)")).toContain("build");
  });

  it("removes tokens shorter than 2 chars", () => {
    expect(tokenize("-x a b cd")).not.toContain("x");
    expect(tokenize("-x a b cd")).not.toContain("a");
    expect(tokenize("-x a b cd")).not.toContain("b");
    expect(tokenize("-x a b cd")).toContain("cd");
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// --- BM25 Index & Search ---
describe("buildIndex + searchIndex", () => {
  const commands: CommandDefinition[] = [
    {
      name: "Build (skip tests)",
      command: "mvn clean install -DskipTests",
      description: "Build without running tests",
      tags: ["build", "compile", "skip", "fast"],
    },
    {
      name: "Test",
      command: "mvn test",
      description: "Run all tests",
      tags: ["test", "unit"],
    },
    {
      name: "Spring Boot Run",
      command: "mvn spring-boot:run",
      description: "Start Spring Boot application",
      tags: ["run", "start", "spring", "boot"],
    },
  ];

  const entries = commands.map((c) => ({ command: c, projectType: "maven" }));
  let index: ReturnType<typeof buildIndex>;

  beforeEach(() => {
    index = buildIndex(entries);
  });

  it("builds index with correct document count", () => {
    expect(index.docCount).toBe(3);
  });

  it("returns results sorted by score descending", () => {
    const results = searchIndex(index, "build skip");
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("ranks build+skip command highest for 'build skip' query", () => {
    const results = searchIndex(index, "build skip");
    expect(results[0].command.command).toBe("mvn clean install -DskipTests");
  });

  it("ranks test command highest for 'test' query", () => {
    const results = searchIndex(index, "test");
    expect(results[0].command.command).toBe("mvn test");
  });

  it("returns empty array for empty query", () => {
    expect(searchIndex(index, "")).toEqual([]);
  });

  it("respects limit parameter", () => {
    const results = searchIndex(index, "mvn", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("filters by projectType", () => {
    const mixed = [
      ...entries,
      {
        command: {
          name: "Build",
          command: "cargo build",
          description: "Build rust project",
          tags: ["build"],
        },
        projectType: "cargo",
      },
    ];
    const mixedIndex = buildIndex(mixed);
    const results = searchIndex(mixedIndex, "build", 10, "cargo");
    expect(results.every((r) => r.projectType === "cargo")).toBe(true);
  });

  it("only returns results with score > 0", () => {
    const results = searchIndex(index, "xyznonexistent");
    expect(results).toEqual([]);
  });
});

// --- CommandRegistry ---
describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it("getCommands returns commands for maven", () => {
    const cmds = registry.getCommands("maven");
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.some((c) => c.command.includes("mvn"))).toBe(true);
  });

  it("getCommands returns commands for cargo", () => {
    const cmds = registry.getCommands("cargo");
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.some((c) => c.command.includes("cargo"))).toBe(true);
  });

  it("getCommands returns empty array for unknown type", () => {
    expect(registry.getCommands("custom" as never)).toEqual([]);
  });

  it("search('build skip') returns a 'Build (skip tests)' command as top result", () => {
    const results = registry.search("build skip");
    expect(results.length).toBeGreaterThan(0);
    // Both maven and gradle have "Build (skip tests)" — either is correct
    expect(results[0].command.name).toBe("Build (skip tests)");
  });

  it("searchByType('build skip', 'maven') returns mvn clean install -DskipTests as top result", () => {
    const results = registry.searchByType("build skip", "maven");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].command.command).toBe("mvn clean install -DskipTests");
  });

  it("searchByType('test', 'npm') returns npm test as top result", () => {
    const results = registry.searchByType("test", "npm");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].command.command).toBe("npm test");
  });

  it("searchByType only returns results for specified type", () => {
    const results = registry.searchByType("build", "cargo");
    expect(results.every((r) => r.projectType === "cargo")).toBe(true);
  });

  it("search returns results in < 5ms for full corpus", () => {
    const start = performance.now();
    registry.search("build release");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it("search returns scores", () => {
    const results = registry.search("run start");
    expect(results.every((r) => r.score > 0)).toBe(true);
  });

  it("searchByType('build --release', 'cargo') returns release build as top", () => {
    const results = registry.searchByType("build release", "cargo");
    expect(results[0].command.command).toBe("cargo build --release");
  });
});
