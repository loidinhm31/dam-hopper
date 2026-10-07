// Selected-plan Document viewer component for Project Plans Dashboard — Phase 04
// Aligned with contracts.md section 4, 8 and phase-04-dashboard-and-document-details.md

import React, { useMemo } from "react";
import {
  FileText,
  Activity,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  Info,
} from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";
import type { FilePlan, PlanDocumentState } from "@/api/project-plans-types.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

export interface ProjectPlanDocumentProps {
  plan: FilePlan;
  currentDocumentPath: string;
  documentContent?: string;
  isDocumentLoading: boolean;
  documentError: Error | null;
  onNavigateDocument: (documentPath: string) => void;
  onRetryDocument: () => void;
  className?: string;
}

export function ProjectPlanDocument({
  plan,
  currentDocumentPath,
  documentContent,
  isDocumentLoading,
  documentError,
  onNavigateDocument,
  onRetryDocument,
  className,
}: ProjectPlanDocumentProps) {
  const planDoc = plan.documents.plan;
  const progressDoc = plan.documents.progress;

  const isPlanTab = currentDocumentPath === planDoc.path;
  const isProgressTab = currentDocumentPath === progressDoc.path;
  const isCustomLocalDoc = !isPlanTab && !isProgressTab;

  // Find document metadata for current view
  const currentDocMeta = useMemo(() => {
    if (isPlanTab) return planDoc;
    if (isProgressTab) return progressDoc;
    return null;
  }, [isPlanTab, isProgressTab, planDoc, progressDoc]);

  const docState: PlanDocumentState = currentDocMeta?.state ?? "readable";

  const renderStateBanner = (state: PlanDocumentState) => {
    switch (state) {
      case "absent":
        return (
          <div
            role="status"
            className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2 text-xs text-[var(--color-text-muted)]"
          >
            <Info className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
            <span>
              Document is absent. Progress tracking has not been opted into or
              this document does not exist.
            </span>
          </div>
        );
      case "unreadable":
        return (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Document is unreadable (permission denied, unreadable file, or
              invalid UTF-8).
            </span>
          </div>
        );
      case "oversize":
        return (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Document exceeds size limit (64 KiB maximum allowed for decisive
              documents).
            </span>
          </div>
        );
      case "changed":
        return (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Document was modified or replaced concurrently during read.
              Refresh to reload.
            </span>
          </div>
        );
      case "invalid":
        return (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Document contains invalid structure or encoding.</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full min-w-0 bg-[var(--color-surface)] text-[var(--color-text)] text-xs",
        className,
      )}
      role="region"
      aria-label="Plan Document Viewer"
    >
      {/* Top Document Tabs Navigation */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5 bg-[var(--color-surface-2)]/40">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isPlanTab ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigateDocument(planDoc.path)}
            className={cn(
              "h-7 gap-1.5 px-2 text-xs font-medium",
              isPlanTab
                ? "bg-[var(--color-surface)] shadow-xs text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Plan (plan.md)</span>
          </Button>

          <Button
            type="button"
            variant={isProgressTab ? "secondary" : "ghost"}
            size="sm"
            onClick={() => onNavigateDocument(progressDoc.path)}
            className={cn(
              "h-7 gap-1.5 px-2 text-xs font-medium",
              isProgressTab
                ? "bg-[var(--color-surface)] shadow-xs text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Progress (progress.md)</span>
            {progressDoc.state === "absent" && (
              <span className="ml-1 text-[10px] text-[var(--color-text-muted)]/80 italic">
                (absent)
              </span>
            )}
          </Button>

          {isCustomLocalDoc && (
            <div className="flex items-center gap-1.5 bg-[var(--color-surface)] px-2 py-0.5 rounded border border-[var(--color-border)] text-xs">
              <span className="text-[var(--color-text-muted)]">Viewing:</span>
              <span
                className="font-mono truncate max-w-[200px]"
                title={currentDocumentPath}
              >
                {currentDocumentPath}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigateDocument(planDoc.path)}
                className="h-5 px-1 text-[11px] text-[var(--color-primary)] hover:underline ml-1"
              >
                <ArrowLeft className="h-3 w-3 mr-0.5" />
                Return to plan
              </Button>
            </div>
          )}
        </div>

        {/* Read-only snapshot indicator */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          <Info className="h-3 w-3" />
          <span>Read-Only Snapshot</span>
        </div>
      </div>

      {/* Snapshot Information Banner */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/20 px-3 py-1.5 text-[11px] text-[var(--color-text-muted)]">
        <div className="flex items-center gap-3">
          <span>
            Path:{" "}
            <strong className="font-mono text-[var(--color-text)]">
              {currentDocumentPath}
            </strong>
          </span>
          {currentDocMeta?.sizeBytes !== null &&
            currentDocMeta?.sizeBytes !== undefined && (
              <span>
                Size:{" "}
                <strong className="text-[var(--color-text)]">
                  {currentDocMeta.sizeBytes} B
                </strong>
              </span>
            )}
          {currentDocMeta?.modifiedAt && (
            <span>
              Modified:{" "}
              <strong className="text-[var(--color-text)]">
                {currentDocMeta.modifiedAt}
              </strong>
            </span>
          )}
        </div>
        <div>
          Authority:{" "}
          <strong className="text-[var(--color-text)]">
            {plan.reportedStatus.authority}
          </strong>
        </div>
      </div>

      {/* Main Document Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {/* Loading */}
        {isDocumentLoading && (
          <div
            role="status"
            aria-label="Loading document content"
            className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--color-text-muted)]"
          >
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            <span>Loading document content...</span>
          </div>
        )}

        {/* Error */}
        {documentError && (
          <div
            role="alert"
            className="flex flex-col items-center justify-center p-6 text-center gap-2 text-[var(--color-danger)]"
          >
            <AlertCircle className="h-6 w-6 shrink-0" />
            <span className="font-medium">Failed to read document</span>
            <span className="text-xs text-[var(--color-text-muted)] max-w-sm">
              {documentError.message || "An unexpected error occurred."}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetryDocument}
              className="mt-2 text-xs"
            >
              Retry
            </Button>
          </div>
        )}

        {/* State Banner if not readable or special state */}
        {!isDocumentLoading && !documentError && docState !== "readable" && (
          <div className="mb-3">{renderStateBanner(docState)}</div>
        )}

        {/* Render Markdown Preview if readable and loaded */}
        {!isDocumentLoading &&
          !documentError &&
          docState === "readable" &&
          (documentContent !== undefined ? (
            <MarkdownPreview
              content={documentContent}
              linkPolicy={{
                currentDocumentPath,
                onNavigateLocalMarkdown: (resolvedPath) => {
                  onNavigateDocument(resolvedPath);
                },
              }}
              className="p-0 bg-transparent"
            />
          ) : (
            <div className="text-[var(--color-text-muted)] italic p-4 text-center">
              No content available.
            </div>
          ))}
      </div>
    </div>
  );
}
