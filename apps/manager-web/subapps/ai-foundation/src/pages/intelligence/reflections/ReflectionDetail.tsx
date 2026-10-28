import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createEventGate } from "@/lib/eventReceiptState";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { fetchReflection, type ReflectionDetail as ExactReflection, type ReflectionLink, type ReflectionSelectionReference } from "@/lib/reflectionReads";
import { fetchExecutionDetail, fetchTaskDetail } from "@/lib/deliveryQuery";
import { currentReflectionHash, safeReflectionReturn } from "@/lib/reflectionRoute";
import { ReflectionProblem } from "./ReflectionCommon";

export function ReflectionDetail({ projectId, reflectionId, onAdopt, canNavigate, onNavigate }: {
  projectId: string; reflectionId: string; onAdopt: (source: ReflectionSelectionReference) => void;
  canNavigate: () => boolean; onNavigate: (href: string) => void;
}) {
  const { t } = useTranslation(), session = projectSessionKey();
  const scope = JSON.stringify([projectId, reflectionId, session]);
  const gate = useRef(createEventGate()); gate.current.enter(scope);
  const epoch = gate.current.epoch(), token = { epoch };
  const [state, setState] = useState<{ scope: string; epoch: number; busy: boolean; error: unknown; exact?: ExactReflection | null }>({ scope, epoch, busy: false, error: null });
  const abort = useRef<AbortController>();
  const current = () => session === projectSessionKey() && token.epoch === gate.current.epoch() && canNavigate();
  useEffect(() => {
    gate.current.enter(scope); token.epoch = gate.current.epoch();
    const leave = () => { gate.current.leave(); abort.current?.abort(); };
    if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.addEventListener(name, leave);
    return () => { if (typeof window !== "undefined") for (const name of ["hashchange", "popstate", "sop-session", "storage"]) window.removeEventListener(name, leave); leave(); };
  }, [scope]);
  const query = useQuery({ queryKey: ["reflection-exact", projectId, session, reflectionId], queryFn: ({ signal }) => fetchReflection(projectId, reflectionId, signal), enabled: !!projectId && !!reflectionId, retry: false, gcTime: 0, refetchOnWindowFocus: false });
  // A route/storage ticket can expire without changing this original's identity.
  // Its withdrawn read state must survive until a fresh exact read succeeds.
  const effective = state.scope === scope ? state : undefined;
  const data = query.error ? null : effective?.exact !== undefined ? effective.exact : query.data;
  const busy = !!effective && effective.epoch === epoch && effective.busy;
  async function reread() {
    if (!current() || busy) return;
    const ticket = gate.current.start();
    setState({ scope, epoch: ticket.epoch, busy: true, error: null, exact: null });
    try {
      const result = await query.refetch();
      if (!current() || !gate.current.current(ticket)) return;
      if (result.error || !result.data) throw result.error || new Error("reflection_source_unavailable");
      setState({ scope, epoch: ticket.epoch, busy: false, error: null, exact: result.data });
    } catch (error) { if (current() && gate.current.current(ticket)) setState({ scope, epoch: ticket.epoch, busy: false, error, exact: null }); }
  }
  async function act(kind: "adopt" | "original" | "source", link?: ReflectionLink) {
    if (!current() || !data?.available || busy) return;
    const ticket = gate.current.start(); abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setState({ scope, epoch: ticket.epoch, busy: true, error: null });
    try {
      const latest = await fetchReflection(projectId, reflectionId, controller.signal);
      if (!current() || !gate.current.current(ticket)) return;
      setState({ scope, epoch: ticket.epoch, busy: true, error: null, exact: latest });
      if (!latest.available) return;
      if (latest.source?.digest !== data.source?.digest || latest.verified?.attempt_id !== data.verified?.attempt_id) throw new Error("reflection_source_unavailable");
      if (kind === "adopt") { if (latest.selection_reference) onAdopt(latest.selection_reference); else throw new Error("reflection_source_unavailable"); }
      else if (kind === "original") {
        const params = new URLSearchParams({ project_id: projectId, event_receipt: reflectionId });
        const returnParams = new URLSearchParams(currentReflectionHash().split("?")[1]); returnParams.delete("event_return");
        const back = safeReflectionReturn("#/intelligence/reflections?" + returnParams, projectId);
        if (back) params.set("reflection_return", back);
        onNavigate("#/intelligence/events?" + params);
      } else if (link?.id) {
        const currentLink = latest.links.find((value) => value.kind === link.kind && value.id === link.id && value.available);
        if (!currentLink) throw new Error("reflection_source_unavailable");
        const params = new URLSearchParams({ project_id: projectId });
        if (link.kind === "task") {
          const value = await fetchTaskDetail(projectId, link.id, controller.signal);
          if (value.project_id !== projectId || value.task.id !== link.id) throw new Error("reflection_source_unavailable");
          params.set("task", link.id); params.set("view", value.task.req_id ? "list" : "timeline");
          if (value.task.req_id) { params.set("requirement", value.task.req_id); params.set("detail", "tasks"); }
        } else {
          const value = await fetchExecutionDetail(projectId, link.id, controller.signal);
          if (value.project_id !== projectId || value.execution.id !== link.id) throw new Error("reflection_source_unavailable");
          params.set("execution_id", link.id); params.set("view", "timeline");
        }
        if (current() && gate.current.current(ticket)) onNavigate("#/dev-flow?" + params);
      }
    } catch (error) { if (current() && gate.current.current(ticket)) setState({ scope, epoch: ticket.epoch, busy: false, error, exact: null }); }
    finally { if (current() && gate.current.current(ticket)) setState((value) => ({ ...value, busy: false })); }
  }
  if (query.error || effective?.error) return <ReflectionProblem error={effective?.error || query.error} onRetry={() => void reread()} />;
  if (query.isPending || !data && busy) return <Skeleton active />;
  if (!data) return <Alert type="warning" title={t("reflections.originalUnavailable")} action={<Button onClick={() => void reread()}>{t("reflections.refresh")}</Button>} />;
  if (!data.available || !data.statement || !data.source || !data.verified) return <Alert type="warning" title={t("reflections." + (data.unavailable_reason === "reflection_source_restricted" ? "forbidden" : "originalUnavailable"))} action={<Button onClick={() => void reread()}>{t("reflections.refresh")}</Button>} />;
  return <article className="reflections reflection-detail">
    <div className="reflection-actions"><Tag>{t("reflections.statement")}</Tag><Tag color="blue">{t("reflections.collected")}</Tag><Tag>{t("reflections.category." + data.statement.category)}</Tag></div>
    <h3>{data.statement.title}</h3>
    <p className="reflection-note">{t("reflections.claimWarning")}</p>
    <dl className="reflection-facts"><div><dt>{t("reflections.claimedTime")}</dt><dd>{data.statement.claimed_occurred_at}</dd></div><div><dt>{t("reflections.collectedAt")}</dt><dd>{data.verified.collected_at}</dd></div><div><dt>{t("reflections.producer")}</dt><dd>{data.reflection.producer.name || data.reflection.producer.id}</dd></div></dl>
    <section><h4>{t("reflections.observation")}</h4><p className="reflection-statement">{data.statement.observation}</p></section>
    {data.statement.lesson && <section><h4>{t("reflections.lesson")}</h4><p className="reflection-statement">{data.statement.lesson}</p></section>}
    <section><h4>{t("reflections.currentSources")}</h4><p className="reflection-note">{t("reflections.sourceHint")}</p>{!data.links.length ? <p>{t("reflections.noSources")}</p> : <ul className="reflection-manifest">{data.links.map((link, index) => <li key={JSON.stringify([link.kind, link.id, index])}><span>{t("reflections." + link.kind)} · {link.available ? link.label || link.id : t("reflections.sourceUnavailable")}</span><Tag>{t("reflections." + (link.available ? "sourceAvailable" : "sourceUnavailable"))}</Tag>{link.available && <Button disabled={busy} onClick={() => act("source", link)}>{t("reflections.openSource")}</Button>}</li>)}</ul>}<Button disabled={busy} onClick={() => void reread()}>{t("reflections.checkSources")}</Button></section>
    <div className="reflection-actions"><Button data-action="open-reflection-original" disabled={busy} onClick={() => act("original")}>{t("reflections.original")}</Button><Button data-action="adopt-reflection" type="primary" disabled={busy || !data.selection_reference} loading={busy} onClick={() => act("adopt")}>{t("reflections.adopt")}</Button></div>
    {!data.selection_reference && <p className="reflection-note">{t("reflections.selectionBlocked")}</p>}
    <details><summary>{t("reflections.identity")}</summary><dl className="reflection-facts"><div><dt>{t("reflections.receipt")}</dt><dd>{data.source.receipt_id}</dd></div><div><dt>SHA256</dt><dd>{data.source.digest}</dd></div><div><dt>{t("reflections.attempt")}</dt><dd>{data.verified.attempt_id}</dd></div></dl></details>
  </article>;
}
