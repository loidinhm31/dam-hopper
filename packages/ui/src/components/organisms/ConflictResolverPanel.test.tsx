import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConflictResolverToolbar } from "./ConflictResolverToolbar.js";

describe("ConflictResolverToolbar", () => {
  const conflicts = [
    { conflictId: "c1", path: "src/main.ts", status: "both_modified" as const },
    { conflictId: "c2", path: "src/utils.ts", status: "both_modified" as const },
  ];

  it("renders title, operation badge, project name, and file options", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-repo"
        operation={{
          operation: "rebase",
          canContinue: true,
          canAbort: true,
          operationFingerprint: "fp1",
          fullIndexFingerprint: "ifp1",
        }}
        conflicts={conflicts}
        selectedFilePath="src/main.ts"
        onSelectFilePath={() => {}}
        isMaximized={false}
        onToggleMaximize={() => {}}
        onHide={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(markup).toContain("Git Conflict Resolver");
    expect(markup).toContain("REBASE");
    expect(markup).toContain("demo-repo");
    expect(markup).toContain("File (2):");
    expect(markup).toContain("src/main.ts");
    expect(markup).toContain("src/utils.ts");
    expect(markup).toContain("Maximize resolver window");
    expect(markup).toContain("Hide conflict resolver");
  });

  it("shows restore icon when window is maximized", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-repo"
        operation={null}
        conflicts={[]}
        selectedFilePath=""
        onSelectFilePath={() => {}}
        isMaximized={true}
        onToggleMaximize={() => {}}
        onHide={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(markup).toContain("Restore resolver window");
  });
});
