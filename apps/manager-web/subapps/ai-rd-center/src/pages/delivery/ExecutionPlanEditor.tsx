import {
  fetchDeliveryTaskEditData,
  type DeliveryCommandAck,
} from "@/lib/deliveryQuery";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Modal,
  Select,
  Space,
  Tag,
} from "antd";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  saveDelivery,
  type DeliveryTaskData,
  type DeliveryMember,
} from "@/lib/delivery";
import {
  fetchTeamRuntimeBindings,
  selectExecutionMember,
  useDirectExecution,
  type TeamRuntimeBindings,
} from "@/lib/deliveryTeamRuntime";
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
import { TaskAcceptanceFacts } from "./TaskAcceptanceFacts";
import { ExecutionAcceptanceSnapshot } from "./ExecutionAcceptanceSnapshot";
import { ExecutionPolicyEditor } from "./ExecutionPolicyEditor";
import { planError } from "@/lib/deliveryTaskPlan";
import {
  ExecutionExecutorFacts,
  RuntimeBindingFacts,
} from "./ExecutionExecutorFacts";

export function ExecutionPlanEditor({
  initial,
  initialTargets,
  canConfigure,
  onClose,
  onSaved,
  members,
  sessionId,
}: {
  initial: ExecutionDraftSession;
  initialTargets: DeliveryTargets;
  canConfigure: boolean;
  onClose: () => void;
  onSaved: (data: DeliveryCommandAck) => void;
  members: DeliveryMember[];
  sessionId: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const tm = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const qc = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [targets, setTargets] = useState(initialTargets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<{
    workspace: DeliveryTaskData;
    targets: DeliveryTargets;
    bindings?: TeamRuntimeBindings;
    adopted?: ExecutionDraftSession;
    recoveryError?: string;
  }>();
  const teamKey = ["delivery-team-runtime", draft.projectId, sessionId];
  const team = useQuery({
    queryKey: teamKey,
    queryFn: ({ signal }) => fetchTeamRuntimeBindings(draft.projectId, signal),
    enabled: draft.mode === "agent",
    retry: false,
    gcTime: 0,
  });
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
    const parsed = planError(failure);
    setError(
      parsed.code && /^(runtime_|executor_)/.test(parsed.code)
        ? `reasons.${parsed.code}`
        : parsed.message,
    );
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
        result.target.basis !== draft.target?.basis ||
        (result.executor_snapshot?.member_id || "") !==
          draft.executorMemberId ||
        (result.executor_snapshot?.binding_basis || "") !==
          draft.executorBindingBasis
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
        fetchDeliveryTaskEditData(draft.projectId, draft.taskId),
        fetchDeliveryTargets(draft.projectId),
      ]);
      const latestBindings = draft.executorMemberId
        ? await fetchTeamRuntimeBindings(draft.projectId)
        : undefined;
      let adopted: ExecutionDraftSession | undefined;
      let recoveryError = "";
      try {
        adopted = adoptExecutionDraft(
          draft,
          latestWorkspace,
          latestTargets,
          crypto.randomUUID(),
          latestBindings,
        );
      } catch (failure) {
        recoveryError = (failure as Error).message;
      }
      setCandidate({
        workspace: latestWorkspace,
        targets: latestTargets,
        adopted,
        bindings: latestBindings,
        recoveryError,
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
  const latestTask = candidate?.workspace.task;
  const latestRequirement = candidate?.workspace.requirement;
  const selectedMember = team.data?.members.find(
    (item) => item.member_id === draft.executorMemberId,
  );
  const executorInvalid = Boolean(
    draft.executorMemberId &&
    (team.isError ||
      !selectedMember?.binding ||
      selectedMember.status !== "current" ||
      selectedMember.binding_basis !== draft.executorBindingBasis ||
      selectedMember.binding.workspace_id !== draft.workspaceId ||
      selectedMember.binding.agent_id !== draft.agentId ||
      selectedMember.binding.agent_version !== draft.agentVersion ||
      !workspace?.agents.some(
        (item) =>
          item.id === draft.agentId && item.version === draft.agentVersion,
      )),
  );
  const memberOptions = [
    { value: "", label: tm("direct"), disabled: false },
    ...(team.data?.members || []).map((item) => ({
      value: item.member_id,
      label: `${members.find((member) => member.id === item.member_id)?.name || item.member_id} · ${item.member_id} · ${tm(`states.${item.status}`)}`,
      disabled: item.status !== "current" || !item.binding,
    })),
  ];
  if (
    draft.executorMemberId &&
    !memberOptions.some((item) => item.value === draft.executorMemberId)
  )
    memberOptions.push({
      value: draft.executorMemberId,
      label: `${tm("missingMember")} · ${draft.executorMemberId}`,
      disabled: true,
    });

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
                executorInvalid ||
                targetProblems.length > 0
              }
              onClick={preview}
            >
              {tr("preview")}
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={
                !draft.preview ||
                conflict ||
                Boolean(policyTarget) ||
                executorInvalid
              }
              onClick={save}
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
                : tm(error) !== `deliveryTeamRuntime.${error}`
                  ? tm(error)
                  : tr(error) === `deliveryRuntime.${error}`
                    ? t(`deliveryExecutionRuntime.${error}`, {
                        defaultValue: error,
                      })
                    : tr(error)
            }
          />
        )}
        {draft.mode === "agent" && (
          <section className="team-runtime-selector">
            <label>
              {tm("optional")}
              <Select
                aria-label={tm("optional")}
                loading={team.isFetching}
                disabled={busy || (!team.data && !draft.executorMemberId)}
                value={draft.executorMemberId}
                showSearch
                optionFilterProp="label"
                options={memberOptions}
                onChange={(id) => {
                  try {
                    if (!id) setDraft(useDirectExecution(draft));
                    else {
                      const row = team.data?.members.find(
                        (item) => item.member_id === id,
                      );
                      if (!row) throw new Error("executorUnavailable");
                      setDraft(selectExecutionMember(draft, row));
                    }
                    setCandidate(undefined);
                  } catch (failure) {
                    fail(failure);
                  }
                }}
              />
            </label>
            {team.isError && (
              <Alert
                type="warning"
                title={tm("catalogueFailed")}
                action={
                  <Button size="small" onClick={() => void team.refetch()}>
                    {tm("retry")}
                  </Button>
                }
              />
            )}
            {draft.executorMemberId && (
              <>
                <code className="runtime-identity">
                  {draft.workspaceId} / {draft.agentId} · v{draft.agentVersion}
                </code>
                <p className="runtime-help">{tm("boundHint")}</p>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    setDraft(useDirectExecution(draft));
                    setCandidate(undefined);
                  }}
                >
                  {tm("useDirect")}
                </Button>
                <p className="runtime-help">{tm("directHint")}</p>
              </>
            )}
            {executorInvalid && (
              <Alert type="warning" title={tm("unavailableSelection")} />
            )}
          </section>
        )}
        <div className="runtime-plan-selectors">
          <label>
            {tr("workspace")}
            <Select
              aria-label={tr("workspace")}
              disabled={busy || Boolean(draft.executorMemberId)}
              value={draft.workspaceId || undefined}
              options={targets.workspaces.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={(workspaceId) =>
                change({
                  workspaceId,
                  agentId: "",
                  target: null,
                  approvalBeforeRun: false,
                })
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
                  approvalBeforeRun: false,
                  executorMemberId: "",
                  executorBindingBasis: "",
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
                disabled={busy || !workspace || Boolean(draft.executorMemberId)}
                value={draft.agentId || undefined}
                options={
                  draft.executorMemberId
                    ? [
                        {
                          value: draft.agentId,
                          label: `${draft.agentId} · v${draft.agentVersion}`,
                        },
                      ]
                    : workspace?.agents.map((agent) => ({
                        value: agent.id,
                        label: `${agent.title} · ${agent.provider} · v${agent.version}`,
                      }))
                }
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
                  approvalBeforeRun: false,
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
        {draft.mode === "command" && draft.target?.kind === "local" && (
          <div className="runtime-approval-choice">
            <Checkbox
              checked={draft.approvalBeforeRun}
              disabled={
                busy ||
                (!draft.approvalBeforeRun && draft.commands.length >= 32)
              }
              onChange={(event) =>
                change({
                  approvalBeforeRun: event.target.checked,
                  approvalTitle: t(
                    "deliveryExecutionRuntime.approvalBeforeRun",
                  ),
                })
              }
            >
              {t("deliveryExecutionRuntime.approvalBeforeRun")}
            </Checkbox>
            <p className="runtime-help">
              {t("deliveryExecutionRuntime.approvalBeforeRunHint")}
            </p>
          </div>
        )}
        <ExecutionCommandEditor
          rows={draft.commands}
          agent={draft.mode === "agent"}
          disabled={busy}
          maxCommands={
            draft.mode === "command" && draft.approvalBeforeRun ? 31 : 32
          }
          onChange={(commands) => change({ commands })}
        />
        <p className="runtime-help">{tr("previewRequired")}</p>
        {draft.preview && (
          <section className="runtime-plan-preview">
            <Alert type="success" title={tr("planReady")} />
            <strong>
              {tr("pinned")} ·{" "}
              {draft.preview.snapshot.requirement
                ? t("deliveryTaskAcceptance.requirementSnapshot", {
                    revision: draft.preview.snapshot.requirement.revision,
                  })
                : t("deliveryTaskAcceptance.ownSnapshot")}
            </strong>
            <h4>{draft.preview.snapshot.title}</h4>
            <ExecutionExecutorFacts
              snapshot={draft.preview.executor_snapshot}
            />
            <ExecutionAcceptanceSnapshot snapshot={draft.preview.snapshot} />
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
                {latestTask && (
                  <TaskAcceptanceFacts acceptance={latestTask.acceptance} />
                )}
                {latestRequirement && (
                  <>
                    <p>
                      {latestRequirement.title} · {tr("version")}{" "}
                      {latestRequirement.flow.revision}
                    </p>
                    <ul>
                      {candidate?.workspace.requirement_definition?.definition.acceptance_criteria.map(
                        (criterion, index) => (
                          <li key={index}>{criterion}</li>
                        ),
                      )}
                    </ul>
                  </>
                )}
                {candidate.bindings?.members.find(
                  (item) => item.member_id === draft.executorMemberId,
                )?.binding && (
                  <RuntimeBindingFacts
                    binding={
                      candidate.bindings.members.find(
                        (item) => item.member_id === draft.executorMemberId,
                      )!.binding!
                    }
                  />
                )}
                {candidate.adopted?.target && (
                  <ExecutionTargetFacts target={candidate.adopted.target} />
                )}
                {candidate.adopted && !candidate.adopted.target && (
                  <p className="runtime-help">{tm("changedSelection")}</p>
                )}
                {candidate.recoveryError && (
                  <Alert
                    type="warning"
                    title={tm("latestUnavailable")}
                    description={
                      tm(candidate.recoveryError) ===
                      `deliveryTeamRuntime.${candidate.recoveryError}`
                        ? candidate.recoveryError
                        : tm(candidate.recoveryError)
                    }
                  />
                )}
                <Button
                  disabled={busy || !candidate.adopted}
                  onClick={() => {
                    if (!candidate.adopted) return;
                    setDraft(candidate.adopted);
                    setTargets(candidate.targets);
                    if (candidate.bindings)
                      qc.setQueryData(teamKey, candidate.bindings);
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
