import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DeliveryRequirementIndex } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryQueryViews";
import { parseDeliveryRoute } from "./deliveryProjectInbox";

const state = vi.hoisted(() => ({
  options: undefined as any,
  result: {} as any,
  generation: 7,
  reads: 0,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../components/DeliveryMemberIdentity", () => ({
  ProjectOwnerSelect: () => null,
  useMemberIdentity: () => (_members: unknown[], id: string) => id,
}));
vi.mock("./deliveryQueryHooks", () => ({
  useDeliveryMemberReferences: () => ({ members: [], error: undefined }),
}));
vi.mock(
  "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTaskDetail",
  () => ({ DeliveryTaskDetail: () => null }),
);
vi.mock("./deliveryQuery", async () => ({
  ...(await vi.importActual<any>("./deliveryQuery")),
  fetchRequirementPage: async () => {
    state.reads++;
    return {
      project_id: "P",
      query_generation: state.generation,
      items: [
        {
          id: "R-7",
          title: "Old row",
          flow: { stage: "intake", owner_id: "" },
          tasks_done: 0,
          tasks_total: 0,
        },
      ],
      total: state.generation === 7 ? 1 : 2,
      next_cursor: null,
    };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    state.options = options;
    return { isPending: false, ...state.result };
  },
  useQueries: () => [],
}));

it("refreshes the requirement page when the active project context advances its generation", async () => {
  const { QueryClient, QueryObserver } = await vi.importActual<any>(
    "@tanstack/react-query",
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal("location", { hash: "#/dev-flow?view=list&project_id=P" });
  const props = {
    projectId: "P",
    sessionId: "S",
    queryGeneration: 7,
    view: "list" as const,
    route: parseDeliveryRoute(location.hash),
    onRoute: vi.fn(),
    onOpen: vi.fn(),
  };
  renderToStaticMarkup(createElement(DeliveryRequirementIndex, props));
  const observer = new QueryObserver(client, state.options);
  const unsubscribe = observer.subscribe((result: any) => {
    state.result = result;
  });
  await observer.refetch();
  expect(state.result.data.query_generation).toBe(7);
  const before = state.reads;
  state.generation = 8;
  client.setQueryData(["delivery-context", "P", "S"], {
    project_id: "P",
    query_generation: 8,
    summary: { requirements: 2 },
  });
  props.queryGeneration = 8;
  const html = renderToStaticMarkup(
    createElement(DeliveryRequirementIndex, props),
  );
  expect(html).toContain("deliveryQuery.changed");
  expect(html).not.toContain("Old row");
  observer.setOptions(state.options);
  await observer.refetch();
  expect(state.reads).toBeGreaterThan(before);
  expect(state.result.data.query_generation).toBe(8);
  expect(state.options.refetchInterval).toBeUndefined();
  unsubscribe();
  client.clear();
});
