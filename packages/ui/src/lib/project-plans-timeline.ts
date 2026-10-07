// Timeline projection and date semantics helper for Project Plans Dashboard — Phase 04
// Aligned with contracts.md section 6 and phase-04-dashboard-and-document-details.md

import type {
  PlanDates,
  DateEvidence,
  DatePrecision,
  PlanStatus,
} from "@/api/project-plans-types.js";

const DAY_MS = 86400000;

export interface TimelineBar {
  type: "planned" | "actual";
  startValue: string;
  endValue: string;
  startLabel: string;
  endLabel: string;
  precision: DatePrecision;
  startPercent: number;
  widthPercent: number;
  isOpen: boolean;
  isDashed: boolean;
}

export type MilestoneKind =
  | "created"
  | "planned-start"
  | "planned-end"
  | "actual-start"
  | "actual-end";

export interface TimelineMilestone {
  id: string;
  kind: MilestoneKind;
  label: string;
  value: string;
  precision: DatePrecision;
  percent: number;
  sourceLabel: string;
}

export interface TimelineTick {
  percent: number;
  label: string;
}

export interface TimelineProjection {
  isUndated: boolean;
  hasActiveOpenBar: boolean;
  plannedBar: TimelineBar | null;
  actualBar: TimelineBar | null;
  milestones: TimelineMilestone[];
  ticks: TimelineTick[];
  minTimestamp: number | null;
  maxTimestamp: number | null;
  dominantPrecision: DatePrecision | "mixed" | null;
  warnings: string[];
}

/**
 * Parses a date string into a UTC millisecond timestamp according to strict precision semantics.
 * Day precision (YYYY-MM-DD) is interpreted as the start of that UTC day without browser timezone shift.
 * Instant precision (RFC3339 / ISO) is parsed directly with explicit timezone.
 */
