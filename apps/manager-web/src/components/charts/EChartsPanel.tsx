import { useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";

type EChartsRuntime = {
  init: (
    el: HTMLDivElement,
    theme?: string,
    opts?: object,
  ) => {
    resize: () => void;
    dispose: () => void;
    setOption: (o: EChartsOption, opts?: object) => void;
    on: (
      event: string,
      handler: (params: { dataIndex?: number; seriesType?: string }) => void,
    ) => void;
  };
};

let echartsRuntime: Promise<EChartsRuntime> | null = null;

export function resolveEChartsRuntime(module: unknown): EChartsRuntime {
  const namespace = module as { init?: unknown; default?: unknown } | null;
  const runtime = (
    typeof namespace?.init === "function" ? namespace : namespace?.default
  ) as EChartsRuntime | undefined;
  if (!runtime || typeof runtime.init !== "function")
    throw new Error("ECharts runtime does not export init");
  return { init: runtime.init.bind(runtime) };
}

function loadEChartsRuntime() {
  echartsRuntime ??= Promise.all([
    import("echarts/lib/echarts"),
    import("echarts/lib/chart/bar"),
    import("echarts/lib/chart/line"),
    import("echarts/lib/chart/pie"),
    import("echarts/lib/component/grid"),
    import("echarts/lib/component/legend"),
    import("echarts/lib/component/legendScroll"),
    import("echarts/lib/component/title"),
    import("echarts/lib/component/tooltip"),
  ])
    .then(([echarts]) => resolveEChartsRuntime(echarts))
    .catch((error) => {
      echartsRuntime = null;
      throw error;
    });
  return echartsRuntime;
}

type Props = {
  option: EChartsOption | null;
  height?: number;
  className?: string;
  onFailed?: () => void;
  onPointClick?: (index: number) => void;
  ariaLabel?: string;
};

/** 懒加载 ECharts 实例，自动 resize / dispose */
export function EChartsPanel({
  option,
  height = 240,
  className = "",
  onFailed,
  onPointClick,
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current || !option) return;
    let disposed = false;
    let chart: ReturnType<EChartsRuntime["init"]> | null = null;
    let ro: ResizeObserver | null = null;

    void (async () => {
      try {
        const echarts = await loadEChartsRuntime();
        if (disposed || !ref.current) return;
        chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
        chart.setOption(option, { notMerge: true });
        if (onPointClick)
          chart.on("click", (params) => {
            if (typeof params.dataIndex === "number")
              onPointClick(params.dataIndex);
          });
        setReady(true);
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(ref.current);
      } catch (error) {
        console.warn("[EChartsPanel] Chart initialization failed", error);
        onFailed?.();
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.dispose();
      setReady(false);
    };
  }, [option, onFailed, onPointClick]);

  return (
    <div
      ref={ref}
      className={`w-full ${className}`}
      style={{ height, opacity: ready ? 1 : 0.6 }}
      aria-hidden={!option}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
    />
  );
}
