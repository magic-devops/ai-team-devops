import { Alert, Button, Checkbox, Input, Radio } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  diagnosisHistoryRequest,
  fetchDeliveryIssue,
  generateIssueDiagnosis,
  issueProblem,
  prepareDiagnosisGeneration,
  type DiagnosisForm,
  type DiagnosisSubmission,
  type DiagnosisView,
  type IssueDetail,
  type IssueEvidence,
} from "@/lib/deliveryIssue";
import { IssueEvidenceList, IssueProposalFacts } from "./DeliveryIssueFacts";
import { IssueOriginDirectory } from "./DeliveryIssueOrigins";

export type IssueDiagnosisPanelProps = {
  projectId: string;
  detail: IssueDetail;
  readOnly: boolean;
  onGenerated: (diagnosis: DiagnosisView) => void;
  onBusyChange?: (busy: boolean) => void;
  onUnresolvedChange?: (unresolved: boolean) => void;
};
export function IssueDiagnosisPanel({
  projectId,
  detail,
  readOnly,
  onGenerated,
  onBusyChange,
  onUnresolvedChange,
}: IssueDiagnosisPanelProps) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryIssue.${key}`);
  const [base, setBase] = useState(() => structuredClone(detail));
  const [originOpen, setOriginOpen] = useState(false),
    [originEvidence, setOriginEvidence] = useState<IssueEvidence[]>([]);
  const [form, setForm] = useState<DiagnosisForm>({
    generator: "ai",
    selected_evidence_ids: [],
    instructions: "",
  });
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [problem, setProblem] = useState<ReturnType<
    typeof issueProblem
  > | null>(null);
  const [latest, setLatest] = useState<IssueDetail | null>(null),
    [result, setResult] = useState<DiagnosisView | null>(null);
  const origin = useRef(projectSessionKey()),
    inFlight = useRef(false),
    controlsLocked = useRef(false),
    submission = useRef<DiagnosisSubmission>();
  const current = () =>
    origin.current === projectSessionKey() &&
    base.project_id === projectId &&
    base.issue.id === detail.issue.id;
  const assertCurrent = () => {
    if (!current()) throw new Error("scopeChanged");
  };
  const locked = busy || unknown || readOnly || !base.permissions.can_generate;
  controlsLocked.current = locked;
  const patch = (change: Partial<DiagnosisForm>) => {
    if (!controlsLocked.current && !inFlight.current && current()) {
      setForm({ ...form, ...change });
      setProblem(null);
    }
  };
  const begin = (clear = true) => {
    inFlight.current = true;
    controlsLocked.current = true;
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
  const receive = (value: DiagnosisView) => {
    assertCurrent();
    if (value.issue_id !== base.issue.id) throw new Error("scopeChanged");
    setResult(value);
    setUnknown(false);
    onUnresolvedChange?.(false);
    onGenerated(value);
  };
  const fail = (cause: unknown, submitted: boolean) => {
    if (!current()) return;
    const info = issueProblem(cause),
      unresolved = unknown || (submitted && info.unknown);
    if (
      /^HTTP (403|404):/.test(
        cause instanceof Error ? cause.message : String(cause),
      )
    )
      setOriginEvidence([]);
    controlsLocked.current =
      unresolved || readOnly || !base.permissions.can_generate;
    setProblem(info);
    setUnknown(unresolved);
    onUnresolvedChange?.(unresolved);
  };
  async function generate(regenerate = false, original = false) {
    if (
      inFlight.current ||
      readOnly ||
      (!original && (unknown || problem?.conflict)) ||
      !current()
    )
      return;
    let captured: DiagnosisSubmission;
    try {
      captured =
        original && submission.current
          ? submission.current
          : prepareDiagnosisGeneration(
              base,
              form,
              submission.current,
              regenerate,
              undefined,
              originEvidence,
            );
    } catch (cause) {
      fail(cause, false);
      return;
    }
    submission.current = captured;
    begin();
    try {
      assertCurrent();
      const value = await generateIssueDiagnosis(
        projectId,
        base.issue.id,
        captured.body,
      );
      receive(value);
    } catch (cause) {
      fail(cause, true);
    } finally {
      finish();
    }
  }
  async function recover() {
    if (inFlight.current || !submission.current || !current()) return;
    begin();
    try {
      const value = await diagnosisHistoryRequest(
        projectId,
        base.issue.id,
        submission.current.body.idempotency_key,
      );
      assertCurrent();
      if (value) receive(value);
      else
        setProblem({
          status: 0,
          message: tr("requestNotFound"),
          code: "request_not_found",
          conflict: false,
          stale: false,
          unknown: true,
        });
    } catch (cause) {
      fail(cause, false);
    } finally {
      finish();
    }
  }
  async function readLatest() {
    if (inFlight.current || unknown || !current()) return;
    begin(false);
    try {
      const value = await fetchDeliveryIssue(projectId, base.issue.id);
      assertCurrent();
      if (value.project_id !== projectId || value.issue.id !== base.issue.id)
        throw new Error("scopeChanged");
      setLatest(value);
    } catch (cause) {
      fail(cause, false);
    } finally {
      finish();
    }
  }
  const selected = [...base.evidence, ...originEvidence].filter((item) =>
    form.selected_evidence_ids.includes(item.id),
  );
  const mayGenerate =
    !locked &&
    !problem?.conflict &&
    form.selected_evidence_ids.length <= 32 &&
    form.selected_evidence_ids.includes(`issue:${base.issue.id}`) &&
    selected.length === form.selected_evidence_ids.length &&
    selected.every((item) => !item.restricted && !item.missing);
  return (
    <section className="issue-diagnosis" aria-label={tr("generateTitle")}>
      <header>
        <h3>{tr("generateTitle")}</h3>
        <p className="issue-meta">{tr("generateHint")}</p>
      </header>
      <fieldset>
        <legend>{tr("source")}</legend>
        <Radio.Group
          value={form.generator}
          disabled={locked}
          onChange={(event) => patch({ generator: event.target.value })}
        >
          <Radio value="ai">{tr("ai")}</Radio>
          <Radio value="rules">{tr("rules")}</Radio>
        </Radio.Group>
        <p className="issue-meta">
          {tr(form.generator === "ai" ? "aiHint" : "rulesHint")}
        </p>
      </fieldset>
      <fieldset>
        <legend>{tr("evidenceSelection")}</legend>
        <p className="issue-meta">{tr("evidenceSelectionHint")}</p>
        <Checkbox.Group
          disabled={locked}
          value={form.selected_evidence_ids.filter(
            (id) => !id.startsWith("event:"),
          )}
          onChange={(values) =>
            patch({
              selected_evidence_ids: [
                ...form.selected_evidence_ids.filter((id) =>
                  id.startsWith("event:"),
                ),
                ...values.map(String),
              ],
            })
          }
          options={base.evidence.map((item) => ({
            value: item.id,
            label: (
              <span>
                {tr(`kinds.${item.kind}`)} · {item.label}
                {item.restricted
                  ? ` · ${tr("restricted")}`
                  : item.missing
                    ? ` · ${tr("missing")}`
                    : ""}
              </span>
            ),
            disabled:
              item.restricted ||
              item.missing ||
              (!form.selected_evidence_ids.includes(item.id) &&
                form.selected_evidence_ids.length >= 32),
          }))}
        />
        <p className="issue-meta" role="status">
          {t("deliveryIssue.origins.selectedCount", {
            count: form.selected_evidence_ids.length,
            limit: 32,
          })}
        </p>
        <Button
          disabled={busy || unknown}
          onClick={() => setOriginOpen(!originOpen)}
        >
          {tr(originOpen ? "origins.hide" : "origins.select")}
        </Button>
        {originOpen && (
          <IssueOriginDirectory
            projectId={projectId}
            issueId={base.issue.id}
            background={typeof location === "undefined" ? "" : location.hash}
            disabled={locked}
            selectedIds={form.selected_evidence_ids}
            selectionCount={form.selected_evidence_ids.length}
            onUnavailable={() => {
              if (current()) setOriginEvidence([]);
            }}
            onSelection={(origin, checked) => {
              if (
                controlsLocked.current ||
                inFlight.current ||
                !current() ||
                !origin.available ||
                origin.evidence.restricted ||
                origin.evidence.missing ||
                origin.evidence.target.project_id !== projectId
              )
                return;
              const id = origin.evidence.id;
              if (
                checked &&
                !form.selected_evidence_ids.includes(id) &&
                form.selected_evidence_ids.length >= 32
              )
                return;
              setOriginEvidence((items) =>
                checked
                  ? [
                      ...items.filter((item) => item.id !== id),
                      structuredClone(origin.evidence),
                    ]
                  : items.filter((item) => item.id !== id),
              );
              patch({
                selected_evidence_ids: checked
                  ? [...new Set([...form.selected_evidence_ids, id])]
                  : form.selected_evidence_ids.filter((value) => value !== id),
              });
            }}
          />
        )}
        {form.selected_evidence_ids.some((id) => id.startsWith("event:")) && (
          <ul className="issue-selected-origins">
            {form.selected_evidence_ids
              .filter((id) => id.startsWith("event:"))
              .map((id) => (
                <li key={id}>
                  <span>
                    {originEvidence.find((item) => item.id === id)?.label || id}
                  </span>
                  <Button
                    size="small"
                    disabled={locked}
                    aria-label={`${tr("origins.remove")} ${id}`}
                    onClick={() => {
                      if (locked || !current()) return;
                      setOriginEvidence((items) =>
                        items.filter((item) => item.id !== id),
                      );
                      patch({
                        selected_evidence_ids:
                          form.selected_evidence_ids.filter(
                            (value) => value !== id,
                          ),
                      });
                    }}
                  >
                    {tr("origins.remove")}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </fieldset>
      <label className="issue-field">
        <span>{tr("instructions")}</span>
        <Input.TextArea
          aria-label={tr("instructions")}
          value={form.instructions}
          maxLength={4000}
          rows={3}
          disabled={locked}
          onChange={(event) => patch({ instructions: event.target.value })}
        />
      </label>
      <details className="issue-payload" open>
        <summary>
          {tr("payloadPreview")} ({selected.length})
        </summary>
        <p className="issue-meta">{tr("payloadHint")}</p>
        {selected.length ? (
          <IssueEvidenceList
            evidence={selected}
            projectId={projectId}
            captured
          />
        ) : (
          <p className="issue-meta">{tr("evidenceRequired")}</p>
        )}
      </details>
      <div className="issue-actions">
        <Button
          type="primary"
          loading={busy}
          disabled={!mayGenerate}
          onClick={() => generate()}
        >
          {tr("generate")}
        </Button>
        <Button
          disabled={!mayGenerate || !submission.current}
          onClick={() => generate(true)}
        >
          {tr("regenerate")}
        </Button>
        {submission.current && (
          <Button disabled={busy} onClick={recover}>
            {tr("recoverRequest")}
          </Button>
        )}
      </div>
      {unknown && (
        <Alert
          type="warning"
          showIcon
          title={tr("unknownRequest")}
          description={
            <Button
              disabled={busy || readOnly}
              onClick={() => generate(false, true)}
            >
              {tr("retryOriginal")}
            </Button>
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
          {latest && (
            <Button
              disabled={busy || !latest.permissions.can_generate}
              onClick={() => {
                if (!current()) return;
                if (latest.issue_basis !== base.issue_basis) {
                  setForm({ ...form, selected_evidence_ids: [] });
                  setOriginEvidence([]);
                }
                setBase(latest);
                submission.current = undefined;
                setLatest(null);
                setProblem(null);
              }}
            >
              {tr(
                latest.issue_basis === base.issue_basis
                  ? "adoptLatest"
                  : "adoptNewEvidence",
              )}
            </Button>
          )}
        </div>
      )}
      {latest && latest.issue_basis !== base.issue_basis && (
        <Alert type="warning" title={tr("basisChanged")} />
      )}
      {result && <IssueProposalFacts diagnosis={result} />}
    </section>
  );
}
