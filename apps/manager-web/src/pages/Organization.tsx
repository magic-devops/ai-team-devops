import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";

export function Organization() {
  const { t } = useTranslation();
  const authed = Boolean(getToken());
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: authed });
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: api.businesses, enabled: authed });
  const users = useQuery({ queryKey: ["users"], queryFn: api.authUsers, enabled: authed });

  if (!authed) return <NeedLogin />;

  const refreshAll = () => {
    void projects.refetch();
    void businesses.refetch();
    void users.refetch();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex justify-end">
        <RefreshButton
          onClick={refreshAll}
          pending={projects.isFetching || businesses.isFetching || users.isFetching}
        />
      </div>

      <Card title={t("page.organization.businesses")}>
        {businesses.isLoading ? <LoadingBlock /> : null}
        {businesses.error ? <ErrorBlock message={(businesses.error as Error).message} /> : null}
        {(businesses.data ?? []).length === 0 && !businesses.isLoading ? (
          <EmptyState message={t("page.organization.emptyBusiness")} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(businesses.data ?? []).map((b: { id: string; name: string; project_count?: number }) => (
              <li key={b.id} className="flex justify-between py-2 text-sm">
                <span className="font-medium">{b.name}</span>
                <span className="text-slate-500">{b.project_count ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("page.organization.projects")}>
        {(projects.data ?? []).length === 0 && !projects.isLoading ? (
          <EmptyState message={t("page.projects.empty")} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(projects.data ?? []).map((p: { id: string; name: string }) => (
              <li key={p.id} className="py-2 text-sm">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">{p.id}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("page.organization.users")}>
        {users.error ? <ErrorBlock message={(users.error as Error).message} /> : null}
        {(users.data ?? []).length === 0 && !users.isLoading ? (
          <EmptyState message={t("page.organization.emptyUsers")} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(users.data ?? []).map((u: { id: string; username: string; email?: string; role?: string }) => (
              <li key={u.id} className="flex justify-between py-2 text-sm">
                <span>
                  {u.username}
                  <span className="ml-2 text-xs text-slate-500">{u.email}</span>
                </span>
                <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
                  {u.role}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">{t("page.organization.usersHint")}</p>
      </Card>
    </div>
  );
}
