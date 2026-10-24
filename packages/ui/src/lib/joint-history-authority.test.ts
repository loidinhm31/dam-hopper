// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof document !== "undefined" && !(document as unknown as Record<string, unknown>).queryCommandSupported) {
    (document as unknown as Record<string, unknown>).queryCommandSupported = () => false;
  }
});

import "@/lib/monaco-setup.js";
import type * as monaco from "monaco-editor";
import {
  JointHistoryAuthority,
  type JointHistorySnapshot,
} from "./joint-history-authority.js";
import type { RegionDecisionState } from "./conflict-merge-types.js";

// Mock Monaco Editor & Model for lightweight unit testing
function createMockMonaco(initialText = "Initial text\n") {
  let content = initialText;
  const contentListeners: Array<() => void> = [];

  const model = {
    getValue: () => content,
    setValue: (val: string) => {
      content = val;
      contentListeners.forEach((fn) => fn());
    },
    onDidChangeContent: (listener: () => void) => {
      contentListeners.push(listener);
      return {
        dispose: () => {
          const idx = contentListeners.indexOf(listener);
          if (idx !== -1) contentListeners.splice(idx, 1);
        },
      };
    },
    applyEdits: (edits: Array<{ text: string }>) => {
      content += edits.map((e) => e.text).join("");
      contentListeners.forEach((fn) => fn());
    },
  };

  const editor = {
    addCommand: vi.fn(),
    addAction: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  };
  return {
    editor: editor as unknown as monaco.editor.IStandaloneCodeEditor,
    model: model as unknown as monaco.editor.ITextModel,
  };
}

describe("JointHistoryAuthority Unit Invariants", () => {
  it("records atomic action with text and decision states, restoring both on undo", () => {
    const { editor, model } = createMockMonaco("Start\n");
    let currentDecisions: Record<string, RegionDecisionState> = {
      "conflict-1": {
        oursDecision: "pending",
        theirsDecision: "pending",
        bothOrder: null,
        manualReview: "none",
      },
    };

    const history = new JointHistoryAuthority(
      editor,
      model,
      undefined,
      (decisions) => {
        currentDecisions = { ...decisions };
      },
    );

    const initialDecisions = { ...currentDecisions };
    const acceptedDecisions: Record<string, RegionDecisionState> = {
      "conflict-1": {
        oursDecision: "accepted",
        theirsDecision: "ignored",
        bothOrder: null,
        manualReview: "reviewed",
      },
    };

    // User applies an atomic accept action
    model.setValue("Start\nOurs line\n");
    history.recordAtomicAction(
      "Accept ours",
      "Start\n",
      "Start\nOurs line\n",
      initialDecisions,
      acceptedDecisions,
    );
    currentDecisions = acceptedDecisions;

    expect(model.getValue()).toBe("Start\nOurs line\n");
    expect(currentDecisions["conflict-1"].oursDecision).toBe("accepted");
    expect(history.canUndo()).toBe(true);

    // Undo: must restore both text and decisions
    const undone = history.undo();
    expect(undone).toBe(true);
    expect(model.getValue()).toBe("Start\n");
    expect(currentDecisions["conflict-1"].oursDecision).toBe("pending");
    expect(history.canRedo()).toBe(true);

    // Redo: must restore both text and decisions
    const redone = history.redo();
    expect(redone).toBe(true);
    expect(model.getValue()).toBe("Start\nOurs line\n");
    expect(currentDecisions["conflict-1"].oursDecision).toBe("accepted");

    history.dispose();
  });

  it("clears redo stack upon new text edit after undo", () => {
    const { editor, model } = createMockMonaco("Base\n");
    const history = new JointHistoryAuthority(editor, model);

    model.applyEdits([{ text: "Edit 1\n" }]);
    expect(history.getUndoCount()).toBe(1);

    model.applyEdits([{ text: "Edit 2\n" }]);
    expect(history.getUndoCount()).toBe(2);

    history.undo();
    expect(history.canRedo()).toBe(true);
    expect(history.getRedoCount()).toBe(1);

    // New edit after undo creates a branch: clears redo stack
    model.applyEdits([{ text: "Branch edit\n" }]);
    expect(history.canRedo()).toBe(false);
    expect(history.getRedoCount()).toBe(0);

    history.dispose();
  });

  it("bounds undo stack to maxDepth", () => {
    const { editor, model } = createMockMonaco("Base\n");
    const maxDepth = 5;
    const history = new JointHistoryAuthority(
      editor,
      model,
      undefined,
      undefined,
      maxDepth,
    );

    for (let i = 0; i < 10; i++) {
      model.applyEdits([{ text: `line ${i}\n` }]);
    }

    expect(history.getUndoCount()).toBe(maxDepth);
    history.dispose();
  });

  it("captures and restores history snapshots across editor remounts", () => {
    const { editor: editor1, model: model1 } = createMockMonaco("V1\n");
    const history1 = new JointHistoryAuthority(editor1, model1);

    model1.applyEdits([{ text: "V2\n" }]);
    model1.applyEdits([{ text: "V3\n" }]);
    history1.undo(); // now 1 in redo

    const snapshot = history1.getSnapshot();
    history1.dispose();

    // Re-mount on second editor
    const { editor: editor2, model: model2 } = createMockMonaco(snapshot.lastValue);
    const history2 = new JointHistoryAuthority(editor2, model2);
    history2.restoreSnapshot(snapshot);

    expect(history2.canUndo()).toBe(true);
    expect(history2.canRedo()).toBe(true);

    history2.redo();
    expect(model2.getValue()).toBe("V1\nV2\nV3\n");

    history2.dispose();
  });
});
