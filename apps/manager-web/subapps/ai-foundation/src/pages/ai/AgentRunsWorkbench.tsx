import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Drawer, Empty, Segmented, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { getProjectId, getSessionRevision, getTenantCode, getToken } from "@/lib/authStorage";
import { NeedLogin, LoadingBlock, RefreshButton, SearchInput } from "@/components/PageStates";
import { ProjectContextGate, ProjectScopeNotice } from "@/components/ProjectContextGate";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  agentRunsTabs, agentRunStatuses, agentActiveStatuses, agentRunsHash, parseAgentRunsRoute, changeAgentRunsRoute,
  canonicalExecutionHref, canonicalMemberHref, canonicalTaskHref, filterAgentRuns,
  readAgentContext, readAgentRuns, readAgentBindings, readAgentRuntime, agentAccessFailure,
  type AgentRunsTab, type AgentRunsRoute, type CanonicalAgentExecution,
} from "@/lib/canonicalAgentRuns";
import { canonicalAgentRunsCopy } from "@/i18n/canonical-agent-runs";

const subscribe = (callback: () => void) => {
  for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(event, callback);
  return () => { for (const event of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(event, callback); };
};
const snapshot = () => JSON.stringify([window.location.hash, projectSessionKey()]);
function statusColor(status: string) {
  if (status === "accepted" || status === "current") return "green";
  if (["failed", "changes_requested"].includes(status)) return "red";
  if (["running", "retrying"].includes(status)) return "blue";
  if (["interrupted", "awaiting_review", "stale", "unknown"].includes(status)) return "gold";
  return undefined;
}

export function AgentRunsWorkbench({ focused = false, initialTab = "runs" }: { focused?: boolean; initialTab?: AgentRunsTab }) {
  return <ProjectContextGate requireSelection><ProjectAgentRuns focused={focused} initialTab={initialTab} /></ProjectContextGate>;
}

function ProjectAgentRuns({ focused, initialTab }: { focused: boolean; initialTab: AgentRunsTab }) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { i18n } = useTranslation();
  const copy = canonicalAgentRunsCopy(i18n.language);
  const projectId = getProjectId() || "";
  const revision = getSessionRevision() || "";
  const tenant = getTenantCode() || "";
  const scope = projectSessionKey();
  const route = parseAgentRunsRoute(window.location.hash, initialTab);
  const isProfiles = route.tab === "profiles";
  const background = agentRunsHash({ ...route, projectId });
  const enabled = Boolean(getToken() && projectId && revision);
  const contextQ = useQuery({
    queryKey: ["delivery-agent-context", projectId, revision, tenant],
    queryFn: ({ signal }) => readAgentContext(projectId, scope, signal),
    enabled, retry: false, gcTime: 0,
  });
  const context = !contextQ.error && contextQ.data?.project_id === projectId ? contextQ.data : undefined;
  const ready = enabled && context?.query_state.status === "ready";
  const runsQ = useQuery({
    queryKey: ["delivery-agent-executions", projectId, revision, tenant, context?.query_generation, route.cursor],
    queryFn: ({ signal }) => readAgentRuns(projectId, scope, context!, route.cursor, signal),
    enabled: ready && !isProfiles, retry: false, gcTime: 0,
  });
  const bindingsQ = useQuery({
    queryKey: ["delivery-agent-bindings", projectId, revision, tenant],
    queryFn: ({ signal }) => readAgentBindings(projectId, scope, signal),
    enabled: ready && isProfiles, retry: false, gcTime: 0,
  });
  const runtimeQ = useQuery({
    queryKey: ["delivery-agent-runtime", projectId, revision, tenant, route.inspect],
    queryFn: ({ signal }) => readAgentRuntime(projectId, scope, route.inspect, signal),
    enabled: ready && !isProfiles && Boolean(route.inspect), retry: false, gcTime: 0,
  });
  const go = (patch: Partial<AgentRunsRoute>) => {
    if (scope !== projectSessionKey() || projectId !== getProjectId()) return;
    window.location.hash = agentRunsHash(changeAgentRunsRoute({ ...route, projectId }, patch));
  };
  const refresh = () => {
    if (scope !== projectSessionKey()) return;
    void contextQ.refetch();
    if (isProfiles) void bindingsQ.refetch();
    else { void runsQ.refetch(); if (route.inspect) void runtimeQ.refetch(); }
  };
  const errorText = (error: unknown) => error instanceof Error && !["agentResponseInvalid", "scopeChanged"].includes(error.message) ? error.message : error instanceof Error && error.message === "scopeChanged" ? copy.scopeChanged : copy.unavailable;
  const readFailure = (error: unknown, title: string, retryLabel: string, retry: () => unknown) => <Alert showIcon type="warning" title={title} description={errorText(error)} action={<Button aria-label={retryLabel} onClick={() => { if (scope === projectSessionKey()) void retry(); }}>{copy.refresh}</Button>} />;
  const relevantErrors = [contextQ.error, ...(isProfiles ? [bindingsQ.error] : [runsQ.error, ...(route.inspect ? [runtimeQ.error] : [])])];
  const accessError = relevantErrors.find(agentAccessFailure);
  if (!getToken()) return <NeedLogin />;
  if (!projectId || !revision) return <ProjectScopeNotice />;
  if (accessError) return <ProjectScopeNotice message={errorText(accessError)} onRetry={refresh} />;
  if (contextQ.error) return readFailure(contextQ.error, copy.contextError, copy.retryContext, contextQ.refetch);
  if (!context) return <LoadingBlock label={copy.loading} />;
  if (!ready) return <Alert type="warning" showIcon title={copy.rebuild} action={<Button href={`#/dev-flow?view=overview&project_id=${encodeURIComponent(projectId)}`}>{copy.openProject}</Button>} />;

  const page = !runsQ.error && runsQ.data?.project_id === projectId && runsQ.data.query_generation === context.query_generation && !isProfiles ? runsQ.data : undefined;
  const catalogue = !bindingsQ.error && bindingsQ.data?.project_id === projectId && isProfiles ? bindingsQ.data : undefined;
  const runtime = !runtimeQ.error && runtimeQ.data?.project_id === projectId && runtimeQ.data.execution_id === route.inspect && !isProfiles ? runtimeQ.data : undefined;
  const rows = page ? filterAgentRuns(page.items, route) : [];
  const label = (status: string) => copy.states[status as keyof typeof copy.states] || copy.unknown;
  const tag = (status: string) => <Tag color={statusColor(status)} title={status}>{label(status)}</Tag>;
  const entryActions = (entry: CanonicalAgentExecution) => <Space size={[4, 8]} wrap>
    <Button type="link" size="small" href={canonicalExecutionHref(projectId, entry, background)}>{copy.execution}</Button>
    <Button type="link" size="small" href={canonicalTaskHref(projectId, entry.task_id, background)}>{copy.task}</Button>
    <Button size="small" onClick={() => go({ inspect: entry.id })}>{copy.observe}</Button>
  </Space>;
  const columns: ColumnsType<CanonicalAgentExecution> = [
    { title: copy.executionId, dataIndex: "id", render: (id: string, entry) => <div><a className="font-mono text-xs text-[var(--brand)]" href={canonicalExecutionHref(projectId, entry, background)}>{id}</a><div className="mt-1 text-xs text-[var(--muted)]">{entry.workspace_id}</div></div> },
    { title: copy.taskId, dataIndex: "task_id", render: (id: string) => <a className="font-mono text-xs text-[var(--brand)]" href={canonicalTaskHref(projectId, id, background)}>{id}</a> },
    { title: copy.status, dataIndex: "status", render: (status: string, entry) => <Space direction="vertical" size={2}>{tag(status)}{entry.stale && <Tag color="warning">{copy.staleLabel}</Tag>}</Space> },
    { title: copy.runId, dataIndex: "run_id", render: (id: string) => <span className="font-mono text-xs" title={id}>{id || copy.notStarted}</span> },
    { title: copy.attempt, dataIndex: "attempt", render: (value: number | null | undefined) => value ?? "—", width: 90 },
    { title: copy.progress, dataIndex: "progress", render: (value: number | null) => value == null ? "—" : `${value}%`, width: 120 },
    { title: copy.actions, key: "actions", render: (_value, entry) => entryActions(entry), width: 260 },
  ];
  const metrics = isProfiles ? [
    { label: copy.bindings, value: catalogue ? catalogue.members.length : "—" },
    { label: copy.currentBindings, value: catalogue ? catalogue.members.filter((row) => row.status === "current").length : "—" },
    { label: copy.workspaces, value: catalogue ? catalogue.workspaces.length : "—" },
    { label: copy.unbound, value: catalogue ? catalogue.members.filter((row) => row.status === "unbound").length : "—" },
  ] : [
    { label: copy.total, value: page ? page.total : "—" },
    { label: copy.pageCount, value: page ? page.items.length : "—" },
    { label: copy.active, value: page ? page.items.filter((row) => agentActiveStatuses.includes(row.status)).length : "—" },
    { label: copy.stale, value: page ? page.items.filter((row) => row.stale).length : "—" },
  ];
  return <div className="w-full min-w-0 space-y-4">
    <WorkbenchShell title={focused ? copy.tabs[route.tab] : copy.title} description={copy.descriptions[route.tab]}
      actions={<><Button href={`#/tasks/execution?project_id=${encodeURIComponent(projectId)}`}>{copy.configure}</Button><Button href="#/workspace">{copy.independent}</Button><RefreshButton onClick={refresh} pending={contextQ.isFetching || (isProfiles ? bindingsQ.isFetching : runsQ.isFetching)} /></>}
      metrics={<WorkbenchStats items={metrics} />} />
    <nav aria-label={copy.title} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="max-w-full overflow-x-auto"><Segmented value={route.tab} onChange={(value) => go({ tab: value as AgentRunsTab })} options={agentRunsTabs.map((tab) => ({ value: tab, label: copy.tabs[tab] }))} /></div>
      {focused && <a href="#/ai/agent-ops" className="text-sm text-[var(--brand)]">{copy.back}</a>}
    </nav>
    <Alert type="info" showIcon title={isProfiles ? copy.bindingHint : copy.scopeHint} />
    {!context.permissions.write && <p className="text-sm text-[var(--muted)]">{copy.readOnly}</p>}
    {isProfiles ? <WorkbenchPanel title={copy.tabs.profiles}>
      {bindingsQ.error ? readFailure(bindingsQ.error, copy.bindingsError, copy.retryBindings, bindingsQ.refetch) : !catalogue ? <LoadingBlock label={copy.loading} /> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalogue.members.map((member) => <article key={member.member_id} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-mono text-sm">{member.member_id}</span>{tag(member.status)}</div>
            {member.binding ? <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-[var(--muted)]">{copy.profile}</dt><dd className="break-words">{member.binding.source.agent_title} <span className="font-mono text-xs">({member.binding.agent_id})</span></dd></div>
              <div><dt className="text-xs text-[var(--muted)]">{copy.workspace}</dt><dd className="break-words">{member.binding.source.workspace_name} <span className="font-mono text-xs">({member.binding.workspace_id})</span></dd></div>
              <div className="flex flex-wrap gap-4"><div><dt className="text-xs text-[var(--muted)]">{copy.provider}</dt><dd>{member.binding.source.provider}</dd></div><div><dt className="text-xs text-[var(--muted)]">{copy.bindingVersion}</dt><dd>{member.binding.agent_version}</dd></div></div>
            </dl> : <p className="text-sm text-[var(--muted)]">{copy.noBinding}</p>}
            {member.reasons.length > 0 && <ul className="list-inside list-disc text-sm text-[var(--muted)]">{member.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>}
            <Button href={canonicalMemberHref(projectId, member.member_id, background)}>{copy.team}</Button>
          </article>)}
        </div>
        {catalogue.members.length === 0 && <Empty description={copy.emptyBindings}><Button href={`#/dev-flow?view=team&team_view=members&project_id=${encodeURIComponent(projectId)}`}>{copy.team}</Button></Empty>}
      </>}
    </WorkbenchPanel> : <WorkbenchPanel title={copy.tabs[route.tab]} actions={<div className="flex max-w-full flex-wrap gap-2">
      <SearchInput value={route.q} onChange={(q) => go({ q })} placeholder={copy.search} />
      <Select aria-label={copy.status} className="min-w-44" value={route.status || "all"} onChange={(status) => go({ status: status === "all" ? "" : status })} options={[{ value: "all", label: copy.allStatuses }, ...agentRunStatuses.map((status) => ({ value: status, label: label(status) }))]} />
      {(route.q || route.status) && <Button onClick={() => go({ q: "", status: "" })}>{copy.clear}</Button>}
    </div>}>
      <p className="mb-3 text-sm text-[var(--muted)]">{copy.windowHint}</p>
      {route.tab === "retry" && <p className="mb-3 text-sm text-[var(--muted)]">{copy.retryHint}</p>}
      {runsQ.error ? readFailure(runsQ.error, copy.recordsError, copy.retryRecords, runsQ.refetch) : !page ? <LoadingBlock label={copy.loading} /> : <>
        <Table className="hidden md:block" rowKey="id" size="small" columns={columns} dataSource={rows} loading={runsQ.isFetching} pagination={false} scroll={{ x: 1050 }} locale={{ emptyText: copy.empty }} />
        <div className="grid gap-3 md:hidden">
          {rows.map((entry) => <article key={entry.id} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex flex-wrap justify-between gap-2"><a href={canonicalExecutionHref(projectId, entry, background)} className="break-all font-mono text-sm font-semibold text-[var(--brand)]">{entry.id}</a>{tag(entry.status)}</div>
            {entry.stale && <Tag color="warning">{copy.staleLabel}</Tag>}
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-[var(--muted)]">{copy.taskId}</dt><dd className="break-all"><a href={canonicalTaskHref(projectId, entry.task_id, background)}>{entry.task_id}</a></dd></div>
              <div><dt className="text-[var(--muted)]">{copy.workspace}</dt><dd className="break-all">{entry.workspace_id}</dd></div>
              <div className="col-span-2"><dt className="text-[var(--muted)]">{copy.runId}</dt><dd className="break-all">{entry.run_id || copy.notStarted}</dd></div>
              <div><dt className="text-[var(--muted)]">{copy.attempt}</dt><dd>{entry.attempt ?? "—"}</dd></div>
              <div><dt className="text-[var(--muted)]">{copy.progress}</dt><dd>{entry.progress == null ? "—" : `${entry.progress}%`}</dd></div>
            </dl>{entryActions(entry)}
          </article>)}
          {rows.length === 0 && <Empty description={copy.empty}><p className="text-sm text-[var(--muted)]">{copy.emptyHint}</p></Empty>}
        </div>
      </>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <span aria-live="polite" className="text-xs text-[var(--muted)]">{page ? page.next_cursor ? copy.more : copy.end : "—"}</span>
        <Space wrap><Button aria-label={copy.firstLabel} disabled={!route.cursor} onClick={() => go({ cursor: "", inspect: "" })}>{copy.first}</Button><Button aria-label={copy.nextLabel} disabled={!page?.next_cursor || runsQ.isFetching} onClick={() => { if (page?.next_cursor) go({ cursor: page.next_cursor, inspect: "" }); }}>{copy.next}</Button></Space>
      </div>
    </WorkbenchPanel>}
    {!isProfiles && route.inspect && <Drawer open title={copy.runtime} width="min(680px, 100vw)" onClose={() => go({ inspect: "" })} destroyOnHidden extra={<Button aria-label={copy.close} onClick={() => go({ inspect: "" })}>{copy.close}</Button>}>
      <div className="space-y-4">
        <p className="break-all font-mono text-sm">{route.inspect}</p>
        <Space wrap><Button type="primary" href={canonicalExecutionHref(projectId, { id: route.inspect, attempt: runtime?.attempt }, background)}>{copy.execution}</Button><RefreshButton onClick={() => { if (scope === projectSessionKey()) void runtimeQ.refetch(); }} pending={runtimeQ.isFetching} /></Space>
        {runtimeQ.error ? readFailure(runtimeQ.error, copy.runtimeError, copy.retryRuntime, runtimeQ.refetch) : !runtime ? <LoadingBlock label={copy.loading} /> : <>
          <div className="flex flex-wrap gap-2">{tag(runtime.status)}{runtime.stale && <Tag color="warning">{copy.staleLabel}</Tag>}</div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2"><dt className="text-xs text-[var(--muted)]">{copy.runId}</dt><dd className="break-all font-mono">{runtime.run_id || copy.notStarted}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{copy.attempt}</dt><dd>{runtime.attempt}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{copy.activeNode}</dt><dd className="break-all">{runtime.active_node_id || "—"}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-[var(--muted)]">{copy.observed}</dt><dd>{runtime.observed_at || "—"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{copy.stop}</dt><dd>{runtime.stop ? label(runtime.stop.state) : "—"}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{copy.recovery}</dt><dd>{runtime.recovery_requires_review ? copy.yes : copy.no}</dd></div>
          </dl>
          <section aria-label={copy.nodes} className="space-y-2"><strong>{copy.nodes}</strong>{runtime.nodes.map((node) => <div key={node.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--border)] p-3"><span className="break-all text-sm">{node.title || node.id}</span>{tag(node.status)}</div>)}</section>
        </>}
      </div>
    </Drawer>}
  </div>;
}
