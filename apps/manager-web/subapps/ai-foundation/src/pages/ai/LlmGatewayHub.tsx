import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Brain, DollarSign, Gauge, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { LoadingBlock, NeedLogin, RefreshButton } from "@/components/PageStates";
import { api } from "@/lib/api";
import { getToken } from "@/lib/authStorage";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchStats } from "@/pages/shared/workbenchUi";

const MODULES = [
  { id: "health", path: "#/ai/llm-gateway/health", icon: ShieldCheck, label: "健康治理", desc: "路由、fallback、限流与延迟风险" },
  { id: "routes", path: "#/ai/llm-gateway/workbench", icon: Brain, label: "模型路由", desc: "按任务类型路由到最优模型" },
  { id: "decision", path: "#/ai/llm-gateway/decision", icon: Brain, label: "调用决策", desc: "调用前评估成本、限流和 fallback" },
  { id: "cost", path: "#/ai/llm-gateway/cost", icon: DollarSign, label: "成本统计", desc: "Token 用量与费用分析" },
  { id: "throttle", path: "#/ai/llm-gateway/throttle", icon: Gauge, label: "限流策略", desc: "RPM/TPM 限流规则管理" },
];

export function LlmGatewayHub() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const q = useQuery({ queryKey: ["llmGatewayHealth"], queryFn: () => api.llmGatewayHealth(), enabled: authed });

  if (!authed) return <NeedLogin />;
  if (q.isLoading) return <LoadingBlock />;

  const s = (q.data as any)?.summary ?? {};

  return (
    <div className="w-full space-y-5">
      <WorkbenchShell
        title={t("page.llmGateway.hubTitle", "模型网关")}
        description="统一 LLM 路由、调用前决策、成本控制、限流策略与 fallback 治理"
        actions={<RefreshButton onClick={() => void q.refetch()} pending={q.isFetching} />}
        metrics={
          <WorkbenchStats items={[
            { label: "总请求数", value: s.total_requests ?? 0 },
            { label: "总 Token", value: s.total_tokens ?? 0 },
            { label: "总费用($)", value: s.total_cost_usd ?? 0 },
            { label: "网关健康分", value: s.health_score ?? 0 },
          ]} />
        }
      />
      <Card title="功能模块">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
