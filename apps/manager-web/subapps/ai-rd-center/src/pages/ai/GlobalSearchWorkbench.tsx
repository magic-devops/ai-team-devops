import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, List, Segmented, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectContextGate, ProjectScopeNotice } from "@/components/ProjectContextGate";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import {
  loadRecentSearches,
  parseHashQuery,
  pushRecentSearch,
  useDebouncedValue,
  WorkbenchPanel,
  WorkbenchStats,
} from "@/pages/shared/workbenchUi";

const KEYWORD_TARGETS: Record<string, string> = {
  requirements: "#/requirements",
  requirement: "#/requirements",
  tasks: "#/tasks",
  task: "#/tasks",
  issues: "#/issues",
  issue: "#/issues",
  design_docs: "#/intelligence/design-docs",
  specs: "#/intelligence/specs",
};

const SEMANTIC_TARGETS: Record<string, string> = {
  requirements: "#/requirements",
  tasks: "#/tasks",
  issues: "#/issues",
  knowledge: "#/intelligence/kb",
  design_docs: "#/intelligence/design-docs",
  specs: "#/intelligence/specs",
};

const TYPE_FILTERS = ["all", "requirements", "tasks", "issues"] as const;
type SearchMode = "keyword" | "semantic" | "hybrid";

type SearchRow = {
  type?: string;
  table?: string;
  id?: string;
  title?: string;
  snippet?: string;
  description?: string;
  score?: number;
  source?: string;
};

function isProjectAccessError(error: unknown): boolean {
  return error instanceof Error && (
    /^HTTP (?:401|403|404)(?::|\b)/.test(error.message) ||
    error.message === "账号或项目已切换，请在当前工作区重新操作"
  );
}

function SearchReadFailure({ label, error, retrying, onRetry }: {
  label: string;
  error: Error | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert
      className="mb-3"
      type="warning"
      showIcon
      message={label}
      description={error?.message}
      action={
        <Button
          size="small"
          loading={retrying}
          disabled={retrying}
          aria-label={`${label}: ${t("common.refresh")}`}
          onClick={onRetry}
        >
          {t("common.refresh")}
        </Button>
      }
    />
  );
}

function rowHref(mode: SearchMode, row: SearchRow): string {
  const key = String(mode === "keyword" ? row.type : row.table || row.type || "").toLowerCase();
  const map = mode === "keyword" ? KEYWORD_TARGETS : SEMANTIC_TARGETS;
  return map[key] || "#/dashboard";
}

function ResultList({
  loading,
  items,
  mode,
  empty,
  minHint,
  trimmedLen,
  showScore,
  failed,
}: {
  loading: boolean;
  items: SearchRow[];
  mode: SearchMode;
  empty: string;
  minHint: string;
  trimmedLen: number;
  showScore?: boolean;
  failed?: boolean;
}) {
  return (
    <List
      loading={loading}
      locale={{
        emptyText:
          failed ? null : trimmedLen < 2 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={minHint} />
          ) : (
            <Empty description={empty} />
          ),
      }}
      dataSource={items}
      renderItem={(row) => {
        const label = String(row.type || row.table || "?");
        const snippet = row.snippet || row.description;
        return (
          <List.Item className="!px-4">
            <a href={rowHref(mode, row)} className="block w-full hover:text-[var(--brand)]">
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{label}</Tag>
                {row.source ? <Tag color="blue">{row.source}</Tag> : null}
                {showScore && row.score != null ? (
                  <span className="text-[10px] tabular-nums text-[var(--muted)]">
                    {(row.score * 100).toFixed(0)}%
                  </span>
                ) : null}
                {row.id ? <span className="font-mono text-[10px] text-[var(--muted)]">{row.id}</span> : null}
                <span className="min-w-0 flex-1 truncate font-medium">{row.title || row.id}</span>
              </div>
              {snippet ? <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{snippet}</p> : null}
            </a>
          </List.Item>
        );
      }}
    />
  );
}

export function GlobalSearchWorkbench() {
  return (
    <ProjectContextGate requireSelection>
      <ProjectGlobalSearch />
    </ProjectContextGate>
  );
}

