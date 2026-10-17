import {
  safeEvidenceUrl,
  type DeliveryInboxTarget,
  type DeliveryResource,
} from "./delivery";

export const deliveryViews = [
  "overview",
  "progress",
  "quality",
  "releases",
  "inbox",
  "list",
  "board",
  "timeline",
  "resources",
  "team",
  "issues",
] as const;
export const inboxCategories = [
  "work",
  "approval",
  "acceptance",
  "blocked",
] as const;
export const resourceKinds = [
  "repository",
  "document",
  "design",
  "other",
] as const;
export type InboxScope = "mine" | "team";
export type InboxCategory =
  | "all"
  | "overdue"
  | (typeof inboxCategories)[number];
export type ResourceKindFilter = "all" | (typeof resourceKinds)[number];
export type DeliveryRoute = {
  view: string;
  requirement: string;
  detail: string;
  task: string;
  issue: string;
  inboxScope: InboxScope;
  inboxCategory: InboxCategory;
  resourceKind: ResourceKindFilter;
  showArchived: boolean;
  search: string;
  stage: string;
  owner: string;
  sort: string;
  page: number;
  cursor: string;
  taskPage: number;
  taskCursor: string;
  taskSort: string;
};
export function parseDeliveryRoute(hash: string): DeliveryRoute {
  const params = new URLSearchParams(hash.split("?")[1]);
  const view = params.get("view") || "overview";
  const detail = params.get("detail") || "details";
  const category = params.get("category") || "all";
  const kind = params.get("resource_kind") || "all";
  const exactIssue = view === "issues" && Boolean(params.get("issue"));
  const pageNumber = (key: string) =>
    /^\d{1,6}$/.test(params.get(key) || "")
      ? Math.max(1, Number(params.get(key)))
      : 1;
  return {
    view: deliveryViews.includes(view as (typeof deliveryViews)[number])
      ? view
      : "overview",
    requirement: exactIssue ? "" : params.get("requirement") || "",
    detail:
      !exactIssue &&
      [
        "details",
        "tasks",
        "evidence",
        "release",
        "activity",
        "history",
      ].includes(detail)
        ? detail
        : "details",
    task: exactIssue ? "" : params.get("task") || "",
    issue: params.get("issue") || "",
    inboxScope: params.get("inbox_scope") === "team" ? "team" : "mine",
    inboxCategory: ["all", "overdue", ...inboxCategories].includes(category)
      ? (category as InboxCategory)
      : "all",
    resourceKind: ["all", ...resourceKinds].includes(kind)
      ? (kind as ResourceKindFilter)
      : "all",
    showArchived: params.get("archived") === "1",
    search: params.get("q") || "",
    stage: params.get("stage") || "",
    owner: params.get("owner") || "",
    sort: params.get("sort") || "created_desc",
    page: pageNumber("page"),
    cursor: params.get("cursor") || "",
    taskPage: pageNumber("task_page"),
    taskCursor: params.get("task_cursor") || "",
    taskSort: params.get("task_sort") || "created_desc",
  };
}
export function normalizeInboxTarget(
  target: DeliveryInboxTarget,
): DeliveryInboxTarget {
  return target.view === "issues" && target.issue_id
    ? { ...target, requirement_id: "", task_id: "", detail: "details" }
    : target;
}
export function deliveryInboxHash(
  target: DeliveryInboxTarget,
  filters: Partial<DeliveryRoute> = {},
  source = "",
) {
  target = normalizeInboxTarget(target);
  const params = new URLSearchParams(source.split("?")[1]);
  if ((params.get("requirement") || "") !== target.requirement_id) {
    params.delete("task_page");
    params.delete("task_cursor");
  }
  if (
    ("resourceKind" in filters &&
      (filters.resourceKind === "all" ? "" : filters.resourceKind) !==
        (params.get("resource_kind") || "")) ||
    ("showArchived" in filters &&
      Boolean(filters.showArchived) !== (params.get("archived") === "1"))
  ) {
    params.delete("resource_cursor");
    params.delete("resource_page");
  }
  params.set("view", target.view);
  for (const key of ["requirement", "detail", "task", "issue"])
    params.delete(key);
  if (target.requirement_id) params.set("requirement", target.requirement_id);
  if (target.requirement_id) params.set("detail", target.detail);
  if (target.task_id) params.set("task", target.task_id);
  if (target.issue_id) params.set("issue", target.issue_id);
  if (filters.inboxScope) params.set("inbox_scope", filters.inboxScope);
  if (filters.inboxCategory && filters.inboxCategory !== "all")
    params.set("category", filters.inboxCategory);
  if (filters.resourceKind && filters.resourceKind !== "all")
    params.set("resource_kind", filters.resourceKind);
  if (filters.showArchived) params.set("archived", "1");
  else if ("showArchived" in filters) params.delete("archived");
  if (filters.resourceKind === "all") params.delete("resource_kind");
  if (filters.inboxCategory === "all") params.delete("category");
  for (const [field, key] of [
    ["search", "q"],
    ["stage", "stage"],
    ["owner", "owner"],
    ["sort", "sort"],
    ["page", "page"],
    ["cursor", "cursor"],
    ["taskPage", "task_page"],
    ["taskCursor", "task_cursor"],
    ["taskSort", "task_sort"],
  ] as const) {
    if (field in filters)
      filters[field]
        ? params.set(key, String(filters[field]))
        : params.delete(key);
  }
  return `#/dev-flow?${params}`;
}
export function deliveryInboxHref(
  target: DeliveryInboxTarget,
  filters: Partial<DeliveryRoute> = {},
) {
  target = normalizeInboxTarget(target);
  return target.task_id && !target.requirement_id
    ? `#/tasks/execution?task_id=${encodeURIComponent(target.task_id)}`
    : deliveryInboxHash(target, filters);
}
export function filterDeliveryInbox<
  T extends { categories: string[]; overdue: boolean },
