import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import {
  Bot,
  CalendarClock,
  ClipboardList,
  MonitorSmartphone,
  Play,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import {
  HermesUnavailableError,
  type HermesAgentCatalogTemplate,
  type HermesAgentProfileData,
  type HermesAgentProvider,
  type HermesClient,
  type HermesDelivery,
  type HermesEntity,
  type HermesSquadData,
  type HermesSquadMember,
  type HermesRunNode,
  type HermesScheduleNode,
  type HermesScheduleConfigureBody,
  type HermesTaskAgentDispatchBody,
  type HermesApiResponse,
} from "../lib/hermes";

type AutomationTab =
  | "agents"
  | "squads"
  | "schedules"
  | "devices"
  | "dispatch"
  | "history";
type DrawerState =
  | { kind: "agent"; entity?: HermesEntity<HermesAgentProfileData> }
  | { kind: "squad"; entity?: HermesEntity<HermesSquadData> }
  | { kind: "schedule"; entity?: HermesEntity }
  | { kind: "device"; entity?: HermesEntity };

type AgentFormValues = HermesAgentProfileData;
type SquadFormValues = { title: string; members: HermesSquadMember[] };
type ScheduleFormValues = {
  schedule_id?: string;
  title: string;
  trigger_type: "interval" | "cron" | "webhook";
  interval_seconds?: number;
  starts_at?: string;
  cron_expression?: string;
  timezone?: string;
  secret_ref?: string;
  max_body_bytes?: number;
  enabled: boolean;
  misfire_coalesce: boolean;
  nodes: Array<{
    id: string;
    title: string;
    kind: "command" | "agent";
    argvText?: string;
    agent_id?: string;
    prompt?: string;
    expected_exit_code?: number;
    timeout_seconds: number;
  }>;
};
type DeviceFormValues = { title: string; name: string; platform: string };
type DispatchFormValues = {
  task_id: string;
  target_kind: "agent" | "squad" | "remote-command" | "remote-agent";
  target_id?: string;
  target_device_id?: string;
  command_id?: string;
  command_title?: string;
  argvText?: string;
  expected_exit_code?: number;
  timeout_seconds?: number;
  prompt: string;
  isolation: "workspace" | "git_worktree";
  base_commit: string;
};
type RemoteCommandDispatchBody = {
  expected_version: number;
  idempotency_key: string;
  dry_run: boolean;
  nodes: HermesRunNode[];
  isolation: "workspace";
  base_commit: "";
  target_device_id: string;
};
type DispatchDraft = {
  taskId: string;
  fingerprint: string;
  idempotencyKey: string;
  targetKind: DispatchFormValues["target_kind"];
  body: HermesTaskAgentDispatchBody | RemoteCommandDispatchBody;
};
type DispatchPreviewState = {
  fingerprint: string;
  idempotencyKey: string;
  response: HermesApiResponse<unknown>;
};
type DispatchDraftMessages = {
  taskRequired: string;
  deviceRequired: string;
  targetRequired: string;
  invalidArgv: string;
};
type ScheduleConfigureDraft = {
  scheduleId: string;
  drawerKey: string;
  fingerprint: string;
  body: HermesScheduleConfigureBody;
};
export type SchedulePreviewState = {
  drawerKey: string;
  fingerprint: string;
  idempotencyKey: string;
  response: HermesApiResponse<unknown>;
};
type PairingSecretState = {
  secret: string;
  deviceId?: string;
  expiresAt?: string;
};
type ResultState = {
  title: string;
  response: HermesApiResponse<unknown>;
  variant?: "scheduleHistory";
};
type PairingPublicData = Record<string, unknown> & {
  pairing_secret?: string;
  pairing_expires_at?: number;
};

const DEFAULT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const AUTOMATION_TABS: AutomationTab[] = [
  "agents",
  "squads",
  "schedules",
  "devices",
  "dispatch",
  "history",
];
const PROVIDERS: HermesAgentProvider[] = ["codex", "claude", "opencode"];
const SQUAD_ROLES: HermesSquadMember["role"][] = [
  "leader",
  "implementer",
  "reviewer",
];

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function entityTitle(entity: HermesEntity) {
  return String(entity.data?.title || entity.data?.name || entity.id);
}

function shortJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function firstPairingItem(
  response: HermesApiResponse<unknown>,
): HermesEntity<PairingPublicData> | undefined {
  const item = response.items[0];
  if (!item || typeof item !== "object") return undefined;
  const entity = item as Partial<HermesEntity<PairingPublicData>>;
  if (
    typeof entity.id !== "string" ||
    !entity.data ||
    typeof entity.data !== "object"
  )
    return undefined;
  return entity as HermesEntity<PairingPublicData>;
}

export function redactPairingSecrets(
  response: HermesApiResponse<unknown>,
): HermesApiResponse<unknown> {
  const item = firstPairingItem(response);
  if (!item || typeof item.data.pairing_secret !== "string") return response;
  return {
    ...response,
    items: response.items.map((candidate, index) =>
      index === 0
        ? { ...item, data: { ...item.data, pairing_secret: "[redacted]" } }
        : candidate,
    ),
  };
}

export function extractPairingSecret(
  response: HermesApiResponse<unknown>,
): PairingSecretState | undefined {
  const item = firstPairingItem(response);
  const secret = item?.data.pairing_secret;
  if (!secret) return undefined;
  const expiry = item.data.pairing_expires_at;
  return {
    secret,
    deviceId: item.id,
    expiresAt:
      typeof expiry === "number"
        ? new Date(expiry * 1000).toISOString()
        : undefined,
  };
}

export function extractDeliveryRun(
  response: HermesApiResponse<unknown>,
): HermesEntity | undefined {
  const first = response.items[0];
  if (!first || typeof first !== "object") return undefined;
  const record = first as Partial<HermesDelivery & HermesEntity>;
  if (
    record.run &&
    typeof record.run === "object" &&
    typeof record.run.id === "string"
  )
    return record.run;
  if (record.kind === "runs" && typeof record.id === "string")
    return record as HermesEntity;
  return undefined;
}

export function extractHistoryRuns(
  response: HermesApiResponse<unknown>,
): HermesEntity[] {
  return response.items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<HermesDelivery & HermesEntity>;
    if (
      record.run &&
      typeof record.run === "object" &&
      typeof record.run.id === "string"
    )
      return [record.run];
    if (record.kind === "runs" && typeof record.id === "string")
      return [record as HermesEntity];
    return [];
  });
}

function readableTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function localAndUtcTime(value?: string) {
  if (!value) return "-";
  return `${readableTime(value)} / ${new Date(value).toISOString()}`;
}

function scheduleTrigger(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const trigger = data.trigger;
  if (trigger && typeof trigger === "object" && !Array.isArray(trigger))
    return trigger as Record<string, unknown>;
  if (
    typeof data.interval_seconds === "number" ||
    typeof data.starts_at === "string"
  ) {
    return {
      type: "interval",
      interval_seconds: data.interval_seconds,
      starts_at: data.starts_at,
    };
  }
  return { type: "interval" };
}

function scheduleTriggerLabel(
  entity: HermesEntity,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const trigger = scheduleTrigger(entity.data);
  const type = String(trigger.type || "interval");
  if (type === "cron")
    return `${t("workspace.automation.triggerTypes.cron")} · ${String(trigger.cron_expression || "-")} · ${String(trigger.timezone || "UTC")}`;
  if (type === "webhook")
    return `${t("workspace.automation.triggerTypes.webhook")} · ${String(trigger.secret_ref || "-")}`;
  return `${t("workspace.automation.triggerTypes.interval")} · ${String(trigger.interval_seconds || "-")}s`;
}

