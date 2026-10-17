import { Alert, Button, Checkbox, Modal, Space } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { request } from "@/lib/http";
import {
  fetchDeliveryTargets,
  type ExecutionPolicy,
  type ExecutionTarget,
} from "@/lib/deliveryExecution";
import { ExecutionTargetFacts } from "./ExecutionTargetFacts";

export function ExecutionPolicyEditor({
  projectId,
  workspaceId,
  target,
  onClose,
  onSaved,
}: {
  projectId: string;
  workspaceId: string;
  target: ExecutionTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRuntime.${key}`);
  const [policy, setPolicy] = useState<ExecutionPolicy>(() =>
    structuredClone(target.policy),
  );
  const [basis, setBasis] = useState(target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [candidate, setCandidate] = useState<ExecutionTarget>();
  const [intent, setIntent] = useState(() => ({
    key: crypto.randomUUID(),
    signature: "",
  }));
  async function save() {
    setBusy(true);
    setError("");
    const signature = JSON.stringify(policy);
    const key =
      intent.signature && intent.signature !== signature
        ? crypto.randomUUID()
        : intent.key;
    setIntent({ key, signature });
    try {
      await request(
        `/api/hermes/v1/devices/${encodeURIComponent(target.id)}/runtime-policy`,
        {
          method: "POST",
          headers: { "X-Project-Id": projectId, "X-Workspace-Id": workspaceId },
          body: JSON.stringify({
            expected_version: basis.version,
            idempotency_key: key,
            dry_run: false,
            ...policy,
          }),
        },
      );
      onSaved();
      onClose();
    } catch (failure) {
      const message = (failure as Error).message;
      setError(message);
      setConflict(message.includes("409"));
      setCandidate(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function readLatest() {
    setCandidate(undefined);
    setBusy(true);
    setError("");
    try {
      const targets = await fetchDeliveryTargets(projectId);
      const latest = targets.workspaces
        .find((item) => item.id === workspaceId)
        ?.devices.find((item) => item.id === target.id);
      if (!latest || latest.reason_codes.includes("device_revoked"))
        throw new Error(tr("adoptUnavailable"));
      setCandidate(latest);
    } catch (failure) {
      setCandidate(undefined);
      setError(`${tr("retryRead")} ${(failure as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={tr("policy")}
      open
      width={620}
      className="delivery-editor runtime-editor"
      onCancel={() => !busy && onClose()}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              conflict ||
              (policy.allowed_runtimes.includes("agent") &&
                !policy.allowed_providers.length)
            }
            onClick={() => void save()}
          >
            {tr("savePolicy")}
          </Button>
        </Space>
      }
    >
      <Alert type="info" showIcon title={tr("policyHint")} />
      <ExecutionTargetFacts target={basis} />
      {error && (
        <Alert
          role="alert"
          type="error"
          title={conflict ? tr("conflict") : error}
        />
      )}
      <fieldset disabled={busy}>
        <legend>{tr("allowedRuntimes")}</legend>
        <Checkbox.Group
          options={[
            { label: tr("command"), value: "command" },
            { label: tr("agent"), value: "agent" },
          ]}
          value={policy.allowed_runtimes}
          onChange={(values) =>
            setPolicy({
              ...policy,
              allowed_runtimes: values as ExecutionPolicy["allowed_runtimes"],
            })
          }
        />
      </fieldset>
      <fieldset disabled={busy}>
        <legend>{tr("allowedProviders")}</legend>
        <Checkbox.Group
          options={["codex", "claude", "opencode"]}
          value={policy.allowed_providers}
          onChange={(values) =>
            setPolicy({
              ...policy,
              allowed_providers: values as ExecutionPolicy["allowed_providers"],
            })
          }
        />
      </fieldset>
      <p className="runtime-help">{tr("emptyPolicy")}</p>
      {policy.allowed_runtimes.includes("agent") &&
        !policy.allowed_providers.length && (
          <Alert type="warning" title={tr("policyProviderRequired")} />
        )}
      {conflict && (
        <div className="runtime-conflict">
          <Button loading={busy} onClick={() => void readLatest()}>
            {tr("readLatest")}
          </Button>
          {candidate && (
            <>
              <ExecutionTargetFacts target={candidate} />
              <Button
                disabled={busy}
                onClick={() => {
                  setBasis(candidate);
                  setCandidate(undefined);
                  setConflict(false);
                  setError("");
                  setIntent({ key: crypto.randomUUID(), signature: "" });
                }}
              >
                {tr("adopt")}
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
