import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { vi } from "vitest";
import { getSessionRevision, setSession } from "./authStorage";
import { projectSessionKey } from "./projectPortfolio";
import { deliveryInboxHash, parseDeliveryRoute } from "./deliveryProjectInbox";

const root = resolve(import.meta.dirname, "../..");
const deliveryDir = resolve(root, "subapps/ai-rd-center/src/pages/delivery");

describe("bounded delivery UI data ownership", () => {
  it("renders precise requirement loading and read failures inside the open drawer, including when no entity has loaded", () => {
    const source = readFileSync(
      resolve(deliveryDir, "DeliveryWorkbench.tsx"),
      "utf8",
    );
    const file = ts.createSourceFile(
      "DeliveryWorkbench.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let drawer: ts.JsxElement | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(file) === "Drawer" &&
        node.openingElement.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(file) === "open" &&
            attribute.initializer?.getText(file).includes("selectedId"),
        )
      )
        drawer = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(drawer).toBeDefined();
    const body = drawer!.children
      .map((child) => child.getFullText(file))
      .join("");
    expect(body).toContain("detailQuery.isPending");
    expect(body).toContain("detailQuery.error");
    expect(body).toContain("detailQuery.refetch()");
    expect(body.indexOf("detailQuery.error")).toBeLessThan(
      body.indexOf("selected &&"),
    );
    const attributes = drawer!.openingElement.getText(file);
    expect(attributes).toContain("closable={!executionExit.pending}");
    expect(attributes).toContain("maskClosable={!executionExit.pending}");
    expect(attributes).toContain("executionExit.canNavigate()");
  });
  it("shares the task command session identity when the same JWT is renewed", () => {
    const source = readFileSync(
      resolve(deliveryDir, "DeliveryWorkbench.tsx"),
      "utf8",
    );
    expect(source).toContain("const sessionSnapshot = projectSessionKey;");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    try {
      setSession("same-jwt", "P", "tenant");
      const before = projectSessionKey(),
        revision = getSessionRevision();
      setSession("same-jwt", "P", "tenant");
      expect(getSessionRevision()).not.toBe(revision);
      expect(projectSessionKey()).not.toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("wires live context generations to requirement and task page readers while keeping edit guards", () => {
    const source = readFileSync(
      resolve(deliveryDir, "DeliveryWorkbench.tsx"),
      "utf8",
    );
    expect(
      source.match(/queryGeneration=\{data.query_generation\}/g),
    ).toHaveLength(2);
    expect(source).toContain("invalidateDeliveryQueries(qc, projectId)");
    expect(source).toContain(
      "retainedRequirement.current?.requirement.id !== selectedId",
    );
    expect(source).toContain(
      "canWrite && !detailQuery.isPending && !detailQuery.isError",
    );
  });
  it("switches desktop requirement tables to one column cards below 640px with visible keyboard focus", () => {
    const css = readFileSync(
      resolve(deliveryDir, "delivery-workbench.css"),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)\s*\{\s*\.delivery-query-desktop-list\s*\{\s*display: none;/,
    );
    expect(css).toMatch(
      /\.delivery-query-mobile-list\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(css).toContain(
      ".delivery-query-mobile-list .delivery-card:focus-visible",
    );
  });
  it("does not download the export workspace from any first party delivery view or editor", () => {
    const files = readdirSync(deliveryDir).filter((file) =>
      file.endsWith(".tsx"),
    );
    files.push(resolve(root, "src/components/DeliveryMemberIdentity.tsx"));
    const callers = files.filter((file) =>
      /\bfetchDelivery\s*\(/.test(
        readFileSync(resolve(deliveryDir, file), "utf8"),
      ),
    );
    expect(callers).toEqual([]);
  });

  it("restores requirement query and both independent page cursors from the URL", () => {
    expect(
      parseDeliveryRoute(
        "#/dev-flow?view=list&q=space+test&stage=testing&owner=user%3Aa&sort=due_asc&page=4&cursor=req-c&task_page=3&task_cursor=task-c&task_sort=id_asc&requirement=R-501&task=T-501",
      ),
    ).toMatchObject({
      search: "space test",
      stage: "testing",
      owner: "user:a",
      sort: "due_asc",
      page: 4,
      cursor: "req-c",
      taskPage: 3,
      taskCursor: "task-c",
      taskSort: "id_asc",
      requirement: "R-501",
      task: "T-501",
    });
  });
  it("preserves list state and unknown origin keys while opening and closing a precise requirement", () => {
    const source =
      "#/dev-flow?view=list&project_id=P&q=abc&owner=user%3A501&page=4&cursor=c-4&unknown_origkey=kept";
    const opened = deliveryInboxHash(
      {
        view: "list",
        requirement_id: "R-501",
        task_id: "T-501",
        detail: "tasks",
      },
      {},
      source,
    );
    const closed = deliveryInboxHash(
      { view: "list", requirement_id: "", detail: "details" },
      {},
      opened,
    );
    const params = new URLSearchParams(closed.split("?")[1]);
    expect(params.get("cursor")).toBe("c-4");
    expect(params.get("page")).toBe("4");
    expect(params.get("unknown_origkey")).toBe("kept");
    expect(params.has("requirement")).toBe(false);
    expect(params.has("task")).toBe(false);
  });
  it("clears explicit all filters and archived state without discarding unrelated navigation", () => {
    const href = deliveryInboxHash(
      { view: "resources", requirement_id: "", detail: "details" },
      { resourceKind: "all", showArchived: false, inboxCategory: "all" },
      "#/dev-flow?view=resources&resource_kind=document&archived=1&category=blocked&unknown_origkey=kept&resource_cursor=old",
    );
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("resource_kind")).toBe(false);
    expect(params.has("archived")).toBe(false);
    expect(params.has("category")).toBe(false);
    expect(params.get("unknown_origkey")).toBe("kept");
    expect(params.has("resource_cursor")).toBe(false);
  });
});
