import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import { useState, useEffect, useRef } from "react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  useMemoryFile,
  useMemoryTemplates,
  useUpdateMemoryFile,
  useApplyMemoryTemplate,
} from "@/api/queries.js";
import type { AgentType } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";

interface Props {
  projects: Array<{ name: string }>;
  owner?: ConnectionRef;
  profileId?: string;
}

export function MemoryEditor({ projects, owner, profileId }: Props) {
  const [projectName, setProjectName] = useState(projects[0]?.name ?? "");
  const [agent, setAgent] = useState<AgentType>("claude");
  const [content, setContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const draftTargetRef = useRef({ profileId, projectName, agent });
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [initialPreview, setInitialPreview] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    action: () => void;
  } | null>(null);

  const {
    data: memoryContent,
    isLoading,
    isFetching,
  } = useMemoryFile(projectName, agent, { owner });
  const { data: templates = [] } = useMemoryTemplates({ owner });
  const updateMemory = useUpdateMemoryFile({ owner });
  const applyTemplate = useApplyMemoryTemplate({ owner });
  // Reset editor when project/agent/profile changes or fresh data arrives for current clean target
  useEffect(() => {
    const target = draftTargetRef.current;
    if (
      target.profileId === profileId &&
      target.projectName === projectName &&
      target.agent === agent
    ) {
      if (!isDirty) {
        setContent(memoryContent ?? "");
        setPreview(null);
        setInitialPreview(null);
        setSaveStatus("idle");
      }
    } else {
      draftTargetRef.current = { profileId, projectName, agent };
      setIsDirty(false);
      setContent(memoryContent ?? "");
      setPreview(null);
      setInitialPreview(null);
      setSaveStatus("idle");
    }
  }, [memoryContent, projectName, agent, profileId, isDirty]);
  async function handleApply() {
    if (!selectedTemplate || !projectName) return;
    const result = await applyTemplate.mutateAsync({
      templateName: selectedTemplate,
      projectName,
      agent,
    });
    setPreview(result.content);
    setInitialPreview(result.content);
  }

  async function handleSave(contentToSave = content) {
    setSaveStatus("idle");
    try {
      await updateMemory.mutateAsync({
        projectName,
        agent,
        content: contentToSave,
      });
      setSaveStatus("saved");
      setIsDirty(false);
      setPreview(null);
      setInitialPreview(null);
    } catch {
      setSaveStatus("error");
    }
  }

  function handleDiscardPreview() {
    const previewEdited =
      preview !== null && initialPreview !== null && preview !== initialPreview;
    if (previewEdited) {
      setPendingConfirm({
        title: "Discard preview edits",
        message: "Discard your edits to this preview?",
        confirmText: "Discard",
        action: () => {
          setPreview(null);
          setInitialPreview(null);
        },
      });
      return;
    }
    setPreview(null);
    setInitialPreview(null);
  }

  function handleSwitchProject(name: string) {
    if (name === projectName) return;
    const previewEdited =
      preview !== null && initialPreview !== null && preview !== initialPreview;
    if (isDirty || previewEdited) {
      const message =
        isDirty && previewEdited
          ? "Switch project? Your unsaved draft and preview edits will be lost."
          : isDirty
            ? "Switch project? Your unsaved draft will be lost."
            : "Switch project? Your preview edits will be lost.";
      setPendingConfirm({
        title: "Switch project",
        message,
        confirmText: "Switch",
        action: () => setProjectName(name),
      });
      return;
    }
    setProjectName(name);
  }

  function handleSwitchAgent(a: AgentType) {
    if (a === agent) return;
    const previewEdited =
      preview !== null && initialPreview !== null && preview !== initialPreview;
    if (isDirty || previewEdited) {
      const message =
        isDirty && previewEdited
          ? "Switch agent? Your unsaved draft and preview edits will be lost."
          : isDirty
            ? "Switch agent? Your unsaved draft will be lost."
            : "Switch agent? Your preview edits will be lost.";
      setPendingConfirm({
        title: "Switch agent",
        message,
        confirmText: "Switch",
        action: () => setAgent(a),
      });
      return;
    }
    setAgent(a);
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-[var(--color-text-muted)]">
        No projects in workspace
      </div>
    );
  }

  // Show loading overlay during project/agent switch to prevent editing stale content
  const isTransitioning = isFetching && !isLoading;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <select
          className={`${inputClass} w-40`}
          value={projectName}
          onChange={(e) => handleSwitchProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Agent tabs */}
        <div className="flex rounded border border-[var(--color-border)] overflow-hidden">
          {(["claude", "gemini"] as AgentType[]).map((a) => (
            <button
              key={a}
              onClick={() => handleSwitchAgent(a)}
              className={[
                "px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                agent === a
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
              ].join(" ")}
            >
              {a === "claude" ? "Claude" : "Gemini"}
            </button>
          ))}
        </div>

        {templates.length > 0 && (
          <>
            <select
              className={`${inputClass} w-40`}
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">— Template —</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selectedTemplate || !projectName || isTransitioning}
              loading={applyTemplate.isPending}
              onClick={handleApply}
            >
              Preview
            </Button>
          </>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-[var(--color-success)]">Saved</span>
        )}
        {saveStatus === "error" && (
          <span className="text-xs text-[var(--color-danger)]">
            Save failed
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          loading={updateMemory.isPending}
          disabled={isTransitioning}
          onClick={() => handleSave(preview ?? content)}
        >
          {preview ? "Apply & Save" : "Save"}
        </Button>
        {preview && (
          <Button variant="ghost" size="sm" onClick={handleDiscardPreview}>
            Discard
          </Button>
        )}
      </div>

      {/* Editor / Preview */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-2 min-h-0 relative">
          {/* Overlay while refetching on project/agent switch */}
          {isTransitioning && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded bg-[var(--color-surface)]/70">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
            </div>
          )}
          {preview !== null && (
            <div className="rounded border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-2 py-1 text-[10px] text-[var(--color-primary)]">
              Template preview{preview !== initialPreview ? " *" : ""} — click
              "Apply &amp; Save" to write to project
            </div>
          )}
          <textarea
            className="flex-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono resize-none outline-none focus:border-[var(--color-primary)] min-h-0"
            value={preview ?? content}
            onChange={(e) => {
              if (preview !== null) setPreview(e.target.value);
              else {
                setContent(e.target.value);
                setIsDirty(true);
              }
            }}
            disabled={isTransitioning}
            placeholder={`No ${agent === "claude" ? "CLAUDE.md" : "GEMINI.md"} found. Start typing or apply a template.`}
            spellCheck={false}
          />
        </div>
      )}
      <ConfirmDialog
        open={pendingConfirm !== null}
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => {
          pendingConfirm?.action();
          setPendingConfirm(null);
        }}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.message}
        confirmText={pendingConfirm?.confirmText ?? "Confirm"}
        variant="danger"
      />
    </div>
  );
}
