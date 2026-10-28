import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Input, Select, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { createEventGate } from "@/lib/eventReceiptState";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { fetchReflectionInputs, fetchReflections, reflectionCategories, validReflectionReference, type ReflectionCategory, type ReflectionSelectionReference } from "@/lib/reflectionReads";
import { reflectionInputStorageKey, useReflectionInputCommand } from "@/lib/reflectionCommand";
import { currentReflectionHash, parseReflectionRoute, reflectionRouteKeys, type ReflectionRoute, type ReflectionRouteValues } from "@/lib/reflectionRoute";
import { safeEventReturn } from "@/lib/eventReceipts";
import { ReflectionInputForm } from "./ReflectionInputHost";
import { ReflectionDetail } from "./ReflectionDetail";
import { ReflectionInputDetail } from "./ReflectionInputDetail";
import { ReflectionProblem } from "./ReflectionCommon";
import "./reflections.css";

function restoreSelection(projectId: string): ReflectionSelectionReference[] {
  try {
    const key = reflectionInputStorageKey(projectId), value = key ? JSON.parse(sessionStorage.getItem(key + ":selection") || "[]") : [];
    if (Array.isArray(value) && value.length <= 32 && value.every(validReflectionReference) && new Set(value.map((source) => source.reflection_id)).size === value.length) return value;
  } catch { /* Only the unsent selection is optional; unknown originals stay in the command host. */ }
  return [];
}
function localBoundary(value: string) {
  if (!value) return "";
  const date = new Date(value), pad = (part: number, size = 2) => String(part).padStart(size, "0");
  if (!Number.isFinite(date.getTime())) return "";
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
function isoBoundary(value: string) {
  if (!value) return "";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)) throw new Error("filterInvalid");
  const normalized = value.length === 16 ? value + ":00.000" : value.length === 19 ? value + ".000" : value.padEnd(23, "0");
  if (localBoundary(value) !== normalized) throw new Error("filterInvalid");
  return new Date(value).toISOString();
}
export function ReflectionWorkbench({ projectId, onExitState }: { projectId: string; onExitState?: (canNavigate: () => boolean, pending: boolean) => void }) {
  const { t } = useTranslation(), session = projectSessionKey(), exit = useExecutionExitGuard(), qc = useQueryClient();
  const [route, setRoute] = useState(() => parseReflectionRoute(currentReflectionHash()));
  const identity = JSON.stringify([projectId, session]);
  const [storedSelection, setSelection] = useState(() => ({ identity, sources: restoreSelection(projectId) }));
  const selection = storedSelection.identity === identity ? storedSelection.sources : restoreSelection(projectId);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [selectionError, setSelectionError] = useState("");
  // Construct the recovery controller before rendering any component that issues current reads.
  const exitCheck = useRef<() => boolean>(() => true);
  const canLeave = useRef(() => exitCheck.current()).current;
  const command = useReflectionInputCommand(projectId, (pending) => { exit.setPending("reflection.input.create", pending); onExitState?.(canLeave, pending); });
  const gate = useRef(createEventGate());
  const scope = JSON.stringify([projectId, session, currentReflectionHash()]); gate.current.enter(scope);
  const token = { epoch: gate.current.epoch() };
  const current = () => session === projectSessionKey() && token.epoch === gate.current.epoch() && command.current();
  const unresolved = () => ["sending", "unknown"].includes(command.snapshot().phase);
  exitCheck.current = () => command.current() && !unresolved() && exit.canNavigate();
  const currentRoute = parseReflectionRoute(currentReflectionHash());
  const requested = currentRoute.projectId;
  const mismatch = !!requested && requested !== projectId;
  const active = !!projectId && currentRoute.valid && !mismatch;
  useEffect(() => {
    onExitState?.(canLeave, command.unresolved);
    return () => onExitState?.(canLeave, false);
  }, [canLeave, onExitState, command.unresolved]);
  useEffect(() => {
    gate.current.enter(scope); token.epoch = gate.current.epoch();
    const sync = () => { gate.current.leave(); setRoute(parseReflectionRoute(currentReflectionHash())); };
    for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, sync);
    return () => { for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, sync); gate.current.leave(); };
  }, [scope]);
  function change(patch: Partial<ReflectionRouteValues>) {
    if (!current() || !active || unresolved() || !exit.canNavigate()) return;
    const params = new URLSearchParams({ project_id: projectId });
    const existing = new URLSearchParams(currentReflectionHash().split("?")[1]);
    for (const key of Object.values(reflectionRouteKeys)) { const value = existing.get(key); if (value) params.set(key, value); }
    const back = safeEventReturn(existing.get("event_return") || "", projectId); if (back) params.set("event_return", back);
    if (["category", "from", "to"].some((key) => key in patch)) { params.delete("reflection_cursor"); params.delete("reflection_page"); }
    for (const [key, value] of Object.entries(patch)) { const wireKey = reflectionRouteKeys[key as keyof ReflectionRouteValues]; if (value) params.set(wireKey, value === true ? "1" : String(value)); else params.delete(wireKey); }
    const href = "#/intelligence/reflections?" + params;
    history.pushState(null, "", href); window.dispatchEvent(new Event("hashchange")); setRoute(parseReflectionRoute(href));
  }
  function update(next: ReflectionSelectionReference[]) {
    if (!current() || unresolved()) return;
    selectionRef.current = next; setSelection({ identity, sources: next });
    try { const key = reflectionInputStorageKey(projectId); if (key) sessionStorage.setItem(key + ":selection", JSON.stringify(next)); } catch { setSelectionError("storageDraftFailed"); }
  }
  function adopt(source: ReflectionSelectionReference) {
    if (!current() || !active || unresolved() || !validReflectionReference(source)) return;
    const previous = selectionRef.current;
    const same = previous.find((value) => value.reflection_id === source.reflection_id);
    if (same) { if (JSON.stringify(same) !== JSON.stringify(source)) setSelectionError("sourceChanged"); return; }
    if (previous.length >= 32) { setSelectionError("limitReached"); return; }
    setSelectionError(""); update([...previous, structuredClone(source)]);
  }
  const navigate = (href: string) => { if (current() && !unresolved() && exit.canNavigate()) location.hash = href; };
  const eventBack = safeEventReturn(new URLSearchParams(currentReflectionHash().split("?")[1]).get("event_return") || "", projectId);
  return <section className="reflections" aria-label={t("reflections.title")}>
    <header className="reflection-heading"><div><p className="reflection-eyebrow">{t("reflections.workspace")}</p><h2>{t("reflections.title")}</h2></div><Tag>{t("reflections.noModel")}</Tag></header>
    <p className="reflection-note">{t("reflections.claimWarning")}</p><p className="reflection-note">{t("reflections.countScope")}</p>
    {!!projectId && command.current() && command.unresolved && <Alert type="warning" title={t("reflections.recoveryProject", { project: projectId })} description={projectId} />}
    {!!projectId && command.current() && <ReflectionInputForm key={identity} projectId={projectId} sessionId={session} sources={selection} open={active && route.prepare} allowNew={active} command={command} onPending={(pending) => exit.setPending("reflection.input.create", pending)} onClose={() => change({ prepare: false })} onSaved={(ack) => { update([]); change({ prepare: false, tab: "inputs", input: ack.resource.id }); void qc.invalidateQueries({ queryKey: ["reflection-inputs", projectId] }); }} />}
    {!projectId ? <Alert type="info" title={t("reflections.noProject")} /> : !currentRoute.valid ? <Alert type="warning" title={t("reflections.invalidRoute")} /> : mismatch ? <Alert type="warning" title={t("reflections.wrongProject")} /> : <>
      {eventBack && <Button disabled={command.unresolved} onClick={() => navigate(eventBack)}>{t("eventReceipts.back")}</Button>}
      {exit.blocked && <Alert type="warning" role="alert" title={t("reflections.blocked")} />}
      <ReflectionLists projectId={projectId} session={session} route={route} disabled={command.unresolved} change={change} onAdopt={adopt} canNavigate={exit.canNavigate} navigate={navigate} />
      <aside className="reflection-selection" aria-label={t("reflections.selection")}><div><strong role="status">{t("reflections.selectedCount", { count: selection.length })}</strong><p className="reflection-note">{t("reflections.explicitSelection")}</p></div><Button type="primary" disabled={!selection.length || command.unresolved} onClick={() => change({ prepare: true })}>{t("reflections.prepare")}</Button>{selection.length > 0 && <details><summary>{t("reflections.selection")}</summary><ol className="reflection-manifest">{selection.map((source) => <li key={source.reflection_id}><span>{source.reflection_id}</span><Button disabled={command.unresolved} onClick={() => update(selectionRef.current.filter((value) => value.reflection_id !== source.reflection_id))}>{t("reflections.remove")}</Button></li>)}</ol></details>}</aside>
      {selectionError && <Alert type="warning" role="alert" title={t("reflections." + selectionError)} />}
      <details className="reflection-integration">
        <summary>{t("reflections.integration")}</summary>
        <p>{t("reflections.integrationHint")}</p><p>{t("reflections.storedHint")}</p>
        <p>{t("reflections.exampleFile")}</p>
        <pre>{'{"schema_version":1,"category":"testing","title":"Reflection title","observation":"Submitter statement"}'}</pre>
        <pre>{"sop reflection record --file reflection.json --id reflection-20261020-001 --time 2026-10-20T00:00:00Z --local\nsop event flush"}</pre>
        <div className="reflection-actions">
          <Button disabled={command.unresolved} onClick={() => navigate("#/intelligence/events?" + new URLSearchParams({ project_id: projectId, event_type: "sop.reflection.recorded", event_state: "pending" }))}>{t("reflections.pendingReceipts")}</Button>
          <Button disabled={command.unresolved} onClick={() => navigate("#/intelligence/events?" + new URLSearchParams({ project_id: projectId, event_type: "sop.reflection.recorded", event_state: "failed" }))}>{t("reflections.failedReceipts")}</Button>
        </div>
      </details>
    </>}
  </section>;
}

