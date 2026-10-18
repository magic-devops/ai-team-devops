import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { projectSessionKey } from "./projectPortfolio";
import { createEventGate } from "./eventReceiptState";
import { eventProblem, eventRetryDraftKey } from "./eventReceipts";
import { submitReleaseCommand, type ReleaseCommand } from "./deliveryRelease";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
export type ReleaseOriginal = {
  action: ReleaseCommand;
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
};
type State = {
  phase: "idle" | "sending" | "unknown" | "refused" | "succeeded";
  original?: ReleaseOriginal;
  error?: string;
  ack?: DeliveryCommandAck;
};
export function releaseCommandStorageKey(projectId: string, identity: string) {
  return (
    eventRetryDraftKey(projectId, "release:" + identity)?.replace(
      "sop.event-retry.v1:",
      "sop.release-command.v1:",
    ) || null
  );
}
export function releaseRecoverySlots(projectId: string, releaseId: string) {
  return [
    "candidate",
    "policy",
    "ci",
    ...(releaseId ? ["review:" + releaseId] : []),
  ].filter((identity) => {
    const key = releaseCommandStorageKey(projectId, identity);
    if (!key) return false;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      const value = JSON.parse(raw);
      return !["idle", "refused", "succeeded"].includes(value.phase);
    } catch {
      return true;
    }
  });
}
export function createReleaseCommandController(options: {
  projectId: string;
  scope: string;
  currentScope: () => string;
  load: () => string | null;
  save: (raw: string) => void;
  send: (original: ReleaseOriginal) => Promise<unknown>;
  onPending?: (pending: boolean) => void;
}) {
  let state: State = { phase: "idle" };
  const immutable = <T>(value: T): T => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(immutable);
      Object.freeze(value);
    }
    return value;
  };
  const freeze = (value: ReleaseOriginal) => {
    return immutable(structuredClone(value));
  };
  try {
    const raw = options.load();
    if (raw) {
      const value = JSON.parse(raw) as State;
      if (
        !value.original ||
        !value.original.action.startsWith("release.") ||
        typeof value.original.intent?.key !== "string" ||
        !value.original.intent.key ||
        !Number.isSafeInteger(value.original.intent.version) ||
        value.original.intent.version < 0 ||
        !value.original.payload ||
        typeof value.original.payload !== "object" ||
        !["sending", "unknown", "refused", "succeeded"].includes(value.phase)
      )
        throw new Error("retainedOriginalInvalid");
      for (const field of ["requirement_ids", "task_ids", "public_keys"])
        if (
          field in value.original.payload &&
          (!Array.isArray(value.original.payload[field]) ||
            !(value.original.payload[field] as unknown[]).every(
              (item) => typeof item === "string",
            ))
        )
          throw new Error("retainedOriginalInvalid");
      state = {
        ...value,
        original: freeze(value.original),
        phase: value.phase === "sending" ? "unknown" : value.phase,
      };
      if (value.phase === "succeeded") {
        options.save("");
        state = { phase: "idle" };
      }
    }
  } catch {
    state = { phase: "unknown", error: "retainedOriginalInvalid" };
  }
  const listeners = new Set<() => void>(),
    gate = createEventGate();
  gate.enter(options.scope);
  let live = true;
  const current = () => live && options.currentScope() === options.scope;
  const emit = (next: State) => {
    state = next;
    options.onPending?.(["sending", "unknown"].includes(next.phase));
    listeners.forEach((fn) => fn());
  };
  const retain = (next: State) => {
    try {
      options.save(JSON.stringify(next));
      emit(next);
      return true;
    } catch {
      emit({ ...next, error: "retainedOriginalUnavailable" });
      return false;
    }
  };
  async function send(original: ReleaseOriginal, replay: boolean) {
    if (!current() || state.phase === "sending") return;
    const previous = state,
      ticket = gate.start();
    if (!retain({ phase: "sending", original })) {
      emit({ ...previous, error: "retainedOriginalUnavailable" });
      return;
    }
    if (!current()) {
      retain({ ...state, phase: "unknown" });
      return;
    }
    try {
      const ack = (await options.send(original)) as DeliveryCommandAck;
      if (!current() || !gate.current(ticket)) return;
      const kind =
        original.action === "release.policy.save"
          ? "release_policy"
          : original.action === "release.ci.import"
            ? "ci_evidence"
            : "release_candidate";
      const target =
        original.action === "release.policy.save"
          ? options.projectId
          : typeof original.payload.id === "string"
            ? original.payload.id
            : null;
      if (
        !ack ||
        ack.project_id !== options.projectId ||
        ack.action !== original.action ||
        typeof ack.resource?.id !== "string" ||
        !ack.resource.id.trim() ||
        ack.resource.kind !== kind ||
        (target && target !== ack.resource.id) ||
        !Number.isSafeInteger(ack.applied_version) ||
        ack.applied_version !== original.intent.version + 1 ||
        !Number.isSafeInteger(ack.version) ||
        ack.version < ack.applied_version ||
        (ack.query_generation !== null &&
          (!Number.isSafeInteger(ack.query_generation) ||
            ack.query_generation < 1)) ||
        typeof ack.replayed !== "boolean" ||
        !Array.isArray(ack.affected_refs) ||
        ack.affected_refs.some(
          (ref) =>
            !ref ||
            typeof ref.kind !== "string" ||
            !ref.kind.trim() ||
            typeof ref.id !== "string" ||
            !ref.id.trim(),
        ) ||
        !ack.affected_refs.some(
          (ref) => ref.kind === ack.resource.kind && ref.id === ack.resource.id,
        ) ||
        (ack.result !== null &&
          (!ack.result ||
            typeof ack.result !== "object" ||
            Array.isArray(ack.result)))
      )
        throw new Error("ackMismatch");
      retain({ phase: "succeeded", original, ack });
      return ack;
    } catch (error) {
      if (!current() || !gate.current(ticket)) return;
      const problem = eventProblem(error);
      retain({
        phase: replay || problem.unknown ? "unknown" : "refused",
        original,
        error: problem.message,
      });
    }
  }
  return {
    current,
    snapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    run(original: ReleaseOriginal) {
      if (state.phase !== "idle" || !current())
        return Promise.resolve(undefined);
      return send(freeze(original), false);
    },
    replay() {
      return state.phase === "unknown" && state.original
        ? send(state.original, true)
        : Promise.resolve(undefined);
    },
    reset() {
      if (current() && ["refused", "succeeded"].includes(state.phase)) {
        try {
          options.save("");
          emit({ phase: "idle" });
        } catch {
          emit({ ...state, error: "retainedOriginalUnavailable" });
        }
      }
    },
    activate() {
      if (options.currentScope() === options.scope) {
        live = true;
        gate.enter(options.scope);
      }
    },
    invalidate() {
      live = false;
      gate.leave();
      if (state.phase === "sending") retain({ ...state, phase: "unknown" });
    },
  };
}
export function useReleaseCommand(
  projectId: string,
  identity: string,
  onPending?: (pending: boolean) => void,
) {
  const currentScope = () =>
    JSON.stringify([
      projectSessionKey(),
      typeof location === "undefined" ? "" : location.hash,
    ]);
  const scope = currentScope(),
    callback = useRef(onPending);
  callback.current = onPending;
  const controller = useMemo(() => {
    const key = releaseCommandStorageKey(projectId, identity);
    return createReleaseCommandController({
      projectId,
      scope,
      currentScope,
      load: () => (key ? sessionStorage.getItem(key) : null),
      save: (value) => {
        if (typeof window !== "undefined" && !key)
          throw new Error("retainedOriginalUnavailable");
        if (key) sessionStorage.setItem(key, value);
      },
      send: (original) =>
        submitReleaseCommand(
          projectId,
          original.action,
          original.payload,
          original.intent,
        ),
      onPending: (pending) => callback.current?.(pending),
    });
  }, [projectId, identity, scope]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    controller.activate();
    callback.current?.(
      ["sending", "unknown"].includes(controller.snapshot().phase),
    );
    const leave = () => controller.invalidate();
    window.addEventListener("hashchange", leave);
    window.addEventListener("popstate", leave);
    window.addEventListener("sop-session", leave);
    window.addEventListener("storage", leave);
    return () => {
      window.removeEventListener("hashchange", leave);
      window.removeEventListener("popstate", leave);
      window.removeEventListener("sop-session", leave);
      window.removeEventListener("storage", leave);
      controller.invalidate();
      callback.current?.(false);
    };
  }, [controller]);
  return {
    ...controller,
    state,
    locked: state.phase !== "idle" && state.phase !== "refused",
    unresolved: state.phase === "sending" || state.phase === "unknown",
  };
}
