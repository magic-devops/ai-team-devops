import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDispatchDraft, buildScheduleConfigureDraft, extractDeliveryRun, extractHistoryRuns, extractPairingSecret, isDispatchPreviewCurrent, isSchedulePreviewCurrent, redactPairingSecrets, scheduleActionDisabled } from "./pages/AutomationPanel";
import type { HermesApiResponse, HermesEntity, HermesAgentProfileData, HermesSquadData } from "./lib/hermes";

const root = resolve(__dirname, "..");
const workspaceSource = readFileSync(resolve(root, "src/pages/Workspace.tsx"), "utf8");
const automationSource = readFileSync(resolve(root, "src/pages/AutomationPanel.tsx"), "utf8");

describe("Hermes native automation panel contract", () => {
  it("is reachable from Workspace without adding schedules or devices to resource tabs", () => {
    expect(workspaceSource).toContain('import { AutomationPanel } from "./AutomationPanel";');
    expect(workspaceSource).toContain('type WorkspaceTab = HermesResource | "automation"');
    expect(workspaceSource).toContain('key: "automation", label: t("workspace.automation.tab")');
    expect(workspaceSource).toContain("<AutomationPanel");
    expect(workspaceSource).toContain('const RESOURCE_TABS: HermesResource[] = ["sessions", "runs", "tasks", "requirements", "assets"]');
  });

  it("uses dedicated Hermes helpers and never bypasses the secure client", () => {
    expect(automationSource).toContain("client.agents({ limit: 50 })");
    expect(automationSource).toContain("client.squads({ limit: 50 })");
    expect(automationSource).toContain("client.agentCatalog()");
    expect(automationSource).toContain('client.listAutomationResource("schedules"');
    expect(automationSource).toContain('client.listAutomationResource("devices"');
    expect(automationSource).toContain("client.taskAgentDispatch");
    expect(automationSource).toContain("client.taskDispatch");
    expect(automationSource).toContain("client.devicePairing");
    expect(automationSource).toContain("client.deviceRevoke");
    expect(automationSource).not.toContain("fetch(");
    expect(automationSource).not.toContain("archiveAutomationResource");
  });

  it("keeps permissions and versioned action contracts explicit", () => {
    expect(automationSource).toContain("const canConfig = permissions.has(\"config\")");
    expect(automationSource).toContain("const canWrite = permissions.has(\"write\")");
    expect(automationSource).toContain("const canConfigureSchedule = canConfig && canExecute");
    expect(automationSource).toContain("const canExecute = permissions.has(\"execute\")");
    expect(automationSource).toContain("const canDispatch = canWrite && canExecute");
    expect(automationSource).toContain("disabled={!workspaceReady || !canConfig}");
    expect(automationSource).toContain("disabled={!workspaceReady || !canDispatch}");
    expect(automationSource).toContain("disabled={!workspaceReady || !canConfigureSchedule}");
    expect(automationSource).toContain("target_version: targetVersion");
    expect(automationSource).toContain("target_device_id: device.id");
    expect(automationSource).toContain("expected_version: task.version");
    expect(automationSource).toContain("dry_run: dryRun");
  });

  it("archives agent and squad configuration with PATCH status only", () => {
    expect(automationSource).toContain("const archiveProfile = useMutation");
    expect(automationSource).toContain('data: { status: "archived" }');
    expect(automationSource).toContain('archiveProfile.mutate({ kind: "agents", entity: row })');
    expect(automationSource).toContain('archiveProfile.mutate({ kind: "squads", entity: row })');
    expect(automationSource).not.toContain("client.delete(");
  });

  it("matches Goodall interval scheduling and Multica leader routing semantics", () => {
    expect(automationSource).toContain("client.scheduleConfigure(draft.scheduleId, draft.body)");
    expect(automationSource).toContain("interval_seconds");
    expect(automationSource).toContain("starts_at");
    expect(automationSource).toContain("misfire_coalesce");
    expect(automationSource).toContain('kind: "agent"');
    expect(automationSource).toContain('scheduleAction.mutate({ entity: row, action: "trigger" })');
    expect(automationSource).toContain("refetchInterval: resourceEnabled ? 5000 : false");
    expect(automationSource).toContain("loading={schedulesQuery.isLoading}");
    expect(automationSource).toContain("if (isVersionConflict(error)) invalidateAutomation()");
    expect(automationSource).toContain("workspace.actionFailed");
    expect(automationSource).toContain('const isActive = row.status === "active"');
    expect(automationSource).toContain('const isPaused = row.status === "paused"');
    expect(automationSource).toContain('scheduleActionDisabled("trigger", row.status');
    expect(automationSource).toContain('scheduleActionDisabled("pause", row.status');
    expect(automationSource).toContain('scheduleActionDisabled("resume", row.status');
    expect(automationSource).toContain("hasExactlyOneLeader");
    expect(automationSource).toContain("workspace.automation.leaderRoutes");
    expect(automationSource).not.toContain("workspace.automation.nativeScheduleHint");
    expect(automationSource).not.toContain("cron");
    expect(automationSource).not.toContain("timezone");
  });

  it("gates schedule actions with backend permission semantics and state", () => {
    const writeOnly = { canConfig: false, canExecute: false, canConfigureSchedule: false };
    expect(scheduleActionDisabled("trigger", "active", writeOnly)).toBe(true);
    expect(scheduleActionDisabled("pause", "active", writeOnly)).toBe(true);
    expect(scheduleActionDisabled("resume", "paused", writeOnly)).toBe(true);

    expect(scheduleActionDisabled("trigger", "active", { canConfig: false, canExecute: true, canConfigureSchedule: false })).toBe(false);
    expect(scheduleActionDisabled("pause", "active", { canConfig: true, canExecute: false, canConfigureSchedule: false })).toBe(false);
    expect(scheduleActionDisabled("pause", "paused", { canConfig: true, canExecute: false, canConfigureSchedule: false })).toBe(true);
    expect(scheduleActionDisabled("resume", "paused", { canConfig: true, canExecute: true, canConfigureSchedule: true })).toBe(false);
    expect(scheduleActionDisabled("resume", "active", { canConfig: true, canExecute: true, canConfigureSchedule: true })).toBe(true);
    expect(scheduleActionDisabled("trigger", "archived", { canConfig: true, canExecute: true, canConfigureSchedule: true })).toBe(true);
  });

  it("labels catalog executable as install status and separates CLI auth state", () => {
    expect(automationSource).toContain("workspace.automation.installed");
    expect(automationSource).toContain("workspace.automation.notInstalled");
    expect(automationSource).toContain("workspace.automation.authCliManaged");
    expect(automationSource).toContain("workspace.automation.authUnverified");
    expect(automationSource).toContain("row.executable");
  });

  it("keeps schedule dry-run as preview evidence and requires matching apply payload", () => {
    const values = {
      schedule_id: "daily-health",
      title: "Daily health",
      interval_seconds: 3600,
      starts_at: "2026-09-08T09:00:00+08:00",
      enabled: true,
      misfire_coalesce: true,
      nodes: [{ id: "pwd", title: "PWD", kind: "command" as const, argvText: "pwd", expected_exit_code: 0, timeout_seconds: 300 }],
    };
    const preview = buildScheduleConfigureDraft(values, undefined, "stable-key", true);
    const apply = buildScheduleConfigureDraft(values, undefined, "stable-key", false);
    expect(preview.scheduleId).toBe("daily-health");
    expect(preview.body.dry_run).toBe(true);
    expect(apply.body.dry_run).toBe(false);
    expect(apply.body.idempotency_key).toBe(preview.body.idempotency_key);
    expect(isSchedulePreviewCurrent({ drawerKey: preview.drawerKey, fingerprint: preview.fingerprint, idempotencyKey: preview.body.idempotency_key, response: { ok: true, items: [] } }, apply)).toBe(true);

    const changed = buildScheduleConfigureDraft({ ...values, interval_seconds: 7200 }, undefined, "stable-key", false);
    expect(isSchedulePreviewCurrent({ drawerKey: preview.drawerKey, fingerprint: preview.fingerprint, idempotencyKey: preview.body.idempotency_key, response: { ok: true, items: [] } }, changed)).toBe(false);
    expect(automationSource).toContain("setSchedulePreview(undefined)");
  });

  it("surfaces pairing secret fields without relying on raw evidence JSON", () => {
    const response: HermesApiResponse<unknown> = {
      ok: true,
      items: [{
        id: "device-1",
        kind: "device",
        version: 2,
        status: "pairing",
        data: { pairing_secret: "one-time", pairing_expires_at: 1788861600, secret_returned_once: true },
        created_at: "c",
        updated_at: "u",
      }],
    };
    expect(extractPairingSecret(response)).toEqual({ secret: "one-time", expiresAt: "2026-09-08T10:00:00.000Z", deviceId: "device-1" });
    expect(redactPairingSecrets(response).items[0]).toMatchObject({
      id: "device-1",
      data: { pairing_secret: "[redacted]", pairing_expires_at: 1788861600, secret_returned_once: true },
    });
    expect(automationSource).toContain("Input.Password");
    expect(automationSource).toContain("navigator.clipboard.writeText(pairingSecret.secret)");
    expect(automationSource).toContain("redactPairingSecrets(response)");
    expect(automationSource).toContain("setPairingSecret(undefined)");
    expect(automationSource).toContain("row.status === \"revoked\"");
    expect(automationSource).toContain("workspace.automation.revokedDeviceActions");
  });

  it("requires matching dispatch preview for agent and remote-command apply", () => {
    const task: HermesEntity = { id: "task-1", kind: "task", version: 6, status: "active", data: { title: "Task" }, created_at: "c", updated_at: "u" };
    const agent: HermesEntity<HermesAgentProfileData> = { id: "agent-1", kind: "agent", version: 9, status: "active", data: { title: "Agent", provider: "codex", model: "gpt-5.5", instructions: "", timeout_seconds: 300 }, created_at: "c", updated_at: "u" };
    const squad: HermesEntity<HermesSquadData>[] = [];
    const device: HermesEntity = { id: "device-1", kind: "device", version: 2, status: "active", data: { title: "Mac", platform: "darwin" }, created_at: "c", updated_at: "u" };
    const agentValues = { task_id: "task-1", target_kind: "agent" as const, target_id: "agent-1", prompt: "Implement", isolation: "workspace" as const, base_commit: "" };
    const preview = buildDispatchDraft(agentValues, [task], [agent], squad, [device], "dispatch-key", true);
    const apply = buildDispatchDraft(agentValues, [task], [agent], squad, [device], "dispatch-key", false);
    expect(preview.body).toMatchObject({ expected_version: 6, target_version: 9, idempotency_key: "dispatch-key", dry_run: true, agent_id: "agent-1" });
    expect(apply.body).toMatchObject({ idempotency_key: "dispatch-key", dry_run: false, agent_id: "agent-1" });
    expect(isDispatchPreviewCurrent({ fingerprint: preview.fingerprint, idempotencyKey: preview.idempotencyKey, response: { ok: true, items: [] } }, apply)).toBe(true);
    const changed = buildDispatchDraft({ ...agentValues, prompt: "Changed" }, [task], [agent], squad, [device], "dispatch-key", false);
    expect(isDispatchPreviewCurrent({ fingerprint: preview.fingerprint, idempotencyKey: preview.idempotencyKey, response: { ok: true, items: [] } }, changed)).toBe(false);

    const remotePreview = buildDispatchDraft({ task_id: "task-1", target_kind: "remote-command" as const, target_device_id: "device-1", command_id: "pwd", command_title: "PWD", argvText: "pwd", expected_exit_code: 0, timeout_seconds: 300, prompt: "", isolation: "workspace", base_commit: "" }, [task], [agent], squad, [device], "remote-key", true);
    expect(remotePreview.body).toMatchObject({ expected_version: 6, idempotency_key: "remote-key", dry_run: true, target_device_id: "device-1", isolation: "workspace", base_commit: "" });
    expect(automationSource).toContain("setDispatchPreview(undefined)");
    expect(automationSource).toContain("disabled={!workspaceReady || !canDispatch || !hasCurrentDispatchPreview}");
  });

  it("opens runs from nested delivery or direct run dispatch responses", () => {
    const run: HermesEntity = { id: "run-1", kind: "runs", version: 1, status: "planned", data: { title: "Run" }, created_at: "c", updated_at: "u" };
    const delivery: HermesApiResponse<unknown> = { ok: true, items: [{ id: "delivery-1", task: { id: "task-1" }, run }] };
    const direct: HermesApiResponse<unknown> = { ok: true, items: [run] };
    expect(extractDeliveryRun(delivery)?.id).toBe("run-1");
    expect(extractDeliveryRun(direct)?.id).toBe("run-1");
    expect(extractDeliveryRun({ ok: true, items: [{ ...run, kind: "run" }] })).toBeUndefined();
  });

  it("renders schedule history as an operable run table before raw evidence", () => {
    const run: HermesEntity = { id: "run-1", kind: "runs", version: 1, status: "completed", data: { title: "Scheduled run" }, created_at: "2026-09-08T09:00:00Z", updated_at: "u" };
    const nested: HermesApiResponse<unknown> = { ok: true, items: [{ id: "delivery-1", run }] };
    const direct: HermesApiResponse<unknown> = { ok: true, items: [run] };
    expect(extractHistoryRuns(nested).map((item) => item.id)).toEqual(["run-1"]);
    expect(extractHistoryRuns(direct).map((item) => item.id)).toEqual(["run-1"]);
    expect(extractHistoryRuns({ ok: true, items: [{ ...run, kind: "run" }] })).toEqual([]);
    expect(automationSource).toContain('variant: "scheduleHistory"');
    expect(automationSource).toContain("workspace.automation.scheduleRuns");
    expect(automationSource).toContain("dataSource={resultHistoryRuns}");
    expect(automationSource).toContain("closeResult(); onOpenRun(row);");
  });

  it("keeps schedule and history tables horizontally stable on narrow viewports", () => {
    expect(automationSource).toContain('width: 240, ellipsis: true, render: (_, row) => <Button type="link" className="max-w-full overflow-hidden text-ellipsis px-0"');
    expect(automationSource).toContain('title: t("workspace.automation.interval"), width: 100');
    expect(automationSource).toContain("scroll={{ x: 1100 }}");
    expect(automationSource).toContain('title: t("workspace.columns.created"), dataIndex: "created_at", width: 170');
    expect(automationSource).toContain("scroll={{ x: 700 }}");
  });

  it("keeps automation metrics compact enough for mobile first-row table visibility", () => {
    expect(automationSource).toContain("function CompactMetric");
    expect(automationSource).toContain('className="mb-2"');
    expect(automationSource).toContain("<Col xs={6}>");
    expect(automationSource).toContain('className="text-xl font-semibold leading-5"');
    expect(automationSource).not.toContain("<Statistic");
  });
});
