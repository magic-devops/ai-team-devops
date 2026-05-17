import type { UseQueryResult } from "@tanstack/react-query";
import { Statistic } from "antd";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/Card";
import { ErrorBlock, LoadingBlock, RefreshButton, SearchInput } from "../../components/PageStates";

export { ErrorBlock, LoadingBlock, RefreshButton, SearchInput };

export type WorkbenchStatItem = {
  label: string;
  value: string | number;
  hint?: string;
  /** 数值趋势色：up 绿 / down 红 */
  trend?: "up" | "down" | "neutral";
};

/** 统一面板：复用项目 Card（Ant Design Card 封装） */
export function WorkbenchPanel({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Card title={title} actions={actions} className={className}>
      {children}
    </Card>
  );
}

function StatCard({ item }: { item: WorkbenchStatItem }) {
  const valueColor =
    item.trend === "up" ? "var(--brand)" : item.trend === "down" ? "#dc2626" : "var(--text)";

  return (
    <div className="workbench-stat-card">
      <Statistic
        title={<span className="workbench-stat-label">{item.label}</span>}
        value={item.value}
        valueStyle={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.2,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {item.hint ? <p className="workbench-stat-hint">{item.hint}</p> : null}
    </div>
  );
}

/**
 * 指标卡行：自适应网格，避免窄列导致中文标题竖排。
 * 须作为 WorkbenchShell metrics 的直接子节点（Shell 不再套额外 grid）。
 */
export function WorkbenchStats({ items }: { items: WorkbenchStatItem[] }) {
  if (!items.length) return null;
  return (
    <div className="workbench-stats-grid" role="group" aria-label="metrics">
      {items.map((item) => (
        <StatCard key={item.label} item={item} />
      ))}
    </div>
  );
}

/** 单指标（与 WorkbenchStats 视觉一致） */
export function WorkbenchMetric(item: WorkbenchStatItem) {
  return <WorkbenchStats items={[item]} />;
}

/** 标准查询态：加载 / 错误 / 内容 */
export function WorkbenchQueryGate({
  query,
  children,
}: {
  query: Pick<UseQueryResult, "isLoading" | "isError" | "error">;
  children: ReactNode;
}) {
  if (query.isLoading) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock message={(query.error as Error).message} />;
  return <>{children}</>;
}

/** 从 hash 同步 Tabs（如 #/skills-hub/repos） */
export function useHashTabSync<T extends string>(marker: string, tabs: readonly T[], defaultTab: T): [T, (tab: T) => void] {
  const parse = (): T => {
    const h = window.location.hash;
    for (const tab of tabs) {
      if (tab === defaultTab && h === marker) return tab;
      if (h.includes(`${marker}/${tab}`)) return tab;
    }
    return defaultTab;
  };

  const [tab, setTabState] = useState<T>(parse);

  useEffect(() => {
    const sync = () => setTabState(parse());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [marker]);

  const setTab = (next: T) => {
    setTabState(next);
    window.location.hash = next === defaultTab ? marker : `${marker}/${next}`;
  };

  return [tab, setTab];
}

/** 输入防抖（搜索框等） */
/** 从 hash 解析 query（如 #/search?q=foo） */
export function parseHashQuery(hash = typeof window !== "undefined" ? window.location.hash : ""): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}

const RECENT_SEARCH_KEY = "sop-recent-searches";

export function loadRecentSearches(max = 8): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCH_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list.filter(Boolean).slice(0, max) : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(term: string, max = 8): void {
  const q = term.trim();
  if (q.length < 2) return;
  const prev = loadRecentSearches(max).filter((x) => x !== q);
  try {
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify([q, ...prev].slice(0, max)));
  } catch {
    /* ignore */
  }
}

export function useDebouncedValue<T>(value: T, delayMs = 320): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
