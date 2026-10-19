import type * as monaco from "monaco-editor";

/**
 * Transaction in the joint history authority.
 */
export type JointTransaction =
  | {
      type: "text";
      beforeValue: string;
      afterValue: string;
      cursorBefore?: monaco.Position | null;
      cursorAfter?: monaco.Position | null;
    }
  | {
      type: "metadata";
      blockId: string;
      beforeDecision: string;
      afterDecision: string;
    };

/**
 * Authoritative Joint History Controller that unifies text edits and metadata review decisions
 * into a single logical undo/redo sequence using public Monaco APIs.
 */
export class JointHistoryAuthority {
  private undoStack: JointTransaction[] = [];
  private redoStack: JointTransaction[] = [];
  private isApplying = false;
  private lastValue: string;
  private contentSubscription: monaco.IDisposable;

  constructor(
    private editor: monaco.editor.IStandaloneCodeEditor,
    private model: monaco.editor.ITextModel,
    private onMetadataChange: (blockId: string, decision: string) => void,
  ) {
    this.lastValue = model.getValue();

    this.contentSubscription = model.onDidChangeContent(() => {
      const currentValue = this.model.getValue();
      if (this.isApplying) {
        this.lastValue = currentValue;
        return;
      }
      const tx: JointTransaction = {
        type: "text",
        beforeValue: this.lastValue,
        afterValue: currentValue,
      };
      this.undoStack.push(tx);
      this.redoStack = []; // Branch after edit clears redo
      this.lastValue = currentValue;
    });

    // Intercept native Monaco undo/redo keyboard commands so they route to joint history
    editor.addCommand(0x800 | 56, () => { // CtrlCmd | KeyZ
      this.undo();
    });
    editor.addCommand(0x800 | 0x400 | 56, () => { // CtrlCmd | Shift | KeyZ
      this.redo();
    });
    editor.addCommand(0x800 | 55, () => { // CtrlCmd | KeyY
      this.redo();
    });
  }

  public dispose(): void {
    this.contentSubscription.dispose();
  }

  public recordMetadataAction(
    blockId: string,
    beforeDecision: string,
    afterDecision: string,
  ): void {
    const tx: JointTransaction = {
      type: "metadata",
      blockId,
      beforeDecision,
      afterDecision,
    };
    this.undoStack.push(tx);
    this.redoStack = []; // Branch after decision clears redo
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    const tx = this.undoStack.pop();
    if (!tx) return false;

    this.isApplying = true;
    try {
      if (tx.type === "metadata") {
        this.onMetadataChange(tx.blockId, tx.beforeDecision);
      } else {
        this.model.setValue(tx.beforeValue);
      }
    } finally {
      this.isApplying = false;
      this.lastValue = this.model.getValue();
    }

    this.redoStack.push(tx);
    return true;
  }

  public redo(): boolean {
    const tx = this.redoStack.pop();
    if (!tx) return false;

    this.isApplying = true;
    try {
      if (tx.type === "metadata") {
        this.onMetadataChange(tx.blockId, tx.afterDecision);
      } else {
        this.model.setValue(tx.afterValue);
      }
    } finally {
      this.isApplying = false;
      this.lastValue = this.model.getValue();
    }

    this.undoStack.push(tx);
    return true;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }
}
