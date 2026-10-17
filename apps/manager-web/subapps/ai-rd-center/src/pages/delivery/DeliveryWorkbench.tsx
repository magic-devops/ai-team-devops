import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Progress,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  CheckCircle2,
  Circle,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { getProjectId, getToken, getWorkspaceScope } from "@/lib/authStorage";
import {
  deliveryStages,
  fetchDelivery,
  fetchDeliveryInbox,
  filterRequirements,
  prepareDeliveryIntent,
  requirementProgress,
  safeEvidenceUrl,
  saveDelivery,
  type DeliveryAction,
  type DeliveryIntent,
  type DeliveryMember,
  type DeliveryMilestone,
  type DeliveryRequirement,
  type DeliveryWorkspace,
  type DeliveryInboxTarget,
} from "@/lib/delivery";
import {
  DeliveryEditor,
  type EditorField,
  type EditorSpec,
} from "./DeliveryEditor";
import "./delivery-workbench.css";
import { DeliveryIssueWorkbench } from "./DeliveryIssueWorkbench";
import { DeliveryTaskPlanEditor } from "./DeliveryTaskPlanEditor";
import { planError } from "@/lib/deliveryTaskPlan";
import {
  deliveryInboxHash,
  deliveryInboxHref,
  deliveryViews,
  parseDeliveryRoute,
  normalizeInboxTarget,
  projectUpdatePayload,
  taskTargetState,
  type DeliveryRoute,
  type InboxCategory,
  type InboxScope,
  type ResourceKindFilter,
} from "@/lib/deliveryProjectInbox";
import { DeliveryProjectResources } from "./DeliveryProjectResources";
import { DeliveryInbox } from "./DeliveryInbox";
import { DeliveryProjectOverview } from "./DeliveryProjectOverview";
import { DeliveryProgress, DeliveryProgressSummary } from "./DeliveryProgress";
import { preserveProgressRoute } from "@/lib/deliveryProgress";
import { preserveSchedulingRoute } from "@/lib/deliveryScheduling";
import { DeliveryScheduling } from "./DeliveryScheduling";
import { DeliveryTaskDetail, TaskDetailContent } from "./DeliveryTaskDetail";
import { DeliveryActivityAction } from "./DeliveryActivityAction";
import { useMemberIdentity } from "@/components/DeliveryMemberIdentity";
import { useDrawerIdentity } from "@/lib/useDrawerIdentity";
import { ProjectContextGate } from "@/components/ProjectContextGate";
import { preserveProjectContext } from "@/lib/projectPortfolioRoute";
import { DeliveryExecutionInspector } from "./DeliveryExecutionInspector";
import { DeliveryReleaseWorkbench } from "./DeliveryReleaseWorkbench";
import {
  parseReleaseRoute,
  releaseHash,
  releaseReturnFromHash,
} from "@/lib/deliveryReleaseRoute";

