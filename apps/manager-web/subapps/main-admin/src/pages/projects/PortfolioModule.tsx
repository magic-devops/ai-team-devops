import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Form, Input, Modal, Progress, Select, Skeleton, Tag } from "antd";
import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { getProjectId, getToken } from "@/lib/authStorage";
import { activeRiskCategories, enterPortfolioProject, fetchProjectPortfolio, projectSessionKey } from "@/lib/projectPortfolio";
import { parsePortfolioRoute, portfolioHash, portfolioRiskCodes, projectStatuses, type PortfolioRoute, type ProjectStatus } from "@/lib/projectPortfolioRoute";
import { ProjectInspector } from "./ProjectInspector";
import "./project-portfolio.css";
const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback); window.addEventListener("sop-session", callback); window.addEventListener("storage", callback);
  return () => { window.removeEventListener("hashchange", callback); window.removeEventListener("sop-session", callback); window.removeEventListener("storage", callback); };
};
const snapshot = () => JSON.stringify([window.location.hash, projectSessionKey()]);
const defaultDraft = { name: "", description: "", business_id: "", project_path: "", vector_db: "lance", status: "planning" as Exclude<ProjectStatus, "archived"> };
export function PortfolioModule() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const session = projectSessionKey();
  const route = parsePortfolioRoute(window.location.hash);
  const { projectId, ...filters } = route;
  const query = useQuery({ queryKey: ["projectPortfolio", session, filters], queryFn: ({ signal }) => fetchProjectPortfolio(filters, signal), enabled: Boolean(getToken()), refetchInterval: 15000 });
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: Boolean(getToken()) });
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(defaultDraft);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const createOrigin = useRef(session);
  const changeRoute = (patch: Partial<PortfolioRoute>, resetCursor = true) => { window.location.hash = portfolioHash({ ...route, ...(resetCursor ? { cursor: "" } : {}), ...patch }); };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["projectPortfolio"] }); void qc.invalidateQueries({ queryKey: ["projectPortfolioDetail"] }); void qc.invalidateQueries({ queryKey: ["projects"] }); void qc.invalidateQueries({ queryKey: ["projectsSummary"] }); void qc.invalidateQueries({ queryKey: ["projectsHub"] }); void qc.invalidateQueries({ queryKey: ["projectTemplates"] }); };
  const create = async () => {
    if (createPending || !draft.name.trim() || !query.data?.permissions.can_create) return;
    setCreatePending(true); setCreateError("");
    try {
      if (createOrigin.current !== projectSessionKey()) throw new Error(tr("scopeChanged"));
      const result = await api.createProject({ ...draft, name: draft.name.trim(), business_id: draft.business_id || null });
      if (createOrigin.current !== projectSessionKey()) throw new Error(tr("scopeChanged"));
      setCreateOpen(false); setDraft(defaultDraft); refresh(); changeRoute({ projectId: result.id });
    } catch (problem) { setCreateError(problem instanceof Error ? problem.message : tr("saveFailed")); }
    finally { setCreatePending(false); }
  };
  const data = query.data;
  const filtered = Boolean(route.query || route.businessId || route.statuses.length || route.risks.length);
  return <div className="project-portfolio">
    <header><h2>{tr("title")}</h2><p>{tr("hint")}</p></header>
    <div className="project-portfolio-toolbar">
      <Input aria-label={tr("search")} placeholder={tr("search")} allowClear value={route.query} onChange={(event) => changeRoute({ query: event.target.value })} />
      <Select aria-label={tr("business")} value={route.businessId || ""} onChange={(businessId) => changeRoute({ businessId })} options={[{ value: "", label: tr("allBusinesses") }, ...(businesses.data || []).map((business: { id: string; name: string }) => ({ value: business.id, label: business.name }))]} />
      <Select mode="multiple" aria-label={tr("status")} placeholder={tr("status")} value={route.statuses} onChange={(statuses) => changeRoute({ statuses })} options={projectStatuses.map((value) => ({ value, label: tr(value) }))} />
      <Select mode="multiple" aria-label={tr("risks")} placeholder={tr("risks")} value={route.risks} onChange={(risks) => changeRoute({ risks })} options={portfolioRiskCodes.map((value) => ({ value, label: tr(`risk.${value}`) }))} />
      <Button onClick={() => void query.refetch()} loading={query.isFetching}>{tr("refresh")}</Button>
      <Button type="primary" disabled={!data?.permissions.can_create || query.isError} onClick={() => { createOrigin.current = projectSessionKey(); setCreateError(""); setCreateOpen(true); }}>{tr("create")}</Button>
    </div>
    {query.isError && <Alert type="warning" showIcon title={tr("refreshFailed")} description={query.error.message} action={<Button onClick={() => void query.refetch()}>{tr("refresh")}</Button>} />}
    {businesses.isError && <Alert type="warning" title={tr("selectorFailed")} />}
    {query.isLoading && !data && <Skeleton active />}
    {data && <>
      <div className="project-portfolio-summary">{[["title", data.summary.projects_total], ["verified", data.summary.metrics.verified_completed], ["recorded", data.summary.metrics.recorded_completed], ["risks", data.summary.risk_counts.total_items]].map(([key, value]) => <article key={key}><strong>{value}</strong><small>{tr(String(key))}</small></article>)}</div>
      <small>{tr("filteredScope")} · {tr("asOf")} {data.as_of}</small>
      {!data.rows.length && <Empty description={tr(filtered ? "noMatches" : "empty")}>{filtered && <Button onClick={() => { window.location.hash = portfolioHash({ projectId }); }}>{tr("clearFilters")}</Button>}</Empty>}
      <div className="project-portfolio-list">{data.rows.map((row) => <article key={row.project.id} className="project-portfolio-row" aria-current={projectId === row.project.id ? "true" : undefined}>
        <div><button type="button" className="project-portfolio-name" onClick={() => changeRoute({ projectId: row.project.id }, false)}>{row.project.name}<span className="project-portfolio-id">{row.project.id}</span></button><div className="project-portfolio-risk-tags"><Tag>{tr(row.project.status)}</Tag>{getProjectId() === row.project.id && <Tag color="blue">{tr("current")}</Tag>}</div><small>{row.project.business_name || tr("noBusiness")}</small></div>
        <div><small>{tr("verified")} {row.metrics.verified_completed}/{row.metrics.tasks_total}</small><Progress size="small" percent={row.metrics.tasks_total ? Math.round(row.metrics.verified_completed / row.metrics.tasks_total * 100) : 0} showInfo={false} /><small>{tr("recorded")} {row.metrics.recorded_completed}</small></div>
        <div className="project-portfolio-risk-tags">{activeRiskCategories(row.risk_counts).map((code) => <Button size="small" key={code} onClick={() => changeRoute({ projectId: row.project.id, risks: [code] })}>{tr(`risk.${code}`)} {row.risk_counts[code]}</Button>)}{!row.risk_counts.total_items && <small>{tr("noRisks")}</small>}</div>
        <div className="project-portfolio-actions"><Button onClick={() => changeRoute({ projectId: row.project.id }, false)}>{tr("inspect")}</Button><Button disabled={!row.project.permissions.can_enter} onClick={() => { window.location.hash = enterPortfolioProject(row.project, undefined, portfolioHash({ ...route, projectId: row.project.id })); }}>{tr("enter")}</Button></div>
      </article>)}</div>
      <div className="project-portfolio-actions">{route.cursor && <Button onClick={() => changeRoute({ cursor: "" }, false)}>{tr("first")}</Button>}{data.next_cursor && <Button onClick={() => changeRoute({ cursor: data.next_cursor! }, false)}>{tr("next")}</Button>}</div>
    </>}
    <ProjectInspector projectId={projectId} background={portfolioHash(route)} sessionKey={session} businesses={businesses.data || []} onClose={() => changeRoute({ projectId: "" }, false)} onSaved={refresh} />
    <Modal open={createOpen} title={tr("create")} className="project-portfolio-modal" onCancel={() => setCreateOpen(false)} closable={!createPending} maskClosable={!createPending} keyboard={!createPending} okText={tr("create")} cancelText={tr("cancel")} okButtonProps={{ disabled: !draft.name.trim(), loading: createPending }} cancelButtonProps={{ disabled: createPending }} onOk={create} destroyOnHidden>
      {createError && <Alert type="error" title={tr("saveFailed")} description={createError} />}
      <Form layout="vertical">
        {(["name", "description", "project_path"] as const).map((key) => <Form.Item key={key} label={tr(key === "project_path" ? "path" : key)} required={key === "name"}><Input value={draft[key]} disabled={createPending} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></Form.Item>)}
        <Form.Item label={tr("business")}><Select value={draft.business_id} disabled={createPending} onChange={(business_id) => setDraft({ ...draft, business_id })} options={[{ value: "", label: tr("noBusiness") }, ...(businesses.data || []).map((business: { id: string; name: string }) => ({ value: business.id, label: business.name }))]} /></Form.Item>
        <Form.Item label={tr("status")}><Select aria-label={tr("status")} value={draft.status} disabled={createPending} onChange={(status) => setDraft({ ...draft, status })} options={projectStatuses.filter((status) => status !== "archived").map((status) => ({ value: status, label: tr(status) }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
