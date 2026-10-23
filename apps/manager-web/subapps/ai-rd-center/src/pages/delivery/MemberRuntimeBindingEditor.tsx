import { Alert, Button, Modal, Select, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import type { RuntimeBindingCommand } from "@/lib/runtimeBindingCommand";
import { RuntimeBindingRecovery } from "./RuntimeBindingRecovery";
import {
  adoptRuntimeBindingDraft,
  changeBindingWorkspace,
  fetchTeamRuntimeBindings,
  prepareRuntimeBinding,
  type RuntimeBindingDraft,
  type TeamRuntimeBindings,
} from "@/lib/deliveryTeamRuntime";
import { RuntimeBindingFacts } from "./ExecutionExecutorFacts";
import { planError } from "@/lib/deliveryTaskPlan";

export function MemberRuntimeBindingEditor({
  initial,
  initialCatalogue,
  memberName,
  command,
  isActive,
  canSubmit,
  onClose,
  onSaved,
}: {
  initial: RuntimeBindingDraft;
  initialCatalogue: TeamRuntimeBindings;
  memberName: string;
  command: RuntimeBindingCommand;
  isActive: () => boolean;
  canSubmit: (operation: RuntimeBindingDraft["operation"]) => boolean;
  onClose: () => void;
  onSaved: (workspace: DeliveryCommandAck) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const [draft, setDraft] = useState(initial);
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<TeamRuntimeBindings>();
  const mounted = useRef(true), pending = useRef(false);
  const identity = JSON.stringify([initial.projectId, initial.memberId, initial.intent.key]), live = useRef(identity); live.current = identity;
  const access = useRef({ command, isActive, canSubmit, onSaved, onClose }); access.current = { command, isActive, canSubmit, onSaved, onClose };
  const draftRef = useRef(draft); draftRef.current = draft;
  const catalogueRef = useRef(catalogue); catalogueRef.current = catalogue;
  const changeDraft = (next: RuntimeBindingDraft) => { draftRef.current = next; setDraft(next); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && live.current === identity && access.current.command.snapshot === command.snapshot && command.current() && access.current.isActive();
  const available = () => current() && access.current.canSubmit(draftRef.current.operation);
  const phase = command.state.phase, locked = busy || command.locked;
  const row = catalogue.members.find(
    (item) => item.member_id === draft.memberId,
  );
  const latest = candidate?.members.find(
    (item) => item.member_id === draft.memberId,
  );
  const workspace = catalogue.workspaces.find(
    (item) => item.id === draft.workspaceId,
  );
  const fail = (failure: unknown) => {
    if (!current()) return;
    const message = (failure as Error).message;
    const parsed = planError(failure);
    setError(
      parsed.code && /^(runtime_|executor_)/.test(parsed.code)
        ? `reasons.${parsed.code}`
        : parsed.message,
    );
    setCandidate(undefined);
    if (message.includes("409")) setConflict(true);
  };
  const close = () => {
    if (pending.current || busy || !current()) return;
    if (command.snapshot().phase === "refused") command.reset();
    if (command.snapshot().phase === "idle" && !command.snapshot().error) access.current.onClose();
  };
  const save = async () => {
    if (pending.current || busy || conflict || !available() || command.snapshot().phase !== "idle" || command.snapshot().error === "retainedOriginalUnavailable") return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const prepared = prepareRuntimeBinding(draftRef.current, catalogueRef.current);
      changeDraft(prepared.draft);
      const result = await command.run({ action: prepared.action, payload: prepared.payload, intent: { version: prepared.version, key: prepared.key } });
      if (!current()) return;
      if (result) {
        await access.current.onSaved(result);
        if (!current()) return;
        command.reset(); if (command.snapshot().phase === "idle") access.current.onClose();
      } else if (command.snapshot().phase === "refused") {
        setConflict(true); setCandidate(undefined);
      }
    } catch (failure) {
      fail(failure);
    } finally {
      pending.current = false; if (mounted.current) setBusy(false);
    }
  };
  const readLatest = async () => {
    if (pending.current || busy || !available() || !["idle", "refused"].includes(command.snapshot().phase)) return;
    pending.current = true;
    setCandidate(undefined);
    setBusy(true);
    setError("");
    try {
      const result = await fetchTeamRuntimeBindings(draft.projectId);
      if (!available()) return;
      setCandidate(result);
    } catch (failure) {
      fail(failure);
    } finally {
      pending.current = false; if (mounted.current) setBusy(false);
    }
  };
  const profileValue = draft.agentId
    ? `${draft.agentId}:${draft.agentVersion}`
    : undefined;
  const options = (workspace?.agents || []).map((agent) => ({
    value: `${agent.id}:${agent.version}`,
    label: `${agent.title} · ${agent.provider} · v${agent.version}`,
    disabled: false,
  }));
  if (profileValue && !options.some((item) => item.value === profileValue))
    options.push({
      value: profileValue,
      label: `${row?.binding?.source.agent_title || draft.agentId} · v${draft.agentVersion} · ${tr("unavailableProfile")}`,
      disabled: true,
    });
  const workspaces = catalogue.workspaces.map((item) => ({
    value: item.id,
    label: `${item.name} · ${item.id}`,
    disabled: false,
  }));
  if (
    draft.workspaceId &&
    !workspaces.some((item) => item.value === draft.workspaceId)
  )
    workspaces.push({
      value: draft.workspaceId,
      label: `${row?.binding?.source.workspace_name || draft.workspaceId} · ${tr("unavailableProfile")}`,
      disabled: true,
    });
  return (
    <Modal
      open
      title={tr(draft.operation === "unbind" ? "unbindTitle" : "bind")}
      width={620}
      className="delivery-editor team-runtime-editor"
      onCancel={close}
      closable={!locked}
      keyboard={!locked}
      maskClosable={false}
      footer={
        <Space wrap>
          <Button disabled={locked} onClick={close}>
            {tr("cancel")}
          </Button>
          <Button
            type="primary"
            danger={draft.operation === "unbind"}
            loading={busy}
            disabled={locked || conflict || phase !== "idle" || !available()}
            onClick={() => void save()}
          >
            {tr(draft.operation === "unbind" ? "unbind" : "save")}
          </Button>
        </Space>
      }
    >
      <strong>{memberName}</strong>
      <code className="runtime-identity">{draft.memberId}</code>
      <p className="runtime-help">
        {tr(draft.operation === "unbind" ? "unbindHint" : "intro")}
      </p>
      <RuntimeBindingRecovery projectId={draft.projectId} memberId={draft.memberId} command={command}
        isActive={current} onSaved={(ack) => access.current.onSaved(ack)} onResolved={() => access.current.onClose()}
        onDeferred={() => { if (current()) access.current.onClose(); }} />
      {error && (
        <Alert
          role="alert"
          type="error"
          title={
            conflict
              ? tr("conflict")
              : tr(error) === `deliveryTeamRuntime.${error}`
                ? error
                : tr(error)
          }
        />
      )}
      {row?.binding && (
        <div className="team-runtime-candidate">
          <strong>
            {tr("pinned")} · {tr("generation")} {row.generation}
          </strong>
          <RuntimeBindingFacts binding={row.binding} />
        </div>
      )}
      {draft.operation === "bind" && (
        <>
          {!catalogue.workspaces.length && (
            <Alert type="info" title={tr("noWorkspaces")} />
          )}
          <label>
            {tr("workspace")}
            <Select
              aria-label={tr("workspace")}
              disabled={locked || conflict || phase !== "idle" || !available()}
              value={draft.workspaceId || undefined}
              options={workspaces}
              showSearch
              optionFilterProp="label"
              onChange={(workspaceId) => { if (!pending.current && !locked && !conflict && available() && command.snapshot().phase === "idle") changeDraft(changeBindingWorkspace(draftRef.current, workspaceId)); }}
            />
          </label>
          <label>
            {tr("profile")}
            <Select
              aria-label={tr("profile")}
              disabled={locked || conflict || phase !== "idle" || !available() || !workspace}
              value={profileValue}
              options={options}
              showSearch
              optionFilterProp="label"
              onChange={(value) => {
                if (pending.current || locked || conflict || !available() || command.snapshot().phase !== "idle") return;
                const agent = workspace?.agents.find(
                  (item) => `${item.id}:${item.version}` === value,
                );
                if (agent)
                  changeDraft({
                    ...draftRef.current,
                    agentId: agent.id,
                    agentVersion: agent.version,
                  });
              }}
            />
          </label>
        </>
      )}
      {conflict && ["idle", "refused"].includes(phase) && (
        <section className="team-runtime-candidate">
          <Button loading={busy} disabled={locked || !available()} onClick={() => void readLatest()}>
            {tr("readLatest")}
          </Button>
          {candidate && (
            <>
              <h4>
                {tr("latest")} · v{candidate.version}
              </h4>
              {latest?.binding ? (
                <RuntimeBindingFacts binding={latest.binding} />
              ) : (
                <p>{tr("states.unbound")}</p>
              )}
              <p className="runtime-help">{tr("chooseCurrentProfile")}</p>
              <Button
                disabled={
                  locked || !available() ||
                  !latest?.permissions[
                    draft.operation === "bind" ? "can_bind" : "can_unbind"
                  ]
                }
                onClick={() => {
                  if (pending.current || busy || !available() || !candidate || !["idle", "refused"].includes(command.snapshot().phase)) return;
                  try {
                    const adopted = adoptRuntimeBindingDraft(draftRef.current, candidate, crypto.randomUUID());
                    if (command.snapshot().phase === "refused") command.reset();
                    if (command.snapshot().phase !== "idle" || command.snapshot().error) return;
                    changeDraft(adopted);
                    catalogueRef.current = candidate;
                    setCatalogue(candidate);
                    setCandidate(undefined);
                    setConflict(false);
                    setError("");
                  } catch (failure) {
                    fail(failure);
                  }
                }}
              >
                {tr("adopt")}
              </Button>
            </>
          )}
        </section>
      )}
    </Modal>
  );
}
