import { PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input as AntInput, Modal, Select } from "antd";
import { FolderKanban, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
} from "../../../../../src/components/PageStates";
import type { Project, ProjectDraft } from "./types";
import { Badge, MiniStat, entityTitle, managementGrid } from "./ui";

export function PortfolioModule(props: {
  projects: Project[];
  keyword: string;
  setKeyword: (v: string) => void;
  loading: boolean;
  error: Error | null;
  activeProjectId: string;
  selectedProjectId: string;
  setSelectedProject: (id: string) => void;
  draft: ProjectDraft;
  setDraft: (v: ProjectDraft) => void;
  businesses: any[];
  createPending: boolean;
  createError: Error | null;
  onCreate: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <Card title={t("page.projects.list")} className="overflow-hidden">
        <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] lg:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text)]">
              {t("page.projects.list")}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t("page.projects.hint")}
            </p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto]">
            <AntInput
              allowClear
              value={props.keyword}
              onChange={(e) => props.setKeyword(e.target.value)}
              prefix={<Search className="h-4 w-4 text-[var(--muted)]" />}
              placeholder={t("page.projects.searchPh")}
              className="h-10 min-w-0"
            />
            <Button
              className="h-10 px-4 font-semibold shadow-sm"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              {t("page.projects.create")}
            </Button>
          </div>
        </div>
        {props.loading ? <LoadingBlock /> : null}
        {props.error ? <ErrorBlock message={props.error.message} /> : null}
        {!props.loading && !props.error && props.projects.length === 0 ? (
          <EmptyState message={t("page.projects.empty")} />
        ) : null}
        <div className={managementGrid}>
          {props.projects.map((p) => {
            const active = props.activeProjectId === p.id;
            const selected = props.selectedProjectId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => props.setSelectedProject(p.id)}
                className={`min-h-[11rem] rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                  active || selected
                    ? "border-[var(--brand)] bg-[var(--brand-softer)] ring-1 ring-[var(--brand)]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--control-bg)] text-[var(--brand)]">
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  {active ? (
                    <Badge tone="brand" label={t("page.projects.current")} />
                  ) : (
                    <Badge label={p.status || "-"} />
                  )}
                </div>
                <div className="mt-3 min-w-0">
                  <p className={entityTitle} title={p.name}>
                    {p.name}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5 text-[var(--muted)]">
                    {p.id}
                  </p>
                  <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs text-[var(--muted)]">
                    {p.description || t("page.projects.noDescription")}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px] text-[var(--muted-strong)]">
                  <MiniStat label="R" value={p.counts?.requirements ?? 0} />
                  <MiniStat label="T" value={p.counts?.tasks ?? 0} />
                  <MiniStat label="I" value={p.counts?.issues ?? 0} />
                  <MiniStat label="M" value={p.counts?.members ?? 0} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Modal
        open={createOpen}
        title={t("page.projects.create")}
        onCancel={() => setCreateOpen(false)}
        okText={t("page.projects.create")}
        okButtonProps={{
          disabled: !props.draft.name.trim(),
          loading: props.createPending,
        }}
        onOk={async () => {
          try {
            await props.onCreate();
            setCreateOpen(false);
          } catch {
            // Keep the draft and the server error visible for correction.
          }
        }}
        destroyOnHidden
      >
        {props.createError ? (
          <ErrorBlock message={props.createError.message} />
        ) : null}
        <Form layout="vertical" className="mt-3">
          <Form.Item label={t("page.projects.namePh")} required>
            <AntInput
              value={props.draft.name}
              onChange={(e) =>
                props.setDraft({ ...props.draft, name: e.target.value })
              }
              placeholder={t("page.projects.namePh")}
            />
          </Form.Item>
          <Form.Item label={t("page.projects.descPh")}>
            <AntInput.TextArea
              rows={3}
              value={props.draft.description}
              onChange={(e) =>
                props.setDraft({ ...props.draft, description: e.target.value })
              }
              placeholder={t("page.projects.descPh")}
            />
          </Form.Item>
          <Form.Item label={t("page.projects.business")}>
            <Select
              value={props.draft.business_id || ""}
              onChange={(value) =>
                props.setDraft({ ...props.draft, business_id: value })
              }
              options={[
                { label: t("page.projects.noBusiness"), value: "" },
                ...props.businesses.map((b) => ({
                  label: b.name,
                  value: b.id,
                })),
              ]}
            />
          </Form.Item>
          <Form.Item label={t("page.projects.pathPh")}>
            <AntInput
              value={props.draft.project_path}
              onChange={(e) =>
                props.setDraft({ ...props.draft, project_path: e.target.value })
              }
              placeholder={t("page.projects.pathPh")}
            />
          </Form.Item>
          <div className="grid gap-3 sm:grid-cols-2">
            <Form.Item label={t("page.projects.vector")}>
              <Select
                value={props.draft.vector_db}
                onChange={(value) =>
                  props.setDraft({ ...props.draft, vector_db: value })
                }
                options={["lance", "milvus", "qdrant", "oceanbase"].map(
                  (value) => ({ label: value, value }),
                )}
              />
            </Form.Item>
            <Form.Item label={t("page.projects.status")}>
              <Select
                value={props.draft.status}
                onChange={(value) =>
                  props.setDraft({ ...props.draft, status: value })
                }
                options={["active", "planning", "paused", "archived"].map(
                  (value) => ({ label: value, value }),
                )}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}
