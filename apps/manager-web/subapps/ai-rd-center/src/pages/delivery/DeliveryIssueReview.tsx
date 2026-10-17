import { Alert, Button, Input, Select, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDelivery, type DeliveryWorkspace } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchIssueDiagnosis,
  fetchDeliveryIssue,
  issueEvidenceHref,
  issueProblem,
  prepareIssueDismissal,
  prepareIssueReview,
  submitIssueReview,
  type DiagnosisView,
  type IssueDetail,
  type IssueReviewCommand,
  type IssueReviewForm,
} from "@/lib/deliveryIssue";
import { IssueReasons } from "./DeliveryIssueFacts";
export type IssueReviewPanelProps = {
  projectId: string;
  detail: IssueDetail | null;
  workspaceVersion?: number;
  diagnosis: DiagnosisView;
  background: string;
  readOnly: boolean;
  onSaved: (workspace: DeliveryWorkspace) => void;
  onBusyChange?: (busy: boolean) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
};
export function IssueReviewPanel({
  projectId,
  detail,
  workspaceVersion,
  diagnosis,
  background,
  readOnly,
  onSaved,
  onBusyChange,
  onUnresolvedChange,
}: IssueReviewPanelProps) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`);
  const [base, setBase] = useState(() => structuredClone(detail)),
    [proposal, setProposal] = useState(() => structuredClone(diagnosis));
  const [form, setForm] = useState<IssueReviewForm>(() => ({
    title: diagnosis.result?.requirement.title || "",
    description: diagnosis.result?.requirement.description || "",
    priority: diagnosis.result?.requirement.priority || "P1",
    acceptance_criteria:
      diagnosis.result?.requirement.acceptance_criteria || [],
    comment: "",
  }));
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [completed, setCompleted] = useState(false);
  const [problem, setProblem] = useState<ReturnType<
      typeof issueProblem
    > | null>(null),
    [latest, setLatest] = useState<IssueDetail | null>(null);
  const [preview, setPreview] = useState<IssueReviewCommand | null>(null);
  const [latestProposal, setLatestProposal] = useState<DiagnosisView | null>(
    null,
  );
  const [version, setVersion] = useState(
      detail?.version ?? workspaceVersion ?? -1,
    ),
    [latestVersion, setLatestVersion] = useState<number | null>(null);
  const [linkedRequirementId, setLinkedRequirementId] = useState(
    diagnosis.review?.requirement_id || detail?.requirement_id || "",
  );
  const command = useRef<IssueReviewCommand>(),
    origin = useRef(projectSessionKey()),
    inFlight = useRef(false);
  const current = () =>
    origin.current === projectSessionKey() &&
    (!base ||
      (base.project_id === projectId && base.issue.id === diagnosis.issue_id));
  const assertCurrent = () => {
    if (!current()) throw new Error("scopeChanged");
  };
  const locked = busy || unknown || completed || readOnly;
  const patch = (change: Partial<IssueReviewForm>) => {
    if (locked || !current()) return;
    setForm({ ...form, ...change });
    setPreview(null);
  };
  const begin = (clear = true) => {
    inFlight.current = true;
    setBusy(true);
    if (clear) setProblem(null);
    onBusyChange?.(true);
  };
  const finish = () => {
    inFlight.current = false;
    if (current()) {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  const fail = (cause: unknown, submitted: boolean) => {
    if (!current()) return;
    const info = issueProblem(cause),
      unresolved = unknown || (submitted && info.unknown);
    setProblem(info);
    setUnknown(unresolved);
    onUnresolvedChange?.(unresolved);
  };
  const prepare = (decision: "adopt" | "dismiss") => {
    if (locked || problem?.conflict || !current()) return;
    try {
      if (decision === "adopt" && !base) return;
      setPreview(
        decision === "dismiss"
          ? prepareIssueDismissal(
              projectId,
              proposal,
              version,
              form.comment,
              command.current,
            )
          : prepareIssueReview(
              base!,
              proposal,
              decision,
              form,
              command.current,
            ),
      );
      setProblem(null);
    } catch (cause) {
      fail(cause, false);
    }
  };
  async function save(original = false) {
    const captured = original ? command.current : preview;
    if (
      !captured ||
      inFlight.current ||
      readOnly ||
      completed ||
      (!original && (unknown || problem?.conflict)) ||
      !current()
    )
      return;
    command.current = captured;
    begin();
    try {
      assertCurrent();
      const workspace = await submitIssueReview(projectId, captured);
      assertCurrent();
      if (workspace.project.id !== projectId) throw new Error("scopeChanged");
      const requirement = workspace.requirements?.find(
        (item) => item.flow.source_issue_id === proposal.issue_id,
      );
      if (requirement) setLinkedRequirementId(requirement.id);
      setCompleted(true);
      setUnknown(false);
      onUnresolvedChange?.(false);
      onSaved(workspace);
    } catch (cause) {
      fail(cause, true);
    } finally {
      finish();
    }
  }
  async function readLatest() {
    if (inFlight.current || unknown || !current()) return;
    begin(false);
    try {
      if (base) {
        const [value, fresh] = await Promise.all([
          fetchDeliveryIssue(projectId, base.issue.id),
          fetchIssueDiagnosis(projectId, proposal.issue_id, proposal.id),
        ]);
        assertCurrent();
        if (
          value.project_id !== projectId ||
          value.issue.id !== base.issue.id ||
          fresh.id !== proposal.id ||
          fresh.issue_id !== proposal.issue_id ||
          fresh.issue_basis !== proposal.issue_basis
        )
          throw new Error("scopeChanged");
        setLatest(value);
        setLatestProposal(fresh);
      } else {
        const [value, fresh] = await Promise.all([
          fetchDelivery(projectId),
          fetchIssueDiagnosis(projectId, proposal.issue_id, proposal.id),
        ]);
        assertCurrent();
        if (
          value.project.id !== projectId ||
          fresh.id !== proposal.id ||
          fresh.issue_id !== proposal.issue_id ||
          fresh.issue_basis !== proposal.issue_basis
        )
          throw new Error("scopeChanged");
        setLatestVersion(value.version);
        setLatestProposal(fresh);
      }
    } catch (cause) {
      fail(cause, false);
    } finally {
      finish();
    }
  }
  async function recover() {
    if (inFlight.current || !command.current || !current()) return;
    begin();
    try {
      const found = await fetchIssueDiagnosis(
        projectId,
        proposal.issue_id,
        proposal.id,
      );
      assertCurrent();
      if (!found || found.id !== proposal.id || !found.review) {
        setProblem({
          message: tr("reviewNotFound"),
          code: "review_not_found",
          conflict: false,
          stale: false,
          unknown: true,
        });
        return;
      }
      const workspace = await fetchDelivery(projectId);
      assertCurrent();
      if (workspace.project.id !== projectId) throw new Error("scopeChanged");
      setProposal(found);
      if (found.review.requirement_id)
        setLinkedRequirementId(found.review.requirement_id);
      setCompleted(true);
      setUnknown(false);
      onUnresolvedChange?.(false);
      onSaved(workspace);
    } catch (cause) {
      if (current()) setProblem(issueProblem(cause));
    } finally {
      finish();
    }
  }
  const canAdopt = Boolean(
    !locked &&
    base &&
    proposal.actions.can_adopt &&
    base.permissions.can_adopt &&
    proposal.current &&
    !proposal.restricted &&
    proposal.issue_basis === base.issue_basis &&
    detail?.issue_basis === proposal.issue_basis,
  );
  const freshProposal = latestProposal;
  const rebasingDismissal =
    command.current?.action === "issue.diagnosis.dismiss";
  const latestCompatible =
    latest &&
    freshProposal &&
    (rebasingDismissal
      ? freshProposal.actions.can_dismiss
      : latest.issue_basis === proposal.issue_basis &&
        freshProposal.current &&
        !freshProposal.restricted &&
        freshProposal.actions.can_adopt &&
        latest.permissions.can_adopt);
  const orphanCompatible =
    latestVersion !== null && freshProposal?.actions.can_dismiss;
  const requirementId =
    linkedRequirementId ||
    proposal.review?.requirement_id ||
    base?.requirement_id;
  const requirementHref = requirementId
    ? issueEvidenceHref(
        projectId,
        {
          project_id: projectId,
          requirement_id: requirementId,
          view: "list",
          detail: "details",
        },
        background,
      )
    : null;
  return (
    <section className="issue-review" aria-label={tr("reviewTitle")}>
      <header>
        <h3>{tr("reviewTitle")}</h3>
        <p className="issue-meta">{tr("reviewHint")}</p>
      </header>
      {requirementHref && (
        <Alert
          type="info"
          showIcon
          title={tr("existingRequirement")}
          description={
            <>
              <p>{tr("existingRequirementHint")}</p>
              <Button href={requirementHref}>{tr("openRequirement")}</Button>
            </>
          }
        />
      )}
      {!proposal.current && (
        <Alert type="warning" title={tr("historicalHint")} />
      )}
      {completed ? (
        <Alert
          type="success"
          showIcon
          title={tr(
            command.current?.action === "issue.diagnosis.adopt"
              ? "adopted"
              : "dismissed",
          )}
          description={tr("issueStillOpen")}
        />
      ) : (
        <>
          {proposal.result && base && (
            <div className="issue-review-fields">
              <label className="issue-field">
                <span>{tr("requirementTitle")}</span>
                <Input
                  aria-label={tr("requirementTitle")}
                  value={form.title}
                  maxLength={256}
                  disabled={locked || !canAdopt}
                  onChange={(event) => patch({ title: event.target.value })}
                />
              </label>
              <label className="issue-field">
                <span>{tr("requirementDescription")}</span>
                <Input.TextArea
                  aria-label={tr("requirementDescription")}
                  value={form.description}
                  rows={5}
                  maxLength={20000}
                  disabled={locked || !canAdopt}
                  onChange={(event) =>
                    patch({ description: event.target.value })
                  }
                />
              </label>
              <label className="issue-field">
                <span>{tr("priority")}</span>
                <Select
                  aria-label={tr("priority")}
                  value={form.priority}
                  disabled={locked || !canAdopt}
                  options={["P0", "P1", "P2", "P3"].map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(value) => patch({ priority: value })}
                />
              </label>
              <label className="issue-field">
                <span>{tr("acceptanceCriteria")}</span>
                <Input.TextArea
                  aria-label={tr("acceptanceCriteria")}
                  value={form.acceptance_criteria.join("\n")}
                  rows={5}
                  maxLength={80000}
                  disabled={locked || !canAdopt}
                  onChange={(event) =>
                    patch({
                      acceptance_criteria: event.target.value.split(/\r?\n/),
                    })
                  }
                />
              </label>
            </div>
          )}
          <label className="issue-field">
            <span>{tr("comment")}</span>
            <Input.TextArea
              aria-label={tr("comment")}
              value={form.comment}
              rows={3}
              maxLength={4000}
              disabled={locked}
              onChange={(event) => patch({ comment: event.target.value })}
            />
          </label>
          <div className="issue-actions">
            <Button
              type="primary"
              disabled={
                !canAdopt || !form.comment.trim() || Boolean(problem?.conflict)
              }
              onClick={() => prepare("adopt")}
            >
              {tr("previewAdoption")}
            </Button>
            <Button
              disabled={
                locked ||
                !proposal.actions.can_dismiss ||
                !form.comment.trim() ||
                Boolean(problem?.conflict)
              }
              onClick={() => prepare("dismiss")}
            >
              {tr("previewDismissal")}
            </Button>
          </div>
          {preview && (
            <section
              className="issue-review-preview"
              aria-label={tr("reviewPreview")}
            >
              <h4>{tr("reviewPreview")}</h4>
              <Tag>
                {tr(
                  preview.action === "issue.diagnosis.adopt"
                    ? "adoptRequirement"
                    : "dismissProposal",
                )}
              </Tag>
              {preview.action === "issue.diagnosis.adopt" && (
                <>
                  <strong>{preview.payload.title}</strong>
                  <p>{preview.payload.description}</p>
                  <ul>
                    {preview.payload.acceptance_criteria?.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
              <blockquote>{preview.payload.comment}</blockquote>
              <p className="issue-meta">{tr("issueStillOpen")}</p>
              <Button
                type="primary"
                loading={busy}
                disabled={locked || Boolean(problem?.conflict)}
                onClick={() => save()}
              >
                {tr(
                  preview.action === "issue.diagnosis.adopt"
                    ? "confirmAdoption"
                    : "confirmDismissal",
                )}
              </Button>
            </section>
          )}
        </>
      )}
      {unknown && (
        <Alert
          type="warning"
          showIcon
          title={tr("unknownRequest")}
          description={
            <div className="issue-actions">
              <Button disabled={busy} onClick={recover}>
                {tr("recoverRequest")}
              </Button>
              <Button disabled={busy || readOnly} onClick={() => save(true)}>
                {tr("retryOriginal")}
              </Button>
            </div>
          }
        />
      )}
      {problem && (
        <Alert
          type="error"
          showIcon
          title={tr(problem.conflict ? "conflict" : "error")}
          description={t(`deliveryIssue.reasons.${problem.code}`, {
            defaultValue: t(`deliveryIssue.${problem.message}`, {
              defaultValue: problem.message,
            }),
          })}
        />
      )}
      {problem?.conflict && !unknown && (
        <div className="issue-actions">
          <Button disabled={busy} onClick={readLatest}>
            {tr("readLatest")}
          </Button>
          {(latest || latestVersion !== null) && (
            <Button
              disabled={busy || (base ? !latestCompatible : !orphanCompatible)}
              onClick={() => {
                if (!current()) return;
                if (base) {
                  if (!latest || !latestCompatible || !freshProposal) return;
                  setBase(latest);
                  setVersion(latest.version);
                  setProposal(freshProposal);
                  setLatest(null);
                } else {
                  if (
                    latestVersion === null ||
                    !orphanCompatible ||
                    !freshProposal
                  )
                    return;
                  setVersion(latestVersion);
                  setProposal(freshProposal);
                  setLatestVersion(null);
                }
                setLatestProposal(null);
                setPreview(null);
                command.current = undefined;
                setProblem(null);
              }}
            >
              {tr("adoptLatest")}
            </Button>
          )}
        </div>
      )}
      {latest && !latestCompatible && (
        <Alert type="warning" title={tr("basisChanged")} />
      )}
      <IssueReasons reasons={proposal.actions.reasons} />
    </section>
  );
}
