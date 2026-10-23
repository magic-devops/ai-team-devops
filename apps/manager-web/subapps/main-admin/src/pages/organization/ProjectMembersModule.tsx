import { Alert, Button, Empty, Select, Table, Tag } from "antd";
import { projectTeamHash } from "../../../../../src/lib/projectTeamNavigation";
import type { ColumnsType } from "antd/es/table";
import { Trash2, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";
import { ModuleFrame } from "./ModuleFrame";
import type { ProjectMemberRow, ProjectRow, UserRow } from "./types";

export function ProjectMembersModule({
  projects,
  selectedProjectId,
  setSelectedProjectId,
  members,
  candidates,
  roles,
  loading,
  candidateLoading,
  readFailed = false,
  disabled = false,
  errors,
  newMember,
  setNewMember,
  addPending,
  updatePending,
  removePending,
  onAdd,
  onUpdateRole,
  onRemove,
}: {
  projects: ProjectRow[];
  selectedProjectId: string;
  setSelectedProjectId: (projectId: string) => void;
  members: ProjectMemberRow[];
  candidates: UserRow[];
  roles: string[];
  loading: boolean;
  candidateLoading: boolean;
  readFailed?: boolean;
  disabled?: boolean;
  errors: Array<Error | null | undefined>;
  newMember: { user_id: string; role: string };
  setNewMember: (next: { user_id: string; role: string }) => void;
  addPending: boolean;
  updatePending: boolean;
  removePending: boolean;
  onAdd: () => void;
  onUpdateRole: (userId: string, role: string) => void;
  onRemove: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId), [projects, selectedProjectId]);
  const pending = addPending || updatePending || removePending;
  const blocked = disabled || loading || pending || !selectedProject;
  const columns: ColumnsType<ProjectMemberRow> = [
    {
      title: t("page.organization.username"),
      dataIndex: "username",
      render: (value, row) => (
        <div>
          <div className="font-medium text-[var(--text)]">{value}</div>
          <div className="text-xs text-[var(--muted)]">{row.email || "-"}</div>
        </div>
      ),
    },
    {
      title: t("page.organization.role"),
      dataIndex: "role",
      width: 220,
      render: (value, row) => (
        <Select aria-label={`${t("page.organization.role")} · ${row.username}`} className="w-full" value={value} disabled={blocked} onChange={(role) => { if (!blocked) onUpdateRole(row.user_id, role); }} options={roles.map((role) => ({ value: role, label: role }))} />
      ),
    },
    {
      title: t("page.organization.actions"),
      width: 100,
      align: "right",
      render: (_value, row) => (
        <Button aria-label={`${t("page.organization.actions")} · ${row.username}`} size="small" danger disabled={blocked} loading={removePending} icon={<Trash2 className="h-4 w-4" />} onClick={() => { if (!blocked) onRemove(row.user_id); }} />
      ),
    },
  ];

  return (
    <ModuleFrame title={t("page.organization.projectMembers")} description={t("page.organization.projectMembersHint")}>
      <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(14rem,20rem)_12rem_auto]">
        <Select
          aria-label={t("page.organization.pickProject")}
          value={selectedProjectId || undefined}
          placeholder={t("page.organization.pickProject")}
          disabled={pending}
          showSearch optionFilterProp="label"
          onChange={(id) => { if (!pending) setSelectedProjectId(id); }}
          options={projects.map((p) => ({ value: p.id, label: `${p.name} · ${p.status || "-"}` }))}
        />
        <Select
          aria-label={t("page.organization.pickUser")}
          showSearch optionFilterProp="label"
          disabled={blocked || candidateLoading}
          value={newMember.user_id || undefined}
          loading={candidateLoading}
          placeholder={t("page.organization.pickUser")}
          onChange={(user_id) => setNewMember({ ...newMember, user_id })}
          options={candidates.map((u) => ({ value: u.id, label: `${u.username}${u.email ? ` · ${u.email}` : ""}` }))}
        />
        <Select aria-label={t("page.organization.role")} disabled={blocked} value={newMember.role} onChange={(role) => setNewMember({ ...newMember, role })} options={roles.map((role) => ({ value: role, label: role }))} />
        <Button type="primary" icon={<UserPlus className="h-4 w-4" />} disabled={blocked || candidateLoading || !roles.includes(newMember.role) || !candidates.some((user) => user.id === newMember.user_id)} loading={addPending} onClick={() => { if (!blocked && !candidateLoading && roles.includes(newMember.role) && candidates.some((user) => user.id === newMember.user_id)) onAdd(); }}>
          {t("page.organization.addMember")}
        </Button>
      </div>
      {selectedProject ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <Tag color="blue">{selectedProject.id}</Tag>
          <span>{selectedProject.business_name || selectedProject.business_id || t("common.all")}</span>
          <span>{selectedProject.status || "-"}</span>
          <Button type="link" href={projectTeamHash(selectedProject.id)} disabled={pending}>{t("deliveryTeam.back")}</Button>
        </div>
      ) : null}
      {errors.filter(Boolean).map((error) => <ErrorBlock key={error!.message} message={error!.message} />)}
      {loading ? <LoadingBlock /> : readFailed ? null : !selectedProjectId ? <Empty description={t("page.organization.pickProject")} /> : !selectedProject ? <Alert type="warning" showIcon title={t("deliveryTeam.projectUnavailable")} /> : members.length === 0 ? <EmptyState message={t("page.organization.emptyMembers")} /> : (
        <Table rowKey="user_id" columns={columns} dataSource={members} pagination={{ pageSize: 10, showSizeChanger: true }} />
      )}
    </ModuleFrame>
  );
}
