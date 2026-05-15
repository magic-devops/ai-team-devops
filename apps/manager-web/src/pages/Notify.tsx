import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { EmptyState, ErrorBlock, LoadingBlock, NeedLogin, RefreshButton } from "../components/PageStates";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";

export function Notify() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [name, setName] = useState("");
  const [type, setType] = useState("dingtalk");
  const [url, setUrl] = useState("");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const channels = useQuery({
    queryKey: ["notifyChannels"],
    queryFn: api.notifyChannels,
    enabled: authed,
  });

  const add = useMutation({
    mutationFn: () =>
      api.notifyAddChannel({
        name,
        type,
        webhook_url: url,
        enabled: true,
        events: ["task_blocked", "issue_p0", "sprint_complete", "deploy"],
      }),
    onSuccess: () => {
      setName("");
      setUrl("");
      setFlash({ kind: "ok", message: t("page.notify.saved") });
      void qc.invalidateQueries({ queryKey: ["notifyChannels"] });
    },
    onError: (err) => setFlash({ kind: "err", message: (err as Error).message }),
  });

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  if (!authed) return <NeedLogin />;

  return (
    <div className="w-full space-y-6">
      {flash ? <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} /> : null}

      <Card
        title={t("page.notify.channels")}
        actions={<RefreshButton onClick={() => void channels.refetch()} pending={channels.isFetching} />}
      >
        {channels.isLoading ? <LoadingBlock /> : null}
        {channels.error ? <ErrorBlock message={(channels.error as Error).message} /> : null}
        {(channels.data ?? []).length === 0 && !channels.isLoading && !channels.error ? (
          <EmptyState message={t("page.notify.empty")} />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {(channels.data ?? []).map((ch: { name: string; type: string; enabled?: boolean }) => (
              <li key={ch.name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-medium">{ch.name}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{ch.type}</span>
                <span className={ch.enabled ? "text-emerald-600" : "text-slate-400"}>
                  {ch.enabled ? t("page.notify.enabled") : t("page.notify.disabled")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("page.notify.add")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder={t("page.notify.namePh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="dingtalk">钉钉</option>
            <option value="wechat_work">企微</option>
            <option value="slack">Slack</option>
            <option value="webhook">Webhook</option>
          </select>
          <input
            className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder={t("page.notify.urlPh")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!name.trim() || !url.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {t("common.save")}
        </button>
      </Card>
    </div>
  );
}
