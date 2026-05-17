import { BranchesOutlined } from "@ant-design/icons";
import { Button, Checkbox, Form, Input as AntInput, Select } from "antd";
import { Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../components/Card";
import { ErrorBlock } from "../../components/PageStates";
import type { Project } from "./types";
import { entityCard, entityMeta, entityTitle, managementGrid, primaryBtn } from "./ui";

export type TemplatePanelKey = "overview" | "catalog" | "clone" | "capabilities";

export type CloneDraft = {
  template_id: string;
  name: string;
  description: string;
  business_id: string;
  project_path: string;
  clone_requirements: boolean;
  clone_tasks: boolean;
  clone_knowledge: boolean;
  clone_rules: boolean;
};

export function TemplatesModule(props: {
  projects: Project[];
  templates: any[];
  businesses: any[];
  selectedProject?: Project;
  cloneDraft: CloneDraft;
  setCloneDraft: (v: CloneDraft) => void;
  clonePending: boolean;
  cloneError: Error | null;
  clonePreview?: any;
  clonePreviewPending?: boolean;
  clonePreviewError?: Error | null;
  togglePending: boolean;
  initialPanel?: TemplatePanelKey;
  embedded?: boolean;
  onToggle: (projectId: string, value: boolean) => void;
  onPreviewClone: () => void;
  onClone: () => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<TemplatePanelKey>(props.initialPanel ?? "overview");
  const templateProjects = props.projects.filter((p) => p.is_template);
  const reusableCount = templateProjects.length;

  useEffect(() => {
    setPanel(props.initialPanel ?? "overview");
  }, [props.initialPanel]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-[var(--brand)]/40 bg-[var(--brand-soft)]/30 px-4 py-3 text-sm leading-6 text-[var(--muted-strong)]">
        {t("page.projects.deliveryKit.templatesIntro")}
      </div>

      {!props.embedded ? (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["overview", t("page.projects.templateOverview")],
              ["catalog", t("page.projects.templateCatalog")],
              ["clone", t("page.projects.templateCloneWizard")],
              ["capabilities", t("page.projects.templateCapabilities")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPanel(key)}
              className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium ${
                panel === key
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--control-bg)] text-[var(--muted-strong)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {panel === "overview" || panel === "catalog" ? (
        <Card
          title={panel === "overview" ? t("page.projects.templateOverview") : t("page.projects.templateCatalog")}
          actions={
            <a href="#/projects/templates/clone" className={`${primaryBtn} w-auto`}>
              <BranchesOutlined />
              {t("page.projects.cloneFromTemplate")}
            </a>
          }
        >
          {panel === "overview" ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <TemplateMetric label={t("page.projects.templateReusable")} value={String(reusableCount)} />
              <TemplateMetric label={t("page.projects.templateProjects")} value={String(props.templates.length)} />
              <TemplateMetric label={t("page.projects.templateBusinessLines")} value={String(props.businesses.length)} />
            </div>
          ) : null}
          {reusableCount === 0 ? (
            <p className="mb-4 text-sm text-[var(--muted)]">{t("page.projects.deliveryKit.noTemplates")}</p>
          ) : null}
          <div className={managementGrid}>
            {(panel === "catalog" ? templateProjects : props.projects).map((p) => (
              <div key={p.id} className={entityCard}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={entityTitle} title={p.name}>
                      {p.name}
                      {p.is_template ? (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
                          {t("page.projects.deliveryKit.templateTag")}
                        </span>
                      ) : null}
                    </p>
                    <p className={entityMeta} title={p.id}>{p.id}</p>
                  </div>
                  <Button size="small" disabled={props.togglePending} onClick={() => props.onToggle(p.id, !p.is_template)}>
                    {p.is_template ? t("page.projects.unsetTemplate") : t("page.projects.setTemplate")}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">{p.description || t("page.projects.noDescription")}</p>
                {p.is_template ? (
                  <button
                    type="button"
                    className="mt-3 text-xs font-medium text-[var(--brand)] hover:underline"
                    onClick={() => {
                      props.setCloneDraft({ ...props.cloneDraft, template_id: p.id, name: `${p.name}-copy` });
                      window.location.hash = "#/projects/templates/clone";
                    }}
                  >
                    {t("page.projects.deliveryKit.useAsTemplate")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {panel === "clone" ? (
        <Card title={t("page.projects.templateCloneWizard")}>
          <p className="mb-4 text-sm leading-6 text-[var(--muted-strong)]">{t("page.projects.templateCloneDesc")}</p>
          <CloneForm {...props} inline />
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm">
            <Sparkles className="h-4 w-4 text-[var(--brand)]" />
            <span className="text-[var(--muted-strong)]">{t("page.projects.deliveryKit.afterClone")}</span>
            <a href="#/projects/onboarding" className="font-medium text-[var(--brand)] hover:underline">
              {t("page.projects.onboarding")}
            </a>
          </div>
        </Card>
      ) : null}

      {panel === "capabilities" ? (
        <Card title={t("page.projects.templateCapabilities")}>
          <div className="grid gap-3 lg:grid-cols-2">
            {[
              { key: "clone_requirements", label: t("page.projects.cloneRequirements"), desc: t("page.projects.deliveryKit.capReq") },
              { key: "clone_tasks", label: t("page.projects.cloneTasks"), desc: t("page.projects.deliveryKit.capTasks") },
              { key: "clone_knowledge", label: t("page.projects.cloneKnowledge"), desc: t("page.projects.deliveryKit.capKnowledge") },
              { key: "clone_rules", label: t("page.projects.cloneRules"), desc: t("page.projects.deliveryKit.capRules") },
            ].map((item) => (
              <div key={item.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <Copy className="h-4 w-4 text-[var(--brand)]" />
                  {item.label}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CloneForm(
  props: {
    cloneDraft: CloneDraft;
    setCloneDraft: (v: CloneDraft) => void;
    templates: any[];
    businesses: any[];
    clonePending: boolean;
    cloneError: Error | null;
    clonePreview?: any;
    clonePreviewPending?: boolean;
    clonePreviewError?: Error | null;
    onPreviewClone: () => void;
    onClone: () => void;
    inline?: boolean;
  },
) {
  const { t } = useTranslation();
  return (
    <Form layout="vertical">
      {props.cloneError ? <ErrorBlock message={props.cloneError.message} /> : null}
      {props.clonePreviewError ? <ErrorBlock message={props.clonePreviewError.message} /> : null}
      <Form.Item label={t("page.projects.pickTemplate")} required>
        <Select
          showSearch
          value={props.cloneDraft.template_id || undefined}
          placeholder={t("page.projects.pickTemplate")}
          optionFilterProp="label"
          options={props.templates.map((tpl) => ({ label: tpl.name, value: tpl.id }))}
          onChange={(value) => props.setCloneDraft({ ...props.cloneDraft, template_id: value })}
        />
      </Form.Item>
      <Form.Item label={t("page.projects.namePh")} required>
        <AntInput value={props.cloneDraft.name} onChange={(e) => props.setCloneDraft({ ...props.cloneDraft, name: e.target.value })} />
      </Form.Item>
      <Form.Item label={t("page.projects.descPh")}>
        <AntInput.TextArea rows={2} value={props.cloneDraft.description} onChange={(e) => props.setCloneDraft({ ...props.cloneDraft, description: e.target.value })} />
      </Form.Item>
      <Form.Item label={t("page.projects.business")}>
        <Select
          value={props.cloneDraft.business_id || ""}
          options={[{ label: t("page.projects.useTemplateBusiness"), value: "" }, ...props.businesses.map((b) => ({ label: b.name, value: b.id }))]}
          onChange={(value) => props.setCloneDraft({ ...props.cloneDraft, business_id: value })}
        />
      </Form.Item>
      <Form.Item label={t("page.projects.pathPh")}>
        <AntInput value={props.cloneDraft.project_path} onChange={(e) => props.setCloneDraft({ ...props.cloneDraft, project_path: e.target.value })} />
      </Form.Item>
      <Form.Item>
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          {(
            [
              ["clone_requirements", t("page.projects.cloneRequirements")],
              ["clone_tasks", t("page.projects.cloneTasks")],
              ["clone_knowledge", t("page.projects.cloneKnowledge")],
              ["clone_rules", t("page.projects.cloneRules")],
            ] as const
          ).map(([key, label]) => (
            <Checkbox
              key={key}
              checked={Boolean(props.cloneDraft[key])}
              onChange={(e) => props.setCloneDraft({ ...props.cloneDraft, [key]: e.target.checked })}
            >
              {label}
            </Checkbox>
          ))}
        </div>
      </Form.Item>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!props.cloneDraft.template_id || !props.cloneDraft.name.trim()} loading={props.clonePreviewPending} onClick={props.onPreviewClone}>
          {t("page.projects.previewClone")}
        </Button>
        <Button
          type="primary"
          icon={<BranchesOutlined />}
          disabled={!props.cloneDraft.template_id || !props.cloneDraft.name.trim()}
          loading={props.clonePending}
          onClick={props.onClone}
        >
          {t("page.projects.clone")}
        </Button>
      </div>
      <ClonePreviewPanel preview={props.clonePreview} pending={props.clonePreviewPending} error={null} />
    </Form>
  );
}

function ClonePreviewPanel({ preview, pending, error }: { preview?: any; pending?: boolean; error?: Error | null }) {
  const { t } = useTranslation();
  if (pending) {
    return <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{t("common.loading")}</div>;
  }
  if (error) return <ErrorBlock message={error.message} />;
  if (!preview) return null;
  const assets = preview.selected_assets ?? {};
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-sm font-semibold text-[var(--text)]">{t("page.projects.clonePreview")}</div>
      <div className="grid gap-2 sm:grid-cols-5">
        {["requirements", "tasks", "knowledge", "rules", "specs"].map((key) => (
          <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
            <div className="text-xs text-[var(--muted)]">{t(`page.projects.cloneAsset.${key}`)}</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text)]">{assets[key] ?? 0}</div>
          </div>
        ))}
      </div>
      {(preview.warnings ?? []).length ? (
        <div className="space-y-2">
          {(preview.warnings ?? []).map((item: any, idx: number) => (
            <div key={`${item.message}-${idx}`} className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {item.message}
            </div>
          ))}
        </div>
      ) : null}
      <ol className="space-y-2">
        {(preview.recommended_after_clone ?? []).map((row: string, idx: number) => (
          <li key={row} className="flex gap-2 text-xs text-[var(--muted-strong)]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">{idx + 1}</span>
            <span className="leading-5">{row}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TemplateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}