const subscribe = (cb: () => void) => {
  window.addEventListener("sop-session", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("sop-session", cb);
    window.removeEventListener("storage", cb);
  };
};
const sessionSnapshot = () => JSON.stringify([getToken(), getWorkspaceScope()]);
const views = deliveryViews;
const lines = (value: unknown) =>
  String(value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const dateValue = (value: unknown) => value || null;

export function DeliveryWorkbench() {
  const scope = useSyncExternalStore(subscribe, sessionSnapshot);
  return (
    <ProjectContextGate>
      <ProjectDelivery key={scope} />
    </ProjectContextGate>
  );
}

function ProjectDelivery() {
  const { t, i18n } = useTranslation();
  const tr = (key: string) => t(`delivery.${key}`);
  const identityLabel = useMemberIdentity();
  const tp = (key: string) => t(`deliveryProject.${key}`);
  const projectId = getProjectId() || "";
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const originScope = useRef(sessionSnapshot());
  const qc = useQueryClient();
  const queryKey = ["delivery", projectId, sessionId];
  const [taskEditing, setTaskEditing] = useState(false);
  const [taskPinnedWorkspace, setTaskPinnedWorkspace] =
    useState<DeliveryWorkspace>();
  const taskEditingChanged = useCallback(
    (editing: boolean) => {
      setTaskEditing(editing);
      if (editing) {
        const current = qc.getQueryData<DeliveryWorkspace>([
          "delivery",
          projectId,
          sessionId,
        ]);
        if (current)
          setTaskPinnedWorkspace(
            (previous) => previous || structuredClone(current),
          );
      } else setTaskPinnedWorkspace(undefined);
    },
    [projectId, sessionId, qc],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchDelivery(projectId, signal),
    enabled: Boolean(projectId && getToken()) && !taskEditing,
    gcTime: 0,
    refetchInterval: 5000,
  });
  const [view, setView] = useState(
    () => parseDeliveryRoute(location.hash).view,
  );
  const [selectedId, setSelectedId] = useState(
    () => parseDeliveryRoute(location.hash).requirement,
  );
  const [detailTab, setDetailTab] = useState(
    () => parseDeliveryRoute(location.hash).detail,
  );
  const [selectedTaskId, setSelectedTaskId] = useState(
    () => parseDeliveryRoute(location.hash).task,
  );
  const requestedTaskId =
    !selectedId && ["team", "timeline"].includes(view) ? selectedTaskId : "";
  const taskInspector = useDrawerIdentity(
    `${projectId}:${sessionId}`,
    requestedTaskId,
  );
  const [selectedIssueId, setSelectedIssueId] = useState(
    () => parseDeliveryRoute(location.hash).issue,
  );
  const [selectedExecutionId, setSelectedExecutionId] = useState(
    () =>
      new URLSearchParams(location.hash.split("?")[1]).get("execution_id") ||
      "",
  );
  const [inboxScope, setInboxScope] = useState<InboxScope>(
    () => parseDeliveryRoute(location.hash).inboxScope,
  );
  const [inboxCategory, setInboxCategory] = useState<InboxCategory>(
    () => parseDeliveryRoute(location.hash).inboxCategory,
  );
  const [resourceKind, setResourceKind] = useState<ResourceKindFilter>(
    () => parseDeliveryRoute(location.hash).resourceKind,
  );
  const [showArchived, setShowArchived] = useState(
    () => parseDeliveryRoute(location.hash).showArchived,
  );
  const taskNodes = useRef(new Map<string, HTMLElement>());
  const focusedTask = useRef("");
  useEffect(() => {
    const syncRoute = () => {
      const route = parseDeliveryRoute(location.hash);
      setSelectedExecutionId(
        new URLSearchParams(location.hash.split("?")[1]).get("execution_id") ||
          "",
      );
      setView(route.view);
      setSelectedId(route.requirement);
      setDetailTab(route.detail);
      setSelectedTaskId(route.task);
      setSelectedIssueId(route.issue);
      setInboxScope(route.inboxScope);
      setInboxCategory(route.inboxCategory);
      setResourceKind(route.resourceKind);
      setShowArchived(route.showArchived);
    };
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [planRequirement, setPlanRequirement] =
    useState<DeliveryRequirement | null>(null);
  const [actionError, setActionError] = useState("");
  const lastRequest = useRef<{ signature: string; key: string }>();
  const editorIntent = useRef<DeliveryIntent>();
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
      form = true,
    }: {
      action: DeliveryAction;
      payload: Record<string, unknown>;
      form?: boolean;
    }) => {
      if (originScope.current !== sessionSnapshot())
        throw new Error(tr("scopeChanged"));
      const current = qc.getQueryData<DeliveryWorkspace>(queryKey);
      if (!current) throw new Error(tr("refresh"));
      if (form && editorIntent.current) {
        const intent = prepareDeliveryIntent(
          editorIntent.current,
          action,
          payload,
        );
        editorIntent.current = intent;
        return saveDelivery(
          projectId,
          action,
          payload,
          intent.version,
          intent.key,
        );
      }
      const signature = JSON.stringify([action, payload, current.version]);
      if (lastRequest.current?.signature !== signature)
        lastRequest.current = { signature, key: crypto.randomUUID() };
      return saveDelivery(
        projectId,
        action,
        payload,
        current.version,
        lastRequest.current.key,
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
      void qc.invalidateQueries({
        queryKey: ["delivery-inbox", projectId, sessionId],
      });
      setActionError("");
    },
    onError: (error) => {
      if (error.message.includes("409")) void query.refetch();
    },
  });
  const commit = async (
    action: DeliveryAction,
    payload: Record<string, unknown>,
    form = true,
  ) => {
    try {
      await mutation.mutateAsync({ action, payload, form });
    } catch (e) {
      const failure = planError(e);
      const error = new Error(
        failure.conflict ? tr("conflict") : failure.message,
      );
      error.name = failure.conflict ? "DeliveryConflict" : "Error";
      throw error;
    }
  };
  const navigate = (
    nextView: string,
    id = selectedId,
    detail = detailTab,
    taskId = "",
    push = false,
    filters: Partial<DeliveryRoute> = {},
  ) => {
    if (["quality", "releases"].includes(nextView)) {
      id = "";
      detail = "details";
      taskId = "";
    }
    setView(nextView);
    setSelectedId(id);
    setDetailTab(detail);
    setSelectedTaskId(taskId);
    setSelectedIssueId(filters.issue || "");
    const hash = deliveryInboxHash(
      {
        view: nextView,
        requirement_id: id,
        detail,
        task_id: taskId,
        issue_id: filters.issue,
      },
      { inboxScope, inboxCategory, resourceKind, showArchived, ...filters },
    );
    history[push ? "pushState" : "replaceState"](
      null,
      "",
      `${location.pathname}${location.search}${["quality", "releases"].includes(nextView) ? releaseHash({ ...parseReleaseRoute(location.hash), view: nextView as "quality" | "releases", releaseId: "", evidenceId: "" }, location.hash) : preserveProjectContext(nextView === "progress" ? preserveProgressRoute(hash, location.hash) : preserveSchedulingRoute(hash, location.hash), location.hash)}`,
    );
    if (
      ["progress", "team", "timeline", "quality", "releases"].includes(nextView)
    )
      window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const setIssueRoute = (id: string) => {
    const params = new URLSearchParams(location.hash.split("?")[1]);
    params.set("view", "issues");
    params.set("project_id", projectId);
    params.delete("diagnosis_id");
    if (id) params.set("issue", id);
    else params.delete("issue");
    history.pushState(
      null,
      "",
      `${location.pathname}${location.search}#/dev-flow?${params}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const data = taskPinnedWorkspace || query.data;
  const inboxQueryScope = view === "overview" ? "mine" : inboxScope;
  const inboxQuery = useQuery({
    queryKey: ["delivery-inbox", projectId, sessionId, inboxQueryScope],
    queryFn: ({ signal }) =>
      fetchDeliveryInbox(projectId, inboxQueryScope, signal),
    enabled: Boolean(
      projectId && getToken() && data && ["overview", "inbox"].includes(view),
    ),
    gcTime: 0,
    refetchInterval: 5000,
  });
  const saveWorkspace = (updated: DeliveryWorkspace) => {
    qc.setQueryData(queryKey, updated);
    void qc.invalidateQueries({
      queryKey: ["delivery-inbox", projectId, sessionId],
    });
  };
  const openTarget = (target: DeliveryInboxTarget) => {
    target = normalizeInboxTarget(target);
    if (
      target.task_id &&
      !target.requirement_id &&
      !["team", "timeline"].includes(target.view)
    ) {
      location.hash = preserveProjectContext(
        deliveryInboxHref(target),
        location.hash,
      );
      return;
    }
    navigate(
      target.view,
      target.requirement_id,
      target.detail,
      target.task_id || "",
      true,
      { issue: target.issue_id || "" },
    );
  };
  const locateTask = () => {
    const identity = `${selectedId}:${selectedTaskId}`;
    if (
      !selectedTaskId ||
      detailTab !== "tasks" ||
      focusedTask.current === identity
    )
      return;
    const node = taskNodes.current.get(selectedTaskId);
    if (node) {
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
      focusedTask.current = identity;
    }
  };
  useEffect(() => {
    if (!selectedTaskId) focusedTask.current = "";
    const frame = requestAnimationFrame(locateTask);
    return () => cancelAnimationFrame(frame);
  }, [selectedId, selectedTaskId, detailTab]);
  const visible = filterRequirements(
    data?.requirements || [],
    search,
    stage,
    owner,
  );
  const selected = data?.requirements.find((r) => r.id === selectedId);
  const releaseReturn = releaseReturnFromHash(location.hash);
  const date = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          month: "short",
          day: "numeric",
        }).format(new Date(value.length === 10 ? value + "T12:00:00" : value))
      : tr("unscheduled");
  const name = (id: string) => identityLabel(data?.members || [], id);
  const ownerOptions = [
    { label: tr("unassigned"), value: "" },
    ...(data?.members || [])
      .filter((m) => m.active && m.kind !== "tool")
      .map((m) => ({
        label: identityLabel(data?.members || [], m.id),
        value: m.id,
      })),
  ];
  const field = (
    key: string,
    label: string,
    extra: Partial<EditorField> = {},
  ): EditorField => ({ key, label: tr(label), ...extra });
  const ownerField = field("owner_id", "owner", {
    members: data?.members || [],
  });
  const edit = (
    title: string,
    fields: EditorField[],
    values: Record<string, unknown>,
    submit: EditorSpec["submit"],
    hint?: string,
    hooks?: {
      loadLatest?: EditorSpec["loadLatest"];
      adoptVersion?: EditorSpec["adoptVersion"];
    },
  ) => {
    editorIntent.current = {
      version: data?.version || 0,
      key: crypto.randomUUID(),
    };
    setEditor({
      title: title === "project" ? tp("projectDetails") : tr(title),
      fields,
      values,
      submit,
      hint: hint ? tr(hint) : undefined,
      loadLatest: async () => {
        if (originScope.current !== sessionSnapshot())
          throw new Error(tr("scopeChanged"));
        if (hooks?.loadLatest) return hooks.loadLatest();
        const fresh = await fetchDelivery(projectId);
        qc.setQueryData(queryKey, fresh);
        const [action, payload] = JSON.parse(
          editorIntent.current?.signature || '["",{}]',
        ) as [string, Record<string, string>];
        const req = fresh.requirements.find(
          (r) => r.id === (payload.requirement_id || payload.id),
        );
        let current: Record<string, unknown> = { name: fresh.project.name };
        if (action === "project.update") current = fresh.project;
        else if (action === "task.update") {
          const task = fresh.tasks.find((item) => item.id === payload.id);
          current = task ? { ...task, ...task.planning } : {};
        } else if (req)
          current = {
            ...req,
            ...req.flow,
            criteria: req.acceptance_criteria.join("\n"),
          };
        else if (action === "member.save")
          current = fresh.members.find((m) => m.id === payload.id) || {};
        else if (action === "milestone.save")
          current = fresh.milestones.find((m) => m.id === payload.id) || {};
        const items = [
          {
            label: tr("requirements"),
            value: String(fresh.summary.requirements),
          },
        ];
        if (req)
          items.push(
            { label: tr("titleField"), value: req.title },
            { label: tr("current"), value: tr(`stages.${req.flow.stage}`) },
          );
        for (const f of fields) {
          if (current[f.key] === undefined) continue;
          const value = current[f.key];
          items.push({
            label: f.label,
            value:
              (f.members
                ? identityLabel(fresh.members, String(value || ""))
                : f.options?.find((o) => o.value === value)?.label) ||
              String(value ?? tr("none")),
          });
        }
        return { version: fresh.version, items };
      },
      adoptVersion: (version, draft) => {
        editorIntent.current = { version, key: crypto.randomUUID() };
        return hooks?.adoptVersion?.(version, draft);
      },
    });
  };
  const reqEditor = (r?: DeliveryRequirement) =>
    edit(
      r ? "edit" : "create",
      [
        field("title", "titleField", { required: true }),
        field("description", "description", { type: "area" }),
        field("criteria", "criteria", { type: "area" }),
        field("priority", "priority", {
          options: ["P0", "P1", "P2", "P3"].map((value) => ({
            label: value,
            value,
          })),
        }),
        ownerField,
        field("due_on", "due", { type: "date" }),
        field("milestone_id", "milestone", {
          options: [
            { label: tr("none"), value: "" },
            ...(data?.milestones || []).map((m) => ({
              label: m.title,
              value: m.id,
            })),
          ],
        }),
        ...(r
          ? [
              field("blocked_reason", "blockedReason", {
                type: "area",
                max: 2000,
              }),
            ]
          : []),
      ],
      r
        ? { ...r, ...r.flow, criteria: r.acceptance_criteria.join("\n") }
        : { priority: "P1", owner_id: "", milestone_id: "" },
      async (v) => {
        const { criteria, ...rest } = v;
        await commit(r ? "requirement.update" : "requirement.create", {
          ...rest,
          ...(r ? { id: r.id } : {}),
          description: rest.description || "",
          due_on: dateValue(v.due_on),
          acceptance_criteria: lines(criteria),
        });
      },
      r ? "changeHint" : undefined,
    );
  const projectEditor = () =>
    edit(
      "project",
      [
        ...(data?.permissions.configure
          ? [
              field("name", "name", { required: true, max: 128 }),
              field("description", "description", { type: "area", max: 20000 }),
            ]
          : []),
        field("goal", "goal", { type: "area" }),
        ownerField,
        field("starts_on", "starts", { type: "date" }),
        field("ends_on", "ends", { type: "date" }),
      ],
      { owner_id: "", ...data?.project },
      async (v) => {
        const current = qc.getQueryData<DeliveryWorkspace>(queryKey);
        if (!current?.permissions.write) throw new Error(tp("noPermission"));
        if (
          data?.permissions.configure &&
          !current.permissions.configure &&
          (v.name !== data.project.name ||
            v.description !== data.project.description)
        )
          throw new Error(tp("noPermission"));
        const payload = projectUpdatePayload(
          v,
          data?.project || {},
          current.permissions.configure,
        );
        if (Object.keys(payload).length)
          await commit("project.update", payload);
      },
    );
  const milestoneEditor = (m?: DeliveryMilestone) =>
    edit(
      m ? "editMilestone" : "addMilestone",
      [
        field("title", "titleField", { required: true, max: 200 }),
        ownerField,
        field("starts_on", "starts", { type: "date" }),
        field("ends_on", "ends", { type: "date" }),
      ],
      m ? { ...m } : { owner_id: "" },
      async (v) => {
        await commit("milestone.save", {
          ...v,
          ...(m ? { id: m.id } : {}),
          starts_on: dateValue(v.starts_on),
          ends_on: dateValue(v.ends_on),
        });
      },
    );
  const memberEditor = (m?: DeliveryMember) =>
    edit(
      m ? "editMember" : "addMember",
      [
        field("name", "name", { required: true, max: 120 }),
        ...(!m
          ? [
              field("kind", "kind", {
                options: ["agent", "tool"].map((value) => ({
                  value,
                  label: tr(`kinds.${value}`),
                })),
              }),
            ]
          : []),
        field("role", "role", { max: 80 }),
        field("tool", "tool", { max: 80 }),
        field("active", "active", { type: "boolean" }),
      ],
      m
        ? { ...m }
        : {
            kind: "agent",
            role: "developer",
            active: true,
            tool: "",
          },
      async (v) => {
        await commit("member.save", {
          ...v,
          ...(m ? { id: m.id, kind: m.kind } : {}),
        });
      },
      "toolsHint",
    );
  const planEditor = (r: DeliveryRequirement) => setPlanRequirement(r);
  const evidenceEditor = (r: DeliveryRequirement) =>
    edit(
      "addEvidence",
      [
        field("kind", "kind", {
          options: [
            "prd",
            "prototype",
            "architecture",
            "code",
            "test",
            "runbook",
          ].map((value) => ({ value, label: tr(`kinds.${value}`) })),
        }),
        field("title", "titleField", { required: true, max: 200 }),
        field("content", "content", { type: "area" }),
        field("url", "url", { max: 2000 }),
        field("result", "result", {
          options: ["recorded", "passed", "failed"].map((value) => ({
            value,
            label: tr(`statuses.${value}`),
          })),
        }),
      ],
      {
        kind:
          data?.stages.find((s) => s.id === r.flow.stage)?.artifact || "prd",
        result: "recorded",
        content: "",
        url: "",
      },
      async (v) => {
        await commit("artifact.add", { ...v, requirement_id: r.id });
      },
      "manual",
    );
  const reviewEditor = (r: DeliveryRequirement, reopen = false) =>
    edit(
      reopen ? "reopen" : "advance",
      [
        field("comment", "comment", {
          type: "area",
          required: true,
          max: 4000,
        }),
      ],
      {},
      async (v) => {
        await commit(reopen ? "stage.reopen" : "stage.advance", {
          ...v,
          requirement_id: r.id,
        });
      },
    );

  if (!projectId || !getToken())
    return (
      <Empty description={tr("noProject")}>
        <Button href="#/projects">{tr("chooseProject")}</Button>
      </Empty>
    );
  if (query.isPending) return <Skeleton active paragraph={{ rows: 12 }} />;
  if (!data)
    return (
      <Alert
        type="error"
        showIcon
        title={query.error?.message || tr("empty")}
        action={
          <Button onClick={() => void query.refetch()}>{tr("refresh")}</Button>
        }
      />
    );
  const canWrite = data.permissions.write;
  const actionsDisabled = mutation.isPending;
  const stageTag = (r: DeliveryRequirement) => (
    <Tag
      color={r.flow.closed ? "green" : r.flow.blocked_reason ? "red" : "cyan"}
    >
      {r.flow.closed ? tr("closed") : tr(`stages.${r.flow.stage}`)}
    </Tag>
  );
  const activityView = (requirement?: DeliveryRequirement) => {
    const taskIds = new Set(
      data.tasks
        .filter((task) => task.req_id === requirement?.id)
        .map((task) => task.id),
    );
    const events = data.activity.filter(
      (e) =>
        !requirement ||
        e.resource_id === requirement.id ||
        e.data.input.requirement_id === requirement.id ||
        taskIds.has(e.resource_id),
    );
    return events.length ? (
      <ol className="delivery-activity">
        {events.map((e) => (
          <li key={e.id}>
            <span className="delivery-activity-dot" />
            <div>
              <DeliveryActivityAction action={e.action} />
              <small>
                {e.actor} ·{" "}
                {new Date(e.created_at).toLocaleString(i18n.language)}
              </small>
            </div>
          </li>
        ))}
      </ol>
    ) : (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={tr("noActivity")}
      />
    );
  };
  const empty = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <>
          <strong>{tr("empty")}</strong>
          <p>{tr("emptyHint")}</p>
        </>
      }
    >
      <Button
        onClick={() => {
          setSearch("");
          setOwner("");
          setStage("");
        }}
      >
        {tr("reset")}
      </Button>
    </Empty>
  );
  const columns = [
    {
      title: tr("titleField"),
      key: "title",
      render: (_: unknown, r: DeliveryRequirement) => (
        <button
          className="delivery-title-link"
          onClick={() => navigate(view, r.id)}
        >
          <span>{r.title}</span>
          <small>
            {r.id} · {t("delivery.revision", { number: r.flow.revision })}
          </small>
        </button>
      ),
    },
    {
      title: tr("current"),
      key: "stage",
      width: 150,
      render: (_: unknown, r: DeliveryRequirement) => stageTag(r),
    },
    {
      title: tr("priority"),
      dataIndex: "priority",
      width: 90,
      render: (p: string) => (
        <Tag color={p === "P0" ? "red" : p === "P1" ? "orange" : "default"}>
          {p}
        </Tag>
      ),
    },
    {
      title: tr("owner"),
      key: "owner",
      width: 140,
      render: (_: unknown, r: DeliveryRequirement) => name(r.flow.owner_id),
    },
    {
      title: tr("progress"),
      key: "progress",
      width: 160,
      render: (_: unknown, r: DeliveryRequirement) => (
        <div className="delivery-progress">
          <Progress
            percent={requirementProgress(r)}
            showInfo={false}
            size="small"
          />
          <small>
            {r.tasks_done}/{r.tasks_total}
          </small>
        </div>
      ),
    },
    {
      title: tr("due"),
      key: "due",
      width: 130,
      render: (_: unknown, r: DeliveryRequirement) => (
        <span
          className={
            r.flow.due_on &&
            r.flow.due_on < new Date().toLocaleDateString("en-CA") &&
            !r.flow.closed
              ? "delivery-overdue"
              : ""
          }
        >
          {date(r.flow.due_on)}
        </span>
      ),
    },
  ];
  return (
    <section className="delivery-workbench" aria-label={tr("title")}>
      {data.project.status === "archived" && (
        <Alert
          type="info"
          title={t("projectPortfolio.archivedReadOnly")}
          description={t("projectPortfolio.archivedHint")}
          action={
            <Button
              href={`#/projects/portfolio?project_id=${encodeURIComponent(projectId)}`}
            >
              {t("projectPortfolio.inspect")}
            </Button>
          }
        />
      )}
      {["planning", "paused"].includes(data.project.status || "") && (
        <Alert type="info" title={t("projectPortfolio.pausedHint")} />
      )}
      <header className="delivery-header">
        <div>
          <div className="delivery-eyebrow">
            <GitBranch size={14} /> {tr("title")}
          </div>
          <h1>{data.project.name}</h1>
          <p>{data.project.goal || tr("subtitle")}</p>
        </div>
        <div className="delivery-actions">
          <Tooltip title={tr("refresh")}>
            <Button
              aria-label={tr("refresh")}
              icon={<RefreshCw size={16} />}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            />
          </Tooltip>
          <Button
            icon={<Settings2 size={15} />}
            onClick={projectEditor}
            disabled={!canWrite}
          >
            {tp("projectDetails")}
          </Button>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            disabled={!canWrite}
            onClick={() => reqEditor()}
          >
            {tr("create")}
          </Button>
        </div>
      </header>
      {(query.error || actionError) && (
        <Alert
          type="error"
          showIcon
          title={actionError || query.error?.message}
          closable
          onClose={() => setActionError("")}
        />
      )}
      {!canWrite && <Alert type="info" title={tr("readOnly")} />}
      {selectedId && !selected && (
        <Alert
          type="warning"
          showIcon
          title={tp("requirementMissing")}
          action={
            <Button onClick={() => navigate("inbox", "")}>
              {tp("backInbox")}
            </Button>
          }
        />
      )}
      <div className="delivery-metrics">
        {(
          [
            "requirements",
            "accepted",
            "released",
            "blocked",
            "openIssues",
          ] as const
        ).map((key, idx) => (
          <div key={key}>
            <span>{tr(key)}</span>
            <strong>
              {
                [
                  data.summary.requirements,
                  data.summary.accepted,
                  data.summary.released,
                  data.summary.blocked,
                  data.summary.open_issues,
                ][idx]
              }
            </strong>
            {idx === 1 && <small>{data.summary.acceptance_rate}%</small>}
          </div>
        ))}
      </div>
      {releaseReturn && (
        <Button href={releaseReturn}>
          {t(
            parseReleaseRoute(releaseReturn).view === "quality"
              ? "deliveryRelease.backQuality"
              : "deliveryRelease.releases",
          )}
        </Button>
      )}
      <Tabs
        className="delivery-tabs"
        activeKey={view}
        onChange={(v) => navigate(v)}
        items={views.map((key) => ({
          key,
          label:
            key === "quality" || key === "releases"
              ? t(`deliveryRelease.${key}`)
              : key === "progress"
                ? t("deliveryProgress.title")
                : ["resources", "inbox"].includes(key)
                  ? tp(key)
                  : tr(key),
          icon:
            key === "list" ? (
              <List size={15} />
            ) : key === "board" ? (
              <LayoutGrid size={15} />
            ) : key === "team" ? (
              <Users size={15} />
            ) : undefined,
        }))}
      />
      {["list", "board"].includes(view) && (
        <div className="delivery-toolbar">
          <Input
            aria-label={tr("search")}
            placeholder={tr("search")}
            prefix={<Search size={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
          <Select
            aria-label={tr("allStages")}
            value={stage}
            onChange={setStage}
            options={[
              { label: tr("allStages"), value: "" },
              ...deliveryStages.map((value) => ({
                value,
                label: tr(`stages.${value}`),
              })),
            ]}
          />
          <Select
            aria-label={tr("allOwners")}
            value={owner}
            onChange={setOwner}
            options={[
              { label: tr("allOwners"), value: "" },
              ...ownerOptions.filter((o) => o.value),
            ]}
          />
          <span>
            {visible.length} / {data.requirements.length}
          </span>
        </div>
      )}
      {view === "overview" && (
        <>
          <DeliveryProjectOverview
            onMilestone={(id) => {
              location.hash = preserveProjectContext(
                `#/dev-flow?view=timeline&milestone_id=${encodeURIComponent(id)}`,
                location.hash,
              );
            }}
            data={data}
            inbox={inboxQuery.data}
            onView={(nextView) => navigate(nextView, "")}
          />
          <div className="delivery-section-heading">
            <h2>{tr("current")}</h2>
            <span>
              {tr("tasksDone")} {data.summary.tasks_done}/{data.summary.tasks}
            </span>
          </div>
          <div className="delivery-stage-rail">
            {deliveryStages.map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  setStage(s);
                  navigate("list", "");
                }}
              >
                <small>{String(i + 1).padStart(2, "0")}</small>
                <strong>
                  {data.requirements.filter((r) => r.flow.stage === s).length}
                </strong>
                <span>{tr(`stages.${s}`)}</span>
              </button>
            ))}
          </div>
          <div className="delivery-overview-grid">
            <DeliveryProgressSummary
              projectId={projectId}
              sessionId={sessionId}
              onOpen={() => navigate("progress", "")}
            />
            <section className="delivery-panel">
              <h2>{tr("activity")}</h2>
              {activityView()}
            </section>
          </div>
        </>
      )}
      {(view === "quality" || view === "releases") && (
        <DeliveryReleaseWorkbench
          view={view}
          workspace={data}
          sessionId={sessionId}
          onSaved={saveWorkspace}
        />
      )}
      {view === "resources" && (
        <DeliveryProjectResources
          projectId={projectId}
          data={data}
          kind={resourceKind}
          showArchived={showArchived}
          onSaved={saveWorkspace}
          onFilter={(kind, archived) => {
            setResourceKind(kind);
            setShowArchived(archived);
            navigate("resources", "", "details", "", false, {
              resourceKind: kind,
              showArchived: archived,
            });
          }}
        />
      )}
      {view === "progress" && (
        <DeliveryProgress
          projectId={projectId}
          sessionId={sessionId}
          workspace={data}
          onWorkspace={saveWorkspace}
          onOpenTask={openTarget}
        />
      )}
      {view === "inbox" && (
        <DeliveryInbox
          data={inboxQuery.data}
          workspace={data}
          scope={inboxScope}
          category={inboxCategory}
          loading={inboxQuery.isPending}
          refreshing={inboxQuery.isFetching}
          error={inboxQuery.error?.message}
          onRefresh={() => {
            void query.refetch();
            void inboxQuery.refetch();
          }}
          onScope={(scope) => {
            setInboxScope(scope);
            navigate("inbox", "", "details", "", false, { inboxScope: scope });
          }}
          onCategory={(category) => {
            setInboxCategory(category);
            navigate("inbox", "", "details", "", false, {
              inboxCategory: category,
            });
          }}
          onOpen={openTarget}
        />
      )}
      {view === "list" && (
        <Table
          rowKey="id"
          dataSource={visible}
          columns={columns}
          size="middle"
          scroll={{ x: 920 }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: empty }}
        />
      )}
      {view === "board" &&
        (visible.length ? (
          <div className="delivery-board">
            {deliveryStages
              .filter((s) => !stage || s === stage)
              .map((s) => (
                <section key={s} className="delivery-lane">
                  <header>
                    <span>{tr(`stages.${s}`)}</span>
                    <Tag>
                      {visible.filter((r) => r.flow.stage === s).length}
                    </Tag>
                  </header>
                  {visible
                    .filter((r) => r.flow.stage === s)
                    .map((r) => (
                      <button
                        className="delivery-card"
                        key={r.id}
                        onClick={() => navigate(view, r.id)}
                      >
                        <div>
                          <small>{r.id}</small>
                          <Tag color={r.priority === "P0" ? "red" : "default"}>
                            {r.priority}
                          </Tag>
                        </div>
                        <h3>{r.title}</h3>
                        {r.flow.blocked_reason && (
                          <p className="delivery-overdue">
                            {r.flow.blocked_reason}
                          </p>
                        )}
                        <Progress
                          percent={requirementProgress(r)}
                          size="small"
                        />
                        <footer>
                          <span>{name(r.flow.owner_id)}</span>
                          <span>{date(r.flow.due_on)}</span>
                        </footer>
                      </button>
                    ))}
                </section>
              ))}
          </div>
        ) : (
          empty
        ))}
      {["team", "timeline"].includes(view) && (
        <DeliveryScheduling
          projectId={projectId}
          sessionId={sessionId}
          view={view as "team" | "timeline"}
          workspace={data}
          onSaved={saveWorkspace}
          onOpenTask={openTarget}
          onEditMember={memberEditor}
          onEditMilestone={milestoneEditor}
        />
      )}
      {view === "issues" && (
        <DeliveryIssueWorkbench
          workspace={data}
          projectId={projectId}
          sessionId={sessionId}
          issueId={selectedIssueId}
          background={location.hash}
          readOnly={data.project.status === "archived"}
          onSaved={saveWorkspace}
          onOpenIssue={(id) => setIssueRoute(id)}
          onCloseIssue={() => setIssueRoute("")}
        />
      )}
      <Drawer
        open={Boolean(requestedTaskId)}
        afterOpenChange={taskInspector.afterOpenChange}
        onClose={() => navigate(view, "", "details", "")}
        title={
          data.tasks.find((task) => task.id === taskInspector.displayId)
            ?.title || t("deliveryManualReview.unavailable")
        }
        width={680}
        className="delivery-inspector"
        destroyOnHidden
      >
        {taskInspector.displayId && (
          <DeliveryTaskDetail
            key={`${projectId}:${taskInspector.displayId}`}
            projectId={projectId}
            sessionId={sessionId}
            taskId={taskInspector.displayId}
          />
        )}
      </Drawer>
      <DeliveryExecutionInspector
        executionId={selectedExecutionId}
        sessionId={sessionId}
        workspace={data}
        onCommand={(action, payload) => commit(action, payload, false)}
        onClose={() => {
          const params = new URLSearchParams(location.hash.split("?")[1]);
          params.delete("execution_id");
          location.hash = `#/dev-flow?${params}`;
        }}
      />
      <Drawer
        open={Boolean(selected)}
        onClose={() =>
          releaseReturn ? (location.hash = releaseReturn) : navigate(view, "")
        }
        size="min(680px, 100vw)"
        title={selected?.title}
        className="delivery-inspector"
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open) locateTask();
        }}
      >
        {selected && (
          <>
            <div className="delivery-inspector-meta">
              {stageTag(selected)}
              <Tag>{selected.priority}</Tag>
              <span>
                {t("delivery.revision", { number: selected.flow.revision })}
              </span>
              <small>{selected.id}</small>
            </div>
            {selected.flow.legacy_completed && (
              <Alert type="warning" title={tr("legacy")} />
            )}
            <Tabs
              activeKey={detailTab}
              onChange={(key) => {
                navigate(
                  view,
                  selectedId,
                  key,
                  key === "tasks" ? selectedTaskId : "",
                );
              }}
              items={[
                {
                  key: "details",
                  label: tr("details"),
                  children: (
                    <>
                      <p className="delivery-description">
                        {selected.description || tr("none")}
                      </p>
                      <div className="delivery-facts">
                        <span>
                          {tr("owner")}
                          <strong>{name(selected.flow.owner_id)}</strong>
                        </span>
                        <span>
                          {tr("due")}
                          <strong>{date(selected.flow.due_on)}</strong>
                        </span>
                        <span>
                          {tr("milestone")}
                          <strong>
                            {data.milestones.find(
                              (m) => m.id === selected.flow.milestone_id,
                            )?.title || tr("none")}
                          </strong>
                        </span>
                      </div>
                      <h3>{tr("criteria")}</h3>
                      <ul className="delivery-criteria">
                        {selected.acceptance_criteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                      {selected.flow.blocked_reason && (
                        <Alert
                          type="warning"
                          title={selected.flow.blocked_reason}
                        />
                      )}
                      <Button
                        onClick={() => reqEditor(selected)}
                        disabled={!canWrite}
                      >
                        {tr("edit")}
                      </Button>
                      <section className="delivery-gates">
                        <h3>{tr("gateTitle")}</h3>
                        <p>
                          {selected.flow.gates.every((g) => g.ok)
                            ? tr("gateReady")
                            : tr("gateMissing")}
                        </p>
                        {selected.flow.gates.map((g) => (
                          <div key={g.id} className={g.ok ? "is-ready" : ""}>
                            {g.ok ? (
                              <CheckCircle2 size={16} />
                            ) : (
                              <Circle size={16} />
                            )}
                            <span>
                              {tr(`gates.${g.id}`)}
                              {!g.ok && g.id === "task_acceptance" && (
                                <small className="runtime-help">
                                  {t("deliveryTaskAcceptance.gateHint")}
                                </small>
                              )}
                            </span>
                          </div>
                        ))}
                      </section>
                      <div className="delivery-actions">
                        <Button
                          type="primary"
                          disabled={
                            !data.permissions.approve ||
                            selected.flow.closed ||
                            selected.flow.gates.some((g) => !g.ok)
                          }
                          onClick={() => reviewEditor(selected)}
                        >
                          {tr(
                            selected.flow.stage === "operations"
                              ? "close"
                              : "advance",
                          )}
                        </Button>
                        <Button
                          disabled={!data.permissions.approve}
                          onClick={() => reviewEditor(selected, true)}
                        >
                          {tr("reopen")}
                        </Button>
                      </div>
                    </>
                  ),
                },
                {
                  key: "tasks",
                  label: tr("tasks"),
                  children: (
                    <>
                      {taskTargetState(
                        data.tasks,
                        selected.id,
                        selectedTaskId,
                      ) === "missing" && (
                        <Alert
                          type="warning"
                          showIcon
                          title={tp("taskMissing")}
                          action={
                            <Button onClick={() => navigate("inbox", "")}>
                              {tp("backInbox")}
                            </Button>
                          }
                        />
                      )}
                      <p className="delivery-hint">{tr("assignmentHint")}</p>
                      <div className="delivery-actions">
                        <Button
                          onClick={() => planEditor(selected)}
                          disabled={
                            !canWrite ||
                            ["release", "operations"].includes(
                              selected.flow.stage,
                            )
                          }
                        >
                          {tr("plan")}
                        </Button>
                        <Button href="#/tasks/agent-feed">
                          {tr("dispatch")}
                        </Button>
                      </div>
                      {!data.tasks.some(
                        (task) => task.req_id === selected.id,
                      ) && (
                        <Empty
                          description={tr("noTasks")}
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      )}
                      {data.tasks
                        .filter((task) => task.req_id === selected.id)
                        .map((task) => (
                          <article
                            className={`delivery-task ${selectedTaskId === task.id ? "is-target" : ""}`}
                            key={task.id}
                            tabIndex={-1}
                            ref={(node) => {
                              if (node) taskNodes.current.set(task.id, node);
                              else taskNodes.current.delete(task.id);
                            }}
                            aria-label={
                              selectedTaskId === task.id
                                ? `${tp("taskLocated")}: ${task.title}`
                                : undefined
                            }
                          >
                            <TaskDetailContent
                              workspace={data}
                              taskId={task.id}
                              sessionId={sessionId}
                              canEdit={canWrite && !actionsDisabled}
                              onSaved={saveWorkspace}
                              onEditingChange={taskEditingChanged}
                              onCommand={(action, payload) =>
                                commit(action, payload, false)
                              }
                            />
                          </article>
                        ))}
                    </>
                  ),
                },
                {
                  key: "evidence",
                  label: tr("evidence"),
                  children: (
                    <>
                      <Button
                        disabled={!canWrite || selected.flow.closed}
                        onClick={() => evidenceEditor(selected)}
                      >
                        {tr("addEvidence")}
                      </Button>
                      {!selected.flow.artifacts.length && (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={tr("noEvidence")}
                        />
                      )}
                      {[...selected.flow.artifacts].reverse().map((a) => (
                        <article className="delivery-evidence" key={a.id}>
                          <div>
                            <Tag>{tr(`kinds.${a.kind}`)}</Tag>
                            <Tag
                              color={
                                a.result === "failed"
                                  ? "red"
                                  : a.result === "passed"
                                    ? "green"
                                    : "default"
                              }
                            >
                              {tr(`statuses.${a.result}`)}
                            </Tag>
                            {a.revision !== selected.flow.revision && (
                              <Tag>{tr("oldRevision")}</Tag>
                            )}
                            {a.stale && (
                              <Tag color="warning">{tr("staleEvidence")}</Tag>
                            )}
                          </div>
                          <h3>{a.title}</h3>
                          <p className="delivery-description">{a.content}</p>
                          {safeEvidenceUrl(a.url) && (
                            <a
                              href={safeEvidenceUrl(a.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {tr("url")} ↗
                            </a>
                          )}
                          <small>
                            {tr(
                              a.source === "execution-runtime"
                                ? "runtimeEvidence"
                                : "manual",
                            )}{" "}
                            · {date(a.at)} ·{" "}
                            {t("delivery.revision", { number: a.revision })}
                          </small>
                        </article>
                      ))}
                    </>
                  ),
                },
                {
                  key: "release",
                  label: tr("release"),
                  children: (
                    <>
                      <Alert
                        type="info"
                        showIcon
                        title={t("deliveryRelease.historicalManual")}
                        description={t("deliveryRelease.historicalHint")}
                      />
                      <Button onClick={() => navigate("releases", "")}>
                        {t("deliveryRelease.releases")}
                      </Button>
                      {!selected.flow.releases.length && (
                        <Empty
                          description={tr("noRelease")}
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      )}
                      {[...selected.flow.releases].reverse().map((r) => (
                        <article className="delivery-evidence" key={r.id}>
                          <h3>
                            {r.version} <Tag>{r.environment}</Tag>
                          </h3>
                          <small>
                            {t("delivery.revision", { number: r.revision })} ·{" "}
                            {date(r.at)}
                          </small>
                          <h4>{tr("verification")}</h4>
                          <p className="delivery-description">
                            {r.verification}
                          </p>
                          <h4>{tr("rollback")}</h4>
                          <p className="delivery-description">
                            {r.rollback_plan}
                          </p>
                          {safeEvidenceUrl(r.artifact_url) && (
                            <a
                              href={safeEvidenceUrl(r.artifact_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {tr("url")} ↗
                            </a>
                          )}
                        </article>
                      ))}
                    </>
                  ),
                },
                {
                  key: "activity",
                  label: tr("activity"),
                  children: (
                    <>
                      {selected.flow.reviews.map((r, i) => (
                        <article className="delivery-evidence" key={i}>
                          <Tag>{tr(`stages.${r.stage}`)}</Tag>
                          <strong>
                            {r.decision === "reopen"
                              ? tr("reopen")
                              : tr("advance")}
                          </strong>
                          <p>{r.comment}</p>
                          <small>
                            {date(r.at)} ·{" "}
                            {t("delivery.revision", { number: r.revision })}
                          </small>
                        </article>
                      ))}
                      {activityView(selected)}
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      {editor && (
        <DeliveryEditor spec={editor} onClose={() => setEditor(null)} />
      )}
      {planRequirement && data && (
        <DeliveryTaskPlanEditor
          key={planRequirement.id}
          data={data}
          requirement={planRequirement}
          onClose={() => setPlanRequirement(null)}
          onSaved={(updated) => {
            if (originScope.current !== sessionSnapshot()) return;
            qc.setQueryData(queryKey, updated);
            setPlanRequirement(null);
            navigate("list", planRequirement.id, "tasks");
          }}
        />
      )}
    </section>
  );
}
