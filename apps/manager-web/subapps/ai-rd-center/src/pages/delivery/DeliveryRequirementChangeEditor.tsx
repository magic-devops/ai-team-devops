import { useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { OwnerSelect } from "@/components/DeliveryMemberIdentity";
import {
  fetchDelivery,
  type DeliveryRequirement,
  type DeliveryWorkspace,
  type DeliveryIntent,
} from "@/lib/delivery";
import {
  collaborationFailure,
  collaborationSessionKey,
  previewRequirementChange,
  prepareRequirementChange,
  requirementDefinitionChanges,
  saveRequirementChange,
  collaborationSourceHref,
  type RequirementChangePreview,
  type RequirementDefinition,
  type RequirementCurrentLinks,
} from "@/lib/deliveryCollaboration";
import { ActivityFieldChanges } from "./DeliveryActivityFeed";
import "./delivery-collaboration.css";

type Draft = {
  title: string;
  description: string;
  criteria: string;
  priority: string;
  owner_id: string;
  due_on: string;
  milestone_id: string;
  blocked_reason: string;
};
function draftOf(requirement: DeliveryRequirement): Draft {
  return {
    title: requirement.title,
    description: requirement.description,
    criteria: requirement.acceptance_criteria.join("\n"),
    priority: requirement.priority,
    owner_id: requirement.flow.owner_id,
    due_on: requirement.flow.due_on || "",
    milestone_id: requirement.flow.milestone_id,
    blocked_reason: requirement.flow.blocked_reason,
  };
}
const definitionOf = (draft: Draft): RequirementDefinition => ({
  title: draft.title.trim(),
  description: draft.description,
  acceptance_criteria: draft.criteria
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean),
});
export function RequirementImpactFacts({
  preview,
  links,
  projectId,
  background,
  onNavigate,
}: {
  preview?: RequirementChangePreview;
  links?: RequirementCurrentLinks;
  projectId: string;
  background?: string;
  onNavigate?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const scope = preview?.impact || links;
  if (!scope) return null;
  const groups = [
    ["tasks", "task", scope.task_ids],
    ["dependentTasks", "task", scope.dependent_task_ids],
    ["executions", "execution", scope.execution_ids],
    ["candidates", "release_candidate", scope.release_candidate_ids],
    ["deployments", "deployment", scope.deployment_ids],
  ] as const;
  return (
    <section className="delivery-collaboration-impact">
      <h3>{tr("impact")}</h3>
      <p className="delivery-collaboration-help">{tr("impactHint")}</p>
      {preview?.impact.invalidates_current_acceptance && (
        <Alert type="warning" showIcon title={tr("acceptanceInvalidates")} />
      )}
      <dl>
        {groups.map(([label, kind, ids]) => (
          <div key={label}>
            <dt>
              {tr(label)} <Tag>{ids.length}</Tag>
            </dt>
            <dd>
              {ids.length ? (
                ids.map((id) => {
                  const href =
                    onNavigate && background
                      ? collaborationSourceHref(
                          {
                            kind,
                            id,
                            available: true,
                            label: null,
                            reason: null,
                          },
                          projectId,
                          background,
                        )
                      : null;
                  return href ? (
                    <Button
                      key={id}
                      size="small"
                      type="link"
                      onClick={() => onNavigate?.(href)}
                    >
                      {id}
                    </Button>
                  ) : (
                    <code key={id}>{id}</code>
                  );
                })
              ) : (
                <span>{tr("none")}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {((scope.restricted_execution_count || 0) > 0 ||
        (scope.restricted_deployment_count || 0) > 0) && (
        <Alert type="info" title={tr("restrictedLinks")} />
      )}
      {preview?.reasons.map((reason) => (
        <Alert key={reason.code} type="warning" title={reason.message} />
      ))}
    </section>
  );
}
export function DeliveryRequirementChangeEditor({
  workspace,
  requirement,
  sessionId,
  onSaved,
  onClose,
  onUnresolvedChange = () => {},
}: {
  workspace: DeliveryWorkspace;
  requirement: DeliveryRequirement;
  sessionId: string;
  onSaved: (workspace: DeliveryWorkspace) => void;
  onClose: () => void;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const origin = useRef(collaborationSessionKey());
  const [pinned, setPinned] = useState(() => ({
    requirement: structuredClone(requirement),
    version: workspace.version,
    writable: workspace.permissions.write,
  }));
  const [draft, setDraft] = useState<Draft>(() => draftOf(requirement));
  const dirty = useRef(new Set<keyof Draft>());
  const [preview, setPreview] = useState<RequirementChangePreview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [latest, setLatest] = useState<DeliveryWorkspace | null>(null);
  const intent = useRef<DeliveryIntent>({
    version: workspace.version,
    key: crypto.randomUUID(),
  });
  const pending = useRef<{
    intent: DeliveryIntent;
    payload: Record<string, unknown>;
  } | null>(null);
  const current = () => {
    if (origin.current !== collaborationSessionKey())
      throw new Error(tr("scopeChanged"));
  };
  const changes = requirementDefinitionChanges(
    pinned.requirement,
    definitionOf(draft),
  );
  const definitionChanged = Object.keys(changes).length > 0;
  const locked = busy || unknown || !pinned.writable;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    dirty.current.add(key);
    setDraft((valueBefore) => ({ ...valueBefore, [key]: value }));
    setPreview(null);
    setError("");
  };
  const payload = () => {
    const before = draftOf(pinned.requirement);
    return {
      id: requirement.id,
      ...changes,
      ...Object.fromEntries(
        (
          [
            "priority",
            "owner_id",
            "due_on",
            "milestone_id",
            "blocked_reason",
          ] as const
        )
          .filter((key) => draft[key] !== before[key])
          .map((key) => [
            key,
            key === "due_on" ? draft[key] || null : draft[key],
          ]),
      ),
    };
  };
  const hasChanges = Object.keys(payload()).length > 1;
  const showError = (failure: unknown) => {
    const problem = collaborationFailure(failure);
    setError(problem.conflict ? tr("conflict") : problem.message);
    setConflict(problem.conflict);
    return problem;
  };
  const generatePreview = async () => {
    if (locked || conflict || !definitionChanged || !draft.title.trim()) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      current();
      const result = await previewRequirementChange(
        workspace.project.id,
        requirement.id,
        pinned.requirement.basis,
        changes,
      );
      current();
      if (
        result.project_id !== workspace.project.id ||
        result.requirement_id !== requirement.id ||
        result.requirement_basis !== pinned.requirement.basis ||
        result.version !== pinned.version
      )
        throw new Error("HTTP 409: preview basis changed");
      setPreview(result);
    } catch (failure) {
      showError(failure);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (retry = false) => {
    if (
      busy ||
      (!retry &&
        (unknown ||
          conflict ||
          !hasChanges ||
          !pinned.writable ||
          (definitionChanged && !preview?.allowed)))
    )
      return;
    setBusy(true);
    setError("");
    try {
      current();
      const command = retry
        ? pending.current
        : prepareRequirementChange(
            intent.current,
            pinned.requirement.basis,
            payload(),
            definitionChanged,
            preview?.preview_basis || null,
          );
      if (!command) throw new Error(tr("previewRequired"));
      pending.current = command;
      intent.current = command.intent;
      onUnresolvedChange(true);
      const result = await saveRequirementChange(
        workspace.project.id,
        command.intent,
        command.payload,
      );
      current();
      if (result.project.id !== workspace.project.id)
        throw new Error(tr("scopeChanged"));
      setUnknown(false);
      onUnresolvedChange(false);
      onSaved(result);
      onClose();
    } catch (failure) {
      const problem = showError(failure);
      setUnknown(problem.unknown);
      if (!problem.unknown) onUnresolvedChange(false);
    } finally {
      setBusy(false);
    }
  };
  const readLatest = async () => {
    if (busy || unknown) return;
    setBusy(true);
    setLatest(null);
    try {
      current();
      const result = await fetchDelivery(workspace.project.id);
      current();
      if (
        result.project.id !== workspace.project.id ||
        !result.requirements.some((row) => row.id === requirement.id)
      )
        throw new Error(tr("requirementUnavailable"));
      setLatest(result);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const adoptLatest = () => {
    if (!latest || busy || unknown || !latest.permissions.write) return;
    current();
    const row = latest.requirements.find((item) => item.id === requirement.id);
    if (!row) return;
    const next = draftOf(row);
    for (const key of dirty.current) next[key] = draft[key];
    setPinned({
      requirement: structuredClone(row),
      version: latest.version,
      writable: latest.permissions.write,
    });
    setDraft(next);
    setPreview(null);
    setConflict(false);
    setLatest(null);
    setError("");
    intent.current = { version: latest.version, key: crypto.randomUUID() };
    pending.current = null;
  };
  const cancel = () => {
    if (!busy && !unknown) onClose();
  };
  return (
    <Modal
      open
      title={tr("editRequirement")}
      className="delivery-editor delivery-collaboration-editor"
      width={700}
      closable={!busy && !unknown}
      keyboard={!busy && !unknown}
      maskClosable={false}
      onCancel={cancel}
      footer={
        <div className="delivery-collaboration-toolbar">
          <Button disabled={busy || unknown} onClick={cancel}>
            {t("delivery.cancel")}
          </Button>
          {unknown ? (
            <Button
              type="primary"
              data-action="retry-change"
              loading={busy}
              onClick={() => confirm(true)}
            >
              {tr("retryOriginal")}
            </Button>
          ) : definitionChanged && !preview ? (
            <Button
              type="primary"
              data-action="preview-change"
              loading={busy}
              disabled={locked || conflict || !draft.title.trim()}
              onClick={generatePreview}
            >
              {tr("preview")}
            </Button>
          ) : (
            <Button
              type="primary"
              data-action="confirm-change"
              loading={busy}
              disabled={
                locked ||
                conflict ||
                !hasChanges ||
                (definitionChanged && !preview?.allowed)
              }
              onClick={() => confirm()}
            >
              {tr("confirmChange")}
            </Button>
          )}
        </div>
      }
    >
      <p className="delivery-collaboration-help">
        {tr("fixedBasis")} ·{" "}
        {t("delivery.revision", { number: pinned.requirement.flow.revision })} ·
        v{pinned.version}
      </p>
      {error && <Alert type="error" showIcon role="alert" title={error} />}
      {unknown && (
        <Alert
          type="warning"
          showIcon
          title={tr("unknownWrite")}
          description={tr("unknownWriteHint")}
        />
      )}
      {conflict && (
        <section className="delivery-collaboration-conflict">
          <p>{tr("draftRetained")}</p>
          <Button data-action="read-latest" loading={busy} onClick={readLatest}>
            {tr("readLatest")}
          </Button>
          {latest && (
            <>
              <ActivityFieldChanges
                changes={[
                  {
                    field: "title",
                    before: pinned.requirement.title,
                    after: latest.requirements.find(
                      (row) => row.id === requirement.id,
                    )?.title,
                  },
                  {
                    field: "description",
                    before: pinned.requirement.description,
                    after: latest.requirements.find(
                      (row) => row.id === requirement.id,
                    )?.description,
                  },
                  {
                    field: "acceptance_criteria",
                    before: pinned.requirement.acceptance_criteria,
                    after: latest.requirements.find(
                      (row) => row.id === requirement.id,
                    )?.acceptance_criteria,
                  },
                ]}
              />
              <Button
                data-action="adopt-latest"
                disabled={busy || !latest.permissions.write}
                onClick={adoptLatest}
              >
                {tr("adoptLatest")}
              </Button>
            </>
          )}
        </section>
      )}
      <div className="delivery-collaboration-fields">
        <label>
          {t("delivery.titleField")}
          <Input
            aria-label={t("delivery.titleField")}
            value={draft.title}
            maxLength={256}
            disabled={locked}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>
        <label>
          {t("delivery.description")}
          <Input.TextArea
            aria-label={t("delivery.description")}
            value={draft.description}
            maxLength={20000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={locked}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>
        <label>
          {t("delivery.criteria")}
          <Input.TextArea
            aria-label={t("delivery.criteria")}
            value={draft.criteria}
            maxLength={20000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={locked}
            onChange={(event) => update("criteria", event.target.value)}
          />
        </label>
        <div className="delivery-collaboration-pair">
          <label>
            {t("delivery.priority")}
            <Select
              aria-label={t("delivery.priority")}
              data-field="priority"
              value={draft.priority}
              options={["P0", "P1", "P2", "P3"].map((value) => ({
                value,
                label: value,
              }))}
              disabled={locked}
              onChange={(value) => update("priority", value)}
            />
          </label>
          <label>
            {t("delivery.owner")}
            <OwnerSelect
              label={t("delivery.owner")}
              members={workspace.members}
              value={draft.owner_id}
              disabled={locked}
              onChange={(value) => update("owner_id", value)}
            />
          </label>
        </div>
        <div className="delivery-collaboration-pair">
          <label>
            {t("delivery.due")}
            <Input
              type="date"
              aria-label={t("delivery.due")}
              value={draft.due_on}
              disabled={locked}
              onChange={(event) => update("due_on", event.target.value)}
            />
          </label>
          <label>
            {t("delivery.milestone")}
            <Select
              aria-label={t("delivery.milestone")}
              value={draft.milestone_id}
              options={[
                { value: "", label: tr("none") },
                ...workspace.milestones.map((row) => ({
                  value: row.id,
                  label: row.title,
                })),
              ]}
              disabled={locked}
              onChange={(value) => update("milestone_id", value)}
            />
          </label>
        </div>
        <label>
          {t("delivery.blockedReason")}
          <Input.TextArea
            aria-label={t("delivery.blockedReason")}
            value={draft.blocked_reason}
            maxLength={2000}
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={locked}
            onChange={(event) => update("blocked_reason", event.target.value)}
          />
        </label>
      </div>
      {preview && (
        <section
          className="delivery-collaboration-preview"
          data-session={sessionId}
        >
          <h3>{tr("definitionChanges")}</h3>
          <ActivityFieldChanges changes={preview.changes} />
          <RequirementImpactFacts
            preview={preview}
            projectId={workspace.project.id}
          />
          <p className="delivery-collaboration-help">{tr("confirmHint")}</p>
        </section>
      )}
    </Modal>
  );
}
