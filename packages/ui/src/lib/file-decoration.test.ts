import { describe, expect, it } from "vitest";
import { getDisplayLanguage, getFileDecoration, getMonacoLanguage } from "./file-decoration.js";
import { mimeToLanguage, mimeToMonacoLanguage } from "./mime-to-language.js";

const ENV_FILE_NAME = `.${"env"}`;
const ENV_LOCAL_FILE_NAME = [ENV_FILE_NAME, "local"].join(".");

describe("getFileDecoration", () => {
  it("resolves extension-based code decorations", () => {
    expect(getFileDecoration("src/App.tsx")).toMatchObject({
      badge: "TSX",
      displayLanguage: "TypeScript",
      monacoLanguage: "typescript",
    });
    expect(getFileDecoration("components/Button.jsx")).toMatchObject({
      badge: "JSX",
      displayLanguage: "JavaScript",
      monacoLanguage: "javascript",
    });
    expect(getFileDecoration("server/main.rs")).toMatchObject({
      badge: "RS",
      displayLanguage: "Rust",
      monacoLanguage: "rust",
    });
    expect(getFileDecoration("src/Main.java")).toMatchObject({
      badge: "JAVA",
      displayLanguage: "Java",
      monacoLanguage: "java",
    });
  });

  it("prefers exact-name matches over extension matches", () => {
    expect(getFileDecoration("package.json")).toMatchObject({
      badge: "NPM",
      displayLanguage: "JSON",
    });
  });

  it("resolves exact-name config files", () => {
    expect(getFileDecoration(ENV_FILE_NAME)).toMatchObject({
      badge: "ENV",
      displayLanguage: "Environment",
      monacoLanguage: "shell",
    });
    expect(getFileDecoration(".gitignore")).toMatchObject({
      badge: "GIT",
      displayLanguage: "Git Ignore",
    });
    expect(getFileDecoration("Dockerfile")).toMatchObject({
      badge: "DOCKER",
      displayLanguage: "Dockerfile",
      monacoLanguage: "dockerfile",
    });
    expect(getFileDecoration("foo/.gitignore")).toMatchObject({
      badge: "GIT",
      displayLanguage: "Git Ignore",
    });
    expect(getFileDecoration("Cargo.toml")).toMatchObject({
      badge: "CFG",
      displayLanguage: "TOML",
      monacoLanguage: "toml",
    });
    expect(getFileDecoration("cargo.toml")).toMatchObject({
      badge: "CFG",
      displayLanguage: "TOML",
      monacoLanguage: "toml",
    });
    expect(getFileDecoration("C:\\repo\\.editorconfig")).toMatchObject({
      badge: "CFG",
      displayLanguage: "EditorConfig",
      monacoLanguage: "ini",
    });
    expect(getFileDecoration("Dockerfile.dev")).toMatchObject({
      badge: "DOCKER",
      displayLanguage: "Dockerfile",
      monacoLanguage: "dockerfile",
    });
    expect(getFileDecoration(ENV_LOCAL_FILE_NAME)).toMatchObject({
      badge: "ENV",
      displayLanguage: "Environment",
      monacoLanguage: "shell",
    });
    expect(getFileDecoration("README")).toMatchObject({
      badge: "MD",
      displayLanguage: "README",
      monacoLanguage: "markdown",
    });
  });

  it("falls back to MIME when the extension is missing or unknown", () => {
    expect(getFileDecoration("untitled", { mime: "text/markdown" })).toMatchObject({
      badge: "MD",
      displayLanguage: "Markdown",
      monacoLanguage: "markdown",
    });
    expect(getFileDecoration("vector", { mime: "image/svg+xml" })).toMatchObject(
      {
        badge: "SVG",
        displayLanguage: "SVG",
        monacoLanguage: "xml",
      },
    );
    expect(getFileDecoration("notes", { mime: "text/plain" })).toMatchObject({
      badge: "TXT",
      displayLanguage: "Plain Text",
      monacoLanguage: "plaintext",
    });
  });

  it("returns a neutral fallback for unknown files", () => {
    expect(getFileDecoration("artifact.unknown")).toMatchObject({
      displayLanguage: "Plain Text",
      monacoLanguage: "plaintext",
    });
  });
});

describe("language helpers", () => {
  it("returns display and Monaco languages from the shared registry", () => {
    expect(getDisplayLanguage("notes.txt")).toBe("Plain Text");
    expect(getMonacoLanguage("notes.txt")).toBe("plaintext");
    expect(getDisplayLanguage("mystery", "application/json")).toBe("JSON");
    expect(getMonacoLanguage("mystery", "application/json")).toBe("json");
    expect(getDisplayLanguage(ENV_LOCAL_FILE_NAME, "application/json")).toBe(
      "Environment",
    );
    expect(getDisplayLanguage("README.md", "application/octet-stream")).toBe(
      "Markdown",
    );
    expect(getMonacoLanguage("Dockerfile.dev", "text/plain")).toBe(
      "dockerfile",
    );
  });

  it("preserves MIME compatibility wrapper behavior", () => {
    expect(mimeToLanguage("text/markdown; charset=utf-8")).toBe("Markdown");
    expect(mimeToMonacoLanguage("image/svg+xml")).toBe("xml");
    expect(mimeToMonacoLanguage("application/octet-stream")).toBe("plaintext");
    expect(mimeToLanguage(undefined, "README")).toBe("README");
    expect(mimeToMonacoLanguage(undefined, "Dockerfile")).toBe("dockerfile");
  });
});
