import { Alert, Button, Popconfirm, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { CommandApproval } from "./copilotTypes";

type Props = {
  approvals: CommandApproval[];
  loading?: boolean;
  error?: unknown;
  reviewing?: boolean;
  executing?: boolean;
  onApprove: (approval: CommandApproval) => void;
  onReject: (approval: CommandApproval) => void;
};

function riskColor(risk?: string) {
  return risk === "high" ? "red" : risk === "medium" ? "gold" : "green";
}

export function CopilotCommandApprovalQueue({
  approvals,
  loading = false,
  error,
  reviewing = false,
  executing = false,
  onApprove,
  onReject,
}: Props) {
  const { t } = useTranslation();
  const callbackPath = approvals[0]?.callback?.path || "/api/v1/copilot/commands/approvals/callback";

  return (
    <div className="copilotCommandApprovalQueue rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{t("copilot.commandApprovalQueue", { defaultValue: "审批队列" })}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{t("copilot.commandApprovalPending", { count: approvals.length, defaultValue: "{{count}} 个待审批命令" })}</p>
        </div>
        <Tag color={approvals.length ? "red" : "green"}>{approvals.length}</Tag>
      </div>
      <p className="mt-2 break-all rounded bg-[var(--surface-muted)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
        {t("copilot.externalApprovalCallback", { defaultValue: "外部回调" })}: {callbackPath}
      </p>
      {error ? <Alert className="mt-2" type="error" showIcon message={(error as Error).message} /> : null}
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">{t("common.loading", { defaultValue: "加载中..." })}</div>
        ) : approvals.length ? (
          approvals.slice(0, 3).map((approval) => (
            <div key={approval.id} className="rounded-lg bg-[var(--surface-muted)] p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text)]">{approval.command_label || approval.command_id}</p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--muted)]">{approval.run_id || approval.id}</p>
                </div>
                <Tag color={riskColor(approval.policy?.risk_level)}>{approval.policy?.risk_level || "risk"}</Tag>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <Popconfirm
                  title={t("copilot.approveCommand", { defaultValue: "批准执行" })}
                  description={approval.policy?.reason || t("copilot.confirmCommandDesc", { defaultValue: "该命令需要确认后才会执行并写入审计证据。" })}
                  okText={t("copilot.approveCommand", { defaultValue: "批准" })}
                  cancelText={t("common.cancel", { defaultValue: "取消" })}
                  onConfirm={() => onApprove(approval)}
                >
                  <Button block size="small" type="primary" loading={reviewing || executing}>
                    {t("copilot.approveCommand", { defaultValue: "批准" })}
                  </Button>
                </Popconfirm>
                <Popconfirm
                  title={t("copilot.rejectCommand", { defaultValue: "驳回执行" })}
                  okText={t("copilot.rejectCommand", { defaultValue: "驳回" })}
                  cancelText={t("common.cancel", { defaultValue: "取消" })}
                  onConfirm={() => onReject(approval)}
                >
                  <Button block size="small" loading={reviewing}>
                    {t("copilot.rejectCommand", { defaultValue: "驳回" })}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">{t("copilot.commandApprovalEmpty", { defaultValue: "暂无待审批命令。" })}</div>
        )}
      </div>
    </div>
  );
}
