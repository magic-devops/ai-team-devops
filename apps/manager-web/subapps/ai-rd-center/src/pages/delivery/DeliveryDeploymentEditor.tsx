import { Alert, Button, Drawer, Input, Select } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryWorkspace } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  deploymentProblem,
  prepareDeployment,
  previewDeliveryDeployment,
  submitDeploymentCommand,
  type DeploymentDraft,
  type DeploymentIndex,
} from "@/lib/deliveryDeployment";
import {
  DeploymentReasons,
  DeploymentSnapshotFacts,
} from "./DeliveryDeploymentFacts";

export function DeliveryDeploymentEditor({
  projectId,
  initial,
  candidateId,
  rollbackOf,
  background,
  readOnly = false,
  onClose,
  onSaved,
}: {
  projectId: string;
  initial: DeploymentIndex;
  candidateId: string;
  rollbackOf: string;
  background: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (data: DeliveryWorkspace) => void;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const origin = useRef(projectSessionKey());
  const [draft, setDraft] = useState<DeploymentDraft>(() => ({
    projectId,
    form: {
      candidate_id: rollbackOf ? "" : candidateId,
      environment_id: "",
      rollback_of: rollbackOf,
      reason: "",
    },
    preview: null,
    intent: { version: initial.version, key: crypto.randomUUID() },
  }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const allowed = !readOnly && initial.permissions.can_prepare;
  const check = () => {
    if (origin.current !== projectSessionKey() || projectId !== draft.projectId)
      throw new Error("scopeChanged");
  };
  const change = (patch: Partial<DeploymentDraft["form"]>) => {
    if (busy || unknown) return;
    setDraft({ ...draft, form: { ...draft.form, ...patch }, preview: null });
    setConflict(false);
    setError("");
  };
  const fail = (problem: unknown, submitted: boolean) => {
    const info = deploymentProblem(problem);
    setConflict(info.conflict);
    setUnknown(submitted && info.unknown);
    setError(
      t(`deliveryDeploymentReasons.${info.code}`, {
        defaultValue: t(`deliveryDeployment.${info.message}`, {
          defaultValue: info.message,
        }),
      }),
    );
  };
  const preview = async () => {
    if (busy || unknown || !allowed) return;
    setBusy("preview");
    setError("");
    setDraft({ ...draft, preview: null });
    try {
      check();
      const result = await previewDeliveryDeployment(projectId, draft.form);
      check();
      setDraft({
        ...draft,
        preview: result,
        intent: { version: result.version, key: crypto.randomUUID() },
      });
      setConflict(false);
    } catch (problem) {
      fail(problem, false);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (busy || conflict || !allowed) return;
    setBusy("save");
    setError("");
    let submitted = false;
    try {
      check();
      const prepared = prepareDeployment(draft);
      setDraft(prepared.draft);
      submitted = true;
      const updated = await submitDeploymentCommand(
        projectId,
        "deployment.create",
        prepared.payload,
        prepared.intent,
      );
      check();
      onSaved(updated);
      onClose();
    } catch (problem) {
      fail(problem, submitted);
    } finally {
      setBusy("");
    }
  };
  return (
    <Drawer
      open
      title={tr(rollbackOf ? "rollback" : "prepare")}
      width="min(980px, 100vw)"
      rootClassName="delivery-release-drawer deployment-drawer"
      onClose={() => !busy && !unknown && onClose()}
      maskClosable={!busy && !unknown}
      keyboard={!busy && !unknown}
      footer={
        <div className="delivery-release-actions">
          <Button disabled={Boolean(busy) || unknown} onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button
            disabled={Boolean(busy) || unknown || !allowed}
            loading={busy === "preview"}
            onClick={preview}
          >
            {tr("preview")}
          </Button>
          {unknown && (
            <Button
              disabled={Boolean(busy) || !allowed}
              loading={busy === "save"}
              onClick={save}
            >
              {tr("queryOriginal")}
            </Button>
          )}
          <Button
            type="primary"
            danger={Boolean(rollbackOf)}
            disabled={
              Boolean(busy) ||
              unknown ||
              conflict ||
              !allowed ||
              !draft.preview?.allowed ||
              !draft.preview.permissions.can_prepare
            }
            loading={busy === "save"}
            onClick={save}
          >
            {tr(rollbackOf ? "confirmRollback" : "confirmDeploy")}
          </Button>
        </div>
      }
    >
      <div className="deployment-editor">
        <section className="deployment-inputs">
          {!allowed && (
            <Alert
              type="info"
              showIcon
              title={
                initial.permissions.can_prepare
                  ? tr("restricted")
                  : t("deliveryDeploymentReasons.deployment_execute_required")
              }
            />
          )}
          {unknown && (
            <Alert type="warning" showIcon title={tr("unknownRequest")} />
          )}
          {error && (
            <Alert
              type="error"
              showIcon
              title={tr(conflict ? "conflict" : "error")}
              description={error}
            />
          )}
          {rollbackOf ? (
            <Alert
              type="warning"
              showIcon
              title={`${tr("rollback")} · ${rollbackOf}`}
              description={tr("rollbackHint")}
            />
          ) : (
            <>
              <p className="delivery-release-id">
                {tr("candidate")} · {candidateId}
              </p>
              <label>
                <span>{tr("environment")} *</span>
                <Select
                  aria-label={tr("environment")}
                  value={draft.form.environment_id}
                  disabled={!allowed || Boolean(busy) || unknown}
                  onChange={(value) => change({ environment_id: value })}
                  options={initial.environments.map((environment) => ({
                    value: environment.id,
                    label: `${environment.name} · ${tr("generation")} ${environment.generation}`,
                    disabled: !environment.active,
                  }))}
                />
              </label>
              {!initial.environments.length && (
                <Alert type="info" title={tr("noEnvironments")} />
              )}
            </>
          )}
          <label>
            <span>{tr("reason")} *</span>
            <Input.TextArea
              aria-label={tr("reason")}
              value={draft.form.reason}
              rows={4}
              maxLength={2000}
              disabled={!allowed || Boolean(busy) || unknown}
              onChange={(event) => change({ reason: event.target.value })}
            />
          </label>
        </section>
        <section className="deployment-preview" aria-label={tr("fixedPlan")}>
          <h3>{tr("fixedPlan")}</h3>
          {draft.preview ? (
            <>
              <Alert
                type={
                  draft.preview.allowed && !conflict ? "success" : "warning"
                }
                showIcon
                title={tr(
                  draft.preview.allowed && !conflict
                    ? "fixedPlan"
                    : "previewRequired",
                )}
              />
              <DeploymentReasons reasons={draft.preview.reasons} />
              {draft.preview.snapshot && (
                <DeploymentSnapshotFacts
                  snapshot={draft.preview.snapshot}
                  background={background}
                />
              )}
            </>
          ) : (
            <p className="delivery-release-meta">{tr("previewRequired")}</p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
