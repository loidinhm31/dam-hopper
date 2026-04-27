/**
 * EncryptedUploadDialog — drag-and-drop upload dialog for encrypted (Lock) mode.
 *
 * Shows a file picker / drop zone. When encrypted mode is enabled, files are
 * encrypted client-side before upload. Falls back to normal upload if encrypted
 * mode is disabled.
 *
 * Props:
 *   project   — Target project name
 *   dir       — Target directory (relative to project root)
 *   onClose   — Called when dialog should close
 *   onSuccess — Called when upload completes with new mtime
 */
import { useCallback, useRef, useState } from "react";
import { Upload, ShieldCheck, FileUp, X, CheckCircle, AlertCircle } from "lucide-react";
import { useEncryptMode } from "@/contexts/EncryptContext.js";
import { useEncryptedWrite } from "@/hooks/useEncryptedWrite.js";

interface EncryptedUploadDialogProps {
  project: string;
  dir: string;
  onClose: () => void;
  onSuccess?: (newMtime: number | undefined) => void;
}

interface FileStatus {
  file: File;
  state: "pending" | "encrypting" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

export function EncryptedUploadDialog({
  project,
  dir,
  onClose,
  onSuccess,
}: EncryptedUploadDialogProps) {
  const { isEncryptEnabled, getPassphrase, promptPassphrase, setPassphrase } = useEncryptMode();

  const encrypted = isEncryptEnabled(project);

  const { uploadFile } = useEncryptedWrite();

  const [files, setFiles] = useState<FileStatus[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: File[]) => {
    setFiles((prev) => [
      ...prev,
      ...newFiles.map((f) => ({ file: f, state: "pending" as const, progress: 0 })),
    ]);
    setAllDone(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) addFiles(dropped);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length > 0) addFiles(picked);
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || uploading) return;

    let passphrase: string | null = null;
    if (encrypted) {
      passphrase = getPassphrase(project);
      if (!passphrase) {
        try {
          passphrase = await promptPassphrase(project);
          setPassphrase(project, passphrase);
        } catch {
          return; // User cancelled
        }
      }
    }

    setUploading(true);
    let anyError = false;