function ProjectGlobalSearch() {
  const { t } = useTranslation();
  const [q, setQ] = useState(() => parseHashQuery().get("q") ?? "");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("all");
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const debounced = useDebouncedValue(q.trim(), 320);
  const enabled = debounced.length >= 2;
  const keywordEnabled = enabled && (mode === "keyword" || mode === "hybrid");
  const semanticEnabled = enabled && (mode === "semantic" || mode === "hybrid");

  const statusQ = useQuery({
    queryKey: ["semanticSearchStatus"],
    queryFn: api.semanticSearchStatus,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onHash = () => {
      const next = parseHashQuery().get("q");
      if (next != null && next !== q.trim()) setQ(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) return;
    const base = "#/search";
    const next = `${base}?q=${encodeURIComponent(debounced)}`;
    if (window.location.hash.split("?")[0] !== base || !window.location.hash.includes("q=")) {
      window.location.hash = next;
    } else if (window.location.hash !== next) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
      } catch {
        window.location.hash = next;
      }
    }
    pushRecentSearch(debounced);
    setRecent(loadRecentSearches());
  }, [debounced]);

  const keywordQ = useQuery({
    queryKey: ["workspaceSearchPage", debounced],
    queryFn: () => api.workspaceSearch(debounced),
    enabled: keywordEnabled,
  });

  const semanticQ = useQuery({
    queryKey: ["semanticSearchPage", debounced, mode],
    queryFn: () =>
      api.semanticSearch(
        debounced,
        statusQ.isError ? undefined : statusQ.data?.default_tables,
        mode === "hybrid" ? "hybrid" : mode === "semantic" ? "vector" : "keyword",
        8,
      ),
    enabled: semanticEnabled,
    retry: false,
  });

  const statusData = statusQ.isError ? undefined : statusQ.data;
  const semanticPayload = semanticQ.isError ? undefined : semanticQ.data;
  const keywordItems: SearchRow[] = keywordQ.isError ? [] : keywordQ.data ?? [];
  const semanticItems: SearchRow[] = semanticPayload?.items ?? [];

  const rawItems: SearchRow[] = useMemo(() => {
    if (mode === "keyword") return keywordItems;
    if (mode === "semantic") return semanticItems;
    const merged = new Map<string, SearchRow>();
    for (const row of [...semanticItems, ...keywordItems]) {
      const key = `${row.table || row.type}:${row.id}`;
      const prev = merged.get(key);
      if (!prev || Number(row.score ?? 0) > Number(prev.score ?? 0)) merged.set(key, row);
    }
    return [...merged.values()].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  }, [mode, keywordItems, semanticItems]);

  const semanticAvailable = semanticPayload?.available ?? statusData?.available ?? false;
  const semanticReason = semanticPayload?.reason ?? statusData?.reason ?? "";
  const loading =
    mode === "keyword"
      ? keywordQ.isFetching
      : mode === "semantic"
        ? semanticQ.isFetching
        : keywordQ.isFetching || semanticQ.isFetching;

  const items = useMemo(() => {
    if (!Array.isArray(rawItems)) return [];
    if (typeFilter === "all" || mode !== "keyword") return rawItems;
    return rawItems.filter((row) => String(row.type || "").toLowerCase().includes(typeFilter));
  }, [rawItems, typeFilter, mode]);

  const deniedQuery = [statusQ, ...(keywordEnabled ? [keywordQ] : []), ...(semanticEnabled ? [semanticQ] : [])]
    .find((query) => query.isError && isProjectAccessError(query.error));
  if (deniedQuery) {
    return (
      <ProjectScopeNotice
        message={deniedQuery.error?.message}
        onRetry={() => {
          void statusQ.refetch();
          if (keywordEnabled) void keywordQ.refetch();
          if (semanticEnabled) void semanticQ.refetch();
        }}
      />
    );
  }

  const indexReady = (statusData?.tables ?? []).filter((x) => x.ready).length;
  const searchFailed = (keywordEnabled && keywordQ.isError) || (semanticEnabled && semanticQ.isError);
  const searchUnresolved = (keywordEnabled && keywordQ.data === undefined) || (semanticEnabled && semanticQ.data === undefined);

  return (
    <WorkbenchShell
      title={t("page.search.title")}
      description={t("page.search.desc")}
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.search.results"), value: enabled && !searchFailed && !searchUnresolved ? items.length : "—" },
            {
              label: t("page.search.indexHealth"),
              value: statusQ.isError ? "—" : statusQ.isLoading ? "…" : statusData ? `${indexReady}/${statusData.tables?.length ?? 0}` : "—",
            },
            {
              label: t("page.search.mode"),
              value:
                mode === "keyword"
                  ? t("page.search.tabKeyword")
                  : mode === "semantic"
                    ? t("page.search.tabSemantic")
                    : t("page.search.tabHybrid"),
            },
          ]}
        />
      }
    >
      <WorkbenchPanel>
        <Input.Search
          size="large"
          allowClear
          aria-label={t("page.search.placeholder")}
          placeholder={t("page.search.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          loading={loading}
        />
        <Typography.Paragraph type="secondary" className="!mb-3 mt-2 text-xs">
          {t("page.search.hint")}
        </Typography.Paragraph>

        {statusQ.isError ? (
          <SearchReadFailure
            label={t("page.search.indexHealth")}
            error={statusQ.error}
            retrying={statusQ.isFetching}
            onRetry={() => { void statusQ.refetch(); }}
          />
        ) : statusData && !(semanticEnabled && semanticQ.isError) ? (
          <Alert
            className="mb-3"
            type={semanticAvailable ? "success" : "info"}
            showIcon
            message={
              semanticAvailable
                ? t("page.search.semanticReady", { count: indexReady })
                : t("page.search.semanticUnavailable")
            }
            description={
              semanticAvailable
                ? (statusData.tables ?? []).map((tb) => `${tb.table}:${tb.rows}`).join(" · ")
                : semanticReason || undefined
            }
          />
        ) : null}

        {keywordEnabled && keywordQ.isError ? (
          <SearchReadFailure
            label={t("page.search.tabKeyword")}
            error={keywordQ.error}
            retrying={keywordQ.isFetching}
            onRetry={() => { void keywordQ.refetch(); }}
          />
        ) : null}
        {semanticEnabled && semanticQ.isError ? (
          <SearchReadFailure
            label={t("page.search.tabSemantic")}
            error={semanticQ.error}
            retrying={semanticQ.isFetching}
            onRetry={() => { void semanticQ.refetch(); }}
          />
        ) : null}

        {recent.length && !q ? (
          <div className="mb-4">
            <Typography.Text type="secondary" className="text-xs">
              {t("page.search.recent")}
            </Typography.Text>
            <div className="mt-2 flex flex-wrap gap-2">
              {recent.map((term) => (
                <Button key={term} size="small" onClick={() => setQ(term)}>
                  {term}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <Tabs
          activeKey={mode}
          onChange={(k) => setMode(k as SearchMode)}
          items={[
            {
              key: "hybrid",
              label: t("page.search.tabHybrid"),
              children: (
                <>
                  {!statusQ.isError && !semanticQ.isError && !semanticAvailable && !semanticQ.isLoading && semanticReason ? (
                    <Alert type="warning" showIcon className="mb-3" message={semanticReason} />
                  ) : null}
                  <ResultList
                    loading={loading}
                    items={items}
                    mode="hybrid"
                    empty={t("page.search.empty")}
                    minHint={t("page.search.minChars")}
                    trimmedLen={debounced.length}
                    showScore
                    failed={searchFailed}
                  />
                </>
              ),
            },
            {
              key: "keyword",
              label: t("page.search.tabKeyword"),
              children: (
                <>
                  <Segmented
                    className="mb-4"
                    value={typeFilter}
                    onChange={(v) => setTypeFilter(v as (typeof TYPE_FILTERS)[number])}
                    options={TYPE_FILTERS.map((key) => ({
                      value: key,
                      label: key === "all" ? t("page.search.filterAll") : t(`nav.${key}`, { defaultValue: key }),
                    }))}
                  />
                  <ResultList
                    loading={loading}
                    items={items}
                    mode="keyword"
                    empty={t("page.search.empty")}
                    minHint={t("page.search.minChars")}
                    trimmedLen={debounced.length}
                    failed={keywordQ.isError}
                  />
                </>
              ),
            },
            {
              key: "semantic",
              label: t("page.search.tabSemantic"),
              children: (
                <>
                  {!statusQ.isError && !semanticQ.isError && !semanticAvailable && !semanticQ.isLoading ? (
                    <Alert
                      type="info"
                      showIcon
                      className="mb-3"
                      message={t("page.search.semanticUnavailable")}
                      description={semanticReason || undefined}
                    />
                  ) : null}
                  <ResultList
                    loading={loading}
                    items={items}
                    mode="semantic"
                    empty={t("page.search.empty")}
                    minHint={t("page.search.minChars")}
                    trimmedLen={debounced.length}
                    showScore
                    failed={semanticQ.isError}
                  />
                </>
              ),
            },
          ]}
        />
      </WorkbenchPanel>
    </WorkbenchShell>
  );
}
