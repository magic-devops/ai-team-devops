import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Input, InputNumber, Popconfirm, Select, Space, Table, Tag as AntTag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api } from "@/lib/api";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { getToken } from "@/lib/authStorage";
import { NeedLogin, RefreshButton } from "@/components/PageStates";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { WorkbenchPanel } from "@/pages/shared/workbenchUi";

type Tab = "catalog" | "rules" | "ontology" | "profiles" | "governance" | "approvals";

const TAB_KEYS: Tab[] = ["catalog", "rules", "ontology", "profiles", "governance", "approvals"];
const TAB_HREF: Record<Tab, string> = {
  catalog: "#/data/tags/catalog",
  rules: "#/data/tags/rules",
  ontology: "#/data/tags/ontology",
  profiles: "#/data/tags/api",
  governance: "#/data/tags/governance",
  approvals: "#/data/tags/approvals",
};
const TAB_META: Record<Tab, { labelKey: string; titleKey: string; descriptionKey: string; focusKey: string }> = {
  catalog: {
    labelKey: "page.tagService.tabs.catalog",
    titleKey: "page.tagService.modules.catalog.title",
    descriptionKey: "page.tagService.modules.catalog.description",
    focusKey: "page.tagService.modules.catalog.focus",
  },
  rules: {
    labelKey: "page.tagService.tabs.rules",
    titleKey: "page.tagService.modules.rules.title",
    descriptionKey: "page.tagService.modules.rules.description",
    focusKey: "page.tagService.modules.rules.focus",
  },
  ontology: {
    labelKey: "page.tagService.tabs.ontology",
    titleKey: "page.tagService.modules.ontology.title",
    descriptionKey: "page.tagService.modules.ontology.description",
    focusKey: "page.tagService.modules.ontology.focus",
  },
  profiles: {
    labelKey: "page.tagService.tabs.profiles",
    titleKey: "page.tagService.modules.profiles.title",
    descriptionKey: "page.tagService.modules.profiles.description",
    focusKey: "page.tagService.modules.profiles.focus",
  },
  governance: {
    labelKey: "page.tagService.tabs.governance",
    titleKey: "page.tagService.modules.governance.title",
    descriptionKey: "page.tagService.modules.governance.description",
    focusKey: "page.tagService.modules.governance.focus",
  },
  approvals: {
    labelKey: "page.tagService.tabs.approvals",
    titleKey: "page.tagService.modules.approvals.title",
    descriptionKey: "page.tagService.modules.approvals.description",
    focusKey: "page.tagService.modules.approvals.focus",
  },
};

const DEFAULT_PROFILE_RECORDS = `[
  {"agent_id":"a-1","quality_score":92,"tier":"gold"},
  {"agent_id":"a-2","quality_score":55,"tier":"silver"}
]`;

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 0);
  } catch {
    return "{}";
  }
}