export function parseDateToTimestamp(
  value: string | null | undefined,
  precision: DatePrecision,
): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  if (precision === "day") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date.getTime();
  }

  if (precision === "instant") {
    // Must be valid ISO/RFC3339 string with timezone (Z or +/-offset)
    if (!/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Formats a date value for user display according to its declared precision.
 * Preserves literal calendar date strings without timezone shifts.
 * Declares explicit UTC timezone indicator for instant precision.
 */
export function formatTimelineDate(
  value: string,
  precision: DatePrecision,
): string {
  const trimmed = value.trim();
  if (precision === "day") {
    return trimmed;
  }
  const ts = parseDateToTimestamp(trimmed, "instant");
  if (ts === null) return trimmed;
  const d = new Date(ts);
  return `${d.toISOString().replace(".000Z", "Z")} (UTC)`;
}

interface InternalSpan {
  type: "planned" | "actual";
  startEvidence: DateEvidence;
  endEvidence: DateEvidence;
  startTs: number;
  endTs: number;
  isOpen: boolean;
  isDashed: boolean;
  endDisplayValue: string;
}

interface InternalPoint {
  kind: MilestoneKind;
  evidence: DateEvidence;
  ts: number;
  label: string;
}

/**
 * Computes timeline projection for a selected plan from its explicit DateEvidence fields.
 * Conforms to contracts.md Section 6:
 * - Strict Gregorian YYYY-MM-DD day precision, RFC3339 instant precision with explicit zone.
 * - Planned bar: outlined/dashed, requires matching precision and start <= end.
 * - Actual closed bar: solid, requires matching precision and start <= end.
 * - Actual open bar: in-progress with start <= now, absent end, extends to labelled Today/Now.
 * - Missing or mismatched endpoints yield explicit milestones or Undated state.
 * - Day endpoints are inclusive (span includes full end day).
 */
export function projectPlanTimeline(
  dates: PlanDates | null | undefined,
  reportedStatus?: PlanStatus | null,
  nowMs: number = Date.now(),
): TimelineProjection {
  const warnings: string[] = [];

  if (!dates) {
    return {
      isUndated: true,
      hasActiveOpenBar: false,
      plannedBar: null,
      actualBar: null,
      milestones: [],
      ticks: [],
      minTimestamp: null,
      maxTimestamp: null,
      dominantPrecision: null,
      warnings: [],
    };
  }

  const { created, plannedStart, plannedEnd, actualStart, actualEnd } = dates;

  // Undated when created, planned, and actual dates are all absent
  const hasAnyDate = Boolean(
    created || plannedStart || plannedEnd || actualStart || actualEnd,
  );
  if (!hasAnyDate) {
    return {
      isUndated: true,
      hasActiveOpenBar: false,
      plannedBar: null,
      actualBar: null,
      milestones: [],
      ticks: [],
      minTimestamp: null,
      maxTimestamp: null,
      dominantPrecision: null,
      warnings: [],
    };
  }

  const spans: InternalSpan[] = [];
  const points: InternalPoint[] = [];
  let hasActiveOpenBar = false;

  // 1. Process Planned Range
  if (plannedStart && plannedEnd) {
    if (plannedStart.precision !== plannedEnd.precision) {
      warnings.push("Planned start and end have mismatched precision; bar omitted.");
      // Fallback to standalone milestones
      const startTs = parseDateToTimestamp(plannedStart.value, plannedStart.precision);
      if (startTs !== null) {
        points.push({ kind: "planned-start", evidence: plannedStart, ts: startTs, label: "Planned start" });
      }
      const endTs = parseDateToTimestamp(plannedEnd.value, plannedEnd.precision);
      if (endTs !== null) {
        points.push({ kind: "planned-end", evidence: plannedEnd, ts: endTs, label: "Planned end" });
      }
    } else {
      const startTs = parseDateToTimestamp(plannedStart.value, plannedStart.precision);
      const endTs = parseDateToTimestamp(plannedEnd.value, plannedEnd.precision);
      if (startTs === null || endTs === null) {
        warnings.push("Planned start or end date has invalid format.");
      } else if (endTs < startTs) {
        warnings.push("Planned end date precedes planned start date; bar omitted.");
      } else {
        const effectiveEndTs = plannedStart.precision === "day" ? endTs + DAY_MS : endTs;
        spans.push({
          type: "planned",
          startEvidence: plannedStart,
          endEvidence: plannedEnd,
          startTs,
          endTs: effectiveEndTs,
          isOpen: false,
          isDashed: true,
          endDisplayValue: plannedEnd.value,
        });
      }
    }
  } else if (plannedStart) {
    const ts = parseDateToTimestamp(plannedStart.value, plannedStart.precision);
    if (ts !== null) {
      points.push({ kind: "planned-start", evidence: plannedStart, ts, label: "Planned start" });
    }
  } else if (plannedEnd) {
    const ts = parseDateToTimestamp(plannedEnd.value, plannedEnd.precision);
    if (ts !== null) {
      points.push({ kind: "planned-end", evidence: plannedEnd, ts, label: "Planned end" });
    }
  }

  // 2. Process Actual Range
  if (actualStart && actualEnd) {
    if (actualStart.precision !== actualEnd.precision) {
      warnings.push("Actual start and end have mismatched precision; bar omitted.");
      const startTs = parseDateToTimestamp(actualStart.value, actualStart.precision);
      if (startTs !== null) {
        points.push({ kind: "actual-start", evidence: actualStart, ts: startTs, label: "Actual start" });
      }
      const endTs = parseDateToTimestamp(actualEnd.value, actualEnd.precision);
      if (endTs !== null) {
        points.push({ kind: "actual-end", evidence: actualEnd, ts: endTs, label: "Actual end" });
      }
    } else {
      const startTs = parseDateToTimestamp(actualStart.value, actualStart.precision);
      const endTs = parseDateToTimestamp(actualEnd.value, actualEnd.precision);
      if (startTs === null || endTs === null) {
        warnings.push("Actual start or end date has invalid format.");
      } else if (endTs < startTs) {
        warnings.push("Actual end date precedes actual start date; bar omitted.");
      } else {
        const effectiveEndTs = actualStart.precision === "day" ? endTs + DAY_MS : endTs;
        spans.push({
          type: "actual",
          startEvidence: actualStart,
          endEvidence: actualEnd,
          startTs,
          endTs: effectiveEndTs,
          isOpen: false,
          isDashed: false,
          endDisplayValue: actualEnd.value,
        });
      }
    }
  } else if (actualStart && !actualEnd) {
    const startTs = parseDateToTimestamp(actualStart.value, actualStart.precision);
    if (startTs !== null) {
      if (reportedStatus === "in-progress" && startTs <= nowMs) {
        // Open actual bar extending to Now/Today
        hasActiveOpenBar = true;
        let effectiveEndTs = nowMs;
        let endLabel = "Now";
        if (actualStart.precision === "day") {
          // Align now to end of current UTC day for day precision
          const nowUtc = new Date(nowMs);
          const currentDayTs = Date.UTC(
            nowUtc.getUTCFullYear(),
            nowUtc.getUTCMonth(),
            nowUtc.getUTCDate(),
          );
          effectiveEndTs = Math.max(startTs + DAY_MS, currentDayTs + DAY_MS);
          endLabel = "Today";
        } else {
          effectiveEndTs = Math.max(startTs + 1000, nowMs);
        }

        spans.push({
          type: "actual",
          startEvidence: actualStart,
          endEvidence: {
            value: endLabel,
            precision: actualStart.precision,
            evidence: actualStart.evidence,
          },
          startTs,
          endTs: effectiveEndTs,
          isOpen: true,
          isDashed: false,
          endDisplayValue: endLabel,
        });
      } else {
        // Not in-progress or start is in future: explicit milestone
        points.push({ kind: "actual-start", evidence: actualStart, ts: startTs, label: "Actual start" });
      }
    }
  } else if (actualEnd) {
    const endTs = parseDateToTimestamp(actualEnd.value, actualEnd.precision);
    if (endTs !== null) {
      points.push({ kind: "actual-end", evidence: actualEnd, ts: endTs, label: "Actual end" });
    }
  }

  // 3. Process Created Date as Milestone
  if (created) {
    const createdTs = parseDateToTimestamp(created.value, created.precision);
    if (createdTs !== null) {
      points.push({ kind: "created", evidence: created, ts: createdTs, label: "Created" });
    }
  }

  // If no valid spans and no valid points after parsing, mark undated
  if (spans.length === 0 && points.length === 0) {
    return {
      isUndated: true,
      hasActiveOpenBar: false,
      plannedBar: null,
      actualBar: null,
      milestones: [],
      ticks: [],
      minTimestamp: null,
      maxTimestamp: null,
      dominantPrecision: null,
      warnings,
    };
  }

  // Calculate timeline bounds
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const span of spans) {
    if (span.startTs < minTs) minTs = span.startTs;
    if (span.endTs > maxTs) maxTs = span.endTs;
  }
  for (const pt of points) {
    if (pt.ts < minTs) minTs = pt.ts;
    const ptEnd = pt.evidence.precision === "day" ? pt.ts + DAY_MS : pt.ts;
    if (ptEnd > maxTs) maxTs = ptEnd;
  }

  if (minTs === Number.POSITIVE_INFINITY || maxTs === Number.NEGATIVE_INFINITY) {
    return {
      isUndated: true,
      hasActiveOpenBar: false,
      plannedBar: null,
      actualBar: null,
      milestones: [],
      ticks: [],
      minTimestamp: null,
      maxTimestamp: null,
      dominantPrecision: null,
      warnings,
    };
  }

  // Prevent zero span (single instantaneous point)
  const totalDuration = maxTs > minTs ? maxTs - minTs : DAY_MS;

  const plannedSpan = spans.find((s) => s.type === "planned");
  const actualSpan = spans.find((s) => s.type === "actual");

  const plannedBar: TimelineBar | null = plannedSpan
    ? {
        type: "planned",
        startValue: plannedSpan.startEvidence.value,
        endValue: plannedSpan.endDisplayValue,
        startLabel: formatTimelineDate(plannedSpan.startEvidence.value, plannedSpan.startEvidence.precision),
        endLabel: formatTimelineDate(plannedSpan.endDisplayValue, plannedSpan.endEvidence.precision),
        precision: plannedSpan.startEvidence.precision,
        startPercent: Math.max(0, Math.min(100, ((plannedSpan.startTs - minTs) / totalDuration) * 100)),
        widthPercent: Math.max(0.5, Math.min(100, ((plannedSpan.endTs - plannedSpan.startTs) / totalDuration) * 100)),
        isOpen: false,
        isDashed: true,
      }
    : null;

  const actualBar: TimelineBar | null = actualSpan
    ? {
        type: "actual",
        startValue: actualSpan.startEvidence.value,
        endValue: actualSpan.endDisplayValue,
        startLabel: formatTimelineDate(actualSpan.startEvidence.value, actualSpan.startEvidence.precision),
        endLabel: actualSpan.isOpen
          ? actualSpan.endDisplayValue
          : formatTimelineDate(actualSpan.endDisplayValue, actualSpan.endEvidence.precision),
        precision: actualSpan.startEvidence.precision,
        startPercent: Math.max(0, Math.min(100, ((actualSpan.startTs - minTs) / totalDuration) * 100)),
        widthPercent: Math.max(0.5, Math.min(100, ((actualSpan.endTs - actualSpan.startTs) / totalDuration) * 100)),
        isOpen: actualSpan.isOpen,
        isDashed: false,
      }
    : null;

  const milestones: TimelineMilestone[] = points.map((pt, idx) => {
    const rawPercent = ((pt.ts - minTs) / totalDuration) * 100;
    return {
      id: `${pt.kind}-${idx}`,
      kind: pt.kind,
      label: pt.label,
      value: pt.evidence.value,
      precision: pt.evidence.precision,
      percent: Math.max(0, Math.min(100, rawPercent)),
      sourceLabel: `${pt.label}: ${formatTimelineDate(pt.evidence.value, pt.evidence.precision)}`,
    };
  });

  // Calculate ticks
  const ticks: TimelineTick[] = [
    {
      percent: 0,
      label: formatTimestampForTick(minTs, dates),
    },
    {
      percent: 50,
      label: formatTimestampForTick(minTs + totalDuration / 2, dates),
    },
    {
      percent: 100,
      label: formatTimestampForTick(maxTs, dates),
    },
  ];

  // Determine dominant precision
  const precisions = new Set<DatePrecision>();
  if (created) precisions.add(created.precision);
  if (plannedStart) precisions.add(plannedStart.precision);
  if (plannedEnd) precisions.add(plannedEnd.precision);
  if (actualStart) precisions.add(actualStart.precision);
  if (actualEnd) precisions.add(actualEnd.precision);

  const dominantPrecision: DatePrecision | "mixed" | null =
    precisions.size === 0
      ? null
      : precisions.size === 1
        ? Array.from(precisions)[0]
        : "mixed";

  return {
    isUndated: false,
    hasActiveOpenBar,
    plannedBar,
    actualBar,
    milestones,
    ticks,
    minTimestamp: minTs,
    maxTimestamp: maxTs,
    dominantPrecision,
    warnings,
  };
}

function formatTimestampForTick(ts: number, dates: PlanDates): string {
  // If all dates are day precision, render tick as YYYY-MM-DD
  const hasInstant =
    dates.created?.precision === "instant" ||
    dates.plannedStart?.precision === "instant" ||
    dates.plannedEnd?.precision === "instant" ||
    dates.actualStart?.precision === "instant" ||
    dates.actualEnd?.precision === "instant";

  const d = new Date(ts);
  if (!hasInstant) {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return d.toISOString().slice(0, 10);
}
