import { Alert, Button, Input, List, Popconfirm, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";
import { ModuleFrame } from "./ModuleFrame";
import type { OrganizationPolicy, OrganizationPolicyCheckResult, OrganizationPolicyHistoryItem } from "./types";

type RoleRow = { role: string; level: number; scope: string; capabilities: string[]; assignable: boolean };
type PolicyDraft = {
  user_capability_map: Record<string, string[]>;
  project_capability_map: Record<string, string[]>;
  field_security_rules: Array<Record<string, any>>;
  row_filter_rules: Array<Record<string, any>>;
  notes: string;
};
type CheckDraft = { scope: "tenant" | "project"; role: string; capability: string; resource: string; action: string; fields: string; row: string };

const parseCsv = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function RolePolicyModule({
  policy,
  loading,
  error,
  savePending = false,
  resetPending = false,
  history = [],
  historyLoading = false,
  checkPending = false,
  checkResult,
  saveError,
  resetError,
  checkError,
  onSave,
  onReset,
  onCheck,
}: {
  policy?: OrganizationPolicy;
  loading: boolean;
  error?: Error | null;
  savePending?: boolean;
  resetPending?: boolean;
  history?: OrganizationPolicyHistoryItem[];
  historyLoading?: boolean;
  checkPending?: boolean;
  checkResult?: OrganizationPolicyCheckResult;
  saveError?: Error | null;
  resetError?: Error | null;
  checkError?: Error | null;
  onSave?: (body: PolicyDraft) => void;
  onReset?: () => void;
  onCheck?: (body: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PolicyDraft>({ user_capability_map: {}, project_capability_map: {}, field_security_rules: [], row_filter_rules: [], notes: "" });
  const [fieldRuleDraft, setFieldRuleDraft] = useState({ resource: "organization.users", fields: "email,password_hash", roles: "viewer", action: "mask", mask: "partial" });
  const [rowRuleDraft, setRowRuleDraft] = useState({ resource: "organization.users", roles: "viewer", effect: "deny", conditions: "{\"status\":\"disabled\"}" });
  const [checkDraft, setCheckDraft] = useState<CheckDraft>({
    scope: "tenant",
    role: "developer",
    capability: "task.claim",
    resource: "organization.users",
    action: "read",
    fields: "username,email",
    row: "{\"username\":\"demo\",\"email\":\"demo@example.com\",\"status\":\"active\"}",
  });

  useEffect(() => {
    if (!policy) return;
    setDraft({
      user_capability_map: { ...(policy.user_capability_map || Object.fromEntries((policy.user_roles || []).map((row) => [row.role, row.capabilities || []]))) },
      project_capability_map: { ...(policy.project_capability_map || Object.fromEntries((policy.project_member_roles || []).map((row) => [row.role, row.capabilities || []]))) },
      field_security_rules: [...(policy.abac_policy?.field_security_rules || [])],
      row_filter_rules: [...(policy.abac_policy?.row_filter_rules || [])],
      notes: policy.notes || "",
    });
  }, [policy]);

  const roleOptions = useMemo(() => {
    const rows = checkDraft.scope === "project" ? policy?.project_member_roles : policy?.user_roles;
    return (rows || []).map((row) => ({ value: row.role, label: row.role }));
  }, [checkDraft.scope, policy?.project_member_roles, policy?.user_roles]);

  useEffect(() => {
    if (!roleOptions.length) return;
    if (!roleOptions.some((item) => item.value === checkDraft.role)) {
      setCheckDraft((value) => ({ ...value, role: roleOptions[0].value }));
    }
  }, [checkDraft.role, roleOptions]);

  const updateRoleCapabilities = (scope: string, role: string, capabilities: string[]) => {
    const key = scope === "project" ? "project_capability_map" : "user_capability_map";
    setDraft((value) => ({
      ...value,
      [key]: {
        ...value[key],
        [role]: Array.from(new Set((capabilities || []).map((item) => item.trim()).filter(Boolean))),
      },
    }));
  };

  const addFieldRule = () => {
    const fields = parseCsv(fieldRuleDraft.fields);
    if (!fieldRuleDraft.resource.trim() || !fields.length) return;
    setDraft((value) => ({
      ...value,
      field_security_rules: [
        ...value.field_security_rules,
        {
          id: `field-${Date.now()}`,
          resource: fieldRuleDraft.resource.trim(),
          fields,
          roles: parseCsv(fieldRuleDraft.roles).length ? parseCsv(fieldRuleDraft.roles) : ["*"],
          action: fieldRuleDraft.action,
          mask: fieldRuleDraft.mask,
        },
      ],
    }));
  };

  const addRowRule = () => {
    if (!rowRuleDraft.resource.trim()) return;
    let conditions: Record<string, unknown> = {};
    try {
      conditions = JSON.parse(rowRuleDraft.conditions || "{}");
    } catch {
      conditions = {};
    }
    if (!Object.keys(conditions).length) return;
    setDraft((value) => ({
      ...value,
      row_filter_rules: [
        ...value.row_filter_rules,
        {
          id: `row-${Date.now()}`,
          resource: rowRuleDraft.resource.trim(),
          roles: parseCsv(rowRuleDraft.roles).length ? parseCsv(rowRuleDraft.roles) : ["*"],
          effect: rowRuleDraft.effect,
          conditions,
        },
      ],
    }));
  };

  const runPolicyCheck = () => {
    let row: Record<string, unknown> = {};
    try {
      row = JSON.parse(checkDraft.row || "{}");
    } catch {
      row = {};
    }
    onCheck?.({
      scope: checkDraft.scope,
      role: checkDraft.role,
      capability: checkDraft.capability,
      resource: checkDraft.resource,
      action: checkDraft.action,
      fields: parseCsv(checkDraft.fields),
      row,
    } as any);
  };

  const columns: ColumnsType<RoleRow> = [
    { title: t("page.organization.role"), dataIndex: "role", width: 180, render: (value) => <Tag color={String(value).includes("admin") ? "geekblue" : "default"}>{value}</Tag> },
    { title: t("page.organization.policyScope"), dataIndex: "scope", width: 140 },
    { title: t("page.organization.policyLevel"), dataIndex: "level", width: 120 },
    {
      title: t("page.organization.policyCapabilities"),
      dataIndex: "capabilities",
      render: (_items: string[], row) => {
        const source = row.scope === "project" ? draft.project_capability_map : draft.user_capability_map;
        return (
          <Select
            mode="tags"
            size="small"
            className="min-w-[320px] max-w-full"
            value={source[row.role] || row.capabilities || []}
            tokenSeparators={[",", " "]}
            placeholder={t("page.organization.policyCapabilitiesPlaceholder")}
            onChange={(value) => updateRoleCapabilities(row.scope, row.role, value)}
          />
        );
      },
    },
  ];

  const rows = [...(policy?.user_roles ?? []), ...(policy?.project_member_roles ?? [])];
  const historyColumns: ColumnsType<OrganizationPolicyHistoryItem> = [
    { title: t("page.organization.policyHistoryTime"), dataIndex: "created_at", width: 190 },
    { title: t("page.organization.policyHistoryAction"), dataIndex: "action", width: 110, render: (value) => <Tag color={value === "reset" ? "orange" : "blue"}>{value}</Tag> },
    { title: t("page.organization.policyHistoryUser"), dataIndex: "updated_by", width: 140 },
    {
      title: t("page.organization.policyHistoryRoles"),
      width: 130,
      render: (_, row) => row.action === "abac_check" ? (row.decision || "-") : `${row.user_roles ?? 0}/${row.project_roles ?? 0}`,
    },
    { title: t("page.organization.policyHistoryNotes"), dataIndex: "notes", ellipsis: true },
  ];

  return (
    <ModuleFrame title={t("page.organization.rolePolicy")} description={t("page.organization.rolePolicyHint")}>
      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error.message} /> : null}
      {saveError ? <ErrorBlock message={saveError.message} /> : null}
      {resetError ? <ErrorBlock message={resetError.message} /> : null}
      {checkError ? <ErrorBlock message={checkError.message} /> : null}
      {!loading && !policy ? <EmptyState message={t("page.organization.emptyPolicy")} /> : null}
      {policy ? (
        <div className="space-y-4">
          <Alert
            showIcon
            type="info"
            message={t("page.organization.policyTenantScope")}
            description={`${policy.tenant_scope.tenant_code || "-"} / ${policy.tenant_scope.business_code || "*"} / ${policy.tenant_scope.project_id || "*"}`}
          />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--text)]">{t("page.organization.policyConfig")}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {t("page.organization.policyUpdated", { user: policy.updated_by || "-", time: policy.updated_at || "-" })}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Popconfirm title={t("page.organization.policyResetConfirm")} onConfirm={onReset}>
                  <Button danger loading={resetPending}>{t("page.organization.policyReset")}</Button>
                </Popconfirm>
                <Button type="primary" loading={savePending} onClick={() => onSave?.(draft)}>
                  {t("page.organization.policySave")}
                </Button>
              </div>
            </div>
            <Input.TextArea
              rows={2}
              value={draft.notes}
              placeholder={t("page.organization.policyNotes")}
              onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">{t("page.organization.policyCheck")}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{t("page.organization.policyCheckHint")}</div>
                </div>
                <Button
                  type="primary"
                  loading={checkPending}
                  onClick={runPolicyCheck}
                >
                  {t("page.organization.policyCheckRun")}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Select
                  value={checkDraft.scope}
                  onChange={(scope) => setCheckDraft((value) => ({ ...value, scope, role: scope === "project" ? (policy.project_member_roles[0]?.role || "developer") : (policy.user_roles[0]?.role || "developer") }))}
                  options={[
                    { value: "tenant", label: t("page.organization.policyCheckScopeTenant") },
                    { value: "project", label: t("page.organization.policyCheckScopeProject") },
                  ]}
                />
                <Select
                  value={checkDraft.role}
                  onChange={(role) => setCheckDraft((value) => ({ ...value, role }))}
                  options={roleOptions}
                />
                <Input
                  value={checkDraft.capability}
                  onChange={(e) => setCheckDraft((value) => ({ ...value, capability: e.target.value }))}
                  placeholder={t("page.organization.policyCheckCapability")}
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Input
                  value={checkDraft.resource}
                  onChange={(e) => setCheckDraft((value) => ({ ...value, resource: e.target.value }))}
                  placeholder="organization.users"
                />
                <Input
                  value={checkDraft.fields}
                  onChange={(e) => setCheckDraft((value) => ({ ...value, fields: e.target.value }))}
                  placeholder="username,email"
                />
                <Input
                  value={checkDraft.action}
                  onChange={(e) => setCheckDraft((value) => ({ ...value, action: e.target.value }))}
                  placeholder="read"
                />
              </div>
              <Input.TextArea
                className="mt-3"
                rows={2}
                value={checkDraft.row}
                onChange={(e) => setCheckDraft((value) => ({ ...value, row: e.target.value }))}
                placeholder='{"username":"demo","email":"demo@example.com","status":"active"}'
              />
              {checkResult ? (
                <div className="mt-3 space-y-2">
                  <Alert
                    showIcon
                    type={checkResult.allowed ? "success" : "warning"}
                    message={checkResult.allowed ? t("page.organization.policyDecisionAllow") : t("page.organization.policyDecisionDeny")}
                    description={`${checkResult.scope}:${checkResult.role} -> ${checkResult.capability} / row=${checkResult.row_decision?.decision ?? "-"} / ${(checkResult.matched_capabilities || []).join(", ") || "-"}`}
                  />
                  <pre className="max-h-40 overflow-auto rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--muted-strong)]">
                    {JSON.stringify({ masked_row: checkResult.masked_row, field_decisions: checkResult.field_decisions, row_decision: checkResult.row_decision }, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text)]">{t("page.organization.policyHistory")}</div>
              <Table
                rowKey={(row) => row.id || `${row.created_at}-${row.action}`}
                size="small"
                columns={historyColumns}
                dataSource={history}
                loading={historyLoading}
                pagination={false}
                scroll={{ x: 680, y: 240 }}
                locale={{ emptyText: t("page.organization.policyHistoryEmpty") }}
              />
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text)]">字段级安全策略</div>
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={fieldRuleDraft.resource} onChange={(e) => setFieldRuleDraft((v) => ({ ...v, resource: e.target.value }))} placeholder="resource" />
                <Input value={fieldRuleDraft.fields} onChange={(e) => setFieldRuleDraft((v) => ({ ...v, fields: e.target.value }))} placeholder="email,password_hash" />
                <Input value={fieldRuleDraft.roles} onChange={(e) => setFieldRuleDraft((v) => ({ ...v, roles: e.target.value }))} placeholder="viewer,developer" />
                <div className="flex gap-2">
                  <Select className="flex-1" value={fieldRuleDraft.action} onChange={(action) => setFieldRuleDraft((v) => ({ ...v, action }))} options={[{ value: "mask", label: "mask" }, { value: "deny", label: "deny" }, { value: "allow", label: "allow" }]} />
                  <Select className="flex-1" value={fieldRuleDraft.mask} onChange={(mask) => setFieldRuleDraft((v) => ({ ...v, mask }))} options={[{ value: "full", label: "full" }, { value: "partial", label: "partial" }]} />
                </div>
              </div>
              <Button className="mt-3" onClick={addFieldRule}>添加字段规则</Button>
              <Table
                className="mt-3"
                size="small"
                rowKey={(row) => row.id}
                dataSource={draft.field_security_rules}
                pagination={false}
                columns={[
                  { title: "Resource", dataIndex: "resource", ellipsis: true },
                  { title: "Fields", render: (_, row) => (row.fields || []).join(", ") },
                  { title: "Roles", render: (_, row) => (row.roles || []).join(", ") },
                  { title: "Action", dataIndex: "action", width: 90 },
                  {
                    title: "",
                    width: 70,
                    render: (_, row) => <Button size="small" danger onClick={() => setDraft((v) => ({ ...v, field_security_rules: v.field_security_rules.filter((item) => item.id !== row.id) }))}>删除</Button>,
                  },
                ]}
                scroll={{ x: 620, y: 220 }}
              />
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 text-sm font-semibold text-[var(--text)]">行级 ABAC 策略</div>
              <div className="grid gap-2 md:grid-cols-2">
                <Input value={rowRuleDraft.resource} onChange={(e) => setRowRuleDraft((v) => ({ ...v, resource: e.target.value }))} placeholder="resource" />
                <Input value={rowRuleDraft.roles} onChange={(e) => setRowRuleDraft((v) => ({ ...v, roles: e.target.value }))} placeholder="viewer,developer" />
                <Select value={rowRuleDraft.effect} onChange={(effect) => setRowRuleDraft((v) => ({ ...v, effect }))} options={[{ value: "deny", label: "deny" }, { value: "allow", label: "allow" }]} />
                <Input value={rowRuleDraft.conditions} onChange={(e) => setRowRuleDraft((v) => ({ ...v, conditions: e.target.value }))} placeholder='{"status":"disabled"}' />
              </div>
              <Button className="mt-3" onClick={addRowRule}>添加行规则</Button>
              <Table
                className="mt-3"
                size="small"
                rowKey={(row) => row.id}
                dataSource={draft.row_filter_rules}
                pagination={false}
                columns={[
                  { title: "Resource", dataIndex: "resource", ellipsis: true },
                  { title: "Roles", render: (_, row) => (row.roles || []).join(", ") },
                  { title: "Effect", dataIndex: "effect", width: 90 },
                  { title: "Conditions", render: (_, row) => JSON.stringify(row.conditions || {}) },
                  {
                    title: "",
                    width: 70,
                    render: (_, row) => <Button size="small" danger onClick={() => setDraft((v) => ({ ...v, row_filter_rules: v.row_filter_rules.filter((item) => item.id !== row.id) }))}>删除</Button>,
                  },
                ]}
                scroll={{ x: 620, y: 220 }}
              />
            </div>
          </div>
          <Table rowKey={(row) => `${row.scope}-${row.role}`} columns={columns} dataSource={rows} pagination={false} scroll={{ x: 760 }} />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
                {t("page.organization.governanceControls")}
              </div>
              <List
                size="small"
                dataSource={policy.governance_controls}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<span className="text-[var(--text)]">{item.title} <Tag>{item.status}</Tag></span>}
                      description={<span className="text-[var(--muted)]">{item.description} · {item.next}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                {t("page.organization.aiSurfaces")}
              </div>
              <List
                size="small"
                dataSource={policy.ai_surfaces}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<span className="text-[var(--text)]">{item.title}</span>}
                      description={<span className="text-[var(--muted)]">{item.capability} · {item.path} · {item.description}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>
          </div>
        </div>
      ) : null}
    </ModuleFrame>
  );
}
