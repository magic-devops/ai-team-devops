import { useEffect, useRef, useState } from "react";
import { projectSessionKey } from "./projectPortfolio";
import {
  clearSubmittedDiscussionDraft,
  discussionDraftKey,
  discussionFailure,
  prepareDiscussionCommand,
  restoreDiscussionDraft,
  storeDiscussionDraft,
  submitDiscussionCommand,
  type DiscussionCommand,
  type DiscussionDraft,
  type DiscussionScope,
} from "./deliveryDiscussions";
export function createDiscussionGate() {
  let scope = "",
    serial = 0,
    epoch = 0;
  return {
    enter(value: string) {
      if (scope !== value) {
        scope = value;
        epoch++;
      }
    },
    start() {
      return { scope, id: ++serial, epoch };
    },
    current(ticket: { scope: string; id: number; epoch: number }) {
      return (
        ticket.scope === scope && ticket.id === serial && ticket.epoch === epoch
      );
    },
    leave() {
      scope = "";
      epoch++;
    },
    epoch: () => epoch,
  };
}
export function useDiscussionDraft(
  projectId: string,
  scope: DiscussionScope | undefined,
  threadId: string,
  messageId: string,
  mode: string,
  identity: string,
  initial: Partial<DiscussionDraft> = {},
) {
  const storageKey = discussionDraftKey(
    projectId,
    scope,
    threadId,
    messageId,
    mode,
  );
  const scopeIdentity = JSON.stringify([projectSessionKey(), identity]);
  const gate = useRef(createDiscussionGate());
  gate.current.enter(scopeIdentity);
  const liveSession = projectSessionKey();
  const [draft, setDraft] = useState<DiscussionDraft>(
    () =>
      restoreDiscussionDraft(storageKey) || {
        schema: 1,
        revision: 0,
        title: "",
        body: "",
        refs: [],
        parent_message_id: null,
        ...initial,
      },
  );
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const inflight =
    useRef<ReturnType<ReturnType<typeof createDiscussionGate>["start"]>>();
  const [state, setState] = useState<{
    epoch: number;
    busy: boolean;
    failure: ReturnType<typeof discussionFailure> | null;
  }>({ epoch: gate.current.epoch(), busy: false, failure: null });
  const busy = state.epoch === gate.current.epoch() && state.busy;
  const failure = state.epoch === gate.current.epoch() ? state.failure : null;
  const unknown = Boolean(draft.pending && (draft.unknown || !busy));
  const update = (
    change: DiscussionDraft | ((value: DiscussionDraft) => DiscussionDraft),
  ) => {
    const next =
      typeof change === "function" ? change(currentDraft.current) : change;
    currentDraft.current = next;
    setDraft(next);
    storeDiscussionDraft(storageKey, next);
  };
  useEffect(() => {
    gate.current.enter(scopeIdentity);
    return () => gate.current.leave();
  }, [scopeIdentity]);
  const patch = (change: Partial<DiscussionDraft>) =>
    update((value) => ({ ...value, ...change, revision: value.revision + 1 }));
  const resetFailure = () => {
    update((value) => ({ ...value, pending: undefined, unknown: false }));
    setState({ epoch: gate.current.epoch(), busy: false, failure: null });
  };
  async function run(command?: DiscussionCommand, retry = false) {
    if (
      projectSessionKey() !== liveSession ||
      (inflight.current && gate.current.current(inflight.current))
    )
      return;
    if (!retry && unknown) return;
    const pending = retry
      ? currentDraft.current.pending
      : command
        ? prepareDiscussionCommand(
            command,
            currentDraft.current.revision,
            currentDraft.current.pending,
          )
        : undefined;
    if (!pending) return;
    const ticket = gate.current.start();
    inflight.current = ticket;
    update((value) => ({ ...value, pending, unknown: false }));
    setState({ epoch: ticket.epoch, busy: true, failure: null });
    const current = () =>
      projectSessionKey() === liveSession && gate.current.current(ticket);
    try {
      const ack = await submitDiscussionCommand(projectId, pending);
      if (!current()) return;
      update((value) => clearSubmittedDiscussionDraft(value, pending));
      return ack;
    } catch (error) {
      if (current()) {
        const problem = discussionFailure(error);
        update((value) => ({
          ...value,
          unknown: problem.unknown,
          ...(!problem.unknown ? { pending: undefined } : {}),
        }));
        setState({ epoch: ticket.epoch, busy: false, failure: problem });
      }
    } finally {
      if (current()) {
        inflight.current = undefined;
        setState((value) =>
          value.epoch === ticket.epoch ? { ...value, busy: false } : value,
        );
      }
    }
  }
  return {
    draft,
    patch,
    update,
    run,
    busy,
    failure,
    unknown,
    resetFailure,
    recoverable: Boolean(storageKey),
  };
}
