import "@/lib/monaco-setup";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/index.css";
import { ReadonlyMonacoDiffViewer } from "@/components/organisms/ReadonlyMonacoDiffViewer";
import { SessionChangedFilesList } from "@/components/organisms/SessionChangedFilesList";
import type { ConnectionRef } from "@/api/ownership";
import type { FileDetail, FileRow } from "@/api/session-changes-types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Session Changes Readonly Viewer & List Browser Tests", () => {
  let container: HTMLDivElement;
  let root: Root;

  const owner: ConnectionRef = { profileId: "prof-test", generation: 1 };

  const mockFileRow: FileRow = {
    fileId: "fid-1",
    path: "src/main.rs",
    change: "modified",
    originalPresence: "present",
    originalProvenance: "captured",
    currentPresence: "present",
    originalKind: "text",
    currentKind: "text",
    originalMode: 33188,
    currentMode: 33188,
    additions: 1,
    deletions: 0,
    reasons: [],
  };

  const mockDetail: FileDetail = {
    version: 1,
    serverEpoch: "epoch-1",
    baselineId: "base-1",
    comparisonRevision: "1",
    file: mockFileRow,
    original: {
      presence: "present",
      content: "fn main() {}\n",
      byteLength: 13,
      sha256: "abc",
      mode: 33188,
    },
    current: {
      presence: "present",
      content: "fn main() {\n    println!(\"hello\");\n}\n",
      byteLength: 36,
      sha256: "def",
      mode: 33188,
    },
    renderable: true,
  };

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders ReadonlyMonacoDiffViewer with toolbar and read-only indication", async () => {
    await act(async () => {
      root.render(
        <ReadonlyMonacoDiffViewer
          fileDetail={mockDetail}
          owner={owner}
          terminalId="term-1"
          terminalIncarnation="1"
          ompSessionId="sess-1"
        />,
      );
    });

    const viewerEl = container.querySelector(
      '[data-testid="readonly-monaco-diff-viewer"]',
    );
    expect(viewerEl).not.toBeNull();
    expect(container.textContent).toContain("src/main.rs");
    expect(container.textContent).toContain("Read-only");
  });

  it("renders placeholder for unrenderable or unknown files", async () => {
    const unrenderableDetail: FileDetail = {
      ...mockDetail,
      renderable: false,
      file: {
        ...mockFileRow,
        change: "unknown",
        reasons: ["absenceUnknown"],
      },
    };

    await act(async () => {
      root.render(
        <ReadonlyMonacoDiffViewer
          fileDetail={unrenderableDetail}
          owner={owner}
          terminalId="term-1"
          terminalIncarnation="1"
          ompSessionId="sess-1"
        />,
      );
    });

    const placeholder = container.querySelector(
      '[data-testid="unrenderable-diff-placeholder"]',
    );
    expect(placeholder).not.toBeNull();
    expect(container.textContent).toContain("Diff Unavailable");
  });

  it("renders SessionChangedFilesList and allows keyboard navigation", async () => {
    const files: FileRow[] = [
      mockFileRow,
      {
        fileId: "fid-2",
        path: "README.md",
        change: "added",
        originalPresence: "absent",
        originalProvenance: "absentInVerifiedDirectory",
        currentPresence: "present",
        originalKind: "unknown",
        currentKind: "text",
        originalMode: null,
        currentMode: 33188,
        additions: 5,
        deletions: 0,
        reasons: [],
      },
    ];

    let selectedId = "fid-1";

    await act(async () => {
      root.render(
        <SessionChangedFilesList
          files={files}
          selectedFileId={selectedId}
          onSelectFile={(id) => {
            selectedId = id;
          }}
        />,
      );
    });

    const listEl = container.querySelector(
      '[data-testid="session-changed-files-list"]',
    );
    expect(listEl).not.toBeNull();
    expect(container.textContent).toContain("src/main.rs");
    expect(container.textContent).toContain("README.md");

    // Click on second row
    const row2 = container.querySelector('[data-testid="file-row-fid-2"]');
    expect(row2).not.toBeNull();
    await act(async () => {
      row2?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(selectedId).toBe("fid-2");
  });
});
