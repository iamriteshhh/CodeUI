import React from "react";
import { MonacoEditorGroup } from "./MonacoEditorGroup";
import { OpenFile } from "../../types";

interface SplitEditorContainerProps {
  isSplit: boolean;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  splitActiveFilePath: string | null;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
}

export const SplitEditorContainer: React.FC<SplitEditorContainerProps> = ({
  isSplit,
  openFiles,
  activeFilePath,
  splitActiveFilePath,
  onChangeContent,
  onSave,
}) => {
  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const splitFile =
    openFiles.find((f) => f.path === splitActiveFilePath) || activeFile;

  return (
    <div className="editor-workspace">
      {/* Editor Group 1 */}
      <div className="editor-group">
        <MonacoEditorGroup
          file={activeFile}
          onChangeContent={onChangeContent}
          onSave={onSave}
        />
      </div>

      {/* Editor Group 2 (Split) */}
      {isSplit && (
        <div className="editor-group split-border">
          <MonacoEditorGroup
            file={splitFile}
            onChangeContent={onChangeContent}
            onSave={onSave}
          />
        </div>
      )}
    </div>
  );
};
