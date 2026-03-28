import { useState, useEffect, useRef } from "react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  useMemoryFile,
  useMemoryTemplates,
  useUpdateMemoryFile,
  useApplyMemoryTemplate,
} from "@/api/queries.js";
import type { AgentType } from "@/api/client.js";

interface Props {
  projects: Array<{ name: string }>;
}

export function MemoryEditor({ projects }: Props) {
  const [projectName, setProjectName] = useState(projects[0]?.name ?? "");
  const [agent, setAgent] = useState<AgentType>("claude");
  const [content, setContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  // Track whether the user has modified the preview content (to warn on discard)
  const originalPreviewRef = useRef<string | null>(null);

  const { data: memoryContent, isLoading, isFetching } = useMemoryFile(projectName, agent);
  const { data: templates = [] } = useMemoryTemplates();
  const updateMemory = useUpdateMemoryFile();
  const applyTemplate = useApplyMemoryTemplate();

  // Reset editor when project/agent changes or fresh data arrives
  useEffect(() => {
    setContent(memoryContent ?? "");
    setPreview(null);
    originalPreviewRef.current = null;
    setSaveStatus("idle");
  }, [memoryContent, projectName, agent]);

  async function handleApply() {
    if (!selectedTemplate || !projectName) return;
    const result = await applyTemplate.mutateAsync({
      templateName: selectedTemplate,
      projectName,
      agent,
    });
    setPreview(result.content);
    originalPreviewRef.current = result.content;
  }

  async function handleSave(contentToSave = content) {
    setSaveStatus("idle");
    try {
      await updateMemory.mutateAsync({ projectName, agent, content: contentToSave });
      setSaveStatus("saved");
      setPreview(null);
      originalPreviewRef.current = null;
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    }
  }

  function handleDiscardPreview() {
    const previewEdited =
      preview !== null &&
      originalPreviewRef.current !== null &&
      preview !== originalPreviewRef.current;
    if (previewEdited && !window.confirm("Discard your edits to this preview?")) return;
    setPreview(null);
    originalPreviewRef.current = null;
  }

  function handleSwitchProject(name: string) {
    if (preview !== null && preview !== originalPreviewRef.current) {
      if (!window.confirm("Switch project? Your preview edits will be lost.")) return;
    }
    setProjectName(name);
  }

  function handleSwitchAgent(a: AgentType) {
    if (preview !== null && preview !== originalPreviewRef.current) {
      if (!window.confirm("Switch agent? Your preview edits will be lost.")) return;
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

        <div className="flex-1" />

        {saveStatus === "saved" && (
          <span className="text-xs text-[var(--color-success)]">Saved</span>
        )}
        {saveStatus === "error" && (
          <span className="text-xs text-[var(--color-danger)]">Save failed</span>
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
              Template preview{preview !== originalPreviewRef.current ? " *" : ""} — click "Apply &amp; Save" to write to project
            </div>
          )}
          <textarea
            className="flex-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono resize-none outline-none focus:border-[var(--color-primary)] min-h-0"
            value={preview ?? content}
            onChange={(e) => {
              if (preview !== null) setPreview(e.target.value);
              else setContent(e.target.value);
            }}
            disabled={isTransitioning}
            placeholder={`No ${agent === "claude" ? "CLAUDE.md" : "GEMINI.md"} found. Start typing or apply a template.`}
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
