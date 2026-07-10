import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";
import { useUiStore } from "../store/uiStore";
import type { Toast, ToastType } from "../store/uiStore";

const ICONS: Record<ToastType, typeof AlertCircle> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

const COLORS: Record<ToastType, string> = {
  error: "toast-error",
  warning: "toast-warning",
  info: "toast-info",
  success: "toast-success",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const Icon = ICONS[toast.type];

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div className={`toast ${COLORS[toast.type]}`}>
      <Icon size={18} className="toast-icon" />
      <div className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              toast.action?.onClick();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="toast-close"
        aria-label="关闭"
        onClick={() => dismiss(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="region" aria-label="通知">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
