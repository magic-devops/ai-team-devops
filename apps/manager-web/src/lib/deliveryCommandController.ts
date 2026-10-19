import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { projectSessionKey } from "./projectPortfolio";
import { createEventGate } from "./eventReceiptState";
import { eventProblem } from "./eventReceipts";
import type { DeliveryCommandAck, DeliveryIntent } from "./delivery";
export type DeliveryOriginal = {
  action: string;
  payload: Record<string, unknown>;
  intent: DeliveryIntent;
};
export type DeliveryCommandState<T extends DeliveryOriginal> = {
  phase: "idle" | "sending" | "unknown" | "refused" | "succeeded";
  original?: T;
  error?: string;
  ack?: DeliveryCommandAck;
};
export function validDeliveryOriginal(value: DeliveryOriginal) {
  return Boolean(
    value &&
    typeof value.action === "string" &&
    typeof value.intent?.key === "string" &&
    value.intent.key.trim() &&
    value.intent.key.length <= 128 &&
    Number.isSafeInteger(value.intent.version) &&
    value.intent.version >= 0 &&
    value.payload &&
    typeof value.payload === "object" &&
    !Array.isArray(value.payload),
  );
}
export function validDeliveryCommandAck(
  projectId: string,
  original: DeliveryOriginal,
  value: unknown,
  kind: string,
  target: string | null = null,
): value is DeliveryCommandAck {
  const ack = value as DeliveryCommandAck | undefined;
  return Boolean(
    ack &&
    ack.project_id === projectId &&
    ack.action === original.action &&
    typeof ack.resource?.id === "string" &&
    ack.resource.id.trim() &&
    ack.resource.kind === kind &&
    (!target || target === ack.resource.id) &&
    Number.isSafeInteger(ack.applied_version) &&
    ack.applied_version === original.intent.version + 1 &&
    Number.isSafeInteger(ack.version) &&
    ack.version >= ack.applied_version &&
    (ack.query_generation === null ||
      (Number.isSafeInteger(ack.query_generation) &&
        ack.query_generation > 0)) &&
    typeof ack.replayed === "boolean" &&
    Array.isArray(ack.affected_refs) &&
    ack.affected_refs.every(
      (ref) =>
        ref &&
        typeof ref.kind === "string" &&
        ref.kind.trim() &&
        typeof ref.id === "string" &&
        ref.id.trim(),
    ) &&
    ack.affected_refs.some(
      (ref) => ref.kind === kind && ref.id === ack.resource.id,
    ) &&
    (ack.result === null ||
      (ack.result &&
        typeof ack.result === "object" &&
        !Array.isArray(ack.result))),
  );
}
export type DeliveryControllerOptions<T extends DeliveryOriginal> = {
  projectId: string;
  scope: string;
  currentScope: () => string;
  load: () => string | null;
  save: (raw: string) => void;
  send: (original: T) => Promise<unknown>;
  validateOriginal: (original: T) => boolean;
  validateAck: (original: T, value: unknown) => boolean;
  onPending?: (pending: boolean) => void;
};
export function createDeliveryCommandController<T extends DeliveryOriginal>(
  options: DeliveryControllerOptions<T>,
) {
  type State = DeliveryCommandState<T>;
  let state: State = { phase: "idle" };
  const immutable = <V>(value: V): V => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(immutable);
      Object.freeze(value);
    }
    return value;
  };
  const freeze = (original: T) => immutable(structuredClone(original));
  try {
    const raw = options.load();
    if (raw) {
      const saved = JSON.parse(raw) as State;
      if (
        !saved.original ||
        !validDeliveryOriginal(saved.original) ||
        !options.validateOriginal(saved.original) ||
        !["sending", "unknown", "refused", "succeeded"].includes(saved.phase)
      )
        throw new Error("retainedOriginalInvalid");
      if (
        saved.phase === "succeeded" &&
        !options.validateAck(saved.original, saved.ack)
      )
        throw new Error("retainedOriginalInvalid");
      state = {
        ...saved,
        original: freeze(saved.original),
        phase: saved.phase === "sending" ? "unknown" : saved.phase,
      };
      if (saved.phase === "succeeded") {
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
  async function send(original: T, replay: boolean) {
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
      const ack = await options.send(original);
      if (!current() || !gate.current(ticket)) return;
      if (!options.validateAck(original, ack)) throw new Error("ackMismatch");
      retain({ phase: "succeeded", original, ack: ack as DeliveryCommandAck });
      return ack as DeliveryCommandAck;
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
    run(original: T) {
      if (state.phase !== "idle" || !current())
        return Promise.resolve(undefined);
      if (
        !validDeliveryOriginal(original) ||
        !options.validateOriginal(original)
      ) {
        emit({ phase: "idle", error: "retainedOriginalInvalid" });
        return Promise.resolve(undefined);
      }
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
export function useDeliveryCommand<T extends DeliveryOriginal>(options: {
  projectId: string;
  identity: string;
  storageKey: () => string | null;
  create: (
    options: Pick<
      DeliveryControllerOptions<T>,
      "projectId" | "scope" | "currentScope" | "load" | "save" | "onPending"
    >,
  ) => ReturnType<typeof createDeliveryCommandController<T>>;
  onPending?: (pending: boolean) => void;
}) {
  const currentScope = () =>
    JSON.stringify([
      projectSessionKey(),
      typeof location === "undefined" ? "" : location.hash,
    ]);
  const scope = currentScope(),
    callback = useRef(options.onPending);
  callback.current = options.onPending;
  const controller = useMemo(() => {
    const key = options.storageKey();
    return options.create({
      projectId: options.projectId,
      scope,
      currentScope,
      load: () => (key ? sessionStorage.getItem(key) : null),
      save: (value) => {
        if (typeof window !== "undefined" && !key)
          throw new Error("retainedOriginalUnavailable");
        if (key) sessionStorage.setItem(key, value);
      },
      onPending: (pending) => callback.current?.(pending),
    });
  }, [options.projectId, options.identity, scope]);
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
    if (typeof window !== "undefined")
      for (const name of ["hashchange", "popstate", "sop-session", "storage"])
        window.addEventListener(name, leave);
    return () => {
      if (typeof window !== "undefined")
        for (const name of ["hashchange", "popstate", "sop-session", "storage"])
          window.removeEventListener(name, leave);
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
