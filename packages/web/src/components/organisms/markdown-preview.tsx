import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils.js";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        "overflow-auto p-4 text-sm text-[var(--color-text)] bg-[var(--color-surface)] leading-relaxed",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mb-4 mt-6 pb-2 border-b border-[var(--color-border)] text-[var(--color-text)]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold mb-3 mt-5 pb-1 border-b border-[var(--color-border)] text-[var(--color-text)]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mb-2 mt-4 text-[var(--color-text)]">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold mb-2 mt-3 text-[var(--color-text)]">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-semibold mb-1 mt-2 text-[var(--color-text)]">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-xs font-semibold mb-1 mt-2 text-[var(--color-text-muted)]">{children}</h6>
          ),
          p: ({ children }) => (
            <p className="mb-3 text-[var(--color-text)] leading-6">{children}</p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--color-text)]">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-[var(--color-text-muted)]">{children}</em>
          ),
          del: ({ children }) => (
            <del className="line-through text-[var(--color-text-muted)] opacity-70">{children}</del>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1 pl-4">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1 pl-4">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-[var(--color-text)] leading-6">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-[var(--color-primary)]/40 pl-4 my-3 text-[var(--color-text-muted)] italic">
              {children}
            </blockquote>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = !!codeClass;
            if (isBlock) {
              const lang = codeClass?.replace("language-", "") ?? "";
              return (
                <div className="relative mb-3">
                  {lang && (
                    <span className="absolute top-2 right-3 text-[10px] text-[var(--color-text-muted)] font-mono uppercase tracking-wider">
                      {lang}
                    </span>
                  )}
                  <pre className="overflow-x-auto rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] p-4 text-xs font-mono text-[var(--color-text)]">
                    <code {...props}>{children}</code>
                  </pre>
                </div>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded text-xs font-mono bg-[var(--color-surface-2)] text-[var(--color-primary)] border border-[var(--color-border)]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
              {children}
            </thead>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/50">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-text)]">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-[var(--color-text)]">{children}</td>
          ),
          hr: () => <hr className="my-4 border-[var(--color-border)]" />,
          img: ({ src, alt }) => {
            const safeSrc =
              src &&
              !src.trimStart().toLowerCase().startsWith("javascript:") &&
              !src.trimStart().toLowerCase().startsWith("data:")
                ? src
                : undefined;
            return <img src={safeSrc} alt={alt ?? ""} className="max-w-full h-auto rounded my-2" />;
          },
          input: ({ type, checked }) => {
            // GFM task list checkboxes
            if (type === "checkbox") {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-1.5 accent-[var(--color-primary)]"
                />
              );
            }
            return <input type={type} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
