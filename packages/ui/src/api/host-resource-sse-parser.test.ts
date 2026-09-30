import { describe, expect, it } from "vitest";
import {
  HostResourceSseParser,
  MAX_CONTROL_EVENT_BYTES,
  MAX_DATA_EVENT_BYTES,
} from "./host-resource-sse-parser.js";

const encoder = new TextEncoder();

describe("HostResourceSseParser (03-P)", () => {
  it("parses single-line and multi-line data events with named event", () => {
    const parser = new HostResourceSseParser();
    const raw =
      "event: host-resources\n" +
      'data: {"line":1}\n' +
      'data: {"line":2}\n\n';

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual({
      kind: "event",
      event: "host-resources",
      data: '{"line":1}\n{"line":2}',
    });
  });

  it("handles \\r\\n and \\r line endings and chunks split across \\r and \\n", () => {
    const parser = new HostResourceSseParser();

    // Chunk 1 ends with \r
    const chunk1 = encoder.encode("event: host-resources-status\r\ndata: 123\r");
    const pieces1 = parser.push(chunk1);
    expect(pieces1).toEqual([]);

    // Chunk 2 starts with \n to finish \r\n, followed by \r\n (blank line dispatch)
    const chunk2 = encoder.encode("\n\r\n");
    const pieces2 = parser.push(chunk2);
    expect(pieces2).toEqual([
      {
        kind: "event",
        event: "host-resources-status",
        data: "123",
      },
    ]);
  });

  it("extracts comments as heartbeat markers without dispatching events", () => {
    const parser = new HostResourceSseParser();
    const raw = ": ping\n:heartbeat\n\n";

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toEqual([
      { kind: "comment", comment: "ping" },
      { kind: "comment", comment: "heartbeat" },
    ]);
  });

  it("strips optional single space after colon, preserves additional spaces", () => {
    const parser = new HostResourceSseParser();
    const raw = "event: host-resources-error\ndata:   spaced-value  \n\n";

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toEqual([
      {
        kind: "event",
        event: "host-resources-error",
        data: "  spaced-value  ",
      },
    ]);
  });

  it("handles multi-byte UTF-8 split across chunk boundaries safely", () => {
    const parser = new HostResourceSseParser();
    // '🚀' is 4 bytes: 0xF0, 0x9F, 0x99, 0x80
    const part1 = encoder.encode('event: host-resources\ndata: {"emoji":"');
    const rocketBytes = encoder.encode("🚀");
    const split1 = new Uint8Array(part1.length + 2);
    split1.set(part1, 0);
    split1.set(rocketBytes.subarray(0, 2), part1.length);

    const split2 = new Uint8Array(2 + 6);
    split2.set(rocketBytes.subarray(2, 4), 0);
    split2.set(encoder.encode('"}\n\n'), 2);

    const pieces1 = parser.push(split1);
    expect(pieces1).toEqual([]);

    const pieces2 = parser.push(split2);
    expect(pieces2).toHaveLength(1);
    expect(pieces2[0]).toEqual({
      kind: "event",
      event: "host-resources",
      data: '{"emoji":"🚀"}',
    });
  });

  it("emits INVALID_UTF8 on corrupt multi-byte sequence and recovers on next blank line", () => {
    const parser = new HostResourceSseParser();
    const corruptBytes = new Uint8Array([
      ...encoder.encode("event: host-resources\ndata: "),
      0xff,
      0xfe,
      ...encoder.encode("\n\nevent: host-resources-status\ndata: ok\n\n"),
    ]);

    const pieces = parser.push(corruptBytes);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({
      kind: "error",
      error: { code: "INVALID_UTF8" },
    });
    expect(pieces[1]).toEqual({
      kind: "event",
      event: "host-resources-status",
      data: "ok",
    });
  });

  it("enforces MAX_CONTROL_EVENT_BYTES (4 KiB) limit on status/error events", () => {
    const parser = new HostResourceSseParser();
    const oversizeBody = "X".repeat(MAX_CONTROL_EVENT_BYTES + 10);
    const raw = `event: host-resources-status\ndata: ${oversizeBody}\n\n`;

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      kind: "error",
      error: {
        code: "OVERSIZE_EVENT",
        event: "host-resources-status",
      },
    });
  });

  it("enforces MAX_DATA_EVENT_BYTES (256 KiB) limit on data events", () => {
    const parser = new HostResourceSseParser();
    const oversizeBody = "X".repeat(MAX_DATA_EVENT_BYTES + 20);
    const raw = `event: host-resources\ndata: ${oversizeBody}\n\n`;

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      kind: "error",
      error: {
        code: "OVERSIZE_EVENT",
        event: "host-resources",
      },
    });
  });

  it("emits PROTOCOL_ERROR when event name is missing or unrecognized", () => {
    const parser = new HostResourceSseParser();
    const raw = 'data: {"unknown": true}\n\n';

    const pieces = parser.push(encoder.encode(raw));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      kind: "error",
      error: { code: "PROTOCOL_ERROR" },
    });
  });

  it("finish() discards unterminated trailing bytes without emitting event", () => {
    const parser = new HostResourceSseParser();
    parser.push(encoder.encode('event: host-resources\ndata: {"partial": true}'));
    parser.finish();

    // After finish, pushing a new valid event works cleanly
    const pieces = parser.push(
      encoder.encode('event: host-resources\ndata: {"clean": true}\n\n'),
    );
    expect(pieces).toEqual([
      {
        kind: "event",
        event: "host-resources",
        data: '{"clean": true}',
      },
    ]);
  });
});
