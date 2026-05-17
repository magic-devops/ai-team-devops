import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRightOutlined, RobotOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, List, Progress, Space, Table, Tag } from "antd";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { ErrorBlock, LoadingBlock, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { WorkbenchShell } from "./shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "./shared/workbenchUi";
const EChartsDonutLazy = lazy(() => import("../components/charts/EChartsDonut").then((m) => ({ default: m.EChartsDonut })));
const EChartsBarLazy = lazy(() => import("../components/charts/EChartsBar").then((m) => ({ default: m.EChartsBar })));
function pieToRecord(items) {
    const out = {};
    for (const row of items ?? [])
        out[row.name] = row.value;
    return out;
}
const quickLinks = [
    { href: "#/dev-flow/workbench", nav: "devFlow", desc: "dashboard.linkDevFlow" },
    { href: "#/projects", nav: "projects", desc: "dashboard.linkProjects" },
    { href: "#/requirements", nav: "requirements", desc: "dashboard.linkReqs" },
    { href: "#/tasks", nav: "tasks", desc: "dashboard.linkTasks" },
    { href: "#/search", nav: "globalSearch", desc: "dashboard.linkSearch" },
    { href: "#/workflows", nav: "workflows", desc: "dashboard.linkWorkflows" },
    { href: "#/copilot", nav: "copilot", desc: "dashboard.linkCopilot" },
    { href: "#/intelligence", nav: "intelligence", desc: "dashboard.linkIntel" },
    { href: "#/platforms", nav: "platforms", desc: "dashboard.linkPlatforms" },
    { href: "#/analytics", nav: "analytics", desc: "dashboard.linkAnalytics" },
];
export function Dashboard() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [selectedGaps, setSelectedGaps] = useState([]);
    const summary = useQuery({ queryKey: ["dashboardSummary"], queryFn: api.dashboardSummary });
    const charts = useQuery({ queryKey: ["dashboardCharts"], queryFn: api.dashboardCharts });
    const blueprint = useQuery({ queryKey: ["hermesBlueprint"], queryFn: api.hermesBlueprint });
    const health = useQuery({ queryKey: ["health"], queryFn: api.health });
    const activitySeries = useMemo(() => {
        const trend = charts.data?.activity_trend;
        if (!trend?.days?.length)
            return null;
        return {
            categories: trend.days,
            series: (trend.series ?? []).map((s) => ({
                name: s.name === "tasks" ? t("nav.tasks") : t("nav.requirements"),
                data: s.data,
            })),
        };
    }, [charts.data, t]);
    const data = summary.data ?? {};
    const metrics = data.metrics ?? {};
    const riskColumns = [
        {
            title: t("dashboard.risk"),
            dataIndex: "title",
            render: (_value, row) => (_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Tag, { color: row.level === "high" ? "red" : row.level === "medium" ? "gold" : "blue", children: row.level }), _jsx("span", { className: "font-medium text-[var(--text)]", children: row.title })] }), _jsx("p", { className: "mt-1 text-xs text-[var(--muted)]", children: row.description })] })),
        },
        {
            title: t("dashboard.action"),
            dataIndex: "target",
            width: 140,
            render: (target) => _jsx(Button, { size: "small", href: target, icon: _jsx(ArrowRightOutlined, {}), children: t("dashboard.open") }),
        },
    ];
    const openAi = () => {
        sessionStorage.setItem("sop-copilot-prefill", t("dashboard.aiPrompt", {
            projects: metrics.projects ?? 0,
            requirements: metrics.requirements ?? 0,
            tasks: metrics.tasks ?? 0,
            blocked: metrics.blocked_tasks ?? 0,
            delivery: metrics.delivery_rate ?? 0,
        }));
        window.location.hash = "#/copilot";
    };
    const blueprintTasks = useMutation({
        mutationFn: (dryRun) => api.hermesBlueprintTasks({
            ids: selectedGaps,
            dry_run: dryRun,
            priority: "P1",
            assigned_to: "Platform Agent",
            dev_tool: "codex",
        }),
        onSuccess: (result) => {
            if (!result?.dry_run) {
                setSelectedGaps([]);
                void qc.invalidateQueries({ queryKey: ["tasks"] });
                void qc.invalidateQueries({ queryKey: ["tasksSummary"] });
            }
        },
    });
    if (summary.isLoading)
        return _jsx(LoadingBlock, {});
    if (summary.isError)
        return _jsx(ErrorBlock, { message: summary.error.message });
    return (_jsxs("div", { className: "w-full space-y-5", children: [_jsxs(WorkbenchShell, { title: t("dashboard.operatingTitle"), description: t("dashboard.operatingDesc"), actions: _jsxs(Space, { wrap: true, children: [_jsx(RefreshButton, { onClick: () => {
                                void summary.refetch();
                                void charts.refetch();
                            }, pending: summary.isFetching || charts.isFetching }), _jsx(Button, { icon: _jsx(RobotOutlined, {}), onClick: openAi, children: t("dashboard.askAi") }), _jsx(Button, { type: "primary", href: "#/projects", icon: _jsx(ArrowRightOutlined, {}), children: t("dashboard.enterWorkspace") })] }), metrics: _jsx(WorkbenchStats, { items: [
                        { label: t("nav.projects"), value: metrics.projects ?? 0, hint: `${t("dashboard.active")}: ${metrics.active_projects ?? 0}` },
                        { label: t("nav.requirements"), value: metrics.requirements ?? 0 },
                        { label: t("nav.tasks"), value: metrics.tasks ?? 0, hint: `${t("dashboard.blocked")}: ${metrics.blocked_tasks ?? 0}` },
                        { label: t("dashboard.deliveryRate"), value: `${metrics.delivery_rate ?? 0}%` },
                        { label: t("dashboard.risks"), value: (data.risks ?? []).length },
                        { label: "Manager", value: health.data?.ok ? "OK" : "—" },
                    ] }), children: [_jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]", children: [_jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between gap-3", children: [_jsx("span", { className: "text-sm font-semibold text-[var(--text)]", children: t("dashboard.deliveryHealth") }), _jsxs(Tag, { color: (metrics.delivery_rate ?? 0) >= 80 ? "green" : (metrics.delivery_rate ?? 0) >= 50 ? "gold" : "red", children: [metrics.delivery_rate ?? 0, "%"] })] }), _jsx(Progress, { percent: Number(metrics.delivery_rate ?? 0) })] }), _jsx(Alert, { type: (data.risks ?? []).some((r) => r.level === "high") ? "error" : (data.risks ?? []).length ? "warning" : "success", showIcon: true, message: t("dashboard.operatingSignal"), description: (data.risks ?? []).length ? t("dashboard.riskSignal") : t("dashboard.okSignal") })] }), activitySeries ? (_jsx(WorkbenchPanel, { title: t("dashboard.activityTrend"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsBarLazy, { categories: activitySeries.categories, series: activitySeries.series, asLine: true, height: 260 }) }) })) : null, _jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-3", children: [Object.keys(pieToRecord(charts.data?.task_status)).length ? (_jsx(WorkbenchPanel, { title: t("dashboard.taskStatusChart"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(charts.data?.task_status), height: 220 }) }) })) : null, Object.keys(pieToRecord(charts.data?.requirement_status)).length ? (_jsx(WorkbenchPanel, { title: t("dashboard.reqStatusChart"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(charts.data?.requirement_status), height: 220 }) }) })) : null, Object.keys(pieToRecord(charts.data?.risk_levels)).length ? (_jsx(WorkbenchPanel, { title: t("dashboard.riskLevels"), children: _jsx(Suspense, { fallback: null, children: _jsx(EChartsDonutLazy, { data: pieToRecord(charts.data?.risk_levels), height: 220 }) }) })) : null] })] }), _jsxs(Card, { title: t("dashboard.hermesTitle"), actions: _jsxs(Space, { wrap: true, children: [_jsx(Button, { disabled: !selectedGaps.length, loading: blueprintTasks.isPending, onClick: () => blueprintTasks.mutate(true), children: t("dashboard.previewGapTasks") }), _jsx(Button, { type: "primary", disabled: !selectedGaps.length, loading: blueprintTasks.isPending, onClick: () => blueprintTasks.mutate(false), children: t("dashboard.createGapTasks") })] }), children: [blueprint.isLoading ? _jsx(LoadingBlock, {}) : null, blueprint.isError ? _jsx(ErrorBlock, { message: blueprint.error.message }) : null, blueprintTasks.data && !blueprintTasks.data.dry_run ? (_jsx(Alert, { className: "mb-3", type: "success", showIcon: true, message: t("dashboard.gapTasksCreated", { count: blueprintTasks.data.created ?? 0 }) })) : null, blueprintTasks.data?.dry_run ? (_jsx(Alert, { className: "mb-3", type: "info", showIcon: true, message: t("dashboard.gapTasksPreview", { count: blueprintTasks.data.items?.length ?? 0 }) })) : null, _jsxs("div", { className: "grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]", children: [_jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4", children: [_jsx("p", { className: "text-sm font-semibold text-[var(--text)]", children: blueprint.data?.architecture?.name ?? "Hermes" }), _jsx("p", { className: "mt-2 text-sm leading-relaxed text-[var(--muted-strong)]", children: blueprint.data?.architecture?.positioning }), _jsxs("div", { className: "mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1", children: [_jsx(Info, { label: t("dashboard.scopeTenant"), value: blueprint.data?.scope?.tenant_code ?? "-" }), _jsx(Info, { label: t("dashboard.scopeBusiness"), value: blueprint.data?.scope?.business_code ?? "-" }), _jsx(Info, { label: t("dashboard.scopeProject"), value: blueprint.data?.scope?.project_id ?? "-" }), _jsx(Info, { label: t("dashboard.platformMaturity"), value: `${blueprint.data?.summary?.maturity ?? 0}%` })] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "grid gap-2 md:grid-cols-3", children: (blueprint.data?.architecture?.layers ?? []).slice(0, 6).map((layer) => (_jsx("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted-strong)]", children: layer }, layer))) }), _jsxs("div", { className: "grid gap-3 xl:grid-cols-2", children: [_jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3", children: [_jsx("p", { className: "mb-2 text-sm font-semibold text-[var(--text)]", children: t("dashboard.productNavigation") }), _jsx(Table, { rowKey: "id", size: "small", dataSource: blueprint.data?.product_navigation ?? [], pagination: false, scroll: { x: 760 }, columns: [
                                                            { title: t("dashboard.domain"), dataIndex: "name", width: 130, render: (value) => _jsx(Tag, { color: "cyan", children: value }) },
                                                            {
                                                                title: t("dashboard.modules"),
                                                                dataIndex: "modules",
                                                                width: 260,
                                                                render: (items) => _jsx(Space, { size: [4, 4], wrap: true, children: (items ?? []).map((item) => _jsx(Tag, { children: item }, item)) }),
                                                            },
                                                            { title: t("dashboard.permission"), dataIndex: "permission", width: 130, render: (value) => _jsx("span", { className: "font-mono text-xs", children: value }) },
                                                            { title: t("dashboard.goal"), dataIndex: "goal" },
                                                        ] })] }), _jsxs("div", { className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3", children: [_jsx("p", { className: "mb-2 text-sm font-semibold text-[var(--text)]", children: t("dashboard.technologyUpgrade") }), _jsx(Table, { rowKey: "id", size: "small", dataSource: blueprint.data?.technology_upgrades ?? [], pagination: { pageSize: 4, showSizeChanger: false }, scroll: { x: 820 }, columns: [
                                                            {
                                                                title: t("dashboard.capability"),
                                                                dataIndex: "name",
                                                                width: 180,
                                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: value }), _jsx(Tag, { className: "mt-1", color: row.phase === "P0" ? "red" : row.phase === "P1" ? "gold" : "blue", children: row.phase })] })),
                                                            },
                                                            {
                                                                title: t("dashboard.targetStack"),
                                                                dataIndex: "target_stack",
                                                                width: 260,
                                                                render: (items) => _jsx(Space, { size: [4, 4], wrap: true, children: (items ?? []).slice(0, 4).map((item) => _jsx(Tag, { color: "blue", children: item }, item)) }),
                                                            },
                                                            { title: t("dashboard.strategy"), dataIndex: "strategy" },
                                                        ] })] })] }), _jsx(Table, { rowKey: "id", size: "small", dataSource: blueprint.data?.capabilities ?? [], pagination: { pageSize: 5, showSizeChanger: true }, scroll: { x: 920 }, columns: [
                                            {
                                                title: t("dashboard.capability"),
                                                dataIndex: "name",
                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: value }), _jsx("div", { className: "mt-1 text-xs text-[var(--muted)]", children: row.next })] })),
                                            },
                                            { title: t("dashboard.domain"), dataIndex: "domain", width: 120, render: (value) => _jsx(Tag, { children: value }) },
                                            {
                                                title: t("dashboard.maturity"),
                                                dataIndex: "maturity",
                                                width: 180,
                                                render: (value) => _jsx(Progress, { percent: value, size: "small" }),
                                            },
                                            {
                                                title: "AI",
                                                dataIndex: "ai_surfaces",
                                                width: 240,
                                                render: (items) => (_jsx(Space, { size: [4, 4], wrap: true, children: (items ?? []).slice(0, 3).map((item) => _jsx(Tag, { color: "blue", children: item }, item)) })),
                                            },
                                        ] }), _jsx(Table, { rowKey: "id", size: "small", dataSource: blueprint.data?.integrations ?? [], pagination: { pageSize: 5, showSizeChanger: true }, scroll: { x: 980 }, columns: [
                                            {
                                                title: t("dashboard.integration"),
                                                dataIndex: "name",
                                                render: (value, row) => (_jsxs("div", { children: [_jsx("div", { className: "font-medium text-[var(--text)]", children: value }), _jsx("div", { className: "mt-1 text-xs text-[var(--muted)]", children: row.next })] })),
                                            },
                                            { title: t("dashboard.category"), dataIndex: "category", width: 120, render: (value) => _jsx(Tag, { children: value }) },
                                            { title: t("dashboard.status"), dataIndex: "status", width: 120, render: (value) => _jsx(Tag, { color: value === "supported" ? "green" : value === "planned" ? "gold" : "blue", children: value }) },
                                            {
                                                title: t("dashboard.direction"),
                                                dataIndex: "direction",
                                                width: 170,
                                                render: (items) => _jsx(Space, { size: [4, 4], wrap: true, children: (items ?? []).map((item) => _jsx(Tag, { children: item }, item)) }),
                                            },
                                            {
                                                title: t("dashboard.events"),
                                                dataIndex: "events",
                                                width: 260,
                                                render: (items) => _jsx(Space, { size: [4, 4], wrap: true, children: (items ?? []).slice(0, 3).map((item) => _jsx(Tag, { color: "purple", children: item }, item)) }),
                                            },
                                        ] }), _jsx(Table, { rowKey: "id", size: "small", dataSource: blueprint.data?.gaps ?? [], pagination: false, scroll: { x: 820 }, rowSelection: {
                                            selectedRowKeys: selectedGaps,
                                            onChange: (keys) => setSelectedGaps(keys.map(String)),
                                        }, columns: [
                                            { title: t("dashboard.gap"), dataIndex: "title" },
                                            { title: t("dashboard.priority"), dataIndex: "priority", width: 90, render: (value) => _jsx(Tag, { color: value === "P0" ? "red" : "gold", children: value }) },
                                            { title: t("dashboard.recommendation"), dataIndex: "recommendation" },
                                        ] })] })] })] }), _jsxs("div", { className: "grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]", children: [_jsx(Card, { title: t("dashboard.riskBoard"), children: _jsx(Table, { rowKey: "id", columns: riskColumns, dataSource: data.risks ?? [], pagination: false, locale: { emptyText: t("dashboard.noRisks") }, size: "middle" }) }), _jsx(Card, { title: t("dashboard.nextActions"), children: _jsx(List, { dataSource: data.next_actions ?? [], renderItem: (item) => (_jsx(List.Item, { actions: [
                                    _jsx(Button, { size: "small", type: item.priority === "P0" ? "primary" : "default", href: item.target, children: t("dashboard.open") }, "open"),
                                ], children: _jsx(List.Item.Meta, { title: _jsx("span", { className: "text-sm text-[var(--text)]", children: item.title }), description: _jsx(Tag, { color: item.priority === "P0" ? "red" : item.priority === "P1" ? "gold" : "default", children: item.priority }) }) })) }) })] }), _jsx(Card, { title: t("dashboard.quickLinks"), children: _jsx("div", { className: "grid gap-2 sm:grid-cols-2 xl:grid-cols-4", children: quickLinks.map((link) => (_jsxs("a", { href: link.href, className: "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm transition hover:border-[var(--brand)] hover:bg-[var(--brand-softer)]", children: [_jsx("p", { className: "font-semibold text-[var(--text)]", children: t(`nav.${link.nav}`) }), _jsx("p", { className: "mt-1 text-xs text-[var(--muted)]", children: t(link.desc) })] }, link.href))) }) })] }));
}
function Info({ label, value }) {
    return (_jsxs("div", { className: "rounded-md bg-[var(--surface)] px-2 py-2", children: [_jsx("p", { className: "text-[11px] text-[var(--muted)]", children: label }), _jsx("p", { className: "mt-1 truncate font-mono text-xs text-[var(--text)]", children: value || "-" })] }));
}
