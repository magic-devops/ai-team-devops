import { Alert, Button, Drawer, Empty, Form, Input, Select, Skeleton, Switch, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { prepareDeliveryIntent, type DeliveryIntent } from "@/lib/delivery";
import { activeRiskCategories, enterPortfolioProject, fetchProjectPortfolioDetail, projectSessionKey, submitProjectCommand, type ProjectPortfolioDetail } from "@/lib/projectPortfolio";
import { type PortfolioRiskCode } from "@/lib/projectPortfolioRoute";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { ProjectPortfolioFacts } from "./ProjectPortfolioFacts";
import { ProjectLifecycleEditor } from "./ProjectLifecycleEditor";
type Metadata = { name: string; description: string; business_id: string | null; project_path: string; vector_db: string; is_template: boolean };
type MetadataDraft = { values: Metadata; intent: DeliveryIntent };
export function ProjectInspector({ projectId, background, businesses, onClose, onSaved, sessionKey }: { projectId: string; background: string; businesses: { id: string; name: string }[]; onClose: () => void; onSaved: () => void; sessionKey: string }) {
  const inspector = useDrawerIdentity(sessionKey, projectId);
  const { t } = useTranslation();
  return <Drawer open={Boolean(projectId)} title={t("projectPortfolio.details")} width={640} className="project-portfolio-drawer" onClose={onClose} afterOpenChange={inspector.afterOpenChange} destroyOnHidden>
    {inspector.displayId && <InspectorBody key={`${sessionKey}:${inspector.displayId}`} projectId={inspector.displayId} background={background} businesses={businesses} onSaved={onSaved} />}
  </Drawer>;
}
function InspectorBody({ projectId, background, businesses, onSaved }: { projectId: string; background: string; businesses: { id: string; name: string }[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const origin = useRef(projectSessionKey());
  const query = useQuery({ queryKey: ["projectPortfolioDetail", origin.current, projectId], queryFn: ({ signal }) => fetchProjectPortfolioDetail(projectId, signal), refetchInterval: 10000 });
  const [edit, setEdit] = useState<MetadataDraft | null>(null);
  const [latest, setLatest] = useState<ProjectPortfolioDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [lifecycle, setLifecycle] = useState<ProjectPortfolioDetail | null>(null);
  const [category, setCategory] = useState<PortfolioRiskCode | "all">("all");
  const current = () => { if (origin.current !== projectSessionKey()) throw new Error(tr("scopeChanged")); };
  const data = query.data;
  const startEdit = () => {
    if (!data?.project.permissions.can_configure) return;
    const { name, description, business_id, project_path, vector_db, is_template } = data.project;
    setEdit({ values: { name, description, business_id, project_path, vector_db, is_template }, intent: { version: data.project.version, key: crypto.randomUUID() } });
    setLatest(null); setError(""); setConflict(false);
  };
  const save = async () => {
    if (!edit || pending || conflict) return;
    setPending(true); setError("");
    try {
      current();
      const payload = { ...edit.values };
      const intent = prepareDeliveryIntent(edit.intent, "project.update", payload);
      setEdit({ ...edit, intent });
      await submitProjectCommand(projectId, "project.update", payload, intent);
      current(); setEdit(null); onSaved(); void query.refetch();
    } catch (problem) { const message = problem instanceof Error ? problem.message : tr("saveFailed"); setError(message); setConflict(message.includes("409")); }
    finally { setPending(false); }
  };
  const readLatest = async () => {
    setLatest(null); setPending(true);
    try { current(); const result = await query.refetch({ throwOnError: true }); current(); if (result.data) setLatest(result.data); }
    catch (problem) { setError(problem instanceof Error ? problem.message : tr("refreshFailed")); }
    finally { setPending(false); }
  };
  if (query.isLoading && !data) return <Skeleton active />;
  if (!data || data.project.id !== projectId) return <Alert type="warning" title={tr("unavailableProject")} description={<><span className="project-portfolio-id">{projectId}</span><Button onClick={() => void query.refetch()}>{tr("refresh")}</Button></>} />;
  const archived = data.project.status === "archived";
  const risks = data.risks.filter((risk) => category === "all" || risk.categories.includes(category));
  const archive = data.lifecycle.last_archive;
  return <div className="project-portfolio-detail">
    {query.isError && <Alert type="warning" title={tr("refreshFailed")} />}
    <header><div><h2>{data.project.name}</h2><span className="project-portfolio-id">{data.project.id}</span><p>{data.project.business_name || tr("noBusiness")}</p></div><Tag>{tr(data.project.status)}</Tag></header>
    <p>{data.project.description}</p>
    {archived && <Alert type="info" title={tr("archivedReadOnly")} description={tr("archivedHint")} />}
    {!archived && data.project.status !== "active" && <Alert type="info" title={tr("pausedHint")} />}
    <div className="project-portfolio-actions"><Button type="primary" disabled={!data.project.permissions.can_enter} onClick={() => { current(); window.location.hash = enterPortfolioProject(data.project, undefined, background); }}>{tr("enter")}</Button><Button onClick={() => void query.refetch()}>{tr("refresh")}</Button></div>
    <section><h3>{tr("liveFacts")}</h3><ProjectPortfolioFacts row={data} /></section>
    <section><h3>{tr("risks")} · {data.risk_counts.total_items}</h3>
      <Select aria-label={tr("risks")} value={category} onChange={setCategory} options={[{ value: "all", label: tr("risks") }, ...activeRiskCategories(data.risk_counts).map((code) => ({ value: code, label: `${tr(`risk.${code}`)} ${data.risk_counts[code]}` }))]} />
      {!risks.length ? <Empty description={tr("noRisks")} /> : risks.map((risk) => <article className="project-portfolio-risk" key={risk.id}><strong>{risk.title}</strong><span className="project-portfolio-id">{risk.entity_id}</span><div className="project-portfolio-risk-tags">{risk.categories.map((code) => <Tag key={code}>{tr(`risk.${code}`)}</Tag>)}</div>{risk.due_on && <small>{risk.due_on}</small>}<Button disabled={!data.project.permissions.can_enter} onClick={() => { current(); window.location.hash = enterPortfolioProject(data.project, risk.target, background); }}>{tr("openTarget")}</Button></article>)}
    </section>
    {data.nearest_milestone && <section><h3>{tr("milestone")}</h3><strong>{data.nearest_milestone.title}</strong><small>{data.nearest_milestone.ends_on}</small><Button onClick={() => { current(); window.location.hash = enterPortfolioProject(data.project, data.nearest_milestone!.target, background); }} disabled={!data.project.permissions.can_enter}>{tr("openTarget")}</Button></section>}
    <section><h3>{tr("configure")}</h3>
      {error && <Alert type="error" title={tr(conflict ? "conflict" : "saveFailed")} description={error} />}
      {!edit ? <Button onClick={startEdit} disabled={!data.project.permissions.can_configure || query.isError}>{tr("configure")}</Button> : <Form layout="vertical">
        {(["name", "description", "project_path"] as const).map((key) => <Form.Item key={key} label={tr(key === "project_path" ? "path" : key)}><Input value={edit.values[key]} disabled={pending || !data.project.permissions.can_configure} onChange={(event) => setEdit({ ...edit, values: { ...edit.values, [key]: event.target.value } })} /></Form.Item>)}
        <Form.Item label={tr("business")}><Select value={edit.values.business_id || ""} disabled={pending || !data.project.permissions.can_configure} options={[{ value: "", label: tr("noBusiness") }, ...businesses.map((business) => ({ value: business.id, label: business.name }))]} onChange={(business_id) => setEdit({ ...edit, values: { ...edit.values, business_id: business_id || null } })} /></Form.Item>
        <Form.Item label={tr("vector")}><Select value={edit.values.vector_db} disabled={pending || !data.project.permissions.can_configure} options={["lance", "milvus", "qdrant", "oceanbase"].map((value) => ({ value, label: value }))} onChange={(vector_db) => setEdit({ ...edit, values: { ...edit.values, vector_db } })} /></Form.Item>
        <Form.Item label={tr("template")}><Switch checked={edit.values.is_template} disabled={pending || !data.project.permissions.can_configure} onChange={(is_template) => setEdit({ ...edit, values: { ...edit.values, is_template } })} /></Form.Item>
        <div className="project-portfolio-actions"><Button type="primary" loading={pending} onClick={save} disabled={pending || conflict || !edit.values.name.trim() || !data.project.permissions.can_configure}>{tr("save")}</Button><Button onClick={() => setEdit(null)} disabled={pending}>{tr("cancel")}</Button>{conflict && <Button onClick={readLatest} disabled={pending}>{tr("readLatest")}</Button>}{latest && <Button disabled={pending || !latest.project.permissions.can_configure} onClick={() => { setEdit({ ...edit, intent: { version: latest.project.version, key: crypto.randomUUID() } }); setConflict(false); setLatest(null); setError(""); }}>{tr("adopt")} · v{latest.project.version}</Button>}</div>
      </Form>}
    </section>
    <section><h3>{tr("lifecycle")}</h3><Button onClick={() => setLifecycle(structuredClone(data))} disabled={query.isError || !data.project.permissions.can_transition}>{tr(archived ? "restore" : "lifecycle")}</Button></section>
    <section className="project-portfolio-history"><h3>{tr("archiveHistory")}</h3>{archive ? <><small>{archive.at} · {archive.actor_name} · {archive.actor_id}</small><p>{archive.reason}</p><Alert type="info" title={tr("historyHint")} /><ProjectPortfolioFacts row={{ ...archive.facts, facts_as_of: archive.facts.as_of }} /></> : <p>{tr("noArchiveHistory")}</p>}</section>
    {lifecycle && <ProjectLifecycleEditor initial={lifecycle} background={background} onClose={() => setLifecycle(null)} onSaved={() => { setEdit(null); onSaved(); void query.refetch(); }} />}
  </div>;
}
