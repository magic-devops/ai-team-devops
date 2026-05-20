import { Building2, Check, Loader2, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../../../../../src/components/Card";
import { EmptyState, ErrorBlock } from "../../../../../src/components/PageStates";
import type { Project, TabKey } from "./types";
import { Info, Input, ReadinessItem, inputClass, primaryBtn, secondaryBtn } from "./ui";

export function ProjectInspector(props: {
  project?: Project;
  membersCount: number;
  onSelectTab: (tab: TabKey) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  patchPending: boolean;
  patchError: Error | null;
  onDelete: () => void;
  deletePending: boolean;
  businesses: any[];
}) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState({ name: "", description: "", business_id: "", project_path: "", status: "active" });
  useEffect(() => {
    setEdit({
      name: props.project?.name ?? "",
      description: props.project?.description ?? "",
      business_id: props.project?.business_id ?? "",
      project_path: props.project?.project_path ?? "",
      status: props.project?.status ?? "active",
    });
  }, [props.project?.id, props.project?.name, props.project?.description, props.project?.business_id, props.project?.project_path, props.project?.status]);
  if (!props.project) {
    return <Card title={t("page.projects.inspector")}><EmptyState message={t("page.projects.pickProject")} /></Card>;
  }
  const dirty =
    edit.name !== (props.project.name ?? "") ||
    edit.description !== (props.project.description ?? "") ||
    edit.business_id !== (props.project.business_id ?? "") ||
    edit.project_path !== (props.project.project_path ?? "") ||
    edit.status !== (props.project.status ?? "active");
  return (
    <aside className="space-y-4">
      <Card title={t("page.projects.inspector")}>
        {props.patchError ? <ErrorBlock message={props.patchError.message} /> : null}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">{props.project.name}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-[var(--muted)]">{props.project.id}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info label={t("page.projects.status")} value={props.project.status || "-"} />
            <Info label={t("page.projects.vector")} value={props.project.vector_db || "-"} />
            <Info label={t("page.projects.membersShort")} value={String(props.membersCount)} />
            <Info label={t("page.projects.business")} value={props.project.business_name || props.project.business_id || "-"} />
          </div>
          <Input value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} placeholder={t("page.projects.namePh")} />
          <Input value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} placeholder={t("page.projects.descPh")} />
          <select className={inputClass} value={edit.business_id} onChange={(e) => setEdit({ ...edit, business_id: e.target.value })} disabled={props.patchPending}>
            <option value="">{t("page.projects.noBusiness")}</option>
            {props.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Input value={edit.project_path} onChange={(v) => setEdit({ ...edit, project_path: v })} placeholder={t("page.projects.pathPh")} />
          <select className={inputClass} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} disabled={props.patchPending}>
            {["active", "planning", "paused", "archived"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <button type="button" disabled={!dirty || !edit.name.trim() || props.patchPending} onClick={() => props.onPatch(edit)} className={primaryBtn}>
            {props.patchPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("common.save")}
          </button>
          <a href="#/projects/delivery-kit" className={`${secondaryBtn} col-span-2`}>
            <Sparkles className="h-4 w-4" />
            {t("page.projects.deliveryKit.badge")}
          </a>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => props.onSelectTab("members")} className={secondaryBtn}><Users className="h-4 w-4" />{t("page.projects.members")}</button>
            <button type="button" onClick={() => props.onSelectTab("business")} className={secondaryBtn}><Building2 className="h-4 w-4" />{t("page.projects.module.business")}</button>
          </div>
          <button type="button" disabled={props.deletePending} onClick={props.onDelete} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50">
            <Trash2 className="h-4 w-4" />
            {t("page.projects.delete")}
          </button>
        </div>
      </Card>
      <Card title={t("page.projects.aiReadiness")}>
        <div className="grid gap-2 text-sm">
          <ReadinessItem ok={Boolean(props.project.project_path)} label={t("page.projects.readyPath")} />
          <ReadinessItem ok={props.membersCount > 1} label={t("page.projects.readyMembers")} />
          <ReadinessItem ok={Boolean(props.project.counts?.requirements || props.project.counts?.tasks)} label={t("page.projects.readyWork")} />
          <ReadinessItem ok={props.project.status === "active"} label={t("page.projects.readyActive")} />
        </div>
      </Card>
    </aside>
  );
}
