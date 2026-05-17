import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { WorkbenchShell } from "../shared/WorkbenchShell";
import { useHashTabSync, WorkbenchPanel, WorkbenchStats } from "../shared/workbenchUi";

const SKILLS_TABS = ["skills", "repos", "installed"] as const;

export function SkillsHub({
  initialTab = "skills",
  focused = false,
}: {
  initialTab?: (typeof SKILLS_TABS)[number];
  focused?: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useHashTabSync("#/skills-hub", SKILLS_TABS, initialTab);
  const [repoOpen, setRepoOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [repoForm] = Form.useForm<{ id: string; name: string; url: string; branch: string }>();
  const [skillForm] = Form.useForm<{ skill_id: string; name: string; description: string; agent_role: string }>();

  const skillsQ = useQuery({ queryKey: ["skills"], queryFn: api.skillsList });
  const reposQ = useQuery({ queryKey: ["skillRepos"], queryFn: api.skillRepoList });
  const installedQ = useQuery({ queryKey: ["skillInstalled"], queryFn: api.skillRepoInstalled });

  const addRepoMut = useMutation({
    mutationFn: (v: { id: string; name: string; url: string; branch: string }) => api.skillRepoAdd(v),
    onSuccess: () => {
      setRepoOpen(false);
      repoForm.resetFields();
      message.success(t("page.skillsHub.repoAdded"));
      void qc.invalidateQueries({ queryKey: ["skillRepos"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const syncMut = useMutation({
    mutationFn: (id: string) => api.skillRepoSync(id),
    onSuccess: () => {
      message.success(t("page.skillsHub.syncDone"));
      void qc.invalidateQueries({ queryKey: ["skillRepos"] });
      void qc.invalidateQueries({ queryKey: ["skillInstalled"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const createSkillMut = useMutation({
    mutationFn: (v: { skill_id: string; name: string; description: string; agent_role: string }) => api.skillCreate(v),
    onSuccess: () => {
      setSkillOpen(false);
      skillForm.resetFields();
      message.success(t("page.skillsHub.skillCreated"));
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteSkillMut = useMutation({
    mutationFn: (id: string) => api.skillDelete(id),
    onSuccess: () => {
      message.success(t("page.skillsHub.deleted"));
      void qc.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const skills = skillsQ.data ?? [];
  const repos = reposQ.data ?? [];
  const installed = installedQ.data && typeof installedQ.data === "object" ? Object.entries(installedQ.data) : [];

  const skillCols: ColumnsType<Record<string, unknown>> = [
    { title: "ID", dataIndex: "skill_id", width: 120 },
    { title: t("page.skillsHub.name"), dataIndex: "name" },
    { title: t("page.skillsHub.role"), dataIndex: "agent_role", width: 120 },
    {
      title: t("page.skillsHub.flags"),
      key: "flags",
      width: 160,
      render: (_, r) => (
        <>
          {r.builtin ? <Tag>{t("page.skillsHub.builtin")}</Tag> : null}
          {r.mcp_tool ? <Tag color="blue">MCP</Tag> : null}
          {r.a2a_exposed ? <Tag color="purple">A2A</Tag> : null}
        </>
      ),
    },
    {
      title: t("common.actions"),
      key: "a",
      width: 90,
      render: (_, r) =>
        r.builtin ? null : (
          <Button size="small" danger onClick={() => deleteSkillMut.mutate(String(r.skill_id))}>
            {t("common.delete")}
          </Button>
        ),
    },
  ];

  return (
    <WorkbenchShell
      title={t("page.skillsHub.title")}
      description={focused ? t("page.skillsHub.focusedHint") : t("page.skillsHub.desc")}
      actions={
        tab === "repos" ? (
          <Button type="primary" onClick={() => setRepoOpen(true)}>
            {t("page.skillsHub.addRepo")}
          </Button>
        ) : tab === "skills" ? (
          <Button type="primary" onClick={() => setSkillOpen(true)}>
            {t("page.skillsHub.addSkill")}
          </Button>
        ) : null
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.skillsHub.skills"), value: skills.length },
            { label: t("page.skillsHub.repos"), value: repos.length },
            { label: t("page.skillsHub.installed"), value: installed.length },
          ]}
        />
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as (typeof SKILLS_TABS)[number])}
        items={[
          {
            key: "skills",
            label: t("page.skillsHub.tabSkills"),
            children: (
              <WorkbenchPanel>
                <Table rowKey="skill_id" loading={skillsQ.isLoading} columns={skillCols} dataSource={skills} pagination={{ pageSize: 15 }} />
              </WorkbenchPanel>
            ),
          },
          {
            key: "repos",
            label: t("page.skillsHub.tabRepos"),
            children: (
              <WorkbenchPanel>
                <Table
                  rowKey="id"
                  loading={reposQ.isLoading}
                  dataSource={repos}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: "ID", dataIndex: "id", width: 100 },
                    { title: t("page.skillsHub.name"), dataIndex: "name" },
                    { title: "URL", dataIndex: "url", ellipsis: true },
                    {
                      title: t("common.actions"),
                      key: "a",
                      width: 120,
                      render: (_, r) => (
                        <Button size="small" loading={syncMut.isPending} onClick={() => syncMut.mutate(r.id)}>
                          {t("page.skillsHub.sync")}
                        </Button>
                      ),
                    },
                  ]}
                />
              </WorkbenchPanel>
            ),
          },
          {
            key: "installed",
            label: t("page.skillsHub.tabInstalled"),
            children: (
              <WorkbenchPanel>
                <Table
                  rowKey="0"
                  dataSource={installed.map(([k, v]) => ({ key: k, ...(typeof v === "object" ? v : {}) }))}
                  columns={[
                    { title: t("page.skillsHub.key"), dataIndex: "key" },
                    { title: "repo", dataIndex: "repo_id" },
                    { title: "skill", dataIndex: "skill_id" },
                    { title: "version", dataIndex: "version", width: 90 },
                  ]}
                  pagination={false}
                />
              </WorkbenchPanel>
            ),
          },
        ]}
      />

      <Modal
        title={t("page.skillsHub.addSkill")}
        open={skillOpen}
        onCancel={() => setSkillOpen(false)}
        onOk={() => skillForm.submit()}
        confirmLoading={createSkillMut.isPending}
        destroyOnHidden
      >
        <Form
          form={skillForm}
          layout="vertical"
          initialValues={{ agent_role: "All" }}
          onFinish={(v) => createSkillMut.mutate(v)}
        >
          <Form.Item name="skill_id" label="ID" rules={[{ required: true }]}>
            <Input placeholder="SKILL-CUSTOM-001" />
          </Form.Item>
          <Form.Item name="name" label={t("page.skillsHub.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t("page.skillsHub.description")} rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="agent_role" label={t("page.skillsHub.role")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("page.skillsHub.addRepo")}
        open={repoOpen}
        onCancel={() => setRepoOpen(false)}
        onOk={() => repoForm.submit()}
        confirmLoading={addRepoMut.isPending}
        destroyOnHidden
      >
        <Form form={repoForm} layout="vertical" initialValues={{ branch: "main" }} onFinish={(v) => addRepoMut.mutate(v)}>
          <Form.Item name="id" label="ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t("page.skillsHub.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="Git URL" rules={[{ required: true, type: "url" }]}>
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="branch" label="branch">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </WorkbenchShell>
  );
}
