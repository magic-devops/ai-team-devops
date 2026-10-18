import type { SyncPushBody } from "./api";
import { createEventGate } from "./eventReceiptState";
import { eventProblem, type EventProcessing } from "./eventReceipts";

export type AssetModule = "rules" | "specs" | "templates";
export type AssetDraft = {
  module: AssetModule;
  path: string;
  content: string;
  version: string;
  basis: "existing" | "absent";
  sha: string;
};
export type AssetIdentity = {
  tenantId: string;
  userId: string;
  projectId: string;
  revision: string;
};
export type AssetCommand = {
  body: Extract<SyncPushBody, { module: AssetModule }>;
  eventId: string;
};
export type AssetAck = {
  id: string;
  digest: string;
  outcome: "stored" | "duplicate";
  receipt_id: string;
  processing: EventProcessing | null;
};
export type AssetPhase =
  | "editing"
  | "review"
  | "sending"
  | "unknown"
  | "stored"
  | "processed"
  | "failed"
  | "rejected";
export type AssetState = {
  schema: 1;
  draft: AssetDraft;
  phase: AssetPhase;
  command?: AssetCommand;
  ack?: AssetAck;
  error?: string;
};
export const assetSyncBlocksExit = (phase: AssetPhase) =>
  phase === "sending" || phase === "unknown";
