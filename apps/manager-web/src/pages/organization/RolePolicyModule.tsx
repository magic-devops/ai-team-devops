import { Alert, List, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../components/PageStates";
import { ModuleFrame } from "./ModuleFrame";
import type { OrganizationPolicy } from "./types";

type RoleRow = { role: string; level: number; scope: string; capabilities: string[]; assignable: boolean };

export function RolePolicyModule({
  policy,
  loading,
  error,
}: {
  policy?: OrganizationPolicy;
  loading: boolean;
  error?: Error | null;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<RoleRow> = [
    { title: t("page.organization.role"), dataIndex: "role", width: 180, render: (value) => <Tag color={String(value).includes("admin") ? "geekblue" : "default"}>{value}</Tag> },
    { title: t("page.organization.policyScope"), dataIndex: "scope", width: 140 },
    { title: t("page.organization.policyLevel"), dataIndex: "level", width: 120 },
    {
      title: t("page.organization.policyCapabilities"),
      dataIndex: "capabilities",
      render: (items: string[]) => <div className="flex flex-wrap gap-1">{items.map((item) => <Tag key={item}>{item}</Tag>)}</div>,
    },
  ];

  const rows = [...(policy?.user_roles ?? []), ...(policy?.project_member_roles ?? [])];

  return (
    <ModuleFrame title={t("page.organization.rolePolicy")} description={t("page.organization.rolePolicyHint")}>
      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error.message} /> : null}
      {!loading && !policy ? <EmptyState message={t("page.organization.emptyPolicy")} /> : null}
      {policy ? (
        <div className="space-y-4">
          <Alert
            showIcon
            type="info"
            message={t("page.organization.policyTenantScope")}
            description={`${policy.tenant_scope.tenant_code || "-"} / ${policy.tenant_scope.business_code || "*"} / ${policy.tenant_scope.project_id || "*"}`}
          />
          <Table rowKey={(row) => `${row.scope}-${row.role}`} columns={columns} dataSource={rows} pagination={false} />
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
