import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, CheckCircle, Network, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "registry", path: "#/ecosystem/a2a/workbench", icon: Bot, label: "Agent 注册", desc: "WorkBuddy/OpenClaw/HermesAgent 注册管理" },
  { id: "negotiate", path: "#/ecosystem/a2a/negotiate", icon: Network, label: "能力协商", desc: "任务与 Agent 能力匹配" },
  { id: "dispatch", path: "#/ecosystem/a2a/dispatch", icon: Send, label: "任务分发", desc: "向外部 Agent 分发任务" },
  { id: "evidence", path: "#/ecosystem/a2a/evidence", icon: CheckCircle, label: "执行证据", desc: "Agent 执行结果与证据回写" },
];

export function A2aGatewayHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["a2aSummary"], queryFn: () => api.a2aSummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.a2aGateway.hubTitle", "A2A 网关")}
        description="标准 A2A 协议：外部 Agent 注册、能力协商、任务分发与执行证据回写"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "已注册 Agent", value: s.registered_agents ?? 0 },
            { label: "活跃", value: s.active ?? 0, trend: "up" },
            { label: "已分发任务", value: s.dispatched_tasks ?? 0 },
            { label: "证据回写", value: s.evidence_received ?? 0 },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map(({ id, path, icon: Icon, label, desc }) => (
            <a key={id} href={path} className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
              <span className="rounded-lg bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-[var(--text)]">{label}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{desc}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
