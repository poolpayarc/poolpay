import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Spinner } from "./ui";
import {
  ToastContext,
  type Toast,
  type ToastApi,
  type ToastInput,
  type ToastKind,
} from "./toast-context";

/* ------------------------------------------------------------------ *
 * Global toast notifications.
 *
 * Every write flows through here (see lib/useTx.tsx) so a transaction is
 * never silent: wallet prompt -> mining -> confirmed/failed all surface
 * immediately, and a pending toast is updated in place rather than
 * stacking up.
 * ------------------------------------------------------------------ */

/** Errors linger long enough to actually read; pending stays until resolved. */
const DEFAULT_DURATION: Record<ToastKind, number | undefined> = {
  pending: undefined,
  success: 5000,
  error: 9000,
  info: 5000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const clearTimer = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const arm = useCallback(
    (id: string, kind: ToastKind, duration?: number) => {
      clearTimer(id);
      const ms = duration ?? DEFAULT_DURATION[kind];
      if (ms) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (t: ToastInput) => {
      const id = t.id ?? `t${++seq.current}`;
      const next: Toast = { ...t, id };
      setToasts((prev) => {
        const i = prev.findIndex((p) => p.id === id);
        if (i === -1) return [...prev, next];
        const copy = [...prev];
        copy[i] = next;
        return copy;
      });
      arm(id, next.kind, next.duration);
      return id;
    },
    [arm],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((prev) => {
        const i = prev.findIndex((p) => p.id === id);
        if (i === -1) return prev;
        const copy = [...prev];
        copy[i] = { ...copy[i], ...patch };
        arm(id, copy[i].kind, copy[i].duration);
        return copy;
      });
    },
    [arm],
  );

  // Don't leave stray timers behind on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const KIND_STYLE: Record<ToastKind, { border: string; icon: ReactNode }> = {
  pending: { border: "border-navy/40", icon: <Spinner className="h-4 w-4 text-navy" /> },
  success: { border: "border-navy/40", icon: <span className="text-navy">✓</span> },
  error: { border: "border-danger/40", icon: <span className="text-danger-strong">!</span> },
  info: { border: "border-hairline", icon: <span className="text-muted">•</span> },
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const s = KIND_STYLE[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            aria-live={t.kind === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border ${s.border} bg-white p-4 shadow-lg shadow-black/5`}
          >
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-sm font-bold">
              {s.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              {t.message && <div className="mt-0.5 break-words text-xs text-muted">{t.message}</div>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 shrink-0 rounded-lg p-1 text-faint transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
