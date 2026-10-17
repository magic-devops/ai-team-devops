import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryInbox } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryInbox";
import { DeliveryProjectResources } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProjectResources";
import { DeliveryProjectOverview } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProjectOverview";
import type { DeliveryInbox as InboxData, DeliveryDisplayContext, DeliveryResource } from "./delivery";
import { projectInboxTranslations } from "../i18n/delivery-project-inbox";

let activeLanguage: keyof typeof projectInboxTranslations = "en-US";
let resourceRows: DeliveryResource[] = [];
vi.mock("@tanstack/react-query", async () => ({
  ...await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query"),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const rows = queryKey[0].includes("resource") ? resourceRows : [];
    return { data: { items: rows.map((data) => ({ id: data.id, data })), total: rows.length, next_cursor: null }, isError: false, isPending: false };
  },
  useQueries: ({ queries }: { queries: { queryKey: unknown[] }[] }) => queries.map(({ queryKey }) => ({ data: { items: workspace.members.filter((member) => (queryKey.at(-1) as string[]).includes(member.id)).map((data) => ({ id: data.id, data })) } })),
}));
beforeEach(() => { resourceRows = []; vi.stubGlobal("location", { hash: "#/dev-flow?view=resources" }); });

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key.startsWith("deliveryProject.blocker.")) {
        const messages =
          (
            projectInboxTranslations[activeLanguage] as unknown as {
              blocker?: Record<string, string>;
            }
          ).blocker || {};
        return (messages[key.split(".").at(-1)!] || key).replace(
          /\{\{(\w+)\}\}/g,
          (_match, name: string) => String(options?.[name] || ""),
        );
      }
      return options?.defaultValue || key;
    },
    i18n: { language: activeLanguage },
  }),
}));
const workspace = {
  version: 4,
  project: { id: "project", name: "Project", description: "" },
  permissions: { write: true, configure: false, approve: false },
  members: [{ id: "user:lead", name: "Lead", kind: "human" }],
  resources: [],
  milestones: [],
  referenceTotals: { members: 1, milestones: 0, activeResources: 0 },
} as unknown as DeliveryDisplayContext;
const inbox = {
  project_id: "project",
  version: 4,
  scope: "mine",
  current_user_id: "lead",
  as_of: "2026-10-17T00:00:00Z",
  counts: {
    work: 1,
    approval: 0,
    acceptance: 0,
    blocked: 1,
    overdue: 1,
    total: 1,
  },
  items: [
    {
      id: "task:one",
      kind: "task",
      resource_id: "one",
      task_id: "one",
      requirement_id: "r",
      title: "Actual task",
      status: "blocked",
      stage: "development",
      owner_id: "user:lead",
      due_on: "2026-10-15",
      priority: "P1",
      categories: ["work", "blocked"],
      blocked_reasons: ["Awaiting API contract"],
      overdue: true,
      target: {
        view: "list",
        requirement_id: "r",
        detail: "tasks",
        task_id: "one",
      },
    },
  ],
} as InboxData;
const renderInbox = (extra = {}) =>
  renderToStaticMarkup(
    createElement(DeliveryInbox, {
      data: inbox,
      workspace,
      scope: "mine",
      category: "all",
      loading: false,
      refreshing: false,
      onScope: () => {},
      onCategory: () => {},
      onRefresh: () => {},
      onOpen: () => {},
      ...extra,
    }),
  );
describe("project inbox presentation", () => {
  it("localizes fixed system blockers in all languages while preserving user text, issue titles and IDs", () => {
    const reasons = [
      "Task is blocked",
      "Dependency not complete: TASK-API",
      "Unresolved issue ISS:42: 登录接口返回500",
      "等待客户提供资料",
    ];
    for (const [language, expected] of [
      [
        "zh-CN",
        [
          "任务已阻塞",
          "依赖任务尚未完成：TASK-API",
          "未解决问题 ISS:42：登录接口返回500",
        ],
      ],
      [
        "en-US",
        [
          "Task is blocked",
          "Dependency not complete: TASK-API",
          "Unresolved issue ISS:42: 登录接口返回500",
        ],
      ],
      [
        "ja-JP",
        [
          "タスクがブロックされています",
          "依存タスクが未完了：TASK-API",
          "未解決の問題 ISS:42：登录接口返回500",
        ],
      ],
    ] as const) {
      activeLanguage = language;
      const html = renderInbox({
        data: {
          ...inbox,
          items: [{ ...inbox.items[0], blocked_reasons: reasons }],
        },
      });
      for (const text of expected) expect(html).toContain(text);
      expect(html).toContain("等待客户提供资料");
      if (language !== "en-US") expect(html).not.toContain("Unresolved issue");
    }
    activeLanguage = "en-US";
  });
  it("renders one real item with categories, blocker, exact owner and recorded due date without quick approvals", () => {
    const html = renderInbox();
    expect(html).toContain("Actual task");
    expect(html).toContain("Awaiting API contract");
    expect(html).toContain("Lead");
    expect(html).toContain("2026");
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("stage.advance");
    expect(html).not.toContain("execution.review");
    expect((html.match(/class="delivery-inbox-row/g) || []).length).toBe(1);
  });
  it("shows errors while retaining previously loaded items and uses specific empty states", () => {
    expect(renderInbox({ error: "Connection lost" })).toContain(
      "Connection lost",
    );
    expect(renderInbox({ error: "Connection lost" })).toContain("Actual task");
    expect(renderInbox({ category: "approval" })).toContain(
      "deliveryProject.noCategoryItems",
    );
    expect(renderInbox({ data: { ...inbox, items: [] } })).toContain(
      "deliveryProject.myEmpty",
    );
  });
  it("renders absent legacy resources with configure controls disabled and guards unsafe saved links", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryProjectResources, {
        projectId: "project",
        data: workspace,
        kind: "all",
        showArchived: false,
        onFilter: () => {},
        onSaved: () => {},
      }),
    );
    expect(html).toContain("deliveryProject.noResources");
    expect(html).toContain("deliveryProject.configureHint");
    expect(html).toMatch(
      /disabled=""[^>]*><span[^>]*>.*?<\/span><span>deliveryProject.addResource/s,
    );
    resourceRows = [
      { id: "safe", kind: "document", title: "Plan", url: "https://example.org/doc" },
      { id: "unsafe", kind: "repository", title: "Unsafe link", url: "https://example.org/?private_token=secret" },
    ] as DeliveryResource[];
    const links = renderToStaticMarkup(
      createElement(DeliveryProjectResources, {
        projectId: "project",
        data: workspace,
        kind: "all",
        showArchived: false,
        onFilter: () => {},
        onSaved: () => {},
      }),
    );
    expect(links).toContain('href="https://example.org/doc"');
    expect(links).toContain('rel="noopener noreferrer"');
    expect(links).not.toContain('href="https://example.org/?private_token');
    expect(links).toContain("deliveryProject.invalidLink");
  });
  it("renders compact overview with legacy resources and actual linked acceptance", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryProjectOverview, {
        onMilestone: vi.fn(),
        data: workspace,
        inbox,
        onView: () => {},
      }),
    );
    expect(html).toContain("deliveryProject.recentMilestones");
    expect(html).toContain("deliveryProject.noMilestones");
    expect(html).toContain("deliveryProject.viewInbox");
  });
});
