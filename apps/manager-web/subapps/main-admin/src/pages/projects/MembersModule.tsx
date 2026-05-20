import { UserAddOutlined } from "@ant-design/icons";
import { Button, Modal, Popconfirm, Select, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock } from "../../../../../src/components/PageStates";
import type { Project } from "./types";

export function MembersModule(props: {
  project?: Project;
  members: any[];
  loading: boolean;
  users: any[];
  roles: string[];
  newMember: { user_id: string; role: string };
  setNewMember: (v: { user_id: string; role: string }) => void;
  addPending: boolean;
  removePending: boolean;
  addError: Error | null;
  onAdd: () => void;
  onUpdateRole: (userId: string, role: string) => void;
  onRemove: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const roleOptions = props.roles.map((value) => ({ label: value, value }));
  const userOptions = props.users.map((u) => ({ label: `${u.username}${u.email ? ` · ${u.email}` : ""}`, value: u.id }));
  const columns: ColumnsType<any> = [
    {
      title: t("page.projects.user"),
      dataIndex: "username",
      render: (_value, member) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text)]" title={member.username}>{member.username}</div>
          <div className="mt-1 break-all text-xs text-[var(--muted)]">{member.email || member.user_id}</div>
        </div>
      ),
    },
    {
      title: t("page.projects.role"),
      dataIndex: "role",
      width: 220,
      render: (_value, member) => (
        <Select className="min-w-40" value={member.role} options={roleOptions} onChange={(value) => props.onUpdateRole(member.user_id, value)} />
      ),
    },
    {
      title: t("page.projects.actions"),
      key: "actions",
      width: 140,
      fixed: "right",
      render: (_value, member) => (
        <Popconfirm
          title={t("page.projects.confirmRemoveMember", { name: member.username })}
          okText={t("common.delete")}
          cancelText={t("common.cancel")}
          okButtonProps={{ danger: true, loading: props.removePending }}
          onConfirm={() => props.onRemove(member.user_id)}
        >
          <Button size="small" danger loading={props.removePending}>{t("common.delete")}</Button>
        </Popconfirm>
      ),
    },
  ];

  if (!props.project) return <Card><EmptyState message={t("page.projects.pickProject")} /></Card>;

  return (
    <>
      <Card
        title={t("page.projects.members")}
        actions={
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreateOpen(true)}>
            {t("page.projects.addMember")}
          </Button>
        }
      >
        <Table
          rowKey="user_id"
          columns={columns}
          dataSource={props.members}
          loading={props.loading}
          size="middle"
          scroll={{ x: 760 }}
          locale={{ emptyText: <EmptyState message={t("page.projects.emptyMembers")} /> }}
          pagination={{
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            defaultPageSize: 25,
            showTotal: (total, range) => t("page.projects.tableSummary", { start: range[0], end: range[1], total }),
          }}
        />
      </Card>
      <Modal
        open={createOpen}
        title={t("page.projects.addMember")}
        onCancel={() => setCreateOpen(false)}
        okText={t("page.projects.addMember")}
        okButtonProps={{ disabled: !props.newMember.user_id, loading: props.addPending }}
        onOk={() => {
          props.onAdd();
          setCreateOpen(false);
        }}
        destroyOnHidden
      >
        {props.addError ? <ErrorBlock message={props.addError.message} /> : null}
        <Space direction="vertical" className="mt-3 w-full" size={12}>
          <Select
            showSearch
            className="w-full"
            value={props.newMember.user_id || undefined}
            placeholder={t("page.projects.pickUser")}
            options={userOptions}
            optionFilterProp="label"
            onChange={(value) => props.setNewMember({ ...props.newMember, user_id: value })}
          />
          <Select
            className="w-full"
            value={props.newMember.role}
            options={roleOptions}
            onChange={(value) => props.setNewMember({ ...props.newMember, role: value })}
          />
        </Space>
      </Modal>
    </>
  );
}
