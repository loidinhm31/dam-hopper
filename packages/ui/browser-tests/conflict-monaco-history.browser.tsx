import "@/lib/monaco-setup.js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import * as monaco from "monaco-editor";
import { JointHistoryAuthority } from "@/lib/joint-history-authority.js";
import type { RegionDecisionState } from "@/lib/conflict-merge-types.js";
import "@/index.css";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Phase 06: Monaco public joint history authority browser qualification", () => {
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

    // --- UNDO SEQUENCE VIA NATIVE KEYBOARD COMMAND ---
    // Undo 1: should undo second text edit ("Another line\n")
    editorInstance!.focus();
    expect(editorInstance!.hasTextFocus()).toBe(true);
    await act(async () => {
      await userEvent.keyboard("{Control>}z{/Control}");
    });
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    expect(blockDecisions["block-1"]).toBe("ignored"); // metadata unchanged

    // Undo 2: should undo metadata decision ("ignored" -> "pending") WITHOUT touching text!
    await act(async () => {
      await userEvent.keyboard("{Control>}z{/Control}");
    });
    expect(blockDecisions["block-1"]).toBe("pending"); // restored to pending
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n"); // text preserved!

    // Undo 3: should undo first text edit ("User edited line\n")
    await act(async () => {
      await userEvent.keyboard("{Control>}z{/Control}");
    });
    expect(modelInstance!.getValue()).toBe("Initial text\n");
    expect(blockDecisions["block-1"]).toBe("pending");

    // --- REDO SEQUENCE VIA NATIVE KEYBOARD COMMAND ---
    // Redo 1: re-applies first text edit
    await act(async () => {
      await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    });
    expect(modelInstance!.getValue()).toBe("Initial text\nUser edited line\n");
    expect(blockDecisions["block-1"]).toBe("pending");

    // Redo 2: re-applies metadata decision ("pending" -> "ignored")
    await act(async () => {
      await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
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

  it("proves atomic text and metadata transaction undo/redo with snapshot restoration in real Chromium", async () => {
    let editor1: monaco.editor.IStandaloneCodeEditor | null = null;
    let model1: monaco.editor.ITextModel | null = null;
    let decisions: Record<string, RegionDecisionState> = {
      "conflict-1": {
        oursDecision: "pending",
        theirsDecision: "pending",
        bothOrder: null,
        manualReview: "none",
      },
    };

    await act(async () => {
      model1 = monaco.editor.createModel("<<<<<<< ours\nours text\n=======\ntheirs text\n>>>>>>> theirs\n", "plaintext");
      editor1 = monaco.editor.create(container, {
        model: model1,
        automaticLayout: true,
      });
    });

    const history1 = new JointHistoryAuthority(
      editor1!,
      model1!,
      undefined,
      (newDecisions) => {
        decisions = { ...newDecisions };
      },
    );

    // Perform atomic Accept Ours: changes text AND decisions simultaneously
    const initialText = model1!.getValue();
    const acceptedText = "ours text\n";
    const initialDecisions = { ...decisions };
    const acceptedDecisions: Record<string, RegionDecisionState> = {
      "conflict-1": {
        oursDecision: "accepted",
        theirsDecision: "ignored",
        bothOrder: null,
        manualReview: "reviewed",
      },
    };

    await act(async () => {
      model1!.setValue(acceptedText);
      history1.recordAtomicAction(
        "Accept ours",
        initialText,
        acceptedText,
        initialDecisions,
        acceptedDecisions,
      );
      decisions = acceptedDecisions;
    });

    expect(model1!.getValue()).toBe("ours text\n");
    expect(decisions["conflict-1"].oursDecision).toBe("accepted");

    // Undo atomic action: both text and metadata must revert
    act(() => {
      const ok = history1.undo();
      expect(ok).toBe(true);
    });
    expect(model1!.getValue()).toBe(initialText);
    expect(decisions["conflict-1"].oursDecision).toBe("pending");

    // Redo atomic action: both text and metadata must re-apply
    act(() => {
      const ok = history1.redo();
      expect(ok).toBe(true);
    });
    expect(model1!.getValue()).toBe(acceptedText);
    expect(decisions["conflict-1"].oursDecision).toBe("accepted");

    // Capture snapshot, dispose editor1, remount editor2
    const snapshot = history1.getSnapshot();
    history1.dispose();
    editor1?.dispose();
    model1?.dispose();

    let editor2: monaco.editor.IStandaloneCodeEditor | null = null;
    let model2: monaco.editor.ITextModel | null = null;

    await act(async () => {
      model2 = monaco.editor.createModel(snapshot.lastValue, "plaintext");
      editor2 = monaco.editor.create(container, {
        model: model2,
        automaticLayout: true,
      });
    });

    const history2 = new JointHistoryAuthority(
      editor2!,
      model2!,
      undefined,
      (newDecisions) => {
        decisions = { ...newDecisions };
      },
    );
    history2.restoreSnapshot(snapshot);

    // Undo on remounted editor2: restores initialText and pending decision
    act(() => {
      const ok = history2.undo();
      expect(ok).toBe(true);
    });
    expect(model2!.getValue()).toBe(initialText);
    expect(decisions["conflict-1"].oursDecision).toBe("pending");

    history2.dispose();
    editor2?.dispose();
    model2?.dispose();
  });
});
