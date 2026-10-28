import { reflectionCategories, validReflectionId } from "./reflectionReads";

export type ReflectionRouteValues = { tab: "collected" | "inputs"; receipt: string; input: string; category: string; from: string; to: string; cursor: string; page: number; inputCursor: string; inputPage: number; prepare: boolean };
export type ReflectionRoute = ReflectionRouteValues & { valid: boolean; projectId: string };
export const reflectionRouteKeys: Record<keyof ReflectionRouteValues, string> = { tab: "reflection_tab", receipt: "reflection_receipt", input: "reflection_input", category: "reflection_category", from: "reflection_from", to: "reflection_to", cursor: "reflection_cursor", page: "reflection_page", inputCursor: "reflection_input_cursor", inputPage: "reflection_input_page", prepare: "reflection_prepare" };
export const currentReflectionHash = () => typeof location === "undefined" ? "" : location.hash;
export function parseReflectionRoute(hash: string): ReflectionRoute {
  const queryStart = hash.indexOf("?");
  const params = new URLSearchParams(queryStart < 0 ? "" : hash.slice(queryStart + 1));
  const allowed = new Set(["project_id", "event_return", ...Object.values(reflectionRouteKeys)]);
  let valid = hash.length <= 11000 && /^(?:#\/intelligence(?:\/reflections)?(?:\?|$)|$)/.test(hash) && !/[\\\u0000-\u001f\u007f-\u009f]/.test(hash);
  for (const [key, value] of params) if (!allowed.has(key) || params.getAll(key).length !== 1 || value.length > 4000 || /[\\\u0000-\u001f\u007f-\u009f]/.test(value)) valid = false;
  const get = (key: keyof ReflectionRouteValues) => params.get(reflectionRouteKeys[key]) ?? "";
  const projectId = params.get("project_id") ?? "";
  if (params.has("project_id") && !validReflectionId(projectId)) valid = false;
  for (const key of ["receipt", "input"] as const) if (params.has(reflectionRouteKeys[key]) && !validReflectionId(get(key))) valid = false;
  for (const key of ["page", "inputPage"] as const) if (params.has(reflectionRouteKeys[key]) && !/^[1-9]\d{0,5}$/.test(get(key))) valid = false;
  if (get("tab") && !["collected", "inputs"].includes(get("tab"))) valid = false;
  if (get("category") && !reflectionCategories.includes(get("category") as typeof reflectionCategories[number])) valid = false;
  if (params.has(reflectionRouteKeys.prepare) && get("prepare") !== "1") valid = false;
  const timestamp = (value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
  for (const key of ["from", "to"] as const) if (get(key) && !timestamp(get(key))) valid = false;
  if (get("from") && get("to") && Date.parse(get("to")) <= Date.parse(get("from"))) valid = false;
  return { valid, projectId, tab: get("tab") === "inputs" ? "inputs" : "collected", receipt: get("receipt"), input: get("input"), category: get("category"), from: get("from"), to: get("to"), cursor: get("cursor"), page: Number(get("page") || 1), inputCursor: get("inputCursor"), inputPage: Number(get("inputPage") || 1), prepare: get("prepare") === "1" };
}
/** Deliberately excludes nested return parameters to prevent return loops. */
export function safeReflectionReturn(hash: string, projectId: string): string | null {
  if (!projectId || !/^#\/intelligence\/reflections(?:\?|$)/.test(hash)) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  if (params.getAll("project_id").length !== 1 || params.get("project_id") !== projectId) return null;
  if (!parseReflectionRoute(hash).valid || params.has("event_return")) return null;
  return hash;
}
