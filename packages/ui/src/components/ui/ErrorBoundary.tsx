import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@dam-hopper/shared/logger";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const STALE_CHUNK_RELOAD_KEY = "dam-hopper:stale-chunk-reload-attempted";

export function isStaleChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.name === "ChunkLoadError" ||
    /^Loading chunk \d+ failed(?:[.: (]|$)/i.test(error.message) ||
    /^Failed to fetch dynamically imported module(?::|$)/i.test(
      error.message,
    ) ||
    /^Importing a module script failed(?:\.|$)/i.test(error.message)
  );
}

function reloadOnceForStaleChunk(error: Error): void {
  if (!isStaleChunkError(error) || typeof window === "undefined") return;

  try {
    if (window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) !== null) return;

    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
    window.location.reload();
  } catch {
    // Storage can be unavailable in privacy or sandboxed contexts. Fail closed.
  }
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("ErrorBoundary", "uncaught error", { error, errorInfo });
    recordClientDiagnostic("react.error", "ErrorBoundary", "uncaught error", {
      error,
      componentStack: errorInfo.componentStack,
    });
    reloadOnceForStaleChunk(error);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
          <div className="text-[var(--color-danger)] p-3 rounded-full bg-[var(--color-danger)]/10">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)]">
            Something went wrong
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded hover:bg-[var(--color-primary-hover)] transition-colors text-sm font-medium"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
