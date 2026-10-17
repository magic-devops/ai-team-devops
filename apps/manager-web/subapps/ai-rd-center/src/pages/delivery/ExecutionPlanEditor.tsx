import { Alert, Button, Collapse, Modal, Select, Space, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchDelivery,
  saveDelivery,
  type DeliveryWorkspace,
} from "@/lib/delivery";
import {
  adoptExecutionDraft,
  fetchDeliveryTargets,
  executionTargetProblems,
  prepareExecution,
  previewDeliveryExecution,
  type DeliveryTargets,
  type ExecutionDraftSession,
  type ExecutionTarget,
} from "@/lib/deliveryExecution";
import { commandDraft } from "@/lib/executionCommands";
import { ExecutionCommandEditor } from "./ExecutionCommandEditor";
import { ExecutionTargetFacts } from "./ExecutionTargetFacts";
import { ExecutionPolicyEditor } from "./ExecutionPolicyEditor";

export function ExecutionPlanEditor({
  initial,
  initialTargets,
  canConfigure,
  onClose,
  onSaved,
}: {
  initial: ExecutionDraftSession;
  initialTargets: DeliveryTargets;
  canConfigure: boolean;
  onClose: () => void;
  onSaved: (data: DeliveryWorkspace) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const [draft, setDraft] = useState(initial);
  const [targets, setTargets] = useState(initialTargets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<{
    workspace: DeliveryWorkspace;
    targets: DeliveryTargets;
    adopted: ExecutionDraftSession;
  }>();
  const [policyTarget, setPolicyTarget] = useState<ExecutionTarget>();
  const workspace = targets.workspaces.find(
    (item) => item.id === draft.workspaceId,
  );
  const change = (values: Partial<ExecutionDraftSession>) => {
    setDraft((current) => ({ ...current, ...values, preview: null }));
    setCandidate(undefined);
  };
  const fail = (failure: unknown) => {
    const message = (failure as Error).message;
    setError(message);
    if (message.includes("409")) setConflict(true);
    setCandidate(undefined);
  };
  async function preview() {
    setBusy(true);
    setError("");
    try {
      const prepared = prepareExecution(draft);
      setDraft(prepared.session);
      const result = await previewDeliveryExecution(
        draft.projectId,
        prepared.payload,
      );
      if (
        result.version !== draft.intent.version ||
        result.task_basis !== draft.taskBasis ||
        result.target.basis !== draft.target?.basis
      )
        throw new Error("409: basis changed");
      setDraft({ ...prepared.session, preview: result });
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft.preview) return;
    setBusy(true);
    setError("");
    try {
      const prepared = prepareExecution(draft);
      const result = await saveDelivery(
        draft.projectId,
        "execution.queue",
        prepared.payload,
        prepared.version,
        prepared.key,
      );
      onSaved(result);
      onClose();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }
  async function readLatest() {
    setCandidate(undefined);
    setBusy(true);
    setError("");
    try {
      const [latestWorkspace, latestTargets] = await Promise.all([
        fetchDelivery(draft.projectId),
        fetchDeliveryTargets(draft.projectId),
      ]);
      const adopted = adoptExecutionDraft(
        draft,
        latestWorkspace,
        latestTargets,
        crypto.randomUUID(),
      );
      setCandidate({
        workspace: latestWorkspace,
        targets: latestTargets,
        adopted,
      });
    } catch (failure) {
      setCandidate(undefined);
      setError(`${tr("retryRead")} ${(failure as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const allTargets = workspace ? [workspace.local, ...workspace.devices] : [];
  const selectedProvider = workspace?.agents.find(
    (agent) => agent.id === draft.agentId,
  )?.provider;
  const targetProblems = draft.target
    ? executionTargetProblems(
        draft.target,
        draft.mode,
        selectedProvider,
        Boolean(draft.commands.length),
      )
    : [];
  const latestTask = candidate?.workspace.tasks.find(
    (task) => task.id === draft.taskId,
  );
  const latestRequirement = candidate?.workspace.requirements.find(
    (requirement) => requirement.id === latestTask?.req_id,
  );

  return (
    <>
      <Modal
        open
        title={tr("planTitle")}
        width={760}
        className="delivery-editor runtime-editor"
        onCancel={() => !busy && !policyTarget && onClose()}
        closable={!busy}
        keyboard={!busy}
        maskClosable={!busy}
        footer={
          <Space wrap>
            <Button disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={busy}
              disabled={
                conflict ||
                Boolean(policyTarget) ||
                !draft.target ||
                targetProblems.length > 0
              }
              onClick={() => void preview()}
            >
              {tr("preview")}
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={!draft.preview || conflict || Boolean(policyTarget)}
              onClick={() => void save()}
            >
              {tr("save")}
            </Button>
          </Space>
        }
      >
        <p className="runtime-help">{tr("selectFirst")}</p>
        {error && (
          <Alert
            role="alert"
            type="error"
            title={
              conflict
                ? tr("conflict")
                : tr(error) === `deliveryRuntime.${error}`
                  ? error
                  : tr(error)
            }
          />
        )}
        <div className="runtime-plan-selectors">
          <label>
            {tr("workspace")}
            <Select
              aria-label={tr("workspace")}
              disabled={busy}
              value={draft.workspaceId || undefined}
              options={targets.workspaces.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={(workspaceId) =>
                change({ workspaceId, agentId: "", target: null })
              }
            />
          </label>
          <label>
            {tr("mode")}
            <Select
              aria-label={tr("mode")}
              disabled={busy}
              value={draft.mode}
              options={[
                { value: "agent", label: tr("agent") },
                { value: "command", label: tr("command") },
              ]}
              onChange={(mode) =>
                change({
                  mode,
                  agentId: "",
                  target: null,
                  commands: draft.commands.length
                    ? draft.commands
                    : mode === "command"
                      ? [commandDraft("tests")]
                      : [],
                })
              }
            />
          </label>
          {draft.mode === "agent" && (
            <label>
              {tr("agentProfile")}
              <Select
                aria-label={tr("agentProfile")}
                disabled={busy || !workspace}
                value={draft.agentId || undefined}
                options={workspace?.agents.map((agent) => ({
                  value: agent.id,
                  label: `${agent.title} · ${agent.provider} · v${agent.version}`,
                }))}
                onChange={(agentId) =>
                  change({
                    agentId,
                    agentVersion:
                      workspace?.agents.find((item) => item.id === agentId)
                        ?.version || 1,
                    target: null,
                  })
                }
              />
            </label>
          )}
          <label>
            {tr("target")}
            <Select
              aria-label={tr("target")}
              disabled={
                busy || !workspace || (draft.mode === "agent" && !draft.agentId)
              }
              value={
                draft.target
                  ? `${draft.target.kind}:${draft.target.id}`
                  : undefined
              }
              options={allTargets.map((target) => ({
                value: `${target.kind}:${target.id}`,
                label: `${target.kind === "local" ? tr("local") : target.name} · ${target.kind === "local" ? (target.can_execute ? tr("configured") : tr("unsupported")) : tr(target.online ? "online" : "offline")}`,
              }))}
              onChange={(value) =>
                change({
                  target: structuredClone(
                    allTargets.find(
                      (item) => `${item.kind}:${item.id}` === value,
                    ) || null,
                  ),
                })
              }
            />
          </label>
        </div>
        {draft.target && (
          <ExecutionTargetFacts
            target={{ ...draft.target, reason_codes: targetProblems }}
          />
        )}
        {canConfigure && workspace && workspace.devices.length > 0 && (
          <Collapse
            size="small"
            ghost
            items={[
              {
                key: "policy",
                label: tr("policy"),
                children: (
                  <div className="runtime-policy-devices">
                    {workspace.devices.map((device) => (
                      <div key={device.id}>
                        <span>{device.name}</span>
                        <Button
                          size="small"
                          disabled={
                            busy ||
                            device.reason_codes.includes("device_revoked")
                          }
                          onClick={() => setPolicyTarget(device)}
                        >
                          {tr("policy")}
                        </Button>
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        )}
        <ExecutionCommandEditor
          rows={draft.commands}
          agent={draft.mode === "agent"}
          disabled={busy}
          onChange={(commands) => change({ commands })}
        />
        <p className="runtime-help">{tr("previewRequired")}</p>
        {draft.preview && (
          <section className="runtime-plan-preview">
            <Alert type="success" title={tr("planReady")} />
            <strong>
              {tr("pinned")} · {tr("version")} {draft.preview.snapshot.revision}
            </strong>
            <h4>{draft.preview.snapshot.title}</h4>
            <ul>
              {draft.preview.snapshot.acceptance_criteria.map(
                (criterion, index) => (
                  <li key={index}>{criterion}</li>
                ),
              )}
            </ul>
            <div className="runtime-node-chips">
              {draft.preview.nodes.map((node) => (
                <Tag
                  key={node.id}
                  color={
                    draft.preview!.test_node_ids.includes(node.id)
                      ? "blue"
                      : "default"
                  }
                >
                  {node.title || node.id} · {node.kind}
                </Tag>
              ))}
            </div>
          </section>
        )}
        {conflict && (
          <section className="runtime-conflict">
            <Button loading={busy} onClick={() => void readLatest()}>
              {tr("readLatest")}
            </Button>
            {candidate && (
              <>
                <p>
                  {tr("latestReady")} · v{candidate.workspace.version}
                </p>
                <strong>{latestTask?.title}</strong>
                <p className="runtime-help">{latestTask?.description}</p>
                {latestRequirement && (
                  <>
                    <p>
                      {latestRequirement.title} · {tr("version")}{" "}
                      {latestRequirement.flow.revision}
                    </p>
                    <ul>
                      {latestRequirement.acceptance_criteria.map(
                        (criterion, index) => (
                          <li key={index}>{criterion}</li>
                        ),
                      )}
                    </ul>
                  </>
                )}
                <ExecutionTargetFacts target={candidate.adopted.target!} />
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(candidate.adopted);
                    setTargets(candidate.targets);
                    setCandidate(undefined);
                    setConflict(false);
                    setError("");
                  }}
                >
                  {tr("adopt")}
                </Button>
              </>
            )}
          </section>
        )}
      </Modal>
      {policyTarget && workspace && (
        <ExecutionPolicyEditor
          key={`${workspace.id}:${policyTarget.id}`}
          projectId={draft.projectId}
          workspaceId={workspace.id}
          target={policyTarget}
          onClose={() => setPolicyTarget(undefined)}
          onSaved={() => {
            change({ target: null });
            setConflict(false);
            void fetchDeliveryTargets(draft.projectId)
              .then(setTargets)
              .catch(fail);
          }}
        />
      )}
    </>
  );
}
