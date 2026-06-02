import { Suspense, lazy, useMemo, useState } from "react";
import { workflowStepsToGraph } from "../../lib/charts/g6Adapter";

const AntvGraphLazy = lazy(() =>
  import("../../components/charts/AntvGraphCanvas").then((m) => ({ default: m.AntvGraphCanvas })),
);

/** 工作流步骤 DAG：默认 AntV G6，失败回退横向卡片 */
export type WorkflowDagStep = {
  id?: string;
  name?: string;
  tool?: string;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
};

export type WorkflowDagEdge = { source: string; target: string };

const statusStyle: Record<string, string> = {
  pending: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  running: "border-sky-400/60 bg-sky-500/10 text-sky-800 dark:text-sky-200 ring-2 ring-sky-400/40",
  completed: "border-emerald-400/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  failed: "border-rose-400/60 bg-rose-500/10 text-rose-800 dark:text-rose-200",
  cancelled: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function WorkflowDag({
  steps,
  edges,
  currentStepId,
  engine = "antv",
}: {
  steps: WorkflowDagStep[];
  edges?: WorkflowDagEdge[];
  currentStepId?: string;
  engine?: "antv" | "lite";
}) {
  const [interactive, setInteractive] = useState(engine === "antv");
  const [lite, setLite] = useState(engine !== "antv");
  const g6Data = useMemo(() => workflowStepsToGraph(steps, edges), [steps, edges]);

  if (!steps.length) return null;

  if (interactive && !lite) {
    return (
      <Suspense fallback={<WorkflowDagLite steps={steps} currentStepId={currentStepId} />}>
        <AntvGraphLazy data={g6Data} height={280} layout="dagre" rankdir="LR" onFailed={() => setLite(true)} />
      </Suspense>
    );
  }

  return (
    <div className="space-y-2">
      <WorkflowDagLite steps={steps} currentStepId={currentStepId} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
        <span>默认展示轻量步骤链；需要拖拽、缩放和自动布局时再打开交互 DAG。</span>
        <button
          type="button"
          onClick={() => {
            setLite(false);
            setInteractive(true);
          }}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-semibold text-[var(--text)] hover:border-[var(--brand)]/50 hover:text-[var(--brand)]"
        >
          打开交互 DAG
        </button>
      </div>
    </div>
  );
}

function WorkflowDagLite({ steps, currentStepId }: { steps: WorkflowDagStep[]; currentStepId?: string }) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {steps.map((step, i) => {
        const title = String(step.name || step.tool || step.id || `Step ${i + 1}`);
        const tool = step.tool ? String(step.tool) : "";
        const st = String(step.status || "pending");
        const isCurrent = currentStepId && step.id === currentStepId;
        const boxCls = statusStyle[st] || statusStyle.pending;
        return (
          <div key={step.id || i} className="flex min-w-0 items-center gap-2">
            {i > 0 ? <span className="text-[var(--muted)]">→</span> : null}
            <div
              className={`min-w-[7.5rem] max-w-[12rem] rounded-lg border px-3 py-2 shadow-sm ${boxCls} ${isCurrent ? "ring-2 ring-[var(--brand)]/50" : ""}`}
            >
              <p className="truncate text-xs font-semibold">{title}</p>
              {tool ? <p className="mt-0.5 truncate font-mono text-[10px] opacity-80">{tool}</p> : null}
              <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{st}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
