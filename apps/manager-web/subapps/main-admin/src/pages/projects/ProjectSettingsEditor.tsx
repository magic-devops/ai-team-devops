import { Alert, Button, Form, Input, Modal, Select, Switch } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { prepareDeliveryIntent, type DeliveryIntent } from "@/lib/delivery";
import { fetchProjectPortfolioDetail, projectSessionKey, type PortfolioProject, type ProjectPortfolioDetail } from "@/lib/projectPortfolio";
import { useProjectEditorCommand } from "@/lib/projectEditorCommand";
import { ProjectCommandFeedback } from "./ProjectCommandFeedback";

type Settings = Pick<PortfolioProject, "name" | "description" | "business_id" | "project_path" | "vector_db" | "is_template">;
function settings(project: PortfolioProject): Settings {
  const { name, description, business_id, project_path, vector_db, is_template } = project;
  return { name, description, business_id, project_path, vector_db, is_template };
}

export function ProjectSettingsEditor({ initial, businesses, onClose, onSaved, onUnresolvedChange }: {
  initial: ProjectPortfolioDetail; businesses: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void; onUnresolvedChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const origin = useRef(projectSessionKey());
  const command = useProjectEditorCommand(initial.project.id, "project.update", onUnresolvedChange);
  const [values, setValues] = useState<Settings>(() => command.state.original
    ? { ...command.state.original.payload } as Settings : settings(initial.project));
  const valuesRef = useRef(values); valuesRef.current = values;
  const intent = useRef<DeliveryIntent>(command.state.original?.intent || { version: initial.project.version, key: crypto.randomUUID() });
  const reading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<ProjectPortfolioDetail | null>(null);
  const latestRef = useRef(latest); latestRef.current = latest;
  const [error, setError] = useState("");
  const confirmedAck = useRef<unknown>();
  const [confirmed, setConfirmed] = useState(false);
  const inScope = () => origin.current === projectSessionKey() && command.current();
  const phase = () => command.snapshot().phase;
  const writable = () => initial.project.permissions.can_configure;
  const canEdit = () => inScope() && !confirmedAck.current && writable() && !reading.current && ["idle", "refused"].includes(phase());
  const change = (patch: Partial<Settings>) => {
    if (!canEdit()) return;
    valuesRef.current = { ...valuesRef.current, ...patch }; setValues(valuesRef.current); setError("");
  };
  const close = () => {
    if (inScope() && !reading.current && !["sending", "unknown", "succeeded"].includes(phase())) onClose();
  };
  const complete = (ack: unknown) => {
    if (!ack || !inScope()) return;
    confirmedAck.current = ack; setConfirmed(true);
    command.reset();
    if (phase() !== "idle") { setError(tr("confirmedStorageUnavailable")); return; }
    try { onSaved(); onClose(); }
    catch { setError(tr("refreshAfterSaveFailed")); }
  };
  const finishConfirmed = () => complete(confirmedAck.current || command.snapshot().ack);
  const save = async () => {
    if (!canEdit() || phase() !== "idle" || !valuesRef.current.name.trim()) return;
    setError("");
    const payload = { ...valuesRef.current };
    intent.current = prepareDeliveryIntent(intent.current, "project.update", payload);
    complete(await command.run({ action: "project.update", payload, intent: intent.current }));
  };
  const retry = async () => { if (inScope() && !reading.current) complete(await command.replay()); };
  const readLatest = async () => {
    if (!canEdit()) return;
    reading.current = true; setBusy(true); latestRef.current = null; setLatest(null); setError("");
    try {
      const result = await fetchProjectPortfolioDetail(initial.project.id);
      if (!inScope()) return;
      if (result.project.id !== initial.project.id || !Number.isSafeInteger(result.project.version) || result.project.version < 0) throw new Error(tr("unavailableProject"));
      latestRef.current = result; setLatest(result);
    } catch (problem) { if (inScope()) setError(problem instanceof Error ? problem.message : tr("selectorFailed")); }
    finally { reading.current = false; setBusy(false); }
  };
  const adopt = () => {
    if (!canEdit()) return;
    const next = latestRef.current;
    if (!next?.project.permissions.can_configure) return;
    intent.current = { version: next.project.version, key: crypto.randomUUID() };
    command.reset(); latestRef.current = null; setLatest(null); setError("");
  };
  const locked = busy || confirmed || command.locked || !initial.project.permissions.can_configure;
  const unresolved = busy || command.unresolved || command.state.phase === "succeeded";
  const refused = command.state.phase === "refused";
  const latestValues = latest ? settings(latest.project) : null;
  const differences = latestValues ? (Object.keys(values) as (keyof Settings)[]).filter((key) => values[key] !== latestValues[key]) : [];
  const display = (value: Settings[keyof Settings]) => typeof value === "boolean" ? t(value ? "common.yes" : "common.no") : value || "—";
  return <Modal open title={tr("configure")} width={680} className="project-portfolio-modal" maskClosable={false}
    closable={!unresolved} keyboard={!unresolved} onCancel={close} footer={<>
      <Button onClick={close} disabled={unresolved}>{tr("cancel")}</Button>
      {refused && <Button data-action="read-settings" onClick={readLatest} loading={busy} disabled={locked}>{tr("readLatest")}</Button>}
      {latest && <Button data-action="adopt-settings" onClick={adopt} disabled={locked || !latest.project.permissions.can_configure}>{tr("adopt")} · v{latest.project.version}</Button>}
      <Button data-action="save-settings" type="primary" onClick={save} loading={command.state.phase === "sending"} disabled={locked || refused || !values.name.trim()}>{tr("save")}</Button>
    </>}>
    <div className="project-portfolio-detail">
      <header><strong>{initial.project.name}</strong><small className="project-portfolio-id">{initial.project.id}</small></header>
      <ProjectCommandFeedback command={command} onRetry={retry} onConfirmed={finishConfirmed} />
      {error && <Alert type="error" showIcon title={tr(confirmed || command.state.phase === "succeeded" ? "saved" : "saveFailed")} description={error} />}
      {latestValues && <section aria-label={tr("latestSettings")} className="space-y-3">
        <Alert type="info" showIcon title={`${tr("latestSettings")} · v${latest!.project.version}`} description={tr("adoptSettingsHint")} />
        {differences.length ? <dl className="space-y-3">{differences.map((key) => <div key={key} className="rounded-lg border border-[var(--border)] p-3">
          <dt className="font-medium">{tr(key === "project_path" ? "path" : key === "business_id" ? "business" : key === "vector_db" ? "vector" : key === "is_template" ? "template" : key)}</dt>
          <dd className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div><small className="text-[var(--muted)]">{tr("currentDraft")}</small><p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{display(values[key])}</p></div>
            <div><small className="text-[var(--muted)]">{tr("latestSettings")}</small><p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{display(latestValues[key])}</p></div>
          </dd>
        </div>)}</dl> : <p className="text-sm text-[var(--muted)]">{tr("sameSettings")}</p>}
      </section>}
      <Form layout="vertical">
        {(["name", "description", "project_path"] as const).map((key) => <Form.Item key={key} label={tr(key === "project_path" ? "path" : key)} required={key === "name"}>
          {key === "description" ? <Input.TextArea aria-label={tr(key)} value={values[key]} rows={4} maxLength={20000} showCount disabled={locked} onChange={(event) => change({ [key]: event.target.value })} />
            : <Input aria-label={tr(key === "project_path" ? "path" : key)} value={values[key]} maxLength={key === "name" ? 128 : 512} disabled={locked} onChange={(event) => change({ [key]: event.target.value })} />}
        </Form.Item>)}
        <Form.Item label={tr("business")}><Select aria-label={tr("business")} value={values.business_id || ""} disabled={locked} onChange={(business_id) => change({ business_id: business_id || null })}
          options={[{ value: "", label: tr("noBusiness") }, ...businesses.map((business) => ({ value: business.id, label: business.name }))]} /></Form.Item>
        <Form.Item label={tr("vector")}><Select aria-label={tr("vector")} value={values.vector_db} disabled={locked} onChange={(vector_db) => change({ vector_db })}
          options={["lance", "milvus", "qdrant", "oceanbase"].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item label={tr("template")}><Switch aria-label={tr("template")} checked={values.is_template} disabled={locked} onChange={(is_template) => change({ is_template })} /></Form.Item>
      </Form>
    </div>
  </Modal>;
}
