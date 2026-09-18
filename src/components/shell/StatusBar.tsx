import React from "react";
import { ShieldCheck, XCircle, AlertTriangle, Bell, Coffee, Code2 } from "lucide-react";
import { OpenFile } from "../../types";

interface StatusBarProps {
  activeFile: OpenFile | undefined;
  toolReadyStatus: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  toolReadyStatus,
}) => {
  const language = activeFile?.language || "Plain Text";

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <div className="statusbar-item" title="Laboratory Restricted Practical Mode Active">
          <ShieldCheck size={13} />
          <span>Restricted Mode</span>
        </div>

        <div className="statusbar-item">
          <XCircle size={13} />
          <span>0</span>
          <AlertTriangle size={13} style={{ marginLeft: 4 }} />
          <span>0</span>
        </div>

        <div className="statusbar-item" title="Environment Toolchain Status">
          <Coffee size={13} />
          <span>{toolReadyStatus}</span>
        </div>
      </div>

      <div className="statusbar-right">
        <div className="statusbar-item">
          <span>Ln 1, Col 1</span>
        </div>

        <div className="statusbar-item">
          <span>Spaces: 4</span>
        </div>

        <div className="statusbar-item">
          <span>UTF-8</span>
        </div>

        <div className="statusbar-item">
          <span>CRLF</span>
        </div>

        <div className="statusbar-item" style={{ fontWeight: 600 }}>
          <Code2 size={13} />
          <span>{language.toUpperCase()}</span>
        </div>

        <div className="statusbar-item">
          <Bell size={13} />
        </div>
      </div>
    </div>
  );
};
