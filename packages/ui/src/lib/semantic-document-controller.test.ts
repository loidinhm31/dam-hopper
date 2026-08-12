import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticDocumentController } from "./semantic-document-controller.js";

function transport(openDocument = vi.fn(() => true)) {
  return {
    openDocument,
    changeDocument: vi.fn(() => true),
    closeDocument: vi.fn(() => true),
  } as never;
}

describe("SemanticDocumentController", () => {
  afterEach(() => vi.useRealTimers());

  it("opens hydrated snapshots and coalesces changes within 50ms", () => {
    vi.useFakeTimers();
    const socket = transport();
    const controller = new SemanticDocumentController(socket);
    const input = {
      profileId: "profile",
      projectId: "project",
      path: "src/main.rs",
      language: "rust" as const,
      text: "fn main() {}",
      hydrated: true,
    };
    controller.sync([input]);
    expect(socket.openDocument).toHaveBeenCalledOnce();
    controller.sync([{ ...input, text: 'fn main() { println!("x"); }' }]);
    controller.sync([{ ...input, text: 'fn main() { println!("y"); }' }]);
    vi.advanceTimersByTime(49);
    expect(socket.changeDocument).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.changeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentVersion: 2,
        text: 'fn main() { println!("y"); }',
      }),
    );
  });

  it("retains unsent hydrated snapshots until replay", () => {
    const openDocument = vi.fn(() => false);
    const socket = transport(openDocument);
    const controller = new SemanticDocumentController(socket);
    const input = {
      profileId: "profile",
      projectId: "project",
      path: "src/main.ts",
      language: "typescript" as const,
      text: "export const value = 1;",
      hydrated: true,
    };
    controller.sync([input]);
    expect(openDocument).toHaveBeenCalledOnce();
    controller.replay("project");
    expect(openDocument).toHaveBeenCalledTimes(2);
    expect(openDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: input.text, documentVersion: 0 }),
    );
  });

  it("closes removed documents and replays current snapshots", () => {
    const socket = transport();
    const controller = new SemanticDocumentController(socket);
    const input = {
      profileId: "profile",
      projectId: "project",
      path: "src/main.ts",
      language: "typescript" as const,
      text: "export const value = 1;",
      hydrated: true,
    };
    controller.sync([input]);
    controller.sync([]);
    expect(socket.closeDocument).toHaveBeenCalledOnce();
    controller.sync([input]);
    controller.replay("project");
    expect(socket.openDocument).toHaveBeenCalledTimes(3);
  });
});
