import { Alert, Button, Drawer, Input, Select } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  prepareReleaseCandidate,
  previewDeliveryRelease,
  releaseProblem,
  submitReleaseCommand,
  type DeliveryReleases,
  type ReleaseDraft,
  type ReleaseForm,
  type ReleaseScope,
} from "@/lib/deliveryRelease";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { ReleaseReasons, ReleaseSnapshotFacts } from "./DeliveryReleaseFacts";

export function DeliveryReleaseEditor({
  projectId,
  initial,
  selected,
  onSaved,
  onClose,
  readOnly = false,
}: {
  projectId: string;
  initial: DeliveryReleases;
  selected: ReleaseScope;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const [draft, setDraft] = useState<ReleaseDraft>(() => ({
    projectId,
    form: {
      ...structuredClone(selected),
      version: "",
      environment: "",
      ci_evidence_id: "",
      artifact_url: "",
      release_notes: "",
      rollback_plan: "",
    },
    preview: null,
    intent: { version: initial.version, key: crypto.randomUUID() },
  }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const allowed = !readOnly && initial.permissions.can_create;
  const check = () => {
    if (origin.current !== projectSessionKey() || projectId !== draft.projectId)
      throw new Error("scopeChanged");
  };
  const showError = (problem: unknown) => {
    const info = releaseProblem(problem);
    setConflict(info.conflict);
    setError(
      t(`deliveryReleaseReasons.${info.code}`, {
        defaultValue: t(`deliveryRelease.${info.message}`, {
          defaultValue: info.message,
        }),
      }),
    );
  };
  const change = (patch: Partial<ReleaseForm>) => {
    setDraft({ ...draft, form: { ...draft.form, ...patch }, preview: null });
    setError("");
    setConflict(false);
  };
  const read = async () => {
    if (busy || !allowed) return;
    setBusy("preview");
    setError("");
    setDraft({ ...draft, preview: null });
    try {
      check();
      const preview = await previewDeliveryRelease(projectId, draft.form);
      check();
      setDraft({
        ...draft,
        preview,
        intent: { version: preview.version, key: crypto.randomUUID() },
      });
      setConflict(false);
    } catch (problem) {
      showError(problem);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (busy || conflict || !allowed) return;
    setBusy("save");
    setError("");
    try {
      check();
      const prepared = prepareReleaseCandidate(draft);
      setDraft(prepared.draft);
      const updated = await submitReleaseCommand(
        projectId,
        "release.candidate.create",
        prepared.payload,
        { version: prepared.version, key: prepared.key },
      );
      check();
      onSaved(updated);
      onClose();
    } catch (problem) {
      showError(problem);
    } finally {
      setBusy("");
    }
  };
  const fields = [
    ["version", "version", 80],
    ["environment", "environment", 80],
    ["artifact_url", "artifactUrl", 2000],
    ["release_notes", "notes", 10000],
    ["rollback_plan", "rollback", 10000],
  ] as const;
  const evidenceOptions = initial.evidence.map((item) => ({
    value: item.id,
    label: `${item.id} · ${item.statement.predicate.commit_sha.slice(0, 12)} · ${item.statement.predicate.run_number}.${item.statement.predicate.run_attempt}${item.current && item.passed ? "" : ` · ${tr("evidenceHistorical")}`}`,
    disabled: !item.current || !item.passed,
  }));
  if (
    draft.form.ci_evidence_id &&
    !initial.evidence.some((item) => item.id === draft.form.ci_evidence_id)
  )
    evidenceOptions.push({
      value: draft.form.ci_evidence_id,
      label: `${draft.form.ci_evidence_id} · ${tr("evidenceMissing")}`,
      disabled: true,
    });
  return (
    <Drawer
      open
      title={tr("create")}
      width="min(940px, 100vw)"
      rootClassName="delivery-release-drawer"
      onClose={() => !busy && onClose()}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <div className="delivery-release-actions">
          <Button disabled={Boolean(busy)} onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button
            loading={busy === "preview"}
            disabled={Boolean(busy) || !allowed}
            onClick={read}
          >
            {tr(conflict ? "readLatest" : "preview")}
          </Button>
          <Button
            type="primary"
            loading={busy === "save"}
            disabled={
              Boolean(busy) ||
              !allowed ||
              conflict ||
              !draft.preview?.allowed ||
              !draft.preview.permissions.can_create
            }
            onClick={save}
          >
            {tr("confirm")}
          </Button>
        </div>
      }
    >
      <div className="delivery-release-editor">
        <Alert type="info" showIcon title={tr("previewHint")} />
        {error && (
          <Alert
            type="error"
            showIcon
            title={tr(conflict ? "conflict" : "saveFailed")}
            description={error}
          />
        )}
        <section className="delivery-release-selection">
          <strong>{tr("capturedScope")}</strong>
          <p>
            {t("deliveryRelease.scopeCount", {
              requirements: draft.form.requirement_ids.length,
              tasks: draft.form.task_ids.length,
            })}
          </p>
          <p className="delivery-release-id">
            {[...draft.form.requirement_ids, ...draft.form.task_ids].join(
              " · ",
            )}
          </p>
        </section>
        <div className="delivery-release-form-grid">
          {fields.map(([key, label, max]) => (
            <label className={max > 80 ? "is-wide" : ""} key={key}>
              <span>{tr(label)} *</span>
              {max > 2000 ? (
                <Input.TextArea
                  aria-label={tr(label)}
                  value={draft.form[key]}
                  disabled={Boolean(busy)}
                  maxLength={max}
                  rows={3}
                  onChange={(event) => change({ [key]: event.target.value })}
                />
              ) : (
                <Input
                  aria-label={tr(label)}
                  value={draft.form[key]}
                  disabled={Boolean(busy)}
                  maxLength={max}
                  onChange={(event) => change({ [key]: event.target.value })}
                />
              )}
            </label>
          ))}
          <label className="is-wide">
            <span>{tr("chooseEvidence")} *</span>
            <Select
              aria-label={tr("chooseEvidence")}
              value={draft.form.ci_evidence_id}
              onChange={(value: string) => change({ ci_evidence_id: value })}
              disabled={Boolean(busy)}
              showSearch
              optionFilterProp="label"
              options={[
                { value: "", label: tr("chooseEvidence"), disabled: true },
                ...evidenceOptions,
              ]}
            />
          </label>
        </div>
        {draft.preview && (
          <section
            aria-label={tr("preview")}
            className="delivery-release-preview"
          >
            <Alert
              type={draft.preview.allowed && !conflict ? "success" : "warning"}
              title={tr(
                draft.preview.allowed && !conflict ? "allowed" : "blocked",
              )}
            />
            <ReleaseReasons
              reasons={draft.preview.reasons}
              background={location.hash}
            />
            {draft.preview.snapshot && (
              <ReleaseSnapshotFacts
                snapshot={draft.preview.snapshot}
                background={location.hash}
              />
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
