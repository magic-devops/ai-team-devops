import { requirementReasonText } from "@/lib/deliveryRequirementPresentation";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { beginProgressExactRead } from "@/lib/deliveryProgress";
import type { DiscussionAdoption } from "@/lib/deliveryDiscussions";
import {
  DiscussionAdoptionSource,
  useDiscussionAdoptionSource,
  applyDiscussionAdoption,
} from "./DeliveryDiscussionAdoptionSource";
import { DeliveryReferenceSelect } from "@/components/DeliveryReferenceSelect";
import {
  fetchEditableRequirement,
  fetchDeliveryContext,
} from "@/lib/deliveryQuery";
import type { DeliveryCommandAck } from "@/lib/deliveryQuery";
import { useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select, Tag } from "antd";
import { useTranslation } from "react-i18next";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";
import { type DeliveryContext, type DeliveryIntent } from "@/lib/delivery";
import {
  collaborationFailure,
  previewRequirementChange,
  requirementDefinitionChanges,
  type RequirementChangePreview,
  type RequirementDefinition,
} from "@/lib/deliveryCollaboration";
import {
  prepareRequirementOriginal,
  useRequirementCommand,
} from "@/lib/deliveryRequirementCommand";
import type {
  RequirementEditable,
  RequirementEditableResponse,
  RequirementImpactCounts,
} from "@/lib/deliveryRequirementReads";
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
function draftOf(requirement: RequirementEditable): Draft {
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
  counts,
}: {
  preview?: RequirementChangePreview;
  counts?: RequirementImpactCounts | null;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const value = preview?.impact.counts || counts;
  return (
    <section className="delivery-collaboration-impact">
      <h3>{tr("impact")}</h3>
      <p className="delivery-collaboration-help">{tr("impactHint")}</p>
      {preview?.impact.invalidates_current_acceptance && (
        <Alert type="warning" title={tr("acceptanceInvalidates")} />
      )}
      {value ? (
        <dl>
          {(
            [
              ["tasks", "direct_task"],
              ["dependentTasks", "dependent_task"],
              ["executions", "execution"],
              ["candidates", "release_candidate"],
              ["deployments", "deployment"],
            ] as const
          ).map(([label, key]) => (
            <div key={key}>
              <dt>{tr(label)}</dt>
              <dd>
                <Tag>{value[key]}</Tag>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <Alert type="info" title={tr("impactUnavailable")} />
      )}
      {!!value &&
        (value.restricted_execution > 0 || value.restricted_deployment > 0) && (
          <Alert
            type="info"
            title={tr("restrictedLinks")}
            description={`${tr("executions")}: ${value.restricted_execution} · ${tr("deployments")}: ${value.restricted_deployment}`}
          />
        )}
      {preview?.reasons.map((reason) => (
        <Alert
          key={reason.code}
          type="warning"
          title={requirementReasonText(t, reason.code)}
        />
      ))}
    </section>
  );
}
export function RequirementChangeForm({
  workspace,
  requirement,
  requirementVersion,
  sessionId,
  onSaved,
  onClose,
  onUnresolvedChange = () => {},
  initialSource,
  command,
}: {
  workspace: DeliveryContext;
  requirement: RequirementEditable;
  requirementVersion?: number;
  sessionId: string;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onClose: () => void;
  onUnresolvedChange?: (value: boolean) => void;
  initialSource?: DiscussionAdoption;
  command: ReturnType<typeof useRequirementCommand>;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryCollaboration.${key}`);
  const origin = useRef(projectSessionKey());
  const source = useDiscussionAdoptionSource(initialSource);
  const [pinned, setPinned] = useState(() => ({
    requirement: structuredClone(requirement),
    version: requirementVersion ?? workspace.version,
    generation: workspace.query_generation,
    writable: workspace.permissions.write,
  }));
  const [draft, setDraft] = useState<Draft>(() => {
    const result = applyDiscussionAdoption(
      {
        description: requirement.description,
        acceptance_criteria: requirement.acceptance_criteria,
      },
      initialSource,
    );
    return {
      ...draftOf(requirement),
      description: result.description,
      criteria: result.acceptance_criteria.join("\n"),
    };
  });
  const dirty = useRef(
    new Set<keyof Draft>(
      initialSource
        ? [initialSource.field === "description" ? "description" : "criteria"]
        : [],
    ),
  );
  const [preview, setPreview] = useState<RequirementChangePreview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const unknown = command.state.phase === "unknown";
  const [latest, setLatest] = useState<
    | (RequirementEditableResponse & {
        permissions: DeliveryContext["permissions"];
      })
    | null
  >(null);
  const intent = useRef<DeliveryIntent>({
    version: requirementVersion ?? workspace.version,
    key: crypto.randomUUID(),
  });
  const current = () => {
    if (origin.current !== projectSessionKey())
      throw new Error(tr("scopeChanged"));
  };
  const changes = requirementDefinitionChanges(
    pinned.requirement,
    definitionOf(draft),
  );
  const definitionChanged = Object.keys(changes).length > 0;
  const locked = busy || command.state.phase !== "idle" || !pinned.writable;
  const synchronousBusy = useRef(false);
  const draftRevision = useRef(0),
    renderedRevision = draftRevision.current;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (
      synchronousBusy.current ||
      (command.snapshot().phase !== "idle" &&
        command.snapshot().phase !== "refused")
    )
      return;
    draftRevision.current++;
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
  const invalidDraft =
    Array.from(draft.title.trim()).length > 256 ||
    !draft.title.trim() ||
    Array.from(draft.description).length > 20000 ||
    Array.from(draft.blocked_reason).length > 2000 ||
    definitionOf(draft).acceptance_criteria.length > 80 ||
    definitionOf(draft).acceptance_criteria.some(
      (value) => Array.from(value).length > 2000,
    ) ||
    (!!draft.due_on &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(draft.due_on) ||
        !Number.isFinite(Date.parse(draft.due_on + "T00:00:00Z")) ||
        new Date(draft.due_on + "T00:00:00Z").toISOString().slice(0, 10) !==
          draft.due_on));
  const hasChanges = Object.keys(payload()).length > 1;
  const showError = (failure: unknown) => {
    const problem = collaborationFailure(failure);
    setError(
      problem.conflict
        ? tr("conflict")
        : [
              "requirementProofRequired",
              "requirementInputInvalid",
              "retainedOriginalInvalid",
              "retainedOriginalUnavailable",
            ].includes(problem.message)
          ? tr(problem.message)
          : problem.message === "ackMismatch"
            ? tr("unknownWrite")
            : tr("readFailed"),
    );
    setConflict(problem.conflict);
    return problem;
  };
  const generatePreview = async () => {
    if (
      synchronousBusy.current ||
      locked ||
      conflict ||
      !definitionChanged ||
      invalidDraft
    )
      return;
    synchronousBusy.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    const ticket = beginProgressExactRead();
    try {
      current();
      const result = await previewRequirementChange(
        workspace.project.id,
        requirement.id,
        pinned.requirement.basis,
        changes,
      );
      current();
      if (!ticket.current()) return;
      if (
        result.project_id !== workspace.project.id ||
        result.requirement_id !== requirement.id ||
        result.requirement_basis !== pinned.requirement.basis ||
        result.query_generation !== pinned.generation ||
        result.version !== pinned.version
      )
        throw new Error("HTTP 409: preview basis changed");
      setPreview(result);
    } catch (failure) {
      showError(failure);
    } finally {
      ticket.finish();
      synchronousBusy.current = false;
      setBusy(false);
    }
  };
  const confirm = async (retry = false) => {
    if (
      synchronousBusy.current ||
      busy ||
      renderedRevision !== draftRevision.current ||
      (!retry &&
        (command.snapshot().phase !== "idle" ||
          conflict ||
          !hasChanges ||
          invalidDraft ||
          !pinned.writable ||
          (definitionChanged &&
            (!preview?.allowed || !preview.available || !preview.complete))))
    )
      return;
    synchronousBusy.current = true;
    setBusy(true);
    setError("");
    try {
      current();
      const result = retry
        ? await command.replay()
        : await command.run(
            prepareRequirementOriginal(
              intent.current,
              requirement.id,
              pinned.requirement.basis,
              Object.fromEntries(
                Object.entries(payload()).filter(([key]) => key !== "id"),
              ),
              definitionChanged,
              preview,
              workspace.project.id,
              source.current.current?.reference,
            ),
          );
      current();
      const state = command.snapshot();
      if (result) {
        command.reset();
        onUnresolvedChange(false);
        onSaved(result);
        onClose();
      } else if (state.error) showError(new Error(state.error));
    } catch (failure) {
      showError(failure);
    } finally {
      synchronousBusy.current = false;
      setBusy(false);
    }
  };
  const readLatest = async () => {
    if (synchronousBusy.current || busy || unknown) return;
    synchronousBusy.current = true;
    const ticket = beginProgressExactRead();
    setBusy(true);
    setLatest(null);
    try {
      current();
      const [detail, context] = await Promise.all([
        fetchEditableRequirement(workspace.project.id, requirement.id),
        fetchDeliveryContext(workspace.project.id),
      ]);
      const result = { ...detail, permissions: context.permissions };
      current();
      if (!ticket.current()) return;
      if (
        context.project_id !== workspace.project.id ||
        context.query_generation !== detail.query_generation
      )
        throw new Error(tr("scopeUnavailable"));
      if (
        result.project_id !== workspace.project.id ||
        result.requirement.id !== requirement.id
      )
        throw new Error(tr("requirementUnavailable"));
      setLatest(result);
    } catch (failure) {
      setError(tr("readFailed"));
    } finally {
      ticket.finish();
      synchronousBusy.current = false;
      setBusy(false);
    }
  };
  const adoptLatest = () => {
    if (!latest || busy || unknown || !latest.permissions.write) return;
    current();
    const row = latest.requirement;
    if (!row) return;
    const next = draftOf(row);
    draftRevision.current++;
    for (const key of dirty.current) next[key] = draft[key];
    setPinned({
      requirement: structuredClone(row),
      version: latest.version,
      generation: latest.query_generation,
      writable: latest.permissions.write,
    });
    setDraft(next);
    setPreview(null);
    setConflict(false);
    setLatest(null);
    setError("");
    intent.current = { version: latest.version, key: crypto.randomUUID() };
    command.reset();
  };
  const cancel = () => {
    if (!synchronousBusy.current && !command.unresolved) onClose();
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
              disabled={locked || conflict || invalidDraft}
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
                invalidDraft ||
                (definitionChanged &&
                  (!preview?.allowed ||
                    !preview.complete ||
                    !preview.available))
              }
              onClick={() => confirm()}
            >
              {tr("confirmChange")}
            </Button>
          )}
        </div>
      }
    >
      <DiscussionAdoptionSource
        projectId={workspace.project.id}
        source={source}
        disabled={locked}
      />
      <p className="delivery-collaboration-help">
        {tr("fixedBasis")} ·{" "}
        {t("delivery.revision", { number: pinned.requirement.flow.revision })} ·
        v{pinned.version}
      </p>
      {invalidDraft && (
        <Alert type="warning" title={tr("requirementInputInvalid")} />
      )}
      {error && <Alert type="error" showIcon role="alert" title={error} />}
      {unknown && (
        <Alert
          type="warning"
          showIcon
          title={tr("unknownWrite")}
          description={tr("unknownWriteHint")}
        />
      )}
      {(conflict || command.state.phase === "refused") && (
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
                    after: latest.requirement.title,
                  },
                  {
                    field: "description",
                    before: pinned.requirement.description,
                    after: latest.requirement.description,
                  },
                  {
                    field: "acceptance_criteria",
                    before: pinned.requirement.acceptance_criteria,
                    after: latest.requirement.acceptance_criteria,
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
            disabled={locked}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>
        <label>
          {t("delivery.description")}
          <Input.TextArea
            aria-label={t("delivery.description")}
            value={draft.description}
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
            <ProjectOwnerSelect
              queryGeneration={pinned.generation}
              label={t("delivery.owner")}
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
            <DeliveryReferenceSelect
              kind="milestone"
              queryGeneration={pinned.generation}
              label={t("delivery.milestone")}
              value={draft.milestone_id}
              options={[{ value: "", label: tr("none") }]}
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
          <Button
            data-action="refresh-preview"
            disabled={locked || conflict}
            onClick={generatePreview}
          >
            {tr("preview")}
          </Button>
          <ActivityFieldChanges changes={preview.changes} />
          <RequirementImpactFacts preview={preview} />
          <p className="delivery-collaboration-help">{tr("confirmHint")}</p>
        </section>
      )}
    </Modal>
  );
}
