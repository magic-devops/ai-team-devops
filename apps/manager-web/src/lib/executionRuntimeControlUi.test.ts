import { isValidElement, type ReactNode } from "react";
import { Button, Input, Modal } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionRuntimeControl } from "../../subapps/ai-rd-center/src/pages/delivery/ExecutionRuntimeControl";
import type { ExecutionRuntime } from "./executionRuntime";
import { request } from "./http";
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as any[],
  index: 0,
  refIndex: 0,
  scope: "session-one",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (next: any) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
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
const runtime: ExecutionRuntime = {
  project_id: "P",
  execution_id: "E",
  run_id: "R",
  run_version: 9,
  attempt: 2,
  status: "running",
  runtime_status: "running",
  stale: false,
  active_node_id: "node",
  observed_at: "",
  recovery_requires_review: false,
  stop: null,
  approval: null,
  nodes: [],
  controls: {
    start: { allowed: false, reasons: [] },
    retry: { allowed: false, reasons: [] },
    cancel: { allowed: true, reasons: [] },
    approval: { allowed: false, reasons: [] },
    approval_reject: { allowed: false, reasons: [] },
  },
};
let version = 7,
  basis = "a".repeat(64),
  sent: any[] = [],
  fail = "";
const saved = vi.fn(),
  unresolved = vi.fn(),
  observed = vi.fn();
const render = () => {
  hooks.index = 0;
  hooks.refIndex = 0;
  return ExecutionRuntimeControl({
    projectId: "P",
    executionId: "E",
    sessionId: "one",
    runtime,
    onSaved: saved,
    onObserved: observed,
    onUnresolvedChange: unresolved,
  });
};
function find(
  node: ReactNode,
  type: unknown,
  predicate: (props: any) => boolean,
): any {
  if (Array.isArray(node))
    return node.map((child) => find(child, type, predicate)).find(Boolean);
  if (!isValidElement<any>(node)) return undefined;
  if (node.type === type && predicate(node.props)) return node.props;
  return (
    find(node.props.children, type, predicate) ||
    find(node.props.action, type, predicate) ||
    (node.type === Modal ? find(node.props.footer, type, predicate) : undefined)
  );
}
const button = (label: string) =>
  find(
    render(),
    Button,
    (p) => p.children === `deliveryExecutionRuntime.${label}`,
  );
