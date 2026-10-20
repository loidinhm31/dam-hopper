import "@/lib/monaco-setup.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as monaco from "monaco-editor";
import { JointHistoryAuthority } from "@/lib/joint-history-authority.js";
import "@/index.css";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Phase 01: Monaco public joint history authority browser proof", () => {
  let container: HTMLDivElement;
  let root: Root;

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

  it("proves single joint undo/redo authority across native typing and metadata decisions", async () => {
    let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
    let modelInstance: monaco.editor.ITextModel | null = null;

    const blockDecisions: Record<string, string> = {
      "block-1": "pending",
    };

    await act(async () => {
      modelInstance = monaco.editor.createModel("Initial text\n", "plaintext");
      editorInstance = monaco.editor.create(container, {
        model: modelInstance,
        automaticLayout: true,
      });
    });

    expect(editorInstance).not.toBeNull();
    expect(modelInstance).not.toBeNull();

    const history = new JointHistoryAuthority(
      editorInstance!,
      modelInstance!,
      (blockId, decision) => {
        blockDecisions[blockId] = decision;
      },
    );

    // 1. Text Edit: User types text in model
    await act(async () => {
      modelInstance!.applyEdits([
        {
          range: new monaco.Range(2, 1, 2, 1),
          text: "User edited line\n",
        },
      ]);
    });

    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    expect(history.getUndoCount()).toBe(1);

    // 2. Metadata Action: User clicks "Ignore Left" on block-1
    act(() => {
      blockDecisions["block-1"] = "ignored";
      history.recordMetadataAction("block-1", "pending", "ignored");
    });

    expect(blockDecisions["block-1"]).toBe("ignored");
    expect(history.getUndoCount()).toBe(2);

    // 3. Text Edit: User types a second edit
    await act(async () => {
      modelInstance!.applyEdits([
        {
          range: new monaco.Range(3, 1, 3, 1),
          text: "Another line\n",
        },
      ]);
    });

    expect(modelInstance!.getValue()).toBe(
      "Initial text\nUser edited line\nAnother line\n",
    );
    expect(history.getUndoCount()).toBe(3);

    // --- UNDO SEQUENCE ---
    // Undo 1: should undo second text edit ("Another line\n")
    act(() => {
      const ok = history.undo();
      expect(ok).toBe(true);
    });
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    expect(blockDecisions["block-1"]).toBe("ignored"); // metadata unchanged

    // Undo 2: should undo metadata decision ("ignored" -> "pending") WITHOUT touching text!
    act(() => {
      const ok = history.undo();
      expect(ok).toBe(true);
    });
    expect(blockDecisions["block-1"]).toBe("pending"); // restored to pending
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n"); // text preserved!

    // Undo 3: should undo first text edit ("User edited line\n")
    act(() => {
      const ok = history.undo();
      expect(ok).toBe(true);
    });
    expect(modelInstance!.getValue()).toBe("Initial text\n");
    expect(blockDecisions["block-1"]).toBe("pending");

    // --- REDO SEQUENCE ---
    // Redo 1: re-applies first text edit
    act(() => {
      const ok = history.redo();
      expect(ok).toBe(true);
    });
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    expect(blockDecisions["block-1"]).toBe("pending");

    // Redo 2: re-applies metadata decision ("pending" -> "ignored")
    act(() => {
      const ok = history.redo();
      expect(ok).toBe(true);
    });
    expect(blockDecisions["block-1"]).toBe("ignored");
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");

    // --- BRANCH AFTER UNDO CLEARS REDO ---
    act(() => {
      history.undo();
    });
    expect(blockDecisions["block-1"]).toBe("pending");
    expect(history.getRedoCount()).toBe(2);

    await act(async () => {
      modelInstance!.applyEdits([
        {
          range: new monaco.Range(3, 1, 3, 1),
          text: "Branching edit\n",
        },
      ]);
    });

    expect(history.getRedoCount()).toBe(0);
    expect(history.canRedo()).toBe(false);

    // --- VERIFY POST-UNDO BRANCH EDIT RESTORES PROPER BASELINE ---
    expect(modelInstance!.getValue()).toBe(
      "Initial text\nUser edited line\nBranching edit\n",
    );
    act(() => {
      const ok = history.undo();
      expect(ok).toBe(true);
    });
    // If lastValue was not stale, undoing the branching edit must restore exactly the pre-branch text!
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    history.dispose();

    // Cleanup
    editorInstance?.dispose();
    modelInstance?.dispose();
  });
});
