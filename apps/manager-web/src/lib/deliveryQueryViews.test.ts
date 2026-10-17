import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryRequirementIndex,
  DeliveryRequirementTasks,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { parseDeliveryRoute } from "./deliveryProjectInbox";

const state = vi.hoisted(() => ({
  queries: [] as any[],
  branches: [] as any[],
  data: {} as Record<string, any>,
  taskIds: [] as string[],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    state.queries.push(options);
    return {
      data:
        typeof state.data[options.queryKey[0]] === "function"
          ? state.data[options.queryKey[0]](options)
          : state.data[options.queryKey[0]],
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useQueries: ({ queries }: any) => {
    state.branches.push(...queries);
    return queries.map((options: any) => ({
      data:
        typeof state.data[options.queryKey[0]] === "function"
          ? state.data[options.queryKey[0]](options)
          : state.data[options.queryKey[0]],
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
  },
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  ProjectOwnerSelect: () => createElement("span", null, "owner-search"),
  useMemberIdentity: () => (_members: unknown[], id: string) => id,
}));
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail",
  () => ({
    DeliveryTaskDetail: ({ taskId }: { taskId: string }) => {
      state.taskIds.push(taskId);
      return createElement("article", { "data-exact-task": taskId }, taskId);
    },
  }),
);
beforeEach(() => {
  state.queries = [];
  state.branches = [];
  state.data = {};
  state.taskIds = [];
  vi.stubGlobal("location", { hash: "#/dev-flow?view=list&project_id=P" });
});

describe("rendered delivery query ownership", () => {
  it("mounts a server requirement page without loading board branches", () => {
    state.data["delivery-requirements"] = {
      project_id: "P",
      query_generation: 3,
      items: [],
      total: 10001,
      next_cursor: "next",
    };
    const html = renderToStaticMarkup(
      createElement(DeliveryRequirementIndex, {
        projectId: "P",
        sessionId: "S",
        view: "list",
        route: parseDeliveryRoute(
          "#/dev-flow?view=list&page=8&cursor=eighth&q=abc",
        ),
        onRoute: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    expect(state.branches).toHaveLength(0);
    expect(state.queries[0].queryKey.at(-1)).toBe("eighth");
    expect(state.queries[0].queryKey[3].q).toBe("abc");
    expect(html).toContain("deliveryQuery.next");
  });
  it("keeps each board stage cursor independent of the loaded cards", () => {
    location.hash =
      "#/dev-flow?view=board&board_testing_cursor=testing-20&board_testing_page=2";
    state.data["delivery-requirements-board"] = {
      project_id: "P",
      query_generation: 3,
      items: [],
      total: 999,
      next_cursor: "next",
    };
    renderToStaticMarkup(
      createElement(DeliveryRequirementIndex, {
        projectId: "P",
        sessionId: "S",
        view: "board",
        route: parseDeliveryRoute(location.hash),
        onRoute: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    expect(state.queries[0].enabled).toBe(false);
    expect(state.branches).toHaveLength(10);
    expect(
      state.branches
        .find((query) => query.queryKey.at(-2) === "testing")
        .queryKey.at(-1),
    ).toBe("testing-20");
    expect(
      state.branches
        .find((query) => query.queryKey.at(-2) === "intake")
        .queryKey.at(-1),
    ).toBe("");
  });
  it.each(["generation", "project"])(
    "does not combine successfully loaded board pages from a different %s",
    (mismatch) => {
      location.hash = "#/dev-flow?view=board&project_id=P";
      state.data["delivery-requirements-board"] = (options: any) => {
        const stage = options.queryKey.at(-2);
        return {
          project_id:
            mismatch === "project" && stage === "intake" ? "OTHER" : "P",
          query_generation:
            mismatch === "generation" && stage === "intake" ? 7 : 8,
          total: ["intake", "product"].includes(stage) ? 1 : 0,
          next_cursor: null,
          items: ["intake", "product"].includes(stage)
            ? [
                {
                  id: "R-moved",
                  title: "Moved requirement",
                  priority: "P1",
                  tasks_total: 0,
                  tasks_done: 0,
                  flow: { stage, owner_id: "" },
                },
              ]
            : [],
        };
      };
      const html = renderToStaticMarkup(
        createElement(DeliveryRequirementIndex, {
          projectId: "P",
          sessionId: "S",
          view: "board",
          route: parseDeliveryRoute(location.hash),
          onRoute: vi.fn(),
          onOpen: vi.fn(),
        }),
      );
      expect(html).toContain("deliveryQuery.changed");
      expect(html).not.toContain("Moved requirement");
      expect(html).toContain("deliveryQuery.firstPage");
    },
  );
  it("provides a single-column requirement card with the same exact-detail action and readable facts", () => {
    state.data["delivery-requirements"] = {
      project_id: "P",
      query_generation: 3,
      items: [
        {
          id: "R-mobile",
          title: "Narrow screen requirement",
          priority: "P1",
          tasks_done: 7,
          tasks_total: 12,
          flow: { stage: "testing", owner_id: "", due_on: "2026-11-01" },
        },
      ],
      total: 1,
      next_cursor: null,
    };
    const html = renderToStaticMarkup(
      createElement(DeliveryRequirementIndex, {
        projectId: "P",
        sessionId: "S",
        view: "list",
        queryGeneration: 3,
        route: parseDeliveryRoute(location.hash),
        onRoute: vi.fn(),
        onOpen: vi.fn(),
      }),
    );
    expect(html).toContain('class="delivery-query-mobile-list"');
    expect(html).toContain('class="delivery-query-desktop-list"');
    expect(html).toContain("delivery.stages.testing");
    expect(html).toContain("7/12");
    expect(html).toContain("2026-11-01");
    expect(html).toMatch(/<button[^>]*class="delivery-card"/);
  });
  it("opens a precise task outside the requirement task page without declaring it deleted", () => {
    state.data["delivery-requirement-tasks"] = {
      items: [],
      total: 10001,
      next_cursor: "next",
    };
    const html = renderToStaticMarkup(
      createElement(DeliveryRequirementTasks, {
        projectId: "P",
        sessionId: "S",
        requirementId: "R-501",
        route: parseDeliveryRoute(
          "#/dev-flow?view=list&requirement=R-501&detail=tasks&task=T-10001&task_cursor=page-3&task_page=3",
        ),
        onRoute: vi.fn(),
        onUnresolvedChange: vi.fn(),
      }),
    );
    expect(state.taskIds).toEqual(["T-10001"]);
    expect(html).toContain('data-exact-task="T-10001"');
    expect(html).toContain("deliveryQuery.outsidePage");
    expect(html).not.toContain("deliveryProject.taskMissing");
  });
});
