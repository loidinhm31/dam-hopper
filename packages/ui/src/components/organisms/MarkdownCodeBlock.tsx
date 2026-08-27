import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils.js";
import { MermaidPreview } from "./MermaidPreview.js";

function getLanguage(codeClass?: string): string {
  return codeClass?.match(/(?:^|\s)language-([^\s]+)/i)?.[1] ?? "";
}

function getChild(children: ReactNode) {
  const child = Children.toArray(children)[0];
  return isValidElement(child) ? child : undefined;
}

function getChildClassName(children: ReactNode): string | undefined {
  const child = getChild(children);
  const className = (child?.props as { className?: unknown } | undefined)
    ?.className;
  return typeof className === "string" ? className : undefined;
}

function isMermaidChild(children: ReactNode): boolean {
  return (
    getChild(children)?.type === MermaidPreview ||
    getLanguage(getChildClassName(children)).toLowerCase() === "mermaid"
  );
}

export function MarkdownCode({
  className: codeClass,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const language = getLanguage(codeClass);
  if (language.toLowerCase() === "mermaid") {
    return <MermaidPreview source={String(children ?? "")} />;
  }

  return (
    <code
      className={cn(
        codeClass,
        "px-1.5 py-0.5 rounded text-xs font-mono border border-[var(--color-border)]",
        codeClass
          ? "text-[var(--color-text)]"
          : "bg-[var(--color-surface-2)] text-[var(--color-primary)]",
      )}
    >
      {children}
    </code>
  );
}

export function MarkdownPre({ children }: { children?: ReactNode }) {
  if (isMermaidChild(children)) return <>{children}</>;

  const language = getLanguage(getChildClassName(children));
  return (
    <div className="relative mb-3 max-w-full">
      {language && (
        <span className="absolute top-2 right-3 text-[10px] text-[var(--color-text-muted)] font-mono uppercase tracking-wider">
          {language}
        </span>
      )}
      <pre className="max-w-full overflow-x-auto whitespace-pre rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] p-4 text-xs font-mono text-[var(--color-text)] [&>code]:rounded-none [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[var(--color-text)]">
        {children}
      </pre>
    </div>
  );
}
