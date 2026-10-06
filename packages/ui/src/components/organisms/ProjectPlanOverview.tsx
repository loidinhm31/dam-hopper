// Selected-plan Overview tab component for Project Plans Dashboard — Phase 04
// Aligned with contracts.md section 1, 5, 8 and phase-04-dashboard-and-document-details.md

import React, { useMemo } from "react";
import {
  GitBranch,
  AlertTriangle,
  ExternalLink,
  Tag,
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { cn } from "@/lib/utils.js";
import type {
  FilePlan,
  PlanStatus,
} from "@/api/project-plans-types.js";

export interface ProjectPlanOverviewProps {
  plan: FilePlan;
  onNavigateDocument: (path: string) => void;
  className?: string;
}

export function getStatusBadgeClass(status: PlanStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
    case "in-progress":
      return "bg-blue-500/15 text-blue-600 border-blue-500/30";
    case "pending":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30";
    case "blocked":
      return "bg-red-500/15 text-red-600 border-red-500/30";
    case "cancelled":
      return "bg-slate-500/15 text-slate-600 border-slate-500/30";
    case "conflict":
      return "bg-rose-500/15 text-rose-600 border-rose-500/30";
    case "unknown":
    default:
      return "bg-zinc-500/15 text-zinc-600 border-zinc-500/30";
  }
}

export function ProjectPlanOverview({
  plan,
  onNavigateDocument,
  className,
}: ProjectPlanOverviewProps) {
  const isTitleMissing = !plan.title;
  const displayTitle = plan.title || `[Directory: ${plan.id}]`;

  const issueUrl = useMemo(() => {
    if (!plan.metadata.issue) return null;
    const issueVal = plan.metadata.issue.trim();
    if (/^https?:\/\//i.test(issueVal)) return issueVal;
    return null;
  }, [plan.metadata.issue]);

  return (
    <div className={cn("flex flex-col gap-5 p-4 max-w-5xl mx-auto text-xs", className)}>
      {/* Title & Description Header */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            className={cn(
              "text-lg font-bold text-[var(--color-text)]",
              isTitleMissing && "font-mono text-sm text-[var(--color-text-muted)]",
            )}
          >
            {displayTitle}
          </h2>
          <Badge
            variant="neutral"
            className={cn("capitalize font-semibold", getStatusBadgeClass(plan.reportedStatus.value))}
          >
            {plan.reportedStatus.value}
          </Badge>
          <span className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded">
            Authority: <strong>{plan.reportedStatus.authority}</strong>
          </span>
        </div>

        {plan.description && (
          <p className="text-xs text-[var(--color-text-muted)] leading-relaxed mt-1">
            {plan.description}
          </p>
        )}
      </div>

      {/* Metadata Pill Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 p-3">
        <div>
          <span className="text-[11px] text-[var(--color-text-muted)] block">Priority</span>
          <span className="font-semibold text-[var(--color-text)]">
            {plan.metadata.priority || "—"}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-[var(--color-text-muted)] block">Effort</span>
          <span className="font-semibold text-[var(--color-text)]">
            {plan.metadata.effort || "—"}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-[var(--color-text-muted)] block">Branch</span>
          {plan.metadata.branch ? (
            <span className="inline-flex items-center gap-1 font-mono text-[var(--color-text)]">
              <GitBranch className="h-3 w-3 text-[var(--color-primary)] shrink-0" />
              {plan.metadata.branch}
            </span>
          ) : (
            "—"
          )}
        </div>
        <div>
          <span className="text-[11px] text-[var(--color-text-muted)] block">Issue</span>
          {issueUrl ? (
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline font-mono"
            >
              <span>{plan.metadata.issue}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : plan.metadata.issue ? (
            <span className="font-mono text-[var(--color-text)]">{plan.metadata.issue}</span>
          ) : (
            "—"
          )}
        </div>
      </div>

      {/* Tags row */}
      {plan.metadata.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
          {plan.metadata.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Completion & Phase Summary Box */}
      <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/20 p-3.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-xs text-[var(--color-text)]">
            Known Completed Phases
          </span>
          <span className="font-mono font-semibold text-xs text-[var(--color-primary)]">
            {plan.completion.fraction !== null
              ? `${Math.round(plan.completion.fraction * 100)}%`
              : "Unavailable"}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative h-2 w-full rounded-full bg-[var(--color-surface-2)] overflow-hidden">
          {plan.completion.fraction !== null && (
            <div
              style={{ width: `${Math.round(plan.completion.fraction * 100)}%` }}
              className="h-full bg-[var(--color-primary)] rounded-full transition-all"
            />
          )}
        </div>

        {/* Counts breakdown */}
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-text-muted)] mt-1">
          <span>
            Declared: <strong className="text-[var(--color-text)]">{plan.completion.declared ?? "None"}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
            Completed: <strong className="text-[var(--color-text)]">{plan.completion.completed}</strong>
          </span>
          {plan.completion.unknown > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--color-warning)]">
              <HelpCircle className="h-3 w-3 shrink-0" />
              Unknown: <strong>{plan.completion.unknown}</strong>
            </span>
          )}
          {plan.completion.conflicted > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              Conflicted: <strong>{plan.completion.conflicted}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Declared Phases Inventory Table */}
      <div className="flex flex-col gap-2">
        <span className="font-semibold text-xs text-[var(--color-text)]">
          Declared Phases ({plan.phases.length})
        </span>

        {plan.phases.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-text-muted)]">
            No declared phases found in plan.md table.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-[var(--color-text-muted)]">
                  <th className="px-3 py-2 font-medium w-12">#</th>
                  <th className="px-3 py-2 font-medium">Phase</th>
                  <th className="px-3 py-2 font-medium w-28">Status</th>
                  <th className="px-3 py-2 font-medium">Details / Evidence</th>
                </tr>
              </thead>
              <tbody>
                {plan.phases.map((ph, idx) => (
                  <tr
                    key={ph.id || idx}
                    className="border-b last:border-b-0 border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/30"
                  >
                    <td className="px-3 py-2 font-mono text-[var(--color-text-muted)]">
                      {ph.number !== null ? String(ph.number).padStart(2, "0") : "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                      {ph.path ? (
                        <button
                          type="button"
                          onClick={() => onNavigateDocument(ph.path!)}
                          className="text-[var(--color-primary)] hover:underline text-left"
                        >
                          {ph.title || ph.path}
                        </button>
                      ) : (
                        ph.title || ph.id
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-block rounded px-2 py-0.5 text-[11px] font-medium capitalize",
                          getStatusBadgeClass(ph.reportedStatus.value),
                        )}
                      >
                        {ph.reportedStatus.value}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {ph.evidenceLinks.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {ph.evidenceLinks.map((link, lIdx) => (
                            <button
                              key={lIdx}
                              type="button"
                              onClick={() => onNavigateDocument(link)}
                              className="text-[11px] font-mono text-[var(--color-primary)] hover:underline bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded"
                            >
                              {link}
                            </button>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Diagnostics Section */}
      {plan.diagnostics.length > 0 && (
        <div
          role="region"
          aria-label="Plan diagnostics"
          className="flex flex-col gap-2 rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Diagnostics ({plan.diagnostics.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {plan.diagnostics.map((d, idx) => (
              <div key={idx} className="flex items-start gap-1 text-[11px]">
                <strong className="font-mono">[{d.code}]</strong>
                <span>{d.message}</span>
                {d.path && (
                  <span className="font-mono text-[var(--color-text-muted)]">
                    ({d.path}{d.line ? `:${d.line}` : ""})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
