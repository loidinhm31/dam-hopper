import React, { type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { MarkdownCode, MarkdownPre } from "./MarkdownCodeBlock.js";

export interface MarkdownLinkPolicy {
  /** Base target-relative path of the current document (e.g. "plans/my-plan/plan.md") */
  currentDocumentPath?: string;
  /** Callback when navigating to another local Markdown document within the target */
  onNavigateLocalMarkdown?: (resolvedPath: string, fragment?: string) => void;
}

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  linkPolicy?: MarkdownLinkPolicy;
}

export function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }
  if (React.isValidElement<{ children?: ReactNode }>(children)) {
    const childProps = children.props;
    if (childProps && typeof childProps === "object" && "children" in childProps) {
      return extractTextFromChildren(childProps.children);
    }
  }
  return "";
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export type LinkResolutionResult =
  | { ok: true; resolvedPath: string; fragment?: string; isMarkdown: boolean }
  | { ok: false; error: string };

export function resolveTargetRelativePath(
  baseDocumentPath: string,
  relativePath: string,
): LinkResolutionResult {
  if (!relativePath || relativePath.includes("\0")) {
    return { ok: false, error: "Invalid path: null byte or empty" };
  }
  try {
    decodeURIComponent(relativePath);
  } catch {
    return { ok: false, error: "Malformed URI encoding" };
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath)) {
    return { ok: false, error: "Unsafe URI scheme" };
  }

  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    return { ok: false, error: "Absolute path rejected" };
  }

  const hashIndex = relativePath.indexOf("#");
  const pathPart = hashIndex >= 0 ? relativePath.slice(0, hashIndex) : relativePath;
  const fragment = hashIndex >= 0 ? relativePath.slice(hashIndex + 1) : undefined;

  if (!pathPart) {
    return { ok: true, resolvedPath: baseDocumentPath, fragment, isMarkdown: true };
  }

  const baseComponents = baseDocumentPath.split("/").filter(Boolean);
  if (baseComponents.length > 0) {
    baseComponents.pop(); // Remove filename
  }

  const relComponents = pathPart.split("/").filter(Boolean);
  const stack = [...baseComponents];

  for (const comp of relComponents) {
    if (comp === ".") continue;
    if (comp === "..") {
      if (stack.length === 0) {
        return { ok: false, error: "Path traversal escape above target root rejected" };
      }
      stack.pop();
    } else {
      stack.push(comp);
    }
  }

  const resolvedPath = stack.join("/");
  const lower = resolvedPath.toLowerCase();
  const isMarkdown = lower.endsWith(".md") || lower.endsWith(".markdown");

  return { ok: true, resolvedPath, fragment, isMarkdown };
}

export function MarkdownPreview({ content, className, linkPolicy }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        "min-w-0 min-h-0 overflow-auto p-4 text-sm text-[var(--color-text)] bg-[var(--color-surface)] leading-relaxed",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h1 id={id || undefined} className="text-2xl font-bold mb-4 mt-6 pb-2 border-b border-[var(--color-border)] text-[var(--color-text)]">
                {children}
              </h1>
            );
          },
          h2: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h2 id={id || undefined} className="text-xl font-semibold mb-3 mt-5 pb-1 border-b border-[var(--color-border)] text-[var(--color-text)]">
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h3 id={id || undefined} className="text-lg font-semibold mb-2 mt-4 text-[var(--color-text)]">
                {children}
              </h3>
            );
          },
          h4: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h4 id={id || undefined} className="text-base font-semibold mb-2 mt-3 text-[var(--color-text)]">
                {children}
              </h4>
            );
          },
          h5: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h5 id={id || undefined} className="text-sm font-semibold mb-1 mt-2 text-[var(--color-text)]">
                {children}
              </h5>
            );
          },
          h6: ({ children }) => {
            const id = slugifyHeading(extractTextFromChildren(children));
            return (
              <h6 id={id || undefined} className="text-xs font-semibold mb-1 mt-2 text-[var(--color-text-muted)]">
                {children}
              </h6>
            );
          },
          p: ({ children }) => (
            <p className="mb-3 text-[var(--color-text)] leading-6">
              {children}
            </p>
          ),
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;

            // Handle fragment navigation on same page
            if (href.startsWith("#")) {
              const targetId = href.slice(1);
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    const targetEl = document.getElementById(targetId);
                    targetEl?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="text-[var(--color-primary)] hover:underline"
                >
                  {children}
                </a>
              );
            }

            // External HTTP/HTTPS links
            if (/^https?:\/\//i.test(href)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-primary)] hover:underline"
                >
                  {children}
                </a>
              );
            }

            // When linkPolicy is active, resolve local target links
            if (linkPolicy) {
              const resolution = resolveTargetRelativePath(
                linkPolicy.currentDocumentPath ?? "",
                href,
              );

              if (!resolution.ok) {
                return (
                  <span
                    className="text-[var(--color-danger)] underline decoration-dotted cursor-not-allowed"
                    title={resolution.error}
                    aria-label={`Unsafe link: ${resolution.error}`}
                  >
                    {children}
                  </span>
                );
              }

              if (!resolution.isMarkdown) {
                return (
                  <span
                    className="text-[var(--color-text-muted)] cursor-not-allowed"
                    title="Non-Markdown local links are not supported"
                    aria-label={`Unsupported link: ${resolution.resolvedPath}`}
                  >
                    {children}
                  </span>
                );
              }

              return (
                <a
                  href={`#${resolution.resolvedPath}`}
                  onClick={(e) => {
                    e.preventDefault();
                    linkPolicy.onNavigateLocalMarkdown?.(
                      resolution.resolvedPath,
                      resolution.fragment,
                    );
                  }}
                  className="text-[var(--color-primary)] hover:underline"
                >
                  {children}
                </a>
              );
            }

            // Default legacy fallback
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                {children}
              </a>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--color-text)]">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-[var(--color-text-muted)]">
              {children}
            </em>
          ),
          del: ({ children }) => (
            <del className="line-through text-[var(--color-text-muted)] opacity-70">
              {children}
            </del>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1 pl-4">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1 pl-4">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-[var(--color-text)] leading-6">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-[var(--color-primary)]/40 pl-4 my-3 text-[var(--color-text-muted)] italic">
              {children}
            </blockquote>
          ),
          code: MarkdownCode,
          pre: MarkdownPre,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
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
            <th className="px-3 py-2 text-left font-semibold text-[var(--color-text)]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-[var(--color-text)]">{children}</td>
          ),
          hr: () => <hr className="my-4 border-[var(--color-border)]" />,
          img: ({ src, alt }) => {
            if (!src) return null;
            const isExternal = /^https?:\/\//i.test(src);

            if (linkPolicy && !isExternal) {
              // Local images produce an accessible notice without media/ticket network fetch
              return (
                <span
                  role="note"
                  aria-label={`Local image reference: ${alt || src}`}
                  className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] my-2"
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>[Image: {alt || src}]</span>
                </span>
              );
            }

            const safeSrc =
              !src.trimStart().toLowerCase().startsWith("javascript:") &&
              !src.trimStart().toLowerCase().startsWith("data:")
                ? src
                : undefined;
            return (
              <img
                src={safeSrc}
                alt={alt ?? ""}
                className="max-w-full h-auto rounded my-2"
              />
            );
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
