import { describe, expect, it } from "vitest";
import {
  combineCommitMessages,
  deriveGitSquashSelection,
} from "./git-squash-selection.js";
import { squashEntry } from "@/test-fixtures/git-squash.js";

describe("parent-chain squash selection", () => {
  it("orders scrambled/interleaved filtered rows from oldest to newest without timestamps", () => {
    const logs = [
      squashEntry("C", ["B"]),
      squashEntry("X", ["Y"]),
      squashEntry("A", ["P"]),
      squashEntry("B", ["A"]),
    ];
    const result = deriveGitSquashSelection(logs, ["C", "A", "B"]);
    expect(result.valid).toBe(true);
    expect(result.orderedHashes).toEqual(["A", "B", "C"]);
    expect(result.entries.map((entry) => entry.hash)).toEqual(["A", "B", "C"]);
  });
  it("allows root-inclusive chains", () => {
    expect(
      deriveGitSquashSelection(
        [squashEntry("B", ["A"]), squashEntry("A", [])],
        ["B", "A"],
      ).orderedHashes,
    ).toEqual(["A", "B"]);
  });
  it.each([
    { name: "one", logs: [squashEntry("A", [])], hashes: ["A"] },
    { name: "unknown", logs: [squashEntry("A", [])], hashes: ["A", "B"] },
    { name: "duplicate", logs: [squashEntry("A", [])], hashes: ["A", "A"] },
    {
      name: "visible gap",
      logs: [squashEntry("C", ["B"]), squashEntry("A", ["P"])],
      hashes: ["C", "A"],
    },
    {
      name: "disconnected",
      logs: [squashEntry("A", []), squashEntry("B", [])],
      hashes: ["A", "B"],
    },
    {
      name: "fork",
      logs: [
        squashEntry("A", []),
        squashEntry("B", ["A"]),
        squashEntry("C", ["A"]),
      ],
      hashes: ["A", "B", "C"],
    },
    {
      name: "duplicate page rows",
      logs: [
        squashEntry("A", []),
        squashEntry("A", []),
        squashEntry("B", ["A"]),
      ],
      hashes: ["A", "B"],
    },
    {
      name: "merge",
      logs: [squashEntry("A", []), squashEntry("B", ["A", "X"])],
      hashes: ["A", "B"],
    },
    {
      name: "cycle",
      logs: [squashEntry("A", ["B"]), squashEntry("B", ["A"])],
      hashes: ["A", "B"],
    },
  ])("rejects $name without fetching hidden ancestors", ({ logs, hashes }) => {
    const result = deriveGitSquashSelection(logs, hashes);
    expect(result.valid).toBe(false);
    expect(result.disabledReason).toBeTruthy();
    expect(result.orderedHashes).toEqual([]);
  });
});
describe("complete commit message composition", () => {
  it.each([
    [["a\n", "b\n"], "a\n\nb\n"],
    [["a", "b"], "a\n\nb\n"],
    [
      ["Cũ\n\nNội dung  \n\n", "Mới\n\nSigned-off-by: Đặng <x@y>"],
      "Cũ\n\nNội dung  \n\n\nMới\n\nSigned-off-by: Đặng <x@y>\n",
    ],
  ])(
    "preserves bodies, trailers, whitespace and LF boundaries",
    (messages, expected) => {
      expect(combineCommitMessages(messages as string[])).toBe(expected);
    },
  );
});
