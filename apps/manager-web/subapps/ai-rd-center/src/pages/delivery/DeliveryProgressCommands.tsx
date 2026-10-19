import { Alert, Button, Input, Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchProgressFreezeProof,
  prepareProgressBaseline,
  progressBaselineDateProblem,
  useProgressCommand,
  type ProgressBaselineForm,
  type ProgressFreezeProof,
  type ProgressSeries,
  type ProgressRoute,
} from "@/lib/deliveryProgress";
import type { DeliveryCommandAck } from "@/lib/delivery";

function generatedTitle(label: string) {
  const suffix = ` · ${new Date().toISOString().slice(0, 10)}`;
  let title = "";
  for (const character of label) {
    if (title.length + character.length > 200 - suffix.length) break;
    title += character;
  }
  return title + suffix;
}

export function DeliveryProgressCommands({
  projectId,
  route,
  data,
  canWrite,
  canApprove,
  unavailable,
  onSaved,
  onRefresh,
  onPending,
}: {
  projectId: string;
  route: ProgressRoute;
  data?: ProgressSeries;
  canWrite: boolean;
  canApprove: boolean;
  unavailable: boolean;
  onSaved: (ack: DeliveryCommandAck) => void;
  onRefresh: () => void;
  onPending: (identity: string, value: boolean) => void;
}) {
  const { t } = useTranslation(),
    tr = (key: string) => t(`deliveryProgress.bounded.${key}`);
  const displayProblem = (message: string) =>
    [
      "progressProofRequired",
      "progressScopeChanged",
      "progressPageInvalid",
    ].includes(message)
      ? tr("proofRequired")
      : [
            "retainedOriginalInvalid",
            "retainedOriginalUnavailable",
            "ackMismatch",
          ].includes(message)
        ? tr("commandFailed")
        : message;
  const commandPending = useRef({ record: false, freeze: false });
  const record = useProgressCommand(projectId, "progress.record", (value) => {
    commandPending.current.record = value;
    onPending("record", value);
  });
  const freeze = useProgressCommand(projectId, "baseline.create", (value) => {
    commandPending.current.freeze = value;
    onPending("freeze", value);
  });
  commandPending.current = {
    record: record.unresolved,
    freeze: freeze.unresolved,
  };
  const hasPending = () =>
    Object.values(commandPending.current).some(Boolean) ||
    [record.snapshot().phase, freeze.snapshot().phase].some(
      (phase) => phase === "sending" || phase === "unknown",
    );
  const canEdit = () =>
    freeze.snapshot().phase === "idle" &&
    !hasPending() &&
    !pendingRead.current &&
    current();
  const [open, setOpen] = useState(false),
    [reading, setReading] = useState(false),
    [proof, setProof] = useState<ProgressFreezeProof | null>(null),
    [error, setError] = useState("");
  const [form, setForm] = useState<ProgressBaselineForm>({
    title: "",
    starts_on: null,
    ends_on: null,
    note: "",
  });
  const owner = useRef(projectSessionKey()),
    pendingRead = useRef(false),
    readSerial = useRef(0);
  const current = () => owner.current === projectSessionKey();
  const unresolved = record.unresolved || freeze.unresolved;
  const original =
    freeze.state.original?.action === "baseline.create"
      ? (freeze.state.original.payload as ProgressBaselineForm & {
          scope: string;
          scope_id: string;
          task_ids: string[];
        })
      : null;
  const visibleForm = original || form;
  const formProblem = progressBaselineDateProblem(form);
  const dialogOpen =
    open || ["sending", "unknown", "refused"].includes(freeze.state.phase);
  const proofVisible =
    !unavailable &&
    proof?.project_id === projectId &&
    proof.scope.kind === route.scope &&
    (route.scope === "project" || proof.scope.id === route.scopeId)
      ? proof
      : null;
  useEffect(() => {
    if (unavailable) setProof(null);
  }, [unavailable]);
  useEffect(() => {
    setProof(null);
    setError("");
    readSerial.current++;
  }, [projectId, route.scope, route.scopeId]);
  useEffect(() => {
    const invalidate = () => {
      readSerial.current++;
      pendingRead.current = false;
      setReading(false);
      setProof(null);
    };
    for (const event of ["hashchange", "popstate", "sop-session", "storage"])
      window.addEventListener(event, invalidate);
    return () => {
      readSerial.current++;
      for (const event of ["hashchange", "popstate", "sop-session", "storage"])
        window.removeEventListener(event, invalidate);
    };
  }, []);
  async function loadProof() {
    if (
      pendingRead.current ||
      hasPending() ||
      !canApprove ||
      unavailable ||
      !current()
    )
      return;
    const serial = ++readSerial.current;
    pendingRead.current = true;
    setReading(true);
    setProof(null);
    setError("");
    try {
      const value = await fetchProgressFreezeProof(projectId, route);
      if (serial !== readSerial.current || !current()) return;
      setProof(structuredClone(value));
    } catch (cause) {
      if (serial === readSerial.current && current()) {
        setProof(null);
        setError((cause as Error).message);
      }
    } finally {
      pendingRead.current = false;
      if (serial === readSerial.current && current()) setReading(false);
    }
  }
  async function save(replay = false) {
    if (
      !current() ||
      (!replay && (hasPending() || unavailable || !canApprove || !proofVisible))
    )
      return;
    if (!replay && formProblem) {
      setError(t(`deliveryProgress.${formProblem}`));
      return;
    }
    setError("");
    try {
      const ack = replay
        ? await freeze.replay()
        : await freeze.run(prepareProgressBaseline(proofVisible!, form));
      if (ack && current()) {
        freeze.reset();
        onSaved(ack);
        setOpen(false);
        setProof(null);
      }
    } catch (cause) {
      if (current()) setError((cause as Error).message);
    }
  }
  async function recordNow(replay = false) {
    if (
      !current() ||
      (!replay && (hasPending() || unavailable || !data || !canWrite))
    )
      return;
    const ack = replay
      ? await record.replay()
      : await record.run({
          action: "progress.record",
          payload: {},
          intent: { version: data!.version, key: crypto.randomUUID() },
        });
    if (ack && current()) {
      record.reset();
      onSaved(ack);
    }
  }
  const editable = freeze.state.phase === "idle" && !unresolved && !reading;
  return (
    <>
      <div className="delivery-actions">
        <Button
          loading={record.state.phase === "sending"}
          disabled={
            unavailable ||
            unresolved ||
            !data ||
            !canWrite ||
            record.state.phase !== "idle"
          }
          onClick={() => void recordNow()}
        >
          {t("deliveryProgress.record")}
        </Button>
        <Button
          type="primary"
          disabled={unavailable || unresolved || !canApprove || !data}
          onClick={() => {
            if (!current() || hasPending()) return;
            setProof(null);
            setOpen(true);
            setForm((value) => ({
              ...value,
              title: value.title || generatedTitle(data?.scope.label || ""),
            }));
          }}
        >
          {t("deliveryProgress.freeze")}
        </Button>
      </div>
      {record.state.phase === "unknown" && (
        <Alert
          type="warning"
          title={tr("recordUnknown")}
          description={tr("originalLocked")}
          action={
            <Button
              disabled={record.state.phase !== "unknown"}
              onClick={() => void recordNow(true)}
            >
              {tr("retryOriginal")}
            </Button>
          }
        />
      )}
      {record.state.error && (
        <Alert
          type="error"
          title={tr("commandFailed")}
          description={displayProblem(record.state.error)}
          action={
            record.state.phase === "refused" ? (
              <Button
                onClick={() => {
                  if (!current()) return;
                  record.reset();
                  onRefresh();
                }}
              >
                {tr("readCurrent")}
              </Button>
            ) : undefined
          }
        />
      )}
      <Modal
        open={dialogOpen}
        title={tr("freezeTitle")}
        footer={null}
        destroyOnHidden
        closable={!unresolved && !reading}
        maskClosable={false}
        keyboard={!unresolved && !reading}
        onCancel={() => {
          if (hasPending() || pendingRead.current || !current()) return;
          if (freeze.state.phase === "refused") freeze.reset();
          setOpen(false);
        }}
        width={640}
        className="delivery-progress-proof"
      >
        <p className="delivery-hint">{tr("proofHint")}</p>
        {freeze.state.phase === "unknown" && (
          <Alert
            type="warning"
            title={tr("unknown")}
            description={tr("originalLocked")}
            action={
              <Button onClick={() => void save(true)}>
                {tr("retryOriginal")}
              </Button>
            }
          />
        )}
        {!original && (
          <Button
            loading={reading}
            disabled={unresolved || unavailable || !canApprove}
            onClick={() => void loadProof()}
          >
            {tr("readProof")}
          </Button>
        )}
        {proofVisible && (
          <div className="delivery-progress-proof-facts">
            <strong>{proofVisible.scope.label}</strong>
            <span>
              {proofVisible.metrics
                ? t("deliveryProgress.freezeCount", {
                    count: proofVisible.metrics.tasks_total,
                  })
                : "—"}
            </span>
            <span>
              {tr(
                proofVisible.complete && proofVisible.available
                  ? "proofComplete"
                  : "proofUnavailable",
              )}
            </span>
            {proofVisible.reasons.map((reason) => (
              <p key={reason.code}>{reason.message}</p>
            ))}
          </div>
        )}
        {original && !unavailable && (
          <p className="delivery-hint">
            {original.scope} {original.scope_id} ·{" "}
            {t("deliveryProgress.freezeCount", {
              count: original.task_ids.length,
            })}
          </p>
        )}
        <label className="issue-field">
          <span>{t("deliveryProgress.titleField")}</span>
          <Input
            value={visibleForm.title}
            maxLength={200}
            disabled={!editable}
            onChange={(event) => {
              if (canEdit()) setForm({ ...form, title: event.target.value });
            }}
          />
        </label>
        <div className="delivery-progress-proof-dates">
          {(["starts_on", "ends_on"] as const).map((key) => (
            <label className="issue-field" key={key}>
              <span>
                {t(
                  `deliveryProgress.${key === "starts_on" ? "startsOn" : "endsOn"}`,
                )}
              </span>
              <Input
                type="date"
                value={visibleForm[key] || ""}
                disabled={!editable}
                onChange={(event) => {
                  if (canEdit())
                    setForm({ ...form, [key]: event.target.value || null });
                }}
              />
            </label>
          ))}
        </div>
        <label className="issue-field">
          <span>{t("deliveryProgress.note")}</span>
          <Input.TextArea
            value={visibleForm.note}
            maxLength={4000}
            rows={3}
            disabled={!editable}
            onChange={(event) => {
              if (canEdit()) setForm({ ...form, note: event.target.value });
            }}
          />
        </label>
        {formProblem && (
          <Alert type="warning" title={t(`deliveryProgress.${formProblem}`)} />
        )}
        {(error || freeze.state.error) && (
          <Alert
            type="error"
            title={tr("commandFailed")}
            description={displayProblem(error || freeze.state.error || "")}
          />
        )}
        {freeze.state.phase === "refused" && (
          <Button
            onClick={() => {
              if (!current()) return;
              freeze.reset();
              setProof(null);
              onRefresh();
            }}
          >
            {tr("adoptFreshProof")}
          </Button>
        )}
        <Button
          type="primary"
          loading={freeze.state.phase === "sending"}
          disabled={
            !editable ||
            unavailable ||
            !canApprove ||
            !proofVisible?.available ||
            !proofVisible.complete ||
            !form.title.trim() ||
            Boolean(formProblem) ||
            freeze.state.phase !== "idle"
          }
          onClick={() => void save()}
        >
          {tr("confirmFreeze")}
        </Button>
      </Modal>
    </>
  );
}
