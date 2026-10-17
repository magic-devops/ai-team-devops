import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  deliveryInboxHash,
  deliveryInboxHref,
  filterDeliveryInbox,
  filterProjectResources,
  parseDeliveryRoute,
  projectUpdatePayload,
  resourcePayload,
  safeResourceUrl,
  taskTargetState,
} from "./deliveryProjectInbox";
import { fetchDeliveryInbox } from "./delivery";
import { request } from "./http";
import { projectInboxTranslations } from "../i18n/delivery-project-inbox";
import { taskIdFromHash } from "./taskDeepLink";
vi.mock("./http", () => ({ request: vi.fn() }));

describe("project resources and delivery inbox", () => {
  it("pins project and scope in the actual request and supports cancellation", async () => {
    const signal = new AbortController().signal;
    await fetchDeliveryInbox("p-one", "team", signal);
    expect(vi.mocked(request).mock.calls.at(-1)).toEqual([
      "/api/v1/delivery/inbox?scope=team",
      { headers: { "X-Project-Id": "p-one" }, signal },
    ]);
  });
  it("preserves inbox and resource filters, safely encodes exact task targets and validates routes", () => {
    const hash = deliveryInboxHash(
      {
        view: "issues",
        requirement_id: "REQ &?#中文",
        detail: "tasks",
        task_id: "T/target?&",
      },
      {
        inboxScope: "team",
        inboxCategory: "blocked",
        resourceKind: "design",
        showArchived: true,
      },
    );
    expect(parseDeliveryRoute(hash)).toMatchObject({
      view: "issues",
      requirement: "REQ &?#中文",
      detail: "tasks",
      task: "T/target?&",
      inboxScope: "team",
      inboxCategory: "blocked",
      resourceKind: "design",
      showArchived: true,
    });
    expect(
      parseDeliveryRoute(
        "#/dev-flow?view=bad&detail=bad&inbox_scope=other&category=bad&resource_kind=bad",
      ),
    ).toMatchObject({
      view: "overview",
      detail: "details",
      inboxScope: "mine",
      inboxCategory: "all",
      resourceKind: "all",
    });
  });
  it("does not silently target another task or requirement", () => {
    const tasks = [{ id: "t-one", req_id: "r-one" }];
    expect(taskTargetState(tasks, "r-one", "t-one")).toBe("found");
    expect(taskTargetState(tasks, "r-two", "t-one")).toBe("missing");
    expect(taskTargetState(tasks, "r-one", "t-other")).toBe("missing");
    expect(taskTargetState(tasks, "r-one", "")).toBe("none");
    expect(
      deliveryInboxHref({
        view: "list",
        requirement_id: "",
        detail: "tasks",
        task_id: "T/one?&",
      }),
    ).toBe("#/tasks/execution?task_id=T%2Fone%3F%26");
    expect(
      parseDeliveryRoute(
        deliveryInboxHash({
          view: "issues",
          requirement_id: "",
          detail: "tasks",
          issue_id: "ISS &1",
        }),
      ).issue,
    ).toBe("ISS &1");
  });
  it("routes an unlinked task to the actual execution list instead of the task hub", () => {
    const taskId = "T-independent?&";
    const href = deliveryInboxHref({
      view: "list",
      requirement_id: "",
      detail: "tasks",
      task_id: taskId,
    });
    const route = href.split("?")[0];
    const navigation = readFileSync(
      new URL("../navigation.tsx", import.meta.url),
      "utf8",
    );
    const registeredRoute = navigation
      .split("\n")
      .find((line) => line.includes(`path: "${route}"`));
    expect(registeredRoute).toContain(
      'pageElement(TasksPage, { initialTab: "list", focused: true })',
    );
    expect(taskIdFromHash(href)).toBe(taskId);
  });
  it("opens an associated inbox issue in its exact issue table without an automatic requirement drawer", () => {
    const associatedIssue = {
      view: "issues",
      requirement_id: "REQ-linked",
      detail: "tasks",
      task_id: "TASK-linked",
      issue_id: "ISS & exact",
    };
    const hash = deliveryInboxHref(associatedIssue, {
      inboxScope: "team",
      inboxCategory: "blocked",
    });
    const route = parseDeliveryRoute(hash);
    expect(route).toMatchObject({
      view: "issues",
      issue: "ISS & exact",
      requirement: "",
      task: "",
      detail: "details",
      inboxScope: "team",
      inboxCategory: "blocked",
    });
    // Refreshing or revisiting the issue route preserves the precise filter;
    // no requirement selection exists to open or close a drawer over this row.
    expect(parseDeliveryRoute(hash)).toEqual(route);
    expect(
      parseDeliveryRoute(
        "#/dev-flow?view=issues&issue=exact&requirement=REQ-linked&task=TASK-linked&detail=tasks",
      ),
    ).toMatchObject({
      issue: "exact",
      requirement: "",
      task: "",
      detail: "details",
    });
  });
  it("uses projected categories once per item and displays only requested resource kinds", () => {
    const items = [
      { id: "t", categories: ["work", "blocked"], overdue: true },
      { id: "r", categories: ["approval"], overdue: false },
    ];
    expect(filterDeliveryInbox(items, "all")).toEqual(items);
    expect(filterDeliveryInbox(items, "blocked")).toEqual([items[0]]);
    expect(filterDeliveryInbox(items, "overdue")).toEqual([items[0]]);
    const resources = [
      { id: "one", kind: "repository", archived: false },
      { id: "two", kind: "design", archived: true },
    ];
    expect(filterProjectResources(resources, "all", false)).toEqual([
      resources[0],
    ]);
    expect(filterProjectResources(resources, "design", true)).toEqual([
      resources[1],
    ]);
    expect(filterProjectResources(undefined, "all", false)).toEqual([]);
  });
  it("only changes visible project fields and protects canonical fields without configure permission", () => {
    const base = {
      name: "Project",
      description: "Keep me",
      goal: "Ship",
      owner_id: "user:1",
      starts_on: null,
      ends_on: null,
    };
    expect(
      projectUpdatePayload({ ...base, goal: "Ship well" }, base, false),
    ).toEqual({ goal: "Ship well" });
    expect(
      projectUpdatePayload(
        {
          name: "New name",
          description: "New description",
          owner_id: "user:2",
        },
        base,
        false,
      ),
    ).toEqual({ owner_id: "user:2" });
    expect(projectUpdatePayload({ name: "New name" }, base, true)).toEqual({
      name: "New name",
    });
  });
  it("validates resource links and keeps restoration on the same identity", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://u:p@example.org",
      "https://example.org/?token=secret",
      "https://example.org/?api_key=secret",
      "https://example.org/\nunsafe",
      "https://bad host.org",
      "https://example.org/?private_token=s",
      "https://example.org/?securityToken=s",
      "https://example.org/?secret_key=s",
      "https://example.org/?pwd=s",
      "https://example.org/?APIKEY=s",
      "https://example.org/%0Ahidden",
      "https://example.org/\\hidden",
    ])
      expect(safeResourceUrl(url)).toBeUndefined();
    expect(
      safeResourceUrl("https://example.org/?keynote=hello&ref=main&branch=dev"),
    ).toBe("https://example.org/?keynote=hello&ref=main&branch=dev");
    expect(
      resourcePayload({
        id: "resource-one",
        kind: "repository",
        title: " Repo ",
        url: "https://example.org/repo",
        ref: "main",
        archived: false,
      }),
    ).toEqual({
      id: "resource-one",
      kind: "repository",
      title: "Repo",
      url: "https://example.org/repo",
      description: "",
      ref: "main",
      archived: false,
    });
    expect(() =>
      resourcePayload({
        kind: "repository",
        title: "Repo",
        url: "file:///C:/repo",
      }),
    ).toThrow();
  });
  it("provides the same vocabulary in Chinese, English and Japanese", () => {
    const keys = (value: object): string[] =>
      Object.entries(value)
        .flatMap(([key, item]) =>
          typeof item === "object"
            ? keys(item).map((child) => `${key}.${child}`)
            : [key],
        )
        .sort();
    expect(keys(projectInboxTranslations["en-US"])).toEqual(
      keys(projectInboxTranslations["zh-CN"]),
    );
    expect(keys(projectInboxTranslations["ja-JP"])).toEqual(
      keys(projectInboxTranslations["zh-CN"]),
    );
  });
});
