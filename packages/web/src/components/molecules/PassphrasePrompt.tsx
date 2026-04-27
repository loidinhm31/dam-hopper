/**
 * PassphrasePrompt — modal dialog for entering the encrypted write passphrase.
 *
 * Shown when encrypted mode (Lock) is enabled but no passphrase is cached.
 * Driven by EncryptContext.promptPassphrase() / resolvePrompt() / rejectPrompt().
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock, X } from "lucide-react";
import { useEncryptMode } from "@/contexts/EncryptContext.js";

interface PassphrasePromptProps {
  /** Project name for display. */
  project?: string;
}

export function PassphrasePrompt({ project }: PassphrasePromptProps) {
  const { isPrompting, promptingProject, resolvePrompt, rejectPrompt } = useEncryptMode();

  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayProject = project ?? promptingProject ?? "this project";

  useEffect(() => {
    if (isPrompting) {
      setPassphrase("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isPrompting]);

  // Trap focus inside modal
  useEffect(() => {
    if (!isPrompting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        rejectPrompt();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isPrompting, rejectPrompt]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!passphrase.trim()) {
        setError("Passphrase is required");
        return;
      }
      if (passphrase.length < 8) {
        setError("Passphrase must be at least 8 characters");
        return;
      }
      resolvePrompt(passphrase);
    },
    [passphrase, resolvePrompt],
  );

  if (!isPrompting) return null;

  return (
    <div className="pp-overlay" role="dialog" aria-modal="true" aria-labelledby="pp-title">
      <div className="pp-backdrop" onClick={rejectPrompt} />

      <div className="pp-card">
        {/* Header */}
        <div className="pp-header">
          <div className="pp-icon-wrap">
            <Lock size={20} className="pp-icon" />
          </div>
          <div>
            <h2 id="pp-title" className="pp-title">Encrypted Mode Passphrase</h2>
            <p className="pp-subtitle">
              for{" "}
              <span className="pp-project">{displayProject}</span>
            </p>
          </div>
          <button
            type="button"
            className="pp-close"
            onClick={rejectPrompt}
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Description */}
        <p className="pp-desc">
          Your passphrase encrypts files client-side before upload.
          It is <strong>never transmitted</strong> to the server.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="pp-form">
          <div className="pp-field">
            <label htmlFor="pp-input" className="pp-label">Passphrase</label>
            <div className="pp-input-wrap">
              <input
                ref={inputRef}
                id="pp-input"
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                className={`pp-input${error ? " pp-input--error" : ""}`}
                placeholder="Enter passphrase (min. 8 characters)"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="pp-eye"
                onClick={() => setShowPassphrase((v) => !v)}
                aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
              >
                {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <span className="pp-error-msg" role="alert">{error}</span>}
          </div>

          <div className="pp-actions">
            <button type="button" className="pp-btn pp-btn--cancel" onClick={rejectPrompt}>
              Cancel
            </button>
            <button type="submit" className="pp-btn pp-btn--submit">
              Enable Lock Mode
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .pp-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .pp-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
        }
        .pp-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          background: var(--color-surface, #1a1a2e);
          border: 1px solid var(--color-border, rgba(255,255,255,0.1));
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(124,106,255,0.1);
          animation: pp-slide-in 0.2s ease;
        }
        @keyframes pp-slide-in {
          from { transform: translateY(-12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .pp-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .pp-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(124, 106, 255, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 0 12px rgba(124, 106, 255, 0.3);
        }
        .pp-icon { color: var(--color-accent, #7c6aff); }
        .pp-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text, #fff);
          margin: 0 0 2px;
        }
        .pp-subtitle {
          font-size: 12px;
          color: var(--color-text-muted, rgba(255,255,255,0.5));
          margin: 0;
        }
        .pp-project {
          color: var(--color-accent, #7c6aff);
          font-weight: 500;
        }
        .pp-close {
          margin-left: auto;
          background: none;
          border: none;
          color: var(--color-text-muted, rgba(255,255,255,0.4));
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, background 0.15s;
        }
        .pp-close:hover { color: var(--color-text, #fff); background: rgba(255,255,255,0.08); }
        .pp-desc {
          font-size: 13px;
          color: var(--color-text-muted, rgba(255,255,255,0.55));
          line-height: 1.5;
          margin: 0 0 16px;
          padding: 10px 12px;
          background: rgba(124, 106, 255, 0.06);
          border-radius: 8px;
          border-left: 3px solid var(--color-accent, #7c6aff);
        }
        .pp-desc strong { color: var(--color-text, #fff); }
        .pp-form { display: flex; flex-direction: column; gap: 16px; }
        .pp-field { display: flex; flex-direction: column; gap: 6px; }
        .pp-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-muted, rgba(255,255,255,0.5));
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .pp-input-wrap { position: relative; }
        .pp-input {
          width: 100%;
          padding: 10px 40px 10px 12px;
          background: var(--color-input-bg, rgba(0,0,0,0.25));
          border: 1px solid var(--color-border, rgba(255,255,255,0.1));
          border-radius: 8px;
          color: var(--color-text, #fff);
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
        }
        .pp-input:focus {
          border-color: var(--color-accent, #7c6aff);
          box-shadow: 0 0 0 2px rgba(124, 106, 255, 0.2);
        }
        .pp-input--error { border-color: #ff5f6d; }
        .pp-input--error:focus { box-shadow: 0 0 0 2px rgba(255, 95, 109, 0.2); }
        .pp-eye {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--color-text-muted, rgba(255,255,255,0.4));
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s;
        }
        .pp-eye:hover { color: var(--color-text, #fff); }
        .pp-error-msg {
          font-size: 12px;
          color: #ff5f6d;
        }
        .pp-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .pp-btn {
          padding: 9px 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
        }
        .pp-btn--cancel {
          background: rgba(255,255,255,0.06);
          color: var(--color-text-muted, rgba(255,255,255,0.6));
          border: 1px solid rgba(255,255,255,0.08);
        }
        .pp-btn--cancel:hover {
          background: rgba(255,255,255,0.10);
          color: var(--color-text, #fff);
        }
        .pp-btn--submit {
          background: var(--color-accent, #7c6aff);
          color: #fff;
          box-shadow: 0 0 12px rgba(124, 106, 255, 0.4);
        }
        .pp-btn--submit:hover {
          background: #9480ff;
          box-shadow: 0 0 18px rgba(124, 106, 255, 0.6);
        }
      `}</style>
    </div>
  );
}
