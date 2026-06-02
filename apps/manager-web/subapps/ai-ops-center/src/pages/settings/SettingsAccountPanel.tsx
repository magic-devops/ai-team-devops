import { LogOut, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";

type Props = {
  me: any;
  tenantLabel: string;
  projectId?: string | null;
  logoutPending: boolean;
  onLogout: () => void;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function HintLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">{message}</div>;
}

export function SettingsAccountPanel({ me, tenantLabel, projectId, logoutPending, onLogout }: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t("page.settings.accountCard")}
      actions={<StatusPill tone={me.isError ? "danger" : "ok"} label={me.isError ? t("page.settings.sessionError") : t("auth.secure")} />}
    >
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-[var(--text)]">{me.data?.username || t("auth.account")}</p>
              <p className="truncate text-xs text-[var(--muted)]">{me.data?.email || me.data?.role || t("auth.loggedIn")}</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text)] shadow-sm hover:bg-[var(--surface-muted)] disabled:opacity-50"
            disabled={logoutPending}
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4 text-[var(--brand)]" />
            {t("auth.logout")}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Info label={t("auth.status")} value={t("auth.loggedIn")} />
          <Info label={t("auth.role")} value={me.data?.role || "-"} />
          <Info label={t("auth.tenant")} value={tenantLabel} />
          <Info label={t("auth.project")} value={projectId || "-"} />
        </div>
      </div>
      {me.isError ? <ErrorLine message={(me.error as Error).message} /> : null}
      {!projectId ? <HintLine message={t("auth.noProject")} /> : null}
    </Card>
  );
}
