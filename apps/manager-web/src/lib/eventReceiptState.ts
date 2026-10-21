import { useEffect, useRef, useState } from "react";
import { projectSessionKey } from "./projectPortfolio";
import { request } from "./http";
import { fetchTaskDetail, fetchRequirementDetail } from "./deliveryQuery";
import { fetchDeliveryIssue } from "./deliveryIssue";
import {
  eventProblem,
  eventRetryDraftKey,
  fetchEventReceipt,
  prepareEventRetry,
  restoreEventRetryDraft,
  retryEventReceipt,
  safeEventReturn,
  storeEventRetryDraft,
  type EventEffect,
  type EventRetryDraft,
  type EventRetryAck,
  type EventReceiptDetail,
  type EventSummary,
} from "./eventReceipts";
export function createEventGate() {
  let key = "",
    serial = 0,
    epoch = 0;
  return {
    enter(value: string) {
      if (key !== value) {
        key = value;
        epoch++;
      }
    },
    start() {
      return { id: ++serial, epoch, scope: key };
    },
    current(ticket: { id: number; epoch: number; scope: string }) {
      return (
        ticket.id === serial && ticket.epoch === epoch && ticket.scope === key
      );
    },
    epoch: () => epoch,
    leave() {
      key = "";
      epoch++;
    },
  };
}
// Invalidate immediately; a route can leave and return before React commits.
function observeEventRoute(invalidate: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("hashchange", invalidate);
  window.addEventListener("popstate", invalidate);
  return () => {
    window.removeEventListener("hashchange", invalidate);
    window.removeEventListener("popstate", invalidate);
  };
}
export async function eventTargetHref(
  projectId: string,
  effect: EventEffect,
  background: string,
  signal?: AbortSignal,
) {
  const target = effect.target_id;
  if (!target) throw new Error("event_target_unavailable");
  const params = new URLSearchParams({ project_id: projectId });
  let taskTarget = effect.target_kind === "task" ? target : undefined;
  if (effect.kind === "task_delivery_submitted" && effect.target_kind === "task_submission") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(target))
      throw new Error("event_target_unavailable");
    const locator = await request<unknown>(
      "/api/v1/delivery/delivery-submissions/" + encodeURIComponent(target) + "/locator",
      { headers: { "X-Project-Id": projectId }, signal },
    );
    if (!locator || typeof locator !== "object" || Array.isArray(locator))
      throw new Error("event_target_unavailable");
    const value = locator as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "project_id,submission_id,task_id" ||
      value.project_id !== projectId || value.submission_id !== target ||
      typeof value.task_id !== "string" || !value.task_id.trim() ||
      Array.from(value.task_id).length > 64 || /[\u0000-\u001f\u007f]/.test(value.task_id))
      throw new Error("event_scope_changed");
    taskTarget = value.task_id;
    params.set("submission_id", target);
  }
  if (taskTarget) {
    const value = await fetchTaskDetail(projectId, taskTarget, signal);
    if (value.project_id !== projectId || value.task.id !== taskTarget)
      throw new Error("event_scope_changed");
    params.set("view", value.task.req_id ? "list" : "timeline");
    params.set("task", taskTarget);
    if (value.task.req_id) {
      params.set("requirement", value.task.req_id);
      params.set("detail", "tasks");
    }
  } else if (effect.target_kind === "issue") {
    const value = await fetchDeliveryIssue(projectId, target, signal);
    if (value.project_id !== projectId || value.issue.id !== target)
      throw new Error("event_scope_changed");
    params.set("view", "issues");
    params.set("issue", target);
  } else if (effect.target_kind === "requirement") {
    const value = await fetchRequirementDetail(projectId, target, signal);
    if (value.project_id !== projectId || value.requirement.id !== target)
      throw new Error("event_scope_changed");
    params.set("view", "list");
    params.set("requirement", target);
    params.set("detail", "details");
  } else throw new Error("event_target_unavailable");
  const back = safeEventReturn(background, projectId);
  if (back) params.set("event_return", back);
  return "#/dev-flow?" + params;
}
export function useEventTargetNavigation(
  projectId: string,
  identity: string,
  canNavigate: () => boolean,
  onNavigate: (href: string) => void,
) {
  const session = projectSessionKey();
  const scope = JSON.stringify([projectId, session, identity]);
  const gate = useRef(createEventGate());
  gate.current.enter(scope);
  const epoch = gate.current.epoch();
  const renderToken = { epoch };
  const [state, setState] = useState<{
    epoch: number;
    busy: boolean;
    error: unknown;
  }>({ epoch, busy: false, error: null });
  const abort = useRef<AbortController>();
  useEffect(() => {
    gate.current.enter(scope);
    renderToken.epoch = gate.current.epoch();
    const stop = observeEventRoute(() => {
      gate.current.leave();
      abort.current?.abort();
    });
    return () => {
      stop();
      gate.current.leave();
      abort.current?.abort();
    };
  }, [scope]);
  async function open(effect: EventEffect, background: string) {
    if (
      !canNavigate() ||
      session !== projectSessionKey() ||
      renderToken.epoch !== gate.current.epoch()
    )
      return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const ticket = gate.current.start();
    setState({ epoch: ticket.epoch, busy: true, error: null });
    try {
      const href = await eventTargetHref(
        projectId,
        effect,
        background,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        gate.current.current(ticket) &&
        session === projectSessionKey() &&
        canNavigate()
      )
        onNavigate(href);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        gate.current.current(ticket) &&
        session === projectSessionKey()
      )
        setState({ epoch: ticket.epoch, busy: false, error });
    } finally {
      if (gate.current.current(ticket) && session === projectSessionKey())
        setState((value) =>
          value.epoch === ticket.epoch ? { ...value, busy: false } : value,
        );
    }
  }
  return {
    open,
    busy: state.epoch === epoch && state.busy,
    error: state.epoch === epoch ? state.error : null,
  };
}
type RetryState = {
  epoch: number;
  busy: boolean;
  reading: boolean;
  failure: ReturnType<typeof eventProblem> | null;
  readError: unknown;
  latest: EventReceiptDetail | null;
  ack: EventRetryAck | null;
};
export function useEventRetryState(
  projectId: string,
  receiptId: string,
  event: EventSummary | undefined,
  identity: string,
  onPending?: (value: boolean) => void,
) {
  const session = projectSessionKey(),
    scope = JSON.stringify([projectId, receiptId, session, identity]);
  const gate = useRef(createEventGate());
  gate.current.enter(scope);
  const epoch = gate.current.epoch();
  const renderToken = { epoch };
  const key = eventRetryDraftKey(projectId, receiptId);
  const [draft, setDraft] = useState<EventRetryDraft>(
    () =>
      restoreEventRetryDraft(key, receiptId) || {
        schema: 1,
        reason: "",
        ...(event
          ? {
              basis: {
                eventId: event.event_id,
                digest: event.digest,
                revision: event.processing.revision,
              },
            }
          : {}),
      },
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const callback = useRef(onPending);
  callback.current = onPending;
  const inFlight =
    useRef<ReturnType<ReturnType<typeof createEventGate>["start"]>>();
  const [state, setState] = useState<RetryState>({
    epoch,
    busy: false,
    reading: false,
    failure: null,
    readError: null,
    latest: null,
    ack: null,
  });
  const visible =
    state.epoch === epoch
      ? state
      : {
          epoch,
          busy: false,
          reading: false,
          failure: null,
          readError: null,
          latest: null,
          ack: null,
        };
  const busy = visible.busy,
    unknown = Boolean(draft.pending && (draft.unknown || !busy));
  const currentRender = () =>
    session === projectSessionKey() &&
    gate.current.epoch() === renderToken.epoch;
  const update = (change: (value: EventRetryDraft) => EventRetryDraft) => {
    if (!currentRender()) return;
    const next = change(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    storeEventRetryDraft(key, next);
  };
  useEffect(() => {
    gate.current.enter(scope);
    renderToken.epoch = gate.current.epoch();
    const stop = observeEventRoute(() => gate.current.leave());
    return () => {
      stop();
      gate.current.leave();
    };
  }, [scope]);
  useEffect(() => {
    callback.current?.(busy || unknown);
  }, [busy, unknown]);
  useEffect(() => () => callback.current?.(false), []);
  const patch = (reason: string) => {
    if (busy || unknown || !currentRender()) return;
    update((value) => ({
      ...value,
      reason,
      ...(!value.basis && event
        ? {
            basis: {
              eventId: event.event_id,
              digest: event.digest,
              revision: event.processing.revision,
            },
          }
        : {}),
    }));
  };
  async function run(retry = false, allowed = false) {
    if (
      !allowed ||
      !currentRender() ||
      (inFlight.current && gate.current.current(inFlight.current)) ||
      (!retry && (unknown || draftRef.current.conflict || visible.ack)) ||
      visible.reading
    )
      return;
    let command = draftRef.current.pending;
    try {
      if (!retry) {
        if (!event || event.id !== receiptId) return;
        const basis = draftRef.current.basis;
        if (
          basis &&
          (basis.eventId !== event.event_id || basis.digest !== event.digest)
        )
          throw new Error("event_scope_changed");
        command = prepareEventRetry(
          {
            ...event,
            processing: {
              ...event.processing,
              revision: basis?.revision || event.processing.revision,
            },
          },
          draftRef.current.reason,
          command,
        );
      }
      if (!command) return;
    } catch (error) {
      setState({ ...visible, epoch, failure: eventProblem(error) });
      return;
    }
    const ticket = gate.current.start();
    const operationEpoch = ticket.epoch;
    inFlight.current = ticket;
    const wasUnknown = unknown;
    update((value) => ({ ...value, pending: command, unknown: false }));
    setState({
      ...visible,
      epoch: operationEpoch,
      busy: true,
      failure: null,
      ack: null,
    });
    callback.current?.(true);
    const current = () =>
      gate.current.current(ticket) && session === projectSessionKey();
    try {
      const ack = await retryEventReceipt(projectId, command);
      if (!current()) return;
      update((value) => ({ ...value, pending: undefined, unknown: false }));
      setState((value) => ({
        ...value,
        epoch: operationEpoch,
        busy: false,
        failure: null,
        ack,
      }));
      callback.current?.(false);
      return ack;
    } catch (error) {
      if (current()) {
        const problem = eventProblem(error);
        // The retry API emits only these refusals after both original-key
        // lookups and the project lock. Earlier permission errors prove nothing
        // about the original request, so all other unknown outcomes stay locked.
        const confirmedRefusal =
          retry &&
          wasUnknown &&
          ((problem.status === 409 &&
            problem.code === "event_revision_conflict") ||
            (problem.status === 403 && problem.code === "event_retry_denied"));
        const unresolved = problem.unknown || (wasUnknown && !confirmedRefusal);
        update((value) => ({
          ...value,
          unknown: unresolved,
          conflict: problem.conflict || confirmedRefusal,
          ...(!unresolved ? { pending: undefined } : {}),
        }));
        setState((value) => ({
          ...value,
          epoch: operationEpoch,
          busy: false,
          failure: problem,
        }));
        callback.current?.(unresolved);
      }
    } finally {
      if (current()) {
        inFlight.current = undefined;
        setState((value) =>
          value.epoch === operationEpoch ? { ...value, busy: false } : value,
        );
      }
    }
  }
  async function loadLatest() {
    if (busy || visible.reading || !currentRender()) return;
    const ticket = gate.current.start();
    const readEpoch = ticket.epoch;
    setState({
      ...visible,
      epoch: readEpoch,
      reading: true,
      readError: null,
      latest: null,
    });
    try {
      const latest = await fetchEventReceipt(projectId, receiptId);
      if (gate.current.current(ticket) && session === projectSessionKey())
        setState((value) => ({
          ...value,
          epoch: readEpoch,
          reading: false,
          latest,
        }));
    } catch (error) {
      if (gate.current.current(ticket) && session === projectSessionKey())
        setState((value) => ({
          ...value,
          epoch: readEpoch,
          reading: false,
          readError: error,
        }));
    }
  }
  function adopt() {
    const latest = visible.latest;
    if (!latest || busy || unknown || !currentRender()) return;
    const basis = draftRef.current.basis;
    if (
      basis &&
      (basis.eventId !== latest.event.event_id ||
        basis.digest !== latest.event.digest)
    )
      return;
    update((value) => ({
      ...value,
      basis: {
        eventId: latest.event.event_id,
        digest: latest.event.digest,
        revision: latest.event.processing.revision,
      },
      pending: undefined,
      unknown: false,
      conflict: false,
    }));
    setState({ ...visible, epoch, latest: null, failure: null, ack: null });
    return latest;
  }
  return {
    draft,
    patch,
    run,
    loadLatest,
    adopt,
    busy,
    unknown,
    reading: visible.reading,
    failure: visible.failure,
    readError: visible.readError,
    latest: visible.latest,
    ack: visible.ack,
    recoverable: Boolean(key),
  };
}
