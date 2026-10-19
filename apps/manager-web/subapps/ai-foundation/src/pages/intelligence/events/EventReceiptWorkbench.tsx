import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Input, Skeleton } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExecutionExitGuard } from "@/lib/executionExitGuard";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { safeIssueOriginReturn } from "@/lib/issueOriginRoute";
import {
  currentEventHash,
  eventHash,
  fetchEventPage,
  parseEventRoute,
  type EventRoute,
} from "@/lib/eventReceipts";
import {
  EventPager,
  EventProblem,
  EventProcessingTags,
  EventReason,
} from "./EventReceiptCommon";
import { EventReceiptDetail } from "./EventReceiptDetail";
import "./event-receipts.css";
export function EventReceiptWorkbench({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const tr = (key: string) => t("eventReceipts." + key);
  const session = projectSessionKey();
  const exit = useExecutionExitGuard();
  const qc = useQueryClient();
  const [route, setRoute] = useState(() => parseEventRoute(currentEventHash()));
  const [type, setType] = useState(route.type),
    [producer, setProducer] = useState(route.producer);
  const drawer = useDrawerIdentity(
    JSON.stringify([projectId, session]),
    route.receipt,
  );
  const requestedProject = new URLSearchParams(
    currentEventHash().split("?")[1],
  ).get("project_id");
  const mismatch = Boolean(requestedProject && requestedProject !== projectId);
  useEffect(() => {
    const sync = () => {
      const value = parseEventRoute(currentEventHash());
      setRoute(value);
      setType(value.type);
      setProducer(value.producer);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const query = useQuery({
    queryKey: [
      "event-page",
      projectId,
      session,
      route.state,
      route.type,
      route.producer,
      route.cursor,
    ],
    queryFn: ({ signal }) =>
      fetchEventPage(
        projectId,
        {
          state: route.state,
          type: route.type,
          producer: route.producer,
          cursor: route.cursor,
        },
        signal,
      ),
    enabled: Boolean(projectId) && !mismatch,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  function change(patch: Partial<EventRoute>) {
    if (!exit.canNavigate()) return;
    const href = eventHash(projectId, patch, currentEventHash());
    history.pushState(null, "", href);
    window.dispatchEvent(new Event("hashchange"));
    setRoute(parseEventRoute(href));
  }
  const first = () => {
    change({ cursor: "", page: 1 });
    if (!route.cursor) void query.refetch();
  };
  if (!projectId) return <Alert type="info" title={tr("noProject")} />;
  if (mismatch)
    return (
      <Alert
        type="warning"
        title={tr("wrongProject")}
        action={
          <Button onClick={() => change({ receipt: "", cursor: "", page: 1 })}>
            {tr("refresh")}
          </Button>
        }
      />
    );
  const background = eventHash(projectId, {}, currentEventHash());
  const issueReturn = safeIssueOriginReturn(
    new URLSearchParams(currentEventHash().split("?")[1]).get("issue_return") ||
      "",
    projectId,
  );
  const navigate = (href: string) => {
    if (exit.canNavigate()) location.hash = href;
  };
  return (
    <section className="event-receipts" aria-label={tr("title")}>
      <header className="event-receipt-heading">
        <h2>{tr("title")}</h2>
        <Button
          disabled={exit.pending}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tr("refresh")}
        </Button>
      </header>
      <p className="event-receipt-note">{tr("hint")}</p>
      {issueReturn && (
        <Button disabled={exit.pending} onClick={() => navigate(issueReturn)}>
          {t("deliveryIssue.origins.back")}
        </Button>
      )}
      <div className="event-receipt-actions" aria-label={tr("processing")}>
        {(["all", "pending", "processed", "failed"] as const).map((state) => (
          <Button
            key={state}
            aria-pressed={state === route.state}
            type={state === route.state ? "primary" : "default"}
            disabled={exit.pending}
            onClick={() => change({ state })}
          >
            {tr(state)}
          </Button>
        ))}
      </div>
      <div className="event-receipt-filters">
        <label>
          {tr("type")}
          <Input
            aria-label={tr("type")}
            maxLength={160}
            disabled={exit.pending}
            value={type}
            onChange={(event) => setType(event.target.value)}
            onPressEnter={() =>
              change({ type: type.trim(), producer: producer.trim() })
            }
          />
        </label>
        <label>
          {tr("producerFilter")}
          <Input
            aria-label={tr("producerFilter")}
            maxLength={128}
            disabled={exit.pending}
            value={producer}
            onChange={(event) => setProducer(event.target.value)}
            onPressEnter={() =>
              change({ type: type.trim(), producer: producer.trim() })
            }
          />
        </label>
        <Button
          disabled={exit.pending}
          onClick={() =>
            change({ type: type.trim(), producer: producer.trim() })
          }
        >
          {tr("apply")}
        </Button>
      </div>
      {exit.blocked && (
        <Alert type="warning" role="alert" title={tr("blocked")} />
      )}
      {query.isPending && <Skeleton active />}
      {query.error ? (
        <EventProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onFirst={first}
        />
      ) : (
        query.data && (
          <>
            <small className="event-receipt-note">
              {tr("lastRead")} · {query.data.as_of}
            </small>
            <div className="event-receipt-list">
              {!query.data.items.length && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={tr("empty")}
                />
              )}{" "}
              {query.data.items.map((event) => (
                <article className="event-receipt-row" key={event.id}>
                  <EventProcessingTags processing={event.processing} />
                  <h3>{event.type}</h3>
                  <p className="event-receipt-text">
                    {tr("producer")} · {event.producer.id} · {event.stored_at}
                  </p>
                  {event.source && (
                    <p className="event-receipt-note">
                      {tr("source")} · {event.source}
                    </p>
                  )}
                  <EventReason code={event.processing.reason_code} />
                  {event.processing.result && (
                    <p>
                      {tr(event.processing.result.kind)} ·{" "}
                      {event.processing.result.target_id}
                    </p>
                  )}
                  <Button
                    disabled={exit.pending}
                    onClick={() => change({ receipt: event.id })}
                  >
                    {tr("open")}
                  </Button>
                </article>
              ))}
            </div>
            <EventPager
              page={route.page}
              total={query.data.total}
              more={query.data.has_more}
              busy={query.isFetching || exit.pending}
              onFirst={first}
              onNext={() =>
                query.data?.next_cursor &&
                change({ cursor: query.data.next_cursor, page: route.page + 1 })
              }
            />
          </>
        )
      )}
      <Drawer
        open={Boolean(route.receipt)}
        title={tr("detail")}
        size="min(760px, 100vw)"
        destroyOnHidden
        closable={!exit.pending}
        maskClosable={!exit.pending}
        keyboard={!exit.pending}
        onClose={() => change({ receipt: "" })}
        afterOpenChange={drawer.afterOpenChange}
      >
        {drawer.displayId && (
          <EventReceiptDetail
            key={JSON.stringify([projectId, session, drawer.displayId])}
            projectId={projectId}
            receiptId={drawer.displayId}
            identity={JSON.stringify(route)}
            route={route}
            background={background}
            onRoute={change}
            canNavigate={exit.canNavigate}
            onNavigate={navigate}
            onPending={(value) =>
              exit.setPending("event:" + drawer.displayId, value)
            }
            onSaved={() =>
              void qc.invalidateQueries({ queryKey: ["event-page", projectId] })
            }
          />
        )}
      </Drawer>
    </section>
  );
}
