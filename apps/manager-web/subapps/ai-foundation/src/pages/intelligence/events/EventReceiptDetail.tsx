import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Collapse, Empty, Input, Skeleton, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  fetchEventAttempts,
  fetchEventReceipt,
  type EventReceiptDetail as Detail,
  type EventRoute,
  type EventRetryAck,
} from "@/lib/eventReceipts";
import { useEventRetryState } from "@/lib/eventReceiptState";
import {
  EventEffectResult,
  EventPager,
  EventProblem,
  EventProcessingTags,
  EventReason,
} from "./EventReceiptCommon";
type Controller = ReturnType<typeof useEventRetryState>;
function RetryPanel({
  controller,
  data,
  onLatest,
  onSaved,
}: {
  controller: Controller;
  data: Detail;
  onLatest: (latest: Detail) => void;
  onSaved: (ack: EventRetryAck) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("eventReceipts." + key);
  const locked = controller.busy || controller.unknown,
    conflict = Boolean(
      controller.failure?.conflict || controller.draft.conflict,
    );
  async function submit(original = false) {
    const ack = await controller.run(
      original,
      original ? data.permissions.configure : data.capabilities.retry,
    );
    if (ack) onSaved(ack);
  }
  return (
    <section className="event-receipt-retry" aria-label={tr("retryTitle")}>
      <h4>{tr("retryTitle")}</h4>
      <p className="event-receipt-note">{tr("retryHint")}</p>
      <p className="event-receipt-note" role="status">
        {tr(controller.recoverable ? "restored" : "memoryOnly")}
      </p>
      <p>
        {tr("revision")} ·{" "}
        {controller.draft.basis?.revision || data.event.processing.revision}
      </p>
      <label>
        {tr("reason")}
        <Input.TextArea
          aria-label={tr("reason")}
          maxLength={2000}
          rows={3}
          value={controller.draft.reason}
          disabled={locked || Boolean(controller.ack)}
          onChange={(event) => controller.patch(event.target.value)}
        />
      </label>
      {controller.failure && (
        <EventProblem
          error={
            new Error(
              "HTTP " +
                controller.failure.status +
                ": " +
                JSON.stringify({
                  detail: {
                    code: controller.failure.code,
                    message: controller.failure.message,
                  },
                }),
            )
          }
        />
      )}
      {conflict && <Alert type="warning" title={tr("conflict")} />}
      {controller.unknown && (
        <Alert
          role="alert"
          type="warning"
          title={tr("unknown")}
          action={
            <Button
              loading={controller.busy}
              disabled={!data.permissions.configure || controller.reading}
              onClick={() => void submit(true)}
            >
              {tr("retryOriginal")}
            </Button>
          }
        />
      )}
      {controller.ack && (
        <>
          <Alert type="info" role="status" title={tr("saved")} />
          <EventProcessingTags processing={controller.ack.processing} />
        </>
      )}
      <div className="event-receipt-actions">
        <Button
          type="primary"
          loading={controller.busy}
          disabled={
            !data.capabilities.retry ||
            locked ||
            controller.reading ||
            conflict ||
            Boolean(controller.ack) ||
            !controller.draft.reason.trim()
          }
          onClick={() => void submit()}
        >
          {tr("confirm")}
        </Button>
        <Button
          loading={controller.reading}
          disabled={controller.busy}
          onClick={() => void controller.loadLatest()}
        >
          {tr("readLatest")}
        </Button>
      </div>
      {Boolean(controller.readError) && (
        <EventProblem error={controller.readError} />
      )}
      {controller.latest && (
        <section>
          <EventProcessingTags
            processing={controller.latest.event.processing}
          />
          <p>
            {tr("revision")} · {controller.latest.event.processing.revision}
          </p>
          <EventReason
            code={
              controller.latest.capabilities.retry_reason_code ||
              controller.latest.event.processing.reason_code
            }
          />
          <Button
            disabled={
              locked ||
              controller.reading ||
              (!controller.latest.capabilities.retry &&
                controller.latest.event.processing.state !== "processed")
            }
            onClick={() => {
              const value = controller.adopt();
              if (value) onLatest(value);
            }}
          >
            {tr(
              controller.latest.event.processing.state === "processed"
                ? "adoptResult"
                : "adoptLatest",
            )}
          </Button>
        </section>
      )}
      {!data.capabilities.retry && (
        <>
          <p className="event-receipt-note">{tr("noCapability")}</p>
          <EventReason code={data.capabilities.retry_reason_code} />
        </>
      )}
    </section>
  );
}
function Attempts({
  projectId,
  receiptId,
  initial,
  route,
  onRoute,
  blocked,
}: {
  projectId: string;
  receiptId: string;
  initial: Detail["attempts"];
  route: EventRoute;
  onRoute: (patch: Partial<EventRoute>) => void;
  blocked: boolean;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: [
      "event-attempts",
      projectId,
      projectSessionKey(),
      receiptId,
      route.attemptCursor,
    ],
    queryFn: ({ signal }) =>
      fetchEventAttempts(projectId, receiptId, route.attemptCursor, signal),
    enabled: Boolean(route.attemptCursor),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const page = route.attemptCursor
    ? !query.error
      ? query.data
      : undefined
    : initial;
  const first = () => onRoute({ attemptCursor: "", attemptPage: 1 });
  return (
    <section aria-label={t("eventReceipts.attempts")}>
      <h4>{t("eventReceipts.attempts")}</h4>
      {route.attemptCursor && query.isPending && <Skeleton active />}
      {query.error && route.attemptCursor ? (
        <EventProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onFirst={first}
        />
      ) : (
        page && (
          <>
            {!page.items.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("eventReceipts.noHistory")}
              />
            )}{" "}
            {page.items.map((attempt) => (
              <article className="event-receipt-attempt" key={attempt.id}>
                <Tag>{t("eventReceipts." + attempt.action)}</Tag>
                <p>
                  {t("eventReceipts.producer")} · {attempt.actor.id} ·{" "}
                  {attempt.created_at}
                </p>
                <p>
                  {t("eventReceipts." + attempt.from_state)} →{" "}
                  {t("eventReceipts." + attempt.to_state)}
                </p>
                {attempt.error && (
                  <Alert type="warning" title={attempt.error.message} />
                )}{" "}
                {attempt.result && (
                  <p>
                    {t("eventReceipts." + attempt.result.kind)} ·{" "}
                    {attempt.result.target_id}
                  </p>
                )}
              </article>
            ))}
            <EventPager
              page={route.attemptPage}
              total={page.total}
              more={page.has_more}
              busy={blocked || query.isFetching}
              onFirst={first}
              onNext={() =>
                page.next_cursor &&
                onRoute({
                  attemptCursor: page.next_cursor,
                  attemptPage: route.attemptPage + 1,
                })
              }
            />
          </>
        )
      )}
    </section>
  );
}
export function EventReceiptDetail({
  projectId,
  receiptId,
  identity,
  route,
  background,
  onRoute,
  onPending,
  canNavigate,
  onNavigate,
  onSaved,
}: {
  projectId: string;
  receiptId: string;
  identity: string;
  route: EventRoute;
  background: string;
  onRoute: (patch: Partial<EventRoute>) => void;
  onPending: (value: boolean) => void;
  canNavigate: () => boolean;
  onNavigate: (href: string) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("eventReceipts." + key);
  const qc = useQueryClient();
  const queryKey = ["event-receipt", projectId, projectSessionKey(), receiptId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchEventReceipt(projectId, receiptId, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = !query.error ? query.data : undefined;
  const controller = useEventRetryState(
    projectId,
    receiptId,
    data?.event,
    identity,
    onPending,
  );
  const [rawOpen, setRawOpen] = useState(false),
    [fullRaw, setFullRaw] = useState(false);
  const blocked = controller.busy || controller.unknown;
  if (!data)
    return (
      <div className="event-receipt-detail">
        {query.error ? (
          <EventProblem
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Skeleton active />
        )}
        {controller.unknown && (
          <Alert
            type="warning"
            title={tr("unknown")}
            action={
              <Button
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {tr("refresh")}
              </Button>
            }
          />
        )}
      </div>
    );
  const event = data.event;
  const saved = (_ack: EventRetryAck) => {
    for (const key of ["event-page", "event-receipt", "event-attempts"])
      void qc.invalidateQueries({ queryKey: [key, projectId] });
    onSaved();
  };
  const showRetry =
    data.capabilities.retry ||
    controller.unknown ||
    controller.failure ||
    controller.draft.reason ||
    controller.draft.conflict ||
    controller.ack;
  return (
    <article className="event-receipt-detail">
      <div className="event-receipt-heading">
        <h3>{event.type}</h3>
        <Button
          loading={query.isFetching}
          disabled={controller.busy}
          onClick={() => void query.refetch()}
        >
          {tr("refresh")}
        </Button>
      </div>
      <EventProcessingTags processing={event.processing} />
      <dl>
        {[
          ["producer", event.producer.id],
          ["source", event.source],
          ["subject", event.subject],
          ["storedAt", event.stored_at],
          ["revision", event.processing.revision],
          ["updatedAt", event.processing.updated_at],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{tr(String(label))}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <EventReason code={event.processing.reason_code} />
      <EventEffectResult
        projectId={projectId}
        effect={event.processing.result}
        identity={identity}
        background={background}
        canNavigate={canNavigate}
        onNavigate={onNavigate}
        disabled={blocked}
      />
      {showRetry ? (
        <RetryPanel
          controller={controller}
          data={data}
          onLatest={(latest) => {
            qc.setQueryData(queryKey, latest);
            onRoute({ attemptCursor: "", attemptPage: 1 });
          }}
          onSaved={saved}
        />
      ) : (
        <>
          <p className="event-receipt-note">{tr("noCapability")}</p>
          <EventReason code={data.capabilities.retry_reason_code} />
        </>
      )}
      <Attempts
        projectId={projectId}
        receiptId={receiptId}
        initial={data.attempts}
        route={route}
        onRoute={onRoute}
        blocked={blocked}
      />
      <Collapse
        size="small"
        onChange={(keys) => setRawOpen(keys.includes("raw"))}
        items={[
          {
            key: "raw",
            label: tr("raw"),
            children: rawOpen ? (
              <>
                <p className="event-receipt-note">{tr("rawHint")}</p>
                {!fullRaw && data.event_json.length > 8192 && (
                  <p>{t("eventReceipts.rawPreview", { count: 8192 })}</p>
                )}
                <pre className="event-receipt-raw">
                  {fullRaw ? data.event_json : data.event_json.slice(0, 8192)}
                </pre>
                {data.event_json.length > 8192 && (
                  <Button onClick={() => setFullRaw((value) => !value)}>
                    {tr(fullRaw ? "collapseRaw" : "expandRaw")}
                  </Button>
                )}
              </>
            ) : null,
          },
          {
            key: "ids",
            label: tr("technical"),
            children: (
              <dl>
                {[
                  ["eventId", event.event_id],
                  ["receiptId", event.id],
                  ["digest", event.digest],
                  ["operationId", event.processing.operation_id],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{tr(String(label))}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            ),
          },
        ]}
      />
    </article>
  );
}
