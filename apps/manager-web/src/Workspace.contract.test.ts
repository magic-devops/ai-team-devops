import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const workspaceSource = readFileSync(resolve(root, "src/pages/Workspace.tsx"), "utf8");
const navigationSource = readFileSync(resolve(root, "src/navigation.tsx"), "utf8");
const appSource = readFileSync(resolve(root, "src/App.tsx"), "utf8");

describe("Hermes Workspace contracts", () => {
  it("uses the canonical workspace route and no workspace-v5 compatibility alias", () => {
    expect(navigationSource).toContain('key: "workspace", path: "#/workspace"');
    expect(navigationSource).toContain('capability: "overview.hermes.workspace"');
    expect(appSource).toContain('new Set(["#/workspace"])');
    expect(`${navigationSource}\n${appSource}`).not.toContain("workspace-v5");
    expect(`${navigationSource}\n${appSource}`).not.toContain("workspaceV5");
  });

  it("keeps resource tabs to the product 1.0.0 supported backend resources", () => {
    expect(workspaceSource).toContain('const RESOURCE_TABS: HermesResource[] = ["sessions", "runs", "tasks", "requirements", "assets"]');
    expect(workspaceSource).not.toContain('"schedules"');
    expect(workspaceSource).not.toContain('"devices"');
  });

  it("encodes explicit backend statuses and translated status rendering", () => {
    expect(workspaceSource).toContain('tasks: ["active", "in_progress", "blocked", "completed", "archived"]');
    expect(workspaceSource).toContain('requirements: ["active", "draft", "ready", "completed", "archived"]');
    expect(workspaceSource).toContain('sessions: ["active", "paused", "completed", "archived"]');
    expect(workspaceSource).toContain('assets: ["active", "archived"]');
    expect(workspaceSource).toContain("workspace.statuses.${status}");
  });

  it("clears selection and edit state on scope changes and protects late mutation selection", () => {
    expect(workspaceSource).toContain("setBusinessDrawer(undefined);");
    expect(workspaceSource).toContain("requestScope === currentScopeSignature");
    expect(workspaceSource).toContain("contextGeneration");
    expect(workspaceSource).toContain("setActionResult(undefined);");
    expect(workspaceSource).toContain("setWorkspaceDrawer(false);");
    expect(workspaceSource).toContain("mode === \"edit\" || values.description?.trim()");
    expect(workspaceSource).toContain('kind: typeof data.kind === "string" ? data.kind : ""');
    expect(workspaceSource).toContain('resource === "assets" && (mode === "edit" || values.kind?.trim())');
  });

  it("guards late mutation callbacks by captured scope and resource identity", () => {
    expect(workspaceSource).toContain('requestScope = scopeSignature(connection, "workspaces", contextGeneration, tokenGeneration)');
    expect(workspaceSource).toContain("requestScope === scopeSignature(connection, resource, contextGeneration, tokenGeneration)");
    expect(workspaceSource).toContain("scopeSignature(connection, activeResource, contextGeneration, tokenGeneration)");
    expect(workspaceSource).toContain("requestResource === activeResource");
    expect(workspaceSource).toContain("requestEntityId === selected?.id");
    expect(workspaceSource).toContain("if (!isCurrentRequest) return;");
  });

  it("selects opened runs immediately and makes table rows selectable", () => {
    expect(workspaceSource).toContain("onRow={(row) => ({");
    expect(workspaceSource).toContain("onClick: () => onSelect(row)");
    expect(workspaceSource).toContain("onOpenRun={(run) => { setSelected(run); setPendingRun(run); setActiveResource(\"runs\"); setActiveWorkspaceTab(\"runs\");");
    expect(workspaceSource).toContain("loading={listQuery.isLoading}");
  });

  it("keeps connected workspace chrome compact on mobile", () => {
    expect(workspaceSource).toContain("connectionSettingsOpen");
    expect(workspaceSource).toContain("workspace.connectionSettings");
    expect(workspaceSource).toContain("else if (workspaceReady) setConnectionSettingsOpen(false)");
    expect(workspaceSource).toContain("{connectionSettingsOpen ? (");
    expect(workspaceSource).toContain('activeKey={["connection"]}');
    expect(workspaceSource).toContain('className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b py-2 text-sm"');
    expect(workspaceSource).not.toContain("<Statistic");
  });
});
