import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type {
  AssistanceGeneration,
  AssistanceSource,
} from "@/lib/requirementsAssistance";
import { formatAssistanceDate } from "@/lib/requirementsAssistance";

export const assistanceField =
  "min-w-0 w-full rounded-lg border border-[var(--border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 disabled:opacity-60";
export const assistanceButton =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)] disabled:opacity-50";
export const assistancePrimary = `${assistanceButton} !border-[var(--brand)] !bg-[var(--brand)] !text-white`;

export function AssistanceField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-[var(--muted-strong)]">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function AssistanceSourceSelect({
  source,
  onChange,
  disabled = false,
}: {
  source: AssistanceSource;
  onChange: (source: AssistanceSource) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <legend className="px-1 text-xs font-semibold text-[var(--text)]">
        {t("assistance.source")}
      </legend>
      <div className="flex flex-wrap gap-4">
        {(["ai", "rules"] as const).map((value) => (
          <label
            key={value}
            className="flex items-center gap-2 text-sm text-[var(--text)]"
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={source === value}
              disabled={disabled}
              onChange={() => onChange(value)}
            />
            {t(`assistance.${value}`)}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {t(`assistance.${source}Hint`)}
      </p>
    </fieldset>
  );
}
export function GenerationMetadata({
  generation,
}: {
  generation?: AssistanceGeneration;
}) {
  const { t, i18n } = useTranslation();
  if (!generation) return null;
  const usage = generation.usage || {};
  const total =
    usage.total_tokens ??
    (usage.input_tokens ?? usage.prompt_tokens ?? 0) +
      (usage.output_tokens ?? usage.completion_tokens ?? 0);
  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs"
      aria-label={t("assistance.provenance")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--brand-soft)] px-2 py-1 font-semibold text-[var(--brand)]">
          {t(`assistance.${generation.source}`)}
        </span>
        {generation.model && (
          <span>
            {t("assistance.model")}: {generation.model}
          </span>
        )}
        {generation.provider && (
          <span>
            {t("assistance.provider")}: {generation.provider}
          </span>
        )}
        <span className="text-[var(--muted)]">
          {generation.source === "ai"
            ? `${t("assistance.tokens")}: ${total}`
            : t("assistance.noUsage")}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
        <span title={generation.id}>
          {t("assistance.record")}:{" "}
          <span className="font-mono">
            {generation.id.length > 16
              ? `${generation.id.slice(0, 12)}…`
              : generation.id}
          </span>
        </span>
        {generation.basis && (
          <span title={generation.basis}>
            {t("assistance.basis")}:{" "}
            <span className="font-mono">{generation.basis.slice(0, 12)}…</span>
          </span>
        )}
        {generation.created_at && (
          <time dateTime={generation.created_at}>
            {formatAssistanceDate(
              generation.created_at,
              i18n?.resolvedLanguage || i18n?.language || "zh-CN",
            )}
          </time>
        )}
      </div>
    </div>
  );
}
export function AssistanceConflict({
  latest,
  stale,
  loading,
  onLoad,
  onAdopt,
}: {
  latest?: number;
  stale: boolean;
  loading: boolean;
  onLoad: () => void;
  onAdopt: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
      role="alert"
    >
      <p className="text-sm text-[var(--text)]">
        {t(stale ? "assistance.stale" : "assistance.conflict")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={assistanceButton}
          disabled={loading}
          onClick={onLoad}
        >
          {t("assistance.loadLatest")}
        </button>
        {latest != null && (
          <button
            type="button"
            className={assistanceButton}
            disabled={stale}
            onClick={onAdopt}
          >
            {t("assistance.adoptLatest")}
          </button>
        )}
      </div>
      {latest != null && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          {t("assistance.loadedVersion", { version: latest })}
        </p>
      )}
    </div>
  );
}
