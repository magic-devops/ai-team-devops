import { Input, Segmented } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { markdownToHtml } from "../lib/markdown";

export { markdownToHtml } from "../lib/markdown";

export function MarkdownEditor({
  value,
  onChange,
  rows = 22,
  placeholder,
  minHeight,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  minHeight?: string;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div>
      <Segmented
        size="small"
        className="mb-2"
        value={mode}
        onChange={(v) => setMode(v as "edit" | "preview")}
        options={[
          { value: "edit", label: t("common.edit") },
          { value: "preview", label: t("common.preview") },
        ]}
      />
      {mode === "edit" ? (
        <Input.TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="font-mono text-xs"
        />
      ) : (
        <div
          className="markdown-preview overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--text)]"
          style={{ minHeight: minHeight ?? `${rows * 1.4}rem` }}
          dangerouslySetInnerHTML={{ __html: markdownToHtml(value || "") }}
        />
      )}
    </div>
  );
}
