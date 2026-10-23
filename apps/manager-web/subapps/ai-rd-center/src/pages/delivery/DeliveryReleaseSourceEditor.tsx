import { Alert, Button, Drawer, Input, Radio, Select, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { installExecutionExitGuard } from "@/lib/executionExitGuard";
import { createReleaseSourceDraftStore, releaseSourceDraftIdentity, releaseSourceMappingProblem,
  type ReleaseSourceDraft, type SourceDraftStatus } from "@/lib/deliveryReleaseSourceDraft";
import { prepareReleaseSourcePacket, releaseProblem, type DeliveryQuality, type ReleasePolicy,
  type ReleaseSourceMapping, type ReleaseSourcePacket } from "@/lib/deliveryRelease";
import { ReleaseDigest } from "./DeliveryReleaseFacts";

export function DeliveryReleaseSourceEditor({ projectId, quality, policy, readOnly, onClose, onExitGuard }: {
  projectId: string; quality: DeliveryQuality; policy: ReleasePolicy; readOnly: boolean; onClose: () => void;
  onExitGuard?: (guard: (() => boolean) | null) => void;
}) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey()), alive = useRef(true), controller = useRef<AbortController | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      if (origin.current !== projectSessionKey()) { controller.current?.abort(); setStale(true); }
    };
    for (const event of ["sop-session", "storage"]) window.addEventListener(event, invalidate);
    return () => {
      alive.current = false; controller.current?.abort();
      for (const event of ["sop-session", "storage"]) window.removeEventListener(event, invalidate);
    };
  }, []);
  const [captured] = useState(() => structuredClone({ quality, policy }));
  const [retained] = useState(() => createReleaseSourceDraftStore(releaseSourceDraftIdentity(projectId, captured.quality, captured.policy)));
  const [draft, setDraft] = useState<ReleaseSourceDraft>(() => retained.draft || { active_task_id: captured.quality.tasks[0]?.id || "", mappings: [] });
  const currentDraft = useRef(draft), unsafe = useRef(false);
  const [draftStatus, setDraftStatus] = useState<SourceDraftStatus>(retained.status);
  const [confirmation, setConfirmation] = useState<"close" | "clear" | null>(null);
  const [packet, setPacket] = useState<ReleaseSourcePacket | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const tasks = captured.quality.tasks;
  const activeTask = draft.active_task_id;
  const mapping = (id: string) => draft.mappings.find((row) => row.task_id === id);
  const ready = (row: ReleaseSourceMapping | undefined) => !releaseSourceMappingProblem(row);
  const readyCount = tasks.filter((task) => ready(mapping(task.id))).length;
  const complete = tasks.length > 0 && readyCount === tasks.length;
  unsafe.current = draft.mappings.length > 0 && !["saved", "restored"].includes(draftStatus);
  useEffect(() => installExecutionExitGuard(window,
    () => unsafe.current && origin.current === projectSessionKey(), () => setConfirmation("close")), []);
  useEffect(() => {
    onExitGuard?.(() => {
      if (!unsafe.current || origin.current !== projectSessionKey()) return true;
      setConfirmation("close"); return false;
    });
    return () => onExitGuard?.(null);
  }, []);
  const persist = (next: ReleaseSourceDraft) => {
    if (origin.current !== projectSessionKey() || !alive.current || busy) return;
    currentDraft.current = next; setDraft(next);
    const saved = retained.save(next);
    unsafe.current = next.mappings.length > 0 && !saved;
    setDraftStatus(saved ? "saved" : "unavailable");
    setConfirmation(null);
  };
  const selectTask = (id: string) => {
    if (tasks.some((task) => task.id === id)) persist({ ...currentDraft.current, active_task_id: id });
  };
  const requestClose = () => {
    if (busy) return;
    if (unsafe.current) setConfirmation("close");
    else onClose();
  };
  const clear = () => {
    if (busy || readOnly || origin.current !== projectSessionKey()) return;
    if (!retained.clear()) { setDraftStatus("unavailable"); return; }
    const empty = { active_task_id: tasks[0]?.id || "", mappings: [] };
    currentDraft.current = empty; setDraft(empty); setDraftStatus("empty");
    unsafe.current = false;
    setPacket(null); setError(""); setConfirmation(null);
  };
  const nextMissing = () => {
    const at = tasks.findIndex((row) => row.id === activeTask);
    const ordered = [...tasks.slice(at + 1), ...tasks.slice(0, at + 1)];
    const next = ordered.find((task) => !ready(mapping(task.id)));
    if (next) selectTask(next.id);
  };
  const update = (id: string, patch: Partial<ReleaseSourceMapping>) => {
    if (busy || readOnly || origin.current !== projectSessionKey()) return;
    setPacket(null);
    const previous = currentDraft.current;
    const row = { task_id: id, kind: "change" as const, base_commit: null,
      accepted_commit: null, comment: "", ...previous.mappings.find((item) => item.task_id === id), ...patch };
    persist({ ...previous, mappings: [...previous.mappings.filter((item) => item.task_id !== id), row] });
  };
  const prepare = async () => {
    if (busy || readOnly || !complete || !captured.quality.scope_basis) return;
    setBusy(true); setError(""); setPacket(null);
    const request = new AbortController(); controller.current = request;
    try {
      if (origin.current !== projectSessionKey()) throw new Error("scopeChanged");
      const result = await prepareReleaseSourcePacket(projectId, { ...captured.quality.selected,
        scope_basis: captured.quality.scope_basis, policy_generation: captured.policy.generation,
        mappings: tasks.map((task) => mapping(task.id)!) }, request.signal);
      if (!alive.current || origin.current !== projectSessionKey()) return;
      if (result.packet.repository !== captured.policy.repository) throw new Error("scopeChanged");
      setPacket(result.packet);
    } catch (problem) {
      if (!alive.current || origin.current !== projectSessionKey()) return;
      const detail = releaseProblem(problem);
      setError(t(`deliveryReleaseReasons.${detail.code}`, { defaultValue: tr(detail.message) }));
    } finally { if (alive.current) setBusy(false); }
  };
  const download = () => {
    if (!packet || origin.current !== projectSessionKey()) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `source-packet-${projectId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (stale || origin.current !== projectSessionKey()) return <Drawer open title={tr("sourcePrepare")}
    onClose={onClose}><Alert type="warning" showIcon title={tr("scopeChanged")} /></Drawer>;
  return <Drawer open title={tr("sourcePrepare")} size="min(820px, 100vw)" rootClassName="delivery-release-drawer"
    onClose={requestClose} closable={!busy} mask={{ closable: !busy }} keyboard={!busy}
    footer={<div className="delivery-release-actions">
      <span role="status">{t("deliveryRelease.sourceCoverage", { ready: readyCount, total: tasks.length })}</span>
      <Button disabled={busy} onClick={requestClose}>{tr("close")}</Button>
      <Button disabled={busy || readOnly || (!draft.mappings.length && !["invalid", "unavailable"].includes(draftStatus))} onClick={() => setConfirmation("clear")}>{tr("sourceDraftClear")}</Button>
      <Button type="primary" disabled={readOnly || !complete || busy} loading={busy} onClick={prepare}>{tr("sourceGenerate")}</Button>
      <Button disabled={!packet || busy || readOnly} onClick={download}>{tr("sourceDownload")}</Button>
    </div>}>
    <div className="delivery-release-form">
      <Alert type="info" showIcon title={tr("sourceProposalHint")} />
      <p className="delivery-release-meta" role="status">{tr(draftStatus === "saved" ? "sourceDraftSaved" : draftStatus === "restored" ? "sourceDraftRestored" : "sourceDraftHint")}</p>
      {["unavailable", "invalid"].includes(draftStatus) && <Alert type="warning" showIcon
        title={tr(draftStatus === "invalid" ? "sourceDraftInvalid" : "sourceDraftUnavailable")} />}
      {confirmation && <Alert type="warning" showIcon role="alert" title={tr(confirmation === "clear" ? "sourceDraftClearConfirm" : "sourceDraftCloseConfirm")}
        action={<div className="delivery-release-actions">
          <Button onClick={() => setConfirmation(null)}>{tr("sourceDraftContinue")}</Button>
          <Button danger disabled={busy || (confirmation === "clear" && readOnly)} onClick={confirmation === "clear" ? clear : onClose}>{tr(confirmation === "clear" ? "sourceDraftClear" : "sourceDraftDiscardClose")}</Button>
        </div>} />}
      <p className="delivery-release-id">{captured.policy.repository}</p>
      <ReleaseDigest title={tr("scopeBasis")} value={captured.quality.scope_basis} />
      {error && <Alert type="error" showIcon title={tr("sourcePrepareFailed")} description={error} />}
      {packet && <Alert type="info" showIcon title={tr("sourcePrepared")} />}
      <div className="delivery-release-source-navigation">
        <Select showSearch optionFilterProp="label" aria-label={tr("sourceSelectTask")} value={activeTask}
          disabled={busy} onChange={selectTask} options={tasks.map((task, index) => ({
            value: task.id, label: `${index + 1}. ${task.title} · ${task.id} · ${tr(ready(mapping(task.id)) ? "sourceFormComplete" : "sourceFormMissing")}`,
          }))} />
        <Button disabled={busy || complete} onClick={nextMissing}>{tr("sourceNextMissing")}</Button>
      </div>
      {tasks.filter((task) => task.id === activeTask).map((task) => {
        const index = tasks.findIndex((row) => row.id === task.id);
        const row = mapping(task.id), problem = releaseSourceMappingProblem(row), helpId = `release-source-${index}-help`;
        return <fieldset className="delivery-release-source-task" key={task.id} disabled={busy || readOnly}>
          <legend>{index + 1}. {task.title} <Tag>{task.id}</Tag></legend>
          <p className="delivery-release-meta">{tr("sourceAcceptedProof")}: {task.proof.source} · {task.proof.id || task.proof.basis || "—"}</p>
          <Radio.Group aria-label={`${task.title}: ${tr("sourceKind")}`} aria-describedby={helpId} value={row?.kind || null}
            onChange={(event) => update(task.id, { kind: event.target.value, base_commit: null, accepted_commit: null })}>
            <Radio value="change">{tr("sourceCodeChange")}</Radio><Radio value="no_code_change">{tr("sourceNoCode")}</Radio>
          </Radio.Group>
          {row?.kind === "change" && <div className="delivery-release-source-commits">
            <label><span>{tr("sourceBaseCommit")}</span><Input aria-label={`${task.id}: ${tr("sourceBaseCommit")}`}
              aria-describedby={helpId} aria-invalid={problem === "sourceBaseInvalid"} status={problem === "sourceBaseInvalid" ? "error" : undefined}
              value={row.base_commit || ""} maxLength={64} spellCheck={false} onChange={(event) => update(task.id, { base_commit: event.target.value.trim() })} /></label>
            <label><span>{tr("sourceAcceptedCommit")}</span><Input aria-label={`${task.id}: ${tr("sourceAcceptedCommit")}`}
              aria-describedby={helpId} aria-invalid={["sourceAcceptedInvalid", "sourceSameCommit", "sourceCommitFormatMismatch"].includes(problem || "")}
              status={["sourceAcceptedInvalid", "sourceSameCommit", "sourceCommitFormatMismatch"].includes(problem || "") ? "error" : undefined}
              value={row.accepted_commit || ""} maxLength={64} spellCheck={false} onChange={(event) => update(task.id, { accepted_commit: event.target.value.trim() })} /></label>
          </div>}
          {row && <label><span>{tr(row.kind === "no_code_change" ? "sourceNoCodeReason" : "sourceComment")}</span>
            <Input.TextArea aria-label={`${task.id}: ${tr(row.kind === "no_code_change" ? "sourceNoCodeReason" : "sourceComment")}`}
              aria-describedby={helpId} aria-invalid={["sourceReasonRequired", "sourceReasonInvalid"].includes(problem || "")}
              status={["sourceReasonRequired", "sourceReasonInvalid"].includes(problem || "") ? "error" : undefined}
              value={row.comment} maxLength={4000} rows={3}
              onChange={(event) => update(task.id, { comment: event.target.value })} /></label>}
          <p className="delivery-release-source-help" id={helpId} role="status">{tr(problem || "sourceFormComplete")}</p>
        </fieldset>;
      })}
    </div>
  </Drawer>;
}
