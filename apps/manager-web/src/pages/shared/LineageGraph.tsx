import { Suspense, lazy, useMemo, useState } from "react";
import { toG6GraphData, type GraphEdgeIn, type GraphNodeIn } from "../../lib/charts/g6Adapter";

const AntvGraphLazy = lazy(() =>
  import("../../components/charts/AntvGraphCanvas").then((m) => ({ default: m.AntvGraphCanvas })),
);

type LNode = GraphNodeIn;
type LEdge = GraphEdgeIn;

/** 数据血缘图：默认 AntV G6，失败回退分列轻量版 */
export function LineageGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  engine = "antv",
}: {
  nodes: LNode[];
  edges: LEdge[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  engine?: "antv" | "lite";
}) {
  const [interactive, setInteractive] = useState(engine === "antv");
  const [lite, setLite] = useState(engine !== "antv");
  const g6Data = useMemo(() => toG6GraphData(nodes, edges, { selectedId }), [nodes, edges, selectedId]);

  if (!nodes.length) return null;

  if (interactive && !lite && g6Data.nodes.length) {
    return (
      <Suspense fallback={<LineageLite nodes={nodes} edges={edges} selectedId={selectedId} onSelect={onSelect} />}>
        <AntvGraphLazy
          data={g6Data}
          height={380}
          layout="dagre"
          rankdir="LR"
          onNodeClick={onSelect}
          onFailed={() => setLite(true)}
        />
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          {nodes.length} nodes · {edges.length} edges · AntV G6
        </p>
      </Suspense>
    );
  }

  return (
    <div className="space-y-2">
      <LineageLite nodes={nodes} edges={edges} selectedId={selectedId} onSelect={onSelect} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
        <span>轻量血缘视图优先加载；需要拖拽、缩放和自动布局时再打开交互图谱。</span>
        <button
          type="button"
          onClick={() => {
            setLite(false);
            setInteractive(true);
          }}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-semibold text-[var(--text)] hover:border-[var(--brand)]/50 hover:text-[var(--brand)]"
        >
          打开交互图谱
        </button>
      </div>
    </div>
  );
}

function LineageLite({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: LNode[];
  edges: LEdge[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const columns = useMemo(() => {
    const order = ["upstream", "dataset", "asset", "service", "downstream", "ai_dataset"];
    const groups: Record<string, LNode[]> = {};
    for (const n of nodes) {
      const key = order.includes(String(n.type)) ? String(n.type) : "other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(n);
    }
    const cols: Array<{ key: string; nodes: LNode[] }> = [];
    for (const key of [...order, "other"]) {
      if (groups[key]?.length) cols.push({ key, nodes: groups[key]! });
    }
    return cols;
  }, [nodes]);

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="flex min-w-max gap-6">
        {columns.map((col) => (
          <div key={col.key} className="flex min-w-[9rem] flex-col gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{col.key}</p>
            {col.nodes.map((node) => {
              const active = selectedId === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelect?.(node.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-softer)] ring-2 ring-[var(--brand)]/30"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)]/40"
                  }`}
                >
                  <p className="truncate font-semibold text-[var(--text)]">{node.label || node.id}</p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{node.domain || node.type}</p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-[var(--muted)]">
        {nodes.length} nodes · {edges.length} edges
      </p>
    </div>
  );
}
