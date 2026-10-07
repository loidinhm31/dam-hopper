// Selected-plan Timeline component for Project Plans Dashboard — Phase 04
// Aligned with contracts.md section 6 and phase-04-dashboard-and-document-details.md

import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  AlertTriangle,
  Clock,
  Flag,
  ArrowRight,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { FilePlan, DateEvidence } from "@/api/project-plans-types.js";
import {
  projectPlanTimeline,
  formatTimelineDate,
} from "@/lib/project-plans-timeline.js";

export interface ProjectPlanTimelineProps {
  plan: FilePlan;
  nowMs?: number;
  className?: string;
}

export function ProjectPlanTimeline({
  plan,
  nowMs: externalNowMs,
  className,
}: ProjectPlanTimelineProps) {
  const [internalNowMs, setInternalNowMs] = useState(() => Date.now());
  const effectiveNowMs = externalNowMs ?? internalNowMs;

  const projection = useMemo(
    () =>
      projectPlanTimeline(
        plan.dates,
        plan.reportedStatus.value,
        effectiveNowMs,
      ),
    [plan.dates, plan.reportedStatus.value, effectiveNowMs],
  );

  // Update nowMs only when a visible open actual bar is active and no external override is fixed
  useEffect(() => {
    if (!projection.hasActiveOpenBar || externalNowMs !== undefined) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        setInternalNowMs(Date.now());
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [projection.hasActiveOpenBar, externalNowMs]);

  const dateDiagnostics = useMemo(
    () =>
      plan.diagnostics.filter(
        (d) => d.code === "INVALID_DATE" || d.code === "DATE_CONFLICT",
      ),
    [plan.diagnostics],
  );

  const evidenceEntries: { label: string; evidence: DateEvidence | null; isFreshnessOnly?: boolean }[] = [
    { label: "Created", evidence: plan.dates.created },
    { label: "Planned Start", evidence: plan.dates.plannedStart },
    { label: "Planned End", evidence: plan.dates.plannedEnd },
    { label: "Actual Start", evidence: plan.dates.actualStart },
    { label: "Actual End", evidence: plan.dates.actualEnd },
    { label: "Published (Freshness Only)", evidence: plan.dates.published, isFreshnessOnly: true },
  ];

  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-3 text-xs text-[var(--color-text)] bg-[var(--color-surface)] min-w-0",
        className,
      )}
      role="region"
      aria-label="Selected Plan Timeline"
    >
      {/* Legend & Precision Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2">
        <div
          className="flex flex-wrap items-center gap-3"
          aria-label="Timeline legend"
        >
          <span className="font-semibold text-[var(--color-text)]">Legend:</span>
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <span
              className="inline-block w-5 h-2.5 rounded-xs border border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/10"
              aria-hidden="true"
            />
            <span>[- - -] Outlined (Planned)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <span
              className="inline-block w-5 h-2.5 rounded-xs bg-[var(--color-primary)]"
              aria-hidden="true"
            />
            <span>[━━━] Solid (Actual)</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <span
              className="inline-block w-5 h-2.5 rounded-xs bg-[var(--color-primary)] border-r-2 border-[var(--color-text)]"
              aria-hidden="true"
            />
            <span>[━━▶] Open (In Progress → Now/Today)</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
            <Flag className="h-3 w-3 text-[var(--color-primary)]" aria-hidden="true" />
            <span>[◆] Milestone</span>
          </span>
        </div>

        {projection.dominantPrecision && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface)] px-2 py-0.5 rounded border border-[var(--color-border)]">
            <Clock className="h-3 w-3 shrink-0" />
            <span>
              Precision:{" "}
              <strong className="text-[var(--color-text)]">
                {projection.dominantPrecision === "day"
                  ? "Calendar Day (Inclusive)"
                  : projection.dominantPrecision === "instant"
                    ? "Instant (UTC)"
                    : "Mixed (Day & Instant)"}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Date Warnings & Diagnostics */}
      {(projection.warnings.length > 0 || dateDiagnostics.length > 0) && (
        <div
          role="alert"
          aria-label="Timeline date warnings"
          className="flex flex-col gap-1 rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-[var(--color-warning)]"
        >
          {projection.warnings.map((w, idx) => (
            <div key={`warn-${idx}`} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
          {dateDiagnostics.map((d, idx) => (
            <div key={`diag-${idx}`} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                [{d.code}] {d.message}
                {d.path ? ` (${d.path}${d.line ? `:${d.line}` : ""})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Undated State */}
      {projection.isUndated ? (
        <div
          role="status"
          aria-label="Undated plan state"
          className="flex flex-col items-center justify-center rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)]/20 p-6 text-center gap-2"
        >
          <Calendar className="h-7 w-7 text-[var(--color-text-muted)]/60" />
          <span className="font-semibold text-[var(--color-text)] text-sm">
            Undated Plan
          </span>
          <p className="text-xs text-[var(--color-text-muted)] max-w-md">
            No explicit creation, planned schedule, or actual execution dates are declared for this plan. Document freshness timestamps are not used to fabricate timeline bars.
          </p>
          {plan.dates.published && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)] px-2.5 py-1 rounded">
              <Info className="h-3 w-3 shrink-0" />
              <span>
                Published (Freshness only):{" "}
                {formatTimelineDate(
                  plan.dates.published.value,
                  plan.dates.published.precision,
                )}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Horizontal Scrollable Timeline Track */
        <div className="w-full overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/20 p-3">
          <div className="min-w-[440px] flex flex-col gap-4">
            {/* Scale Ticks */}
            <div className="relative h-5 border-b border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
              {projection.ticks.map((tick, idx) => (
                <span
                  key={idx}
                  style={{
                    left: `${tick.percent}%`,
                    transform:
                      tick.percent === 0
                        ? "translateX(0%)"
                        : tick.percent === 100
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                  className="absolute top-0 whitespace-nowrap font-mono"
                >
                  {tick.label}
                </span>
              ))}
            </div>

            {/* Planned Bar Row */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--color-text)]">
                  Planned Schedule [- - -]
                </span>
                {projection.plannedBar ? (
                  <span className="font-mono text-[var(--color-text-muted)]">
                    {projection.plannedBar.startLabel} → {projection.plannedBar.endLabel} (
                    {projection.plannedBar.precision})
                  </span>
                ) : (
                  <span className="italic text-[var(--color-text-muted)]">
                    No complete planned range
                  </span>
                )}
              </div>
              <div className="relative h-6 w-full rounded bg-[var(--color-surface-2)] overflow-hidden">
                {projection.plannedBar && (
                  <div
                    role="img"
                    aria-label={`Planned bar from ${projection.plannedBar.startLabel} to ${projection.plannedBar.endLabel}`}
                    style={{
                      left: `${projection.plannedBar.startPercent}%`,
                      width: `${projection.plannedBar.widthPercent}%`,
                    }}
                    className="absolute top-1 bottom-1 rounded border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/15 flex items-center justify-center px-1.5 overflow-hidden"
                  >
                    <span className="truncate text-[10px] font-mono text-[var(--color-text)]">
                      Planned
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Actual Bar Row */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--color-text)]">
                  Actual Execution {projection.actualBar?.isOpen ? "[━━▶]" : "[━━━]"}
                </span>
                {projection.actualBar ? (
                  <span className="font-mono text-[var(--color-text-muted)]">
                    {projection.actualBar.startLabel} → {projection.actualBar.endLabel} (
                    {projection.actualBar.precision}
                    {projection.actualBar.isOpen ? ", open in-progress" : ""})
                  </span>
                ) : (
                  <span className="italic text-[var(--color-text-muted)]">
                    No active or completed actual range
                  </span>
                )}
              </div>
              <div className="relative h-6 w-full rounded bg-[var(--color-surface-2)] overflow-hidden">
                {projection.actualBar && (
                  <div
                    role="img"
                    aria-label={`Actual bar from ${projection.actualBar.startLabel} to ${projection.actualBar.endLabel}`}
                    style={{
                      left: `${projection.actualBar.startPercent}%`,
                      width: `${projection.actualBar.widthPercent}%`,
                    }}
                    className={cn(
                      "absolute top-1 bottom-1 rounded bg-[var(--color-primary)] text-white flex items-center justify-between px-1.5 overflow-hidden",
                      projection.actualBar.isOpen &&
                        "border-r-2 border-[var(--color-text)]",
                    )}
                  >
                    <span className="truncate text-[10px] font-mono font-medium">
                      {projection.actualBar.isOpen ? "In Progress" : "Actual"}
                    </span>
                    {projection.actualBar.isOpen && (
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Milestones Row */}
            {projection.milestones.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--color-border)]/60">
                <span className="font-medium text-[11px] text-[var(--color-text)]">
                  Milestones [◆]
                </span>
                <div className="flex flex-wrap gap-2">
                  {projection.milestones.map((m) => (
                    <div
                      key={m.id}
                      className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px]"
                    >
                      <Flag className="h-3 w-3 text-[var(--color-primary)] shrink-0" />
                      <span className="font-medium">{m.label}:</span>
                      <span className="font-mono text-[var(--color-text-muted)]">
                        {formatTimelineDate(m.value, m.precision)}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        ({m.precision})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explicit Date Evidence Table */}
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold text-[var(--color-text)]">
          Declared Date Evidence
        </span>
        <div className="overflow-x-auto rounded border border-[var(--color-border)]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-[var(--color-text-muted)]">
                <th className="px-2.5 py-1.5 font-medium">Field</th>
                <th className="px-2.5 py-1.5 font-medium">Value</th>
                <th className="px-2.5 py-1.5 font-medium">Precision</th>
                <th className="px-2.5 py-1.5 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {evidenceEntries.map((item) => (
                <tr
                  key={item.label}
                  className="border-b last:border-b-0 border-[var(--color-border)]/60"
                >
                  <td className="px-2.5 py-1.5 font-medium text-[var(--color-text)]">
                    {item.label}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono">
                    {item.evidence ? (
                      formatTimelineDate(
                        item.evidence.value,
                        item.evidence.precision,
                      )
                    ) : (
                      <span className="text-[var(--color-text-muted)] italic">
                        Not declared
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-[var(--color-text-muted)]">
                    {item.evidence ? item.evidence.precision : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {item.evidence
                      ? `${item.evidence.evidence.path}:${item.evidence.evidence.lineStart}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
