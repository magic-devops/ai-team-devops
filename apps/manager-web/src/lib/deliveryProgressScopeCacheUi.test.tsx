import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DeliveryProgressSnapshotBrowser } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryProgressBrowser";
import type { ProgressCollection } from "./deliveryProgress";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => "session-S",
}));
vi.mock("./deliveryQueryHooks", () => ({
  useDeliveryMemberReferences: () => ({ members: [] }),
}));
const scope = { kind: "milestone", id: "M-one", label: "Milestone one" },
  basis = "a".repeat(64);
const task = {
  id: "T-outside",
  title: "PROJECT_ONLY_HISTORICAL_TASK",
  req_id: "",
  sprint_id: "",
  milestone_id: "",
  owner_id: "",
  assigned_to: "",
  estimate: null,
  starts_on: null,
  ends_on: null,
  basis,
  status: "pending",
  recorded_status: "pending",
  allocations: [],
  acceptance_criteria: ["PROJECT_ONLY_CRITERIA"],
  requirement_criteria_indices: [],
  acceptance: null,
};
const requirement = {
  id: "R-outside",
  title: "PROJECT_ONLY_REQUIREMENT",
  sprint_id: "",
  milestone_id: "",
  stage: "implementation",
  revision: 1,
  basis,
  accepted: false,
  released: false,
};
function seededClient(
  collection: ProgressCollection,
  exact = false,
  cache: "legacy" | "bound-wrong" | "bound-good" = "legacy",
) {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30000 } },
  });
  query.setQueryData(
    [
      "delivery-progress-source",
      "P",
      "S",
      "observation",
      "O",
      "milestone",
      "M-one",
    ],
    {
      project_id: "P",
      as_of: "2026-10-19T00:00:00Z",
      observation: {
        id: "O",
        observed_at: "2026-10-18T00:00:00Z",
        observed_day: "2026-10-18",
        source: "manual",
        actor: "lead",
        source_version: 1,
        snapshot_basis: basis,
        scope,
        task_count: 1,
        requirement_count: 1,
        metrics: null,
        available: true,
        reasons: [],
      },
    },
  );
  const row =
    cache === "bound-good"
      ? {
          ...(collection === "tasks" ? task : requirement),
          title: "IN_SCOPE_ORIGINAL",
          ...(collection === "tasks"
            ? { acceptance_criteria: ["IN_SCOPE_CRITERION"] }
            : {}),
        }
      : collection === "tasks"
        ? task
        : requirement;
  const envelope = {
    project_id: "P",
    source_kind: "observation",
    source_id: "O",
    snapshot_basis: basis,
    scope:
      cache === "bound-good"
        ? scope
        : { kind: "project", id: "", label: "Project P" },
    collection,
    as_of: "2026-10-18T00:00:00Z",
  };
  const identity = [
    "P",
    "S",
    "observation",
    "O",
    basis,
    ...(cache === "legacy" ? [] : [scope.kind, scope.id]),
    collection,
  ];
  query.setQueryData(["delivery-progress-snapshot-page", ...identity, ""], {
    ...envelope,
    items: [row],
    total: 3,
    limit: 20,
    next_cursor: null,
  });
  if (exact)
    query.setQueryData(
      ["delivery-progress-snapshot-item", ...identity, row.id],
      { ...envelope, item: row },
    );
  return query;
}
function markup(
  client: QueryClient,
  collection: ProgressCollection,
  exact = false,
) {
  const id = collection === "tasks" ? task.id : requirement.id;
  vi.stubGlobal("location", {
    hash: `#/dev-flow?view=progress&project_id=P&progress_scope=milestone&scope_id=M-one&observation_id=O&progress_collection=${collection}${exact ? "&progress_item=" + id : ""}`,
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(DeliveryProgressSnapshotBrowser, {
        projectId: "P",
        sessionId: "S",
        sourceKind: "observation",
        sourceId: "O",
        disabled: false,
        generation: 7,
        route: {
          startsOn: "2026-10-01",
          endsOn: "2026-10-19",
          scope: "milestone",
          scopeId: "M-one",
          baselineId: "",
          observationId: "O",
        },
        onOpenTask: () => {},
      }),
    ),
  );
}
describe("real QueryClient scope-bound immutable snapshot rendering", () => {
  for (const collection of ["tasks", "requirements"] as const) {
    it(`does not use a legacy project ${collection} page beneath a milestone header with the same fingerprint`, () => {
      const client = seededClient(collection);
      const html = markup(client, collection);
      client.clear();
      expect(html).toContain(scope.label);
      expect(html).not.toContain("PROJECT_ONLY_");
    });
    it(`does not use a legacy project exact ${collection} item beneath a milestone header`, () => {
      const client = seededClient(collection, true);
      const html = markup(client, collection, true);
      client.clear();
      expect(html).toContain(scope.label);
      expect(html).not.toContain("PROJECT_ONLY_");
    });
    it(`rejects a mismatched ${collection} response scope even when the key is correctly scope-bound`, () => {
      const client = seededClient(collection, true, "bound-wrong");
      const html = markup(client, collection, true);
      client.clear();
      expect(html).not.toContain("PROJECT_ONLY_");
    });
    it(`renders a valid scope-bound ${collection} page and exact original as a positive control`, () => {
      const client = seededClient(collection, true, "bound-good");
      const html = markup(client, collection, true);
      client.clear();
      expect(html).toContain("IN_SCOPE_ORIGINAL");
      expect(html).toContain('class="delivery-progress-exact"');
      if (collection === "tasks") expect(html).toContain("IN_SCOPE_CRITERION");
    });
  }
});
