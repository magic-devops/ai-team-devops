import { Alert, Button, Modal, Select, Space } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { saveDelivery, type DeliveryWorkspace } from "@/lib/delivery";
import { getWorkspaceScope, getSessionRevision } from "@/lib/authStorage";
import { adoptRuntimeBindingDraft, changeBindingWorkspace, fetchTeamRuntimeBindings, prepareRuntimeBinding, type RuntimeBindingDraft, type TeamRuntimeBindings } from "@/lib/deliveryTeamRuntime";
import { RuntimeBindingFacts } from "./ExecutionExecutorFacts";
import { planError } from "@/lib/deliveryTaskPlan";

export function MemberRuntimeBindingEditor({ initial, initialCatalogue, memberName, onClose, onSaved }: {
  initial: RuntimeBindingDraft; initialCatalogue: TeamRuntimeBindings; memberName: string;
  onClose: () => void; onSaved: (workspace: DeliveryWorkspace) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const [origin] = useState(() => JSON.stringify([getWorkspaceScope(), getSessionRevision()]));
  const [draft, setDraft] = useState(initial);
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<TeamRuntimeBindings>();
  const row = catalogue.members.find((item) => item.member_id === draft.memberId);
  const latest = candidate?.members.find((item) => item.member_id === draft.memberId);
  const workspace = catalogue.workspaces.find((item) => item.id === draft.workspaceId);
  const fail = (failure: unknown) => {
    const message = (failure as Error).message;
    const parsed = planError(failure);
    setError(parsed.code && /^(runtime_|executor_)/.test(parsed.code) ? `reasons.${parsed.code}` : parsed.message);
    setCandidate(undefined);
    if (message.includes("409")) setConflict(true);
  };
  const checkScope = () => { if (origin !== JSON.stringify([getWorkspaceScope(), getSessionRevision()])) throw new Error("scopeChanged"); };
  const save = async () => {
    if (busy || conflict) return;
    setBusy(true); setError("");
    try {
      checkScope();
      const prepared = prepareRuntimeBinding(draft, catalogue);
      setDraft(prepared.draft);
      const result = await saveDelivery(draft.projectId, prepared.action, prepared.payload, prepared.version, prepared.key);
      checkScope(); onSaved(result); onClose();
    } catch (failure) { fail(failure); } finally { setBusy(false); }
  };
  const readLatest = async () => {
    setCandidate(undefined); setBusy(true); setError("");
    try { checkScope(); const result = await fetchTeamRuntimeBindings(draft.projectId); checkScope(); setCandidate(result); }
    catch (failure) { fail(failure); } finally { setBusy(false); }
  };
  const profileValue = draft.agentId ? `${draft.agentId}:${draft.agentVersion}` : undefined;
  const options = (workspace?.agents || []).map((agent) => ({ value: `${agent.id}:${agent.version}`, label: `${agent.title} · ${agent.provider} · v${agent.version}`, disabled: false }));
  if (profileValue && !options.some((item) => item.value === profileValue)) options.push({ value: profileValue, label: `${row?.binding?.source.agent_title || draft.agentId} · v${draft.agentVersion} · ${tr("unavailableProfile")}`, disabled: true });
  const workspaces = catalogue.workspaces.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}`, disabled: false }));
  if (draft.workspaceId && !workspaces.some((item) => item.value === draft.workspaceId)) workspaces.push({ value: draft.workspaceId, label: `${row?.binding?.source.workspace_name || draft.workspaceId} · ${tr("unavailableProfile")}`, disabled: true });
  return <Modal open title={tr(draft.operation === "unbind" ? "unbindTitle" : "bind")} width={620} className="delivery-editor team-runtime-editor" onCancel={() => !busy && onClose()} closable={!busy} keyboard={!busy} maskClosable={false} footer={<Space wrap><Button disabled={busy} onClick={onClose}>{tr("cancel")}</Button><Button type="primary" danger={draft.operation === "unbind"} loading={busy} disabled={conflict} onClick={() => void save()}>{tr(draft.operation === "unbind" ? "unbind" : "save")}</Button></Space>}>
    <strong>{memberName}</strong><code className="runtime-identity">{draft.memberId}</code><p className="runtime-help">{tr(draft.operation === "unbind" ? "unbindHint" : "intro")}</p>
    {error && <Alert role="alert" type="error" title={conflict ? tr("conflict") : tr(error) === `deliveryTeamRuntime.${error}` ? error : tr(error)} />}
    {row?.binding && <div className="team-runtime-candidate"><strong>{tr("pinned")} · {tr("generation")} {row.generation}</strong><RuntimeBindingFacts binding={row.binding} /></div>}
    {draft.operation === "bind" && <>
      {!catalogue.workspaces.length && <Alert type="info" title={tr("noWorkspaces")} />}
      <label>{tr("workspace")}<Select aria-label={tr("workspace")} disabled={busy || conflict} value={draft.workspaceId || undefined} options={workspaces} showSearch optionFilterProp="label" onChange={(workspaceId) => setDraft(changeBindingWorkspace(draft, workspaceId))} /></label>
      <label>{tr("profile")}<Select aria-label={tr("profile")} disabled={busy || conflict || !workspace} value={profileValue} options={options} showSearch optionFilterProp="label" onChange={(value) => { const agent = workspace?.agents.find((item) => `${item.id}:${item.version}` === value); if (agent) setDraft({ ...draft, agentId: agent.id, agentVersion: agent.version }); }} /></label>
    </>}
    {conflict && <section className="team-runtime-candidate"><Button loading={busy} onClick={() => void readLatest()}>{tr("readLatest")}</Button>{candidate && <><h4>{tr("latest")} · v{candidate.version}</h4>{latest?.binding ? <RuntimeBindingFacts binding={latest.binding} /> : <p>{tr("states.unbound")}</p>}<p className="runtime-help">{tr("chooseCurrentProfile")}</p><Button disabled={busy || !latest?.permissions[draft.operation === "bind" ? "can_bind" : "can_unbind"]} onClick={() => { try { setDraft(adoptRuntimeBindingDraft(draft, candidate, crypto.randomUUID())); setCatalogue(candidate); setCandidate(undefined); setConflict(false); setError(""); } catch (failure) { fail(failure); } }}>{tr("adopt")}</Button></>}</section>}
  </Modal>;
}
