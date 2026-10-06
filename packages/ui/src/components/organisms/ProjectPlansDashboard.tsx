// Project Plans Dashboard main organism — Phase 04
// Aligned with contracts.md section 1, 2, 8 and phase-04-dashboard-and-document-details.md

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Layers,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ProjectTargetRef } from "@/api/client.js";
import { Button } from "@/components/atoms/Button.js";
import { Badge } from "@/components/atoms/Badge.js";
import { cn } from "@/lib/utils.js";
import { useProjectPlans } from "@/hooks/use-project-plans.js";
import { ProjectPlanFolderBrowser } from "./ProjectPlanFolderBrowser.js";
import { ProjectPlanTimeline } from "./ProjectPlanTimeline.js";
import { ProjectPlanDocument } from "./ProjectPlanDocument.js";
import {
  ProjectPlanOverview,
  getStatusBadgeClass,
} from "./ProjectPlanOverview.js";

export type DashboardViewTab = "overview" | "timeline" | "document";

export interface ProjectPlansDashboardProps {
  owner?: ConnectionRef | null;
  target?: ProjectTargetRef | null;
  enabled?: boolean;
  className?: string;
}

export function ProjectPlansDashboard({
  owner,
  target,
  enabled = true,
  className,
}: ProjectPlansDashboardProps) {
  const [browsePath, setBrowsePath] = useState<string>("plans");
  const [selectedPlanPath, setSelectedPlanPath] = useState<string | null>(null);
  const [selectedDocumentPath, setSelectedDocumentPath] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<DashboardViewTab>("overview");
  const [lastNavigatedFrom, setLastNavigatedFrom] = useState<string | null>(null);

  // Hook queries folders, selected plan, document content, and monitors filesystem
  const effectiveDocumentPath = useMemo(() => {
    if (activeViewTab !== "document") return null;
    if (selectedDocumentPath) return selectedDocumentPath;
    if (selectedPlanPath) return `${selectedPlanPath}/plan.md`;
    return null;
  }, [activeViewTab, selectedDocumentPath, selectedPlanPath]);

  const {
    foldersData,
    isFoldersLoading,
    foldersError,
    selectedPlanData,
    isSelectedPlanLoading,
    selectedPlanError,
    documentContent,
    isDocumentLoading,
    documentError,
    coverage,
    refresh,
  } = useProjectPlans({
    owner,
    target,
    browsePath,
    selectedPlanPath,
    selectedDocumentPath: effectiveDocumentPath,
    enabled,
  });

  // When browsing into a directory that has a regular plan.md, the server returns kind: "plan"
  useEffect(() => {
    if (foldersData?.kind === "plan" && !selectedPlanPath) {
      setSelectedPlanPath(foldersData.path);
      setSelectedDocumentPath(`${foldersData.path}/plan.md`);
      setActiveViewTab("overview");
    }
  }, [foldersData, selectedPlanPath]);

  // When navigating back to folders from selected plan
  const handleBackToFolders = useCallback(() => {
    if (selectedPlanPath) {
      setLastNavigatedFrom(selectedPlanPath);
      // Set browsePath to parent directory of the selected plan
      const parts = selectedPlanPath.split("/").filter(Boolean);
      parts.pop();
      const parentPath = parts.join("/") || "plans";
      setBrowsePath(parentPath);
    }
    setSelectedPlanPath(null);
    setSelectedDocumentPath(null);
    setActiveViewTab("overview");
  }, [selectedPlanPath]);

  // Handle navigating into a folder row from the browser
  const handleNavigatePath = useCallback((path: string) => {
    setLastNavigatedFrom(path);
    setBrowsePath(path);
  }, []);

  const handleDocumentNavigation = useCallback((path: string) => {
    setSelectedDocumentPath(path);
    setActiveViewTab("document");
  }, []);

  const plan = selectedPlanData?.plan;

  // Render Folder Browser when no plan is selected
  if (!selectedPlanPath) {
    return (
      <div className={cn("flex flex-col h-full w-full min-w-0", className)}>
        {/* Coverage banner if degraded or reconciling */}
        {coverage.status !== "live" && coverage.status !== "unsupported" && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-1 text-xs text-[var(--color-warning)]"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Coverage {coverage.status}: {coverage.reason || "Filesystem watching unsettled"}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              className="h-5 px-1.5 text-[11px]"
            >
              Reconcile
            </Button>
          </div>
        )}

        <ProjectPlanFolderBrowser
          currentPath={browsePath}
          foldersData={foldersData}
          isLoading={isFoldersLoading}
          error={foldersError}
          onNavigatePath={handleNavigatePath}
          onRefresh={refresh}
          lastSelectedPath={lastNavigatedFrom}
          className="flex-1 min-h-0"
        />
      </div>
    );
  }

  // Selected Plan View
  return (
    <div
      className={cn(
        "flex flex-col h-full w-full min-w-0 bg-[var(--color-surface)] text-[var(--color-text)] text-xs",
        className,
      )}
      role="region"
      aria-label="Selected Project Plan Dashboard"
    >
      {/* Top Navigation & Action Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-2 bg-[var(--color-surface-2)]/40">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBackToFolders}
            className="h-7 gap-1 px-2 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] shrink-0"
            aria-label="Back to folder browser"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Folders</span>
          </Button>

          <span className="text-[var(--color-border)]">|</span>

          <span
            className="font-mono text-xs font-semibold truncate text-[var(--color-text)] max-w-[260px]"
            title={selectedPlanPath}
          >
            {selectedPlanPath}
          </span>

          {plan && (
            <Badge
              variant="neutral"
              className={cn(
                "capitalize text-[11px] shrink-0 font-medium px-2 py-0.5",
                getStatusBadgeClass(plan.reportedStatus.value),
              )}
            >
              {plan.reportedStatus.value}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {coverage.status !== "live" && (
            <span
              className="hidden sm:inline text-[11px] text-[var(--color-warning)]"
              title={coverage.reason || undefined}
            >
              Coverage: {coverage.status}
            </span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            disabled={isSelectedPlanLoading}
            className="h-7 w-7 p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title="Refresh plan data"
            aria-label="Refresh plan"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isSelectedPlanLoading && "animate-spin text-[var(--color-primary)]")}
            />
          </Button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-3 bg-[var(--color-surface)]">
        <button
          type="button"
          onClick={() => setActiveViewTab("overview")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
            activeViewTab === "overview"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveViewTab("timeline")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
            activeViewTab === "timeline"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>Timeline</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!selectedDocumentPath && plan) {
              setSelectedDocumentPath(plan.documents.plan.path);
            }
            setActiveViewTab("document");
          }}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
            activeViewTab === "document"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Documents</span>
        </button>
      </div>

      {/* View Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Loading State */}
        {isSelectedPlanLoading && !plan && (
          <div
            role="status"
            aria-label="Loading selected plan"
            className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--color-text-muted)]"
          >
            <RefreshCw className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            <span>Loading plan report...</span>
          </div>
        )}

        {/* Error State */}
        {selectedPlanError && (
          <div
            role="alert"
            className="flex flex-col items-center justify-center p-8 text-center gap-2 text-[var(--color-danger)]"
          >
            <AlertCircle className="h-6 w-6 shrink-0" />
            <span className="font-medium text-sm">Failed to load plan</span>
            <span className="text-xs text-[var(--color-text-muted)] max-w-sm">
              {selectedPlanError.message || "Could not read plan data."}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => refresh()}
              className="mt-2 text-xs"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Main Content when plan data is loaded */}
        {plan && activeViewTab === "overview" && (
          <ProjectPlanOverview
            plan={plan}
            onNavigateDocument={handleDocumentNavigation}
          />
        )}

        {plan && activeViewTab === "timeline" && (
          <ProjectPlanTimeline plan={plan} />
        )}

        {plan && activeViewTab === "document" && (
          <ProjectPlanDocument
            plan={plan}
            currentDocumentPath={
              selectedDocumentPath ?? plan.documents.plan.path
            }
            documentContent={documentContent}
            isDocumentLoading={isDocumentLoading}
            documentError={documentError}
            onNavigateDocument={handleDocumentNavigation}
          />
        )}
      </div>
    </div>
  );
}
