import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Card } from "../components/Card";
import { ErrorBlock, LoadingBlock, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";

export function Audit() {
  const { t } = useTranslation();
  const state = useQuery({ queryKey: ["audit-state"], queryFn: api.auditState });
  const verify = useQuery({
    queryKey: ["audit-verify"],
    queryFn: api.auditVerify,
  });

  const refresh = () => {
    void state.refetch();
    void verify.refetch();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">{t("page.audit.subtitle")}</p>
        <RefreshButton onClick={refresh} pending={state.isFetching || verify.isFetching} />
      </div>

      <Card title={t("page.audit.chainHead")}>
        {state.isLoading ? <LoadingBlock /> : null}
        {state.error ? <ErrorBlock message={(state.error as Error).message} /> : null}
        {state.data ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">{t("page.audit.count")}</dt>
              <dd className="text-2xl font-bold tabular-nums">{state.data.count ?? 0}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">{t("page.audit.prevHash")}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-300">
                {String(state.data.prev_hash ?? "—")}
              </dd>
            </div>
          </dl>
        ) : null}
      </Card>

      <Card title={t("page.audit.verify")}>
        {verify.isLoading ? <LoadingBlock /> : null}
        {verify.error ? <ErrorBlock message={(verify.error as Error).message} /> : null}
        {verify.data ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`h-5 w-5 ${verify.data.ok ? "text-emerald-600" : "text-rose-600"}`}
              />
              <span className="text-sm font-medium">
                {verify.data.ok ? t("page.audit.verifyOk") : t("page.audit.verifyFail")}
              </span>
              <span className="text-xs text-slate-500">
                {t("page.audit.total")}: {verify.data.total ?? "—"}
              </span>
            </div>
            {verify.data.errors?.length ? (
              <pre className="overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                {JSON.stringify(verify.data.errors, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
