import { useState } from "react";
import type { UsageSessionNode } from "@/api/client.js";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { UsageSessionViewState } from "./UsageSessionList.js";
import {
  UsageSessionCoverage,
  UsageSessionTokens,
} from "./UsageSessionTokens.js";

export interface UsageSessionTreeProps {
  nodes: UsageSessionNode[];
  state?: UsageSessionViewState;
  errorMessage?: string;
  truncated?: boolean;
  maxNodes?: number;
  className?: string;
}

type NodeMap = Map<string | null, UsageSessionNode[]>;

function buildChildren(nodes: UsageSessionNode[]): NodeMap {
  return nodes.reduce<NodeMap>((children, node) => {
    const siblings = children.get(node.parentId) || [];
    siblings.push(node);
    children.set(node.parentId, siblings);
    return children;
  }, new Map());
}

function roleLabel(role: UsageSessionNode["role"]): string {
  return role === "subagent" ? "Subagent" : role === "main" ? "Main" : "Root";
}

function TreeNode({
  node,
  children,
  parentRole,
}: {
  node: UsageSessionNode;
  children: NodeMap;
  parentRole?: string;
}) {
  const descendants = children.get(node.id) || [];
  const [expanded, setExpanded] = useState(true);
  const hasChildren = descendants.length > 0;
  const status = node.endedAtUtcMs === null ? "Active" : "Ended";

  return (
    <li className="min-w-0">
      <div
        className="flex gap-1.5 py-2"
        style={{ paddingInlineStart: `${Math.min(node.depth, 6) * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${roleLabel(node.role)} node`}
            onClick={() => setExpanded((value) => !value)}
            className="-my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="w-11 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--color-text)]">
            {roleLabel(node.role)}{" "}
            <span className="font-normal text-[var(--color-text-muted)]">
              · {node.model || "Model unavailable"} · {status}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
            {parentRole ? `Parent: ${parentRole}` : "No parent"}
          </p>
          <UsageSessionTokens tokens={node.tokens} className="mt-1" />
          <UsageSessionCoverage coverage={node.coverage} className="mt-1.5" />
        </div>
      </div>
      {hasChildren && expanded ? (
        <ul>
          {descendants.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              children={children}
              parentRole={roleLabel(node.role)}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function UsageSessionTree({
  nodes,
  state = "ready",
  errorMessage,
  truncated = false,
  maxNodes,
  className,
}: UsageSessionTreeProps) {
  if (state === "loading")
    return (
      <section
        aria-busy="true"
        className={cn(
          "rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        Loading session detail…
      </section>
    );
  if (state === "error")
    return (
      <section
        role="alert"
        className={cn(
          "rounded border border-[var(--color-danger)]/50 bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text)]",
          className,
        )}
      >
        {errorMessage || "Session detail could not be loaded."}
      </section>
    );
  if (state === "empty" || nodes.length === 0)
    return (
      <section
        className={cn(
          "rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]",
          className,
        )}
      >
        No session nodes are available.
      </section>
    );

  const children = buildChildren(nodes);
  const roots =
    children.get(null) ||
    nodes.filter(
      (node) => !nodes.some((candidate) => candidate.id === node.parentId),
    );
  return (
    <section
      aria-labelledby="usage-session-tree-heading"
      className={cn(
        "rounded border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <h3
          id="usage-session-tree-heading"
          className="text-xs font-semibold text-[var(--color-text)]"
        >
          Session tree
        </h3>
      </div>
      {truncated ? (
        <p
          role="status"
          className="border-b border-[var(--color-border)] px-3 py-2 text-[10px] leading-4 text-[var(--color-text-muted)]"
        >
          Tree truncated after {maxNodes ?? "the configured"} nodes; additional
          lineage is not shown.
        </p>
      ) : null}
      <ul className="px-3 py-1">
        {roots.map((node) => (
          <TreeNode key={node.id} node={node} children={children} />
        ))}
      </ul>
    </section>
  );
}
