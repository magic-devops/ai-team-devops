import { isValidElement, type ReactNode } from "react";
import { Button, Checkbox } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryReleaseWorkbench } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseWorkbench";
import { releaseIndex, releaseQuality } from "./deliveryReleaseFixtures";
import type { DeliveryWorkspace } from "./delivery";
import { releaseTranslations } from "../i18n/delivery-release";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  quality: null as unknown,
  index: null as unknown,
  fail: false,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0].includes("quality") ? hooks.quality : hooks.index,
    isError: hooks.fail,
    isPending: false,
    isFetching: false,
    error: hooks.fail ? new Error("offline") : null,
    refetch: vi.fn(),
  }),
}));
function all(node: ReactNode, type: unknown): Record<string, any>[] {
  if (Array.isArray(node)) return node.flatMap((child) => all(child, type));
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [
    ...(node.type === type ? [node.props] : []),
    ...all(node.props.children, type),
  ];
}
const render = (view: "quality" | "releases" = "quality") => {
  hooks.next = 0;
  return DeliveryReleaseWorkbench({
    view,
    workspace: { project: { id: "P", status: "active" } } as DeliveryWorkspace,
    sessionId: "test",
    onSaved: vi.fn(),
  });
};
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.quality = structuredClone(releaseQuality);
  hooks.index = structuredClone(releaseIndex);
  hooks.fail = false;
  vi.stubGlobal("location", { hash: "#/dev-flow?view=quality&project_id=P" });
  vi.stubGlobal("history", { pushState: vi.fn(), replaceState: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("PopStateEvent", class {});
});
describe("quality uses explicit scope and honest catalogue states", () => {
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
  it.each(["reason", "issue"])(
    "keeps valid acceptance but includes a later blocking %s in attention",
    (blocking) => {
      const task = releaseQuality.independent_tasks[0];
      hooks.quality = {
        ...releaseQuality,
        independent_tasks: [
          {
            ...task,
            verified: true,
            reasons:
              blocking === "reason"
                ? [
                    {
                      code: "critical_issues",
                      message: "Unresolved P1 issue",
                      target: null,
                    },
                  ]
                : [],
            issues:
              blocking === "issue"
                ? [
                    {
                      id: "ISS-one",
                      title: "Regression found",
                      severity: "P1",
                      status: "open",
                      task_id: task.id,
                      target: {
                        ...task.target,
                        kind: "issue",
                        view: "issues",
                        issue_id: "ISS-one",
                      },
                    },
                  ]
                : [],
          },
        ],
      };
      const metric = all(render(), "button").find((button) =>
        all(button.children, "span").some(
          (span) => span.children === "deliveryRelease.attention",
        ),
      )!;
      expect(all(metric.children, "strong")[0].children).toBe(1);
      const verified = all(render(), "button").find((button) =>
        all(button.children, "span").some(
          (span) => span.children === "deliveryRelease.verifiedCount",
        ),
      )!;
      expect(all(verified.children, "strong")[0].children).toBe(2);
      metric.onClick();
      expect(
        all(render(), Checkbox).some((row) =>
          row["aria-label"].includes(task.id),
        ),
      ).toBe(true);
    },
  );
});
