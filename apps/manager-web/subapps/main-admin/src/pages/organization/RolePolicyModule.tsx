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
  notes: string;
};
type CheckDraft = { scope: "tenant" | "project"; role: string; capability: string };

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
  onCheck?: (body: CheckDraft) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PolicyDraft>({ user_capability_map: {}, project_capability_map: {}, notes: "" });
  const [checkDraft, setCheckDraft] = useState<CheckDraft>({ scope: "tenant", role: "developer", capability: "task.claim" });

  useEffect(() => {
    if (!policy) return;
    setDraft({
      user_capability_map: { ...(policy.user_capability_map || Object.fromEntries((policy.user_roles || []).map((row) => [row.role, row.capabilities || []]))) },
      project_capability_map: { ...(policy.project_capability_map || Object.fromEntries((policy.project_member_roles || []).map((row) => [row.role, row.capabilities || []]))) },
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
      render: (_, row) => `${row.user_roles ?? 0}/${row.project_roles ?? 0}`,
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
                  onClick={() => onCheck?.(checkDraft)}
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
              {checkResult ? (
                <Alert
                  className="mt-3"
                  showIcon
                  type={checkResult.allowed ? "success" : "warning"}
                  message={checkResult.allowed ? t("page.organization.policyDecisionAllow") : t("page.organization.policyDecisionDeny")}
                  description={`${checkResult.scope}:${checkResult.role} -> ${checkResult.capability} / ${(checkResult.matched_capabilities || []).join(", ") || "-"}`}
                />
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
