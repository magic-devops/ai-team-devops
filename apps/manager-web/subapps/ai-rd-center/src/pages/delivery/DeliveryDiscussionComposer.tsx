import { Alert, Button, Input, InputNumber, Modal, Select, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { useDiscussionDraft } from "@/lib/deliveryDiscussionDraft";
import {
  fetchDiscussion,
  fetchDiscussionMessage,
  fetchDiscussionReference,
  type DiscussionAck,
  type DiscussionMessage,
  type DiscussionReference,
  type DiscussionReferenceSelection,
  type DiscussionScope,
} from "@/lib/deliveryDiscussions";
import { DiscussionObjectSelect } from "./DeliveryDiscussionObjectSelect";
import {
  DiscussionProblem,
  DiscussionReferences,
} from "./DeliveryDiscussionCommon";
export function DiscussionReferencePicker({
  projectId,
  subject,
  onChoose,
  onClose,
}: {
  projectId: string;
  subject: DiscussionScope;
  onChoose: (reference: DiscussionReferenceSelection) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const [kind, setKind] = useState<DiscussionReferenceSelection["kind"]>(
      subject.kind,
    ),
    [targetId, setTargetId] = useState(subject.id),
    [field, setField] =
      useState<DiscussionReferenceSelection["field"]>("description"),
    [index, setIndex] = useState(1);
  const [reference, setReference] = useState<DiscussionReference | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const generation = useRef(0),
    origin = useRef(projectSessionKey());
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const change = (action: () => void) => {
    generation.current++;
    action();
    setReference(null);
    setError(undefined);
    setBusy(false);
  };
  async function load() {
    const serial = ++generation.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = await fetchDiscussionReference(projectId, {
        kind,
        id: targetId.trim(),
        field,
        ...(field === "acceptance_criteria"
          ? { criterion_index: index - 1 }
          : {}),
      });
      if (
        serial === generation.current &&
        origin.current === projectSessionKey()
      )
        setReference(result.reference);
    } catch (cause) {
      if (
        serial === generation.current &&
        origin.current === projectSessionKey()
      )
        setError(cause);
    } finally {
      if (
        serial === generation.current &&
        origin.current === projectSessionKey()
      )
        setBusy(false);
    }
  }
  const canChoose =
    reference?.status === "available" &&
    Boolean(reference.source_content_basis);
  return (
    <Modal
      open
      title={tr("quote")}
      onCancel={onClose}
      footer={
        <div className="discussion-actions">
          <Button onClick={onClose}>{tr("cancel")}</Button>
          <Button
            type="primary"
            disabled={!canChoose || busy}
            onClick={() => {
              if (
                !reference?.source_content_basis ||
                reference.status !== "available" ||
                !reference.field
              )
                return;
              onChoose({
                kind: reference.kind,
                id: reference.id,
                field: reference.field,
                criterion_index: reference.criterion_index,
                source_content_basis: reference.source_content_basis,
              });
            }}
          >
            {tr("chooseReference")}
          </Button>
        </div>
      }
    >
      <div className="discussion-reference-form">
        <label>
          {tr("kind")}
          <Select
            aria-label={tr("kind")}
            value={kind}
            options={["requirement", "task", "issue", "execution"].map(
              (value) => ({ value, label: tr(value) }),
            )}
            onChange={(value) =>
              change(() => {
                setKind(value);
                setField(value === "execution" ? "summary" : "description");
              })
            }
          />
        </label>
        <label>
          {tr("subject")}
          <DiscussionObjectSelect
            key={`${projectId}:${kind}`}
            projectId={projectId}
            kind={kind}
            value={targetId}
            onChange={(value) => change(() => setTargetId(value))}
          />
        </label>
        <label>
          {tr("field")}
          <Select
            aria-label={tr("field")}
            value={field}
            options={(kind === "execution"
              ? ["summary"]
              : kind === "issue"
                ? ["title", "description"]
                : ["title", "description", "acceptance_criteria"]
            ).map((value) => ({
              value,
              label: tr(value === "title" ? "titleField" : value),
            }))}
            onChange={(value) => change(() => setField(value))}
          />
        </label>
        {field === "acceptance_criteria" && (
          <label>
            {tr("criterionIndex")}
            <InputNumber
              min={1}
              value={index}
              onChange={(value) => change(() => setIndex(value || 1))}
            />
          </label>
        )}
        <Button
          loading={busy}
          disabled={!targetId.trim()}
          onClick={() => void load()}
        >
          {tr("readReference")}
        </Button>
        {Boolean(error) && (
          <DiscussionProblem error={error} onRetry={() => void load()} />
        )}{" "}
        {reference && <DiscussionReferences refs={[reference]} />}
      </div>
    </Modal>
  );
}
export function DiscussionComposer({
  projectId,
  subject,
  threadId = "",
  message,
  replyTo = null,
  identity,
  readOnly = false,
  onSaved,
  onCancel,
  onUnresolvedChange,
}: {
  projectId: string;
  subject: DiscussionScope;
  threadId?: string;
  message?: DiscussionMessage;
  replyTo?: string | null;
  identity: string;
  readOnly?: boolean;
  onSaved: (ack: DiscussionAck) => void;
  onCancel?: () => void;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryDiscussion.${key}`);
  const mode = message ? "edit" : threadId ? "reply" : "create";
  const operation = useDiscussionDraft(
    projectId,
    subject,
    threadId,
    message?.id || replyTo || "",
    mode,
    identity,
    {
      body: message?.body || "",
      parent_message_id: replyTo,
      base_revision: message?.revision,
    },
  );
  const [quote, setQuote] = useState(false),
    [base, setBase] = useState(message),
    [latest, setLatest] = useState<DiscussionMessage | null>(null),
    [reading, setReading] = useState(false),
    [readError, setReadError] = useState<unknown>();
  const [latestRefs, setLatestRefs] = useState<
    DiscussionReferenceSelection[] | null
  >(null);
  const [latestRefPreview, setLatestRefPreview] = useState<
    DiscussionReference[]
  >([]);
  const readingSerial = useRef(0);
  useEffect(
    () => () => {
      readingSerial.current++;
    },
    [],
  );
  const origin = useRef(projectSessionKey()),
    callback = useRef(onUnresolvedChange);
  callback.current = onUnresolvedChange;
  useEffect(() => {
    callback.current?.(operation.busy || operation.unknown);
  }, [operation.busy, operation.unknown]);
  useEffect(() => () => callback.current?.(false), []);
  const locked = readOnly || operation.unknown;
  async function send(retry = false) {
    const draft = operation.draft;
    const ack = await operation.run(
      {
        operation: mode,
        threadId: threadId || undefined,
        messageId: base?.id,
        body: {
          ...(mode === "create"
            ? {
                subject_kind: subject.kind,
                subject_id: subject.id,
                title: draft.title.trim(),
              }
            : {}),
          body: draft.body,
          ...(mode === "edit"
            ? {
                expected_message_revision:
                  draft.base_revision || base!.revision,
              }
            : {
                refs: draft.refs,
                ...(mode === "reply"
                  ? { parent_message_id: draft.parent_message_id }
                  : {}),
              }),
        },
      },
      retry,
    );
    if (ack && origin.current === projectSessionKey()) onSaved(ack);
  }
  async function loadLatest() {
    const serial = ++readingSerial.current;
    setReading(true);
    setReadError(undefined);
    try {
      if (mode === "edit") {
        const result = await fetchDiscussionMessage(
          projectId,
          threadId,
          base!.id,
        );
        if (
          serial === readingSerial.current &&
          origin.current === projectSessionKey()
        )
          setLatest(result.message);
      } else {
        if (threadId) {
          const detail = await fetchDiscussion(projectId, threadId);
          if (!detail.capabilities.reply)
            throw new Error("HTTP 403: reply unavailable");
        }
        const previews: DiscussionReference[] = [];
        const refs = await Promise.all(
          operation.draft.refs.map(async (ref) => {
            const result = await fetchDiscussionReference(projectId, ref);
            if (
              result.reference.status !== "available" ||
              !result.reference.source_content_basis
            )
              throw new Error("HTTP 404: reference unavailable");
            previews.push(result.reference);
            return {
              ...ref,
              source_content_basis: result.reference.source_content_basis,
            };
          }),
        );
        if (
          serial === readingSerial.current &&
          origin.current === projectSessionKey()
        ) {
          setLatestRefs(refs);
          setLatestRefPreview(previews);
        }
      }
    } catch (error) {
      if (
        serial === readingSerial.current &&
        origin.current === projectSessionKey()
      )
        setReadError(error);
    } finally {
      if (
        serial === readingSerial.current &&
        origin.current === projectSessionKey()
      )
        setReading(false);
    }
  }
  return (
    <section
      className="discussion-composer"
      aria-label={tr(
        mode === "create" ? "new" : mode === "edit" ? "edit" : "reply",
      )}
    >
      <p className="discussion-help" role="status">
        {tr(operation.recoverable ? "draftRestored" : "draftMemory")}
      </p>
      {replyTo && (
        <small>{t("deliveryDiscussion.replyTo", { id: replyTo })}</small>
      )}
      {mode === "create" && (
        <label>
          {tr("threadTitle")}
          <Input
            aria-label={tr("threadTitle")}
            maxLength={160}
            disabled={locked}
            value={operation.draft.title}
            onChange={(event) => operation.patch({ title: event.target.value })}
          />
        </label>
      )}
      <label>
        {tr("body")}
        <Input.TextArea
          aria-label={tr("body")}
          autoSize={{ minRows: 3, maxRows: 10 }}
          maxLength={8000}
          value={operation.draft.body}
          disabled={locked}
          onChange={(event) => operation.patch({ body: event.target.value })}
        />
      </label>
      {mode === "edit" && base && <DiscussionReferences refs={base.refs} />}
      <div className="discussion-actions">
        {operation.draft.refs.map((ref, index) => (
          <Tag
            key={index}
            closable={!locked && !operation.busy}
            onClose={() =>
              operation.patch({
                refs: operation.draft.refs.filter((_, i) => i !== index),
              })
            }
          >
            {tr(ref.kind)} {ref.id} ·{" "}
            {tr(ref.field === "title" ? "titleField" : ref.field)}
          </Tag>
        ))}
      </div>
      {operation.failure && (
        <DiscussionProblem
          error={
            new Error(
              `HTTP ${operation.failure.status}: ${JSON.stringify({ detail: { code: operation.failure.code, message: operation.failure.message } })}`,
            )
          }
        />
      )}
      {operation.unknown && (
        <Alert
          type="warning"
          showIcon
          role="alert"
          title={tr("unknown")}
          action={
            <Button loading={operation.busy} onClick={() => void send(true)}>
              {tr("retryOriginal")}
            </Button>
          }
        />
      )}
      {operation.failure?.conflict && mode !== "edit" && (
        <div>
          <Button loading={reading} onClick={() => void loadLatest()}>
            {tr("loadLatest")}
          </Button>
          {Boolean(readError) && <DiscussionProblem error={readError} />}{" "}
          {latestRefs && (
            <>
              <DiscussionReferences refs={latestRefPreview} />
              <Button
                onClick={() => {
                  operation.patch({ refs: latestRefs });
                  setLatestRefs(null);
                  operation.resetFailure();
                }}
              >
                {tr("adoptLatest")}
              </Button>
            </>
          )}
        </div>
      )}
      {operation.failure?.conflict && mode === "edit" && (
        <div>
          <Button loading={reading} onClick={() => void loadLatest()}>
            {tr("loadLatest")}
          </Button>
          {Boolean(readError) && <DiscussionProblem error={readError} />}{" "}
          {latest && (
            <>
              <p className="discussion-text">
                {latest.body || tr("withdrawn")}
              </p>
              <small>
                {t("deliveryDiscussion.revision", {
                  revision: latest.revision,
                })}
              </small>
              <Button
                disabled={latest.state !== "active" || !latest.can_edit}
                onClick={() => {
                  setBase(latest);
                  operation.patch({ base_revision: latest.revision });
                  setLatest(null);
                  operation.resetFailure();
                }}
              >
                {tr("adoptLatest")}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="discussion-actions">
        {mode !== "edit" && (
          <Button
            disabled={
              locked || operation.busy || operation.draft.refs.length >= 8
            }
            onClick={() => setQuote(true)}
          >
            {tr("quote")}
          </Button>
        )}
        <Button
          type="primary"
          loading={operation.busy}
          disabled={
            locked ||
            Boolean(operation.failure?.conflict) ||
            !operation.draft.body.trim() ||
            (mode === "create" && !operation.draft.title.trim())
          }
          onClick={() => void send()}
        >
          {tr(mode === "edit" ? "save" : "send")}
        </Button>
        {onCancel && (
          <Button
            disabled={operation.busy || operation.unknown}
            onClick={onCancel}
          >
            {tr("cancel")}
          </Button>
        )}
      </div>
      {quote && (
        <DiscussionReferencePicker
          projectId={projectId}
          subject={subject}
          onChoose={(reference) => {
            operation.patch({ refs: [...operation.draft.refs, reference] });
            setQuote(false);
          }}
          onClose={() => setQuote(false)}
        />
      )}
    </section>
  );
}
