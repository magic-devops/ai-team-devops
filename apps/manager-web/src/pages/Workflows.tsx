import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getProjectId, getToken } from "../lib/authStorage";

export function Workflows() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const hasProject = Boolean(getProjectId());
  const [type, setType] = useState("");
  const [args, setArgs] = useState("{}");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const types = useQuery({
    queryKey: ["wf-types"],
    queryFn: api.workflowTypes,
    enabled: authed && hasProject,
  });

  const start = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || "{}") as Record<string, unknown>;
      } catch {
        throw new Error(t("page.workflows.invalidJson"));
      }
      return api.startWorkflow({ type, args: parsed });
    },
    onSuccess: (data) => {
      setFlash({ kind: "ok", message: t("page.workflows.started", { id: data?.workflow_id ?? data?.id ?? "—" }) });
      void qc.invalidateQueries({ queryKey: ["wf-types"] });
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  if (!authed) return <NeedLogin />;
  if (!hasProject) return <p className="text-sm text-amber-700">{t("projectSelector.hint")}</p>;

  return (
    <div className="w-full space-y-4">
      {flash ? <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} /> : null}

      <Card
        title={t("page.workflows.available")}
        actions={<RefreshButton onClick={() => void types.refetch()} pending={types.isFetching} />}
      >
        {types.isLoading ? <LoadingBlock /> : null}
        {types.error ? <ErrorBlock message={(types.error as Error).message} /> : null}
        {(types.data ?? []).length === 0 && !types.isLoading && !types.error ? (
          <EmptyState message={t("page.workflows.empty")} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(types.data ?? []).map((wf: { type: string; description?: string; signals?: string[] }) => (
              <li key={wf.type} className="py-3 text-sm">
                <div className="font-mono font-medium text-slate-900 dark:text-slate-100">{wf.type}</div>
                <div className="mt-0.5 text-xs text-slate-500">{wf.description}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {t("page.workflows.signals")}: {(wf.signals ?? []).join(", ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("page.workflows.start")}>
        <div className="space-y-3">
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">{t("page.workflows.choose")}</option>
            {(types.data ?? []).map((wf: { type: string }) => (
              <option key={wf.type} value={wf.type}>
                {wf.type}
              </option>
            ))}
          </select>
          <textarea
            className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
            rows={6}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder='{"key": "value"}'
          />
          <button
            type="button"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!type || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? t("common.loading") : t("page.workflows.startBtn")}
          </button>
          {start.data ? (
            <pre className="overflow-auto rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {JSON.stringify(start.data, null, 2)}
            </pre>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
