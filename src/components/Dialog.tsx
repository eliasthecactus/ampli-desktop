import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { openDialog } from "../lib/ui";

export function Dialog({ title, children, onClose, wide, footer }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}

function PromptBody({ label, initial, confirm, onDone }: { label: string; initial: string; confirm: string; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onDone(value.trim());
      }}
    >
      <label className="field">
        <span>{label}</span>
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={!value.trim()}>
          {confirm}
        </button>
      </div>
    </form>
  );
}

export function prompt(title: string, label: string, initial = "", confirm = "Save"): Promise<string | null> {
  return new Promise((resolve) => {
    const close = openDialog((c) => (
      <Dialog title={title} onClose={() => (c(), resolve(null))}>
        <PromptBody
          label={label}
          initial={initial}
          confirm={confirm}
          onDone={(v) => {
            close();
            resolve(v);
          }}
        />
      </Dialog>
    ));
  });
}

export function confirm(title: string, text: ReactNode, action = "Delete", danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    const close = openDialog((c) => (
      <Dialog title={title} onClose={() => (c(), resolve(false))}>
        <p className="dialog-text">{text}</p>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={() => (close(), resolve(false))}>
            Cancel
          </button>
          <button className={`btn ${danger ? "danger" : "primary"}`} autoFocus onClick={() => (close(), resolve(true))}>
            {action}
          </button>
        </div>
      </Dialog>
    ));
  });
}

export function choose<T>(title: string, options: { value: T; label: ReactNode; detail?: ReactNode }[]): Promise<T | null> {
  return new Promise((resolve) => {
    const close = openDialog((c) => (
      <Dialog title={title} onClose={() => (c(), resolve(null))}>
        <div className="choice-list">
          {options.map((o, i) => (
            <button key={i} className="choice" onClick={() => (close(), resolve(o.value))}>
              <strong>{o.label}</strong>
              {o.detail && <span>{o.detail}</span>}
            </button>
          ))}
        </div>
      </Dialog>
    ));
  });
}