>(items: T[], category: InboxCategory) {
  return items.filter(
    (item) =>
      category === "all" ||
      (category === "overdue"
        ? item.overdue
        : item.categories.includes(category)),
  );
}
export function filterProjectResources<
  T extends { kind: string; archived?: boolean },
>(items: T[] | undefined, kind: ResourceKindFilter, showArchived: boolean) {
  return (items || []).filter(
    (item) =>
      (showArchived || !item.archived) &&
      (kind === "all" || item.kind === kind),
  );
}
export function taskTargetState(
  tasks: { id: string; req_id: string }[],
  requirementId: string,
  taskId: string,
) {
  return !taskId
    ? "none"
    : tasks.some((task) => task.id === taskId && task.req_id === requirementId)
      ? "found"
      : "missing";
}
export function projectUpdatePayload(
  values: Record<string, unknown>,
  base: Record<string, unknown>,
  configure: boolean,
) {
  const fields = [
    ...(configure ? ["name", "description"] : []),
    "goal",
    "owner_id",
    "starts_on",
    "ends_on",
  ];
  return Object.fromEntries(
    fields
      .filter((key) => key in values)
      .map((key) => [
        key,
        ["starts_on", "ends_on"].includes(key)
          ? values[key] || null
          : values[key] || "",
      ])
      .filter(
        ([key, value]) =>
          value !==
          (base[String(key)] ??
            (["starts_on", "ends_on"].includes(String(key)) ? null : "")),
      ),
  );
}
export function resourcePayload(
  values: Record<string, unknown>,
): Omit<DeliveryResource, "created_at" | "updated_at" | "archived_at"> {
  const kind = String(values.kind || "");
  const title = String(values.title || "").trim();
  const url = String(values.url || "").trim();
  if (
    !resourceKinds.includes(kind as (typeof resourceKinds)[number]) ||
    !title ||
    !safeResourceUrl(url)
  )
    throw new Error("Invalid resource");
  return {
    ...(values.id ? { id: String(values.id) } : {}),
    kind: kind as DeliveryResource["kind"],
    title,
    url,
    description: String(values.description || "").trim(),
    ref: String(values.ref || "").trim(),
    archived: Boolean(values.archived),
  };
}
export function safeResourceUrl(url: string) {
  if (!safeEvidenceUrl(url) || /[\u0000-\u0020\u007f\\]/.test(url))
    return undefined;
  try {
    if (/[\u0000-\u001f\u007f]/.test(decodeURIComponent(url))) return undefined;
    const parsed = new URL(url);
    const sensitive = new Set([
      "token",
      "password",
      "passwd",
      "pwd",
      "key",
      "secret",
      "credential",
      "credentials",
      "authorization",
      "auth",
      "signature",
      "sig",
    ]);
    const compactKeys = new Set([
      "accesstoken",
      "refreshtoken",
      "idtoken",
      "authtoken",
      "bearertoken",
      "securitytoken",
      "apikey",
      "accesskey",
      "privatekey",
      "secretkey",
      "clientsecret",
      "authorization",
      "auth",
      "signature",
      "sig",
      "xamzcredential",
      "xamzsignature",
      "xamzsecuritytoken",
      "xgoogcredential",
      "xgoogsignature",
      "awsaccesskeyid",
    ]);
    for (const key of parsed.searchParams.keys()) {
      const words = key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      if (
        words.some((word) => sensitive.has(word)) ||
        compactKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))
      )
        return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}
