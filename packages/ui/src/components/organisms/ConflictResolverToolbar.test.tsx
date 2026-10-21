import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConflictResolverToolbar } from "./ConflictResolverToolbar.js";
import type { ConflictSummaryEntry, OperationStatusResponse } from "@/api/client.js";

const mockOperation: OperationStatusResponse = {
  operation: "merge",
  canContinue: true,
  canAbort: true,
  operationFingerprint: "fingerprint-123",
  fullIndexFingerprint: "index-123",
  stoppedReason: "conflicts",
};

const mockConflicts: ConflictSummaryEntry[] = [
  {
    conflictId: "conflict-1",
    path: "src/main.ts",
    status: "bothModified",
    isBinary: false,
  },
  {
    conflictId: "conflict-2",
    path: "src/utils.ts",
    status: "bothModified",
    isBinary: false,
  },
];

describe("ConflictResolverToolbar", () => {
  it("renders panel title, operation badge, and project name", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-project"
        operation={mockOperation}
        conflicts={mockConflicts}
        selectedFilePath="src/main.ts"
        onSelectFilePath={() => {}}
        isMaximized={false}
        onToggleMaximize={() => {}}
        onHide={() => {}}
        onDragStart={() => {}}
      />,
    );

    expect(markup).toContain("Git Conflict Resolver");
    expect(markup).toContain("MERGE");
    expect(markup).toContain("demo-project");
    expect(markup).toContain("File (2):");
    expect(markup).toContain("src/main.ts (bothModified)");
    expect(markup).toContain("src/utils.ts (bothModified)");
  });

  it("disables Continue button when conflicts remain", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-project"
        operation={mockOperation}
        conflicts={mockConflicts}
        selectedFilePath="src/main.ts"
        onSelectFilePath={() => {}}
        isMaximized={false}
        onToggleMaximize={() => {}}
        onHide={() => {}}
        onDragStart={() => {}}
        onContinue={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(markup).toContain('title="Resolve all conflicts before continuing"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Continue MERGE"');
    expect(markup).toContain('aria-label="Abort MERGE"');
  });

  it("enables Continue button when 0 conflicts remain and canContinue is true", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-project"
        operation={{ ...mockOperation, stoppedReason: undefined }}
        conflicts={[]}
        selectedFilePath=""
        onSelectFilePath={() => {}}
        isMaximized={false}
        onToggleMaximize={() => {}}
        onHide={() => {}}
        onDragStart={() => {}}
        onContinue={() => {}}
        onAbort={() => {}}
      />,
    );

    expect(markup).toContain('title="Continue MERGE"');
    expect(markup).not.toContain(
      'disabled="" title="Resolve all conflicts before continuing"',
    );
  });

  it("shows maximized restore button when isMaximized is true", () => {
    const markup = renderToStaticMarkup(
      <ConflictResolverToolbar
        project="demo-project"
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

    expect(markup).toContain('title="Restore resolver window"');
  });
});
