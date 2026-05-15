import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { getProjectId, getToken, setProjectId } from "../lib/authStorage";

export function ProjectSelector() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const current = getProjectId();

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    enabled: authed,
  });

  if (!authed) return null;

  return (
    <label className="flex items-center gap-1.5 text-sm">
      {projects.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--muted)]" /> : null}
      <select
        className="max-w-[14rem] truncate rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-sm text-[var(--text)] shadow-sm"
        value={current ?? ""}
        onChange={(e) => setProjectId(e.target.value || null)}
        aria-label={t("projectSelector.label")}
        title={t("projectSelector.hint")}
        disabled={projects.isLoading}
      >
        <option value="">{t("projectSelector.placeholder")}</option>
        {(projects.data ?? []).map((p: { id: string; name: string }) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
