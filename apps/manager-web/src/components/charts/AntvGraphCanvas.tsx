import { useEffect, useRef } from "react";
import type { G6GraphData } from "../../lib/charts/g6Adapter";

export function AntvGraphCanvas({
  data,
  height = 360,
  layout = "dagre",
  rankdir = "LR",
  onNodeClick,
  onFailed,
}: {
  data: G6GraphData | null;
  height?: number;
  layout?: "dagre" | "force";
  rankdir?: "LR" | "TB";
  onNodeClick?: (id: string) => void;
  onFailed?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  useEffect(() => {
    if (!ref.current || !data?.nodes?.length) return;
    let disposed = false;
    let graph: { destroy: () => void; on: (e: string, h: (ev: unknown) => void) => void; off: (e: string, h: (ev: unknown) => void) => void } | null =
      null;

    const clickHandler = (ev: unknown) => {
      const target = (ev as { target?: { id?: string; type?: string } })?.target;
      if (target?.id) onNodeClickRef.current?.(target.id);
    };

    void (async () => {
      try {
        const { Graph } = await import("@antv/g6");
        if (disposed || !ref.current) return;

        const el = ref.current;
        const g = new Graph({
          container: el,
          width: el.clientWidth || 640,
          height,
          data,
          layout:
            layout === "force"
              ? { type: "force", preventOverlap: true, linkDistance: 80 }
              : { type: "dagre", rankdir, nodesep: 28, ranksep: 56 },
          behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
          autoFit: "view",
          autoResize: true,
        });
        graph = g;
        await g.draw();
        g.on("click", clickHandler);
      } catch {
        onFailed?.();
      }
    })();

    return () => {
      disposed = true;
      if (graph) {
        graph.off("click", clickHandler);
        graph.destroy();
      }
    };
  }, [data, height, layout, rankdir, onFailed]);

  return (
    <div
      ref={ref}
      className="w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
      style={{ height }}
    />
  );
}
