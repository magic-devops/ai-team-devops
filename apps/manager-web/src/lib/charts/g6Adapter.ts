export type GraphNodeIn = { id: string; label?: string; type?: string; domain?: string; status?: string };
export type GraphEdgeIn = { from?: string; to?: string; source?: string; target?: string; kind?: string };

export type G6GraphData = {
  nodes: Array<{ id: string; style?: Record<string, unknown>; data?: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; style?: Record<string, unknown> }>;
};

const TYPE_COLORS: Record<string, string> = {
  upstream: "#94a3b8",
  dataset: "#0ea5e9",
  asset: "#2563eb",
  service: "#22c55e",
  downstream: "#f59e0b",
  ai_dataset: "#a855f7",
  completed: "#22c55e",
  running: "#0ea5e9",
  failed: "#ef4444",
  pending: "#cbd5e1",
  cancelled: "#94a3b8",
};

export function nodeFill(type?: string, status?: string): string {
  if (status && TYPE_COLORS[status]) return TYPE_COLORS[status]!;
  if (type && TYPE_COLORS[type]) return TYPE_COLORS[type]!;
  return "#64748b";
}

export function toG6GraphData(
  nodes: GraphNodeIn[],
  edges: GraphEdgeIn[],
  opts?: { selectedId?: string },
): G6GraphData {
  const selectedId = opts?.selectedId;
  return {
    nodes: nodes.map((n) => {
      const active = selectedId === n.id;
      return {
        id: n.id,
        data: { label: n.label || n.id, type: n.type, domain: n.domain, status: n.status },
        style: {
          labelText: String(n.label || n.id).slice(0, 28),
          fill: nodeFill(n.type, n.status),
          stroke: active ? readBrand() : "#e2e8f0",
          lineWidth: active ? 2 : 1,
          size: active ? 36 : 30,
          labelFontSize: 11,
          labelFill: readText(),
        },
      };
    }),
    edges: edges
      .map((e, i) => {
        const source = String(e.source ?? e.from ?? "");
        const target = String(e.target ?? e.to ?? "");
        if (!source || !target) return null;
        return {
          id: `e-${i}-${source}-${target}`,
          source,
          target,
          style: { stroke: "#94a3b8", endArrow: true },
        };
      })
      .filter(Boolean) as G6GraphData["edges"],
  };
}

export function workflowStepsToGraph(
  steps: Array<{ id?: string; name?: string; tool?: string; status?: string }>,
  edges?: Array<{ source: string; target: string }>,
): G6GraphData {
  const nodes: GraphNodeIn[] = steps.map((s, i) => ({
    id: String(s.id || `step-${i}`),
    label: String(s.name || s.tool || s.id || `Step ${i + 1}`),
    status: String(s.status || "pending"),
  }));
  const autoEdges =
    edges ??
    nodes.slice(0, -1).map((n, i) => ({
      source: n.id,
      target: nodes[i + 1]!.id,
    }));
  return toG6GraphData(nodes, autoEdges);
}

function readBrand(): string {
  if (typeof document === "undefined") return "#2563eb";
  return getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#2563eb";
}

function readText(): string {
  if (typeof document === "undefined") return "#0f172a";
  return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#0f172a";
}
