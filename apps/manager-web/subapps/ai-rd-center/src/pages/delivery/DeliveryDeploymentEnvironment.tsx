import { Alert, Button, Checkbox, Drawer, Input } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  deploymentEnvironmentForm,
  deploymentEnvironmentInput,
  deploymentProblem,
  fetchDeliveryDeployments,
  submitDeploymentCommand,
  type DeploymentEnvironment,
  type DeploymentEnvironmentForm,
  type DeploymentIndex,
} from "@/lib/deliveryDeployment";

export function DeliveryDeploymentEnvironment({
  projectId,
  initial,
  environment,
  readOnly,
  onClose,
  onSaved,
}: {
  projectId: string;
  initial: DeploymentIndex;
  environment?: DeploymentEnvironment;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (data: DeliveryCommandAck) => void;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryDeployment.${key}`);
  const origin = useRef(projectSessionKey());
  const [form, setForm] = useState(() =>
    deploymentEnvironmentForm(environment),
  );
  const [intent, setIntent] = useState<DeliveryIntent>(() => ({
    version: initial.version,
    key: crypto.randomUUID(),
  }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [latest, setLatest] = useState<DeploymentIndex | null>(null);
  const allowed =
    !readOnly &&
    initial.permissions.can_configure &&
    (!environment || environment.can_edit);
  const check = () => {
    if (origin.current !== projectSessionKey()) throw new Error("scopeChanged");
  };
  const save = async () => {
    if (busy || conflict || !allowed) return;
    setBusy("save");
    setError("");
    let submitted = false;
    try {
      check();
      const payload = deploymentEnvironmentInput(form),
        next = prepareDeliveryIntent(
          intent,
          "deployment.environment.save",
          payload,
        );
      setIntent(next);
      submitted = true;
      const updated = await submitDeploymentCommand(
        projectId,
        "deployment.environment.save",
        payload,
        next,
      );
      check();
      onSaved(updated);
      onClose();
    } catch (problem) {
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
    } finally {
      setBusy("");
    }
  };
  const readLatest = async () => {
    if (busy || unknown) return;
    setBusy("read");
    setLatest(null);
    try {
      check();
      const latest = await fetchDeliveryDeployments(projectId);
      check();
      if (latest.project_id !== projectId) throw new Error("scopeChanged");
      const current = latest.environments.find((row) => row.id === form.id);
      if (!latest.permissions.can_configure || (form.id && !current?.can_edit))
        throw new Error("restricted");
      setLatest(latest);
      setError("");
    } catch (problem) {
      setError(
        t(`deliveryDeployment.${(problem as Error).message}`, {
          defaultValue: String(problem),
        }),
      );
    } finally {
      setBusy("");
    }
  };
  const fields: [keyof DeploymentEnvironmentForm, string, boolean?][] = [
    ["name", "environment"],
    ["workspace_id", "workspace"],
    ["target_device_id", "device"],
    ["runner_argv", "runner", true],
    ["apply_argv", "apply", true],
    ["probe_argv", "probe", true],
    ["artifact_origins", "origins", true],
    ["traffic_steps", "trafficSteps", true],
    ["max_artifact_bytes", "maxBytes"],
    ["timeout_seconds", "timeout"],
    ["observation_seconds", "seconds"],
    ["min_samples", "minSamples"],
  ];
  return (
    <Drawer
      open
      title={tr(environment ? "editEnvironment" : "newEnvironment")}
      width="min(800px, 100vw)"
      rootClassName="delivery-release-drawer deployment-drawer"
      onClose={() => !busy && !unknown && onClose()}
      maskClosable={!busy && !unknown}
      keyboard={!busy && !unknown}
      footer={
        <div className="delivery-release-actions">
          <Button disabled={Boolean(busy) || unknown} onClick={onClose}>
            {tr("cancel")}
          </Button>
          {conflict && (
            <Button
              loading={busy === "read"}
              disabled={Boolean(busy)}
              onClick={readLatest}
            >
              {t("deliveryRelease.readLatest")}
            </Button>
          )}
          {unknown && (
            <Button
              loading={busy === "save"}
              disabled={Boolean(busy) || !allowed}
              onClick={save}
            >
              {tr("queryOriginal")}
            </Button>
          )}
          <Button
            type="primary"
            loading={busy === "save"}
            disabled={Boolean(busy) || conflict || unknown || !allowed}
            onClick={save}
          >
            {tr("save")}
          </Button>
        </div>
      }
    >
      <div className="deployment-environment-form">
        <Alert type="info" showIcon title={tr("configuredOnly")} />
        {!allowed && (
          <Alert
            type="warning"
            showIcon
            title={tr(environment?.locked_by.length ? "locked" : "restricted")}
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
        {latest && (
          <section className="deployment-preview">
            <strong>{t("deliveryRelease.latest")}</strong>
            <pre tabIndex={0} className="deployment-log">
              {JSON.stringify(
                form.id
                  ? latest.environments.find((row) => row.id === form.id)
                  : latest.environments.map((row) => ({
                      id: row.id,
                      name: row.name,
                      generation: row.generation,
                    })),
                null,
                2,
              )}
            </pre>
            <Button
              disabled={Boolean(busy)}
              onClick={() => {
                setIntent({
                  version: latest.version,
                  key: crypto.randomUUID(),
                });
                setConflict(false);
                setLatest(null);
              }}
            >
              {t("deliveryRelease.adopt")}
            </Button>
          </section>
        )}
        <p className="delivery-release-meta">{tr("tokenHint")}</p>
        <div className="delivery-release-form-grid">
          {fields.map(([key, label, area]) => (
            <label key={key} className={area ? "is-wide" : undefined}>
              <span>{tr(label)}</span>
              {area ? (
                <Input.TextArea
                  aria-label={tr(label)}
                  rows={2}
                  value={String(form[key])}
                  disabled={!allowed || Boolean(busy) || unknown}
                  onChange={(event) =>
                    setForm({ ...form, [key]: event.target.value })
                  }
                />
              ) : (
                <Input
                  aria-label={tr(label)}
                  value={String(form[key])}
                  disabled={!allowed || Boolean(busy) || unknown}
                  onChange={(event) =>
                    setForm({ ...form, [key]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>
        <Checkbox
          checked={form.active}
          disabled={!allowed || Boolean(busy) || unknown}
          onChange={(event) =>
            setForm({ ...form, active: event.target.checked })
          }
        >
          {tr("active")}
        </Checkbox>
      </div>
    </Drawer>
  );
}
