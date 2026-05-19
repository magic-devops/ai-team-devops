import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Clock, Code, Cpu, GitBranch, Play, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin } from "@/components/PageStates";

type Tab = "sql_editor" | "spark_jobs" | "flink_jobs" | "schedules";

const TABS: { id: Tab; label: string; icon: typeof Code }[] = [
  { id: "sql_editor", label: "SQL 编辑器", icon: Code },
  { id: "spark_jobs", label: "Spark 作业", icon: Cpu },
  { id: "flink_jobs", label: "Flink 作业", icon: GitBranch },
  { id: "schedules", label: "调度管理", icon: Clock },
];

const SAMPLE_SQL = `-- 示例：查询任务完成率
SELECT
  project_id,
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
  ROUND(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS completion_rate
FROM tasks
GROUP BY project_id
ORDER BY completion_rate DESC;`;

export function DataDevWorkbench({ focused: _focused, initialTab = "sql_editor" }: { focused?: boolean; initialTab?: Tab }) {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sql, setSql] = useState(SAMPLE_SQL);
  const [aiOpen, setAiOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [jobForm, setJobForm] = useState({ name: "", script: "", schedule: "" });

  const runSql = useMutation({
    mutationFn: () => fetch("/api/v1/analytics/nlq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: sql, mode: "sql" }),
    }).then(r => r.json()),
    onSuccess: (data) => setResult(data),
  });

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell
        title={t("page.dataDev.title", "数据开发工作台")}
        description="SQL 编辑器、Spark/Flink 作业管理与调度配置"
        actions={<AiAssistButton onClick={() => setAiOpen(true)} />}
      />

      <Card>
        <div className="flex gap-1 border-b border-[var(--border)] pb-0 mb-4 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition ${tab === id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>

        {tab === "sql_editor" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--muted)]">支持 StarRocks / OceanBase / Hologres SQL 方言</p>
              <div className="flex gap-2">
                <button onClick={() => setAiOpen(true)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--surface-raised)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />AI 生成 SQL
                </button>
                <button onClick={() => runSql.mutate()} disabled={!sql.trim() || runSql.isPending}
                  className="flex items-center gap-1 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
                  <Play className="h-3.5 w-3.5" />{runSql.isPending ? "执行中..." : "执行"}
                </button>
              </div>
            </div>
            <textarea
              value={sql}
              onChange={e => setSql(e.target.value)}
              className="w-full h-48 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
              spellCheck={false}
            />
            {result && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                <p className="text-xs font-medium text-[var(--muted)] mb-2">执行结果</p>
                {result.answer ? (
                  <pre className="text-xs text-[var(--text)] whitespace-pre-wrap">{typeof result.answer === "string" ? result.answer : JSON.stringify(result.answer, null, 2)}</pre>
                ) : (
                  <pre className="text-xs text-[var(--text)] whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )}

        {(tab === "spark_jobs" || tab === "flink_jobs") && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
              <p className="text-sm font-medium">新建{tab === "spark_jobs" ? " Spark" : " Flink"} 作业</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="作业名称 *" value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))} />
                <input className="input-base" placeholder="调度表达式 (如 0 2 * * *)" value={jobForm.schedule} onChange={e => setJobForm(f => ({ ...f, schedule: e.target.value }))} />
              </div>
              <textarea
                className="w-full h-32 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
                placeholder={tab === "spark_jobs" ? "# Python/Scala 脚本\nfrom pyspark.sql import SparkSession\nspark = SparkSession.builder.getOrCreate()" : "-- Flink SQL\nCREATE TABLE source (...) WITH ('connector' = 'kafka', ...);"}
                value={jobForm.script}
                onChange={e => setJobForm(f => ({ ...f, script: e.target.value }))}
              />
              <button disabled={!jobForm.name} className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white disabled:opacity-50">提交作业</button>
            </div>
            <p className="py-4 text-center text-sm text-[var(--muted)]">作业提交后将在此显示运行状态</p>
          </div>
        )}

        {tab === "schedules" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 space-y-3">
              <p className="text-sm font-medium">新建调度任务</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input-base" placeholder="任务名称 *" />
                <input className="input-base" placeholder="Cron 表达式 (如 0 2 * * *)" />
                <select className="input-base">
                  <option>SQL 作业</option>
                  <option>Spark 作业</option>
                  <option>Flink 作业</option>
                </select>
                <select className="input-base">
                  <option>依赖触发</option>
                  <option>定时触发</option>
                  <option>事件触发</option>
                </select>
              </div>
              <button className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-sm text-white">创建调度</button>
            </div>
            <p className="py-4 text-center text-sm text-[var(--muted)]">调度任务将在此显示运行历史</p>
          </div>
        )}
      </Card>

      <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="data-dev"
        title="AI 数据开发助手"
        context={{ current_tab: tab, sql_length: sql.length }}
        initialPrompt={tab === "sql_editor" ? `帮我优化以下 SQL 查询：\n\n${sql.slice(0, 300)}` : `帮我生成一个${tab === "spark_jobs" ? " Spark" : " Flink"} 作业模板`} />
    </div>
  );
}
