import { Alert, Button, Drawer, Input, Radio, Select, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { prepareReleaseSourcePacket, releaseProblem, type DeliveryQuality, type ReleasePolicy,
  type ReleaseSourceMapping, type ReleaseSourcePacket } from "@/lib/deliveryRelease";
import { ReleaseDigest } from "./DeliveryReleaseFacts";

export function DeliveryReleaseSourceEditor({ projectId, quality, policy, readOnly, onClose }: {
  projectId: string; quality: DeliveryQuality; policy: ReleasePolicy; readOnly: boolean; onClose: () => void;
}) {
  const { t } = useTranslation(), tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey()), alive = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const [captured] = useState(() => structuredClone({ quality, policy }));
  const [mappings, setMappings] = useState<Record<string, ReleaseSourceMapping>>({});
  const [packet, setPacket] = useState<ReleaseSourcePacket | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const tasks = captured.quality.tasks;
  const [activeTask, setActiveTask] = useState(tasks[0]?.id || "");
  const ready = (row: ReleaseSourceMapping | undefined) => Boolean(
    row && row.comment.trim() && (row.kind === "no_code_change" || (row.kind === "change" &&
      (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.base_commit || "") &&
       /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.accepted_commit || "") && row.base_commit !== row.accepted_commit &&
       row.base_commit?.length === row.accepted_commit?.length))));
  const readyCount = tasks.filter((task) => ready(mappings[task.id])).length;
  const complete = tasks.length > 0 && readyCount === tasks.length;
  const nextMissing = () => {
    const at = tasks.findIndex((row) => row.id === activeTask);
    const ordered = [...tasks.slice(at + 1), ...tasks.slice(0, at + 1)];
    const next = ordered.find((task) => !ready(mappings[task.id]));
    if (next) setActiveTask(next.id);
  };
  const update = (id: string, patch: Partial<ReleaseSourceMapping>) => {
    setPacket(null);
    setMappings((rows) => ({ ...rows, [id]: { task_id: id, kind: "change", base_commit: null,
      accepted_commit: null, comment: "", ...rows[id], ...patch } }));
  };
  const prepare = async () => {
    if (busy || readOnly || !complete || !captured.quality.scope_basis) return;
    setBusy(true); setError(""); setPacket(null);
    const request = new AbortController(); controller.current = request;
    try {
      if (origin.current !== projectSessionKey()) throw new Error("scopeChanged");
      const result = await prepareReleaseSourcePacket(projectId, { ...captured.quality.selected,
        scope_basis: captured.quality.scope_basis, policy_generation: captured.policy.generation,
        mappings: tasks.map((task) => mappings[task.id]) }, request.signal);
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
  return <Drawer open title={tr("sourcePrepare")} size="min(820px, 100vw)" rootClassName="delivery-release-drawer"
    onClose={() => { if (!busy) onClose(); }} closable={!busy} maskClosable={!busy}
    footer={<div className="delivery-release-actions">
      <span role="status">{t("deliveryRelease.sourceCoverage", { ready: readyCount, total: tasks.length })}</span>
      <Button disabled={busy} onClick={onClose}>{tr("close")}</Button>
      <Button type="primary" disabled={readOnly || !complete || busy} loading={busy} onClick={prepare}>{tr("sourceGenerate")}</Button>
      <Button disabled={!packet || busy || readOnly} onClick={download}>{tr("sourceDownload")}</Button>
    </div>}>
    <div className="delivery-release-form">
      <Alert type="info" showIcon title={tr("sourceProposalHint")} />
      <p className="delivery-release-id">{captured.policy.repository}</p>
      <ReleaseDigest title={tr("scopeBasis")} value={captured.quality.scope_basis} />
      {error && <Alert type="error" showIcon title={tr("sourcePrepareFailed")} description={error} />}
      {packet && <Alert type="info" showIcon title={tr("sourcePrepared")} />}
      <div className="delivery-release-source-navigation">
        <Select showSearch optionFilterProp="label" aria-label={tr("sourceSelectTask")} value={activeTask}
          disabled={busy} onChange={setActiveTask} options={tasks.map((task, index) => ({
            value: task.id, label: `${index + 1}. ${task.title} · ${task.id} · ${tr(ready(mappings[task.id]) ? "sourceFormComplete" : "sourceFormMissing")}`,
          }))} />
        <Button disabled={busy || complete} onClick={nextMissing}>{tr("sourceNextMissing")}</Button>
      </div>
      {tasks.filter((task) => task.id === activeTask).map((task) => {
        const index = tasks.findIndex((row) => row.id === task.id);
        const row = mappings[task.id];
        return <fieldset className="delivery-release-source-task" key={task.id} disabled={busy}>
          <legend>{index + 1}. {task.title} <Tag>{task.id}</Tag></legend>
          <p className="delivery-release-meta">{tr("sourceAcceptedProof")}: {task.proof.source} · {task.proof.id || task.proof.basis || "—"}</p>
          <Radio.Group aria-label={`${task.title}: ${tr("sourceKind")}`} value={row?.kind || null}
            onChange={(event) => update(task.id, { kind: event.target.value, base_commit: null, accepted_commit: null })}>
            <Radio value="change">{tr("sourceCodeChange")}</Radio><Radio value="no_code_change">{tr("sourceNoCode")}</Radio>
          </Radio.Group>
          {row?.kind === "change" && <div className="delivery-release-source-commits">
            <label><span>{tr("sourceBaseCommit")}</span><Input aria-label={`${task.id}: ${tr("sourceBaseCommit")}`}
              value={row.base_commit || ""} maxLength={64} spellCheck={false} onChange={(event) => update(task.id, { base_commit: event.target.value.trim() })} /></label>
            <label><span>{tr("sourceAcceptedCommit")}</span><Input aria-label={`${task.id}: ${tr("sourceAcceptedCommit")}`}
              value={row.accepted_commit || ""} maxLength={64} spellCheck={false} onChange={(event) => update(task.id, { accepted_commit: event.target.value.trim() })} /></label>
          </div>}
          {row && <label><span>{tr(row.kind === "no_code_change" ? "sourceNoCodeReason" : "sourceComment")}</span>
            <Input aria-label={`${task.id}: ${tr("sourceComment")}`} value={row.comment} maxLength={4000}
              onChange={(event) => update(task.id, { comment: event.target.value })} /></label>}
        </fieldset>;
      })}
    </div>
  </Drawer>;
}
