import type { DeliveryPage, DeliveryReference, DeliveryReferenceKind } from "./deliveryQuery";
export type ReferenceChoice = { value: string; label: string; disabled?: boolean; local?: boolean };
export type ReferenceChoiceInput = {
  projectId: string; kind: DeliveryReferenceKind; generation?: number | null; search: string; values: string[]; local: ReferenceChoice[];
  pages?: DeliveryPage<DeliveryReference>[]; listPending: boolean; listFailed: boolean;
  selectedPage?: DeliveryPage<DeliveryReference>; selectedPending: boolean; selectedFailed: boolean;
  filter?: (data: Record<string, unknown>) => boolean;
  formatLabel?: (item: DeliveryReference) => string;
};
type Issue = "loading" | "failed" | "changed" | null;
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export const localReferenceChoice = (choice: ReferenceChoice) => choice.local === true || choice.value === "" || choice.value === "__clear__";
function validPage(page: DeliveryPage<DeliveryReference>, input: ReferenceChoiceInput, generation: number | undefined) {
  return input.generation !== null && object(page) && page.project_id === input.projectId && Number.isSafeInteger(page.query_generation) && page.query_generation > 0 &&
    (generation === undefined || page.query_generation === generation) && Array.isArray(page.items) && page.items.length <= 100 &&
    page.items.every((item) => object(item) && item.kind === input.kind && typeof item.id === "string" && Boolean(item.id.trim()) &&
      typeof item.label === "string" && object(item.data) && item.data.id === item.id) && new Set(page.items.map((item) => item.id)).size === page.items.length;
}
/** Labels supplied by callers are display hints. Only explicit draft rows/actions are local authority. */
export function referenceChoices(input: ReferenceChoiceInput) {
  const generation = input.generation === undefined ? input.pages?.[0]?.query_generation : input.generation ?? undefined;
  let listIssue: Issue = input.listFailed ? "failed" : input.listPending ? "loading" : !input.pages?.length ? "changed" : null;
  if (!listIssue && input.pages!.some((page) => !validPage(page, input, generation))) listIssue = "changed";
  if (!listIssue) {
    const pageIds = input.pages!.flatMap((page) => page.items.map((item) => item.id));
    if (new Set(pageIds).size !== pageIds.length) listIssue = "changed";
  }
  const localIds = new Set(input.local.filter(localReferenceChoice).map((option) => option.value));
  const ids = input.values.filter((id) => !localIds.has(id));
  let selectedIssue: Issue = !ids.length ? null : input.selectedFailed ? "failed" : input.selectedPending ? "loading" :
    !input.selectedPage || !validPage(input.selectedPage, input, generation) ? "changed" : null;
  if (ids.length && input.selectedPage && generation !== undefined && input.selectedPage.query_generation !== generation) listIssue = "changed";
  const options = new Map<string, ReferenceChoice>();
  for (const option of input.local) if (localReferenceChoice(option) || input.values.includes(option.value))
    options.set(option.value, { ...option, disabled: !localReferenceChoice(option) || option.disabled });
  const remote = [...(!listIssue ? input.pages!.flatMap((page) => page.items) : []),
    ...(!selectedIssue && input.selectedPage ? input.selectedPage.items.filter((item) => ids.includes(item.id)) : [])];
  for (const item of remote) if (!localIds.has(item.id)) options.set(item.id, { value: item.id, label: input.formatLabel?.(item) || item.label, disabled: Boolean(input.filter && !input.filter(item.data)) });
  for (const id of ids) if (selectedIssue === "failed" || selectedIssue === "changed" ||
    !selectedIssue && input.selectedPage && !input.selectedPage.items.some((item) => item.id === id)) {
    options.set(id, { value: id, label: options.get(id)?.label || id, disabled: true });
  }
  const unavailable = new Set<string>();
  for (const id of input.values) {
    if (!options.has(id) || options.get(id)!.disabled) unavailable.add(id);
    if (!options.has(id)) options.set(id, { value: id, label: id, disabled: true });
  }
  const search = input.search.trim().toLocaleLowerCase();
  const visible = [...options.values()].filter((option) => !search || option.value === "" || option.value === "__clear__" || input.values.includes(option.value) ||
    !localReferenceChoice(option) || `${option.label} ${option.value}`.toLocaleLowerCase().includes(search));
  const allowed = new Set(visible.filter((option) => !option.disabled).map((option) => option.value));
  return { listIssue, selectedIssue, unavailable, allowed, options: visible };
}
export function referenceChangeAllowed(next: unknown, previous: string[], multiple: boolean | undefined, allowed: Set<string>) {
  if (!multiple) return typeof next === "string" && allowed.has(next);
  return Array.isArray(next) && new Set(next).size === next.length && next.every((id) => typeof id === "string" && (previous.includes(id) || allowed.has(id)));
}
