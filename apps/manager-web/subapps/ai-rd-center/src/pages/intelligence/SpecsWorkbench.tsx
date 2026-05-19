import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Input, List, Spin, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { api } from "@/lib/api";
import { WorkbenchShell } from "@/pages/shared/WorkbenchShell";
import { RefreshButton, WorkbenchPanel, WorkbenchStats } from "@/pages/shared/workbenchUi";

type SpecItem = { path: string; category?: string; size?: number };

export function SpecsWorkbench({ focused = false }: { focused?: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [editContent, setEditContent] = useState("");
  const [q, setQ] = useState("");

  const listQ = useQuery({ queryKey: ["specs"], queryFn: api.specsList });
  const summaryQ = useQuery({ queryKey: ["specsSummary"], queryFn: api.specsSummary });
  const contentQ = useQuery({
    queryKey: ["specContent", selected],
    queryFn: () => api.specsContent(selected),
    enabled: Boolean(selected),
  });

  const saveMut = useMutation({
    mutationFn: () => api.specsSaveContent(selected, editContent),
    onSuccess: () => {
      message.success(t("page.specs.saved"));
      void qc.invalidateQueries({ queryKey: ["specContent", selected] });
    },
    onError: (e) => message.error((e as Error).message),
  });

  const items: SpecItem[] = listQ.data ?? [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((x) => x.path.toLowerCase().includes(n) || (x.category ?? "").toLowerCase().includes(n));
  }, [items, q]);

  const categories = useMemo(() => new Set(items.map((x) => x.category).filter(Boolean)), [items]);

  useEffect(() => {
    if (contentQ.data?.content != null) setEditContent(String(contentQ.data.content));
  }, [contentQ.data?.content]);

  return (
    <WorkbenchShell
      title={t("page.specs.title")}
      description={focused ? t("page.specs.focusedHint") : t("page.specs.desc")}
      actions={
        <Button href="#/intelligence/kb">{t("page.specs.openKb")}</Button>
      }
      metrics={
        <WorkbenchStats
          items={[
            { label: t("page.specs.files"), value: summaryQ.data?.total ?? items.length },
            { label: t("page.specs.categories"), value: Object.keys(summaryQ.data?.by_category ?? {}).length || categories.size },
          ]}
        />
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <WorkbenchPanel className="!p-3">
          <Input.Search allowClear placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
          <List
            size="small"
            loading={listQ.isLoading}
            dataSource={filtered}
            locale={{ emptyText: t("page.specs.empty") }}
            renderItem={(item) => (
              <List.Item
                className={`cursor-pointer rounded-lg px-2 ${selected === item.path ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-muted)]"}`}
                onClick={() => setSelected(item.path)}
              >
                <List.Item.Meta
                  title={<span className="text-xs font-medium">{item.path}</span>}
                  description={item.category ? <Tag className="text-[10px]">{item.category}</Tag> : null}
                />
              </List.Item>
            )}
          />
        </WorkbenchPanel>
        <WorkbenchPanel
          title={selected || undefined}
          actions={
            selected ? (
              <>
                <RefreshButton onClick={() => void contentQ.refetch()} pending={contentQ.isFetching} />
                <Button type="primary" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                  {t("common.save")}
                </Button>
              </>
            ) : undefined
          }
        >
          {!selected ? (
            <Alert type="info" showIcon message={t("page.specs.selectFile")} />
          ) : contentQ.isLoading ? (
            <Spin className="block py-8" />
          ) : (
            <MarkdownEditor value={editContent} onChange={setEditContent} rows={22} />
          )}
        </WorkbenchPanel>
      </div>
    </WorkbenchShell>
  );
}
