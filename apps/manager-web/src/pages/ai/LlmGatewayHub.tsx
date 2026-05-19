import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Brain, DollarSign, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getToken } from "../../lib/authStorage";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { WorkbenchStats } from "../shared/workbenchUi";

const MODULES = [
  { id: "routes", path: "#/ai/llm-gateway/workbench", icon: Brain, label: "模型路由", desc: "按任务类型路由到最优模型" },
  { id: "cost", path: "#/ai/llm-gateway/cost", icon: DollarSign, label: "成本统计", desc: "Token 用量与费用分析" },
  { id: "throttle", path: "#/ai/llm-gateway/throttle", icon: Gauge, label: "限流策略", desc: "RPM/TPM 限流规则管理" },
];

export function LlmGatewayHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["llmGatewaySummary"], queryFn: () => api.llmGatewaySummary(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.llmGateway.hubTitle", "模型网关")}
        description="统一 LLM 路由、成本控制与限流策略管理"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "总请求数", value: s.total_requests ?? 0 },
            { label: "总 Token", value: s.total_tokens ?? 0 },
            { label: "总费用($)", value: s.total_cost_usd ?? 0 },
            { label: "平均延迟(ms)", value: s.avg_latency_ms ?? 0 },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-3">
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