function scheduleNextRuns(response?: HermesApiResponse<unknown>): string[] {
  const value = response?.summary?.next_runs;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function runtimeCapabilities(device: HermesEntity) {
  const raw = device.data.runtime_capabilities;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function runtimeSupports(device: HermesEntity, kind: "command" | "agent") {
  const capabilities = runtimeCapabilities(device);
  const candidates = [
    capabilities.node_kinds,
    capabilities.supported_node_kinds,
    capabilities.runtimes,
    capabilities.supported_runtimes,
    capabilities.runtime_capabilities,
  ];
  return candidates.some(
    (candidate) =>
      Array.isArray(candidate) && candidate.map(String).includes(kind),
  );
}

function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const err =
    error instanceof HermesUnavailableError
      ? error
      : new HermesUnavailableError(
          error instanceof Error ? error.message : String(error),
        );
  const title =
    err.status === 401 || err.status === 403
      ? t("workspace.authError")
      : err.status && err.status >= 400
        ? t("workspace.actionFailed")
        : t("workspace.offlineError");
  return (
    <Alert
      className="mb-3"
      type={err.status === 401 || err.status === 403 ? "warning" : "error"}
      showIcon
      title={title}
      description={[err.message, err.traceId ? `trace_id=${err.traceId}` : ""]
        .filter(Boolean)
        .join(" · ")}
    />
  );
}

function StatusTag({ status }: { status?: string }) {
  const { t } = useTranslation();
  const color =
    status === "failed" || status === "revoked"
      ? "red"
      : status === "archived"
        ? "default"
        : status === "active"
          ? "green"
          : "blue";
  return (
    <Tag color={color}>
      {status
        ? t(`workspace.statuses.${status}`, { defaultValue: status })
        : "-"}
    </Tag>
  );
}

function CompactMetric({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2 py-1">
      <span className="shrink-0 text-[var(--muted)]">{icon}</span>
      <div className="min-w-0 leading-none">
        <div className="text-xl font-semibold leading-5">{value}</div>
        <div className="truncate text-xs leading-4 text-[var(--muted)]">
          {title}
        </div>
      </div>
    </div>
  );
}

function agentInitial(
  entity?: HermesEntity<HermesAgentProfileData>,
): AgentFormValues {
  return {
    title: String(entity?.data.title || ""),
    provider: entity?.data.provider || "codex",
    model: String(entity?.data.model || ""),
    instructions: String(entity?.data.instructions || ""),
    timeout_seconds: Number(entity?.data.timeout_seconds || 300),
  };
}

function squadInitial(entity?: HermesEntity<HermesSquadData>): SquadFormValues {
  return {
    title: String(entity?.data.title || ""),
    members: entity?.data.members?.length
      ? entity.data.members
      : [{ agent_id: "", role: "leader", instructions: "" }],
  };
}

function scheduleInitial(entity?: HermesEntity): ScheduleFormValues {
  const data = entity?.data || {};
  const trigger = scheduleTrigger(data);
  const triggerType = ["cron", "webhook"].includes(String(trigger.type))
    ? (String(trigger.type) as ScheduleFormValues["trigger_type"])
    : "interval";
  const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  return {
    schedule_id: entity?.id || "",
    title: String(data.title || ""),
    trigger_type: triggerType,
    interval_seconds: Number(trigger.interval_seconds || 3600),
    starts_at: String(trigger.starts_at || new Date().toISOString()),
    cron_expression: String(trigger.cron_expression || "0 9 * * 1-5"),
    timezone: String(trigger.timezone || DEFAULT_TIMEZONE),
    secret_ref: String(trigger.secret_ref || "HERMES_WEBHOOK_SECRET"),
    max_body_bytes: Number(trigger.max_body_bytes || 65536),
    enabled: data.enabled !== false,
    misfire_coalesce: data.misfire_coalesce !== false,
    nodes: rawNodes.length
      ? rawNodes.map((node, index) => {
          const record =
            node && typeof node === "object"
              ? (node as Record<string, unknown>)
              : {};
          const argv = Array.isArray(record.argv)
            ? record.argv.map(String)
            : [];
          const kind = record.kind === "agent" ? "agent" : "command";
          return {
            id: String(record.id || `step-${index + 1}`),
            title: String(record.title || `Step ${index + 1}`),
            kind,
            argvText: argv.join("\n"),
            agent_id:
              typeof record.agent_id === "string" ? record.agent_id : "",
            prompt: typeof record.prompt === "string" ? record.prompt : "",
            expected_exit_code: Number(record.expected_exit_code || 0),
            timeout_seconds: Number(record.timeout_seconds || 300),
          };
        })
      : [
          {
            id: "step-1",
            title: "Health check",
            kind: "command",
            argvText: "pwd",
            expected_exit_code: 0,
            timeout_seconds: 300,
          },
        ],
  };
}

function deviceInitial(entity?: HermesEntity): DeviceFormValues {
  const data = entity?.data || {};
  return {
    title: String(data.title || data.name || ""),
    name: String(data.name || ""),
    platform: String(data.platform || ""),
  };
}

function hasExactlyOneLeader(members: HermesSquadMember[] = []) {
  return members.filter((member) => member.role === "leader").length === 1;
}

function buildScheduleNodes(values: ScheduleFormValues): HermesScheduleNode[] {
  return values.nodes.map((node) => ({
    id: node.id.trim(),
    title: node.title.trim(),
    ...(node.kind === "agent"
      ? {
          kind: "agent" as const,
          agent_id: String(node.agent_id || "").trim(),
          prompt: String(node.prompt || "").trim(),
        }
      : {
          kind: "command" as const,
          argv: String(node.argvText || "")
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          expected_exit_code: Number(node.expected_exit_code || 0),
        }),
    timeout_seconds: Number(node.timeout_seconds || 300),
  }));
}

function scheduleDrawerKey(entity?: HermesEntity) {
  return entity ? `${entity.id}:${entity.version}` : "new";
}

export function buildScheduleConfigureDraft(
  values: ScheduleFormValues,
  entity: HermesEntity | undefined,
  idempotencyKeyValue: string,
  dryRun: boolean,
): ScheduleConfigureDraft {
  const scheduleId = entity?.id || values.schedule_id?.trim() || "";
  const trigger = (() => {
    if (values.trigger_type === "cron") {
      return {
        type: "cron" as const,
        cron_expression: String(values.cron_expression || "").trim(),
        timezone: String(values.timezone || "UTC").trim(),
        ...(String(values.starts_at || "").trim()
          ? { starts_at: String(values.starts_at || "").trim() }
          : {}),
      };
    }
    if (values.trigger_type === "webhook") {
      return {
        type: "webhook" as const,
        secret_ref: String(values.secret_ref || "").trim(),
        max_body_bytes: Number(values.max_body_bytes || 65536),
      };
    }
    return {
      type: "interval" as const,
      interval_seconds: Number(values.interval_seconds || 0),
      starts_at: String(values.starts_at || "").trim(),
    };
  })();
  const body: HermesScheduleConfigureBody = {
    title: values.title.trim(),
    trigger,
    nodes: buildScheduleNodes(values),
    enabled: values.enabled,
    misfire_coalesce: values.misfire_coalesce,
    idempotency_key: idempotencyKeyValue,
    dry_run: dryRun,
  };
  if (entity) body.expected_version = entity.version;
  const fingerprint = JSON.stringify({
    scheduleId,
    title: body.title,
    trigger: body.trigger,
    nodes: body.nodes,
    enabled: body.enabled,
    misfire_coalesce: body.misfire_coalesce,
    expected_version: body.expected_version,
  });
  return {
    scheduleId,
    drawerKey: scheduleDrawerKey(entity),
    fingerprint,
    body,
  };
}

export function isSchedulePreviewCurrent(
  preview: SchedulePreviewState | undefined,
  draft: ScheduleConfigureDraft,
) {
  return Boolean(
    preview &&
    preview.drawerKey === draft.drawerKey &&
    preview.fingerprint === draft.fingerprint &&
    preview.idempotencyKey === draft.body.idempotency_key,
  );
}

export function buildDispatchDraft(
  values: DispatchFormValues,
  tasks: HermesEntity[],
  agents: HermesEntity<HermesAgentProfileData>[],
  squads: HermesEntity<HermesSquadData>[],
  devices: HermesEntity[],
  idempotencyKeyValue: string,
  dryRun: boolean,
  messages: DispatchDraftMessages = {
    taskRequired: "Select a task first.",
    deviceRequired: "Select an active paired device.",
    targetRequired:
      "Select a current agent or squad row so target_version can be sent.",
    invalidArgv: "Invalid command arguments.",
  },
): DispatchDraft {
  const task = tasks.find((item) => item.id === values.task_id);
  if (!task) throw new Error(messages.taskRequired);
  if (values.target_kind === "remote-command") {
    const device = devices.find(
      (item) =>
        item.id === values.target_device_id &&
        ["paired", "active"].includes(item.status),
    );
    if (!device) throw new Error(messages.deviceRequired);
    const node: HermesRunNode = {
      id: String(values.command_id || "remote-command").trim(),
      title: String(
        values.command_title || values.command_id || "Remote command",
      ).trim(),
      kind: "command",
      argv: String(values.argvText || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      expected_exit_code: Number(values.expected_exit_code || 0),
      timeout_seconds: Number(values.timeout_seconds || 300),
    };
    if (!node.id || !node.title || !node.argv.length)
      throw new Error(messages.invalidArgv);
    const body: RemoteCommandDispatchBody = {
      expected_version: task.version,
      idempotency_key: idempotencyKeyValue,
      dry_run: dryRun,
      nodes: [node],
      isolation: "workspace",
      base_commit: "",
      target_device_id: device.id,
    };
    return {
      taskId: task.id,
      fingerprint: JSON.stringify({
        taskId: task.id,
        body: { ...body, dry_run: undefined, idempotency_key: undefined },
      }),
      idempotencyKey: idempotencyKeyValue,
      targetKind: values.target_kind,
      body,
    };
  }
  if (values.target_kind === "remote-agent") {
    const device = devices.find(
      (item) =>
        item.id === values.target_device_id &&
        ["paired", "active"].includes(item.status) &&
        runtimeSupports(item, "agent"),
    );
    if (!device) throw new Error(messages.deviceRequired);
    const agent = agents.find((item) => item.id === values.target_id);
    if (!agent) throw new Error(messages.targetRequired);
    const body: HermesTaskAgentDispatchBody = {
      expected_version: task.version,
      target_version: agent.version,
      idempotency_key: idempotencyKeyValue,
      dry_run: dryRun,
      agent_id: agent.id,
      target_device_id: device.id,
      prompt: values.prompt.trim(),
      isolation: "workspace",
      base_commit: "",
    };
    return {
      taskId: task.id,
      fingerprint: JSON.stringify({
        taskId: task.id,
        body: { ...body, dry_run: undefined, idempotency_key: undefined },
      }),
      idempotencyKey: idempotencyKeyValue,
      targetKind: values.target_kind,
      body,
    };
  }
  const agent =
    values.target_kind === "agent"
      ? agents.find((item) => item.id === values.target_id)
      : undefined;
  const squad =
    values.target_kind === "squad"
      ? squads.find((item) => item.id === values.target_id)
      : undefined;
  const targetVersion = agent?.version || squad?.version;
  if (!targetVersion) throw new Error(messages.targetRequired);
  const target = agent
    ? { agent_id: agent.id, squad_id: undefined }
    : { squad_id: squad?.id, agent_id: undefined };
  const body: HermesTaskAgentDispatchBody = {
    expected_version: task.version,
    target_version: targetVersion,
    idempotency_key: idempotencyKeyValue,
    dry_run: dryRun,
    ...target,
    prompt: values.prompt.trim(),
    isolation: values.isolation,
    base_commit: values.base_commit.trim(),
  };
  return {
    taskId: task.id,
    fingerprint: JSON.stringify({
      taskId: task.id,
      body: { ...body, dry_run: undefined, idempotency_key: undefined },
    }),
    idempotencyKey: idempotencyKeyValue,
    targetKind: values.target_kind,
    body,
  };
}

export function isDispatchPreviewCurrent(
  preview: DispatchPreviewState | undefined,
  draft: DispatchDraft,
) {
  return Boolean(
    preview &&
    preview.fingerprint === draft.fingerprint &&
    preview.idempotencyKey === draft.idempotencyKey,
  );
}

export function scheduleActionDisabled(
  action: "trigger" | "pause" | "resume",
  status: string,
  permissions: {
    canConfig: boolean;
    canExecute: boolean;
    canConfigureSchedule: boolean;
  },
) {
  if (status === "archived") return true;
  if (action === "trigger") return !permissions.canExecute;
  if (action === "pause") return !permissions.canConfig || status !== "active";
  return !permissions.canConfigureSchedule || status !== "paused";
}

function isVersionConflict(error: unknown) {
  return error instanceof HermesUnavailableError && error.status === 409;
}

export function AutomationPanel({
  client,
  workspaceReady,
  connected,
  permissions,
  scopeKey,
  onOpenRun,
}: {
  client: HermesClient;
  workspaceReady: boolean;
  connected: boolean;
  permissions: Set<string>;
  scopeKey: string;
  onOpenRun: (run: HermesEntity) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AutomationTab>("agents");
  const [drawer, setDrawer] = useState<DrawerState>();
  const [result, setResult] = useState<ResultState>();
  const [pairingSecret, setPairingSecret] = useState<PairingSecretState>();
  const [schedulePreview, setSchedulePreview] =
    useState<SchedulePreviewState>();
  const [scheduleIdempotencyKey, setScheduleIdempotencyKey] = useState(() =>
    idempotencyKey("schedule-configure"),
  );
  const [dispatchPreview, setDispatchPreview] =
    useState<DispatchPreviewState>();
  const [dispatchIdempotencyKey, setDispatchIdempotencyKey] = useState(() =>
    idempotencyKey("agent-dispatch"),
  );
  const [agentForm] = Form.useForm<AgentFormValues>();
  const [squadForm] = Form.useForm<SquadFormValues>();
  const [scheduleForm] = Form.useForm<ScheduleFormValues>();
  const [deviceForm] = Form.useForm<DeviceFormValues>();
  const [dispatchForm] = Form.useForm<DispatchFormValues>();
  const canRead = permissions.has("read");
  const canWrite = permissions.has("write");
  const canConfig = permissions.has("config");
  const canExecute = permissions.has("execute");
  const canDispatch = canWrite && canExecute;
  const canConfigureSchedule = canConfig && canExecute;
  const resourceEnabled = workspaceReady && canRead;

  useEffect(() => {
    setDrawer(undefined);
    setResult(undefined);
    setPairingSecret(undefined);
    setSchedulePreview(undefined);
    setScheduleIdempotencyKey(idempotencyKey("schedule-configure"));
    setDispatchPreview(undefined);
    setDispatchIdempotencyKey(idempotencyKey("agent-dispatch"));
    agentForm.resetFields();
    squadForm.resetFields();
    scheduleForm.resetFields();
    deviceForm.resetFields();
    dispatchForm.resetFields();
  }, [
    scopeKey,
    connected,
    agentForm,
    squadForm,
    scheduleForm,
    deviceForm,
    dispatchForm,
  ]);

  const agentsQuery = useQuery({
    queryKey: ["hermes-automation-agents", scopeKey],
    queryFn: () => client.agents({ limit: 50 }),
    enabled: resourceEnabled,
    retry: false,
  });
  const squadsQuery = useQuery({
    queryKey: ["hermes-automation-squads", scopeKey],
    queryFn: () => client.squads({ limit: 50 }),
    enabled: resourceEnabled,
    retry: false,
  });
  const catalogQuery = useQuery({
    queryKey: ["hermes-agent-catalog", scopeKey],
    queryFn: () => client.agentCatalog(),
    enabled: connected && canRead,
    retry: false,
  });
  const schedulesQuery = useQuery({
    queryKey: ["hermes-automation-schedules", scopeKey],
    queryFn: () => client.listAutomationResource("schedules", { limit: 50 }),
    enabled: resourceEnabled,
    retry: false,
    refetchInterval: resourceEnabled ? 5000 : false,
    refetchIntervalInBackground: true,
  });
  const devicesQuery = useQuery({
    queryKey: ["hermes-automation-devices", scopeKey],
    queryFn: () => client.listAutomationResource("devices", { limit: 50 }),
    enabled: resourceEnabled,
    retry: false,
  });
  const tasksQuery = useQuery({
    queryKey: ["hermes-automation-tasks", scopeKey],
    queryFn: () => client.list("tasks", { limit: 50 }),
    enabled: resourceEnabled,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: ["hermes-automation-history", scopeKey],
    queryFn: () => client.sync(0),
    enabled: resourceEnabled && tab === "history",
    retry: false,
  });

  const agents = agentsQuery.data?.items || [];
  const squads = squadsQuery.data?.items || [];
  const schedules = schedulesQuery.data?.items || [];
  const devices = devicesQuery.data?.items || [];
  const tasks = tasksQuery.data?.items || [];

  const agentOptions = agents.map((agent) => ({
    value: agent.id,
    label: `${entityTitle(agent)} · ${agent.data.provider || "-"}`,
  }));
  const squadOptions = squads.map((squad) => ({
    value: squad.id,
    label: `${entityTitle(squad)} · ${squad.data.members?.length || 0}`,
  }));
  const taskOptions = tasks.map((task) => ({
    value: task.id,
    label: `${entityTitle(task)} · v${task.version}`,
  }));
  const pairedDeviceOptions = devices
    .filter((device) => ["paired", "active"].includes(device.status))
    .map((device) => ({
      value: device.id,
      label: `${entityTitle(device)} · ${runtimeSupports(device, "command") ? "command" : t("workspace.automation.capabilityUnknown")}`,
    }));
  const remoteAgentDeviceOptions = devices
    .filter((device) => ["paired", "active"].includes(device.status))
    .map((device) => ({
      value: device.id,
      label: `${entityTitle(device)} · ${runtimeSupports(device, "agent") ? "agent" : t("workspace.automation.unsupported")}`,
      disabled: !runtimeSupports(device, "agent"),
    }));
  const hasRemoteAgentRuntime = devices.some(
    (device) =>
      ["paired", "active"].includes(device.status) &&
      runtimeSupports(device, "agent"),
  );

  const invalidateAutomation = () => {
    queryClient.invalidateQueries({ queryKey: ["hermes-automation-agents"] });
    queryClient.invalidateQueries({ queryKey: ["hermes-automation-squads"] });
    queryClient.invalidateQueries({
      queryKey: ["hermes-automation-schedules"],
    });
    queryClient.invalidateQueries({ queryKey: ["hermes-automation-devices"] });
    queryClient.invalidateQueries({ queryKey: ["hermes-automation-history"] });
  };

  const saveAgent = useMutation({
    mutationFn: (values: AgentFormValues) => {
      const data: HermesAgentProfileData = {
        title: values.title.trim(),
        provider: values.provider,
        model: values.model.trim(),
        instructions: values.instructions.trim(),
        timeout_seconds: Number(values.timeout_seconds || 300),
      };
      if (drawer?.kind === "agent" && drawer.entity) {
        return client.patchAutomationResource("agents", drawer.entity.id, {
          data,
          expected_version: drawer.entity.version,
          idempotency_key: idempotencyKey("agent-profile"),
        });
      }
      return client.createAutomationResource("agents", {
        data,
        idempotency_key: idempotencyKey("agent-profile"),
      });
    },
    onSuccess: () => {
      setDrawer(undefined);
      agentForm.resetFields();
      invalidateAutomation();
      message.success(t("workspace.automation.saved"));
    },
  });

  const archiveProfile = useMutation({
    mutationFn: ({
      kind,
      entity,
    }: {
      kind: "agents" | "squads";
      entity: HermesEntity;
    }) =>
      client.patchAutomationResource(kind, entity.id, {
        data: { status: "archived" },
        expected_version: entity.version,
        idempotency_key: idempotencyKey(`${kind}-archive`),
      }),
    onSuccess: () => {
      invalidateAutomation();
      message.success(t("workspace.actionSent"));
    },
  });

  const saveSquad = useMutation({
    mutationFn: (values: SquadFormValues) => {
      if (!hasExactlyOneLeader(values.members))
        throw new Error(t("workspace.automation.oneLeader"));
      const data: HermesSquadData = {
        title: values.title.trim(),
        members: values.members.map((member) => ({
          agent_id: member.agent_id,
          role: member.role,
          instructions: member.instructions?.trim() || "",
        })),
      };
      if (drawer?.kind === "squad" && drawer.entity) {
        return client.patchAutomationResource("squads", drawer.entity.id, {
          data,
          expected_version: drawer.entity.version,
          idempotency_key: idempotencyKey("squad"),
        });
      }
      return client.createAutomationResource("squads", {
        data,
        idempotency_key: idempotencyKey("squad"),
      });
    },
    onSuccess: () => {
      setDrawer(undefined);
      squadForm.resetFields();
      invalidateAutomation();
      message.success(t("workspace.automation.saved"));
    },
  });

  const configureSchedule = useMutation({
    mutationFn: ({
      draft,
      dryRun,
    }: {
      draft: ScheduleConfigureDraft;
      dryRun: boolean;
    }) =>
      dryRun
        ? client.schedulePreview(draft.body, 5)
        : client.scheduleConfigure(draft.scheduleId, draft.body),
    onSuccess: (response, variables) => {
      if (variables.dryRun) {
        setSchedulePreview({
          drawerKey: variables.draft.drawerKey,
          fingerprint: variables.draft.fingerprint,
          idempotencyKey: variables.draft.body.idempotency_key,
          response,
        });
        return;
      }
      setDrawer(undefined);
      scheduleForm.resetFields();
      setSchedulePreview(undefined);
      setScheduleIdempotencyKey(idempotencyKey("schedule-configure"));
      invalidateAutomation();
      message.success(t("workspace.automation.saved"));
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        setSchedulePreview(undefined);
        setScheduleIdempotencyKey(idempotencyKey("schedule-configure"));
        invalidateAutomation();
      }
    },
  });

  const saveAutomationResource = useMutation({
    mutationFn: ({ values }: { values: DeviceFormValues }) => {
      if (!drawer) throw new Error("No automation drawer");
      if (drawer.kind !== "device")
        throw new Error("Unsupported automation resource");
      const deviceValues = values as DeviceFormValues;
      const data = {
        title: deviceValues.title.trim(),
        name: deviceValues.name.trim(),
        platform: deviceValues.platform.trim(),
      };
      if (drawer.entity)
        throw new Error(t("workspace.automation.deviceImmutable"));
      return client.createAutomationResource("devices", {
        data,
        idempotency_key: idempotencyKey("devices"),
      });
    },
    onSuccess: () => {
      setDrawer(undefined);
      scheduleForm.resetFields();
      deviceForm.resetFields();
      invalidateAutomation();
      message.success(t("workspace.automation.saved"));
    },
  });

  const submitScheduleConfigure = async (dryRun: boolean) => {
    try {
      const values = await scheduleForm.validateFields();
      const entity = drawer?.kind === "schedule" ? drawer.entity : undefined;
      const draft = buildScheduleConfigureDraft(
        values,
        entity,
        scheduleIdempotencyKey,
        dryRun,
      );
      if (!draft.scheduleId)
        throw new Error(t("workspace.automation.scheduleIdRequired"));
      if (
        draft.body.trigger?.type === "cron" &&
        (!draft.body.trigger.cron_expression || !draft.body.trigger.timezone)
      )
        throw new Error(t("workspace.automation.cronRequired"));
      if (
        draft.body.trigger?.type === "webhook" &&
        !draft.body.trigger.secret_ref
      )
        throw new Error(t("workspace.automation.secretRefRequired"));
      if (
        !draft.body.nodes.length ||
        draft.body.nodes.some(
          (node) =>
            !node.id ||
            !node.title ||
            (node.kind === "command" && !node.argv.length) ||
            (node.kind === "agent" && (!node.agent_id || !node.prompt)),
        )
      )
        throw new Error(t("workspace.delivery.invalidArgv"));
      if (!dryRun && !isSchedulePreviewCurrent(schedulePreview, draft))
        throw new Error(t("workspace.automation.previewRequired"));
      configureSchedule.mutate({ draft, dryRun });
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  };

  const scheduleAction = useMutation({
    mutationFn: ({
      entity,
      action,
    }: {
      entity: HermesEntity;
      action: "trigger" | "pause" | "resume";
    }) =>
      client.scheduleAction(entity.id, action, {
        expected_version: entity.version,
        idempotency_key: idempotencyKey(`schedule-${action}`),
        dry_run: false,
      }),
    onSuccess: (response, variables) => {
      setResult({
        title: t(`workspace.automation.scheduleActions.${variables.action}`),
        response,
      });
      invalidateAutomation();
    },
    onError: (error) => {
      if (isVersionConflict(error)) invalidateAutomation();
    },
  });

  const scheduleWebhookTest = useMutation({
    mutationFn: (entity: HermesEntity) =>
      client.scheduleWebhookTest(entity.id, {
        expected_version: entity.version,
        idempotency_key: idempotencyKey("schedule-webhook-test"),
        dry_run: false,
      }),
    onSuccess: (response) => {
      setResult({ title: t("workspace.automation.webhookTest"), response });
      invalidateAutomation();
    },
    onError: (error) => {
      if (isVersionConflict(error)) invalidateAutomation();
    },
  });

  const loadScheduleHistory = useMutation({
    mutationFn: (entity: HermesEntity) => client.scheduleHistory(entity.id),
    onSuccess: (response) =>
      setResult({
        title: t("workspace.automation.scheduleHistory"),
        response,
        variant: "scheduleHistory",
      }),
  });

  const requestPairing = useMutation({
    mutationFn: ({
      entity,
      dryRun,
    }: {
      entity: HermesEntity;
      dryRun: boolean;
    }) =>
      client.devicePairing(entity.id, {
        expected_version: entity.version,
        idempotency_key: idempotencyKey("device-pairing"),
        dry_run: dryRun,
      }),
    onSuccess: (response, variables) => {
      setPairingSecret(
        variables.dryRun ? undefined : extractPairingSecret(response),
      );
      setResult({
        title: variables.dryRun
          ? t("workspace.automation.previewResult")
          : t("workspace.automation.pairingSecret"),
        response: redactPairingSecrets(response),
      });
      if (!variables.dryRun) invalidateAutomation();
    },
  });

  const revokeDevice = useMutation({
    mutationFn: ({
      entity,
      dryRun,
    }: {
      entity: HermesEntity;
      dryRun: boolean;
    }) =>
      client.deviceRevoke(entity.id, {
        expected_version: entity.version,
        idempotency_key: idempotencyKey("devices-revoke"),
        dry_run: dryRun,
      }),
    onSuccess: (response, variables) => {
      if (variables.dryRun)
        setResult({ title: t("workspace.automation.previewResult"), response });
      else {
        invalidateAutomation();
        message.success(t("workspace.actionSent"));
      }
    },
  });

  const dispatchTask = useMutation({
    mutationFn: ({
      draft,
      dryRun,
    }: {
      draft: DispatchDraft;
      dryRun: boolean;
    }) => {
      if (!dryRun && !isDispatchPreviewCurrent(dispatchPreview, draft))
        throw new Error(t("workspace.automation.previewRequired"));
      if (draft.targetKind === "remote-command")
        return client.taskDispatch(
          draft.taskId,
          draft.body as RemoteCommandDispatchBody,
        );
      return client.taskAgentDispatch(
        draft.taskId,
        draft.body as HermesTaskAgentDispatchBody,
      );
    },
    onSuccess: (response, variables) => {
      if (variables.dryRun) {
        setDispatchPreview({
          fingerprint: variables.draft.fingerprint,
          idempotencyKey: variables.draft.idempotencyKey,
          response,
        });
      } else {
        setDispatchPreview(undefined);
        setDispatchIdempotencyKey(idempotencyKey("agent-dispatch"));
      }
      setResult({
        title: variables.dryRun
          ? t("workspace.automation.previewResult")
          : t("workspace.automation.applyResult"),
        response,
      });
      const run = extractDeliveryRun(response);
      if (!variables.dryRun && run) onOpenRun(run);
      if (!variables.dryRun)
        queryClient.invalidateQueries({
          queryKey: ["hermes-automation-tasks"],
        });
    },
  });

  const submitDispatch = async (dryRun: boolean) => {
    try {
      const values = await dispatchForm.validateFields();
      const draft = buildDispatchDraft(
        values,
        tasks,
        agents,
        squads,
        devices,
        dispatchIdempotencyKey,
        dryRun,
        {
          taskRequired: t("workspace.automation.taskRequired"),
          deviceRequired: t("workspace.automation.deviceRequired"),
          targetRequired: t("workspace.automation.targetRequired"),
          invalidArgv: t("workspace.delivery.invalidArgv"),
        },
      );
      if (!dryRun && !isDispatchPreviewCurrent(dispatchPreview, draft))
        throw new Error(t("workspace.automation.previewRequired"));
      dispatchTask.mutate({ draft, dryRun });
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  };

  const openAgent = (entity?: HermesEntity<HermesAgentProfileData>) => {
    setDrawer({ kind: "agent", entity });
    agentForm.setFieldsValue(agentInitial(entity));
  };

  const openSquad = (entity?: HermesEntity<HermesSquadData>) => {
    setDrawer({ kind: "squad", entity });
    squadForm.setFieldsValue(squadInitial(entity));
  };

  const openSchedule = (entity?: HermesEntity) => {
    setDrawer({ kind: "schedule", entity });
    setSchedulePreview(undefined);
    setScheduleIdempotencyKey(idempotencyKey("schedule-configure"));
    scheduleForm.setFieldsValue(scheduleInitial(entity));
  };

  const openDevice = (entity?: HermesEntity) => {
    setDrawer({ kind: "device", entity });
    deviceForm.setFieldsValue(deviceInitial(entity));
  };

  const commonColumns = <T extends HermesEntity>(): ColumnsType<T> => [
    {
      title: t("workspace.columns.title"),
      width: 240,
      ellipsis: true,
      render: (_, row) => entityTitle(row),
    },
    {
      title: t("workspace.columns.status"),
      dataIndex: "status",
      width: 120,
      render: (status) => <StatusTag status={String(status || "")} />,
    },
    {
      title: t("workspace.columns.resourceVersion"),
      dataIndex: "version",
      width: 90,
      render: (version) => `v${version}`,
    },
    {
      title: t("workspace.columns.updated"),
      dataIndex: "updated_at",
      width: 170,
      render: (value) => readableTime(String(value || "")),
    },
  ];

  const error =
    agentsQuery.error ||
    squadsQuery.error ||
    catalogQuery.error ||
    schedulesQuery.error ||
    devicesQuery.error ||
    tasksQuery.error ||
    historyQuery.error ||
    saveAgent.error ||
    saveSquad.error ||
    archiveProfile.error ||
    configureSchedule.error ||
    saveAutomationResource.error ||
    requestPairing.error ||
    revokeDevice.error ||
    scheduleAction.error ||
    scheduleWebhookTest.error ||
    loadScheduleHistory.error ||
    dispatchTask.error;

  const emptyText = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t("workspace.automation.empty")}
    />
  );
  const targetKind = Form.useWatch("target_kind", dispatchForm) || "agent";
  const scheduleTriggerType =
    Form.useWatch("trigger_type", scheduleForm) || "interval";
  const scheduleNodes = Form.useWatch("nodes", scheduleForm) || [];
  const catalogItems = catalogQuery.data?.items || [];
  const activeScheduleDrawerKey =
    drawer?.kind === "schedule" ? scheduleDrawerKey(drawer.entity) : "";
  const hasCurrentSchedulePreview = Boolean(
    schedulePreview && schedulePreview.drawerKey === activeScheduleDrawerKey,
  );
  const hasCurrentDispatchPreview = Boolean(dispatchPreview);
  const resultHistoryRuns =
    result?.variant === "scheduleHistory"
      ? extractHistoryRuns(result.response)
      : [];
  const closeResult = () => {
    setResult(undefined);
    setPairingSecret(undefined);
  };

  return (
    <Card
      size="small"
      title={t("workspace.automation.title")}
      extra={
        <Button
          aria-label="automation-refresh"
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={invalidateAutomation}
        >
          {t("common.refresh")}
        </Button>
      }
    >
      {!connected ? (
        <Alert
          className="mb-3"
          type="info"
          showIcon
          title={t("workspace.connectHint")}
        />
      ) : null}
      {connected && !workspaceReady ? (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          title={t("workspace.workspaceRequired")}
        />
      ) : null}
      {workspaceReady && !canRead ? (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          title={t("workspace.automation.permissionReadOnly")}
        />
      ) : null}
      <ErrorAlert error={error} />

      <Row gutter={[6, 6]} className="mb-2">
        <Col xs={6}>
          <CompactMetric
            title={t("workspace.automation.metrics.agents")}
            value={agents.length}
            icon={<Bot className="h-4 w-4" />}
          />
        </Col>
        <Col xs={6}>
          <CompactMetric
            title={t("workspace.automation.metrics.squads")}
            value={squads.length}
            icon={<UsersRound className="h-4 w-4" />}
          />
        </Col>
        <Col xs={6}>
          <CompactMetric
            title={t("workspace.automation.metrics.schedules")}
            value={schedules.length}
            icon={<CalendarClock className="h-4 w-4" />}
          />
        </Col>
        <Col xs={6}>
          <CompactMetric
            title={t("workspace.automation.metrics.devices")}
            value={devices.length}
            icon={<MonitorSmartphone className="h-4 w-4" />}
          />
        </Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as AutomationTab)}
        items={AUTOMATION_TABS.map((key) => ({
          key,
          label: t(`workspace.automation.tabs.${key}`),
        }))}
      />

      {tab === "agents" ? (
        <Row gutter={[12, 12]}>
          <Col xs={24} xl={16}>
            <div className="mb-2 flex justify-end">
              <Button
                aria-label="automation-new-agent"
                type="primary"
                icon={<Bot className="h-4 w-4" />}
                disabled={!workspaceReady || !canConfig}
                onClick={() => openAgent()}
              >
                {t("workspace.automation.newAgent")}
              </Button>
            </div>
            <Table
              rowKey="id"
              size="small"
              loading={agentsQuery.isFetching}
              columns={[
                {
                  title: t("workspace.columns.title"),
                  render: (_, row: HermesEntity<HermesAgentProfileData>) => (
                    <Button type="link" onClick={() => openAgent(row)}>
                      {entityTitle(row)}
                    </Button>
                  ),
                },
                {
                  title: t("workspace.automation.provider"),
                  render: (_, row: HermesEntity<HermesAgentProfileData>) => (
                    <Tag>{row.data.provider}</Tag>
                  ),
                },
                {
                  title: t("workspace.automation.model"),
                  render: (_, row: HermesEntity<HermesAgentProfileData>) =>
                    row.data.model || "-",
                },
                ...commonColumns<HermesEntity<HermesAgentProfileData>>().slice(
                  1,
                ),
                {
                  title: t("workspace.columns.actions"),
                  width: 120,
                  render: (_, row: HermesEntity<HermesAgentProfileData>) => (
                    <Button
                      size="small"
                      danger
                      disabled={!canConfig || row.status === "archived"}
                      onClick={() =>
                        archiveProfile.mutate({ kind: "agents", entity: row })
                      }
                    >
                      {t("workspace.automation.archive")}
                    </Button>
                  ),
                },
              ]}
              dataSource={agents}
              locale={{ emptyText }}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              scroll={{ x: 760 }}
            />
          </Col>
          <Col xs={24} xl={8}>
            <Card size="small" title={t("workspace.automation.catalog")}>
              <Table
                rowKey="id"
                size="small"
                loading={catalogQuery.isFetching}
                pagination={false}
                dataSource={catalogItems}
                locale={{ emptyText }}
                columns={[
                  { title: t("workspace.columns.title"), dataIndex: "id" },
                  {
                    title: t("workspace.automation.provider"),
                    dataIndex: "provider",
                    render: (provider) => <Tag>{provider}</Tag>,
                  },
                  {
                    title: t("workspace.automation.readyToRun"),
                    render: (_, row: HermesAgentCatalogTemplate) => (
                      <Tag color={row.executable ? "green" : "orange"}>
                        {row.executable
                          ? t("workspace.automation.installed")
                          : t("workspace.automation.notInstalled")}
                      </Tag>
                    ),
                  },
                  {
                    title: t("workspace.automation.auth"),
                    render: (_, row: HermesAgentCatalogTemplate) =>
                      row.auth === "provider-managed"
                        ? t("workspace.automation.authCliManaged")
                        : t("workspace.automation.authUnverified"),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ) : null}

      {tab === "squads" ? (
        <>
          <div className="mb-2 flex justify-end">
            <Button
              aria-label="automation-new-squad"
              type="primary"
              icon={<UsersRound className="h-4 w-4" />}
              disabled={!workspaceReady || !canConfig || agents.length === 0}
              onClick={() => openSquad()}
            >
              {t("workspace.automation.newSquad")}
            </Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={squadsQuery.isFetching}
            columns={[
              {
                title: t("workspace.columns.title"),
                render: (_, row: HermesEntity<HermesSquadData>) => (
                  <Button type="link" onClick={() => openSquad(row)}>
                    {entityTitle(row)}
                  </Button>
                ),
              },
              {
                title: t("workspace.automation.members"),
                render: (_, row: HermesEntity<HermesSquadData>) =>
                  row.data.members
                    ?.map((member) => `${member.role}:${member.agent_id}`)
                    .join(", ") || "-",
              },
              ...commonColumns<HermesEntity<HermesSquadData>>().slice(1),
              {
                title: t("workspace.columns.actions"),
                width: 120,
                render: (_, row: HermesEntity<HermesSquadData>) => (
                  <Button
                    size="small"
                    danger
                    disabled={!canConfig || row.status === "archived"}
                    onClick={() =>
                      archiveProfile.mutate({ kind: "squads", entity: row })
                    }
                  >
                    {t("workspace.automation.archive")}
                  </Button>
                ),
              },
            ]}
            dataSource={squads}
            locale={{ emptyText }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 760 }}
          />
        </>
      ) : null}

      {tab === "schedules" ? (
        <>
          <div className="mb-2 flex justify-end">
            <Button
              aria-label="automation-new-schedule"
              type="primary"
              icon={<CalendarClock className="h-4 w-4" />}
              disabled={!workspaceReady || !canConfigureSchedule}
              onClick={() => openSchedule()}
            >
              {t("workspace.automation.newSchedule")}
            </Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={schedulesQuery.isLoading}
            columns={[
              {
                title: t("workspace.columns.title"),
                width: 240,
                ellipsis: true,
                render: (_, row) => (
                  <Button
                    type="link"
                    className="max-w-full overflow-hidden text-ellipsis px-0"
                    onClick={() => openSchedule(row)}
                  >
                    {entityTitle(row)}
                  </Button>
                ),
              },
              {
                title: t("workspace.automation.trigger"),
                width: 240,
                ellipsis: true,
                render: (_, row) => scheduleTriggerLabel(row, t),
              },
              {
                title: t("workspace.automation.nextRun"),
                width: 190,
                render: (_, row) =>
                  localAndUtcTime(String(row.data.next_due_at || "")),
              },
              ...commonColumns<HermesEntity>().slice(1),
              {
                title: t("workspace.columns.actions"),
                width: 360,
                render: (_, row) => {
                  const isActive = row.status === "active";
                  const isPaused = row.status === "paused";
                  const isArchived = row.status === "archived";
                  return (
                    <Space wrap>
                      <Button
                        aria-label={`automation-schedule-trigger-${row.id}`}
                        size="small"
                        disabled={
                          scheduleActionDisabled("trigger", row.status, {
                            canConfig,
                            canExecute,
                            canConfigureSchedule,
                          }) || isArchived
                        }
                        onClick={() =>
                          scheduleAction.mutate({
                            entity: row,
                            action: "trigger",
                          })
                        }
                      >
                        {t("workspace.automation.scheduleActions.trigger")}
                      </Button>
                      <Button
                        aria-label={`automation-schedule-pause-${row.id}`}
                        size="small"
                        disabled={
                          scheduleActionDisabled("pause", row.status, {
                            canConfig,
                            canExecute,
                            canConfigureSchedule,
                          }) ||
                          !isActive ||
                          isArchived
                        }
                        onClick={() =>
                          scheduleAction.mutate({
                            entity: row,
                            action: "pause",
                          })
                        }
                      >
                        {t("workspace.automation.scheduleActions.pause")}
                      </Button>
                      <Button
                        aria-label={`automation-schedule-resume-${row.id}`}
                        size="small"
                        disabled={
                          scheduleActionDisabled("resume", row.status, {
                            canConfig,
                            canExecute,
                            canConfigureSchedule,
                          }) ||
                          !isPaused ||
                          isArchived
                        }
                        onClick={() =>
                          scheduleAction.mutate({
                            entity: row,
                            action: "resume",
                          })
                        }
                      >
                        {t("workspace.automation.scheduleActions.resume")}
                      </Button>
                      {scheduleTrigger(row.data).type === "webhook" ? (
                        <Button
                          aria-label={`automation-schedule-webhook-test-${row.id}`}
                          size="small"
                          disabled={!canExecute || isArchived}
                          loading={scheduleWebhookTest.isPending}
                          onClick={() => scheduleWebhookTest.mutate(row)}
                        >
                          {t("workspace.automation.webhookTest")}
                        </Button>
                      ) : null}
                      <Button
                        aria-label={`automation-schedule-history-${row.id}`}
                        size="small"
                        onClick={() => loadScheduleHistory.mutate(row)}
                      >
                        {t("workspace.automation.scheduleHistory")}
                      </Button>
                    </Space>
                  );
                },
              },
            ]}
            dataSource={schedules}
            locale={{ emptyText }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 1240 }}
          />
        </>
      ) : null}

      {tab === "devices" ? (
        <>
          <div className="mb-2 flex justify-end">
            <Button
              aria-label="automation-new-device"
              type="primary"
              icon={<MonitorSmartphone className="h-4 w-4" />}
              disabled={!workspaceReady || !canConfig}
              onClick={() => openDevice()}
            >
              {t("workspace.automation.newDevice")}
            </Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={devicesQuery.isFetching}
            columns={[
              {
                title: t("workspace.columns.title"),
                render: (_, row) => (
                  <Button type="link" onClick={() => openDevice(row)}>
                    {entityTitle(row)}
                  </Button>
                ),
              },
              {
                title: t("workspace.automation.platform"),
                render: (_, row) => String(row.data.platform || "-"),
              },
              {
                title: t("workspace.automation.runtimeCapabilities"),
                width: 220,
                render: (_, row) => {
                  const capabilities = runtimeCapabilities(row);
                  const labels = ["command", "agent"].filter((kind) =>
                    runtimeSupports(row, kind as "command" | "agent"),
                  );
                  return labels.length ? (
                    <Space wrap>
                      {labels.map((label) => (
                        <Tag key={label} color="blue">
                          {label}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    <Tag>
                      {Object.keys(capabilities).length
                        ? t("workspace.automation.capabilityUnknown")
                        : t("workspace.automation.noRuntimeCapabilities")}
                    </Tag>
                  );
                },
              },
              ...commonColumns<HermesEntity>().slice(1),
              {
                title: t("workspace.columns.actions"),
                width: 280,
                render: (_, row) => {
                  const isRevoked = row.status === "revoked";
                  const tooltip = isRevoked
                    ? t("workspace.automation.revokedDeviceActions")
                    : "";
                  return (
                    <Space wrap>
                      <Tooltip title={tooltip}>
                        <span>
                          <Button
                            size="small"
                            disabled={!canConfig || !canExecute || isRevoked}
                            onClick={() =>
                              requestPairing.mutate({
                                entity: row,
                                dryRun: true,
                              })
                            }
                          >
                            {t("workspace.automation.preview")}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={tooltip}>
                        <span>
                          <Button
                            size="small"
                            disabled={!canConfig || !canExecute || isRevoked}
                            onClick={() =>
                              requestPairing.mutate({
                                entity: row,
                                dryRun: false,
                              })
                            }
                          >
                            {t("workspace.automation.pair")}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title={tooltip}>
                        <span>
                          <Button
                            size="small"
                            danger
                            disabled={!canConfig || isRevoked}
                            onClick={() =>
                              revokeDevice.mutate({
                                entity: row,
                                dryRun: false,
                              })
                            }
                          >
                            {t("workspace.automation.revoke")}
                          </Button>
                        </span>
                      </Tooltip>
                    </Space>
                  );
                },
              },
            ]}
            dataSource={devices}
            locale={{ emptyText }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            scroll={{ x: 1080 }}
          />
        </>
      ) : null}

      {tab === "dispatch" ? (
        <Card size="small" title={t("workspace.automation.dispatchTitle")}>
          {!canDispatch ? (
            <Alert
              className="mb-3"
              type="warning"
              showIcon
              title={t("workspace.delivery.permissionHint")}
            />
          ) : null}
          <Form
            form={dispatchForm}
            layout="vertical"
            initialValues={{
              target_kind: "agent",
              isolation: "workspace",
              base_commit: "",
            }}
            onValuesChange={() => {
              setDispatchPreview(undefined);
              setDispatchIdempotencyKey(idempotencyKey("agent-dispatch"));
            }}
          >
            <Row gutter={[12, 0]}>
              <Col xs={24} lg={8}>
                <Form.Item
                  name="task_id"
                  label={t("workspace.automation.task")}
                  rules={[{ required: true }]}
                >
                  <Select
                    aria-label="automation-dispatch-task"
                    showSearch
                    options={taskOptions}
                    loading={tasksQuery.isFetching}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={5}>
                <Form.Item
                  name="target_kind"
                  label={t("workspace.automation.target")}
                  rules={[{ required: true }]}
                >
                  <Select
                    aria-label="automation-dispatch-target-kind"
                    options={[
                      {
                        value: "agent",
                        label: t("workspace.automation.tabs.agents"),
                      },
                      {
                        value: "squad",
                        label: t("workspace.automation.tabs.squads"),
                      },
                      {
                        value: "remote-command",
                        label: t("workspace.automation.remoteCommand"),
                      },
                      {
                        value: "remote-agent",
                        label: t("workspace.automation.remoteAgent"),
                        disabled: !hasRemoteAgentRuntime,
                      },
                    ]}
                  />
                </Form.Item>
              </Col>
              {targetKind === "remote-command" ? (
                <>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="target_device_id"
                      label={t("workspace.automation.targetDevice")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label="automation-dispatch-remote-command-device"
                        showSearch
                        options={pairedDeviceOptions}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={5}>
                    <Form.Item
                      name="command_id"
                      label={t("workspace.automation.commandId")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input aria-label="automation-dispatch-command-id" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="command_title"
                      label={t("workspace.automation.commandTitle")}
                    >
                      <Input aria-label="automation-dispatch-command-title" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={4}>
                    <Form.Item
                      name="expected_exit_code"
                      label={t("workspace.delivery.expectedExit")}
                      initialValue={0}
                    >
                      <InputNumber
                        aria-label="automation-dispatch-command-expected-exit"
                        className="w-full"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={4}>
                    <Form.Item
                      name="timeout_seconds"
                      label={t("workspace.delivery.timeout")}
                      initialValue={300}
                    >
                      <InputNumber
                        aria-label="automation-dispatch-command-timeout"
                        className="w-full"
                        min={10}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="argvText"
                      label={t("workspace.automation.argvLines")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input.TextArea
                        aria-label="automation-dispatch-command-argv"
                        rows={3}
                      />
                    </Form.Item>
                  </Col>
                </>
              ) : targetKind === "remote-agent" ? (
                <>
                  <Col xs={24}>
                    <Alert
                      className="mb-3"
                      type={hasRemoteAgentRuntime ? "info" : "warning"}
                      showIcon
                      title={
                        hasRemoteAgentRuntime
                          ? t("workspace.automation.remoteAgentRuntimeReady")
                          : t("workspace.automation.remoteAgentUnsupported")
                      }
                    />
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="target_device_id"
                      label={t("workspace.automation.targetDevice")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label="automation-dispatch-remote-agent-device"
                        showSearch
                        options={remoteAgentDeviceOptions}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="target_id"
                      label={t("workspace.automation.targetId")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label="automation-dispatch-remote-agent"
                        showSearch
                        options={agentOptions}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="prompt"
                      label={t("workspace.automation.prompt")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input.TextArea
                        aria-label="automation-dispatch-remote-agent-prompt"
                        rows={4}
                        maxLength={4000}
                        showCount
                      />
                    </Form.Item>
                  </Col>
                </>
              ) : (
                <>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="target_id"
                      label={t("workspace.automation.targetId")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label="automation-dispatch-target"
                        showSearch
                        options={
                          targetKind === "agent" ? agentOptions : squadOptions
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item
                      name="isolation"
                      label={t("workspace.automation.isolation")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        aria-label="automation-dispatch-isolation"
                        options={[
                          {
                            value: "workspace",
                            label: t("workspace.code.currentDirectory"),
                          },
                          {
                            value: "git_worktree",
                            label: t("workspace.code.isolatedDirectory"),
                          },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="base_commit"
                      label={t("workspace.automation.baseCommit")}
                    >
                      <Input aria-label="automation-dispatch-base-commit" />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="prompt"
                      label={t("workspace.automation.prompt")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input.TextArea
                        aria-label="automation-dispatch-prompt"
                        rows={4}
                        maxLength={4000}
                        showCount
                      />
                    </Form.Item>
                  </Col>
                </>
              )}
            </Row>
            {hasCurrentDispatchPreview ? (
              <Collapse
                className="mb-3"
                size="small"
                defaultActiveKey={["summary"]}
                items={[
                  {
                    key: "summary",
                    label: t("workspace.automation.previewResult"),
                    children: (
                      <pre className="max-h-52 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                        {shortJson(
                          dispatchPreview?.response.summary ||
                            dispatchPreview?.response.items?.[0] ||
                            dispatchPreview?.response,
                        )}
                      </pre>
                    ),
                  },
                  {
                    key: "evidence",
                    label: t("workspace.advanced.evidence"),
                    children: (
                      <pre className="max-h-80 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                        {shortJson(dispatchPreview?.response)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}
            <Space>
              <Button
                aria-label="automation-dispatch-preview"
                icon={<ClipboardList className="h-4 w-4" />}
                disabled={!workspaceReady || !canDispatch}
                loading={dispatchTask.isPending}
                onClick={() => submitDispatch(true)}
              >
                {t("workspace.automation.preview")}
              </Button>
              <Button
                aria-label="automation-dispatch-apply"
                type="primary"
                icon={<Play className="h-4 w-4" />}
                disabled={
                  !workspaceReady || !canDispatch || !hasCurrentDispatchPreview
                }
                loading={dispatchTask.isPending}
                onClick={() => submitDispatch(false)}
              >
                {t("workspace.delivery.apply")}
              </Button>
            </Space>
          </Form>
        </Card>
      ) : null}

      {tab === "history" ? (
        <Space direction="vertical" className="w-full">
          <Alert
            type="info"
            showIcon
            title={t("workspace.automation.historyHint")}
          />
          <pre className="max-h-96 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--text)]">
            {shortJson(historyQuery.data)}
          </pre>
        </Space>
      ) : null}

      <Drawer
        title={drawer ? t(`workspace.automation.drawer.${drawer.kind}`) : ""}
        open={Boolean(drawer)}
        size="large"
        closable={!configureSchedule.isPending}
        maskClosable={!configureSchedule.isPending}
        onClose={() => {
          if (!configureSchedule.isPending) setDrawer(undefined);
        }}
        footer={
          drawer?.kind === "schedule" ? (
            <Space>
              <Button
                aria-label="automation-schedule-preview"
                disabled={!canConfigureSchedule}
                loading={configureSchedule.isPending}
                onClick={() => submitScheduleConfigure(true)}
              >
                {t("workspace.automation.preview")}
              </Button>
              <Button
                aria-label="automation-schedule-apply"
                type="primary"
                disabled={!canConfigureSchedule || !hasCurrentSchedulePreview}
                loading={configureSchedule.isPending}
                onClick={() => submitScheduleConfigure(false)}
              >
                {t("workspace.delivery.apply")}
              </Button>
            </Space>
          ) : undefined
        }
      >
        {drawer?.kind === "agent" ? (
          <Form
            form={agentForm}
            layout="vertical"
            initialValues={agentInitial(drawer.entity)}
            onFinish={(values) => saveAgent.mutate(values)}
          >
            <Form.Item
              name="title"
              label={t("workspace.fields.title")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={120} showCount />
            </Form.Item>
            <Form.Item
              name="provider"
              label={t("workspace.automation.provider")}
              rules={[{ required: true }]}
            >
              <Select
                options={PROVIDERS.map((provider) => ({
                  value: provider,
                  label: provider,
                }))}
              />
            </Form.Item>
            <Form.Item name="model" label={t("workspace.automation.model")}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item
              name="instructions"
              label={t("workspace.automation.instructions")}
            >
              <Input.TextArea rows={5} maxLength={4000} showCount />
            </Form.Item>
            <Form.Item
              name="timeout_seconds"
              label={t("workspace.automation.timeout")}
              rules={[{ required: true }]}
            >
              <InputNumber className="w-full" min={30} max={7200} />
            </Form.Item>
            <Button
              htmlType="submit"
              type="primary"
              disabled={!canConfig}
              loading={saveAgent.isPending}
            >
              {t("workspace.save")}
            </Button>
          </Form>
        ) : null}

        {drawer?.kind === "squad" ? (
          <Form
            form={squadForm}
            layout="vertical"
            initialValues={squadInitial(drawer.entity)}
            onFinish={(values) => saveSquad.mutate(values)}
          >
            <Form.Item
              name="title"
              label={t("workspace.fields.title")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={120} showCount />
            </Form.Item>
            <Form.List name="members">
              {(fields, { add, remove }) => (
                <Space direction="vertical" className="w-full">
                  {fields.map((field) => (
                    <Card key={field.key} size="small">
                      <Row gutter={[8, 0]}>
                        <Col xs={24} md={7}>
                          <Form.Item
                            name={[field.name, "agent_id"]}
                            label={t("workspace.automation.agent")}
                            rules={[{ required: true }]}
                          >
                            <Select showSearch options={agentOptions} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={5}>
                          <Form.Item
                            name={[field.name, "role"]}
                            label={t("workspace.automation.role")}
                            rules={[{ required: true }]}
                          >
                            <Select
                              options={SQUAD_ROLES.map((role) => ({
                                value: role,
                                label: role,
                              }))}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={9}>
                          <Form.Item
                            name={[field.name, "instructions"]}
                            label={t("workspace.automation.instructions")}
                          >
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={3}>
                          <Button danger onClick={() => remove(field.name)}>
                            {t("workspace.delivery.removeNode")}
                          </Button>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      add({
                        agent_id: "",
                        role: "implementer",
                        instructions: "",
                      })
                    }
                  >
                    {t("workspace.automation.addMember")}
                  </Button>
                  <Alert
                    type="info"
                    showIcon
                    title={t("workspace.automation.oneLeader")}
                    description={t("workspace.automation.leaderRoutes")}
                  />
                </Space>
              )}
            </Form.List>
            <Button
              className="mt-3"
              htmlType="submit"
              type="primary"
              disabled={!canConfig}
              loading={saveSquad.isPending}
            >
              {t("workspace.save")}
            </Button>
          </Form>
        ) : null}

        {drawer?.kind === "schedule" ? (
          <Form
            form={scheduleForm}
            disabled={configureSchedule.isPending}
            layout="vertical"
            initialValues={scheduleInitial(drawer.entity)}
            onValuesChange={() => {
              setSchedulePreview(undefined);
              setScheduleIdempotencyKey(idempotencyKey("schedule-configure"));
            }}
          >
            {!drawer.entity ? (
              <Form.Item
                name="schedule_id"
                label={t("workspace.automation.scheduleId")}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input aria-label="automation-schedule-id" maxLength={120} />
              </Form.Item>
            ) : null}
            <Form.Item
              name="title"
              label={t("workspace.fields.title")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input
                aria-label="automation-schedule-title"
                maxLength={120}
                showCount
              />
            </Form.Item>
            <Form.Item
              name="trigger_type"
              label={t("workspace.automation.trigger")}
              rules={[{ required: true }]}
            >
              <Segmented
                aria-label="automation-schedule-trigger-type"
                block
                options={[
                  {
                    value: "interval",
                    label: t("workspace.automation.triggerTypes.interval"),
                  },
                  {
                    value: "cron",
                    label: t("workspace.automation.triggerTypes.cron"),
                  },
                  {
                    value: "webhook",
                    label: t("workspace.automation.triggerTypes.webhook"),
                  },
                ]}
              />
            </Form.Item>
            <Row gutter={[12, 0]}>
              {scheduleTriggerType === "interval" ? (
                <>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="interval_seconds"
                      label={t("workspace.automation.interval")}
                      rules={[{ required: true }]}
                    >
                      <InputNumber
                        aria-label="automation-schedule-interval-seconds"
                        className="w-full"
                        min={10}
                        max={31_536_000}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="starts_at"
                      label={t("workspace.automation.startsAt")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input
                        aria-label="automation-schedule-starts-at"
                        placeholder="2026-09-08T09:00:00+08:00"
                      />
                    </Form.Item>
                  </Col>
                </>
              ) : null}
              {scheduleTriggerType === "cron" ? (
                <>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="cron_expression"
                      label={t("workspace.automation.cronExpression")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input
                        aria-label="automation-schedule-cron-expression"
                        placeholder="0 9 * * 1-5"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="timezone"
                      label={t("workspace.automation.timezone")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input
                        aria-label="automation-schedule-timezone"
                        placeholder="Asia/Shanghai"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Form.Item
                      name="starts_at"
                      label={t("workspace.automation.startsAtOptional")}
                    >
                      <Input
                        aria-label="automation-schedule-cron-starts-at"
                        placeholder="2026-09-08T09:00:00+08:00"
                      />
                    </Form.Item>
                  </Col>
                </>
              ) : null}
              {scheduleTriggerType === "webhook" ? (
                <>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="secret_ref"
                      label={t("workspace.automation.secretRef")}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input
                        aria-label="automation-schedule-webhook-secret-ref"
                        placeholder="HERMES_WEBHOOK_SECRET"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="max_body_bytes"
                      label={t("workspace.automation.maxBodyBytes")}
                      rules={[{ required: true }]}
                    >
                      <InputNumber
                        aria-label="automation-schedule-webhook-max-body-bytes"
                        className="w-full"
                        min={1}
                        max={1_048_576}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24}>
                    <Collapse
                      className="mb-3"
                      size="small"
                      items={[
                        {
                          key: "webhook-signature",
                          label: t(
                            "workspace.automation.webhookSignatureGuide",
                          ),
                          children: (
                            <Typography.Paragraph className="mb-0 text-sm text-[var(--muted)]">
                              {t("workspace.automation.webhookSignatureBody")}
                            </Typography.Paragraph>
                          ),
                        },
                      ]}
                    />
                  </Col>
                </>
              ) : null}
            </Row>
            <Form.Item
              name="enabled"
              label={t("workspace.automation.enabled")}
              valuePropName="checked"
            >
              <Switch aria-label="automation-schedule-enabled" />
            </Form.Item>
            <Form.Item
              name="misfire_coalesce"
              label={t("workspace.automation.misfireCoalesce")}
              valuePropName="checked"
            >
              <Switch aria-label="automation-schedule-misfire-coalesce" />
            </Form.Item>
            <Form.List name="nodes">
              {(fields, { add, remove }) => (
                <Space direction="vertical" className="mt-2 w-full">
                  {fields.map((field) => (
                    <Card key={field.key} size="small">
                      <Row gutter={[8, 0]}>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, "id"]}
                            label={t("workspace.delivery.node")}
                            rules={[{ required: true, whitespace: true }]}
                          >
                            <Input
                              aria-label={`automation-schedule-node-${field.name}-id`}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, "title"]}
                            label={t("workspace.fields.title")}
                            rules={[{ required: true, whitespace: true }]}
                          >
                            <Input
                              aria-label={`automation-schedule-node-${field.name}-title`}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={4}>
                          <Form.Item
                            name={[field.name, "kind"]}
                            label={t("workspace.kind")}
                            rules={[{ required: true }]}
                          >
                            <Select
                              aria-label={`automation-schedule-node-${field.name}-kind`}
                              options={[
                                { value: "command", label: "command" },
                                { value: "agent", label: "agent" },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        {scheduleNodes[field.name]?.kind === "agent" ? (
                          <>
                            <Col xs={24} md={12}>
                              <Form.Item
                                name={[field.name, "agent_id"]}
                                label={t("workspace.automation.agent")}
                              >
                                <Select
                                  aria-label={`automation-schedule-node-${field.name}-agent`}
                                  showSearch
                                  allowClear
                                  options={agentOptions}
                                />
                              </Form.Item>
                            </Col>
                            <Col xs={24}>
                              <Form.Item
                                name={[field.name, "prompt"]}
                                label={t("workspace.automation.prompt")}
                              >
                                <Input.TextArea
                                  aria-label={`automation-schedule-node-${field.name}-prompt`}
                                  rows={3}
                                />
                              </Form.Item>
                            </Col>
                          </>
                        ) : (
                          <Col xs={24} md={16}>
                            <Form.Item
                              name={[field.name, "argvText"]}
                              label={t("workspace.automation.argvLines")}
                            >
                              <Input.TextArea
                                aria-label={`automation-schedule-node-${field.name}-argv`}
                                rows={3}
                              />
                            </Form.Item>
                          </Col>
                        )}
                        <Col xs={12} md={3}>
                          <Form.Item
                            name={[field.name, "expected_exit_code"]}
                            label={t("workspace.delivery.expectedExit")}
                          >
                            <InputNumber
                              aria-label={`automation-schedule-node-${field.name}-expected-exit`}
                              className="w-full"
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} md={3}>
                          <Form.Item
                            name={[field.name, "timeout_seconds"]}
                            label={t("workspace.delivery.timeout")}
                          >
                            <InputNumber
                              aria-label={`automation-schedule-node-${field.name}-timeout`}
                              className="w-full"
                              min={10}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24}>
                          <Button
                            aria-label={`automation-schedule-node-${field.name}-remove`}
                            danger
                            onClick={() => remove(field.name)}
                          >
                            {t("workspace.delivery.removeNode")}
                          </Button>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                  <Button
                    aria-label="automation-schedule-add-node"
                    onClick={() =>
                      add({
                        id: `step-${fields.length + 1}`,
                        title: "",
                        kind: "command",
                        argvText: "",
                        expected_exit_code: 0,
                        timeout_seconds: 300,
                      })
                    }
                  >
                    {t("workspace.delivery.addNode")}
                  </Button>
                </Space>
              )}
            </Form.List>
            {drawer.entity && drawer.kind === "schedule" ? (
              <Alert
                className="mb-3"
                type="info"
                showIcon
                title={t("workspace.casHint", {
                  version: drawer.entity.version,
                })}
              />
            ) : null}
            {hasCurrentSchedulePreview ? (
              <Collapse
                className="mt-3"
                size="small"
                defaultActiveKey={["summary"]}
                items={[
                  {
                    key: "summary",
                    label: t("workspace.automation.previewResult"),
                    children: (
                      <Space direction="vertical" className="w-full">
                        {scheduleNextRuns(schedulePreview?.response).length ? (
                          <Table
                            size="small"
                            pagination={false}
                            rowKey={(value) => value}
                            dataSource={scheduleNextRuns(
                              schedulePreview?.response,
                            )}
                            columns={[
                              {
                                title: t("workspace.automation.nextRunLocal"),
                                render: (value: string) => readableTime(value),
                              },
                              {
                                title: t("workspace.automation.nextRunUtc"),
                                render: (value: string) =>
                                  new Date(value).toISOString(),
                              },
                            ]}
                          />
                        ) : (
                          <Typography.Text type="secondary">
                            {t("workspace.automation.noNextRuns")}
                          </Typography.Text>
                        )}
                        <pre className="max-h-52 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                          {shortJson(
                            schedulePreview?.response.summary ||
                              schedulePreview?.response.items?.[0] ||
                              schedulePreview?.response,
                          )}
                        </pre>
                      </Space>
                    ),
                  },
                  {
                    key: "evidence",
                    label: t("workspace.advanced.evidence"),
                    children: (
                      <pre className="max-h-80 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                        {shortJson(schedulePreview?.response)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}
          </Form>
        ) : null}

        {drawer?.kind === "device" ? (
          <Form
            form={deviceForm}
            layout="vertical"
            initialValues={deviceInitial(drawer.entity)}
            onFinish={(values) => saveAutomationResource.mutate({ values })}
          >
            <Form.Item
              name="title"
              label={t("workspace.fields.title")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={120} showCount />
            </Form.Item>
            <Form.Item name="name" label={t("workspace.fields.name")}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item
              name="platform"
              label={t("workspace.automation.platform")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={120} />
            </Form.Item>
            {drawer.entity ? (
              <Alert
                className="mb-3"
                type="warning"
                showIcon
                title={t("workspace.automation.deviceImmutable")}
              />
            ) : null}
            <Button
              htmlType="submit"
              type="primary"
              disabled={!canConfig || Boolean(drawer.entity)}
              loading={saveAutomationResource.isPending}
            >
              {t("workspace.save")}
            </Button>
          </Form>
        ) : null}
      </Drawer>

      <Drawer
        title={result?.title}
        open={Boolean(result)}
        size="large"
        onClose={closeResult}
      >
        {pairingSecret ? (
          <Card
            className="mb-3"
            size="small"
            title={t("workspace.automation.pairingSecret")}
          >
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>
                <Form.Item label={t("workspace.automation.deviceId")}>
                  <Input readOnly value={pairingSecret.deviceId || "-"} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label={t("workspace.automation.expiresAt")}>
                  <Input readOnly value={pairingSecret.expiresAt || "-"} />
                </Form.Item>
              </Col>
              <Col xs={24}>
                <Form.Item label={t("workspace.automation.oneTimeSecret")}>
                  <Input.Password
                    readOnly
                    value={pairingSecret.secret}
                    addonAfter={
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(pairingSecret.secret)
                            .then(() => message.success(t("common.copied")))
                        }
                      >
                        {t("common.copy")}
                      </Button>
                    }
                  />
                </Form.Item>
                <Typography.Text type="secondary">
                  {t("workspace.automation.oneTimeSecretHint")}
                </Typography.Text>
              </Col>
            </Row>
          </Card>
        ) : null}
        {result?.variant === "scheduleHistory" ? (
          <Table
            className="mb-3"
            rowKey="id"
            size="small"
            title={() => t("workspace.automation.scheduleRuns")}
            dataSource={resultHistoryRuns}
            pagination={{ pageSize: 6, showSizeChanger: false }}
            locale={{ emptyText }}
            columns={[
              {
                title: t("workspace.columns.title"),
                width: 240,
                ellipsis: true,
                render: (_, row) => entityTitle(row),
              },
              {
                title: t("workspace.columns.status"),
                dataIndex: "status",
                width: 120,
                render: (status) => <StatusTag status={String(status || "")} />,
              },
              {
                title: t("workspace.columns.created"),
                dataIndex: "created_at",
                width: 170,
                render: (value) => readableTime(String(value || "")),
              },
              {
                title: t("workspace.columns.actions"),
                width: 120,
                render: (_, row) => (
                  <Button
                    size="small"
                    onClick={() => {
                      closeResult();
                      onOpenRun(row);
                    }}
                  >
                    {t("workspace.delivery.openRun")}
                  </Button>
                ),
              },
            ]}
            scroll={{ x: 700 }}
          />
        ) : null}
        <Collapse
          defaultActiveKey={["summary"]}
          items={[
            {
              key: "summary",
              label: t("workspace.automation.resultSummary"),
              children: (
                <pre className="max-h-96 overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                  {shortJson(
                    result?.response.summary ||
                      result?.response.items?.[0] ||
                      result?.response,
                  )}
                </pre>
              ),
            },
            {
              key: "evidence",
              label: t("workspace.advanced.evidence"),
              children: (
                <pre className="max-h-[70vh] overflow-auto rounded-md bg-[var(--surface-muted)] p-3 text-xs">
                  {shortJson(result?.response)}
                </pre>
              ),
            },
          ]}
        />
      </Drawer>
    </Card>
  );
}
