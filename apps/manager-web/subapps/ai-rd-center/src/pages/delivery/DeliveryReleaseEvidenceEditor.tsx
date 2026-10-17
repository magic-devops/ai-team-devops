import { Alert, Button, Drawer, Input } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryIntent, DeliveryCommandAck } from "@/lib/delivery";
import { prepareDeliveryIntent } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchDeliveryQuality,
  fetchDeliveryReleases,
  releaseProblem,
  submitReleaseCommand,
  type DeliveryQuality,
  type DeliveryReleases,
} from "@/lib/deliveryRelease";
import { ReleaseDigest } from "./DeliveryReleaseFacts";

export async function readEnvelopeFile(file: Pick<File, "size" | "text">) {
  if (file.size > 131072) throw new Error("fileTooLarge");
  const raw = await file.text();
  if (raw.length > 131072) throw new Error("fileTooLarge");
  return raw;
}
function publicKeys(text: string) {
  const keys = text
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length || keys.length > 8 || new Set(keys).size !== keys.length)
    throw new Error("publicKeyInvalid");
  for (const key of keys) {
    try {
      if (
        !/^[A-Za-z0-9+/_-]{43}=?$/.test(key) ||
        atob(key.replace(/-/g, "+").replace(/_/g, "/")).length !== 32
      )
        throw new Error();
    } catch {
      throw new Error("publicKeyInvalid");
    }
  }
  return keys;
}
export function DeliveryReleaseEvidenceEditor({
  projectId,
  initial,
  quality,
  mode,
  onSaved,
  onClose,
  readOnly = false,
}: {
  projectId: string;
  initial: DeliveryReleases;
  quality: DeliveryQuality | undefined;
  mode: "policy" | "ci";
  onSaved: (workspace: DeliveryCommandAck) => void;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const [repository, setRepository] = useState(
    initial.policy?.repository || "",
  );
  const [workflow, setWorkflow] = useState(initial.policy?.workflow || "");
  const [keys, setKeys] = useState(
    initial.policy?.keys.map((key) => key.public_key).join("\n") || "",
  );
  const [envelope, setEnvelope] = useState("");
  const [captured, setCaptured] = useState(() => ({
    selected: structuredClone(
      quality?.selected || { requirement_ids: [], task_ids: [] },
    ),
    basis: quality?.scope_basis || null,
  }));
  const [intent, setIntent] = useState<DeliveryIntent>(() => ({
    version: initial.version,
    key: crypto.randomUUID(),
  }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<{
    index: DeliveryReleases;
    quality: DeliveryQuality;
  } | null>(null);
  const allowed =
    !readOnly &&
    (mode === "policy"
      ? initial.permissions.can_configure
      : initial.permissions.can_import);
  const check = () => {
    if (origin.current !== projectSessionKey()) throw new Error("scopeChanged");
  };
  const failure = (problem: unknown) => {
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
  const save = async () => {
    if (busy || conflict || !allowed) return;
    setBusy("save");
    setError("");
    try {
      check();
      const action =
        mode === "policy" ? "release.policy.save" : "release.ci.import";
      let payload: Record<string, unknown>;
      if (mode === "policy") {
        const public_keys = publicKeys(keys);
        if (
          repository === initial.policy?.repository &&
          workflow === initial.policy?.workflow &&
          JSON.stringify(public_keys) ===
            JSON.stringify(initial.policy?.keys.map((key) => key.public_key))
        )
          throw new Error("noChange");
        payload = {
          repository: repository.trim(),
          workflow: workflow.trim(),
          public_keys,
        };
      } else {
        if (!envelope.trim()) throw new Error("rawRequired");
        if (envelope.length > 131072) throw new Error("fileTooLarge");
        if (
          !captured.basis ||
          (!captured.selected.requirement_ids.length &&
            !captured.selected.task_ids.length)
        )
          throw new Error("scopeRequired");
        payload = { envelope, ...captured.selected };
      }
      const pinned = prepareDeliveryIntent(intent, action, payload);
      setIntent(pinned);
      const updated = await submitReleaseCommand(
        projectId,
        action,
        payload,
        pinned,
      );
      check();
      onSaved(updated);
      onClose();
    } catch (problem) {
      failure(problem);
    } finally {
      setBusy("");
    }
  };
  const read = async () => {
    if (busy) return;
    setBusy("read");
    setError("");
    setLatest(null);
    try {
      check();
      const index = await fetchDeliveryReleases(projectId);
      const current = await fetchDeliveryQuality(projectId, captured.selected);
      check();
      setLatest({ index, quality: current });
    } catch (problem) {
      failure(problem);
    } finally {
      setBusy("");
    }
  };
  const adopt = () => {
    if (!latest) return;
    setIntent({ version: latest.index.version, key: crypto.randomUUID() });
    setCaptured({
      selected: structuredClone(latest.quality.selected),
      basis: latest.quality.scope_basis,
    });
    setConflict(false);
    setLatest(null);
    setError("");
  };
  return (
    <Drawer
      open
      width="min(760px, 100vw)"
      title={tr(mode === "policy" ? "trust" : "import")}
      rootClassName="delivery-release-drawer"
      onClose={() => !busy && onClose()}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <div className="delivery-release-actions">
          <Button onClick={onClose} disabled={Boolean(busy)}>
            {tr("cancel")}
          </Button>
          <Button
            type="primary"
            onClick={save}
            loading={busy === "save"}
            disabled={Boolean(busy) || conflict || !allowed}
          >
            {tr(mode === "policy" ? "save" : "import")}
          </Button>
        </div>
      }
    >
      <div className="delivery-release-editor">
        <Alert
          type="info"
          showIcon
          title={tr(mode === "policy" ? "trustHint" : "importHint")}
        />
        {error && (
          <Alert
            type="error"
            showIcon
            title={tr(conflict ? "conflict" : "saveFailed")}
            description={error}
          />
        )}
        {mode === "policy" ? (
          <>
            <label>
              <span>{tr("repository")} *</span>
              <Input
                aria-label={tr("repository")}
                value={repository}
                maxLength={2000}
                disabled={Boolean(busy)}
                onChange={(event) => setRepository(event.target.value)}
              />
            </label>
            <label>
              <span>{tr("workflow")} *</span>
              <Input
                aria-label={tr("workflow")}
                value={workflow}
                maxLength={200}
                disabled={Boolean(busy)}
                onChange={(event) => setWorkflow(event.target.value)}
              />
            </label>
            <label>
              <span>{tr("publicKeys")} *</span>
              <Input.TextArea
                aria-label={tr("publicKeys")}
                value={keys}
                rows={5}
                disabled={Boolean(busy)}
                onChange={(event) => setKeys(event.target.value)}
              />
            </label>
            <Alert type="warning" showIcon title={tr("changedPolicy")} />
          </>
        ) : (
          <>
            <p>{tr("importScope")}</p>
            <p>
              {t("deliveryRelease.scopeCount", {
                requirements: captured.selected.requirement_ids.length,
                tasks: captured.selected.task_ids.length,
              })}
            </p>
            <ReleaseDigest title={tr("scopeBasis")} value={captured.basis} />
            <label>
              <span>{tr("envelopeFile")}</span>
              <input
                type="file"
                accept=".json,application/json"
                aria-label={tr("envelopeFile")}
                disabled={Boolean(busy)}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    check();
                    const raw = await readEnvelopeFile(file);
                    check();
                    setEnvelope(raw);
                    setError("");
                  } catch (problem) {
                    failure(problem);
                  }
                  event.target.value = "";
                }}
              />
            </label>
            <label>
              <span>{tr("envelope")} *</span>
              <Input.TextArea
                aria-label={tr("envelope")}
                value={envelope}
                disabled={Boolean(busy)}
                rows={10}
                maxLength={131072}
                onChange={(event) => setEnvelope(event.target.value)}
              />
            </label>
          </>
        )}
        {conflict && (
          <Button
            disabled={Boolean(busy)}
            loading={busy === "read"}
            onClick={read}
          >
            {tr("readLatest")}
          </Button>
        )}
        {latest && (
          <section className="delivery-release-selection">
            <h3>{tr("latest")}</h3>
            <p>
              {latest.index.policy
                ? t("deliveryRelease.generation", {
                    generation: latest.index.policy.generation,
                  })
                : tr("trustMissing")}
            </p>
            <p>
              {latest.index.policy?.repository} ·{" "}
              {latest.index.policy?.workflow}
            </p>
            <ReleaseDigest
              title={tr("scopeBasis")}
              value={latest.quality.scope_basis}
            />
            <Button
              onClick={adopt}
              disabled={
                mode === "policy"
                  ? !latest.index.permissions.can_configure
                  : !latest.index.permissions.can_import
              }
            >
              {tr("adopt")}
            </Button>
          </section>
        )}
      </div>
    </Drawer>
  );
}
