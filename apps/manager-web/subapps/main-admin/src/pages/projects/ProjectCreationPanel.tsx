import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useProjectCreation } from "@/lib/useProjectCreation";
import type { ProjectCreationAck } from "@/lib/projectCreation";

export function ProjectCreationPanel({ creation, open, onClose, businesses, businessesReady, canCreate, onRetryReads, onCreated }: {
  creation: ReturnType<typeof useProjectCreation>; open: boolean; onClose: () => void;
  businesses: { id: string; name: string }[]; businessesReady: boolean; canCreate: boolean;
  onRetryReads: () => void; onCreated: (ack: ProjectCreationAck, target: "project" | "team" | "requirements") => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`projectPortfolio.${key}`);
  const { state } = creation;
  const access = useRef({ canCreate, businessesReady, businesses }); access.current = { canCreate, businessesReady, businesses };
  const [notice, setNotice] = useState("");
  const editing = state.phase === "editing" && ["saved", "unavailable"].includes(state.local) && creation.current();
  const close = () => {
    if (creation.snapshot().unsaved || creation.snapshot().phase === "sending") { setNotice(tr("creationSaveBeforeClose")); return; }
    setNotice(""); onClose();
  };
  const create = () => {
    if (!creation.current() || !access.current.canCreate) return;
    const business = creation.snapshot().draft.business_id;
    if (business && (!access.current.businessesReady || !access.current.businesses.some((b) => b.id === business))) return;
    void creation.create();
  };
  const finish = (target: "project" | "team" | "requirements") => {
    const latest = creation.snapshot();
    if (!creation.current() || latest.phase !== "succeeded" || latest.unsaved || !latest.ack) return;
    const ack = latest.ack;
    if (creation.clear()) onCreated(ack, target);
  };
  const phaseKey = state.phase === "editing" ? state.local === "saved" ? "creationDraftSaved" : "creationDraft" : state.phase === "succeeded" ? "creationConfirmed" : state.phase === "refused" ? "saveFailed" : state.phase === "sending" ? "saving" : "creationUnknown";
  const blockedLocal = !["saved"].includes(state.local);
  return <Modal open={open} title={tr("create")} className="project-portfolio-modal" width={640} destroyOnHidden
    maskClosable={false} closable={state.phase !== "sending" && !state.unsaved} keyboard={state.phase !== "sending" && !state.unsaved}
    onCancel={close} footer={<>
      <Button onClick={close} disabled={state.phase === "sending" || state.unsaved}>{tr("creationClose")}</Button>
      {state.phase === "editing" && <Popconfirm title={tr("creationDiscardConfirm")} onConfirm={() => { if (creation.clear()) onClose(); }} okText={tr("creationDiscard")} cancelText={tr("cancel")}>
        <Button danger disabled={!editing}>{tr("creationDiscard")}</Button>
      </Popconfirm>}
      {state.phase === "refused" && <Button onClick={() => creation.revise()} disabled={blockedLocal}>{tr("creationRevise")}</Button>}
      {state.phase === "unknown" && <Button type="primary" data-action="replay-creation" disabled={blockedLocal || !state.original} onClick={() => void creation.replay()}>{tr("retryOriginal")}</Button>}
      {state.phase === "editing" && <Button type="primary" data-action="create-project" onClick={create} disabled={!editing || blockedLocal || !canCreate || !state.draft.name.trim() || !!state.draft.business_id && (!businessesReady || !businesses.some((b) => b.id === state.draft.business_id))}>{tr("create")}</Button>}
    </>}>
    <div className="project-creation-content">
      <Alert type={state.phase === "succeeded" ? "success" : state.phase === "unknown" || state.phase === "refused" ? "warning" : "info"} showIcon title={tr(phaseKey)}
        description={tr(state.phase === "unknown" ? "creationUnknownHint" : state.phase === "succeeded" ? "creationNextHint" : "creationHint")} />
      {state.local !== "saved" && <Alert role="status" type="warning" showIcon title={tr(`creationLocal.${state.local}`)}
        action={["busy", "invalid", "conflict", "opening"].includes(state.local) ? undefined : <Button onClick={() => creation.retryStorage()}>{tr("creationRetryStorage")}</Button>} />}
      {(state.error || notice) && <Alert type="warning" title={notice || state.error} />}
      {state.original && <small className="project-portfolio-id">{tr("originalOperation")} · {state.original.idempotency_key}</small>}
      {state.phase === "succeeded" && state.ack ? <section className="project-creation-next" aria-label={tr("creationNext")}>
        <strong>{state.original?.name}</strong><span className="project-portfolio-id">{state.ack.id}</span>
        <Tag>{tr(state.draft.status)}</Tag>
        <div className="project-portfolio-actions">
          <Button type="primary" data-action="creation-team" disabled={state.unsaved} onClick={() => finish("team")}>{tr("creationTeam")}</Button>
          <Button data-action="creation-requirements" disabled={state.unsaved} onClick={() => finish("requirements")}>{tr("creationRequirements")}</Button>
          <Button data-action="creation-project" disabled={state.unsaved} onClick={() => finish("project")}>{tr("inspect")}</Button>
        </div>
      </section> : <Form layout="vertical">
        <Form.Item required label={tr("name")}><Input aria-label={tr("name")} autoFocus value={state.draft.name} maxLength={128} showCount disabled={!editing} onChange={(event) => creation.edit({ name: event.target.value })} /></Form.Item>
        <Form.Item label={tr("description")}><Input.TextArea aria-label={tr("description")} value={state.draft.description} rows={3} maxLength={20000} showCount disabled={!editing} onChange={(event) => creation.edit({ description: event.target.value })} /></Form.Item>
        <div className="project-creation-grid">
          <Form.Item label={tr("business")}><Select aria-label={tr("business")} value={state.draft.business_id} disabled={!editing || !businessesReady} showSearch optionFilterProp="label"
            onChange={(business_id) => creation.edit({ business_id })} options={[{ value: "", label: tr("noBusiness") }, ...businesses.map((b) => ({ value: b.id, label: b.name }))]} /></Form.Item>
          <Form.Item label={tr("status")}><Select aria-label={tr("status")} value={state.draft.status} disabled={!editing} onChange={(status) => creation.edit({ status })}
            options={["planning", "active", "paused"].map((status) => ({ value: status, label: tr(status) }))} /></Form.Item>
        </div>
        <Form.Item label={tr("path")} extra={tr("creationPathHint")}><Input aria-label={tr("path")} value={state.draft.project_path} maxLength={512} disabled={!editing} onChange={(event) => creation.edit({ project_path: event.target.value })} /></Form.Item>
        {(!businessesReady || !canCreate) && <Alert type="warning" showIcon title={tr(!businessesReady ? "selectorFailed" : "creationPermission")} action={<Button onClick={onRetryReads}>{tr("refresh")}</Button>} />}
      </Form>}
    </div>
  </Modal>;
}
