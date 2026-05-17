import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Descriptions, Drawer, Form, Input, Select, Table, Tag } from "antd";
import { CheckCircle2, Download, Star, Trash2 } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
const EChartsDonutLazy = lazy(() => import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })));
function pieToRecord(items) {
    const out = {};
    for (const row of items ?? [])
        out[row.name] = row.value;
    return out;
}
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "./shared/workbenchUi";
const types = ["", "spec", "skill", "template", "rule-pack"];
function signatureColor(status) {
    if (status === "signed" || status === "builtin")
        return "success";
    if (status === "unsigned")
        return "warning";
    return "default";
}
export function Marketplace() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const qc = useQueryClient();
    const [q, setQ] = useState("");
    const [type, setType] = useState("");
    const [sort, setSort] = useState("rating");
    const [module, setModule] = useState("catalog");
    const [selected, setSelected] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [rateForm] = Form.useForm();
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
        mutationFn: (name) => api.marketplaceInstall({ name, verify_signature: true }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["mp"] });
            void qc.invalidateQueries({ queryKey: ["marketplaceInstalled"] });
            void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
            message.success(t("page.marketplace.installedOk"));
        },
        onError: (e) => message.error(e.message),
    });
    const uninstall = useMutation({
        mutationFn: (name) => api.marketplaceUninstall(name),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ["mp"] });
            void qc.invalidateQueries({ queryKey: ["marketplaceInstalled"] });
            void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
            message.success(t("page.marketplace.uninstalled"));
        },
    });
    const rate = useMutation({
        mutationFn: (v) => api.marketplaceRate({ package: selected, score: v.score, comment: v.comment }),
        onSuccess: () => {
            rateForm.resetFields();
            void qc.invalidateQueries({ queryKey: ["mp"] });
            void qc.invalidateQueries({ queryKey: ["marketplaceRatings", selected] });
            void qc.invalidateQueries({ queryKey: ["marketplaceSummary"] });
            message.success(t("page.marketplace.ratingSubmitted"));
        },
    });
    const items = list.data?.items ?? [];
    const selectedPackage = useMemo(() => items.find((x) => x.name === selected), [items, selected]);
    const openDetail = (name) => {
        setSelected(name);
        setDrawerOpen(true);
    };
    const catalogCols = [
        {
            title: t("page.marketplace.asset"),
            dataIndex: "name",
            render: (name, row) => (_jsxs("button", { type: "button", className: "text-left", onClick: () => openDetail(name), children: [_jsx("p", { className: "font-semibold text-[var(--text)]", children: name }), _jsxs("p", { className: "text-xs text-[var(--muted)]", children: ["v", row.version, " \u00B7 ", row.type] })] })),
        },
        {
            title: t("page.marketplace.signature"),
            dataIndex: "signature_status",
            width: 110,
            render: (v) => _jsx(Tag, { color: signatureColor(v), children: v }),
        },
        {
            title: t("page.marketplace.rating"),
            width: 100,
            render: (_, row) => `⭐ ${row.rating?.avg ?? 0}`,
        },
        {
            title: t("page.marketplace.action"),
            width: 140,
            render: (_, row) => (_jsx(Button, { size: "small", disabled: row.installed || install.isPending, onClick: () => install.mutate(row.name), children: row.installed ? t("page.marketplace.installed") : t("page.marketplace.install") })),
        },
    ];
    const installedCols = [
        { title: t("page.marketplace.asset"), dataIndex: "name", ellipsis: true },
        { title: t("page.marketplace.type"), dataIndex: "type", width: 100 },
        {
            title: t("page.marketplace.signature"),
            dataIndex: "signature_status",
            width: 110,
            render: (v) => _jsx(Tag, { color: signatureColor(v), children: v }),
        },
        {
            title: t("page.marketplace.action"),
            width: 100,
            render: (_, row) => (_jsx(Button, { size: "small", danger: true, icon: _jsx(Trash2, { className: "h-3.5 w-3.5" }), loading: uninstall.isPending, onClick: () => uninstall.mutate(row.name) })),
        },
    ];
    return (_jsxs(WorkbenchShell, { title: t("page.marketplace.title"), description: t("page.marketplace.hint"), actions: _jsxs(_Fragment, { children: [_jsx(RefreshButton, { onClick: () => refresh.mutate(), pending: refresh.isPending }), _jsx(Button, { type: module === "catalog" ? "primary" : "default", onClick: () => setModule("catalog"), children: t("page.marketplace.module.catalog") }), _jsx(Button, { type: module === "installed" ? "primary" : "default", onClick: () => setModule("installed"), children: t("page.marketplace.module.installed") })] }), metrics: _jsx(WorkbenchStats, { items: [
                { label: t("page.marketplace.total"), value: summary.data?.packages ?? 0 },
                { label: t("page.marketplace.installed"), value: summary.data?.installed ?? 0 },
                { label: t("page.marketplace.avgRating"), value: summary.data?.avg_rating ?? "—" },
                { label: t("page.marketplace.signed"), value: summary.data?.signed_packages ?? 0 },
            ] }), children: [_jsxs("div", { className: "mb-4 grid gap-4 md:grid-cols-2", children: [Object.keys(pieToRecord(charts.data?.by_type)).length ? (_jsx(WorkbenchPanel, { title: t("page.marketplace.chartType"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(charts.data?.by_type), height: 200 }) }) })) : null, Object.keys(pieToRecord(charts.data?.by_signature)).length ? (_jsx(WorkbenchPanel, { title: t("page.marketplace.chartSignature"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(charts.data?.by_signature), height: 200 }) }) })) : null] }), _jsxs(WorkbenchPanel, { title: module === "catalog" ? t("page.marketplace.catalog") : t("page.marketplace.installedAssets"), children: [module === "catalog" ? (_jsxs("div", { className: "mb-4 flex flex-wrap gap-2", children: [_jsx(Input.Search, { allowClear: true, className: "min-w-[14rem] flex-1", placeholder: t("page.marketplace.searchPh"), value: q, onChange: (e) => setQ(e.target.value) }), _jsx(Select, { className: "min-w-[8rem]", value: type || undefined, allowClear: true, placeholder: t("page.marketplace.allTypes"), onChange: (v) => setType(v || ""), options: types.filter(Boolean).map((x) => ({ value: x, label: x })) }), _jsx(Select, { className: "min-w-[8rem]", value: sort, onChange: setSort, options: [
                                    { value: "rating", label: t("page.marketplace.sortRating") },
                                    { value: "name", label: t("page.marketplace.sortName") },
                                    { value: "newest", label: t("page.marketplace.sortNewest") },
                                ] })] })) : null, module === "catalog" ? (_jsx(Table, { rowKey: (r) => `${r.name}-${r.version}`, loading: list.isLoading, columns: catalogCols, dataSource: items, pagination: { pageSize: 12 } })) : (_jsx(Table, { rowKey: (r) => `${r.name}-${r.version}`, loading: installed.isLoading, columns: installedCols, dataSource: installed.data ?? [], pagination: { pageSize: 12 } }))] }), _jsx(Drawer, { title: selected || t("page.marketplace.detail"), open: drawerOpen, onClose: () => setDrawerOpen(false), width: 520, children: selectedPackage || verify.data ? (_jsxs("div", { className: "space-y-4", children: [_jsxs(Descriptions, { column: 1, bordered: true, size: "small", children: [_jsx(Descriptions.Item, { label: t("page.marketplace.version"), children: verify.data?.version ?? selectedPackage?.version }), _jsx(Descriptions.Item, { label: t("page.marketplace.signature"), children: _jsx(Tag, { color: signatureColor(verify.data?.signature_status ?? selectedPackage?.signature_status), children: verify.data?.signature_status ?? selectedPackage?.signature_status }) }), _jsx(Descriptions.Item, { label: t("page.marketplace.registry"), children: verify.data?.registry ?? selectedPackage?.registry }), _jsxs(Descriptions.Item, { label: t("page.marketplace.rating"), children: ["\u2B50 ", selectedPackage?.rating?.avg ?? 0, " (", selectedPackage?.rating?.count ?? 0, ")"] })] }), verify.data?.signature ? (_jsx("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs font-mono", children: JSON.stringify(verify.data.signature, null, 2) })) : null, _jsxs("div", { children: [_jsx("p", { className: "mb-2 text-xs font-semibold", children: t("page.marketplace.rate") }), _jsxs(Form, { form: rateForm, layout: "vertical", initialValues: { score: 5, comment: "" }, onFinish: (v) => rate.mutate(v), children: [_jsx(Form.Item, { name: "score", label: t("page.marketplace.score"), children: _jsx(Select, { options: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: String(n) })) }) }), _jsx(Form.Item, { name: "comment", label: t("page.marketplace.comment"), children: _jsx(Input.TextArea, { rows: 3, placeholder: t("page.marketplace.commentPh") }) }), _jsx(Button, { type: "primary", htmlType: "submit", loading: rate.isPending, icon: _jsx(Star, { className: "h-4 w-4" }), children: t("page.marketplace.submitRating") })] }), _jsx("ul", { className: "mt-3 space-y-2", children: (ratings.data?.items ?? []).map((r) => (_jsxs("li", { className: "rounded border border-[var(--border)] px-2 py-1 text-xs", children: [_jsxs("span", { className: "font-semibold", children: [r.score, " \u2605"] }), " ", r.comment || "—"] }, r.id))) })] }), _jsx(Button, { type: "primary", block: true, disabled: selectedPackage?.installed, loading: install.isPending, icon: selectedPackage?.installed ? _jsx(CheckCircle2, { className: "h-4 w-4" }) : _jsx(Download, { className: "h-4 w-4" }), onClick: () => install.mutate(selected), children: selectedPackage?.installed ? t("page.marketplace.installed") : t("page.marketplace.install") })] })) : null })] }));
}
