import type { ProcessLogEntry } from "./types.js";

/**
 * Circular buffer for process log lines. Keeps the last N entries in memory.
 * Simple array-based implementation (maxSize=1000 is small enough).
 */
export class LogBuffer {
  private buffer: ProcessLogEntry[] = [];

  constructor(private readonly maxSize: number = 1000) {}

  push(entry: ProcessLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize);
    }
  }

  getAll(): ProcessLogEntry[] {
    return this.buffer.slice();
  }

  getLast(n: number): ProcessLogEntry[] {
    return this.buffer.slice(-n);
  }

  clear(): void {
    this.buffer = [];
  }

  get size(): number {
    return this.buffer.length;
  }
}
