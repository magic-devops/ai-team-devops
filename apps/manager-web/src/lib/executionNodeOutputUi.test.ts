import { isValidElement, type ReactNode } from "react";
import { Alert, Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionNodeOutput,
  ExecutionOutputPane,
} from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionNodeOutput";
import type { ExecutionRuntime } from "./executionRuntime";
import { request } from "./http";
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as any[],
  index: 0,
  refIndex: 0,
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.values))
      hooks.values[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[i],
      (next: any) => {
        hooks.values[i] =
          typeof next === "function" ? next(hooks.values[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = hooks.refIndex++;
    return (hooks.refs[i] ??= { current: initial });
  },
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./projectPortfolio", () => ({
  projectSessionKey: () => hooks.scope,
  projectHeaders: (id: string) => ({ "X-Project-Id": id }),
}));
vi.mock("./http", () => ({ request: vi.fn() }));
function find(
  node: ReactNode,
  type: unknown,
  test: (props: any) => boolean,
): any {
  if (Array.isArray(node))
    return node.map((n) => find(n, type, test)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  return node.type === type && test(node.props)
    ? node.props
    : find(node.props.children, type, test) ||
        find(node.props.action, type, test);
}
let page = 0;
const render = () => {
  hooks.index = 0;
  hooks.refIndex = 0;
  return ExecutionOutputPane({
    projectId: "P",
    executionId: "E",
    nodeId: "n",
    attempt: 2,
    stream: "stderr",
    active: true,
  });
};
const button = (name: string) =>
  find(
    render(),
    Button,
    (p) => p.children === `deliveryExecutionRuntime.${name}`,
  );
beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.scope = "original";
  page = 0;
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async () => {
      const chunk = {
        seq: 1,
        source_seq: 1,
        node_id: "n",
        attempt: 2,
        stream: "stderr",
        text: "masked line\n",
        observed_at: "",
        truncated: false,
      };
      return {
        project_id: "P",
        execution_id: "E",
        run_id: "R",
        node_id: "n",
        attempt: 2,
        stream: "stderr",
        source: "live_capture",
        availability: "available",
        available_attempts: [1, 2],
        chunks: page++
          ? [chunk, { ...chunk, seq: 2, source_seq: 2, text: "second line\n" }]
          : [chunk],
        next_cursor: "after-one",
        more: page === 1,
        complete: page > 1,
        truncated: false,
        sanitized: true,
        gaps: [],
      };
    });
});
describe("actual output reader callbacks", () => {
  it("does not replace an explicitly invalid node or attempt with the current output", () => {
    const runtime = {
      attempt: 2,
      nodes: [
        {
          id: "n",
          title: "Known step",
          kind: "command",
          is_test: false,
          status: "running",
          available_attempts: [1, 2],
          result_attempt: null,
          reused_result: false,
        },
      ],
    } as ExecutionRuntime;
    const tree = ExecutionNodeOutput({
      projectId: "P",
      executionId: "E",
      sessionId: "s",
      runtime,
      active: true,
      initialNodeId: "unknown",
      initialAttempt: 2,
    });
    expect(find(tree, ExecutionOutputPane, () => true)).toBeUndefined();
    expect(
      find(
        tree,
        Alert,
        (p) => p.title === "deliveryExecutionRuntime.invalidSelection",
      ),
    ).toBeDefined();
    hooks.values = [];
    hooks.index = 0;
    hooks.refs = [];
    hooks.refIndex = 0;
    const invalidAttempt = ExecutionNodeOutput({
      projectId: "P",
      executionId: "E",
      sessionId: "s",
      runtime,
      active: true,
      initialNodeId: "n",
      initialAttempt: 0,
    });
    expect(
      find(invalidAttempt, ExecutionOutputPane, () => true),
    ).toBeUndefined();
  });
  it("uses the bound continuation cursor and renders each reconnect line once", async () => {
    await button("refreshOutput").onClick();
    await button("loadMore").onClick();
    const output = find(
      render(),
      "pre",
      (p) => p["aria-label"] === "deliveryExecutionRuntime.loadedOutput",
    );
    expect(output.children).toBe("masked line\nsecond line\n");
    expect(String(vi.mocked(request).mock.calls[1][0])).toContain(
      "attempt=2&stream=stderr&limit=50&cursor=after-one",
    );
  });
  it("searches only loaded safe output without issuing another network request", async () => {
    await button("refreshOutput").onClick();
    find(
      render(),
      Input,
      (p) => p["aria-label"] === "deliveryExecutionRuntime.searchLoaded",
    ).onChange({ target: { value: "missing" } });
    expect(
      find(
        render(),
        "pre",
        (p) => p["aria-label"] === "deliveryExecutionRuntime.loadedOutput",
      ).children,
    ).toBe("deliveryExecutionRuntime.noLoadedMatches");
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects a late output response after identity changes", async () => {
    const original = vi.mocked(request).getMockImplementation()!;
    vi.mocked(request).mockImplementationOnce(async (...args) => {
      const value = await original(...args);
      hooks.scope = "different";
      return value;
    });
    await button("refreshOutput").onClick();
    expect(
      find(
        render(),
        "pre",
        (p) => p["aria-label"] === "deliveryExecutionRuntime.loadedOutput",
      ).children,
    ).not.toContain("masked line");
  });
});