export function TagWorkbench({ focused = false, initialTab = "catalog" }: { focused?: boolean; initialTab?: Tab }) {
  const authed = Boolean(getToken());
  const { t } = useTranslation();
  const [aiOpen, setAiOpen] = useState(false);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showForm, setShowForm] = useState(false);
  const [tagForm, setTagForm] = useState({ name: "", category: "general", description: "", value_type: "string", owner: "", applies_to: "" });
  const [ruleForm, setRuleForm] = useState({ tag_id: "", entity_type: "", field: "", operator: ">=", value: "", output_value: "true", priority: 0 });
  const [entityForm, setEntityForm] = useState({ entity_type: "", name: "" });
  const [evaluateForm, setEvaluateForm] = useState({ entity_type: "agent", sample: "{\"quality_score\":92,\"tier\":\"gold\"}" });
  const [profileForm, setProfileForm] = useState({ entity_type: "agent", profile_name: "Agent Readiness Profile", records: DEFAULT_PROFILE_RECORDS, publish: true });
  const [jsonError, setJsonError] = useState("");
  const [evaluateResult, setEvaluateResult] = useState<any>(null);
  const [buildResult, setBuildResult] = useState<any>(null);
  const [contractResult, setContractResult] = useState<any>(null);
  const [governancePayload, setGovernancePayload] = useState<any>(null);
  const [governanceAction, setGovernanceAction] = useState<"preview" | "create" | null>(null);
  const [approvalStatus, setApprovalStatus] = useState("pending");
  const [approvalEntityId, setApprovalEntityId] = useState("");
  const [approvalReason, setApprovalReason] = useState("");

  useEffect(() => {
    setTab(initialTab);
    setShowForm(false);
  }, [initialTab]);

  const tagsQ = useQuery({ queryKey: ["tagCatalog"], queryFn: () => api.tagCatalog(), enabled: authed });
  const profileBuildsEntityType = tab === "governance" ? "" : profileForm.entity_type;
  const rulesQ = useQuery({ queryKey: ["tagRules"], queryFn: () => api.tagRules(), enabled: authed && (tab === "rules" || tab === "governance" || tab === "approvals") });
  const ontologyQ = useQuery({ queryKey: ["tagOntology"], queryFn: () => api.tagOntology(), enabled: authed && (tab === "ontology" || tab === "governance" || tab === "approvals") });
  const profileBuildsQ = useQuery({ queryKey: ["tagProfileBuilds", profileBuildsEntityType], queryFn: () => api.tagProfileBuilds(profileBuildsEntityType), enabled: authed && (tab === "profiles" || tab === "governance") });
  const approvalsQ = useQuery({ queryKey: ["tagApprovals", approvalStatus], queryFn: () => api.tagApprovals(approvalStatus), enabled: authed && tab === "approvals" });

  function parseJson(value: string, fallback: any) {
    try {
      setJsonError("");
      return JSON.parse(value);
    } catch (err: any) {
      setJsonError(err?.message || t("page.tagService.messages.invalidJson"));
      return fallback;
    }
  }

  const createTag = useMutation({
    mutationFn: () => api.tagCreate({ ...tagForm, applies_to: splitList(tagForm.applies_to) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tagCatalog"] });
      setShowForm(false);
      setTagForm({ name: "", category: "general", description: "", value_type: "string", owner: "", applies_to: "" });
    },
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => api.tagDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagCatalog"] }),
  });
  const createRule = useMutation({
    mutationFn: () => api.tagRuleCreate({
      tag_id: ruleForm.tag_id,
      entity_type: ruleForm.entity_type,
      condition: { field: ruleForm.field, operator: ruleForm.operator, value: Number.isNaN(Number(ruleForm.value)) || ruleForm.value.trim() === "" ? ruleForm.value : Number(ruleForm.value) },
      output_value: ruleForm.output_value === "true" ? true : ruleForm.output_value === "false" ? false : ruleForm.output_value,
      priority: ruleForm.priority,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tagRules"] });
      setShowForm(false);
    },
  });
  const createEntity = useMutation({
    mutationFn: () => api.tagEntityCreate(entityForm),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tagOntology"] });
      setShowForm(false);
      setEntityForm({ entity_type: "", name: "" });
    },
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api.tagRuleDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagRules"] }),
  });
  const deleteEntity = useMutation({
    mutationFn: (id: string) => api.tagEntityDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tagOntology"] }),
  });
  const evaluateRule = useMutation({
    mutationFn: () => api.tagRuleEvaluate({ entity_type: evaluateForm.entity_type, sample: parseJson(evaluateForm.sample, {}) }),
    onSuccess: (data) => setEvaluateResult(data),
  });
  const buildProfile = useMutation({
    mutationFn: () => api.tagProfileBuild({
      entity_type: profileForm.entity_type,
      profile_name: profileForm.profile_name,
      records: parseJson(profileForm.records, []),
      publish: profileForm.publish,
    }),
    onSuccess: (data) => {
      setBuildResult(data);
      void qc.invalidateQueries({ queryKey: ["tagProfileBuilds", profileForm.entity_type] });
    },
  });
  const publishContract = useMutation({
    mutationFn: (id: string) => api.tagPublishContract(id),
    onSuccess: (data) => setContractResult(data),
  });
  const governanceTasks = useMutation({
    mutationFn: (dryRun: boolean) => api.tagGovernanceTasks({
      ids: governanceCandidateIds,
      dry_run: dryRun,
      priority: "P1",
      assigned_to: "TagOps Agent",
      dev_tool: "codex",
      min_coverage: 0.8,
    }),
    onSuccess: (data) => setGovernancePayload(data),
    onSettled: () => setGovernanceAction(null),
  });
  const createApproval = useMutation({
    mutationFn: (entityId: string) => api.tagApprovalCreate({
      target_type: "entity",
      target_id: entityId,
      action: "publish_contract",
      reason: approvalReason,
      requested_by: "TagOps Agent",
      reviewers: ["Data Governance"],
      payload: {},
      auto_apply_on_approval: true,
    }),
    onSuccess: () => {
      setApprovalReason("");
      void qc.invalidateQueries({ queryKey: ["tagApprovals"] });
    },
  });
  const reviewApproval = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) => api.tagApprovalReview(id, {
      status,
      reviewer: "Data Governance",
      note: status === "approved" ? t("page.tagService.approvals.approveNote") : t("page.tagService.approvals.rejectNote"),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tagApprovals"] });
      void qc.invalidateQueries({ queryKey: ["tagOntology"] });
      void qc.invalidateQueries({ queryKey: ["tagCatalog"] });
      void qc.invalidateQueries({ queryKey: ["tagRules"] });
    },
  });

  const tags = tagsQ.data?.items ?? [];
  const rules = rulesQ.data?.items ?? [];
  const entities = ontologyQ.data?.entities ?? [];
  const builds = profileBuildsQ.data?.items ?? [];
  const approvals = approvalsQ.data?.items ?? [];
  const approvalCounts = approvalsQ.data?.counts ?? {};
  const activeApprovalEntity = entities.find((item: any) => item.id === approvalEntityId) ?? entities[0];
  const rulesByTag = useMemo<Map<string, any[]>>(() => new Map(tags.map((tag: any) => [tag.id, rules.filter((rule: any) => rule.tag_id === tag.id)])), [tags, rules]);
  const entityTypesWithRules = useMemo(() => new Set(rules.map((rule: any) => rule.entity_type).filter(Boolean)), [rules]);
  const entityTypesWithBuilds = useMemo(() => new Set(builds.map((build: any) => build.entity_type).filter(Boolean)), [builds]);
  const governanceCandidates = useMemo(() => {
    const tagCandidates = tags.filter((tag: any) => !tag.owner || !(tag.applies_to ?? []).length || !(rulesByTag.get(tag.id) ?? []).length);
    const ruleCandidates = rules.filter((rule: any) => !rule.condition?.field);
    const entityCandidates = entities.filter((entity: any) => !entityTypesWithRules.has(entity.entity_type) || !entityTypesWithBuilds.has(entity.entity_type));
    const buildCandidates = builds.filter((build: any) => Number(build.coverage || 0) < 0.8);
    return [...tagCandidates, ...ruleCandidates, ...entityCandidates, ...buildCandidates];
  }, [tags, rules, entities, builds, rulesByTag, entityTypesWithRules, entityTypesWithBuilds]);
  const governanceCandidateIds = useMemo(() => governanceCandidates.map((item: any) => item.id).filter(Boolean), [governanceCandidates]);
  const tagNameById = useMemo(() => new Map(tags.map((item: any) => [item.id, item.name])), [tags]);
  const activeMetaDef = TAB_META[tab];
  const activeMeta = {
    title: t(activeMetaDef.titleKey),
    description: t(activeMetaDef.descriptionKey),
    focus: t(activeMetaDef.focusKey),
  };
  const tabLabel = (tabId: Tab) => {
    if (tabId === "catalog") return `${t(TAB_META[tabId].labelKey)} (${tags.length})`;
    if (tabId === "rules") return `${t(TAB_META[tabId].labelKey)} (${rules.length})`;
    if (tabId === "governance") return `${t(TAB_META[tabId].labelKey)} (${governanceCandidates.length})`;
    if (tabId === "approvals") return `${t(TAB_META[tabId].labelKey)} (${approvalCounts.pending ?? 0})`;
    return t(TAB_META[tabId].labelKey);
  };

  const catalogColumns: ColumnsType<any> = [
    {
      title: t("page.tagService.catalog.name"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[180px]">
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.description || t("page.tagService.catalog.noDescription")}</p>
        </div>
      ),
    },
    { title: t("page.tagService.catalog.category"), dataIndex: "category", width: 130, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.tagService.catalog.valueType"), dataIndex: "value_type", width: 120, render: (value) => <AntTag color="blue">{value || "-"}</AntTag> },
    { title: t("page.tagService.catalog.owner"), dataIndex: "owner", width: 130, render: (value) => value || <span className="text-amber-600">{t("page.tagService.catalog.unassigned")}</span> },
    {
      title: t("page.tagService.catalog.appliesTo"),
      dataIndex: "applies_to",
      render: (items: string[] = []) => <Space wrap>{items.map((item) => <AntTag key={item} color="geekblue">{item}</AntTag>)}</Space>,
    },
    { title: t("page.tagService.catalog.status"), dataIndex: "status", width: 100, render: (value) => <AntTag color={value === "active" ? "green" : "default"}>{value || "-"}</AntTag> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 100,
      render: (_value, row) => (
        <Popconfirm title={t("page.tagService.catalog.confirmDelete")} onConfirm={() => deleteTag.mutate(row.id)}>
          <Button size="small" danger loading={deleteTag.isPending}>{t("common.delete")}</Button>
        </Popconfirm>
      ),
    },
  ];

  const ruleColumns: ColumnsType<any> = [
    { title: t("page.tagService.rules.tag"), dataIndex: "tag_id", width: 180, render: (value) => tagNameById.get(value) || <span className="font-mono text-xs">{String(value || "").slice(0, 10) || "-"}</span> },
    { title: t("page.tagService.rules.entity"), dataIndex: "entity_type", width: 140, render: (value) => value || t("common.all") },
    { title: t("page.tagService.rules.condition"), dataIndex: "condition", render: (value) => <span className="font-mono text-xs text-[var(--muted)]">{stringifyJson(value)}</span> },
    { title: t("page.tagService.rules.output"), dataIndex: "output_value", width: 120, render: (value) => String(value) },
    { title: t("page.tagService.rules.priority"), dataIndex: "priority", width: 100 },
    { title: t("page.tagService.rules.status"), dataIndex: "status", width: 100, render: (value) => <AntTag>{value || "-"}</AntTag> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 100,
      render: (_value, row) => (
        <Popconfirm title={t("page.tagService.rules.confirmDelete")} onConfirm={() => deleteRule.mutate(row.id)}>
          <Button size="small" danger loading={deleteRule.isPending}>{t("common.delete")}</Button>
        </Popconfirm>
      ),
    },
  ];

  const ontologyColumns: ColumnsType<any> = [
    {
      title: t("page.tagService.ontology.entity"),
      dataIndex: "name",
      render: (_value, row) => (
        <div>
          <p className="font-semibold text-[var(--text)]">{row.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.entity_type}</p>
        </div>
      ),
    },
    { title: t("page.tagService.ontology.type"), dataIndex: "entity_type", width: 160, render: (value) => <AntTag color="purple">{value || "-"}</AntTag> },
    {
      title: t("common.actions"),
      key: "actions",
      width: 220,
      render: (_value, row) => (
        <Space wrap>
          <Button size="small" type="link" loading={publishContract.isPending} onClick={() => publishContract.mutate(row.id)}>{t("page.tagService.ontology.publishContract")}</Button>
          <Popconfirm title={t("page.tagService.ontology.confirmDelete")} onConfirm={() => deleteEntity.mutate(row.id)}>
            <Button size="small" danger>{t("common.delete")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const buildColumns: ColumnsType<any> = [
    { title: t("page.tagService.profiles.profileName"), dataIndex: "profile_name" },
    { title: t("page.tagService.profiles.status"), dataIndex: "status", width: 120, render: (value) => <AntTag>{value || "-"}</AntTag> },
    { title: t("page.tagService.profiles.records"), dataIndex: "records_total", width: 110 },
    { title: t("page.tagService.profiles.tagged"), dataIndex: "tagged_records", width: 110 },
    { title: t("page.tagService.profiles.coverage"), dataIndex: "coverage", width: 120, render: (value) => `${(Number(value || 0) * 100).toFixed(1)}%` },
  ];
  const governanceColumns: ColumnsType<any> = [
    {
      title: t("page.tagService.governance.asset"),
      dataIndex: "name",
      render: (_value, row) => (
        <div className="min-w-[180px]">
          <p className="font-medium text-[var(--text)]">{row.name || row.profile_name || row.entity_type || row.id}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.category || row.entity_type || row.status || "-"}</p>
        </div>
      ),
    },
    {
      title: t("page.tagService.governance.issue"),
      key: "issue",
      render: (_value, row) => {
        const issues = [
          !row.owner && row.name ? t("page.tagService.governance.missingOwner") : "",
          row.name && !(row.applies_to ?? []).length ? t("page.tagService.governance.missingScope") : "",
          row.name && !(rulesByTag.get(row.id) ?? []).length ? t("page.tagService.governance.missingRule") : "",
          row.condition && !row.condition?.field ? t("page.tagService.governance.invalidCondition") : "",
          row.entity_type && !entityTypesWithRules.has(row.entity_type) ? t("page.tagService.governance.entityWithoutRules") : "",
          row.entity_type && !entityTypesWithBuilds.has(row.entity_type) ? t("page.tagService.governance.missingBuild") : "",
          row.profile_name && Number(row.coverage || 0) < 0.8 ? t("page.tagService.governance.lowCoverage") : "",
        ].filter(Boolean);
        return <Space wrap>{issues.slice(0, 3).map((issue) => <AntTag key={issue} color="orange">{issue}</AntTag>)}</Space>;
      },
    },
  ];
  const taskColumns: ColumnsType<any> = [
    {
      title: t("page.tagService.tasks.title"),
      dataIndex: "title",
      render: (value, row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-[var(--text)]">{value}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.description}</p>
        </div>
      ),
    },
    { title: t("page.tagService.tasks.priority"), dataIndex: "priority", width: 90, render: (value) => <AntTag color={value === "P0" ? "red" : "orange"}>{value || "P1"}</AntTag> },
    { title: t("page.tagService.tasks.labels"), dataIndex: "labels", width: 260, render: (labels) => <Space size={[4, 4]} wrap>{(labels ?? []).slice(0, 4).map((label: string) => <AntTag key={label}>{label}</AntTag>)}</Space> },
  ];
  const approvalColumns: ColumnsType<any> = [
    {
      title: t("page.tagService.approvals.target"),
      dataIndex: "target_name",
      render: (value, row) => (
        <div className="min-w-[220px]">
          <p className="font-medium text-[var(--text)]">{value || row.target_id}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{row.target_type} · <span className="font-mono">{row.target_id}</span></p>
        </div>
      ),
    },
    { title: t("page.tagService.approvals.action"), dataIndex: "action", width: 160, render: (value) => <AntTag color="blue">{value}</AntTag> },
    { title: t("page.tagService.approvals.status"), dataIndex: "status", width: 120, render: (value) => <AntTag color={value === "pending" ? "orange" : value === "approved" ? "green" : "default"}>{value}</AntTag> },
    { title: t("page.tagService.approvals.risk"), dataIndex: ["risk", "risk_level"], width: 110, render: (value) => <AntTag color={value === "high" ? "red" : "orange"}>{value || "medium"}</AntTag> },
    { title: t("page.tagService.approvals.requestedBy"), dataIndex: "requested_by", width: 150 },
    {
      title: t("common.actions"),
      key: "actions",
      width: 190,
      render: (_value, row) => row.status === "pending" ? (
        <Space wrap>
          <Button size="small" type="primary" loading={reviewApproval.isPending} onClick={() => reviewApproval.mutate({ id: row.id, status: "approved" })}>{t("page.tagService.approvals.approve")}</Button>
          <Button size="small" danger loading={reviewApproval.isPending} onClick={() => reviewApproval.mutate({ id: row.id, status: "rejected" })}>{t("page.tagService.approvals.reject")}</Button>
        </Space>
      ) : <span className="text-xs text-[var(--muted)]">{row.review_note || "-"}</span>,
    },
  ];

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-4">
      <WorkbenchShell title={focused ? activeMeta.title : t("page.tagService.workbenchTitle")} description={focused ? activeMeta.description : t("page.tagService.workbenchDesc")}>
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          {focused ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">{t("page.tagService.focusedTag")}</span>
                  <a href="#/data/tags" className="text-xs font-medium text-[var(--brand)] hover:underline">{t("page.tagService.backToHub")}</a>
                  <span className="hidden text-xs text-[var(--muted)] sm:inline">{t("page.tagService.focusedHint")}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--text)]">{activeMeta.focus}</p>
              </div>
              <Select
                className="min-w-48"
                value={tab}
                options={TAB_KEYS.map((tabId) => ({ value: tabId, label: t(TAB_META[tabId].labelKey) }))}
                onChange={(next) => { window.location.hash = TAB_HREF[next as Tab].slice(1); }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {TAB_KEYS.map((tabId) => (
                <Button key={tabId} type={tab === tabId ? "primary" : "text"} onClick={() => { setTab(tabId); setShowForm(false); }}>
                  {tabLabel(tabId)}
                </Button>
              ))}
            </div>
          )}
        </div>

        {tab === "catalog" && (
          <WorkbenchPanel title={t("page.tagService.panels.catalog")} actions={
            <Space wrap>
              <AiAssistButton onClick={() => setAiOpen(true)} />
              <RefreshButton onClick={() => void tagsQ.refetch()} pending={tagsQ.isFetching} />
              <Button type="primary" onClick={() => setShowForm((value) => !value)}>{t("page.tagService.catalog.create")}</Button>
            </Space>
          }>
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.tagService.catalog.nameRequired")} value={tagForm.name} onChange={(event) => setTagForm((form) => ({ ...form, name: event.target.value }))} />
                  <Input placeholder={t("page.tagService.catalog.category")} value={tagForm.category} onChange={(event) => setTagForm((form) => ({ ...form, category: event.target.value }))} />
                  <Select value={tagForm.value_type} options={["string", "number", "boolean", "enum"].map((value) => ({ value, label: value }))} onChange={(value) => setTagForm((form) => ({ ...form, value_type: value }))} />
                  <Input placeholder={t("page.tagService.catalog.owner")} value={tagForm.owner} onChange={(event) => setTagForm((form) => ({ ...form, owner: event.target.value }))} />
                  <Input placeholder={t("page.tagService.catalog.appliesToPlaceholder")} value={tagForm.applies_to} onChange={(event) => setTagForm((form) => ({ ...form, applies_to: event.target.value }))} />
                  <Input placeholder={t("page.tagService.catalog.description")} value={tagForm.description} onChange={(event) => setTagForm((form) => ({ ...form, description: event.target.value }))} />
                </div>
                <Space className="mt-3">
                  <Button type="primary" loading={createTag.isPending} disabled={!tagForm.name} onClick={() => createTag.mutate()}>{t("common.create")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={catalogColumns} dataSource={tags} loading={tagsQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 980 }} locale={{ emptyText: t("page.tagService.catalog.empty") }} />
          </WorkbenchPanel>
        )}

        {tab === "rules" && (
          <WorkbenchPanel title={t("page.tagService.panels.rules")} actions={
            <Space wrap>
              <RefreshButton onClick={() => void rulesQ.refetch()} pending={rulesQ.isFetching} />
              <Button type="primary" onClick={() => setShowForm((value) => !value)}>{t("page.tagService.rules.create")}</Button>
            </Space>
          }>
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    placeholder={t("page.tagService.rules.selectTag")}
                    value={ruleForm.tag_id || undefined}
                    options={tags.map((item: any) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => setRuleForm((form) => ({ ...form, tag_id: value }))}
                  />
                  <Input placeholder={t("page.tagService.rules.entityPlaceholder")} value={ruleForm.entity_type} onChange={(event) => setRuleForm((form) => ({ ...form, entity_type: event.target.value }))} />
                  <Input placeholder={t("page.tagService.rules.field")} value={ruleForm.field} onChange={(event) => setRuleForm((form) => ({ ...form, field: event.target.value }))} />
                  <Select value={ruleForm.operator} options={["==", "!=", ">=", ">", "<=", "<", "contains", "in", "exists"].map((value) => ({ value, label: value }))} onChange={(value) => setRuleForm((form) => ({ ...form, operator: value }))} />
                  <Input placeholder={t("page.tagService.rules.value")} value={ruleForm.value} onChange={(event) => setRuleForm((form) => ({ ...form, value: event.target.value }))} />
                  <Input placeholder={t("page.tagService.rules.output")} value={ruleForm.output_value} onChange={(event) => setRuleForm((form) => ({ ...form, output_value: event.target.value }))} />
                  <InputNumber className="w-full" placeholder={t("page.tagService.rules.priority")} value={ruleForm.priority} onChange={(value) => setRuleForm((form) => ({ ...form, priority: Number(value ?? 0) }))} />
                </div>
                <Space className="mt-3">
                  <Button type="primary" loading={createRule.isPending} disabled={!ruleForm.tag_id} onClick={() => createRule.mutate()}>{t("common.create")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={ruleColumns} dataSource={rules} loading={rulesQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 980 }} locale={{ emptyText: t("page.tagService.rules.empty") }} />
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <p className="mb-3 text-sm font-semibold">{t("page.tagService.rules.testTitle")}</p>
              <div className="grid gap-3 lg:grid-cols-[220px_1fr_auto]">
                <Input placeholder={t("page.tagService.rules.entity")} value={evaluateForm.entity_type} onChange={(event) => setEvaluateForm((form) => ({ ...form, entity_type: event.target.value }))} />
                <Input.TextArea className="font-mono text-xs" rows={3} value={evaluateForm.sample} onChange={(event) => setEvaluateForm((form) => ({ ...form, sample: event.target.value }))} />
                <Button loading={evaluateRule.isPending} onClick={() => evaluateRule.mutate()}>{t("page.tagService.rules.test")}</Button>
              </div>
              {jsonError ? <Alert className="mt-3" type="error" showIcon message={jsonError} /> : null}
              {evaluateResult ? <Alert className="mt-3" type="success" showIcon message={t("page.tagService.rules.testResult", { count: evaluateResult.matched_count, tags: evaluateResult.matches?.map((match: any) => match.tag_name).join(", ") || t("page.tagService.rules.noMatch") })} /> : null}
            </div>
          </WorkbenchPanel>
        )}

        {tab === "ontology" && (
          <WorkbenchPanel title={t("page.tagService.panels.ontology")} actions={
            <Space wrap>
              <RefreshButton onClick={() => void ontologyQ.refetch()} pending={ontologyQ.isFetching} />
              <Button type="primary" onClick={() => setShowForm((value) => !value)}>{t("page.tagService.ontology.create")}</Button>
            </Space>
          }>
            {showForm ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.tagService.ontology.typePlaceholder")} value={entityForm.entity_type} onChange={(event) => setEntityForm((form) => ({ ...form, entity_type: event.target.value }))} />
                  <Input placeholder={t("page.tagService.ontology.nameRequired")} value={entityForm.name} onChange={(event) => setEntityForm((form) => ({ ...form, name: event.target.value }))} />
                </div>
                <Space className="mt-3">
                  <Button type="primary" loading={createEntity.isPending} disabled={!entityForm.name} onClick={() => createEntity.mutate()}>{t("common.create")}</Button>
                  <Button onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                </Space>
              </div>
            ) : null}
            <Table rowKey="id" columns={ontologyColumns} dataSource={entities} loading={ontologyQ.isFetching} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: t("page.tagService.ontology.empty") }} />
            {contractResult ? (
              <Alert
                className="mt-4"
                type="success"
                showIcon
                message={t("page.tagService.ontology.contractPublished", { name: contractResult.entity_name })}
                description={<span className="font-mono text-xs">{contractResult.endpoint} · {t("page.tagService.ontology.tags")}: {contractResult.tags?.join(", ") || t("page.tagService.rules.noMatch")}</span>}
              />
            ) : null}
          </WorkbenchPanel>
        )}

        {tab === "profiles" && (
          <WorkbenchPanel title={t("page.tagService.panels.profiles")} actions={<RefreshButton onClick={() => void profileBuildsQ.refetch()} pending={profileBuildsQ.isFetching} />}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t("page.tagService.profiles.entityType")} value={profileForm.entity_type} onChange={(event) => setProfileForm((form) => ({ ...form, entity_type: event.target.value }))} />
                  <Input placeholder={t("page.tagService.profiles.profileName")} value={profileForm.profile_name} onChange={(event) => setProfileForm((form) => ({ ...form, profile_name: event.target.value }))} />
                </div>
                <Input.TextArea className="mt-3 font-mono text-xs" rows={8} value={profileForm.records} onChange={(event) => setProfileForm((form) => ({ ...form, records: event.target.value }))} />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Checkbox checked={profileForm.publish} onChange={(event) => setProfileForm((form) => ({ ...form, publish: event.target.checked }))}>{t("page.tagService.profiles.publishAfterBuild")}</Checkbox>
                  <Button type="primary" loading={buildProfile.isPending} onClick={() => buildProfile.mutate()}>{t("page.tagService.profiles.build")}</Button>
                </div>
                {buildResult ? (
                  <Alert
                    className="mt-3"
                    type="success"
                    showIcon
                    message={buildResult.profile_name}
                    description={t("page.tagService.profiles.buildResult", { total: buildResult.records_total, tagged: buildResult.tagged_records, coverage: (Number(buildResult.coverage || 0) * 100).toFixed(1) })}
                  />
                ) : null}
              </div>
              <WorkbenchPanel title={t("page.tagService.profiles.history")}>
                <Table rowKey="id" columns={buildColumns} dataSource={builds} loading={profileBuildsQ.isFetching} pagination={{ pageSize: 6 }} size="small" locale={{ emptyText: t("page.tagService.profiles.emptyBuilds") }} />
              </WorkbenchPanel>
            </div>
          </WorkbenchPanel>
        )}

        {tab === "governance" && (
          <WorkbenchPanel title={t("page.tagService.panels.governance")} actions={
            <Space wrap>
              <Button loading={governanceTasks.isPending && governanceAction === "preview"} onClick={() => { setGovernanceAction("preview"); governanceTasks.mutate(true); }}>
                {t("page.tagService.tasks.preview")}
              </Button>
              <Button type="primary" loading={governanceTasks.isPending && governanceAction === "create"} disabled={!governanceCandidates.length} onClick={() => { setGovernanceAction("create"); governanceTasks.mutate(false); }}>
                {t("page.tagService.tasks.create")}
              </Button>
              <RefreshButton onClick={() => { void tagsQ.refetch(); void rulesQ.refetch(); void ontologyQ.refetch(); void profileBuildsQ.refetch(); }} pending={tagsQ.isFetching || rulesQ.isFetching || ontologyQ.isFetching || profileBuildsQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <GovernanceCard label={t("page.tagService.governance.tags")} value={tags.length} />
              <GovernanceCard label={t("page.tagService.governance.rules")} value={rules.length} />
              <GovernanceCard label={t("page.tagService.governance.entities")} value={entities.length} />
              <GovernanceCard label={t("page.tagService.governance.todos")} value={governanceCandidates.length} tone="warn" />
            </div>
            <Table
              rowKey="id"
              columns={governanceColumns}
              dataSource={governanceCandidates}
              loading={tagsQ.isFetching || rulesQ.isFetching || ontologyQ.isFetching || profileBuildsQ.isFetching}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 760 }}
              locale={{ emptyText: t("page.tagService.governance.empty") }}
            />
            {governancePayload ? (
              <Alert
                className="mt-4"
                type={governancePayload.dry_run ? "info" : "success"}
                showIcon
                message={governancePayload.dry_run ? t("page.tagService.tasks.previewSummary", { count: governancePayload.planned ?? 0 }) : t("page.tagService.tasks.createdSummary", { count: governancePayload.created_count ?? governancePayload.created?.length ?? 0 })}
                description={
                  <Table
                    className="mt-3"
                    rowKey={(row) => `${row.source_report_id}-${row.title}`}
                    columns={taskColumns}
                    dataSource={governancePayload.items ?? []}
                    pagination={{ pageSize: 5 }}
                    scroll={{ x: 760 }}
                    locale={{ emptyText: t("page.tagService.tasks.empty") }}
                  />
                }
              />
            ) : null}
          </WorkbenchPanel>
        )}

        {tab === "approvals" && (
          <WorkbenchPanel title={t("page.tagService.panels.approvals")} actions={
            <Space wrap>
              <Select
                className="min-w-36"
                value={approvalStatus}
                options={["pending", "approved", "rejected", "cancelled"].map((value) => ({ value, label: t(`page.tagService.approvals.statusOptions.${value}`) }))}
                onChange={setApprovalStatus}
              />
              <RefreshButton onClick={() => void approvalsQ.refetch()} pending={approvalsQ.isFetching} />
            </Space>
          }>
            <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.tagService.approvals.createTitle")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    placeholder={t("page.tagService.approvals.selectEntity")}
                    value={activeApprovalEntity?.id}
                    options={entities.map((item: any) => ({ value: item.id, label: `${item.name} · ${item.entity_type}` }))}
                    onChange={setApprovalEntityId}
                  />
                  <Input value="publish_contract" disabled />
                  <Input className="md:col-span-2" value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder={t("page.tagService.approvals.reason")} />
                </div>
                <Button className="mt-3" type="primary" loading={createApproval.isPending} disabled={!activeApprovalEntity?.id} onClick={() => activeApprovalEntity?.id && createApproval.mutate(activeApprovalEntity.id)}>
                  {t("page.tagService.approvals.create")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <GovernanceCard label={t("page.tagService.approvals.pending")} value={approvalCounts.pending ?? 0} tone="warn" />
                <GovernanceCard label={t("page.tagService.approvals.approved")} value={approvalCounts.approved ?? 0} />
                <GovernanceCard label={t("page.tagService.approvals.rejected")} value={approvalCounts.rejected ?? 0} />
              </div>
            </div>
            <Table
              rowKey="id"
              columns={approvalColumns}
              dataSource={approvals}
              loading={approvalsQ.isFetching}
              pagination={{ pageSize: 8 }}
              scroll={{ x: 1080 }}
              locale={{ emptyText: t("page.tagService.approvals.empty") }}
              expandable={{
                expandedRowRender: (row) => (
                  <div className="grid gap-3 text-xs lg:grid-cols-3">
                    <div>
                      <p className="text-[var(--muted)]">{t("page.tagService.approvals.reason")}</p>
                      <p className="mt-1 text-[var(--text)]">{row.reason || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)]">{t("page.tagService.approvals.reviewers")}</p>
                      <p className="mt-1 text-[var(--text)]">{(row.reviewers ?? []).join(", ") || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[var(--muted)]">{t("page.tagService.approvals.applied")}</p>
                      <p className="mt-1 font-mono text-[var(--brand)]">{row.applied_result?.endpoint || "-"}</p>
                    </div>
                  </div>
                ),
              }}
            />
          </WorkbenchPanel>
        )}
        <AiAssistDrawer open={aiOpen} onClose={() => setAiOpen(false)} module="tag-service" title={t("page.tagService.aiTitle")} initialPrompt={t("page.tagService.aiPrompt")} />
      </WorkbenchShell>
    </div>
  );
}

function GovernanceCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-orange-600" : "text-[var(--text)]"}`}>{value}</p>
    </div>
  );
}
