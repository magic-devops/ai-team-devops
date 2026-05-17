import { useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";

type Props = {
  option: EChartsOption | null;
  height?: number;
  className?: string;
  onFailed?: () => void;
};

/** 懒加载 ECharts 实例，自动 resize / dispose */
export function EChartsPanel({ option, height = 240, className = "", onFailed }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current || !option) return;
    let disposed = false;
    let chart: { resize: () => void; dispose: () => void; setOption: (o: EChartsOption, opts?: object) => void } | null = null;
    let ro: ResizeObserver | null = null;

    void (async () => {
      try {
        const echarts = await import("echarts");
        if (disposed || !ref.current) return;
        chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
        chart.setOption(option, { notMerge: true });
        setReady(true);
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(ref.current);
      } catch {
        onFailed?.();
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.dispose();
      setReady(false);
    };
  }, [option, onFailed]);

  return (
    <div
      ref={ref}
      className={`w-full ${className}`}
      style={{ height, opacity: ready ? 1 : 0.6 }}
      aria-hidden={!option}
    />
  );
}
