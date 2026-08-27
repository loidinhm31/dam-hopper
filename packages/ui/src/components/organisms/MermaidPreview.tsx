import { useEffect, useId, useState } from "react";

type MermaidModule = typeof import("mermaid");
type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error" };
type RenderResult = { source: string; state: RenderState };

const MERMAID_RENDER_DEBOUNCE_MS = 150;
let mermaidModulePromise: Promise<MermaidModule> | undefined;
let mermaidInitialized = false;

function loadMermaid(): Promise<MermaidModule> {
  mermaidModulePromise ??= import("mermaid");
  return mermaidModulePromise;
}

function makeDiagramId(reactId: string): string {
  return `dam-hopper-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function SourceFallback({ source }: { source: string }) {
  return (
    <pre className="max-w-full overflow-x-auto whitespace-pre rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] p-4 text-xs font-mono text-[var(--color-text)]">
      <code>{source}</code>
    </pre>
  );
}

export function MermaidPreview({ source }: { source: string }) {
  const diagramId = makeDiagramId(useId());
  const [renderResult, setRenderResult] = useState<RenderResult>(() => ({
    source,
    state: { status: "loading" },
  }));
  const state: RenderState =
    renderResult.source === source ? renderResult.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;

    const renderTimer = window.setTimeout(() => {
      void loadMermaid()
        .then(({ default: mermaid }) => {
          if (cancelled) return null;
          if (!mermaidInitialized) {
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: "strict",
              suppressErrorRendering: true,
              theme: "dark",
            });
            mermaidInitialized = true;
          }
          return mermaid.render(diagramId, source);
        })
        .then((result) => {
          if (!cancelled && result) {
            setRenderResult({
              source,
              state: { status: "ready", svg: result.svg },
            });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRenderResult({ source, state: { status: "error" } });
          }
        });
    }, MERMAID_RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(renderTimer);
    };
  }, [diagramId, source]);

  if (state.status === "ready") {
    return (
      <div
        data-markdown-mermaid="diagram"
        role="img"
        aria-label="Mermaid diagram"
        className="mb-3 max-w-full overflow-x-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <div data-markdown-mermaid="error" role="alert" className="mb-3">
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Mermaid diagram could not be rendered. Showing the source instead.
        </p>
        <SourceFallback source={source} />
      </div>
    );
  }

  return (
    <div data-markdown-mermaid="loading" aria-busy="true" className="mb-3">
      <p
        aria-live="polite"
        className="mb-2 text-xs text-[var(--color-text-muted)]"
      >
        Rendering Mermaid diagram…
      </p>
      <SourceFallback source={source} />
    </div>
  );
}
