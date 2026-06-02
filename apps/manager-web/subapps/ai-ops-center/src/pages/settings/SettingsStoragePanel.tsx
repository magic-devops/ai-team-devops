import { Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";

type Props = {
  opsStorageMigrationPlan: any;
  storageSmokeResult: any;
  runStorageSmoke: any;
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

function MetricBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text)]">{value.toLocaleString()}</p>
    </div>
  );
}

function formatBytes(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function SettingsStoragePanel({ opsStorageMigrationPlan, storageSmokeResult, runStorageSmoke }: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t("page.settings.storageCard")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            disabled={opsStorageMigrationPlan.isFetching}
            onClick={() => void opsStorageMigrationPlan.refetch()}
          >
            {t("common.refresh")}
          </button>
          <button
            type="button"
            className="rounded-xl bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={runStorageSmoke.isPending}
            onClick={() => runStorageSmoke.mutate()}
          >
            {t("page.settings.storageRunSmoke")}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <Database className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageTarget")}</p>
                <p className="truncate text-xs text-[var(--muted)]">{String(opsStorageMigrationPlan.data?.target?.database || "oceanbase")} / {String(opsStorageMigrationPlan.data?.target?.mode || "mysql")}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <Info label={t("page.settings.storageCurrentDb")} value={String(opsStorageMigrationPlan.data?.current?.db_type || "-")} />
              <Info label={t("page.settings.storageCharset")} value={String(opsStorageMigrationPlan.data?.target?.charset || "-")} />
              <Info label={t("page.settings.storageMigrationFiles")} value={String(opsStorageMigrationPlan.data?.migrations?.length ?? 0)} />
              <Info label={t("page.settings.storageSqlitePath")} value={String(opsStorageMigrationPlan.data?.current?.sqlite_dev_path || "-")} />
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageSmokeChecks")}</p>
            <div className="mt-3 space-y-2">
              {(storageSmokeResult?.checks || []).map((check: any) => (
                <div key={check.id} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-[var(--text)]">{check.id}</p>
                    <p className="mt-1 truncate text-[11px] text-[var(--muted)]">{check.message}</p>
                  </div>
                  <StatusPill tone={check.ok ? "ok" : "danger"} label={check.ok ? "OK" : "FAIL"} />
                </div>
              ))}
              {!storageSmokeResult?.checks?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.storageSmokeEmpty")}</p> : null}
            </div>
            {runStorageSmoke.error ? <ErrorLine message={(runStorageSmoke.error as Error).message} /> : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricBox label={t("page.settings.storageCoreTables")} value={opsStorageMigrationPlan.data?.core_tables?.length ?? 0} />
            <MetricBox label={t("page.settings.storageScopeColumns")} value={opsStorageMigrationPlan.data?.scope_columns?.length ?? 0} />
            <MetricBox label={t("page.settings.storageScopeIndexes")} value={opsStorageMigrationPlan.data?.scope_indexes?.length ?? 0} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="grid grid-cols-[1fr_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
              <span>{t("page.settings.storageMigration")}</span>
              <span>{t("page.settings.storageBytes")}</span>
            </div>
            {(opsStorageMigrationPlan.data?.migrations || []).map((migration: any) => (
              <div key={migration.id} className="grid grid-cols-[1fr_6rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-[var(--text)]">{migration.id}</p>
                  <p className="truncate text-[11px] text-[var(--muted)]">{migration.file}</p>
                </div>
                <p className="text-right font-mono text-xs text-[var(--muted-strong)]">{formatBytes(migration.bytes)}</p>
              </div>
            ))}
            {!opsStorageMigrationPlan.data?.migrations?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.storageNoMigrations")}</div> : null}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.storageBackupRestore")}</p>
            <div className="mt-3 space-y-2">
              {(opsStorageMigrationPlan.data?.backup_restore_checklist || []).map((item: string, index: number) => (
                <div key={`${index}-${item}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs">
                  <span className="font-mono text-[var(--brand)]">{index + 1}</span>
                  <span className="leading-5 text-[var(--muted-strong)]">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {opsStorageMigrationPlan.isError ? <ErrorLine message={(opsStorageMigrationPlan.error as Error).message} /> : null}
        </div>
      </div>
    </Card>
  );
}
