import {
  DeleteOutlined,
  KeyOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Form,
  Input as AntInput,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock } from "../../../../../src/components/PageStates";

const userStatuses = ["active", "disabled", "locked"];

export function UsersModule(props: {
  users: any[];
  roles: string[];
  loading: boolean;
  error: Error | null;
  draft: { username: string; email: string; password: string; role: string };
  setDraft: (v: {
    username: string;
    email: string;
    password: string;
    role: string;
  }) => void;
  createPending: boolean;
  createError: Error | null;
  updatePending: boolean;
  updateError: Error | null;
  deletePending: boolean;
  deleteError: Error | null;
  onCreate: () => void;
  onUpdate: (
    userId: string,
    patch: {
      email?: string;
      role?: string;
      status?: string;
      password?: string;
    },
  ) => void;
  onDelete: (userId: string, username: string) => void;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  const roleOptions = props.roles.map((value) => ({ label: value, value }));
  const statusOptions = userStatuses.map((value) => ({ label: value, value }));
  const totalUsers = props.users.length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.users.filter((u) => {
      const haystack = [u.id, u.username, u.email, u.role, u.status]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return (
        (!q || haystack.includes(q)) &&
        (role === "all" || u.role === role) &&
        (status === "all" || u.status === status)
      );
    });
  }, [props.users, query, role, status]);

  const columns: ColumnsType<any> = [
    {
      title: t("page.projects.user"),
      dataIndex: "username",
      width: 380,
      render: (_value, user) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            size={36}
            icon={<UserOutlined />}
            className="shrink-0 !bg-[var(--brand-softer)] !text-[var(--brand)]"
          />
          <div className="min-w-0">
            <div
              className="truncate text-sm font-semibold text-[var(--text)]"
              title={user.username}
            >
              {user.username}
            </div>
            <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
              {user.email || user.id}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t("page.projects.role"),
      dataIndex: "role",
      width: 220,
      filters: roleOptions.map((item) => ({
        text: item.label,
        value: item.value,
      })),
      onFilter: (value, user) => user.role === value,
      render: (_value, user) => (
        <Select
          size="small"
          className="w-full max-w-48"
          value={user.role || "developer"}
          disabled={props.updatePending}
          options={roleOptions}
          onChange={(value) => props.onUpdate(user.id, { role: value })}
        />
      ),
    },
    {
      title: t("page.projects.status"),
      dataIndex: "status",
      width: 180,
      filters: statusOptions.map((item) => ({
        text: item.label,
        value: item.value,
      })),
      onFilter: (value, user) => user.status === value,
      render: (_value, user) => (
        <Select
          size="small"
          className="w-full max-w-36"
          value={user.status || "active"}
          disabled={props.updatePending}
          options={statusOptions}
          onChange={(value) => props.onUpdate(user.id, { status: value })}
        />
      ),
    },
    {
      title: t("page.projects.actions"),
      key: "actions",
      width: 220,
      fixed: "right",
      render: (_value, user) => (
        <div className="flex items-center gap-2">
          <Tooltip title={t("page.projects.resetPassword")}>
            <Button
              size="small"
              icon={<KeyOutlined />}
              disabled={props.updatePending}
              onClick={() => {
                setResetUser(user);
                setPassword("");
              }}
            >
              {t("page.projects.resetPassword")}
            </Button>
          </Tooltip>
          <Popconfirm
            title={t("page.projects.confirmDeleteUser", {
              name: user.username,
            })}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            okButtonProps={{ danger: true, loading: props.deletePending }}
            onConfirm={() => props.onDelete(user.id, user.username)}
          >
            <Button
              size="small"
              danger
              ghost
              icon={<DeleteOutlined />}
              loading={props.deletePending}
            >
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card
        title={t("page.projects.users")}
        actions={
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-[var(--brand-softer)] px-2 text-sm font-semibold text-[var(--brand)]">
              {totalUsers}
            </span>
            <Button
              type="primary"
              icon={<UserAddOutlined />}
              onClick={() => setCreateOpen(true)}
              className="h-10 px-4 font-semibold shadow-sm"
            >
              {t("page.projects.createUser")}
            </Button>
          </div>
        }
      >
        {props.error ? <ErrorBlock message={props.error.message} /> : null}
        {props.updateError ? (
          <ErrorBlock message={props.updateError.message} />
        ) : null}
        {props.deleteError ? (
          <ErrorBlock message={props.deleteError.message} />
        ) : null}
        <div className="mb-4 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:grid-cols-[minmax(18rem,1fr)_13rem_13rem]">
          <AntInput.Search
            allowClear
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.projects.searchUsers")}
            className="min-w-0"
          />
          <Select
            value={role}
            onChange={setRole}
            options={[
              { label: t("page.projects.allRoles"), value: "all" },
              ...roleOptions,
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { label: t("page.projects.allStatuses"), value: "all" },
              ...statusOptions,
            ]}
          />
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={props.loading}
          size="middle"
          scroll={{ x: 980 }}
          rowClassName="align-middle"
          locale={{
            emptyText: <EmptyState message={t("page.projects.emptyUsers")} />,
          }}
          pagination={{
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            defaultPageSize: 25,
            showTotal: (total, range) =>
              t("page.projects.tableSummary", {
                start: range[0],
                end: range[1],
                total,
              }),
          }}
        />
      </Card>

      <CreateUserModal
        open={createOpen}
        draft={props.draft}
        roles={props.roles}
        pending={props.createPending}
        error={props.createError}
        setDraft={props.setDraft}
        onCancel={() => setCreateOpen(false)}
        onCreate={() => {
          props.onCreate();
          setCreateOpen(false);
        }}
      />

      <Modal
        open={Boolean(resetUser)}
        title={
          resetUser
            ? `${t("page.projects.resetPassword")} · ${resetUser.username}`
            : t("page.projects.resetPassword")
        }
        onCancel={() => setResetUser(null)}
        okText={t("common.save")}
        okButtonProps={{
          disabled: password.length < 8,
          loading: props.updatePending,
        }}
        onOk={() => {
          if (resetUser && password) props.onUpdate(resetUser.id, { password });
          setResetUser(null);
        }}
        destroyOnHidden
      >
        <Form layout="vertical" className="mt-3">
          <Form.Item label={t("page.projects.passwordPh")} required>
            <AntInput.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("page.projects.resetPasswordPh")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function CreateUserModal(props: {
  open: boolean;
  draft: { username: string; email: string; password: string; role: string };
  roles: string[];
  pending: boolean;
  error: Error | null;
  setDraft: (v: {
    username: string;
    email: string;
    password: string;
    role: string;
  }) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={props.open}
      title={t("page.projects.createUser")}
      onCancel={props.onCancel}
      okText={t("page.projects.createUser")}
      okButtonProps={{
        disabled:
          !props.draft.username.trim() || props.draft.password.length < 8,
        loading: props.pending,
      }}
      onOk={props.onCreate}
      destroyOnHidden
    >
      {props.error ? <ErrorBlock message={props.error.message} /> : null}
      <Form layout="vertical" className="mt-3">
        <Form.Item label={t("page.projects.user")} required>
          <AntInput
            value={props.draft.username}
            onChange={(e) =>
              props.setDraft({ ...props.draft, username: e.target.value })
            }
            placeholder={t("page.projects.usernamePh")}
          />
        </Form.Item>
        <Form.Item label="Email">
          <AntInput
            value={props.draft.email}
            onChange={(e) =>
              props.setDraft({ ...props.draft, email: e.target.value })
            }
            placeholder={t("page.projects.emailPh")}
          />
        </Form.Item>
        <Form.Item label={t("page.projects.passwordPh")} required>
          <AntInput.Password
            value={props.draft.password}
            onChange={(e) =>
              props.setDraft({ ...props.draft, password: e.target.value })
            }
            placeholder={t("page.projects.passwordPh")}
          />
        </Form.Item>
        <Form.Item label={t("page.projects.role")}>
          <Select
            value={props.draft.role}
            onChange={(value) =>
              props.setDraft({ ...props.draft, role: value })
            }
            options={props.roles.map((value) => ({ label: value, value }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
