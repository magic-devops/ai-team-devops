import { useQuery } from "@tanstack/react-query";
import { Alert, Descriptions, Input, Tag } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NeedLogin } from "../../components/PageStates";
import { api } from "../../lib/api";
import { getProjectId, getToken } from "../../lib/authStorage";
import { LineageGraph } from "../shared/LineageGraph";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

export function LineageWorkbench() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");

  const lineageQ = useQuery({
    queryKey: ["analyticsLineage"],
    queryFn: api.analyticsLineage,
    enabled: authed && hasProject,
  });

  const impactQ = useQuery({
    queryKey: ["lineageImpact", selected],
    queryFn: () => api.analyticsLineageImpact(selected),
    enabled: authed && hasProject && Boolean(selected),
  });

  const nodes = useMemo(() => {
    const raw = lineageQ.data?.nodes ?? [];
    const n = filter.trim().toLowerCase();
    if (!n) return raw;
    return raw.filter(
      (x: { id?: string; label?: string }) =>
        String(x.id || "")
          .toLowerCase()
          .includes(n) ||
        String(x.label || "")
          .toLowerCase()
          .includes(n),
    );
  }, [lineageQ.data, filter]);

  const edges = lineageQ.data?.edges ?? [];

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <WorkbenchShell
      title={t("page.analytics.lineage")}
      description={t("page.lineage.desc")}
      actions={<RefreshButton onClick={() => void lineageQ.refetch()} pending={lineageQ.isFetching} />}
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.lineage.nodes"), value: nodes.length },
            { label: t("page.lineage.edges"), value: edges.length },
            { label: t("page.lineage.upstream"), value: impactQ.data?.upstream_count ?? "—" },
            { label: t("page.lineage.downstream"), value: impactQ.data?.downstream_count ?? "—" },
          ]}
        />
      }
    >
      {lineageQ.isError ? (
        <Alert type="error" showIcon className="mb-4" message={(lineageQ.error as Error).message} />
      ) : null}

      <WorkbenchPanel>
        <Input.Search
          allowClear
          className="mb-4 max-w-md"
          placeholder={t("page.lineage.filterPh")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <LineageGraph
          nodes={nodes}
          edges={edges}
          selectedId={selected}
          onSelect={(id) => setSelected(id)}
        />
      </WorkbenchPanel>

      {selected ? (
        <WorkbenchPanel title={t("page.lineage.impactTitle")}>
          <Descriptions column={1} bordered size="small" className="mb-4">
            <Descriptions.Item label={t("page.lineage.node")}>{selected}</Descriptions.Item>
            <Descriptions.Item label={t("page.lineage.upstream")}>
              {impactQ.data?.upstream_count ?? 0}
            </Descriptions.Item>
            <Descriptions.Item label={t("page.lineage.downstream")}>
              {impactQ.data?.downstream_count ?? 0}
            </Descriptions.Item>
          </Descriptions>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold">{t("page.lineage.upstreamList")}</p>
              <ul className="space-y-1 text-xs">
                {(impactQ.data?.upstream ?? []).map((n: { id?: string; label?: string }) => (
                  <li key={String(n.id)}>
                    <Tag>{n.label || n.id}</Tag>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold">{t("page.lineage.downstreamList")}</p>
              <ul className="space-y-1 text-xs">
                {(impactQ.data?.downstream ?? []).map((n: { id?: string; label?: string }) => (
                  <li key={String(n.id)}>
                    <Tag color="blue">{n.label || n.id}</Tag>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </WorkbenchPanel>
      ) : null}
    </WorkbenchShell>
  );
}
