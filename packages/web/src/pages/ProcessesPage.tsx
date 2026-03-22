import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";

export function ProcessesPage() {
  const [sessions, setSessions] = useState<string[]>([]);

  useEffect(() => {
    // Poll active PTY session IDs
    let cancelled = false;

    async function refresh() {
      try {
        const ids = await window.devhub.terminal.list();
        if (!cancelled) setSessions(ids);
      } catch {
        // Ignore — terminal API may not be available yet
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function stopSession(id: string) {
    window.devhub.terminal.kill(id);
    setSessions((prev) => prev.filter((s) => s !== id));
  }

  return (
    <AppLayout title="Processes">
      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-3 text-left font-medium">Session ID</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                >
                  No active terminal sessions
                </td>
              </tr>
            )}
            {sessions.map((id) => (
              <tr
                key={id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text)]">
                  {id}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="success">running</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => stopSession(id)}
                    title="Kill session"
                  >
                    <Square className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
