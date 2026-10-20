import { Alert, Button, Drawer, Empty, Select, Skeleton, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeRiskCategories, enterPortfolioProject, fetchProjectPortfolioDetail, projectSessionKey, type ProjectPortfolioDetail } from "@/lib/projectPortfolio";
import { projectEditorRecoverySlots, type ProjectEditorAction } from "@/lib/projectEditorCommand";
import { installExecutionExitGuard } from "@/lib/executionExitGuard";
import { type PortfolioRiskCode } from "@/lib/projectPortfolioRoute";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { ProjectPortfolioFacts } from "./ProjectPortfolioFacts";
import { ProjectLifecycleEditor } from "./ProjectLifecycleEditor";
import { ProjectSettingsEditor } from "./ProjectSettingsEditor";
import { ProjectCommandRecovery } from "./ProjectCommandRecovery";

export function ProjectInspector({ projectId, background, businesses, onClose, onSaved, sessionKey, navigationGuard }: {
  projectId: string; background: string; businesses: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void; sessionKey: string; navigationGuard?: { current: () => boolean };
}) {
  const inspector = useDrawerIdentity(sessionKey, projectId);
  const requested = useRef(projectId); requested.current = projectId;
  const displayedId = inspector.displayId;
  const { t } = useTranslation();
  const pending = useRef(new Set<string>());
  const [, redraw] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const unresolved = () => sessionKey === projectSessionKey() && (
    [...pending.current].some((key) => key.startsWith(`${sessionKey}:`)) || Boolean(projectId && projectEditorRecoverySlots(projectId).length)
  );
  const canLeave = () => {
    if (sessionKey !== projectSessionKey()) return false;
    if (unresolved()) { setBlocked(true); return false; }
    setBlocked(false); return true;
  };
  if (navigationGuard) navigationGuard.current = canLeave;
  useEffect(() => () => { if (navigationGuard) navigationGuard.current = () => true; }, [navigationGuard]);
  const onPending = (identity: string, value: boolean) => {
    const key = `${sessionKey}:${identity}`;
    if (value) pending.current.add(key); else pending.current.delete(key);
    if (!pending.current.size) setBlocked(false);
    redraw((version) => version + 1);
  };
  useEffect(() => installExecutionExitGuard(window, unresolved, () => setBlocked(true)), [sessionKey, projectId]);
  const locked = unresolved();
  return <Drawer open={Boolean(projectId)} title={t("projectPortfolio.details")} width={640} className="project-portfolio-drawer"
    onClose={() => { if (canLeave()) onClose(); }} closable={!locked} maskClosable={!locked} keyboard={!locked}
    afterOpenChange={inspector.afterOpenChange} destroyOnHidden>
    {blocked && <Alert className="mb-3" type="warning" showIcon title={t("projectPortfolio.confirmBeforeLeave")} />}
    {inspector.displayId && <InspectorBody key={`${sessionKey}:${inspector.displayId}`} projectId={inspector.displayId} background={background}
      businesses={businesses} onSaved={onSaved} onPending={onPending} canLeave={canLeave}
      isActive={() => requested.current === displayedId && sessionKey === projectSessionKey()} />}
  </Drawer>;
}
function InspectorBody({ projectId, background, businesses, onSaved, onPending, canLeave, isActive }: {
  projectId: string; background: string; businesses: { id: string; name: string }[]; onSaved: () => void;
  onPending: (identity: string, value: boolean) => void; canLeave: () => boolean; isActive: () => boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const origin = useRef(projectSessionKey());
  const query = useQuery({ queryKey: ["projectPortfolioDetail", origin.current, projectId], queryFn: ({ signal }) => {
    if (!isActive() || origin.current !== projectSessionKey()) throw new Error(tr("scopeChanged"));
    return fetchProjectPortfolioDetail(projectId, signal);
  }, enabled: isActive(), refetchInterval: 10000 });
  const activeEditor = useRef<"settings" | "lifecycle" | ProjectEditorAction | null>(null);
  const [settings, setSettings] = useState<ProjectPortfolioDetail | null>(null);
  const [lifecycle, setLifecycle] = useState<ProjectPortfolioDetail | null>(null);
  const [recovery, setRecovery] = useState<ProjectEditorAction | null>(null);
  const [category, setCategory] = useState<PortfolioRiskCode | "all">("all");
  const [notice, setNotice] = useState("");
  const current = () => isActive() && origin.current === projectSessionKey();
  const slots = projectEditorRecoverySlots(projectId);
  const busy = slots.length > 0;
  const changed = () => { if (current()) { onSaved(); void query.refetch(); } };
  const open = (kind: "settings" | "lifecycle", value: ProjectPortfolioDetail) => {
    if (!current() || activeEditor.current || !canLeave() || projectEditorRecoverySlots(projectId).length) return;
    if (kind === "settings" && value.project.permissions.can_configure) { activeEditor.current = kind; setSettings(structuredClone(value)); }
    if (kind === "lifecycle" && value.project.permissions.can_transition) { activeEditor.current = kind; setLifecycle(structuredClone(value)); }
  };
  const enter = (data: ProjectPortfolioDetail, target?: Parameters<typeof enterPortfolioProject>[1]) => {
    if (current() && canLeave()) window.location.hash = enterPortfolioProject(data.project, target, background);
  };
  const editing = <>
    {settings && <ProjectSettingsEditor initial={settings} businesses={businesses}
      onClose={() => { if (current() && canLeave()) { activeEditor.current = null; setSettings(null); } }} onSaved={changed}
      onUnresolvedChange={(value) => onPending(`settings:${projectId}`, value)} />}
    {lifecycle && <ProjectLifecycleEditor initial={lifecycle} background={background}
      onClose={() => { if (current() && canLeave()) { activeEditor.current = null; setLifecycle(null); } }} onSaved={changed}
      onUnresolvedChange={(value) => onPending(`lifecycle:${projectId}`, value)} />}
  </>;
  const restoring = <>
    {notice && <Alert className="mb-3" type="info" title={tr("saved")} description={notice} closable onClose={() => setNotice("")} />}
    {!settings && !lifecycle && slots.length > 0 && <Alert className="mb-3" type="warning" showIcon title={tr("recovery")} description={tr("unknownHint")}
      action={<div className="flex flex-wrap gap-2">{slots.map((action) => <Button key={action} data-action={`recover-${action}`} disabled={Boolean(recovery) && recovery !== action}
        onClick={() => { if (current() && !activeEditor.current && projectEditorRecoverySlots(projectId).includes(action)) { activeEditor.current = action; setRecovery(action); } }}>{tr(action === "project.lifecycle" ? "lifecycle" : "configure")}</Button>)}</div>} />}
    {recovery && !settings && !lifecycle && <ProjectCommandRecovery key={`${projectId}:${recovery}`} projectId={projectId} action={recovery}
      onPending={(value) => onPending(`recovery:${projectId}:${recovery}`, value)} onSaved={changed} onWarning={setNotice} onResolved={() => { if (current()) { activeEditor.current = null; setRecovery(null); } }} />}
  </>;
  const data = query.data;
  if (query.isLoading && !data) return <>{restoring}<Skeleton active />{editing}</>;
  if (query.error || !data || data.project.id !== projectId) return <>{restoring}
    <Alert type="warning" showIcon title={tr("unavailableProject")} description={query.error?.message}
      action={<Button onClick={() => { if (current()) void query.refetch(); }}>{tr("refresh")}</Button>} />{editing}</>;
  const archived = data.project.status === "archived";
  const risks = data.risks.filter((risk) => category === "all" || risk.categories.includes(category));
  const archive = data.lifecycle.last_archive;
  return <div className="project-portfolio-detail">
    {restoring}
    <header><div><h2>{data.project.name}</h2><span className="project-portfolio-id">{data.project.id}</span><p>{data.project.business_name || tr("noBusiness")}</p></div><Tag>{tr(data.project.status)}</Tag></header>
    <p>{data.project.description}</p>
    {archived && <Alert type="info" title={tr("archivedReadOnly")} description={tr("archivedHint")} />}
    {!archived && data.project.status !== "active" && <Alert type="info" title={tr("pausedHint")} />}
    <div className="project-portfolio-actions">
      <Button type="primary" disabled={busy || !data.project.permissions.can_enter} onClick={() => enter(data)}>{tr("enter")}</Button>
      <Button data-action="open-settings" disabled={busy || !data.project.permissions.can_configure} onClick={() => open("settings", data)}>{tr("configure")}</Button>
      <Button data-action="open-lifecycle" disabled={busy || !data.project.permissions.can_transition} onClick={() => open("lifecycle", data)}>{tr(archived ? "restore" : "lifecycle")}</Button>
      <Button onClick={() => { if (current()) void query.refetch(); }}>{tr("refresh")}</Button>
    </div>
    <section><h3>{tr("liveFacts")}</h3><ProjectPortfolioFacts row={data} /></section>
    <section><h3>{tr("risks")} · {data.risk_counts.total_items}</h3>
      <Select aria-label={tr("risks")} value={category} onChange={setCategory} options={[{ value: "all", label: tr("risks") }, ...activeRiskCategories(data.risk_counts).map((code) => ({ value: code, label: `${tr(`risk.${code}`)} ${data.risk_counts[code]}` }))]} />
      {!risks.length ? <Empty description={tr("noRisks")} /> : risks.map((risk) => <article className="project-portfolio-risk" key={risk.id}><strong>{risk.title}</strong><span className="project-portfolio-id">{risk.entity_id}</span><div className="project-portfolio-risk-tags">{risk.categories.map((code) => <Tag key={code}>{tr(`risk.${code}`)}</Tag>)}</div>{risk.due_on && <small>{risk.due_on}</small>}<Button disabled={busy || !data.project.permissions.can_enter} onClick={() => enter(data, risk.target)}>{tr("openTarget")}</Button></article>)}
    </section>
    {data.nearest_milestone && <section><h3>{tr("milestone")}</h3><strong>{data.nearest_milestone.title}</strong><small>{data.nearest_milestone.ends_on}</small><Button onClick={() => enter(data, data.nearest_milestone!.target)} disabled={busy || !data.project.permissions.can_enter}>{tr("openTarget")}</Button></section>}
    <section className="project-portfolio-history"><h3>{tr("archiveHistory")}</h3>{archive ? <><small>{archive.at} · {archive.actor_name} · {archive.actor_id}</small><p>{archive.reason}</p><Alert type="info" title={tr("historyHint")} /><ProjectPortfolioFacts row={{ ...archive.facts, facts_as_of: archive.facts.as_of }} /></> : <p>{tr("noArchiveHistory")}</p>}</section>
    {editing}
  </div>;
}
