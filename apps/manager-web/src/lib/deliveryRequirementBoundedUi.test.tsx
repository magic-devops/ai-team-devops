import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryRequirementDefinition,
  DeliveryRequirementRecords,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementReads";
import { DeliveryRequirementChangeHost } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementChangeHost";
import { DeliveryRequirementHistory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryRequirementHistory";
import { prepareRequirementOriginal } from "./deliveryRequirementCommand";
import type { RequirementHeadResponse } from "./deliveryRequirementReads";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => "S" }));
vi.mock("./eventReceipts", async () => ({
  ...(await vi.importActual<typeof import("./eventReceipts")>(
    "./eventReceipts",
  )),
  eventRetryDraftKey: () => "retained-requirement",
}));
vi.mock("antd", () => {
  const block = ({
    children,
    title,
    description,
    footer,
    action,
  }: {
    children?: ReactNode;
    title?: ReactNode;
    description?: ReactNode;
    footer?: ReactNode;
    action?: ReactNode;
  }) => createElement("div", {}, title, description, children, footer, action);
  return {
    Alert: block,
    Button: block,
    Empty: Object.assign(block, { PRESENTED_IMAGE_SIMPLE: "empty" }),
    Modal: block,
    Skeleton: block,
    Tag: block,
    Select: block,
    Input: Object.assign(block, { TextArea: block }),
  };
});
const basis = "a".repeat(64),
  base = {
    project_id: "P",
    requirement_id: "R",
    version: 7,
    query_generation: 3,
    as_of: "2026-10-19T00:00:00Z",
  };
const head: RequirementHeadResponse = {
  ...base,
  requirement: {
    id: "R",
    title: "Current head",
    basis,
    priority: "P1",
    status: "active",
    sprint_id: "",
    tasks_total: 0,
    tasks_done: 0,
    tasks_recorded_done: 0,
    accepted: false,
    deployment_verified: false,
    flow: {
      stage: "development",
      revision: 2,
      owner_id: "",
      due_on: null,
      milestone_id: "",
      blocked_reason: "",
      closed: false,
      legacy_completed: false,
      gates: [],
      record_counts: { artifacts: 1, reviews: 1, releases: 1 },
    },
  },
};
let storage: Map<string, string>;
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30000 } },
  });
