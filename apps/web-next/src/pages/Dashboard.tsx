import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Dashboard() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  const audit = useQuery({ queryKey: ["audit"], queryFn: api.auditState });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card title={t("nav.projects")}>
        <div className="text-3xl font-semibold text-brand-600">
          {projects.data?.length ?? "—"}
        </div>
      </Card>
      <Card title={t("nav.tasks")}>
        <div className="text-3xl font-semibold text-brand-600">
          {tasks.data?.length ?? "—"}
        </div>
      </Card>
      <Card title="Manager">
        <div className="font-mono text-sm">
          {health.data?.ok === true ? `ok · ${health.data?.version ?? ""}` : "—"}
        </div>
      </Card>
      <Card title={t("nav.audit")}>
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          {t("common.loading", { context: audit.isLoading })}
          {audit.data ? (
            <>
              <div>count: <b>{audit.data.count}</b></div>
              <div className="truncate font-mono text-xs">head: {audit.data.prev_hash}</div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
