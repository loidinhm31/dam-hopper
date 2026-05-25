import { describe, expect, it } from "vitest";
import {
  createCommandRowIdState,
  ensureCommandRowId,
  removeCommandRowId,
  renameCommandRowId,
} from "./ConfigEditor.js";

describe("command row ids", () => {
  it("preserves a row id when a command key is renamed", () => {
    const initialState = createCommandRowIdState();
    const firstRow = ensureCommandRowId(initialState, "cmd1");
    const renamedState = renameCommandRowId(firstRow.state, "cmd1", "test");
    const renamedRow = ensureCommandRowId(renamedState, "test");

    expect(renamedRow.id).toBe(firstRow.id);
    expect(renamedRow.state.ids).toEqual({ test: firstRow.id });
  });

  it("removes row ids when commands are deleted", () => {
    const firstRow = ensureCommandRowId(createCommandRowIdState(), "cmd1");
    const secondRow = ensureCommandRowId(firstRow.state, "cmd2");
    const nextState = removeCommandRowId(secondRow.state, "cmd1");

    expect(nextState.ids).toEqual({ cmd2: secondRow.id });
    expect(nextState.nextId).toBe(2);
  });
});
