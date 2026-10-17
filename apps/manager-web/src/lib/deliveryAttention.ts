import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchDeliveryInbox, type DeliveryInboxTarget } from "./delivery";
import { fetchTaskDetail } from "./deliveryQuery";
import { projectSessionKey } from "./projectPortfolio";
import type { InboxCategory, InboxScope } from "./deliveryProjectInbox";

export function useDeliveryInboxQuery({
  projectId,
  sessionId,
  queryGeneration,
  view,
  scope,
  category,
  cursor,
  utcDay = new Date().toISOString().slice(0, 10),
  enabled,
}: {
  projectId: string;
  sessionId: string;
  queryGeneration?: number | null;
  view: string;
  scope: InboxScope;
  category: InboxCategory;
  cursor: string;
  utcDay?: string;
  enabled: boolean;
}) {
  const overview = view === "overview";
  const selectedScope = overview ? "mine" : scope;
  const selectedCategory = overview ? "all" : category;
  const selectedCursor = overview ? "" : cursor;
  const limit = overview ? 1 : 20;
  const query = useQuery({
    queryKey: [
      "delivery-inbox",
      projectId,
      sessionId,
      view,
      selectedScope,
      selectedCategory,
      selectedCursor,
      limit,
      queryGeneration,
      utcDay,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryInbox(
        projectId,
        selectedScope,
        signal,
        { category: selectedCategory, cursor: selectedCursor, limit },
        queryGeneration,
      ),
    enabled:
      enabled &&
      queryGeneration != null &&
      ["overview", "inbox"].includes(view),
    retry: false,
    gcTime: 0,
  });
  const data = query.data;
  const mismatch =
    data &&
    (data.project_id !== projectId ||
      data.query_generation !== queryGeneration ||
      data.scope !== selectedScope ||
      data.category !== selectedCategory ||
      data.limit !== limit);
  const error =
    query.error ||
    (mismatch
      ? new Error('HTTP 409: {"detail":{"code":"delivery_query_cursor_stale"}}')
      : null);
  return { ...query, error, data: !error && enabled ? data : undefined };
}

export function useDeliveryInboxNavigation({
  projectId,
  sessionId,
  view,
  scope,
  category,
  cursor,
  canNavigate,
  onOpen,
}: {
  projectId: string;
  sessionId: string;
  view: string;
  scope: string;
  category: string;
  cursor: string;
  canNavigate: () => boolean;
  onOpen: (target: DeliveryInboxTarget) => void;
}) {
  const key = JSON.stringify([
    projectId,
    sessionId,
    view,
    scope,
    category,
    cursor,
  ]);
  const current = useRef({ key, epoch: 0 });
  if (current.current.key !== key)
    current.current = { key, epoch: current.current.epoch + 1 };
  const epoch = current.current.epoch;
  const active = useRef(true);
  const pending = useRef<{
    key: string;
    epoch: number;
    controller: AbortController;
  }>();
  const [result, setResult] = useState<{
    key: string;
    epoch: number;
    busy: string;
    error?: string;
    failed?: DeliveryInboxTarget;
  }>({ key, epoch, busy: "" });
  useEffect(() => {
    if (pending.current && pending.current.epoch !== epoch)
      pending.current.controller.abort();
  }, [key, epoch]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current?.controller.abort();
    };
  }, []);
  const open = async (target: DeliveryInboxTarget) => {
    if (current.current.epoch !== epoch) return;
    if (!canNavigate()) return;
    if (target.issue_id || !target.task_id) {
      onOpen(target);
      return;
    }
    if (view !== "inbox") return;
    if (pending.current?.epoch === epoch) return;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const request = { key, epoch, controller };
    pending.current = request;
    const origin = projectSessionKey();
    const hash = location.hash;
    const isCurrent = () =>
      active.current &&
      current.current.epoch === epoch &&
      pending.current === request &&
      !controller.signal.aborted &&
      origin === projectSessionKey() &&
      hash === location.hash;
    setResult({ key, epoch, busy: target.task_id });
    try {
      const detail = await fetchTaskDetail(
        projectId,
        target.task_id,
        controller.signal,
      );
      if (!isCurrent()) return;
      if (detail.project_id !== projectId || detail.task.id !== target.task_id)
        throw new Error(
          'HTTP 409: {"detail":{"code":"delivery_query_cursor_stale"}}',
        );
      if (canNavigate())
        onOpen({
          ...target,
          requirement_id: detail.task.req_id || "",
          detail: "tasks",
        });
    } catch (error) {
      if (isCurrent())
        setResult({
          key,
          epoch,
          busy: "",
          error: error instanceof Error ? error.message : String(error),
          failed: target,
        });
    } finally {
      if (pending.current === request) {
        pending.current = undefined;
        if (active.current && current.current.epoch === epoch)
          setResult((previous) => ({ ...previous, busy: "" }));
      }
    }
  };
  const isResultCurrent = () =>
    result.key === key &&
    result.epoch === epoch &&
    current.current.epoch === epoch;
  return {
    open,
    busy: isResultCurrent() ? result.busy : "",
    error: isResultCurrent() ? result.error : undefined,
    retry: () =>
      isResultCurrent() && result.failed
        ? open(result.failed)
        : Promise.resolve(),
  };
}