const sha = /^[a-f0-9]{64}$/;
const modules: AssetModule[] = ["rules", "specs", "templates"];
const bases = {
  rules: ".ai-memory/rules/",
  specs: "sop/custom/specs/",
  templates: "sop/custom/",
};
export const emptyAssetDraft = (): AssetDraft => ({
  module: "rules",
  path: "RULES.md",
  content: "",
  version: "",
  basis: "existing",
  sha: "",
});
export function assetDraftKey(identity: AssetIdentity) {
  return (
    "sop.asset-sync.v1:" +
    JSON.stringify([
      identity.tenantId,
      identity.userId,
      identity.revision,
      identity.projectId,
    ])
  );
}
export function assetTarget(draft: Pick<AssetDraft, "module" | "path">) {
  return bases[draft.module] + draft.path;
}
export function assetBody(
  draft: AssetDraft,
  key: string,
): AssetCommand["body"] {
  if (
    !modules.includes(draft.module) ||
    !draft.path ||
    draft.path !== draft.path.trim() ||
    draft.path.length > 1024 ||
    /[\\:\u0000-\u001f\u007f]/.test(draft.path) ||
    draft.path.startsWith("/") ||
    Object.values(bases).some((base) =>
      draft.path.toLowerCase().startsWith(base),
    ) ||
    (draft.module === "templates" && !draft.path.startsWith("templates/")) ||
    draft.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    !/\.(md|json|ya?ml|toml)$/i.test(draft.path)
  )
    throw new Error("invalidPath");
  if (
    !/^(0|[1-9]\d*)$/.test(draft.version) ||
    !Number.isSafeInteger(Number(draft.version))
  )
    throw new Error("invalidVersion");
  if (
    draft.basis !== "absent" &&
    (draft.basis !== "existing" || !sha.test(draft.sha))
  )
    throw new Error("invalidSha");
  if (
    typeof draft.content !== "string" ||
    new TextEncoder().encode(draft.content).length > 60 * 1024
  )
    throw new Error("invalidContent");
  if (!key || key.length > 128 || /[\u0000-\u001f\u007f]/.test(key))
    throw new Error("invalidKey");
  return {
    module: draft.module,
    action: "upsert",
    expected_version: Number(draft.version),
    idempotency_key: key,
    record: {
      path: draft.path,
      content: draft.content,
      expected_sha256: draft.basis === "absent" ? null : draft.sha,
    },
  };
}
// sync.push uses Python json.dumps([tenant, project, actor, key]) for its event ID.
// Matching that ID lets a malformed or unrelated acknowledgement stay unresolved.
export async function assetEventId(identity: AssetIdentity, key: string) {
  const source =
    "[" +
    [identity.tenantId, identity.projectId, identity.userId, key]
      .map((value) =>
        JSON.stringify(value).replace(
          /[\u0080-\uffff]/g,
          (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
        ),
      )
      .join(", ") +
    "]";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return (
    "sync-" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
function freezeCommand(command: AssetCommand) {
  Object.freeze(command.body.record);
  Object.freeze(command.body);
  return Object.freeze(command);
}
export function parseAssetAck(
  value: unknown,
  command: AssetCommand,
  previous?: AssetAck,
): AssetAck {
  const ack = value as AssetAck;
  if (
    !ack ||
    ack.id !== command.eventId ||
    !sha.test(ack.digest || "") ||
    !ack.receipt_id ||
    !["stored", "duplicate"].includes(ack.outcome) ||
    (previous &&
      (previous.id !== ack.id ||
        previous.digest !== ack.digest ||
        previous.receipt_id !== ack.receipt_id))
  )
    throw new Error("ackMismatch");
  const processing = ack.processing;
  if (
    processing !== null &&
    (!processing ||
      !["pending", "processed", "failed"].includes(processing.state) ||
      !Number.isSafeInteger(processing.revision) ||
      processing.revision < 1)
  )
    throw new Error("ackMismatch");
  const target = processing?.result?.target_id;
  const canonicalTarget =
    typeof target === "string" &&
    target.length > 0 &&
    target.length <= 2048 &&
    target === target.trim() &&
    !/[\\:\u0000-\u001f\u007f]/.test(target) &&
    !target.startsWith("/") &&
    target.split("/").every((part) => part && part !== "." && part !== "..");
  if (
    processing?.state === "processed" &&
    (processing.result?.kind !== "asset_materialized" ||
      processing.result.target_kind !== "asset" ||
      !canonicalTarget)
  )
    throw new Error("ackMismatch");
  return ack;
}
function ackPhase(ack: AssetAck): AssetPhase {
  return ack.processing?.state === "processed"
    ? "processed"
    : ack.processing?.state === "failed"
      ? "failed"
      : "stored";
}
export function restoreAssetState(raw: string | null): AssetState {
  if (!raw) return { schema: 1, draft: emptyAssetDraft(), phase: "editing" };
  const value = JSON.parse(raw) as AssetState;
  if (
    value.schema !== 1 ||
    !value.draft ||
    ![
      "editing",
      "review",
      "sending",
      "unknown",
      "stored",
      "processed",
      "failed",
      "rejected",
    ].includes(value.phase)
  )
    throw new Error("storageInvalid");
  if (value.command) {
    const expected = assetBody(value.draft, value.command.body.idempotency_key);
    if (
      JSON.stringify(value.command.body) !== JSON.stringify(expected) ||
      !/^sync-[a-f0-9]{64}$/.test(value.command.eventId)
    )
      throw new Error("storageInvalid");
    value.command = freezeCommand(value.command);
    if (value.ack) parseAssetAck(value.ack, value.command);
  } else if (value.phase !== "editing") throw new Error("storageInvalid");
  if (
    ["stored", "processed", "failed"].includes(value.phase) &&
    (!value.ack || ackPhase(value.ack) !== value.phase)
  )
    throw new Error("storageInvalid");
  return value.phase === "sending" ? { ...value, phase: "unknown" } : value;
}
export function createAssetSyncController(options: {
  identity: AssetIdentity;
  scope: string;
  currentScope: () => string;
  load: () => string | null;
  save: (value: string) => void;
  send: (body: AssetCommand["body"]) => Promise<unknown>;
  key?: () => string;
}) {
  let state: AssetState;
  try {
    state = restoreAssetState(options.load());
  } catch {
    state = {
      schema: 1,
      draft: emptyAssetDraft(),
      phase: "unknown",
      error: "storageInvalid",
    };
  }
  const gate = createEventGate();
  gate.enter(options.scope);
  let live = true,
    preparing = false;
  const listeners = new Set<() => void>();
  const current = () => live && options.currentScope() === options.scope;
  const emit = (next: AssetState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const retain = (next: AssetState) => {
    try {
      options.save(JSON.stringify(next));
      emit(next);
      return true;
    } catch {
      emit({ ...next, error: "storageUnavailable" });
      return false;
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch(patch: Partial<AssetDraft>) {
      if (!current() || preparing || state.phase !== "editing") return;
      retain({
        schema: 1,
        phase: "editing",
        draft: { ...state.draft, ...patch },
      });
    },
    async review() {
      if (!current() || preparing || state.phase !== "editing") return;
      preparing = true;
      const ticket = gate.start();
      try {
        const body = assetBody(
          state.draft,
          (options.key || (() => crypto.randomUUID()))(),
        );
        const eventId = await assetEventId(
          options.identity,
          body.idempotency_key,
        );
        if (current() && gate.current(ticket))
          retain({
            schema: 1,
            draft: { ...state.draft },
            phase: "review",
            command: freezeCommand({ body, eventId }),
          });
      } catch (error) {
        if (current() && gate.current(ticket))
          emit({
            ...state,
            error: error instanceof Error ? error.message : "invalidContent",
          });
      } finally {
        preparing = false;
      }
    },
    editReview() {
      if (current() && state.phase === "review")
        retain({ schema: 1, draft: state.draft, phase: "editing" });
    },
    newDraft() {
      if (
        !current() ||
        !["processed", "failed", "rejected"].includes(state.phase)
      )
        return;
      // Never adopt a newly observed basis silently, even after an explicit refusal.
      retain({
        schema: 1,
        draft: { ...state.draft, version: "", sha: "", basis: "existing" },
        phase: "editing",
      });
    },
    async submit() {
      if (
        !current() ||
        !state.command ||
        !["review", "unknown", "stored", "failed"].includes(state.phase)
      )
        return;
      const before = state;
      const command = state.command,
        priorAck = state.ack,
        wasUnknown = state.phase === "unknown";
      const ticket = gate.start();
      if (!retain({ ...state, phase: "sending", error: undefined })) {
        emit({ ...before, error: "storageUnavailable" });
        return;
      }
      if (!current()) {
        retain({ ...state, phase: "unknown" });
        return;
      }
      try {
        // Preserve the exact frozen request, including key and both original bases.
        const ack = parseAssetAck(
          await options.send(command.body),
          command,
          priorAck,
        );
        if (current() && gate.current(ticket))
          retain({ ...state, phase: ackPhase(ack), ack, error: undefined });
      } catch (error) {
        if (!current() || !gate.current(ticket)) return;
        const problem = eventProblem(error);
        // A refusal before an unknown retry's original-key lookup proves nothing
        // about an earlier write. Only a matching acknowledgement resolves it.
        const rejected =
          !wasUnknown &&
          !priorAck &&
          [400, 401, 403, 404, 409, 422].includes(problem.status);
        retain({
          ...state,
          phase: rejected
            ? "rejected"
            : priorAck
              ? ackPhase(priorAck)
              : "unknown",
          error: problem.message,
        });
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
