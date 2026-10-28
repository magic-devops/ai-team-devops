import { getToken, USER_KEY } from "./authStorage";
import { request } from "./http";

export type ProjectCreationDraft = { name: string; description: string; business_id: string; project_path: string;
  status: "planning" | "active" | "paused" };
export type CreationPrincipal = { tenant_id: string; user_id: string };
export type ProjectCreationOriginal = Omit<ProjectCreationDraft, "business_id"> & { business_id: string | null; idempotency_key: string };
export type ProjectCreationAck = { ok: true; action: "project.create"; id: string; tenant_id: string; creator_id: string;
  idempotency_key: string; replayed: boolean };
export type CreationState = { phase: "editing" | "sending" | "unknown" | "refused" | "succeeded";
  draft: ProjectCreationDraft; original: ProjectCreationOriginal | null; ack: ProjectCreationAck | null };
export type CreationView = CreationState & { local: "opening" | "saved" | "busy" | "invalid" | "unavailable" | "conflict";
  error: string; unsaved: boolean; retained: boolean };
export const blankProjectCreation = (): ProjectCreationDraft => ({ name: "", description: "", business_id: "", project_path: "", status: "planning" });
const empty = (): CreationState => ({ phase: "editing", draft: blankProjectCreation(), original: null, ack: null });
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((name) => Object.hasOwn(v, name));
const text = (v: unknown, max: number): v is string => typeof v === "string" && Array.from(v).length <= max && !/[\ud800-\udfff]/u.test(v);
const identity = (v: unknown): v is string => text(v, 64) && !!v && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
export function projectCreationPrincipal(): CreationPrincipal | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    return getToken() && identity(user?.tenant_id) && identity(user?.id) ? { tenant_id: user.tenant_id, user_id: user.id } : null;
  } catch { return null; }
}
export const projectCreationStorageKey = (p: CreationPrincipal) => "sop.project-create.v1:" + JSON.stringify([p.tenant_id, p.user_id]);
export function validCreationDraft(v: unknown): v is ProjectCreationDraft {
  return record(v) && exact(v, ["name", "description", "business_id", "project_path", "status"]) && text(v.name, 128) &&
    text(v.description, 20000) && text(v.business_id, 64) && text(v.project_path, 512) && ["planning", "active", "paused"].includes(v.status);
}
export function validCreationOriginal(v: unknown): v is ProjectCreationOriginal {
  return record(v) && exact(v, ["name", "description", "business_id", "project_path", "status", "idempotency_key"]) &&
    typeof v.idempotency_key === "string" && /^[A-Za-z0-9_.:-]{8,128}$/.test(v.idempotency_key) &&
    validCreationDraft({ name: v.name, description: v.description, business_id: v.business_id ?? "", project_path: v.project_path, status: v.status }) &&
    (v.business_id === null || identity(v.business_id)) && !!v.name.trim() && [v.name, v.description, v.project_path].every((s) => s === s.trim());
}
export function validCreationAck(p: CreationPrincipal, original: ProjectCreationOriginal, v: unknown): v is ProjectCreationAck {
  return record(v) && exact(v, ["ok", "action", "id", "tenant_id", "creator_id", "idempotency_key", "replayed"]) &&
    v.ok === true && v.action === "project.create" && /^proj-[a-f0-9]{59}$/.test(v.id) && v.tenant_id === p.tenant_id &&
    v.creator_id === p.user_id && v.idempotency_key === original.idempotency_key && typeof v.replayed === "boolean";
}
function draftMatchesOriginal(draft: ProjectCreationDraft, original: ProjectCreationOriginal) {
  return draft.name.trim() === original.name && draft.description.trim() === original.description &&
    (draft.business_id || null) === original.business_id && draft.project_path.trim() === original.project_path && draft.status === original.status;
}
export const sendProjectCreation = (original: ProjectCreationOriginal) => request<ProjectCreationAck>("/api/v1/projects", {
  method: "POST", headers: { "X-Project-Id": "", "X-Project-Code": "", "X-Business-Code": "" }, body: JSON.stringify(original),
});
export type CreationLock = (key: string, work: (available: boolean) => Promise<void>) => Promise<void>;
export const browserCreationLock: CreationLock = async (key, work) => {
  if (!navigator.locks?.request) throw new Error("unavailable");
  await navigator.locks.request(key, { ifAvailable: true }, (lock) => work(!!lock));
};

