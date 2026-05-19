import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Form, Input, List, Modal, Popconfirm, Select, Spin, Tabs, Tag, Timeline, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiAssistButton, AiAssistDrawer } from "@/components/ai/AiAssistDrawer";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownView } from "@/components/MarkdownView";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type DocRow = { id: string; title?: string; category?: string; current_version?: number; updated_at?: string };
type VersionRow = { v: number; created_at?: string; note?: string };

export function DesignDocsWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [editContent, setEditContent] = useState("");
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareFrom, setCompareFrom] = useState<number>(1);
  const [compareTo, setCompareTo] = useState<number>(1);
  const [aiOpen, setAiOpen] = useState(false);
  const [createForm] = Form.useForm<{ title: string; category: string; content: string }>();

  const listQ = useQuery({ queryKey: ["designDocs"], queryFn: api.designDocsList });
  const docQ = useQuery({
    queryKey: ["designDoc", selected],
    queryFn: () => api.designDocGet(selected),
    enabled: Boolean(selected),
  });
  const versionsQ = useQuery({
    queryKey: ["designDocVersions", selected],
    queryFn: () => api.designDocVersions(selected),
    enabled: Boolean(selected),
  });

  const docs: DocRow[] = Array.isArray(listQ.data) ? listQ.data : [];
  const versions: VersionRow[] = versionsQ.data?.versions ?? [];
  const currentVersion = Number(versionsQ.data?.current_version ?? 0);
  const panelTitle =
    typeof docQ.data?.meta?.title === "string" ? docQ.data.meta.title : selected || undefined;

  useEffect(() => {
    if (previewVersion != null) return;
    const c = docQ.data?.content;
    if (c != null) setEditContent(String(c));
  }, [docQ.data, previewVersion]);

  const createMut = useMutation({
    mutationFn: (v: { title: string; category: string; content: string }) =>
      api.designDocCreate({ title: v.title, category: v.category, initial_content: v.content }),
    onSuccess: (data) => {
      setCreateOpen(false);
      createForm.resetFields();
      if (data?.id) setSelected(data.id);
      message.success(t("page.designDocs.created"));
      void qc.invalidateQueries({ queryKey: ["designDocs"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const saveMut = useMutation({
    mutationFn: () => api.designDocAddVersion(selected, editContent, t("page.designDocs.versionNoteSave")),
    onSuccess: () => {
      setPreviewVersion(null);
      message.success(t("page.designDocs.saved"));
      void qc.invalidateQueries({ queryKey: ["designDoc", selected] });
      void qc.invalidateQueries({ queryKey: ["designDocVersions", selected] });
      void qc.invalidateQueries({ queryKey: ["designDocs"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const restoreMut = useMutation({
    mutationFn: (version: number) => api.designDocRestore(selected, version),
    onSuccess: () => {
      setPreviewVersion(null);
      message.success(t("page.designDocs.restored"));
      void qc.invalidateQueries({ queryKey: ["designDoc", selected] });
      void qc.invalidateQueries({ queryKey: ["designDocVersions", selected] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.designDocDelete(selected),
    onSuccess: () => {
      setSelected("");
      message.success(t("page.designDocs.deleted"));
      void qc.invalidateQueries({ queryKey: ["designDocs"] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const aiImproveMut = useMutation({
    mutationFn: (mode: "expand" | "review" | "diagram") =>
      api.designDocAiImprove(selected, {
        instruction: t(`page.designDocs.aiInstruction.${mode}`),
        mode,
      }),
    onSuccess: async () => {
      setPreviewVersion(null);
      message.success(t("page.designDocs.aiImproved"));
      void qc.invalidateQueries({ queryKey: ["designDoc", selected] });
      void qc.invalidateQueries({ queryKey: ["designDocVersions", selected] });
      void qc.invalidateQueries({ queryKey: ["designDocs"] });
      const res = await api.designDocGet(selected);
      if (res?.content != null) setEditContent(String(res.content));
    },
    onError: (e) => message.error((e as Error).message),
  });

  const compareQ = useQuery({
    queryKey: ["designDocCompare", selected, compareFrom, compareTo],
    queryFn: () => api.designDocCompare(selected, compareFrom, compareTo),
    enabled: compareOpen && Boolean(selected) && compareFrom > 0 && compareTo > 0,
  });

  const loadVersionPreview = async (v: number) => {
    try {
      const res = await api.designDocVersionGet(selected, v);
      setPreviewVersion(v);
      setPreviewContent(res.content);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const editingHistorical = previewVersion != null && previewVersion !== currentVersion;

  return (
    <WorkbenchShell
      title={t("page.designDocs.title")}
      description={focused ? t("page.designDocs.focusedHint") : t("page.designDocs.desc")}
      actions={
        <>
          {selected ? <AiAssistButton onClick={() => setAiOpen(true)} /> : null}
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            {t("page.designDocs.create")}
          </Button>
        </>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.designDocs.total"), value: docs.length },
            { label: t("page.designDocs.currentVersion"), value: selected ? Number(currentVersion) : "—" },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <WorkbenchPanel title={t("page.designDocs.docList")} className="!p-3">
          <List
            size="small"
            loading={listQ.isLoading}
            dataSource={docs}
            locale={{ emptyText: <Empty description={t("page.designDocs.empty")} /> }}
            renderItem={(item) => (
              <List.Item
                className={`cursor-pointer rounded-lg !px-2 ${selected === item.id ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-muted)]"}`}
                onClick={() => {
                  setSelected(item.id);
                  setPreviewVersion(null);
                }}
              >
                <List.Item.Meta
                  title={<span className="text-xs font-medium">{item.title || item.id}</span>}
                  description={
                    <span className="text-[10px] text-[var(--muted)]">
                      {item.category ? <Tag className="mr-1">{item.category}</Tag> : null}
                      v{item.current_version ?? 0}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </WorkbenchPanel>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_14rem]">
          <WorkbenchPanel
            title={panelTitle}
            actions={
              selected ? (
                <>
                  {editingHistorical ? (
                    <Button size="small" onClick={() => setPreviewVersion(null)}>
                      {t("page.designDocs.backToCurrent")}
                    </Button>
                  ) : null}
                  <RefreshButton onClick={() => void docQ.refetch()} pending={docQ.isFetching} />
                  {!editingHistorical ? (
                    <>
                      <Button size="small" loading={aiImproveMut.isPending} onClick={() => aiImproveMut.mutate("expand")}>
                        {t("page.designDocs.aiExpand")}
                      </Button>
                      <Button size="small" loading={aiImproveMut.isPending} onClick={() => aiImproveMut.mutate("review")}>
                        {t("page.designDocs.aiReview")}
                      </Button>
                      <Button size="small" loading={aiImproveMut.isPending} onClick={() => aiImproveMut.mutate("diagram")}>
                        {t("page.designDocs.aiDiagram")}
                      </Button>
                      <Button type="primary" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                        {t("common.save")}
                      </Button>
                    </>
                  ) : (
                    <Button type="primary" loading={restoreMut.isPending} onClick={() => restoreMut.mutate(previewVersion!)}>
                      {t("page.designDocs.restoreVersion")}
                    </Button>
                  )}
                  <Popconfirm title={t("page.designDocs.confirmDelete")} onConfirm={() => deleteMut.mutate()}>
                    <Button danger loading={deleteMut.isPending}>
                      {t("common.delete")}
                    </Button>
                  </Popconfirm>
                </>
              ) : undefined
            }
          >
            {!selected ? (
              <Empty description={t("page.designDocs.selectDoc")} />
            ) : docQ.isLoading ? (
              <Spin className="block py-12" />
            ) : editingHistorical ? (
              <Tabs
                items={[
                  {
                    key: "preview",
                    label: t("common.preview"),
                    children: (
                      <MarkdownView content={previewContent} className="max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--border)] p-4" />
                    ),
                  },
                ]}
              />
            ) : (
              <MarkdownEditor value={editContent} onChange={setEditContent} rows={22} placeholder={t("page.designDocs.contentPh")} />
            )}
          </WorkbenchPanel>

          {selected ? (
            <WorkbenchPanel
              title={t("page.designDocs.versions")}
              className="!p-3"
              actions={
                versions.length >= 2 ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setCompareFrom(Math.max(1, currentVersion - 1));
                      setCompareTo(currentVersion);
                      setCompareOpen(true);
                    }}
                  >
                    {t("page.designDocs.compare")}
                  </Button>
                ) : undefined
              }
            >
              <Timeline
                pending={versionsQ.isLoading ? t("common.loading") : false}
                items={[...versions].reverse().map((v) => ({
                  color: v.v === currentVersion ? "green" : "gray",
                  children: (
                    <button
                      type="button"
                      className="w-full text-left text-xs hover:text-[var(--brand)]"
                      onClick={() => void loadVersionPreview(v.v)}
                    >
                      <span className="font-medium">v{v.v}</span>
                      {v.note ? <span className="ml-1 text-[var(--muted)]">· {v.note}</span> : null}
                      <div className="text-[10px] text-[var(--muted)]">{v.created_at}</div>
                    </button>
                  ),
                }))}
              />
            </WorkbenchPanel>
          ) : null}
        </div>
      </div>

      <Modal
        title={t("page.designDocs.compareTitle")}
        open={compareOpen}
        onCancel={() => setCompareOpen(false)}
        footer={null}
        width={720}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Select
            className="min-w-24"
            value={compareFrom}
            onChange={setCompareFrom}
            options={versions.map((v) => ({ value: v.v, label: `v${v.v}` }))}
          />
          <span className="text-[var(--muted)]">→</span>
          <Select
            className="min-w-24"
            value={compareTo}
            onChange={setCompareTo}
            options={versions.map((v) => ({ value: v.v, label: `v${v.v}` }))}
          />
        </div>
        {compareQ.data ? (
          <div className="text-xs">
            <Typography.Text>
              +{compareQ.data.added_lines} / -{compareQ.data.removed_lines}
              {compareQ.data.truncated ? ` (${t("page.designDocs.diffTruncated")})` : ""}
            </Typography.Text>
            <pre className="mt-2 max-h-[50vh] overflow-auto rounded-lg bg-[var(--surface-muted)] p-3 text-[11px]">
              {compareQ.data.diff_preview || t("page.designDocs.noDiff")}
            </pre>
          </div>
        ) : null}
      </Modal>

      <Modal
        title={t("page.designDocs.create")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMut.isPending}
        width={720}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" initialValues={{ category: "general" }} onFinish={(v) => createMut.mutate(v)}>
          <Form.Item name="title" label={t("page.designDocs.titlePh")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label={t("page.designDocs.category")}>
            <Select options={["general", "architecture", "api", "data", "ops"].map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="content" label={t("page.designDocs.contentPh")}>
            <Input.TextArea rows={8} className="font-mono text-xs" />
          </Form.Item>
        </Form>
      </Modal>

      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        module="intelligence.design-docs"
        context={{
          doc_id: selected,
          title: panelTitle,
          content_preview: editContent.slice(0, 1200),
        }}
        initialPrompt={t("page.designDocs.aiCopilotPrefill", { title: panelTitle ?? selected })}
      />
    </WorkbenchShell>
  );
}
