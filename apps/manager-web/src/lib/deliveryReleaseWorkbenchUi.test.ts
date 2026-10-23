import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox, Select, Tag } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryReleaseWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseWorkbench";
import { DeliveryReleaseSourceEditor } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseSourceEditor";
import { releaseIndex, releaseQuality } from "./deliveryReleaseFixtures";
import type { DeliveryDisplayContext } from "./delivery";
import { releaseTranslations } from "../i18n/delivery-release";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  quality: null as unknown,
  catalogue: null as any,
  index: null as unknown,
  fail: false,
  queries: [] as { queryKey: string[]; enabled?: boolean }[],
  invalidations: [] as unknown[][],
  pageItems: [] as unknown[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useRef: (value: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state)) hooks.state[i] = { current: value };
    return hooks.state[i];
  },
  useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state))
      hooks.state[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.state[i],
      (change: unknown) => {
        hooks.state[i] =
          typeof change === "function" ? change(hooks.state[i]) : change;
      },
    ];
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
      hooks.invalidations.push(queryKey);
    },
  }),
  useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
    hooks.queries.push(options);
    const { queryKey } = options;
    return {
      data:
        queryKey[0] === "delivery-quality-catalogue"
          ? hooks.catalogue
          : queryKey[0] === "delivery-quality-scope"
            ? hooks.quality
            : queryKey[0] === "delivery-release-page"
              ? {
                  project_id: "P",
                  version: 7,
                  query_generation: 7,
                  as_of: "2026-10-18T12:00:00Z",
                  items: hooks.pageItems,
                  total: hooks.pageItems.length,
                  limit: 20,
                  next_cursor: null,
                }
              : hooks.index,
      isError: hooks.fail,
      isPending: false,
      isSuccess: !hooks.fail,
      isFetching: false,
      error: hooks.fail ? new Error("offline") : null,
      refetch: vi.fn(),
    };
  },
}));
function all(node: ReactNode, type: unknown): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, type));
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [
    ...(node.type === type ? [node.props] : []),
    ...all(node.props.children, type),
  ];
}
const render = (view: "quality" | "releases" = "quality", sessionId = "test", projectId = "P") => {
  hooks.next = 0;
  return DeliveryReleaseWorkbench({
    view,
    workspace: {
      project: { id: projectId, status: "active" },
      version: 7,
      query_generation: 7,
    } as DeliveryDisplayContext,
    sessionId,
    onSaved: vi.fn(),
  });
};
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.quality = structuredClone(releaseQuality);
  hooks.catalogue = {
    project_id: "P",
    version: 7,
    query_generation: 7,
    as_of: releaseQuality.as_of,
    items: [
      ...releaseQuality.requirements.map((row) => ({
        kind: "requirement",
        id: row.id,
        title: row.title,
        ready: row.accepted,
        attention: false,
        reasons: [],
        issue_count: 0,
        target: row.target,
        revision: row.revision,
        task_count: 0,
      })),
      ...releaseQuality.independent_tasks.map((row) => ({
        kind: "task",
        id: row.id,
        title: row.title,
        ready: row.verified,
        attention: false,
        reasons: [],
        issue_count: 0,
        target: row.target,
        revision: null,
        task_count: 1,
      })),
    ],
    total: 2,
    totals: { requirements: 1, independent_tasks: 1 },
    limit: 20,
    next_cursor: null,
  };
  hooks.index = structuredClone(releaseIndex);
  hooks.fail = false;
  hooks.queries = [];
  hooks.invalidations = [];
  hooks.pageItems = [];
  vi.stubGlobal("location", { hash: "#/dev-flow?view=quality&project_id=P" });
  vi.stubGlobal("history", { pushState: vi.fn(), replaceState: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("PopStateEvent", class {});
});
describe("quality uses explicit scope and honest catalogue states", () => {
  it("refreshes the exact parent context before the visible bounded reads", async () => {
    await all(render(), Button)
      .find((button) => button.children === "deliveryRelease.refresh")!
      .onClick();
    expect(hooks.invalidations[0]).toEqual(["delivery-context", "P", "test"]);
    expect(hooks.invalidations).toContainEqual([
      "delivery-quality-catalogue",
      "P",
      "test",
    ]);
    expect(hooks.invalidations).not.toContainEqual([
      "delivery-release-index",
      "P",
      "test",
    ]);
  });
  it("keeps recorded CI success distinct from a current validity decision", () => {
    vi.stubGlobal("location", {
      hash: "#/dev-flow?view=releases&project_id=P&release_directory=evidence",
    });
    hooks.pageItems = [
      {
        id: "CI-one",
        kind: "evidence",
        title: "Recorded run",
        status: "passed",
        at: null,
        environment: null,
        commit_sha: "sha",
        summary: null,
      },
    ];
    const tree = render("releases");
    expect(
      all(tree, Tag).some(
        (tag) => tag.children === "deliveryRelease.recordedPassed",
      ),
    ).toBe(true);
    expect(
      all(tree, Tag).some((tag) => tag.children === "deliveryRelease.ready"),
    ).toBe(false);
  });
  it("does not proactively load the release index from quality", () => {
    render("quality");
    expect(
      hooks.queries.filter(
        (query) =>
          query.queryKey[0] === "delivery-release-index" &&
          query.enabled !== false,
      ),
    ).toEqual([]);
  });
  it("does not proactively load the full quality catalogue from releases", () => {
    render("releases");
    expect(
      hooks.queries.filter(
        (query) =>
          query.queryKey[0] === "delivery-quality-catalogue" &&
          query.enabled !== false,
      ),
    ).toEqual([]);
  });
  it("keeps full quality facts out of the list until an explicit exact inspect", () => {
    expect(all(render("quality"), "details")).toEqual([]);
  });
  it("labels the selectable task metric as independent tasks without changing its count", () => {
    hooks.quality = {
      ...releaseQuality,
      summary: { ...releaseQuality.summary, tasks_total: 2 },
    };
    const metric = all(render(), "button").find((button) =>
      all(button.children, "span").some(
        (span) => span.children === "deliveryRelease.task",
      ),
    );
    expect(metric).toBeDefined();
    expect(all(metric!.children, "strong")[0].children).toBe(1);
    expect(releaseTranslations["zh-CN"].task).toBe("独立任务");
    expect(releaseTranslations["en-US"].task).toBe("Independent task");
    expect(releaseTranslations["ja-JP"].task).toBe("独立タスク");
  });
  it("does not select the first requirement, task or evidence on entry", () => {
    const tree = render();
    expect(all(tree, Checkbox).every((row) => !row.checked)).toBe(true);
    const create = all(tree, Button).find(
      (button) => button.children === "deliveryRelease.create",
    )!;
    expect(create.disabled).toBe(true);
  });
  it("does not permit write operations from cached catalogue data after a read failure", () => {
    hooks.fail = true;
    const buttons = all(render(), Button);
    for (const key of ["create", "configure", "import"])
      expect(
        buttons.find((button) => button.children === `deliveryRelease.${key}`)
          ?.disabled,
      ).toBe(true);
  });
  it("preserves an explicit unavailable selected task instead of replacing it", () => {
    vi.stubGlobal("location", {
      hash: "#/dev-flow?view=quality&project_id=P&task_ids=T-missing",
    });
    expect(JSON.stringify(render())).toContain("T-missing");
    expect(all(render(), Checkbox).every((row) => !row.checked)).toBe(true);
  });
  it("shows independent server-ready and attention flags without deriving global totals from a page", () => {
    hooks.catalogue.items[1] = {
      ...hooks.catalogue.items[1],
      ready: true,
      attention: true,
      issue_count: 1,
    };
    hooks.catalogue.total = 901;
    hooks.catalogue.totals = { requirements: 800, independent_tasks: 101 };
    const tree = render();
    expect(
      all(tree, Tag).some((tag) => tag.children === "deliveryRelease.ready"),
    ).toBe(true);
    expect(
      all(tree, Tag).some(
        (tag) => tag.children === "deliveryRelease.attention",
      ),
    ).toBe(true);
    const state = all(tree, Select).find(
      (select) => select["aria-label"] === "deliveryRelease.effective",
    )!;
    state.onChange("attention");
    render();
    expect(
      hooks.queries
        .filter((query) => query.queryKey[0] === "delivery-quality-catalogue")
        .at(-1)!.queryKey,
    ).toContain("attention");
    expect(
      all(tree, "button")
        .flatMap((button) => all(button.children, "strong"))
        .map((strong) => strong.children),
    ).toContain(800);
  });
  it("consults the source editor before changing filters, route state or refresh queries", async () => {
    vi.stubGlobal("location", { hash: "#/dev-flow?view=quality&project_id=P&task_ids=T-one" });
    all(render(), Button).find((button) => button.children === "deliveryRelease.sourcePrepare")!.onClick();
    const source = all(render(), DeliveryReleaseSourceEditor)[0]; expect(source).toBeDefined();
    const check = vi.fn(() => false); source.onExitGuard(check);
    all(render(), Select).find((select) => select["aria-label"] === "deliveryRelease.effective")!.onChange("attention");
    expect(check).toHaveBeenCalledOnce();
    expect(all(render(), Select).find((select) => select["aria-label"] === "deliveryRelease.effective")!.value).toBe("all");
    expect(history.pushState).not.toHaveBeenCalled();
    await all(render(), Button).find((button) => button.children === "deliveryRelease.refresh")!.onClick();
    expect(hooks.invalidations).toEqual([]);
    source.onExitGuard(null);
    all(render(), Select).find((select) => select["aria-label"] === "deliveryRelease.effective")!.onChange("attention");
    expect(all(render(), Select).find((select) => select["aria-label"] === "deliveryRelease.effective")!.value).toBe("attention");
  });
  it("hides captured source editors across project or session changes and reflects revoked import permission", () => {
    vi.stubGlobal("location", { hash: "#/dev-flow?view=quality&project_id=P&task_ids=T-one" });
    all(render(), Button).find((button) => button.children === "deliveryRelease.sourcePrepare")!.onClick();
    expect(all(render(), DeliveryReleaseSourceEditor)).toHaveLength(1);
    expect(all(render("quality", "another-session"), DeliveryReleaseSourceEditor)).toHaveLength(0);
    expect(all(render("quality", "test", "another-project"), DeliveryReleaseSourceEditor)).toHaveLength(0);
    (hooks.index as any).permissions.can_import = false;
    expect(all(render(), DeliveryReleaseSourceEditor)[0].readOnly).toBe(true);
  });
});
