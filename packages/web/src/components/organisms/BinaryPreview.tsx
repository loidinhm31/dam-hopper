/**
 * BinaryPreview — hex dump of the first 4 KB of a binary file.
 * Receives raw base64 content.
 */
import { Binary } from "lucide-react";

const PREVIEW_BYTES = 4096;
const BYTES_PER_ROW = 16;

interface BinaryPreviewProps {
  /** Base64-encoded file content (first 4 KB from server). */
  base64: string;
  fileName: string;
  mime?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.slice(0, Math.ceil((PREVIEW_BYTES * 4) / 3)));
  const len = Math.min(binary.length, PREVIEW_BYTES);
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

function hex2(n: number) {
  return n.toString(16).padStart(2, "0").toUpperCase();
}

export function BinaryPreview({ base64, fileName, mime }: BinaryPreviewProps) {
  const bytes = b64ToBytes(base64);
  const rows: number[][] = [];

  for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
    rows.push(Array.from(bytes.slice(i, i + BYTES_PER_ROW)));
  }

  return (
    <div className="h-full flex flex-col glass-card">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <Binary className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        <span className="text-xs text-[var(--color-text)]">{fileName}</span>
        {mime && (
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{mime}</span>
        )}
      </div>

      {/* Hex grid */}
      <div className="flex-1 overflow-auto p-3 font-mono text-[11px] text-[var(--color-text)]">
        <table className="border-separate" style={{ borderSpacing: "0 2px" }}>
          <tbody>
            {rows.map((row, rowIdx) => {
              const offset = rowIdx * BYTES_PER_ROW;
              const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
              return (
                <tr key={rowIdx}>
                  <td className="pr-4 text-[var(--color-text-muted)] select-none whitespace-nowrap">
                    {offset.toString(16).padStart(8, "0").toUpperCase()}
                  </td>
                  <td className="pr-4 whitespace-nowrap">
                    {row.map((b, i) => (
                      <span key={i}>
                        <span className={i === 8 ? "ml-3" : ""}>{hex2(b)}</span>
                        {i < row.length - 1 && " "}
                      </span>
                    ))}
                    {/* Pad short last row */}
                    {row.length < BYTES_PER_ROW &&
                      " ".repeat((BYTES_PER_ROW - row.length) * 3 + (row.length <= 8 ? 3 : 0))}
                  </td>
                  <td className="text-[var(--color-text-muted)] select-none whitespace-nowrap">
                    {ascii}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {bytes.length === PREVIEW_BYTES && (
          <p className="mt-3 text-[10px] text-[var(--color-text-muted)] italic">
            Showing first {PREVIEW_BYTES.toLocaleString()} bytes only.
          </p>
        )}
      </div>
    </div>
  );
}