const draft = async () => {
  button("cancelRun").onClick();
  find(
    render(),
    Input.TextArea,
    (p) => p["aria-label"] === "deliveryExecutionRuntime.reason",
  ).onChange({ target: { value: "Stop original attempt" } });
  await button("preview").onClick();
};
beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.scope = "session-one";
  version = 7;
  basis = "a".repeat(64);
  sent = [];
  fail = "";
  saved.mockReset();
  unresolved.mockReset();
  observed.mockReset();
  runtime.status = "running";
  runtime.runtime_status = "running";
  runtime.stale = false;
  runtime.approval = null;
  runtime.controls.approval = { allowed: false, reasons: [] };
  runtime.controls.approval_reject = { allowed: false, reasons: [] };
  vi.mocked(request)
    .mockReset()
    .mockImplementation(async (path, init) => {
      if (path.endsWith("execution-control-preview")) {
        const body = JSON.parse(String(init?.body));
        return {
          project_id: "P",
          execution_id: "E",
          version,
          action: body.action,
          allowed: true,
          reasons: [],
          payload: {
            id: "E",
            run_id: "R",
            run_version: 9,
            attempt: 2,
            control_basis: basis,
            reason: body.reason,
            ...(body.approval_id
              ? {
                  approval_id: body.approval_id,
                  approval_version: 4,
                  decision: body.decision,
                }
              : {}),
          },
        };
      }
      if (path.endsWith("/runtime")) return runtime;
      sent.push(JSON.parse(String(init?.body)));
      if (fail) throw new Error(fail);
      return { project: { id: "P" } };
    });
});
describe("operator callbacks retain the exact execution intent", () => {
  it.each([
    { stale: true, code: "execution_stale" },
    { stale: false, code: "project_not_active" },
  ])(
    "opens the authorized reject preview when approval is blocked by $code",
    async ({ stale, code }) => {
      runtime.status = "interrupted";
      runtime.runtime_status = "interrupted";
      runtime.stale = stale;
      runtime.approval = {
        id: "AP",
        version: 4,
        node_id: "gate",
        attempt: 2,
        status: "pending",
        title: "Confirm execution",
      };
      runtime.controls.approval = {
        allowed: false,
        reasons: [{ code, message: "Continuation is unavailable" }],
      };
      runtime.controls.approval_reject = { allowed: true, reasons: [] };
      expect(button("approveGate").disabled).toBe(true);
      expect(button("rejectGate").disabled).toBe(false);
      button("rejectGate").onClick();
      expect(find(render(), Modal, () => true).open).toBe(true);
      find(
        render(),
        Input.TextArea,
        (props) => props["aria-label"] === "deliveryExecutionRuntime.reason",
      ).onChange({ target: { value: "Retire the original gate" } });
      await button("preview").onClick();
      expect(button("confirm").disabled).toBe(false);
      await button("confirm").onClick();
      expect(sent[0]).toMatchObject({
        action: "execution.approval",
        payload: {
          approval_id: "AP",
          approval_version: 4,
          decision: "reject",
          reason: "Retire the original gate",
        },
      });
    },
  );
  it.each([false, true])(
    "keeps rejection disabled without explicit permission when approval.allowed=%s",
    (approvalAllowed) => {
      runtime.approval = {
        id: "AP",
        version: 4,
        node_id: "gate",
        attempt: 2,
        status: "pending",
        title: "Confirm execution",
      };
      runtime.controls.approval = {
        allowed: approvalAllowed,
        reasons: approvalAllowed
          ? []
          : [
              {
                code: "approval_permission_required",
                message: "Approval permission is required",
              },
            ],
      };
      runtime.controls.approval_reject = {
        allowed: false,
        reasons: [
          {
            code: "approval_permission_required",
            message: "Approval permission is required",
          },
        ],
      };
      expect(button("rejectGate").disabled).toBe(true);
      button("rejectGate").onClick();
      expect(find(render(), Modal, () => true).open).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("requires a preview and an explicit confirmation, then sends only one Manager command", async () => {
    await draft();
    expect(sent).toEqual([]);
    await button("confirm").onClick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      action: "execution.cancel",
      expected_version: 7,
      payload: {
        id: "E",
        run_id: "R",
        attempt: 2,
        reason: "Stop original attempt",
        control_basis: "a".repeat(64),
      },
    });
    expect(saved).toHaveBeenCalledOnce();
  });
  it("locks closing on an unknown result, reads status without reissuing, and retries the original body", async () => {
    await draft();
    fail = "network interrupted";
    await button("confirm").onClick();
    expect(find(render(), Modal, () => true).closable).toBe(false);
    find(render(), Modal, () => true).onCancel();
    expect(button("confirm").disabled).toBe(true);
    await button("queryOriginal").onClick();
    expect(sent).toHaveLength(1);
    expect(observed).toHaveBeenCalledWith(runtime);
    fail = "";
    await button("retryOriginal").onClick();
    expect(sent[1]).toEqual(sent[0]);
    expect(unresolved).toHaveBeenCalledWith(true);
  });
  it("retains the reason after 409 and only adopts a new basis after explicit acceptance", async () => {
    await draft();
    fail = "HTTP 409: changed";
    await button("confirm").onClick();
    version = 8;
    basis = "b".repeat(64);
    await button("readLatest").onClick();
    expect(button("confirm").disabled).toBe(true);
    expect(sent).toHaveLength(1);
    button("adopt").onClick();
    fail = "";
    await button("confirm").onClick();
    expect(sent[1].payload.reason).toBe("Stop original attempt");
    expect(sent[1].payload.control_basis).toBe("b".repeat(64));
    expect(sent[1].expected_version).toBe(8);
    expect(sent[1].idempotency_key).not.toBe(sent[0].idempotency_key);
  });
  it("does not submit a captured confirmation after the account changes", async () => {
    await draft();
    hooks.scope = "session-two";
    await button("confirm").onClick();
    expect(sent).toEqual([]);
    expect(saved).not.toHaveBeenCalled();
  });
});
