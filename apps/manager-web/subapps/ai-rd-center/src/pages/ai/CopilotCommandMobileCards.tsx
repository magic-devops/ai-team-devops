import { Button, Empty, Tag } from "antd";
import { FileSearch, ShieldCheck, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommandCandidate } from "./copilotTypes";

type Props = {
  rows: CommandCandidate[];
  selectedKey?: string;
  executing: boolean;
  onSelect: (key: string) => void;
  onRun: (row: CommandCandidate) => void;
  onPreview: (commandId: string) => void;
  onPlan: (row: CommandCandidate) => void;
};

function commandKey(row: CommandCandidate) {
  return String(row.id || row.label || row.target || row.prompt || "");
}

function commandTone(type?: string) {
  return type === "navigate" ? "green" : type === "operation" ? "orange" : "blue";
}

function riskTone(risk?: string) {
  return risk === "high" ? "red" : risk === "medium" ? "gold" : "green";
}

export function CopilotCommandMobileCards({ rows, selectedKey, executing, onSelect, onRun, onPreview, onPlan }: Props) {
  const { t } = useTranslation();

  return (
    <div className="copilotCommandMobileCards space-y-2 md:hidden">
      {rows.slice(0, 8).map((row) => {
        const key = commandKey(row);
        return (
          <div
            key={key}
            className={`rounded-xl border px-3 py-3 ${key === selectedKey ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
          >
            <button type="button" className="block w-full text-left" onClick={() => onSelect(key)}>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--text)]">{row.label}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--muted)]">{row.description}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Tag color={commandTone(row.type)}>{row.type}</Tag>
                  <Tag color={riskTone(row.policy?.risk_level || row.risk_level)}>{row.policy?.risk_level || row.risk_level || "low"}</Tag>
                </span>
              </span>
              <span className="mt-2 block break-all font-mono text-[11px] text-[var(--muted)]">{row.target || row.prompt || "-"}</span>
              <span className="mt-2 block truncate text-[11px] text-[var(--muted)]">
                {row.policy?.approval_required || row.approval_required ? t("copilot.approvalRequired", { defaultValue: "需确认" }) : t("copilot.noApprovalRequired", { defaultValue: "免审批" })} · {row.policy?.required_capability || row.required_capability || "ai.copilot.commands"}
              </span>
            </button>
            <span className="mt-3 flex flex-wrap gap-2">
              {row.type === "operation" ? (
                <Button size="small" icon={<ShieldCheck className="h-3.5 w-3.5" />} loading={executing} onClick={() => onPreview(String(row.id))}>
                  {t("common.preview")}
                </Button>
              ) : (
                <Button size="small" icon={<FileSearch className="h-3.5 w-3.5" />} onClick={() => onRun(row)}>
                  {row.type === "navigate" ? t("common.view") : t("copilot.execute", { defaultValue: "执行" })}
                </Button>
              )}
              <Button size="small" type="primary" icon={<Workflow className="h-3.5 w-3.5" />} onClick={() => onPlan(row)}>
                {t("copilot.toPlan", { defaultValue: "转计划" })}
              </Button>
            </span>
          </div>
        );
      })}
      {!rows.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("command.empty")} /> : null}
    </div>
  );
}
