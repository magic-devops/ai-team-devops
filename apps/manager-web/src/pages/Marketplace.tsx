import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, Drawer, Form, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircle2, Download, Star, Trash2 } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";

const EChartsDonutLazy = lazy(() =>
  import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "./shared/workbenchUi";

type MarketModule = "catalog" | "installed";

const types = ["", "spec", "skill", "template", "rule-pack"];

function signatureColor(status: string) {
  if (status === "signed" || status === "builtin") return "success";
  if (status === "unsigned") return "warning";
  return "default";
}

export function Marketplace() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("rating");
  const [module, setModule] = useState<MarketModule>("catalog");
  const [selected, setSelected] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rateForm] = Form.useForm<{ score: number; comment: string }>();

  const summary = useQuery({ queryKey: ["marketplaceSummary"], queryFn: api.marketplaceSummary });
  const charts = useQuery({ queryKey: ["marketplaceCharts"], queryFn: api.marketplaceCharts });
  const list = useQuery({
    queryKey: ["mp", q, type, sort],
    queryFn: () => api.marketplaceList(q, type, sort),
  });
  const installed = useQuery({ queryKey: ["marketplaceInstalled"], queryFn: api.marketplaceInstalled });
  const verify = useQuery({
    queryKey: ["marketplaceVerify", selected],
    queryFn: () => api.marketplaceVerify(selected),
    enabled: Boolean(selected) && drawerOpen,
  });
  const ratings = useQuery({
    queryKey: ["marketplaceRatings", selected],
    queryFn: () => api.marketplaceRatings(selected, 30),
    enabled: Boolean(selected) && drawerOpen,
  });

  const refresh = useMutation({
    mutationFn: api.marketplaceRefresh,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mp"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
      message.success(t("common.refreshed"));
    },
  });
  const install = useMutation({
    mutationFn: (name: string) => api.marketplaceInstall({ name, verify_signature: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mp"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceInstalled"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
      message.success(t("page.marketplace.installedOk"));
    },
    onError: (e) => message.error((e as Error).message),
  });
  const uninstall = useMutation({
    mutationFn: (name: string) => api.marketplaceUninstall(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mp"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceInstalled"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
      message.success(t("page.marketplace.uninstalled"));
    },
  });
  const rate = useMutation({
    mutationFn: (v: { score: number; comment: string }) =>
      api.marketplaceRate({ package: selected, score: v.score, comment: v.comment }),
    onSuccess: () => {
      rateForm.resetFields();
      void qc.invalidateQueries({ queryKey: ["mp"] });
      void qc.invalidateQueries({ queryKey: ["marketplaceRatings", selected] });
      void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
      message.success(t("page.marketplace.ratingSubmitted"));
    },
  });

  const items = list.data?.items ?? [];
  const selectedPackage = useMemo(() => items.find((x: any) => x.name === selected), [items, selected]);

  const openDetail = (name: string) => {
    setSelected(name);
    setDrawerOpen(true);
  };

  const catalogCols: ColumnsType<any> = [
    {
      title: t("page.marketplace.asset"),
      dataIndex: "name",
      render: (name: string, row) => (
        <button type="button" className="text-left" onClick={() => openDetail(name)}>
          <p className="font-semibold text-[var(--text)]">{name}</p>
          <p className="text-xs text-[var(--muted)]">v{row.version} · {row.type}</p>
        </button>
      ),
    },
    {
      title: t("page.marketplace.signature"),
      dataIndex: "signature_status",
      width: 110,
      render: (v: string) => <Tag color={signatureColor(v)}>{v}</Tag>,
    },
    {
      title: t("page.marketplace.rating"),
      width: 100,
      render: (_: unknown, row: any) => `⭐ ${row.rating?.avg ?? 0}`,
    },
    {
      title: t("page.marketplace.action"),
      width: 140,
      render: (_: unknown, row: any) => (
        <Button
          size="small"
          disabled={row.installed || install.isPending}
          onClick={() => install.mutate(row.name)}
        >
          {row.installed ? t("page.marketplace.installed") : t("page.marketplace.install")}
        </Button>
      ),
    },
  ];

  const installedCols: ColumnsType<any> = [
    { title: t("page.marketplace.asset"), dataIndex: "name", ellipsis: true },
    { title: t("page.marketplace.type"), dataIndex: "type", width: 100 },
    {
      title: t("page.marketplace.signature"),
      dataIndex: "signature_status",
      width: 110,
      render: (v: string) => <Tag color={signatureColor(v)}>{v}</Tag>,
    },
    {
      title: t("page.marketplace.action"),
      width: 100,
      render: (_: unknown, row: any) => (
        <Button size="small" danger icon={<Trash2 className="h-3.5 w-3.5" />} loading={uninstall.isPending} onClick={() => uninstall.mutate(row.name)} />
      ),
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.marketplace.title")}
      description={t("page.marketplace.hint")}
      actions={
        <>
          <RefreshButton onClick={() => refresh.mutate()} pending={refresh.isPending} />
          <Button type={module === "catalog" ? "primary" : "default"} onClick={() => setModule("catalog")}>
            {t("page.marketplace.module.catalog")}
          </Button>
          <Button type={module === "installed" ? "primary" : "default"} onClick={() => setModule("installed")}>
            {t("page.marketplace.module.installed")}
          </Button>
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.marketplace.total"), value: summary.data?.packages ?? 0 },
            { label: t("page.marketplace.installed"), value: summary.data?.installed ?? 0 },
            { label: t("page.marketplace.avgRating"), value: summary.data?.avg_rating ?? "—" },
            { label: t("page.marketplace.signed"), value: summary.data?.signed_packages ?? 0 },
          ]}
        />
      }
    >
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        {Object.keys(pieToRecord(charts.data?.by_type)).length ? (
          <WorkbenchPanel title={t("page.marketplace.chartType")}>
            <Suspense fallback={null}>
              <EChartsDonutLazy data={pieToRecord(charts.data?.by_type)} height={200} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
        {Object.keys(pieToRecord(charts.data?.by_signature)).length ? (
          <WorkbenchPanel title={t("page.marketplace.chartSignature")}>
            <Suspense fallback={null}>
              <EChartsDonutLazy data={pieToRecord(charts.data?.by_signature)} height={200} />
            </Suspense>
          </WorkbenchPanel>
        ) : null}
      </div>
      <WorkbenchPanel
        title={module === "catalog" ? t("page.marketplace.catalog") : t("page.marketplace.installedAssets")}
      >
        {module === "catalog" ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <Input.Search
              allowClear
              className="min-w-[14rem] flex-1"
              placeholder={t("page.marketplace.searchPh")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              className="min-w-[8rem]"
              value={type || undefined}
              allowClear
              placeholder={t("page.marketplace.allTypes")}
              onChange={(v) => setType(v || "")}
              options={types.filter(Boolean).map((x) => ({ value: x, label: x }))}
            />
            <Select
              className="min-w-[8rem]"
              value={sort}
              onChange={setSort}
              options={[
                { value: "rating", label: t("page.marketplace.sortRating") },
                { value: "name", label: t("page.marketplace.sortName") },
                { value: "newest", label: t("page.marketplace.sortNewest") },
              ]}
            />
          </div>
        ) : null}

        {module === "catalog" ? (
          <Table
            rowKey={(r) => `${r.name}-${r.version}`}
            loading={list.isLoading}
            columns={catalogCols}
            dataSource={items}
            pagination={{ pageSize: 12 }}
          />
        ) : (
          <Table
            rowKey={(r) => `${r.name}-${r.version}`}
            loading={installed.isLoading}
            columns={installedCols}
            dataSource={installed.data ?? []}
            pagination={{ pageSize: 12 }}
          />
        )}
      </WorkbenchPanel>

      <Drawer
        title={selected || t("page.marketplace.detail")}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={520}
      >
        {selectedPackage || verify.data ? (
          <div className="space-y-4">
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t("page.marketplace.version")}>
                {verify.data?.version ?? selectedPackage?.version}
              </Descriptions.Item>
              <Descriptions.Item label={t("page.marketplace.signature")}>
                <Tag color={signatureColor(verify.data?.signature_status ?? selectedPackage?.signature_status)}>
                  {verify.data?.signature_status ?? selectedPackage?.signature_status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("page.marketplace.registry")}>
                {verify.data?.registry ?? selectedPackage?.registry}
              </Descriptions.Item>
              <Descriptions.Item label={t("page.marketplace.rating")}>
                ⭐ {selectedPackage?.rating?.avg ?? 0} ({selectedPackage?.rating?.count ?? 0})
              </Descriptions.Item>
            </Descriptions>

            {verify.data?.signature ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs font-mono">
                {JSON.stringify(verify.data.signature, null, 2)}
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-xs font-semibold">{t("page.marketplace.rate")}</p>
              <Form
                form={rateForm}
                layout="vertical"
                initialValues={{ score: 5, comment: "" }}
                onFinish={(v) => rate.mutate(v)}
              >
                <Form.Item name="score" label={t("page.marketplace.score")}>
                  <Select options={[5, 4, 3, 2, 1].map((n) => ({ value: n, label: String(n) }))} />
                </Form.Item>
                <Form.Item name="comment" label={t("page.marketplace.comment")}>
                  <Input.TextArea rows={3} placeholder={t("page.marketplace.commentPh")} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={rate.isPending} icon={<Star className="h-4 w-4" />}>
                  {t("page.marketplace.submitRating")}
                </Button>
              </Form>
              <ul className="mt-3 space-y-2">
                {(ratings.data?.items ?? []).map((r: any) => (
                  <li key={r.id} className="rounded border border-[var(--border)] px-2 py-1 text-xs">
                    <span className="font-semibold">{r.score} ★</span> {r.comment || "—"}
                  </li>
                ))}
              </ul>
            </div>

            <Button
              type="primary"
              block
              disabled={selectedPackage?.installed}
              loading={install.isPending}
              icon={selectedPackage?.installed ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              onClick={() => install.mutate(selected)}
            >
              {selectedPackage?.installed ? t("page.marketplace.installed") : t("page.marketplace.install")}
            </Button>
          </div>
        ) : null}
      </Drawer>
    </WorkbenchShell>
  );
}