/** One stable account owns one draft; a browser lease and raw comparison fence other tabs. */
export function createProjectCreationStore(options: { principal: CreationPrincipal | null; storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  lock: CreationLock; current: () => boolean; send: (body: ProjectCreationOriginal) => Promise<unknown>; key?: () => string }) {
  let state: CreationState = empty(), local: CreationView["local"] = "opening", error = "", unsaved = false, retained = false;
  let expected: string | null = null, owned = false, connected = false, epoch = 0, release: (() => void) | undefined;
  let leaseTask: Promise<void> | undefined;
  const principal = options.principal, storageKey = principal && projectCreationStorageKey(principal);
  const listeners = new Set<() => void>();
  let view: CreationView;
  const emit = () => { view = { ...structuredClone(state), local, error, unsaved, retained }; listeners.forEach((fn) => fn()); };
  const current = () => connected && owned && options.current();
  const read = () => {
    if (!storageKey || !principal) throw new Error("unavailable");
    try { expected = options.storage.getItem(storageKey); }
    catch { throw new Error("unavailable"); }
    if (expected === null) { state = empty(); retained = false; return; }
    if (expected.length > 100000) throw new Error("invalid");
    let saved: unknown;
    try { saved = JSON.parse(expected); } catch { throw new Error("invalid"); }
    if (!record(saved) || !exact(saved, ["schema", "principal", "state"]) || saved.schema !== 1 ||
      !record(saved.principal) || !exact(saved.principal, ["tenant_id", "user_id"]) ||
      saved.principal.tenant_id !== principal.tenant_id || saved.principal.user_id !== principal.user_id) throw new Error("invalid");
    const s = saved.state;
    if (!record(s) || !exact(s, ["phase", "draft", "original", "ack"]) || !validCreationDraft(s.draft) ||
      !["editing", "sending", "unknown", "refused", "succeeded"].includes(s.phase) ||
      (s.phase === "editing" ? s.original !== null || s.ack !== null : !validCreationOriginal(s.original) || !draftMatchesOriginal(s.draft, s.original)) ||
      (s.phase === "succeeded" ? !validCreationAck(principal, s.original, s.ack) : s.ack !== null)) throw new Error("invalid");
    state = { ...s, phase: s.phase === "sending" ? "unknown" : s.phase } as CreationState;
    retained = true;
  };
  const write = (next: CreationState | null) => {
    if (!current() || !storageKey || options.storage.getItem(storageKey) !== expected) {
      local = "conflict"; throw new Error("conflict");
    }
    const raw = next && JSON.stringify({ schema: 1, principal, state: next });
    if (raw && raw.length > 100000) throw new Error("unavailable");
    if (raw) options.storage.setItem(storageKey, raw); else options.storage.removeItem(storageKey);
    if (options.storage.getItem(storageKey) !== raw) { local = "conflict"; throw new Error("conflict"); }
    expected = raw; local = "saved"; unsaved = false; retained = !!raw;
  };
  const persist = () => {
    try { write(state); emit(); return true; }
    catch { if (local !== "conflict") local = "unavailable"; unsaved = true; emit(); return false; }
  };
  const readProblem = (problem: unknown): CreationView["local"] => problem instanceof Error && problem.message === "invalid" ? "invalid" : "unavailable";
  try { read(); } catch (problem) { local = readProblem(problem); retained = expected !== null; }
  emit();
  async function send(original: ProjectCreationOriginal, replay: boolean) {
    if (!current()) return;
    const ticket = epoch;
    const before = state;
    state = { ...state, phase: "sending", original: structuredClone(original), ack: null }; error = "";
    if (!persist()) { state = before; emit(); return; }
    if (!current()) return;
    try {
      const ack = await options.send(structuredClone(original));
      if (!current() || ticket !== epoch) return;
      if (!principal || !validCreationAck(principal, original, ack)) throw new Error("ackMismatch");
      state = { ...state, phase: "succeeded", ack }; persist();
    } catch (problem) {
      if (!current() || ticket !== epoch) return;
      error = problem instanceof Error ? problem.message : "saveFailed";
      // Once an attempt is uncertain, later denial is never evidence it did not commit.
      const refused = !replay && /^HTTP (400|401|403|404|409|422):/.test(error);
      state = { ...state, phase: refused ? "refused" : "unknown" }; persist();
    }
  }
  return {
    snapshot: () => view,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    current,
    connect() {
      if (connected) return;
      const ticket = ++epoch;
      connected = true; local = "opening"; emit();
      const previousLease = leaseTask;
      leaseTask = (async () => {
        try {
          // A new ifAvailable request must wait for our previous callback to
          // release the native lock, including delayed grants and effect replay.
          if (previousLease) await previousLease;
          if (!connected || ticket !== epoch || !options.current()) return;
          if (!storageKey || !principal) throw new Error("unavailable");
          await options.lock(storageKey, async (available) => {
            if (!connected || ticket !== epoch || !options.current()) return;
            if (!available) { local = "busy"; emit(); return; }
            owned = true;
            try {
              if (unsaved) {
                // Same-account scope changes must not replace volatile input
                // with the older saved draft, even after a lease reconnect.
                local = options.storage.getItem(storageKey) === expected ? "unavailable" : "conflict";
              } else { read(); local = "saved"; }
            }
            catch (problem) { local = readProblem(problem); }
            emit();
            await new Promise<void>((resolve) => { release = resolve; });
            if (ticket === epoch) owned = false;
          });
        } catch { if (connected && ticket === epoch) { local = "unavailable"; emit(); } }
      })();
    },
    disconnect() { connected = false; owned = false; ++epoch; if (state.phase === "sending") { state = { ...state, phase: "unknown" }; emit(); } release?.(); release = undefined; },
    edit(patch: Partial<ProjectCreationDraft>) {
      if (!current() || state.phase !== "editing" || !["saved", "unavailable"].includes(local)) return;
      const draft = { ...state.draft, ...patch };
      if (!validCreationDraft(draft)) return;
      state = { ...state, draft }; error = ""; persist();
    },
    retryStorage() { return current() && !["invalid", "conflict"].includes(local) ? persist() : false; },
    create() {
      if (!current() || state.phase !== "editing" || local !== "saved" || unsaved) return Promise.resolve();
      const d = state.draft;
      const original = { ...d, name: d.name.trim(), description: d.description.trim(), project_path: d.project_path.trim(),
        business_id: d.business_id || null, idempotency_key: options.key?.() || crypto.randomUUID() };
      return validCreationOriginal(original) ? send(original, false) : Promise.resolve();
    },
    replay() { return current() && state.phase === "unknown" && state.original && local === "saved" ? send(state.original, true) : Promise.resolve(); },
    revise() {
      if (!current() || state.phase !== "refused" || local !== "saved") return;
      state = { ...state, phase: "editing", original: null, ack: null }; error = ""; persist();
    },
    clear() {
      if (!current() || !["editing", "refused", "succeeded"].includes(state.phase) || !["saved", "unavailable"].includes(local)) return false;
      try { write(null); state = empty(); error = ""; emit(); return true; }
      catch { if (local !== "conflict") local = "unavailable"; emit(); return false; }
    },
  };
}
