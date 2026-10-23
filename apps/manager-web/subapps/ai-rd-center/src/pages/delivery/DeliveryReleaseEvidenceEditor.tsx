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
  readReleaseCiReceipt,
  RELEASE_RECEIPT_MAX_BYTES,
  type DeliveryQuality,
  type DeliveryReleases,
} from "@/lib/deliveryRelease";
import { ReleaseDigest } from "./DeliveryReleaseFacts";
import { useReleaseCommand } from "@/lib/deliveryReleaseCommand";

export async function readEnvelopeFile(file: Pick<File, "size" | "text">) {
  if (file.size > RELEASE_RECEIPT_MAX_BYTES) throw new Error("fileTooLarge");
  const raw = await file.text();
  if (new TextEncoder().encode(raw).length > RELEASE_RECEIPT_MAX_BYTES) throw new Error("fileTooLarge");
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
  onPending,
}: {
  projectId: string;
  initial: DeliveryReleases;
  quality: DeliveryQuality | undefined;
  mode: "policy" | "ci";
  onSaved: (workspace: DeliveryCommandAck) => void;
  onClose: () => void;
  readOnly?: boolean;
  onPending?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const fileRead = useRef(0);
  const command = useReleaseCommand(projectId, mode, onPending);
  const restored = command.state.original?.payload;
  const [repository, setRepository] = useState(
    typeof restored?.repository === "string"
      ? restored.repository
      : initial.policy?.repository || "",
  );
  const [workflow, setWorkflow] = useState(
    typeof restored?.workflow === "string"
      ? restored.workflow
      : initial.policy?.workflow || "",
  );
  const [keys, setKeys] = useState(
    Array.isArray(restored?.public_keys)
      ? restored.public_keys.join("\n")
      : initial.policy?.keys.map((key) => key.public_key).join("\n") || "",
  );
  const [envelope, setEnvelope] = useState(
    typeof restored?.envelope === "string" ? JSON.stringify(restored, null, 2) : "",
  );
  const [captured, setCaptured] = useState(() => ({
    selected: structuredClone(
      Array.isArray(restored?.requirement_ids) &&
        Array.isArray(restored?.task_ids)
        ? {
            requirement_ids: restored.requirement_ids as string[],
            task_ids: restored.task_ids as string[],
          }
        : quality?.selected || { requirement_ids: [], task_ids: [] },
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
    quality?: DeliveryQuality;
  } | null>(null);
  const allowed =
    !readOnly &&
    (mode === "policy"
      ? initial.permissions.can_configure
      : initial.permissions.can_import);
  const locked = Boolean(busy) || command.locked;
  const refused = conflict || command.state.phase === "refused";
  const check = () => {
    if (!command.current() || origin.current !== projectSessionKey())
      throw new Error("scopeChanged");
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
    if (busy || command.state.phase !== "idle" || conflict || !allowed) return;
    setBusy("save");
    fileRead.current += 1;
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
        if (new TextEncoder().encode(envelope).length > RELEASE_RECEIPT_MAX_BYTES) throw new Error("fileTooLarge");
        if (
          !captured.basis ||
          (!captured.selected.requirement_ids.length &&
            !captured.selected.task_ids.length)
        )
          throw new Error("scopeRequired");
        payload = readReleaseCiReceipt(envelope, captured.selected, projectId, captured.basis);
      }
      const pinned = prepareDeliveryIntent(intent, action, payload);
      setIntent(pinned);
      const updated = await command.run({ action, payload, intent: pinned });
      check();
      if (updated) {
        onSaved(updated);
        onClose();
      }
    } catch (problem) {
      failure(problem);
    } finally {
      setBusy("");
    }
  };
  const read = async () => {
    if (busy || command.unresolved) return;
    setBusy("read");
    setError("");
    setLatest(null);
    try {
      check();
      const index = await fetchDeliveryReleases(projectId);
      check();
      const current =
        mode === "ci"
          ? await fetchDeliveryQuality(
              projectId,
              captured.selected,
              undefined,
              index.query_generation,
            )
          : undefined;
      check();
      setLatest({ index, quality: current });
    } catch (problem) {
      failure(problem);
    } finally {
      setBusy("");
    }
  };
  const adopt = () => {
    if (!latest || command.unresolved || !command.current()) return;
    command.reset();
    setIntent({ version: latest.index.version, key: crypto.randomUUID() });
    setCaptured({
      selected: structuredClone(latest.quality?.selected || captured.selected),
      basis: latest.quality?.scope_basis || captured.basis,
    });
    setConflict(false);
    setLatest(null);
    setError("");
  };
  return (
    <Drawer
      open
      size="min(760px, 100vw)"
      title={tr(mode === "policy" ? "trust" : "import")}
      rootClassName="delivery-release-drawer"
      onClose={() => !busy && !command.unresolved && onClose()}
      mask={{ closable: !busy && !command.unresolved }}
      keyboard={!busy && !command.unresolved}
      footer={
        <div className="delivery-release-actions">
          <Button
            onClick={onClose}
            disabled={Boolean(busy) || command.unresolved}
          >
            {tr("cancel")}
          </Button>
          <Button
            type="primary"
            onClick={save}
            loading={busy === "save"}
            disabled={
              Boolean(busy) ||
              command.state.phase !== "idle" ||
              conflict ||
              !allowed
            }
          >
            {tr(mode === "policy" ? "save" : "import")}
          </Button>
          {command.state.phase === "unknown" && (
            <Button
              type="primary"
              onClick={async () => {
                const ack = await command.replay();
                if (ack) {
                  onSaved(ack);
                  onClose();
                }
              }}
            >
              {tr("replayOriginal")}
            </Button>
          )}
        </div>
      }
    >
      <div className="delivery-release-editor">
        {command.state.error && (
          <Alert
            type="error"
            title={tr(
              command.state.phase === "unknown"
                ? "unknownRequest"
                : "saveFailed",
            )}
            description={t(`deliveryRelease.${command.state.error}`, {
              defaultValue: command.state.error,
            })}
          />
        )}
        {command.state.original && command.unresolved && (
          <pre className="delivery-release-raw">
            {JSON.stringify(command.state.original, null, 2)}
          </pre>
        )}
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
                disabled={locked}
                onChange={(event) => setRepository(event.target.value)}
              />
            </label>
            <label>
              <span>{tr("workflow")} *</span>
              <Input
                aria-label={tr("workflow")}
                value={workflow}
                maxLength={200}
                disabled={locked}
                onChange={(event) => setWorkflow(event.target.value)}
              />
            </label>
            <label>
              <span>{tr("publicKeys")} *</span>
              <Input.TextArea
                aria-label={tr("publicKeys")}
                value={keys}
                rows={5}
                disabled={locked}
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
                disabled={locked}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const sequence = ++fileRead.current;
                  const input = event.target;
                  input.value = "";
                  try {
                    check();
                    const raw = await readEnvelopeFile(file);
                    if (sequence !== fileRead.current || !command.current() || command.locked) return;
                    check();
                    setEnvelope(raw);
                    setError("");
                  } catch (problem) {
                    if (sequence === fileRead.current && command.current()) failure(problem);
                  }
                }}
              />
            </label>
            <label>
              <span>{tr("envelope")} *</span>
              <Input.TextArea
                aria-label={tr("envelope")}
                value={envelope}
                disabled={locked}
                rows={10}
                maxLength={RELEASE_RECEIPT_MAX_BYTES}
                onChange={(event) => { fileRead.current += 1; setEnvelope(event.target.value); }}
              />
            </label>
          </>
        )}
        {refused && (
          <Button
            disabled={Boolean(busy) || command.unresolved}
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
              value={latest.quality?.scope_basis || null}
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
