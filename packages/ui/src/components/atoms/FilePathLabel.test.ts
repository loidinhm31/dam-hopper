import { describe, expect, it } from "vitest";
import { getFilePathParts } from "./FilePathLabel.js";

describe("getFilePathParts", () => {
  it("splits POSIX paths into directory and filename", () => {
    expect(getFilePathParts("src/components/Button.tsx")).toEqual({
      fileName: "Button.tsx",
      dirPath: "src/components",
    });
  });

  it("splits Windows paths into directory and filename", () => {
    expect(getFilePathParts("C:\\repo\\src\\Button.tsx")).toEqual({
      fileName: "Button.tsx",
      dirPath: "C:\\repo\\src",
    });
  });

  it("keeps dotfiles and bare names intact", () => {
    expect(getFilePathParts(".gitignore")).toEqual({
      fileName: ".gitignore",
      dirPath: "",
    });
  });
});