    for (let i = 0; i < files.length; i++) {
      if (files[i].state === "done") continue;

      const { file } = files[i];

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, state: "encrypting", progress: 0 } : f,
        ),
      );

      try {
        const result = await uploadFile(
          project,
          dir,
          file,
          passphrase ?? "",
          (pct) =>
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, state: "uploading", progress: pct } : f,
              ),
            ),
        );

        if (result.ok) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, state: "done", progress: 100 } : f,
            ),
          );
          onSuccess?.(result.newMtime);
        } else {
          anyError = true;
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, state: "error", error: result.error } : f,
            ),
          );
        }
      } catch (e) {
        anyError = true;
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, state: "error", error: e instanceof Error ? e.message : "Unknown error" }
              : f,
          ),
        );
      }
    }

    setUploading(false);
    if (!anyError) setAllDone(true);
  }, [files, uploading, encrypted, project, dir, getPassphrase, promptPassphrase, setPassphrase, uploadFile, onSuccess]);

  const removeFile = (i: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const stateIcon = (s: FileStatus) => {
    switch (s.state) {
      case "done": return <CheckCircle size={14} className="eud-file-icon eud-file-icon--done" />;
      case "error": return <AlertCircle size={14} className="eud-file-icon eud-file-icon--error" />;
      default: return <FileUp size={14} className="eud-file-icon" />;
    }
  };

  return (
    <div className="eud-overlay" role="dialog" aria-modal="true" aria-label="Upload files">
      <div className="eud-backdrop" onClick={onClose} />
      <div className="eud-card">
        {/* Header */}
        <div className="eud-header">
          <div className="eud-title-wrap">
            {encrypted ? (
              <ShieldCheck size={18} className="eud-title-icon eud-title-icon--locked" />
            ) : (
              <Upload size={18} className="eud-title-icon" />
            )}
            <span className="eud-title">
              {encrypted ? "Encrypted Upload" : "Upload Files"}
            </span>
            {encrypted && <span className="eud-badge">AES-256-GCM</span>}
          </div>
          <button type="button" className="eud-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="eud-dir">To: <code>{dir || "/"}</code></p>

        {/* Drop zone */}
        <div
          className={`eud-dropzone${dragging ? " eud-dropzone--active" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop files here or click to select"
        >
          <Upload size={28} className="eud-drop-icon" />
          <span className="eud-drop-text">Drop files here or click to browse</span>
          <span className="eud-drop-hint">Max 100 MB per file</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInput}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul className="eud-file-list">
            {files.map((f, i) => (
              <li key={i} className={`eud-file-item eud-file-item--${f.state}`}>
                {stateIcon(f)}
                <span className="eud-file-name">{f.file.name}</span>
                <span className="eud-file-size">{(f.file.size / 1024).toFixed(1)} KB</span>
                {f.state === "uploading" && (
                  <div className="eud-progress">
                    <div className="eud-progress-bar" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
                {f.state === "error" && (
                  <span className="eud-file-error" title={f.error}>{f.error?.slice(0, 40)}</span>
                )}
                {f.state === "pending" && !uploading && (
                  <button
                    type="button"
                    className="eud-remove"
                    onClick={() => removeFile(i)}
                    aria-label="Remove file"
                  >
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Footer */}
        <div className="eud-footer">
          {allDone ? (
            <button type="button" className="eud-btn eud-btn--done" onClick={onClose}>
              <CheckCircle size={14} /> Done
            </button>
          ) : (
            <button
              type="button"
              className="eud-btn eud-btn--upload"
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
            >
              {uploading ? "Uploading…" : encrypted ? "🔒 Encrypt & Upload" : "Upload"}
            </button>
          )}
        </div>

        <style>{`
          .eud-overlay {
            position: fixed; inset: 0; z-index: 9990;
            display: flex; align-items: center; justify-content: center; padding: 16px;
          }
          .eud-backdrop {
            position: absolute; inset: 0;
            background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
          }
          .eud-card {
            position: relative; width: 100%; max-width: 480px;
            background: var(--color-surface, #1a1a2e);
            border: 1px solid var(--color-border, rgba(255,255,255,0.1));
            border-radius: 14px; padding: 20px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.5);
            animation: eud-pop 0.2s ease; display: flex; flex-direction: column; gap: 14px;
          }
          @keyframes eud-pop {
            from { transform: scale(0.96); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          .eud-header { display: flex; align-items: center; gap: 10px; }
          .eud-title-wrap { display: flex; align-items: center; gap: 8px; flex: 1; }
          .eud-title { font-size: 15px; font-weight: 600; color: var(--color-text, #fff); }
          .eud-title-icon { color: var(--color-text-muted, rgba(255,255,255,0.5)); }
          .eud-title-icon--locked { color: var(--color-accent, #7c6aff); }
          .eud-badge {
            font-size: 10px; padding: 2px 7px; border-radius: 100px;
            background: rgba(124,106,255,0.15); color: var(--color-accent, #7c6aff);
            border: 1px solid rgba(124,106,255,0.3); font-weight: 600; letter-spacing: 0.05em;
          }
          .eud-close {
            background: none; border: none; color: var(--color-text-muted, rgba(255,255,255,0.4));
            cursor: pointer; padding: 4px; border-radius: 6px; display: flex;
            align-items: center; justify-content: center; transition: color 0.15s, background 0.15s;
          }
          .eud-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
          .eud-dir { font-size: 12px; color: var(--color-text-muted, rgba(255,255,255,0.4)); margin: 0; }
          .eud-dir code { color: var(--color-text, #fff); background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-size: 11px; }
          .eud-dropzone {
            border: 2px dashed var(--color-border, rgba(255,255,255,0.12));
            border-radius: 10px; padding: 28px 20px;
            display: flex; flex-direction: column; align-items: center; gap: 8px;
            cursor: pointer; transition: all 0.15s ease; text-align: center;
          }
          .eud-dropzone:hover, .eud-dropzone--active {
            border-color: var(--color-accent, #7c6aff);
            background: rgba(124,106,255,0.05);
          }
          .eud-drop-icon { color: var(--color-text-muted, rgba(255,255,255,0.3)); }
          .eud-drop-text { font-size: 14px; color: var(--color-text-muted, rgba(255,255,255,0.6)); }
          .eud-drop-hint { font-size: 11px; color: rgba(255,255,255,0.3); }
          .eud-file-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
          .eud-file-item {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 10px; border-radius: 8px;
            background: rgba(255,255,255,0.04); font-size: 13px;
            border: 1px solid transparent;
          }
          .eud-file-item--done { border-color: rgba(82,196,130,0.2); background: rgba(82,196,130,0.06); }
          .eud-file-item--error { border-color: rgba(255,95,109,0.2); background: rgba(255,95,109,0.06); }
          .eud-file-icon { color: var(--color-text-muted, rgba(255,255,255,0.4)); flex-shrink: 0; }
          .eud-file-icon--done { color: #52c482; }
          .eud-file-icon--error { color: #ff5f6d; }
          .eud-file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text, #fff); }
          .eud-file-size { font-size: 11px; color: rgba(255,255,255,0.35); flex-shrink: 0; }
          .eud-progress { flex: 1; height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
          .eud-progress-bar { height: 100%; background: var(--color-accent, #7c6aff); transition: width 0.2s ease; border-radius: 2px; }
          .eud-file-error { font-size: 11px; color: #ff5f6d; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .eud-remove {
            background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer;
            padding: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
            transition: color 0.15s;
          }
          .eud-remove:hover { color: #ff5f6d; }
          .eud-footer { display: flex; justify-content: flex-end; }
          .eud-btn {
            padding: 9px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
            cursor: pointer; border: none; transition: all 0.15s; display: flex; align-items: center; gap: 6px;
          }
          .eud-btn--upload {
            background: var(--color-accent, #7c6aff); color: #fff;
            box-shadow: 0 0 12px rgba(124,106,255,0.4);
          }
          .eud-btn--upload:hover:not(:disabled) { background: #9480ff; box-shadow: 0 0 18px rgba(124,106,255,0.6); }
          .eud-btn--upload:disabled { opacity: 0.5; cursor: not-allowed; }
          .eud-btn--done { background: rgba(82,196,130,0.15); color: #52c482; border: 1px solid rgba(82,196,130,0.3); }
        `}</style>
      </div>
    </div>
  );
}
