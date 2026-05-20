import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { KeyRound, Pencil, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorBlock, LoadingBlock } from "../../../../../src/components/PageStates";
import { ModuleFrame } from "./ModuleFrame";
import type { UserRow } from "./types";

export function TenantUsersModule({
  users,
  roles,
  loading,
  errors,
  createPending,
  updatePending,
  deletePending,
  onCreate,
  onUpdate,
  onDelete,
}: {
  users: UserRow[];
  roles: string[];
  loading: boolean;
  errors: Array<Error | null | undefined>;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  onCreate: (body: { username: string; email?: string; password: string; role?: string }) => void;
  onUpdate: (userId: string, patch: { email?: string; role?: string; status?: string; password?: string }) => void;
  onDelete: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ username: "", email: "", password: "", role: "developer" });
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editDraft, setEditDraft] = useState({ email: "", role: "developer", status: "active" });
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    if (!editing) return;
    setEditDraft({ email: editing.email || "", role: editing.role || "developer", status: editing.status || "active" });
  }, [editing]);

  const statusOptions = [
    { value: "active", label: t("page.organization.active") },
    { value: "disabled", label: t("page.organization.disabled") },
  ];

  const columns: ColumnsType<UserRow> = [
    {
      title: t("page.organization.username"),
      dataIndex: "username",
      width: 260,
      fixed: "left",
      render: (value, row) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-softer)] text-sm font-semibold text-[var(--brand)]">
            {String(value || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--text)]">{value}</div>
            <div className="truncate font-mono text-xs text-[var(--muted)]">{row.id}</div>
          </div>
        </div>
      ),
    },
    {
      title: t("page.organization.email"),
      dataIndex: "email",
      width: 260,
      ellipsis: true,
      render: (value) => value ? <span className="text-[var(--text)]">{value}</span> : <span className="text-[var(--muted)]">-</span>,
    },
    {
      title: t("page.organization.role"),
      dataIndex: "role",
      width: 180,
      render: (value) => (
        <Tag color={String(value || "").includes("admin") ? "geekblue" : "default"} className="max-w-full truncate rounded-md px-2.5 py-1">
          {value || "developer"}
        </Tag>
      ),
    },
    {
      title: t("page.organization.status"),
      dataIndex: "status",
      width: 140,
      render: (value) => (
        <Tag color={(value || "active") === "active" ? "green" : "default"} className="rounded-md px-2.5 py-1">
          {(value || "active") === "active" ? t("page.organization.active") : t("page.organization.disabled")}
        </Tag>
      ),
    },
    {
      title: t("page.organization.actions"),
      width: 230,
      fixed: "right",
      align: "right",
      render: (_value, row) => (
        <Space size={6} wrap={false} className="justify-end">
          <Button size="small" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(row)}>
            {t("common.edit")}
          </Button>
          <Button size="small" icon={<KeyRound className="h-4 w-4" />} onClick={() => setResetUser(row)}>
            {t("page.organization.resetPassword")}
          </Button>
          <Popconfirm
            title={t("page.organization.confirmDelete", { name: row.username })}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            onConfirm={() => onDelete(row.id)}
          >
            <Button size="small" danger loading={deletePending} title={t("page.organization.deleteUser")} icon={<Trash2 className="h-4 w-4" />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <ModuleFrame
      title={t("page.organization.users")}
      description={t("page.organization.usersHint")}
      actions={
        <Space>
          <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--muted-strong)]">{users.length}</span>
          <Button type="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            {t("page.organization.addUser")}
          </Button>
        </Space>
      }
    >
      {loading ? <LoadingBlock /> : null}
      {errors.filter(Boolean).map((error) => <ErrorBlock key={error!.message} message={error!.message} />)}
      {users.length === 0 && !loading ? (
        <EmptyState message={t("page.organization.emptyUsers")} />
      ) : (
        <Table rowKey="id" columns={columns} dataSource={users} loading={loading} scroll={{ x: 1070 }} pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100] }} />
      )}

      <Modal
        title={t("page.organization.addUser")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          onCreate({ username: draft.username.trim(), email: draft.email.trim(), password: draft.password, role: draft.role });
          setDraft({ username: "", email: "", password: "", role: "developer" });
          setCreateOpen(false);
        }}
        okButtonProps={{ disabled: !draft.username.trim() || draft.password.length < 8, loading: createPending }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form layout="vertical">
          <Form.Item label={t("page.organization.username")} required><Input value={draft.username} onChange={(e) => setDraft((x) => ({ ...x, username: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.email")}><Input value={draft.email} onChange={(e) => setDraft((x) => ({ ...x, email: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.password")} required><Input.Password value={draft.password} onChange={(e) => setDraft((x) => ({ ...x, password: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.role")}><Select value={draft.role} onChange={(role) => setDraft((x) => ({ ...x, role }))} options={roles.map((role) => ({ value: role, label: role }))} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t("common.edit")} · ${editing?.username || ""}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => {
          if (!editing) return;
          onUpdate(editing.id, { email: editDraft.email.trim(), role: editDraft.role, status: editDraft.status });
          setEditing(null);
        }}
        okButtonProps={{ loading: updatePending }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form layout="vertical">
          <Form.Item label={t("page.organization.username")}><Input value={editing?.username || ""} disabled /></Form.Item>
          <Form.Item label={t("page.organization.email")}><Input value={editDraft.email} onChange={(e) => setEditDraft((x) => ({ ...x, email: e.target.value }))} /></Form.Item>
          <Form.Item label={t("page.organization.role")}><Select value={editDraft.role} onChange={(role) => setEditDraft((x) => ({ ...x, role }))} options={roles.map((role) => ({ value: role, label: role }))} /></Form.Item>
          <Form.Item label={t("page.organization.status")}><Select value={editDraft.status} onChange={(status) => setEditDraft((x) => ({ ...x, status }))} options={statusOptions} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`${t("page.organization.resetPassword")} · ${resetUser?.username || ""}`}
        open={Boolean(resetUser)}
        onCancel={() => {
          setResetUser(null);
          setResetPassword("");
        }}
        onOk={() => {
          if (!resetUser || resetPassword.length < 8) return;
          onUpdate(resetUser.id, { password: resetPassword });
          setResetUser(null);
          setResetPassword("");
        }}
        okButtonProps={{ disabled: resetPassword.length < 8, loading: updatePending }}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form layout="vertical">
          <Form.Item label={t("page.organization.newPassword")} required><Input.Password value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} /></Form.Item>
          <p className="text-xs text-[var(--muted)]">{t("page.organization.usersHint")}</p>
        </Form>
      </Modal>
    </ModuleFrame>
  );
}
