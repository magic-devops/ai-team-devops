import { Check, Clipboard, ShieldCheck, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

export const inputClass =
  "h-10 min-w-0 w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]";
export const primaryBtn =
  "inline-flex min-h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
export const secondaryBtn =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted-strong)] hover:bg-[var(--surface-muted)] disabled:opacity-50";

export const managementLayout = "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_26rem]";
export const managementGrid = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))]";
export const entityCard = "min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4";
export const entityTitle = "min-w-0 break-words text-base font-semibold leading-6 text-[var(--text)]";
export const entityMeta = "mt-1 break-all font-mono text-xs leading-5 text-[var(--muted)]";
export const entityControlGrid = "mt-3 grid gap-2 sm:grid-cols-2";
export const entityActions = "mt-3 flex flex-wrap gap-2";

export function Snippet({ title, value, copied, onCopy }: { title: string; value: string; copied?: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <Terminal className="h-4 w-4 shrink-0 text-[var(--brand)]" />
          <span className="truncate">{title}</span>
        </div>
        <button type="button" className={secondaryBtn} onClick={onCopy}>
          <Clipboard className="h-3.5 w-3.5" />
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted-strong)]">{value}</pre>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

export function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-1">
      <b className="text-[var(--text)]">{value}</b> {label}
    </span>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "brand" }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone === "brand" ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-[var(--muted-strong)]"}`}>
      {label}
    </span>
  );
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-muted)] px-2 py-1.5">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="truncate font-medium text-[var(--text)]">{value}</p>
    </div>
  );
}

export function ReadinessItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--muted-strong)]">
      {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <ShieldCheck className="h-4 w-4 text-amber-600" />}
      <span>{label}</span>
    </div>
  );
}

export function Input({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}
