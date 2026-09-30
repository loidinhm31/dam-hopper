/**
 * Streaming bounded UTF-8 SSE parser for host-resource events.
 *
 * Implements strict event boundaries, fatal UTF-8 decoding, line ending
 * normalization (LF, CR, CRLF across chunks), multiline data concatenation,
 * comment extraction for heartbeat tracking, and raw event byte capping.
 */

export const MAX_DATA_EVENT_BYTES = 262_144; // 256 KiB
export const MAX_CONTROL_EVENT_BYTES = 4_096; // 4 KiB

export type HostResourceEventType =
  | "host-resources"
  | "host-resources-status"
  | "host-resources-error";

export interface HostResourceEventPiece {
  kind: "event";
  event: HostResourceEventType;
  data: string;
}

export interface HostResourceCommentPiece {
  kind: "comment";
  comment: string;
}

export interface HostResourceErrorPiece {
  kind: "error";
  error: {
    code: "OVERSIZE_EVENT" | "INVALID_UTF8" | "PROTOCOL_ERROR";
    message: string;
    event?: string;
    bytes?: number;
  };
}

export type ParsedPiece =
  | HostResourceEventPiece
  | HostResourceCommentPiece
  | HostResourceErrorPiece;

export class HostResourceSseParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer: Uint8Array = new Uint8Array(0);
  private currentEventName: string | null = null;
  private dataLines: string[] = [];
  private currentEventRawBytes = 0;
  private discardingUntilBlankLine = false;

  private resetEventState(): void {
    this.currentEventName = null;
    this.dataLines = [];
    this.currentEventRawBytes = 0;
  }

  public push(chunk: Uint8Array): ParsedPiece[] {
    const pieces: ParsedPiece[] = [];
    if (chunk.length === 0) return pieces;

    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }

    let scanIdx = 0;
    while (scanIdx < this.buffer.length) {
      // Find newline delimiter (\n, \r\n, \r)
      let delimiterIdx = -1;
      let delimiterLen = 0;

      for (let i = scanIdx; i < this.buffer.length; i++) {
        const b = this.buffer[i];
        if (b === 0x0a) {
          // \n
          delimiterIdx = i;
          delimiterLen = 1;
          break;
        }
        if (b === 0x0d) {
          // \r or \r\n
          if (i + 1 < this.buffer.length) {
            if (this.buffer[i + 1] === 0x0a) {
              delimiterIdx = i;
              delimiterLen = 2;
            } else {
              delimiterIdx = i;
              delimiterLen = 1;
            }
            break;
          }
          // \r at the very end of buffer; wait for next chunk to determine if \r\n
          break;
        }
      }

      if (delimiterIdx === -1) {
        if (this.discardingUntilBlankLine) {
          const endsWithCr =
            this.buffer.length > 0 &&
            this.buffer[this.buffer.length - 1] === 0x0d;
          this.buffer = endsWithCr ? new Uint8Array([0x0d]) : new Uint8Array(0);
          scanIdx = 0;
          break;
        }
        // Check if pending uncompleted line exceeds data event limit
        if (
          this.currentEventRawBytes + (this.buffer.length - scanIdx) >
          MAX_DATA_EVENT_BYTES
        ) {
          if (!this.discardingUntilBlankLine) {
            pieces.push({
              kind: "error",
              error: {
                code: "OVERSIZE_EVENT",
                message: `Incomplete event exceeded limit of ${MAX_DATA_EVENT_BYTES} bytes`,
                event: this.currentEventName ?? undefined,
                bytes: this.currentEventRawBytes + (this.buffer.length - scanIdx),
              },
            });
            this.discardingUntilBlankLine = true;
            this.resetEventState();
            const endsWithCr =
              this.buffer.length > 0 &&
              this.buffer[this.buffer.length - 1] === 0x0d;
            this.buffer = endsWithCr ? new Uint8Array([0x0d]) : new Uint8Array(0);
            scanIdx = 0;
          }
        }
        break;
      }

      const lineBytes = this.buffer.subarray(scanIdx, delimiterIdx);
      const lineTotalBytes = lineBytes.length + delimiterLen;
      this.currentEventRawBytes += lineTotalBytes;
      scanIdx = delimiterIdx + delimiterLen;

      // Check current event raw byte limits
      const limit =
        this.currentEventName === "host-resources-status" ||
        this.currentEventName === "host-resources-error"
          ? MAX_CONTROL_EVENT_BYTES
          : MAX_DATA_EVENT_BYTES;

      if (this.currentEventRawBytes > limit) {
        if (!this.discardingUntilBlankLine) {
          pieces.push({
            kind: "error",
            error: {
              code: "OVERSIZE_EVENT",
              message: `Event exceeded limit of ${limit} bytes`,
              event: this.currentEventName ?? undefined,
              bytes: this.currentEventRawBytes,
            },
          });
          this.discardingUntilBlankLine = true;
          this.resetEventState();
        }
      }

      if (this.discardingUntilBlankLine) {
        if (lineBytes.length === 0) {
          this.discardingUntilBlankLine = false;
          this.resetEventState();
        }
        continue;
      }

      if (lineBytes.length === 0) {
        // Blank line: dispatch event if data lines exist
        if (this.dataLines.length > 0) {
          if (
            this.currentEventName === "host-resources" ||
            this.currentEventName === "host-resources-status" ||
            this.currentEventName === "host-resources-error"
          ) {
            const requiredLimit =
              this.currentEventName === "host-resources"
                ? MAX_DATA_EVENT_BYTES
                : MAX_CONTROL_EVENT_BYTES;

            if (this.currentEventRawBytes > requiredLimit) {
              pieces.push({
                kind: "error",
                error: {
                  code: "OVERSIZE_EVENT",
                  message: `Event exceeded limit of ${requiredLimit} bytes`,
                  event: this.currentEventName,
                  bytes: this.currentEventRawBytes,
                },
              });
            } else {
              pieces.push({
                kind: "event",
                event: this.currentEventName,
                data: this.dataLines.join("\n"),
              });
            }
          } else {
            pieces.push({
              kind: "error",
              error: {
                code: "PROTOCOL_ERROR",
                message: `Missing or unrecognized event name: ${this.currentEventName ?? "(none)"}`,
                event: this.currentEventName ?? undefined,
              },
            });
          }
        }
        this.resetEventState();
        continue;
      }

      // Decode line bytes
      let lineText: string;
      try {
        lineText = this.decoder.decode(lineBytes);
      } catch (err) {
        pieces.push({
          kind: "error",
          error: {
            code: "INVALID_UTF8",
            message:
              err instanceof Error ? err.message : "Fatal UTF-8 decoding error",
          },
        });
        this.discardingUntilBlankLine = true;
        this.resetEventState();
        continue;
      }

      if (lineText.charCodeAt(0) === 0x3a) {
        // Comment line (: ping or :heartbeat)
        const comment =
          lineText.charCodeAt(1) === 0x20 ? lineText.slice(2) : lineText.slice(1);
        pieces.push({ kind: "comment", comment });
        continue;
      }

      const colonIdx = lineText.indexOf(":");
      let field: string;
      let value: string;
      if (colonIdx === -1) {
        field = lineText;
        value = "";
      } else {
        field = lineText.slice(0, colonIdx);
        value = lineText.slice(colonIdx + 1);
        if (value.charCodeAt(0) === 0x20) {
          value = value.slice(1);
        }
      }

      if (field === "event") {
        this.currentEventName = value;
        if (
          value === "host-resources-status" ||
          value === "host-resources-error"
        ) {
          if (this.currentEventRawBytes > MAX_CONTROL_EVENT_BYTES) {
            pieces.push({
              kind: "error",
              error: {
                code: "OVERSIZE_EVENT",
                message: `Event exceeded limit of ${MAX_CONTROL_EVENT_BYTES} bytes`,
                event: value,
                bytes: this.currentEventRawBytes,
              },
            });
            this.discardingUntilBlankLine = true;
            this.resetEventState();
          }
        }
      } else if (field === "data") {
        this.dataLines.push(value);
      }
    }

    if (scanIdx > 0) {
      this.buffer = this.buffer.subarray(scanIdx);
    }

    return pieces;
  }

  public finish(): void {
    this.buffer = new Uint8Array(0);
    this.resetEventState();
    this.discardingUntilBlankLine = false;
  }
}
