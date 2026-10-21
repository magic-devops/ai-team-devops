import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Select, Space, Table } from "antd";
import { useTranslation } from "react-i18next";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import { ProjectContextGate } from "@/components/ProjectContextGate";
import { ExternalWorkOrderPanel } from "@/components/ExternalWorkOrderPanel";
import { WorkOrderReportedProgress, WorkOrderStatusBadges, workOrderNextAction } from "@/components/ExternalWorkOrderPresentation";
import { externalWorkOrderCopy, externalWorkOrderReason } from "@/i18n/external-work-orders";
import { executionRuntimeProblem } from "@/lib/executionRuntime";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { externalWorkOrderHref, externalWorkOrderTaskHref, parseExternalWorkOrderRoute, type ExternalWorkOrderRoute } from "@/lib/externalWorkOrderRoute";
import { readWorkOrders, readWorkOrderTasks, workOrderStates, type WorkOrderSummary } from "@/lib/externalWorkOrders";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

const subscribe = (callback: () => void) => {
  for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(event, callback);
  return () => { for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(event, callback); };
};
const snapshot = () => JSON.stringify([location.hash, projectSessionKey()]);
export function A2aWorkbench(_props: { focused?: boolean; initialTab?: string } = {}) {
  return <ProjectContextGate requireSelection><ProjectWorkOrders /></ProjectContextGate>;
}
export function ProjectWorkOrders() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { i18n } = useTranslation(), copy = externalWorkOrderCopy(i18n.language);
  const route = parseExternalWorkOrderRoute(location.hash), projectId = getProjectId() || "", scope = projectSessionKey(), sessionId = getSessionRevision() || "";
  const exit = useExecutionExitGuard();
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [taskCursor, setTaskCursor] = useState("");
  const ready = Boolean(projectId && sessionId && !route.invalid && (!route.projectId || route.projectId === projectId));
  const status = route.view === "reports" ? "reported" : route.status;
  const orders = useQuery({ queryKey: ["delivery-work-orders-directory", projectId, sessionId, scope, status, route.cursor],
    queryFn: ({ signal }) => readWorkOrders(projectId, scope, { state: status, cursor: route.cursor }, signal), enabled: ready && !route.taskId && route.view !== "dispatch", retry: false, gcTime: 0 });
  const tasks = useQuery({ queryKey: ["delivery-work-order-task-picker", projectId, sessionId, scope, query, taskCursor],
    queryFn: ({ signal }) => readWorkOrderTasks(projectId, scope, query, taskCursor, signal), enabled: ready && route.view === "dispatch" && !route.taskId, retry: false, gcTime: 0 });
  const active = () => scope === projectSessionKey() && projectId === getProjectId();
  const go = (change: Partial<ExternalWorkOrderRoute>) => { if (!active() || !exit.canNavigate()) return; location.hash = externalWorkOrderHref({ ...route, projectId, ...change }); };
  const label = (value: string) => copy.states[value as keyof typeof copy.states] || copy.states.unknown;
  const errorText = (cause: unknown) => { const value = executionRuntimeProblem(cause); return value.message === "workOrderInvalid" ? copy.responseInvalid : value.message === "workOrderScopeChanged" ? copy.scopeChanged : value.code ? externalWorkOrderReason(i18n.language, value) : value.message || copy.readFailed; };
  const failure = (cause: unknown, refresh: () => unknown) => <Alert role="alert" type="warning" showIcon title={copy.readFailed} description={errorText(cause)} action={<Button onClick={() => { if (active()) void refresh(); }}>{copy.refresh}</Button>} />;
  const openOrder = (order: WorkOrderSummary) => go({ view: route.view === "reports" ? "reports" : "orders", taskId: order.task_id, workOrderId: order.id, cursor: "" });
  const nextAction = (order: WorkOrderSummary) => {
    const action = workOrderNextAction(order, i18n.language);
    return action.kind === "report" && order.submission
      ? <Button size="small" data-action="work-order-next" aria-label={`${action.label} · ${order.task_title}`} disabled={exit.pending} href={externalWorkOrderTaskHref(projectId, order.task_id, order.id, order.submission.id, location.hash)} onClick={(event) => { if (!active() || !exit.canNavigate()) event.preventDefault(); }}>{action.label}</Button>
      : <Button size="small" data-action="work-order-next" aria-label={`${action.label} · ${order.task_title}`} disabled={exit.pending} onClick={() => openOrder(order)}>{action.label}</Button>;
  };
  const rows = !orders.error && active() && orders.data?.project_id === projectId ? orders.data.items : [];
  if (!ready) return <Alert role="alert" type="warning" showIcon title={copy.scopeChanged} />;
  return <div className="w-full space-y-4">
    <WorkbenchShell title={copy.title} description={copy.description} actions={<Space wrap>{route.returnTo && <Button disabled={exit.pending} href={route.returnTo} onClick={(event) => { if (!active() || !exit.canNavigate()) event.preventDefault(); }}>{copy.backToPortfolio}</Button>}<Button disabled={exit.pending} href={`#/ai/agent-ops/runs?project_id=${encodeURIComponent(projectId)}`} onClick={(event) => { if (!active() || !exit.canNavigate()) event.preventDefault(); }}>{copy.agentOps}</Button><Button type="primary" disabled={exit.pending} onClick={() => go({ view: "dispatch", taskId: "", workOrderId: "", cursor: "", status: "" })}>{copy.create}</Button></Space>} />
    <Space wrap>
      <Button type={route.view === "orders" ? "primary" : "default"} disabled={exit.pending} onClick={() => go({ view: "orders", taskId: "", workOrderId: "", cursor: "", status: "" })}>{copy.history}</Button>
      <Button type={route.view === "dispatch" ? "primary" : "default"} disabled={exit.pending} onClick={() => go({ view: "dispatch", taskId: route.taskId, workOrderId: "", cursor: "", status: "" })}>{copy.create}</Button>
      <Button type={route.view === "reports" ? "primary" : "default"} disabled={exit.pending} onClick={() => go({ view: "reports", taskId: "", workOrderId: "", cursor: "", status: "" })}>{copy.openReport}</Button>
    </Space>
    {(exit.pending || exit.blocked) && <Alert role="status" type="warning" showIcon title={copy.pendingNavigation} />}
    {route.taskId ? <>
      <Button disabled={exit.pending} onClick={() => go({ taskId: "", workOrderId: "", cursor: "" })}>{copy.back}</Button>
      <ExternalWorkOrderPanel key={`${projectId}:${sessionId}:${scope}:${route.taskId}`} projectId={projectId} taskId={route.taskId} sessionId={sessionId} selectedOrderId={route.workOrderId} compose={route.view === "dispatch"}
        isActive={active} onSelect={(workOrderId) => go({ view: "orders", workOrderId })}
        onEditingChange={(value) => exit.setPending(`work-order-draft:${route.taskId}`, value)} onUnresolvedChange={(value) => exit.setPending(`work-order:${route.taskId}`, value)} />
    </> : route.view === "dispatch" ? <WorkbenchPanel title={copy.chooseTask}>
      <div className="space-y-3"><Input.Search aria-label={copy.taskSearch} placeholder={copy.taskSearch} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} onSearch={(value) => { if (active()) { setQuery(value); setTaskCursor(""); } }} enterButton />
        {tasks.error ? failure(tasks.error, tasks.refetch) : tasks.isPending ? <p role="status">{copy.loading}</p> : <ul className="divide-y divide-[var(--border)]">{tasks.data?.items.map((task) => <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><strong className="text-sm">{task.title}</strong><p className="text-xs text-[var(--muted)]">{task.id}</p></div><Button size="small" onClick={() => go({ taskId: task.id, workOrderId: "" })}>{copy.create}</Button></li>)}</ul>}
        {tasks.data && !tasks.error && !tasks.data.items.length && <Empty description={copy.noTask} />}
        <Space wrap>{taskCursor && <Button onClick={() => setTaskCursor("")}>{copy.first}</Button>}{tasks.data?.next_cursor && !tasks.error && <Button disabled={tasks.isFetching} onClick={() => setTaskCursor(tasks.data!.next_cursor!)}>{copy.next}</Button>}</Space>
      </div>
    </WorkbenchPanel> : <WorkbenchPanel title={route.view === "reports" ? copy.openReport : copy.history} actions={<Space wrap>{route.view !== "reports" && <Select aria-label={copy.status} value={route.status} className="min-w-48" options={[{ value: "", label: copy.all }, ...workOrderStates.map((state) => ({ value: state, label: label(state) }))]} onChange={(status) => go({ status, cursor: "" })} />}<Button loading={orders.isFetching} onClick={() => { if (active()) void orders.refetch(); }}>{copy.refresh}</Button></Space>}>
      {orders.error ? <div className="space-y-2">{failure(orders.error, orders.refetch)}{route.cursor && <Button onClick={() => go({ cursor: "" })}>{copy.first}</Button>}</div> : <>
        <p className="mb-3 text-xs text-[var(--muted)]">{copy.directoryHint}</p>
        <Table<WorkOrderSummary> className="hidden md:block" rowKey="id" size="small" dataSource={rows} loading={orders.isFetching} pagination={false} scroll={{ x: 1040 }} columns={[
          { title: copy.task, key: "task", render: (_value, order) => <Button type="link" size="small" onClick={() => openOrder(order)}>{order.task_title}</Button> },
          { title: copy.member, key: "executor", render: (_value, order) => <span>{order.executor.name}<small className="block text-[var(--muted)]">{order.executor.tool}</small></span> },
          { title: copy.status, key: "state", width: 220, render: (_value, order) => <WorkOrderStatusBadges order={order} /> },
          { title: copy.claimedBy, key: "claimant", render: (_value, order) => order.claimed_by?.name || "—" },
          { title: copy.progress, key: "progress", width: 240, render: (_value, order) => <WorkOrderReportedProgress order={order} /> },
          { title: copy.nextAction, key: "actions", render: (_value, order) => nextAction(order) },
        ]} locale={{ emptyText: copy.empty }} />
        <div className="space-y-2 md:hidden">{rows.map((order) => <article key={order.id} className="space-y-3 rounded-lg border border-[var(--border)] p-3"><div><Button type="link" size="small" className="!h-auto !whitespace-normal !px-0 text-left" onClick={() => openOrder(order)}>{order.task_title}</Button><div className="mt-1"><WorkOrderStatusBadges order={order} /></div></div><p className="text-sm">{order.executor.name}<small className="block text-[var(--muted)]">{copy.claimedBy}: {order.claimed_by?.name || "—"}</small></p><WorkOrderReportedProgress order={order} />{nextAction(order)}</article>)}{!rows.length && !orders.isFetching && <Empty description={copy.empty}><p>{copy.emptyHint}</p></Empty>}</div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span>{orders.data ? `${copy.history} · ${orders.data.total}` : copy.loading}</span><Space wrap>{route.cursor && <Button onClick={() => go({ cursor: "" })}>{copy.first}</Button>}{orders.data?.next_cursor && <Button disabled={orders.isFetching} onClick={() => go({ cursor: orders.data!.next_cursor! })}>{copy.next}</Button>}</Space></div>
      </>}
    </WorkbenchPanel>}
  </div>;
}
