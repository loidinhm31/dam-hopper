export class TerminalInputBuffer {
  private _buffer = "";
  private _hasEscape = false;

  /** Process a chunk of data from term.onData. */
  append(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i]!;

      if (ch === "\x1b") {
        this._hasEscape = true;
        i = this._skipEscape(data, i) + 1;
        continue;
      }

      if (ch === "\x7f") {
        // Backspace — remove last character
        if (this._buffer.length > 0) this._buffer = this._buffer.slice(0, -1);
        i++;
        continue;
      }

      if (ch === "\x15") {
        // Ctrl+U — kill line
        this._buffer = "";
        i++;
        continue;
      }

      if (ch === "\x17") {
        // Ctrl+W — delete last word
        this._buffer = this._buffer.replace(/\S+\s*$/, "");
        i++;
        continue;
      }

      if (ch === "\r" || ch === "\x03") {
        // Enter or Ctrl+C — reset
        this.reset();
        i++;
        continue;
      }

      // Accept printable characters (space and above, exclude other control chars)
      if (ch >= " ") {
        this._buffer += ch;
      }
      i++;
    }
  }

  reset(): void {
    this._buffer = "";
    this._hasEscape = false;
  }

  get currentInput(): string {
    return this._buffer;
  }

  /** False if any escape sequence was detected this line (cursor movement, etc.) */
  get isClean(): boolean {
    return !this._hasEscape;
  }

  get length(): number {
    return this._buffer.length;
  }

  /** Returns the index of the last byte consumed by the escape sequence. */
  private _skipEscape(data: string, start: number): number {
    const next = data[start + 1];

    if (next === "[") {
      // CSI: ESC [ <params> <final 0x40–0x7e>
      let i = start + 2;
      while (i < data.length) {
        const code = data.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) return i;
        i++;
      }
      return data.length - 1;
    }

    if (next === "O") {
      // SS3: ESC O <final>
      return start + 2;
    }

    // Two-byte escape or truncated sequence
    return start + (next !== undefined ? 1 : 0);
  }
}
