import { taskDispatchCopy, taskDispatchReason } from "@/i18n/task-dispatch";
import { TaskDispatchFeedback } from "./TaskDispatchFeedback";
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
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
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
import { ExecutionQueueRecovery } from "./ExecutionQueueRecovery";
import { executionQueueOriginal, validExecutionQueuePreview, type ExecutionDispatchCommand } from "@/lib/executionDispatchCommand";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { executionHandoffCopy } from "@/i18n/execution-handoff";

export function ExecutionPlanEditor({
  initial,
  initialTargets,
  canConfigure,
  onClose,
  onSaved,
  members,
  sessionId,
  queueCommand,
  isActive,
  canSubmit,
  contextWarning,
  onUnresolvedChange,
}: {
  initial: ExecutionDraftSession;
  initialTargets: DeliveryTargets;
  canConfigure: boolean;
  onClose: () => void;
  onSaved: (data: DeliveryCommandAck) => void;
  members: DeliveryMember[];
  sessionId: string;
  queueCommand: ExecutionDispatchCommand;
  isActive?: () => boolean;
  canSubmit?: () => boolean;
  contextWarning?: string;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const handoffCopy = executionHandoffCopy(i18n.language);
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const tm = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const qc = useQueryClient();
  const [draft, setDraftState] = useState(initial);
  const draftRef = useRef(draft); draftRef.current = draft;
  const setDraft = (next: ExecutionDraftSession | ((value: ExecutionDraftSession) => ExecutionDraftSession)) => {
    const value = typeof next === "function" ? next(draftRef.current) : next;
    draftRef.current = value; setDraftState(value);
  };
  const origin = useRef(projectSessionKey()), mounted = useRef(true), pending = useRef(false);
  const confirmed = useRef(false);
  const [finished, setFinished] = useState(false);
  const identity = `${initial.projectId}:${initial.taskId}:${sessionId}`, liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const access = useRef({ queueCommand, isActive, canSubmit }); access.current = { queueCommand, isActive, canSubmit };
  const notify = useRef(onUnresolvedChange); notify.current = onUnresolvedChange;
  const [targets, setTargets] = useState(initialTargets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedbackDiagnostic, setFeedbackDiagnostic] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<{
    workspace: DeliveryTaskData;
    targets: DeliveryTargets;
    bindings?: TeamRuntimeBindings;
    adopted?: ExecutionDraftSession;
    recoveryError?: string;
  }>();
  const commandLocked = !["idle", "refused"].includes(queueCommand.state.phase);
  const locked = busy || commandLocked;
  const isLocked = () => !["idle", "refused"].includes(queueCommand.snapshot().phase);
  const current = () => {
    if (!mounted.current || origin.current !== projectSessionKey() || liveIdentity.current !== identity ||
      !queueCommand.current() || access.current.queueCommand.snapshot !== queueCommand.snapshot || access.current.isActive?.() === false)
      throw new Error("noScope");
  };
  const canChange = () => {
    if (pending.current || confirmed.current || isLocked() || access.current.canSubmit?.() === false) return false;
    try { current(); return true; } catch { return false; }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    notify.current?.(["sending", "unknown", "succeeded"].includes(queueCommand.state.phase));
    return () => notify.current?.(false);
  }, [queueCommand.state.phase]);
  const teamKey = ["delivery-team-runtime", draft.projectId, sessionId];
  const team = useQuery({
    queryKey: teamKey,
    queryFn: ({ signal }) => fetchTeamRuntimeBindings(draft.projectId, signal),
    enabled: draft.mode === "agent" && !commandLocked,
    retry: false,
    gcTime: 0,
  });
  const [policyTarget, setPolicyTargetState] = useState<ExecutionTarget>();
  const policyRef = useRef(policyTarget); policyRef.current = policyTarget;
  const setPolicyTarget = (value: ExecutionTarget | undefined) => { policyRef.current = value; setPolicyTargetState(value); };
  const workspace = targets.workspaces.find(
    (item) => item.id === draft.workspaceId,
  );
  const change = (values: Partial<ExecutionDraftSession>) => {
    if (!canChange()) return;
    setDraft((current) => ({ ...current, ...values, preview: null }));
    setCandidate(undefined);
  };
  const fail = (failure: unknown) => {
    const message = (failure as Error).message;
    if (message === "feedbackInvalid") { setError(taskDispatchCopy(i18n.language).feedbackInvalid); return; }
    const parsed = planError(failure);
    const feedbackMessage = taskDispatchReason(i18n.language, parsed.code || "");
    if (feedbackMessage) { setError(feedbackMessage); setFeedbackDiagnostic(`${parsed.code}: ${parsed.message}`); setConflict(false); setCandidate(undefined); return; }
    setFeedbackDiagnostic("");
    setError(
      parsed.code && /^(runtime_|executor_)/.test(parsed.code)
        ? `reasons.${parsed.code}`
        : parsed.message,
    );
    if (parsed.conflict || /^HTTP 409\b/.test(message)) setConflict(true);
    setCandidate(undefined);
  };
  async function preview() {
    if (!canChange() || policyRef.current) return;
    pending.current = true;
    setBusy(true);
    setError(""); setFeedbackDiagnostic("");
    try {
      current();
      const value = { ...draftRef.current, preview: null };
      setDraft(value);
      if (queueCommand.snapshot().phase === "refused") {
        queueCommand.reset();
        if (queueCommand.snapshot().phase !== "idle") throw new Error("queueStorageUnavailable");
      }
      const prepared = prepareExecution(value);
      setDraft(prepared.session);
      const result = await previewDeliveryExecution(
        value.projectId,
        prepared.payload,
      );
      current();
      if (access.current.canSubmit?.() === false) throw new Error("queueCurrentReadFailed");
      if (!validExecutionQueuePreview(value.projectId, prepared, result)) { setConflict(true); throw new Error("queuePreviewInvalid"); }
      setDraft({ ...prepared.session, preview: result });
    } catch (failure) {
      if (mounted.current) fail(failure);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!canChange() || !draftRef.current.preview || conflict || policyRef.current || executorInvalid) return;
    pending.current = true;
    setBusy(true);
    setError(""); setFeedbackDiagnostic("");
    try {
      current();
      const prepared = prepareExecution(draftRef.current);
      const result = await queueCommand.run(executionQueueOriginal(prepared));
      current();
      if (queueCommand.snapshot().phase === "refused") { setConflict(true); fail(new Error(queueCommand.snapshot().error || "")); }
      if (result) {
        confirmed.current = true; setFinished(true);
        queueCommand.reset();
        if (queueCommand.snapshot().phase !== "idle") { setError("queueCleanupFailed"); notify.current?.(true); return; }
        notify.current?.(false);
        try { onSaved(result); } catch { setError("queueRefreshAfterSaveFailed"); }
        onClose();
      }
    } catch (failure) {
      if (mounted.current) fail(failure);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function readLatest() {
    if (!canChange() || policyRef.current) return;
    pending.current = true;
    setCandidate(undefined);
    setBusy(true);
    setError(""); setFeedbackDiagnostic("");
    try {
      current();
      setDraft({ ...draftRef.current, preview: null });
      const [latestWorkspace, latestTargets] = await Promise.all([
        fetchDeliveryTaskEditData(draft.projectId, draft.taskId),
        fetchDeliveryTargets(draft.projectId),
      ]);
      const latestBindings = draft.executorMemberId
        ? await fetchTeamRuntimeBindings(draft.projectId)
        : undefined;
      current();
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
      if (mounted.current) { setCandidate(undefined); setError(`${tr("retryRead")} ${(failure as Error).message}`); }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
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
  const teamData = team.isError ? undefined : team.data;
  const selectedMember = teamData?.members.find(
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
    ...(teamData?.members || []).map((item) => ({
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

  const close = () => {
    if (confirmed.current && !pending.current && queueCommand.snapshot().phase === "idle") {
      try { current(); onClose(); } catch { setError("queueRefreshAfterSaveFailed"); }
      return;
    }
    if (pending.current || confirmed.current || isLocked() || policyRef.current) return;
    try { current(); } catch { return; }
    if (queueCommand.snapshot().phase === "refused") { queueCommand.reset(); if (queueCommand.snapshot().phase !== "idle") return; }
    onClose();
  };
  const queueProblem = queueCommand.state.error ? planError(new Error(queueCommand.state.error)) : undefined;
  const queueFeedback = taskDispatchReason(i18n.language, queueProblem?.code || "");
  return (
    <>
      <Modal
        open
        title={tr("planTitle")}
        width={760}
        className="delivery-editor runtime-editor"
        onCancel={close}
        closable={!locked}
        keyboard={!locked}
        maskClosable={!locked}
        footer={
          <Space wrap>
            <Button disabled={locked} onClick={close}>
              {t(finished ? "common.close" : "common.cancel")}
            </Button>
            {!commandLocked && !finished && <Button
              loading={busy}
              disabled={
                busy || conflict ||
                Boolean(policyTarget) ||
                !draft.target ||
                executorInvalid ||
                targetProblems.length > 0
              }
              onClick={preview}
            >
              {tr("preview")}
            </Button>}
            {!commandLocked && !finished && <Button
              type="primary"
              loading={busy}
              disabled={
                busy || !draft.preview ||
                conflict ||
                Boolean(policyTarget) ||
                executorInvalid
              }
              onClick={save}
            >
              {tr("save")}
            </Button>}
          </Space>
        }
      >
        {commandLocked ? <ExecutionQueueRecovery command={queueCommand} projectId={initial.projectId} taskId={initial.taskId}
          isActive={isActive} onSaved={onSaved} onResolved={() => { confirmed.current = true; setFinished(true); notify.current?.(false); onClose(); }} /> : finished ?
          <Alert type="success" title={handoffCopy.received} description={error ? tr(error) : handoffCopy.receivedHint} /> : <>
        {contextWarning && <Alert type="warning" title={contextWarning} />}
        <p className="runtime-help">{tr("selectFirst")}</p>
        {queueCommand.state.error && <Alert type="error" role="alert" description={queueFeedback && <details><summary>{handoffCopy.details}</summary><code>{queueCommand.state.error}</code></details>} title={queueFeedback || (queueCommand.state.error === "retainedOriginalUnavailable" ? tr("queueStorageUnavailable") : queueCommand.state.error === "retainedOriginalInvalid" ? tr("queueOriginalUnavailable") : queueCommand.state.error)} />}
        {error && (
          <Alert
            role="alert"
            type="error"
            description={feedbackDiagnostic && <details><summary>{handoffCopy.details}</summary><code>{feedbackDiagnostic}</code></details>}
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
                disabled={locked || (!teamData && !draft.executorMemberId)}
                value={draft.executorMemberId}
                showSearch
                optionFilterProp="label"
                options={memberOptions}
                onChange={(id) => {
                  if (!canChange()) return;
                  try {
                    if (!id) setDraft(useDirectExecution(draft));
                    else {
                      const row = teamData?.members.find(
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
                  disabled={locked}
                  onClick={() => {
                    if (!canChange()) return;
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
              disabled={locked || Boolean(draft.executorMemberId)}
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
              disabled={locked}
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
                disabled={locked || !workspace || Boolean(draft.executorMemberId)}
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
                locked || !workspace || (draft.mode === "agent" && !draft.agentId)
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
                            locked ||
                            device.reason_codes.includes("device_revoked")
                          }
                          onClick={() => { if (canChange()) setPolicyTarget(device); }}
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
                locked ||
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
          disabled={locked}
          maxCommands={
            draft.mode === "command" && draft.approvalBeforeRun ? 31 : 32
          }
          onChange={(commands) => change({ commands })}
        />
        <p className="runtime-help">{tr("previewRequired")}</p>
        {draft.preview && (
          <section className="runtime-plan-preview">
            <Alert type="info" title={handoffCopy.previewReady} />
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
            <ExecutionAcceptanceSnapshot projectId={draft.projectId} snapshot={draft.preview.snapshot} />
            {draft.preview.feedback_context && <TaskDispatchFeedback context={draft.preview.feedback_context} fixed />}
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
                  disabled={locked || !candidate.adopted}
                  onClick={() => {
                    if (!candidate.adopted || !canChange()) return;
                    if (queueCommand.snapshot().phase === "refused") { queueCommand.reset(); if (queueCommand.snapshot().phase !== "idle") return; }
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
        </>}
      </Modal>
      {policyTarget && workspace && (
        <ExecutionPolicyEditor
          key={`${workspace.id}:${policyTarget.id}`}
          projectId={draft.projectId}
          workspaceId={workspace.id}
          target={policyTarget}
          onClose={() => setPolicyTarget(undefined)}
          onSaved={() => {
            if (!canChange()) return;
            change({ target: null });
            setConflict(false);
            void fetchDeliveryTargets(draft.projectId)
              .then((value) => { current(); setTargets(value); })
              .catch(fail);
          }}
        />
      )}
    </>
  );
}
