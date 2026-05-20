import { Button, Empty, Select, Table, Tag } from "antd";
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
        <Select className="w-full" value={value} disabled={updatePending} onChange={(role) => onUpdateRole(row.user_id, role)} options={roles.map((role) => ({ value: role, label: role }))} />
      ),
    },
    {
      title: t("page.organization.actions"),
      width: 100,
      align: "right",
      render: (_value, row) => (
        <Button size="small" danger loading={removePending} icon={<Trash2 className="h-4 w-4" />} onClick={() => onRemove(row.user_id)} />
      ),
    },
  ];

  return (
    <ModuleFrame title={t("page.organization.projectMembers")} description={t("page.organization.projectMembersHint")}>
      <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(14rem,20rem)_12rem_auto]">
        <Select
          value={selectedProjectId || undefined}
          placeholder={t("page.organization.pickProject")}
          onChange={setSelectedProjectId}
          options={projects.map((p) => ({ value: p.id, label: `${p.name} · ${p.status || "-"}` }))}
        />
        <Select
          value={newMember.user_id || undefined}
          loading={candidateLoading}
          placeholder={t("page.organization.pickUser")}
          onChange={(user_id) => setNewMember({ ...newMember, user_id })}
          options={candidates.map((u) => ({ value: u.id, label: `${u.username}${u.email ? ` · ${u.email}` : ""}` }))}
        />
        <Select value={newMember.role} onChange={(role) => setNewMember({ ...newMember, role })} options={roles.map((role) => ({ value: role, label: role }))} />
        <Button type="primary" icon={<UserPlus className="h-4 w-4" />} disabled={!selectedProjectId || !newMember.user_id} loading={addPending} onClick={onAdd}>
          {t("page.organization.addMember")}
        </Button>
      </div>
      {selectedProject ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <Tag color="blue">{selectedProject.id}</Tag>
          <span>{selectedProject.business_name || selectedProject.business_id || t("common.all")}</span>
          <span>{selectedProject.status || "-"}</span>
        </div>
      ) : null}
      {errors.filter(Boolean).map((error) => <ErrorBlock key={error!.message} message={error!.message} />)}
      {loading ? <LoadingBlock /> : null}
      {!selectedProjectId ? <Empty description={t("page.organization.pickProject")} /> : members.length === 0 && !loading ? <EmptyState message={t("page.organization.emptyMembers")} /> : (
        <Table rowKey="user_id" columns={columns} dataSource={members} pagination={{ pageSize: 10, showSizeChanger: true }} />
      )}
    </ModuleFrame>
  );
}
