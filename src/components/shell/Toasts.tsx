import React, { useEffect, useState } from "react";
import { notify, ToastMessage } from "../../services/notify";
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";

export const Toasts: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    return notify.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 28,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 420,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => {
        let accent = "#528bff";
        let Icon = Info;

        if (toast.type === "error") {
          accent = "#f14c4c";
          Icon = AlertCircle;
        } else if (toast.type === "warning") {
          accent = "#e5c07b";
          Icon = AlertTriangle;
        } else if (toast.type === "success") {
          accent = "#23d18b";
          Icon = CheckCircle;
        }

        return (
          <div
            key={toast.id}
            onClick={() => notify.dismiss(toast.id)}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 14px",
              background: "#252526",
              color: "#cccccc",
              border: `1px solid ${accent}40`,
              borderLeft: `4px solid ${accent}`,
              borderRadius: 6,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
              cursor: "pointer",
              animation: "fadeInToast 0.18s ease-out",
            }}
          >
            <Icon size={16} color={accent} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: "#ffffff", marginBottom: toast.detail ? 2 : 0 }}>
                {toast.title}
              </div>
              {toast.detail && (
                <div style={{ color: "#a0a0a0", fontSize: 12, wordBreak: "break-word", lineHeight: 1.4 }}>
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                notify.dismiss(toast.id);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#858585",
                cursor: "pointer",
                padding: 0,
                marginTop: 2,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