function html(query: QueryClient, node: ReactNode) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: query }, node),
  );
}
function fail(query: QueryClient, key: unknown[], status: number) {
  query
    .getQueryCache()
    .find({ queryKey: key, exact: true })!
    .setState({
      status: "error",
      error: new Error(`HTTP ${status}: unavailable`),
    });
}
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("location", {
    hash: "#/dev-flow?project_id=P&requirement=R&detail=history&requirement_edit=1",
  });
});
describe("actual bounded requirement components with a real query cache", () => {
  it.each([403, 404, 503])(
    "restores the unknown original while current reads fail with HTTP %s",
    (status) => {
      const query = client();
      const original = prepareRequirementOriginal(
        { version: 7, key: "ORIGINAL_KEY" },
        "R",
        basis,
        { priority: "P2" },
        false,
        null,
      );
      storage.set(
        "retained-requirement",
        JSON.stringify({
          phase: "unknown",
          original,
          error: "network interrupted",
        }),
      );
      for (const name of ["context", "head", "definition"]) {
        const key = [`delivery-requirement-edit-${name}`, "P", "S", "R"];
        query.setQueryData(key, { ...head, permissions: { write: false } });
        fail(query, key, status);
      }
      const result = html(
        query,
        createElement(DeliveryRequirementChangeHost, {
          projectId: "P",
          requirementId: "R",
          sessionId: "S",
          onClose: () => {},
          onSaved: () => {},
          onUnresolvedChange: () => {},
        }),
      );
      expect(result).toContain("ORIGINAL_KEY");
      expect(result).toContain("priority");
      expect(result).toContain("deliveryCollaboration.retryOriginal");
      expect(result).not.toContain("deliveryCollaboration.preview");
      query.clear();
    },
  );
  it("reads a selected off-page original independently from a failed history index and current requirement", () => {
    const query = client();
    location.hash =
      "#/dev-flow?project_id=P&requirement=R&detail=history&requirement_version=OLD";
    const key = ["delivery-requirement-history", "P", "S", "R", ""];
    query.setQueryData(key, {
      project_id: "P",
      requirement_id: "R",
      items: [],
      limit: 20,
      next_cursor: null,
      earlier_history_unknown: true,
    });
    fail(query, key, 503);
    query.setQueryData(["delivery-requirement-version", "P", "S", "R", "OLD"], {
      project_id: "P",
      requirement_id: "R",
      item: {
        id: "OLD",
        number: 1,
        basis,
        at: base.as_of,
        actor: { id: null, name: "Reader" },
        source: "sql_observed",
        flow_revision: 1,
        definition: {
          id: "R",
          title: "SELECTED_HISTORICAL_ORIGINAL",
          description: "HISTORICAL_BODY",
          acceptance_criteria: ["OLD_CRITERION"],
        },
      },
    });
    const result = html(
      query,
      createElement(DeliveryRequirementHistory, {
        projectId: "P",
        sessionId: "S",
        requirementId: "R",
        onNavigate: () => {},
      }),
    );
    expect(result).toContain("SELECTED_HISTORICAL_ORIGINAL");
    expect(result).toContain("OLD_CRITERION");
    expect(result).toContain("deliveryCollaboration.definitionUnavailable");
    expect(result).not.toContain("deliveryCollaboration.definitionSame");
    query.clear();
  });
  for (const collection of ["artifacts", "reviews", "releases"] as const) {
    function seed(query: QueryClient, gen = 3) {
      const identity = ["P", "S", "R", 3, basis, collection];
      query.setQueryData(["delivery-requirement-records", ...identity, ""], {
        ...base,
        query_generation: gen,
        requirement_basis: basis,
        collection,
        total: 1,
        limit: 20,
        next_cursor: null,
        items: [
          {
            position: 0,
            title: "SUMMARY_ONLY",
            revision: 2,
            kind: null,
            stage: null,
            result: null,
            decision: null,
            actor: null,
            at: null,
            stale: false,
          },
        ],
      });
      query.setQueryData(["delivery-requirement-record", ...identity, "0"], {
        ...base,
        query_generation: gen,
        requirement_basis: basis,
        collection,
        position: 0,
        record: { comment: "SELECTED_ORIGINAL_BODY", url: "javascript:unsafe" },
      });
      location.hash = `#/dev-flow?project_id=P&requirement=R&activity_scope_id=R&requirement_record_collection=${collection}&requirement_record_position=0&requirement_record_generation=3`;
    }
    const node = () =>
      createElement(DeliveryRequirementRecords, {
        projectId: "P",
        sessionId: "S",
        head,
        collection,
        onNavigate: () => {},
      });
    it(`${collection} keeps position zero and renders only its exact selected original`, () => {
      const query = client();
      seed(query);
      const result = html(query, node());
      expect(result).toContain("SUMMARY_ONLY");
      expect(result).toContain("SELECTED_ORIGINAL_BODY");
      expect(result).not.toContain('href="javascript:');
      query.clear();
    });
    it(`${collection} rejects old-generation page and original even under a current cache key`, () => {
      const query = client();
      seed(query, 2);
      const result = html(query, node());
      expect(result).not.toContain("SUMMARY_ONLY");
      expect(result).not.toContain("SELECTED_ORIGINAL_BODY");
      query.clear();
    });
    it.each([403, 404])(
      `${collection} removes cached originals after HTTP %s`,
      (status) => {
        const query = client();
        seed(query);
        expect(html(query, node())).toContain("SELECTED_ORIGINAL_BODY");
        fail(
          query,
          [
            "delivery-requirement-records",
            "P",
            "S",
            "R",
            3,
            basis,
            collection,
            "",
          ],
          status,
        );
        expect(html(query, node())).not.toContain("SELECTED_ORIGINAL_BODY");
        query.clear();
      },
    );
  }
  it("does not interpret an unread or mismatched current definition as empty criteria", () => {
    const query = client();
    const key = ["delivery-requirement-definition", "P", "S", "R", 3, basis];
    query.setQueryData(key, {
      ...base,
      requirement_basis: basis,
      definition: {
        id: "R",
        title: "R",
        description: "CURRENT_BODY",
        acceptance_criteria: ["CURRENT_CRITERION"],
      },
    });
    const node = createElement(DeliveryRequirementDefinition, {
      projectId: "P",
      sessionId: "S",
      head,
    });
    expect(html(query, node)).toContain("CURRENT_CRITERION");
    fail(query, key, 404);
    expect(html(query, node)).not.toContain("CURRENT_BODY");
    expect(html(query, node)).toContain(
      "deliveryCollaboration.definitionUnavailable",
    );
    query.clear();
  });
});
