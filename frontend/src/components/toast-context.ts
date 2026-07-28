import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/* Context + types live apart from <ToastProvider> so the provider file only
 * exports components (keeps fast refresh working). */

export type ToastKind = "pending" | "success" | "error" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: ReactNode;
  /** ms until auto-dismiss; pending toasts stay until updated or dismissed. */
  duration?: number;
};

export type ToastInput = Omit<Toast, "id"> & { id?: string };

export type ToastApi = {
  /** Show a toast (or replace one with the same id). Returns its id. */
  show: (t: ToastInput) => string;
  /** Patch an existing toast in place ,used to advance a tx through its stages. */
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: string) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
