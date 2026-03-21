import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(__dirname, "../../dist/index.js");

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    encoding: "utf-8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
  };
}

describe("CLI help text", () => {
  it("shows version", () => {
    const { stdout } = runCli(["--version"]);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it("shows top-level help", () => {
    const { stdout } = runCli(["--help"]);
    expect(stdout).toContain("dev-hub");
    expect(stdout).toContain("init");
    expect(stdout).toContain("status");
    expect(stdout).toContain("git");
    expect(stdout).toContain("build");
    expect(stdout).toContain("run");
    expect(stdout).toContain("ui");
  });

  it("shows git subcommand help", () => {
    const { stdout } = runCli(["git", "--help"]);
    expect(stdout).toContain("fetch");
    expect(stdout).toContain("pull");
    expect(stdout).toContain("push");
    expect(stdout).toContain("worktree");
    expect(stdout).toContain("branch");
  });

  it("shows git worktree help", () => {
    const { stdout } = runCli(["git", "worktree", "--help"]);
    expect(stdout).toContain("list");
    expect(stdout).toContain("add");
    expect(stdout).toContain("remove");
  });

  it("shows git branch help", () => {
    const { stdout } = runCli(["git", "branch", "--help"]);
    expect(stdout).toContain("list");
    expect(stdout).toContain("update");
  });

  it("shows init help", () => {
    const { stdout } = runCli(["init", "--help"]);
    expect(stdout).toContain("init");
    expect(stdout).toContain("dev-hub.toml");
  });

  it("shows build help with --all and --service options", () => {
    const { stdout } = runCli(["build", "--help"]);
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--service");
  });

  it("shows exec command in top-level help", () => {
    const { stdout } = runCli(["--help"]);
    expect(stdout).toContain("exec");
  });

  it("shows exec help with positional args and --list option", () => {
    const { stdout } = runCli(["exec", "--help"]);
    expect(stdout).toContain("--list");
    expect(stdout).toContain("project");
    expect(stdout).toContain("command");
  });

  it("shows run help with --service option", () => {
    const { stdout } = runCli(["run", "--help"]);
    expect(stdout).toContain("--service");
  });

  it("shows logs --lines option", () => {
    const { stdout } = runCli(["logs", "--help"]);
    expect(stdout).toContain("--lines");
  });
});
