import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, Drawer, Form, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircle2, Download, Star, Trash2 } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

const EChartsDonutLazy = lazy(() =>
  import("@/components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })),
);

function pieToRecord(items?: Array<{ name: string; value: number }>) {
  const out: Record<string, number> = {};
  for (const row of items ?? []) out[row.name] = row.value;
  return out;
}
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type MarketModule = "catalog" | "installed" | "ratings";

const types = ["", "spec", "skill", "template", "rule-pack"];

function signatureColor(status: string) {
  if (status === "signed" || status === "builtin") return "success";
  if (status === "unsigned") return "warning";
  return "default";
}

type MarketplaceProps = {
  initialModule?: MarketModule;
};

export function Marketplace({ initialModule = "catalog" }: MarketplaceProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("rating");
  const [module, setModule] = useState<MarketModule>(initialModule);
  const [selected, setSelected] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signatureFilter, setSignatureFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
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
    enabled: Boolean(selected) && (drawerOpen || module === "ratings"),
  });
  const ratings = useQuery({
    queryKey: ["marketplaceRatings", selected],
    queryFn: () => api.marketplaceRatings(selected, 30),
    enabled: Boolean(selected) && (drawerOpen || module === "ratings"),
  });

  useEffect(() => {
    setModule(initialModule);
  }, [initialModule]);

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
  const installedItems = installed.data ?? [];
  const selectedPackage = useMemo(
    () => items.find((x: any) => x.name === selected) ?? installedItems.find((x: any) => x.name === selected),
    [installedItems, items, selected],
  );
  const ratingRows = useMemo(() => {
    return items
      .filter((row: any) => !signatureFilter || row.signature_status === signatureFilter)
      .filter((row: any) => {
        const avg = Number(row.rating?.avg ?? 0);
        if (ratingFilter === "unrated") return Number(row.rating?.count ?? 0) === 0;
        if (ratingFilter === "low") return avg > 0 && avg < 4;
        if (ratingFilter === "high") return avg >= 4;
        return true;
      })
      .sort((a: any, b: any) => Number(b.rating?.avg ?? 0) - Number(a.rating?.avg ?? 0));
  }, [items, ratingFilter, signatureFilter]);

  useEffect(() => {
    if (module === "ratings" && !selected && ratingRows[0]?.name) setSelected(ratingRows[0].name);
  }, [module, ratingRows, selected]);

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
    {
      title: t("page.marketplace.asset"),
      dataIndex: "name",
      ellipsis: true,
      render: (name: string, row) => (
        <button type="button" className="text-left" onClick={() => openDetail(name)}>
          <p className="font-semibold text-[var(--text)]">{name}</p>
          <p className="text-xs text-[var(--muted)]">v{row.version} · {row.registry || row.type}</p>
        </button>
      ),
    },
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
          <Button type={module === "ratings" ? "primary" : "default"} onClick={() => setModule("ratings")}>
            {t("page.marketplace.module.ratings")}
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
        title={
          module === "catalog"
            ? t("page.marketplace.catalog")
            : module === "installed"
              ? t("page.marketplace.installedAssets")
              : t("page.marketplace.ratingSignature")
        }
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
        ) : module === "installed" ? (
          <Table
            rowKey={(r) => `${r.name}-${r.version}`}
            loading={installed.isLoading}
            columns={installedCols}
            dataSource={installedItems}
            pagination={{ pageSize: 12 }}
          />
        ) : (
          <RatingSignatureWorkbench
            t={t}
            items={ratingRows}
            loading={list.isLoading}
            selected={selected}
            selectedPackage={selectedPackage}
            verifyData={verify.data}
            ratingsData={ratings.data}
            signatureFilter={signatureFilter}
            ratingFilter={ratingFilter}
            onSignatureFilter={setSignatureFilter}
            onRatingFilter={setRatingFilter}
            onSelect={setSelected}
            onInstall={(name) => install.mutate(name)}
            installPending={install.isPending}
            rateForm={rateForm}
            onRate={(value) => rate.mutate(value)}
            ratePending={rate.isPending}
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

function RatingSignatureWorkbench({
  t,
  items,
  loading,
  selected,
  selectedPackage,
  verifyData,
  ratingsData,
  signatureFilter,
  ratingFilter,
  onSignatureFilter,
  onRatingFilter,
  onSelect,
  onInstall,
  installPending,
  rateForm,
  onRate,
  ratePending,
}: {
  t: (key: string) => string;
  items: any[];
  loading: boolean;
  selected: string;
  selectedPackage?: any;
  verifyData?: any;
  ratingsData?: any;
  signatureFilter: string;
  ratingFilter: string;
  onSignatureFilter: (value: string) => void;
  onRatingFilter: (value: string) => void;
  onSelect: (name: string) => void;
  onInstall: (name: string) => void;
  installPending: boolean;
  rateForm: ReturnType<typeof Form.useForm<{ score: number; comment: string }>>[0];
  onRate: (value: { score: number; comment: string }) => void;
  ratePending: boolean;
}) {
  const columns: ColumnsType<any> = [
    {
      title: t("page.marketplace.asset"),
      dataIndex: "name",
      render: (name: string, row) => (
        <button type="button" className="text-left" onClick={() => onSelect(name)}>
          <p className="font-semibold text-[var(--text)]">{name}</p>
          <p className="text-xs text-[var(--muted)]">v{row.version} · {row.type}</p>
        </button>
      ),
    },
    {
      title: t("page.marketplace.signature"),
      dataIndex: "signature_status",
      width: 120,
      render: (value: string) => <Tag color={signatureColor(value)}>{value || "unknown"}</Tag>,
    },
    {
      title: t("page.marketplace.rating"),
      width: 120,
      render: (_: unknown, row: any) => `${row.rating?.avg ?? 0} / ${row.rating?.count ?? 0}`,
    },
    {
      title: t("page.marketplace.action"),
      width: 110,
      render: (_: unknown, row: any) => (
        <Button size="small" type={selected === row.name ? "primary" : "default"} onClick={() => onSelect(row.name)}>
          {t("page.marketplace.review")}
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Select
            className="min-w-[10rem]"
            value={signatureFilter || undefined}
            allowClear
            placeholder={t("page.marketplace.signatureAll")}
            onChange={(value) => onSignatureFilter(value || "")}
            options={["signed", "builtin", "unsigned", "unknown"].map((value) => ({ value, label: value }))}
          />
          <Select
            className="min-w-[10rem]"
            value={ratingFilter}
            onChange={onRatingFilter}
            options={[
              { value: "all", label: t("page.marketplace.ratingAll") },
              { value: "high", label: t("page.marketplace.ratingHigh") },
              { value: "low", label: t("page.marketplace.ratingLow") },
              { value: "unrated", label: t("page.marketplace.ratingEmpty") },
            ]}
          />
        </div>
        <Table rowKey={(row) => `${row.name}-${row.version}`} loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
      </div>

      <div className="space-y-4">
        <WorkbenchPanel title={t("page.marketplace.signatureVerify")}>
          {selected ? (
            <div className="space-y-3">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label={t("page.marketplace.asset")}>{selected}</Descriptions.Item>
                <Descriptions.Item label={t("page.marketplace.version")}>
                  {verifyData?.version ?? selectedPackage?.version ?? "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("page.marketplace.signature")}>
                  <Tag color={signatureColor(verifyData?.signature_status ?? selectedPackage?.signature_status)}>
                    {verifyData?.signature_status ?? selectedPackage?.signature_status ?? "unknown"}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t("page.marketplace.registry")}>
                  {verifyData?.registry ?? selectedPackage?.registry ?? "-"}
                </Descriptions.Item>
              </Descriptions>
              {verifyData?.signature ? (
                <pre className="max-h-44 overflow-auto rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs">
                  {JSON.stringify(verifyData.signature, null, 2)}
                </pre>
              ) : null}
              <Button
                type="primary"
                block
                disabled={selectedPackage?.installed}
                loading={installPending}
                icon={selectedPackage?.installed ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                onClick={() => onInstall(selected)}
              >
                {selectedPackage?.installed ? t("page.marketplace.installed") : t("page.marketplace.install")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t("page.marketplace.selectAsset")}</p>
          )}
        </WorkbenchPanel>

        <WorkbenchPanel title={t("page.marketplace.rate")}>
          {selected ? (
            <>
              <Form form={rateForm} layout="vertical" initialValues={{ score: 5, comment: "" }} onFinish={onRate}>
                <Form.Item name="score" label={t("page.marketplace.score")}>
                  <Select options={[5, 4, 3, 2, 1].map((n) => ({ value: n, label: String(n) }))} />
                </Form.Item>
                <Form.Item name="comment" label={t("page.marketplace.comment")}>
                  <Input.TextArea rows={3} placeholder={t("page.marketplace.commentPh")} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={ratePending} icon={<Star className="h-4 w-4" />}>
                  {t("page.marketplace.submitRating")}
                </Button>
              </Form>
              <ul className="mt-3 space-y-2">
                {(ratingsData?.items ?? []).map((row: any) => (
                  <li key={row.id} className="rounded border border-[var(--border)] px-2 py-1 text-xs">
                    <span className="font-semibold">{row.score} ★</span> {row.comment || "-"}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t("page.marketplace.selectAsset")}</p>
          )}
        </WorkbenchPanel>
      </div>
    </div>
  );
}
