import { isValidElement, type ReactNode } from "react";
import { Button, Select } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryRequirementImpact } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { RequirementImpactFacts } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeEditor";
import { fetchRequirementImpactItem } from "./deliveryRequirementReads";
const h = vi.hoisted(() => ({
  state: [] as any[],
  next: 0,
  scope: "S",
  errorName: "",
  status: 403,
  listeners: new Map<string, () => void>(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (initial: any) => {
    const index = h.next++;
    if (!(index in h.state))
      h.state[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.state[index],
      (value: any) => {
        h.state[index] =
          typeof value === "function" ? value(h.state[index]) : value;
      },
    ];
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: any) => (Array.isArray(key) ? key[key.length - 1] : key),
  }),
}));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => h.scope }));
vi.mock("./deliveryRequirementReads", async () => ({
  ...(await vi.importActual<typeof import("./deliveryRequirementReads")>(
    "./deliveryRequirementReads",
  )),
  fetchRequirementImpactItem: vi.fn(),
}));
const basis = "a".repeat(64),
  base = {
    project_id: "P",
    requirement_id: "R",
    version: 7,
    query_generation: 3,
    requirement_basis: basis,
    as_of: "now",
  };
const item = {
  id: "T",
  kind: "direct_task",
  title: "PRIVATE_CURRENT_TASK",
  status: "in_progress",
  target: {
    id: "T",
    kind: "task",
    label: "PRIVATE_CURRENT_TASK",
    available: true,
    reason: null,
  },
};
const exact = { ...base, kind: "direct_task", item };
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    const name = options.queryKey[0];
    return {
      data:
        name === "delivery-requirement-impact"
          ? {
              ...base,
              available: true,
              complete: true,
              counts: {
                direct_task: 1,
                dependent_task: 0,
                execution: 0,
                release_candidate: 0,
                deployment: 0,
                restricted_execution: 0,
                restricted_deployment: 0,
              },
              reasons: [],
            }
          : name === "delivery-requirement-impact-page"
            ? {
                ...base,
                kind: "direct_task",
                items: [item],
                total: 1,
                limit: 20,
                next_cursor: "next/20",
              }
            : exact,
      isError: h.errorName === name,
      error:
        h.errorName === name
          ? new Error(`HTTP ${h.status}: unavailable`)
          : null,
      isPending: false,
      refetch: vi.fn(),
    };
  },
}));
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean = () => true,
): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.action, type, predicate)
  );
}
const navigate = vi.fn();
const render = () => {
  h.next = 0;
  return DeliveryRequirementImpact({
    projectId: "P",
    sessionId: "S",
    requirementId: "R",
    onNavigate: navigate,
  });
};
const open = (tree: ReactNode) =>
  find(tree, Button, (p) => p["data-action"] === "open-impact");
beforeEach(() => {
  h.state = [];
  h.next = 0;
  h.scope = "S";
  h.errorName = "";
  h.status = 403;
  h.listeners.clear();
  navigate.mockReset();
  vi.mocked(fetchRequirementImpactItem).mockReset();
  vi.mocked(fetchRequirementImpactItem).mockResolvedValue(exact as any);
  vi.stubGlobal("location", {
    hash: "#/dev-flow?project_id=P&requirement=R&requirement_impact_item=T",
  });
  vi.stubGlobal("window", {
    addEventListener: (name: string, callback: () => void) =>
      h.listeners.set(name, callback),
    removeEventListener: (name: string) => h.listeners.delete(name),
  });
});
describe("actual current impact navigation callbacks", () => {
  it("reads the exact member before using its real target and preserving the return", async () => {
    await open(render()).onClick();
    expect(fetchRequirementImpactItem).toHaveBeenCalledWith(
      "P",
      "R",
      "direct_task",
      "T",
      3,
    );
    expect(navigate).toHaveBeenCalledOnce();
    const params = new URLSearchParams(navigate.mock.calls[0][0].split("?")[1]);
    expect(params.get("task")).toBe("T");
    expect(params.get("project_id")).toBe("P");
    expect(params.get("collaboration_return")).toContain(
      "requirement_impact_item=T",
    );
  });
  it.each(["generation", "target"])(
    "rejects a mismatched exact %s response",
    async (kind) => {
      vi.mocked(fetchRequirementImpactItem).mockResolvedValue({
        ...exact,
        ...(kind === "generation"
          ? { query_generation: 4 }
          : { item: { ...item, target: { ...item.target, id: "OTHER" } } }),
      } as any);
      await open(render()).onClick();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it("rejects a late exact response across route A-B-A", async () => {
    vi.mocked(fetchRequirementImpactItem).mockImplementation(async () => {
      const original = location.hash;
      location.hash = "#/dev-flow?project_id=P&requirement=OTHER";
      h.listeners.get("popstate")!();
      location.hash = original;
      return exact as any;
    });
    await open(render()).onClick();
    expect(navigate).not.toHaveBeenCalled();
  });
  for (const name of [
    "delivery-requirement-impact-page",
    "delivery-requirement-impact-item",
  ])
    for (const status of [403, 404])
      it(`clears current counts and labels after ${name} HTTP ${status}`, () => {
        expect(find(render(), RequirementImpactFacts)).toBeDefined();
        expect(open(render())).toBeDefined();
        h.errorName = name;
        h.status = status;
        const failed = render();
        expect(find(failed, RequirementImpactFacts)).toBeUndefined();
        expect(open(failed)).toBeUndefined();
        expect(JSON.stringify(failed)).not.toContain("PRIVATE_CURRENT_TASK");
      });
  it("clears the old page and selected item when the category changes", () => {
    location.hash += "&requirement_impact_cursor=old/20";
    find(render(), Select).onChange("execution");
    const params = new URLSearchParams(navigate.mock.calls[0][0].split("?")[1]);
    expect(params.get("requirement_impact_kind")).toBe("execution");
    expect(params.has("requirement_impact_cursor")).toBe(false);
    expect(params.has("requirement_impact_item")).toBe(false);
    expect(params.get("project_id")).toBe("P");
  });
});
