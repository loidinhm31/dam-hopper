import * as monaco from "monaco-editor";
import type { RegionDecisionState } from "./conflict-merge-types.js";

/**
 * Transaction in the joint history authority.
 * Supports pure text edits, pure metadata decisions, or atomic combined text+metadata changes.
 */
export interface JointTransaction {
  type: "text" | "metadata" | "atomic";
  description?: string;
  timestamp: number;
  beforeValue: string;
  afterValue: string;
  cursorBefore?: monaco.Position | null;
  cursorAfter?: monaco.Position | null;
  beforeDecisions?: Record<string, RegionDecisionState>;
  afterDecisions?: Record<string, RegionDecisionState>;
  blockId?: string;
  beforeDecision?: string;
  afterDecision?: string;
}

export interface JointHistorySnapshot {
  undoStack: JointTransaction[];
  redoStack: JointTransaction[];
  lastValue: string;
}

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
  private actionDisposables: monaco.IDisposable[] = [];
  private maxDepth: number;

  constructor(
    private editor: monaco.editor.IStandaloneCodeEditor,
    private model: monaco.editor.ITextModel,
    private onMetadataChange?: (blockId: string, decision: string) => void,
    private onDecisionsChange?: (
      decisions: Record<string, RegionDecisionState>,
    ) => void,
    maxDepth = 100,
  ) {
    this.maxDepth = maxDepth;
    this.lastValue = model.getValue();

    this.contentSubscription = model.onDidChangeContent(() => {
      const currentValue = this.model.getValue();
      if (this.isApplying) {
        this.lastValue = currentValue;
        return;
      }
      const tx: JointTransaction = {
        type: "text",
        timestamp: Date.now(),
        beforeValue: this.lastValue,
        afterValue: currentValue,
      };
      this.pushUndo(tx);
      this.redoStack = []; // Branch after edit clears redo
      this.lastValue = currentValue;
    });

    // Intercept native Monaco undo/redo keyboard commands so they route to joint history
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      this.undo();
    });
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      () => {
        this.redo();
      },
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      this.redo();
    });

    // Register Monaco context-menu actions for undo & redo
    const undoAction = editor.addAction({
      id: "joint-history-undo",
      label: "Undo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 0.1,
      run: () => {
        this.undo();
      },
    });
    const redoAction = editor.addAction({
      id: "joint-history-redo",
      label: "Redo",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      ],
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 0.2,
      run: () => {
        this.redo();
      },
    });
    this.actionDisposables.push(undoAction, redoAction);
  }

  private pushUndo(tx: JointTransaction): void {
    this.undoStack.push(tx);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
  }

  public dispose(): void {
    this.contentSubscription.dispose();
    for (const d of this.actionDisposables) {
      d.dispose();
    }
  }

  /**
   * Records a legacy single-block metadata action.
   */
  public recordMetadataAction(
    blockId: string,
    beforeDecision: string,
    afterDecision: string,
  ): void {
    const tx: JointTransaction = {
      type: "metadata",
      timestamp: Date.now(),
      beforeValue: this.lastValue,
      afterValue: this.lastValue,
      blockId,
      beforeDecision,
      afterDecision,
    };
    this.pushUndo(tx);
    this.redoStack = []; // Branch after decision clears redo
  }

  /**
   * Records an atomic action that changes both text and all region decisions together.
   */
  public recordAtomicAction(
    description: string,
    beforeValue: string,
    afterValue: string,
    beforeDecisions: Record<string, RegionDecisionState>,
    afterDecisions: Record<string, RegionDecisionState>,
  ): void {
    const tx: JointTransaction = {
      type: "atomic",
      description,
      timestamp: Date.now(),
      beforeValue,
      afterValue,
      beforeDecisions,
      afterDecisions,
    };
    this.pushUndo(tx);
    this.redoStack = [];
    this.isApplying = true;
    try {
      if (this.model.getValue() !== afterValue) {
        this.model.setValue(afterValue);
      }
    } finally {
      this.isApplying = false;
      this.lastValue = afterValue;
    }
  }

  /**
   * Extracts a serializable snapshot of the current history state.
   */
  public getSnapshot(): JointHistorySnapshot {
    return {
      undoStack: [...this.undoStack],
      redoStack: [...this.redoStack],
      lastValue: this.lastValue,
    };
  }

  /**
   * Restores a previously captured history snapshot (e.g. after editor remount).
   */
  public restoreSnapshot(snapshot: JointHistorySnapshot): void {
    this.undoStack = [...snapshot.undoStack];
    this.redoStack = [...snapshot.redoStack];
    this.lastValue = snapshot.lastValue;
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
      if (tx.beforeDecisions && this.onDecisionsChange) {
        this.onDecisionsChange(tx.beforeDecisions);
      }
      if (tx.blockId && tx.beforeDecision && this.onMetadataChange) {
        this.onMetadataChange(tx.blockId, tx.beforeDecision);
      }
      if (tx.beforeValue !== tx.afterValue) {
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
      if (tx.afterDecisions && this.onDecisionsChange) {
        this.onDecisionsChange(tx.afterDecisions);
      }
      if (tx.blockId && tx.afterDecision && this.onMetadataChange) {
        this.onMetadataChange(tx.blockId, tx.afterDecision);
      }
      if (tx.beforeValue !== tx.afterValue) {
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