function ReflectionLists({ projectId, session, route, disabled, change, onAdopt, canNavigate, navigate }: {
  projectId: string; session: string; route: ReflectionRoute; disabled: boolean; change: (patch: Partial<ReflectionRouteValues>) => void;
  onAdopt: (source: ReflectionSelectionReference) => void; canNavigate: () => boolean; navigate: (href: string) => void;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ category: route.category, from: localBoundary(route.from), to: localBoundary(route.to) });
  const [filterError, setFilterError] = useState("");
  useEffect(() => { setFilters({ category: route.category, from: localBoundary(route.from), to: localBoundary(route.to) }); setFilterError(""); }, [route.category, route.from, route.to]);
  function applyFilters() {
    try {
      const from = isoBoundary(filters.from), to = isoBoundary(filters.to);
      if (from && to && Date.parse(to) <= Date.parse(from)) throw new Error("filterInvalid");
      setFilterError(""); change({ category: filters.category, from, to });
    } catch { setFilterError("filterInvalid"); }
  }
  const query = useQuery({ queryKey: ["reflection-page", projectId, session, route.category, route.from, route.to, route.cursor], queryFn: ({ signal }) => fetchReflections(projectId, { category: route.category as ReflectionCategory, from: route.from, to: route.to, cursor: route.cursor }, signal), enabled: !disabled && route.tab === "collected", retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const inputs = useQuery({ queryKey: ["reflection-inputs", projectId, session, route.inputCursor], queryFn: ({ signal }) => fetchReflectionInputs(projectId, route.inputCursor, signal), enabled: !disabled && route.tab === "inputs", retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const drawer = useDrawerIdentity(JSON.stringify([projectId, session, route.tab]), route.receipt ? "reflection:" + route.receipt : route.input ? "input:" + route.input : "");
  const first = () => { change({ cursor: "", page: 1 }); if (!route.cursor) void query.refetch(); };
  const inputFirst = () => { change({ inputCursor: "", inputPage: 1 }); if (!route.inputCursor) void inputs.refetch(); };
  if (disabled) return <p className="reflection-note">{t("reflections.recoveryFirst")}</p>;
  return <>
    <nav className="reflection-actions" aria-label={t("reflections.views")}><Button aria-pressed={route.tab === "collected"} type={route.tab === "collected" ? "primary" : "default"} onClick={() => change({ tab: "collected" })}>{t("reflections.collected")}</Button><Button aria-pressed={route.tab === "inputs"} type={route.tab === "inputs" ? "primary" : "default"} onClick={() => change({ tab: "inputs" })}>{t("reflections.inputs")}</Button></nav>
    {route.tab === "collected" ? <>
      <div className="reflection-filters"><label>{t("reflections.categoryLabel")}<Select aria-label={t("reflections.categoryLabel")} value={filters.category} onChange={(category) => setFilters((value) => ({ ...value, category }))} options={[{ value: "", label: t("reflections.all") }, ...reflectionCategories.map((value) => ({ value, label: t("reflections.category." + value) }))]} /></label>{(["from", "to"] as const).map((key) => <label key={key}>{t("reflections." + key)}<Input aria-label={t("reflections." + key)} type="datetime-local" step="0.001" value={filters[key]} onChange={(event) => setFilters((value) => ({ ...value, [key]: event.target.value }))} onPressEnter={applyFilters} /></label>)}<Button onClick={applyFilters}>{t("reflections.apply")}</Button><Button loading={query.isFetching} onClick={() => void query.refetch()}>{t("reflections.refresh")}</Button></div>
      {filterError && <Alert type="warning" role="alert" title={t("reflections." + filterError)} />}
      {query.isPending && <Skeleton active />}{query.error ? <ReflectionProblem error={query.error} onRetry={() => void query.refetch()} onFirst={first} /> : query.data && <><p className="reflection-note">{t("reflections.lastRead")} · {query.data.as_of}</p><div className="reflection-list">{!query.data.items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("reflections.empty")} />}{query.data.items.map((item) => <article className="reflection-row" key={item.id}><div className="reflection-actions"><Tag>{t("reflections.category." + item.category)}</Tag><Tag color="blue">{t("reflections.collected")}</Tag>{item.original_status === "restricted" && <Tag>{t("reflections.restricted")}</Tag>}</div><dl className="reflection-facts"><div><dt>{t("reflections.claimedTime")}</dt><dd>{item.occurred_at}</dd></div><div><dt>{t("reflections.producer")}</dt><dd>{item.producer.name || item.producer.id}</dd></div><div><dt>{t("reflections.collectedAt")}</dt><dd>{item.collected_at}</dd></div></dl><Button onClick={() => change({ receipt: item.id, input: "" })}>{t("reflections.open")}</Button></article>)}</div><nav className="reflection-pager" aria-label={t("reflections.collected")}><span role="status">{t("reflections.page", { page: route.page, total: query.data.total })}</span><Button disabled={query.isFetching} onClick={first}>{t("reflections.first")}</Button><Button disabled={query.isFetching || !query.data.has_more} onClick={() => query.data?.next_cursor && change({ cursor: query.data.next_cursor, page: route.page + 1 })}>{t("reflections.next")}</Button></nav></>}
    </> : <>
      <div className="reflection-actions"><p className="reflection-note">{t("reflections.preparedHint")}</p><Button loading={inputs.isFetching} onClick={() => void inputs.refetch()}>{t("reflections.refresh")}</Button></div>{inputs.isPending && <Skeleton active />}{inputs.error ? <ReflectionProblem error={inputs.error} onRetry={() => void inputs.refetch()} onFirst={inputFirst} /> : inputs.data && <><div className="reflection-list">{!inputs.data.items.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("reflections.inputsEmpty")} />}{inputs.data.items.map((item) => <article className="reflection-row" key={item.id}><Tag color="blue">{t("reflections.prepared")}</Tag><h3>{item.title}</h3><p>{t("reflections.selectedCount", { count: item.source_count })}</p><p className="reflection-note">{item.created_at} · {item.created_by.name || item.created_by.id}</p><Button onClick={() => change({ input: item.id, receipt: "" })}>{t("reflections.open")}</Button></article>)}</div><nav className="reflection-pager" aria-label={t("reflections.inputs")}><span role="status">{t("reflections.page", { page: route.inputPage, total: inputs.data.total })}</span><Button disabled={inputs.isFetching} onClick={inputFirst}>{t("reflections.first")}</Button><Button disabled={inputs.isFetching || !inputs.data.has_more} onClick={() => inputs.data?.next_cursor && change({ inputCursor: inputs.data.next_cursor, inputPage: route.inputPage + 1 })}>{t("reflections.next")}</Button></nav></>}
    </>}
    <Drawer open={!!route.receipt || !!route.input} title={t("reflections.detail")} size="min(760px, 100vw)" destroyOnHidden onClose={() => change({ receipt: "", input: "" })} afterOpenChange={drawer.afterOpenChange}>{drawer.displayId?.startsWith("reflection:") ? <ReflectionDetail key={JSON.stringify([projectId, session, drawer.displayId])} projectId={projectId} reflectionId={drawer.displayId.slice(11)} onAdopt={onAdopt} canNavigate={canNavigate} onNavigate={navigate} /> : drawer.displayId?.startsWith("input:") ? <ReflectionInputDetail key={JSON.stringify([projectId, session, drawer.displayId])} projectId={projectId} inputId={drawer.displayId.slice(6)} onOpenSource={(receipt) => change({ receipt, input: "" })} /> : null}</Drawer>
  </>;
}
