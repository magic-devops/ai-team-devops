import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NeedLogin() {
  const { t } = useTranslation();
  const loginHref = `/login.html?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-50/95"
    >
      <span>{t("auth.dashboardNeedLogin")}</span>{" "}
      <a href={loginHref} className="font-semibold text-brand-700 underline dark:text-brand-300">
        {t("auth.openLogin")}
      </a>
    </div>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ?? t("common.loading")}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {message}
    </p>
  );
}

export function RefreshButton({ onClick, pending }: { onClick: () => void; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
      onClick={onClick}
      disabled={pending}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {t("common.refresh")}
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t("common.search")}
      className="w-full min-w-56 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-1.5 text-sm text-[var(--text)] shadow-sm placeholder:text-[var(--muted)]"
    />
  );
}
