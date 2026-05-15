import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { FlashMessage } from "../components/FlashMessage";
import { api } from "../lib/api";
import { getToken } from "../lib/authStorage";

type Flash = { kind: "ok" | "err"; message: string } | null;

export function Platforms() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authed = Boolean(getToken());
  const [flash, setFlash] = useState<Flash>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["platforms"],
    queryFn: api.platformsList,
    enabled: authed,
  });

  const install = useMutation({
    mutationFn: (id: string) => api.platformsInstallShims(id),
    onMutate: (id) => setInstallingId(id),
    onSuccess: (data, id) => {
      const shim = (data as { shim?: string })?.shim;
      setFlash({
        kind: "ok",
        message: t("page.platforms.installOk", { id, shim: shim || "—" }),
      });
      void qc.invalidateQueries({ queryKey: ["platforms"] });
    },
    onError: (err) => {
      setFlash({ kind: "err", message: (err as Error).message });
    },
    onSettled: () => setInstallingId(null),
  });

  useEffect(() => {
    if (!flash) return;
    const tmr = window.setTimeout(() => setFlash(null), 8000);
    return () => window.clearTimeout(tmr);
  }, [flash]);

  if (!authed) {
    return <div className="text-sm text-rose-600">{t("auth.dashboardNeedLogin")}</div>;
  }

  const rows = q.data?.platforms ?? [];

  return (
    <div className="w-full space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">{t("page.platforms.hint")}</p>
      {flash ? (
        <FlashMessage kind={flash.kind} message={flash.message} onDismiss={() => setFlash(null)} />
      ) : null}
      <Card title={t("page.platforms.list")}>
        {q.isLoading ? <p className="text-sm text-slate-500">…</p> : null}
        {q.error ? <p className="text-sm text-rose-600">{(q.error as Error).message}</p> : null}
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map((p: any) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-slate-500">{p.id}</span>
                <div className="text-xs text-slate-500">
                  {p.category} · {p.integration}
                  {p.cli_available ? " · CLI ✓" : ""}
                  {p.hook_shim_present ? " · shim ✓" : ""}
                </div>
              </div>
              {p.integration === "hooks" && !p.hook_shim_present ? (
                <button
                  type="button"
                  className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600"
                  disabled={install.isPending}
                  onClick={() => install.mutate(p.id)}
                >
                  {installingId === p.id
                    ? t("page.platforms.installing")
                    : t("page.platforms.installShim")}
                </button>
              ) : p.hook_shim_present ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {t("page.platforms.shimReady")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
