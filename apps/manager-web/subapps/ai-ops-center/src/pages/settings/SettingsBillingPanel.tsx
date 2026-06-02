import { BadgeDollarSign } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Drawer, Form, Input, Select, Space, Steps } from "antd";
import { Card } from "@/components/Card";
import { api } from "@/lib/api";

const inputClass = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

type Props = {
  billing: any;
  billingAlerts: any;
  billingSummary: any;
  billingDunning: any;
  billingOveragePolicy: any;
  invoice: any;
  invoices: any;
  payments: any;
  invoiceAudit: any;
  planDraft: string;
  setPlanDraft: (value: string) => void;
  billingEmail: string;
  setBillingEmail: (value: string) => void;
  paymentDraft: any;
  setPaymentDraft: (value: any) => void;
  overageDraft: any;
  setOverageDraft: (value: any) => void;
  entitlementDraft: any;
  setEntitlementDraft: (value: any) => void;
  entitlementResult: any;
  billingDrawerOpen: boolean;
  setBillingDrawerOpen: (value: boolean) => void;
  auditInvoiceId: string;
  setAuditInvoiceId: (value: string) => void;
  updateBilling: any;
  updateOveragePolicy: any;
  checkEntitlement: any;
  snapshotInvoice: any;
  updateInvoiceStatus: any;
  recordPayment: any;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-[var(--muted-strong)]">{value}</dd>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "danger"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : tone === "danger"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}

function ErrorLine({ message }: { message: string }) {
  return <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{message}</div>;
}

function BillingAlert({ alert }: { alert: { severity?: string; message?: string; action?: string; percent?: number } }) {
  const severity = String(alert.severity || "info");
  const cls =
    severity === "critical"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200"
      : severity === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
        : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{alert.message}</p>
        {alert.percent !== undefined ? <span className="font-mono text-xs">{alert.percent}%</span> : null}
      </div>
      {alert.action ? <p className="mt-1 text-xs opacity-80">{alert.action}</p> : null}
    </div>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-xl font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function UsageQuotaCard({ metric, row }: { metric: string; row: { used?: number; limit?: number; percent?: number } }) {
  const percent = Number(row.percent ?? 0);
  const tone = percent >= 90 ? "bg-rose-500" : percent >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-[var(--text)]">{metric}</p>
        <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]">
        <span>used {formatNumber(row.used)}</span>
        <span className="text-right">limit {formatNumber(row.limit)}</span>
      </div>
    </div>
  );
}

function formatNumber(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function SettingsBillingPanel({
  billing,
  billingAlerts,
  billingSummary,
  billingDunning,
  invoice,
  invoices,
  payments,
  invoiceAudit,
  planDraft,
  setPlanDraft,
  billingEmail,
  setBillingEmail,
  paymentDraft,
  setPaymentDraft,
  overageDraft,
  setOverageDraft,
  entitlementDraft,
  setEntitlementDraft,
  entitlementResult,
  billingDrawerOpen,
  setBillingDrawerOpen,
  auditInvoiceId,
  setAuditInvoiceId,
  updateBilling,
  updateOveragePolicy,
  checkEntitlement,
  snapshotInvoice,
  updateInvoiceStatus,
  recordPayment,
}: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t("page.settings.billingCard")}
      actions={<StatusPill tone={billingAlerts.data?.total ? "warn" : billing.isError ? "danger" : "ok"} label={billingAlerts.data?.total ? `${billingAlerts.data.total} ${t("page.settings.alerts")}` : String(billing.data?.subscription?.status || "...")} />}
    >
      {billingAlerts.data?.items?.length ? (
        <div className="mb-4 grid gap-2 lg:grid-cols-3">
          {billingAlerts.data.items.map((alert: any) => (
            <BillingAlert key={alert.id || alert.message} alert={alert} />
          ))}
        </div>
      ) : null}
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <BillingMetric label={t("page.settings.invoiceCount")} value={String(billingSummary.data?.invoice_count ?? 0)} />
        <BillingMetric label={t("page.settings.invoiceTotal")} value={`$${formatMoney(billingSummary.data?.invoice_total_usd)}`} />
        <BillingMetric label={t("page.settings.paidTotal")} value={`$${formatMoney(billingSummary.data?.paid_total_usd)}`} />
        <BillingMetric label={t("page.settings.outstanding")} value={`$${formatMoney(billingSummary.data?.outstanding_usd)}`} />
      </div>
      <div className="mb-5 grid gap-4 xl:grid-cols-3">
        <div className="billingControlQuickSummary rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.billingOperationsTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.billingOperationsDesc")}</p>
            </div>
            <BadgeDollarSign className="h-5 w-5 text-[var(--brand)]" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Info label={t("page.settings.plan")} value={planDraft || String(billing.data?.subscription?.plan || "-")} />
            <Info label={t("page.settings.overagePolicy")} value={t(`page.settings.overageMode.${overageDraft.mode}`)} />
            <Info label={t("page.settings.billingEmail")} value={billingEmail || "-"} />
            <Info label={t("page.settings.openInvoices")} value={String(billingDunning.data?.summary?.open_invoices ?? 0)} />
          </div>
          <Button className="mt-4 w-full" type="primary" onClick={() => setBillingDrawerOpen(true)}>
            {t("page.settings.billingOpenDrawer")}
          </Button>
          {billing.isError ? <ErrorLine message={(billing.error as Error).message} /> : null}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.entitlementCheck")}</p>
          <div className="mt-3 space-y-2">
            <input className={inputClass} value={entitlementDraft.feature} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, feature: e.target.value })} placeholder="team_rbac / sso" />
            <input className={inputClass} value={entitlementDraft.metric} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, metric: e.target.value })} placeholder="llm_tokens" />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} value={entitlementDraft.delta} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, delta: e.target.value })} placeholder="1000" inputMode="decimal" />
              <input className={inputClass} value={entitlementDraft.subject} onChange={(e) => setEntitlementDraft({ ...entitlementDraft, subject: e.target.value })} placeholder="agent-run" />
            </div>
            <button type="button" className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={checkEntitlement.isPending} onClick={() => checkEntitlement.mutate()}>
              {t("page.settings.runEntitlementCheck")}
            </button>
            {entitlementResult ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-[var(--text)]">{String(entitlementResult.decision || "-")}</span>
                  <StatusPill tone={entitlementResult.allowed ? "ok" : "warn"} label={entitlementResult.allowed ? t("page.settings.allowed") : t("page.settings.notAllowed")} />
                </div>
                <p className="mt-2 font-mono text-xs text-[var(--muted)]">{entitlementResult.quota?.metric || entitlementDraft.metric}: {formatNumber(entitlementResult.quota?.current)} / {formatNumber(entitlementResult.quota?.limit)}</p>
              </div>
            ) : null}
            {checkEntitlement.error ? <ErrorLine message={(checkEntitlement.error as Error).message} /> : null}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.dunningQueue")}</p>
            <span className="text-xs text-[var(--muted)]">{billingDunning.data?.summary?.open_invoices ?? 0}</span>
          </div>
          <div className="mt-3 space-y-2">
            {(billingDunning.data?.items || []).slice(0, 5).map((row: any) => (
              <div key={row.invoice_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-[var(--text)]">{row.invoice_id}</span>
                  <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">{row.stage}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">${formatMoney(row.total_due_usd)} · {row.days_open}d · {row.next_action}</p>
              </div>
            ))}
            {!billingDunning.data?.items?.length ? <p className="text-sm text-[var(--muted)]">{t("page.settings.noDunning")}</p> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <BadgeDollarSign className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.subscription")}</p>
              <p className="text-xs text-[var(--muted)]">{t("page.settings.billingDesc")}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <Info label={t("page.settings.plan")} value={planDraft || String(billing.data?.subscription?.plan || "-")} />
            <Info label={t("page.settings.status")} value={String(billing.data?.subscription?.status || "-")} />
            <Info label={t("page.settings.billingEmail")} value={billingEmail || "-"} />
            <Button block onClick={() => setBillingDrawerOpen(true)}>
              {t("page.settings.billingOpenDrawer")}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(billing.data?.usage_ratio || {}).map(([metric, row]: [string, any]) => (
            <UsageQuotaCard key={metric} metric={metric} row={row} />
          ))}
          {!billing.data?.usage_ratio || Object.keys(billing.data.usage_ratio).length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
              {t("page.settings.noQuota")}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.invoice")}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.invoiceDesc")}</p>
          <div className="mt-4 grid gap-3">
            <Info label={t("page.settings.period")} value={String(invoice.data?.period || "-")} />
            <Info label={t("page.settings.totalDue")} value={`$${formatMoney(invoice.data?.total_due_usd)}`} />
            <Info label={t("page.settings.currency")} value={String(invoice.data?.currency || "USD")} />
          </div>
          <button type="button" className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50" disabled={snapshotInvoice.isPending || !invoice.data} onClick={() => snapshotInvoice.mutate()}>
            {t("page.settings.snapshotInvoice")}
          </button>
          <a className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-muted)]" href={api.billingInvoiceCsvUrl(String(invoice.data?.period || ""))} target="_blank" rel="noreferrer">
            {t("page.settings.exportInvoiceCsv")}
          </a>
          {snapshotInvoice.data?.path ? <p className="mt-2 break-all text-[11px] text-[var(--muted)]">{snapshotInvoice.data.path}</p> : null}
          {invoice.isError ? <ErrorLine message={(invoice.error as Error).message} /> : null}
          {snapshotInvoice.error ? <ErrorLine message={(snapshotInvoice.error as Error).message} /> : null}
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
            <span>{t("page.settings.lineItem")}</span>
            <span className="text-right">{t("page.settings.quantity")}</span>
            <span className="text-right">{t("page.settings.amount")}</span>
          </div>
          {(invoice.data?.lines || []).map((line: any, idx: number) => (
            <div key={`${line.metric}-${idx}`} className="grid grid-cols-[1fr_7rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text)]">{line.metric}</p>
                <p className="truncate text-xs text-[var(--muted)]">{line.description}</p>
              </div>
              <p className="text-right font-mono text-xs text-[var(--muted-strong)]">{formatNumber(line.quantity)}</p>
              <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(line.amount_usd)}</p>
            </div>
          ))}
          {!invoice.data?.lines?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoice")}</div> : null}
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="grid grid-cols-[1fr_7rem_7rem_9rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
          <span>{t("page.settings.invoiceHistory")}</span>
          <span>{t("page.settings.period")}</span>
          <span className="text-right">{t("page.settings.totalDue")}</span>
          <span>{t("page.settings.status")}</span>
          <span>{t("page.settings.audit")}</span>
        </div>
        {(invoices.data?.items || []).map((row: any) => (
          <div key={row.id} className="grid grid-cols-[1fr_7rem_7rem_9rem_7rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-[var(--text)]">{row.id}</p>
              <p className="truncate text-[11px] text-[var(--muted)]">{row.path}</p>
            </div>
            <p className="text-xs text-[var(--muted-strong)]">{row.period}</p>
            <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(row.total_due_usd)}</p>
            <select className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]" value={row.status || "draft"} disabled={updateInvoiceStatus.isPending} onChange={(e) => updateInvoiceStatus.mutate({ id: row.id, status: e.target.value })}>
              {["draft", "issued", "paid", "void"].map((s) => <option key={s} value={s}>{t(`page.settings.invoiceStatus.${s}`)}</option>)}
            </select>
            <button type="button" className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text)]" onClick={() => setAuditInvoiceId(row.id)}>
              {t("page.settings.viewAudit")}
            </button>
          </div>
        ))}
        {!invoices.data?.items?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoiceHistory")}</div> : null}
      </div>
      {auditInvoiceId ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.invoiceAudit")}</p>
              <p className="font-mono text-xs text-[var(--muted)]">{auditInvoiceId}</p>
            </div>
            <button type="button" className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setAuditInvoiceId("")}>{t("common.close")}</button>
          </div>
          {(invoiceAudit.data?.items || []).map((row: any) => (
            <div key={row.id} className="grid gap-2 border-b border-[var(--border)] px-4 py-3 text-sm last:border-0 md:grid-cols-[11rem_1fr_9rem]">
              <span className="font-mono text-xs text-[var(--muted)]">{row.ts}</span>
              <span className="font-semibold text-[var(--text)]">{row.type}</span>
              <span className="text-xs text-[var(--muted-strong)]">{row.from_status ? `${row.from_status} -> ${row.to_status}` : row.method || row.invoice_status}</span>
            </div>
          ))}
          {!invoiceAudit.data?.items?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noInvoiceAudit")}</div> : null}
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.recordPayment")}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.paymentDrawerDesc")}</p>
          <div className="mt-4 grid gap-3">
            <Info label={t("page.settings.openInvoices")} value={String(billingDunning.data?.summary?.open_invoices ?? 0)} />
            <Info label={t("page.settings.outstanding")} value={`$${formatMoney(billingSummary.data?.outstanding_usd)}`} />
            <Button block type="primary" onClick={() => setBillingDrawerOpen(true)}>
              {t("page.settings.recordPayment")}
            </Button>
            {recordPayment.error ? <ErrorLine message={(recordPayment.error as Error).message} /> : null}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold text-[var(--muted)]">
            <span>{t("page.settings.paymentHistory")}</span>
            <span className="text-right">{t("page.settings.amount")}</span>
            <span>{t("page.settings.status")}</span>
          </div>
          {(payments.data?.items || []).map((row: any) => (
            <div key={row.id} className="grid grid-cols-[1fr_7rem_8rem] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-[var(--text)]">{row.invoice_id}</p>
                <p className="truncate text-[11px] text-[var(--muted)]">{row.external_ref || row.id}</p>
              </div>
              <p className="text-right font-mono text-xs text-[var(--text)]">${formatMoney(row.amount_usd)}</p>
              <p className="text-xs text-[var(--muted-strong)]">{row.method}</p>
            </div>
          ))}
          {!payments.data?.items?.length ? <div className="px-4 py-6 text-sm text-[var(--muted)]">{t("page.settings.noPayments")}</div> : null}
        </div>
      </div>
      <Drawer title={t("page.settings.billingOperationsTitle")} open={billingDrawerOpen} onClose={() => setBillingDrawerOpen(false)} width="min(640px, 100vw)">
        <div className="space-y-5">
          <Steps size="small" current={paymentDraft.invoice_id ? 2 : 0} items={[{ title: t("page.settings.billingSubscriptionStep") }, { title: t("page.settings.billingOverageStep") }, { title: t("page.settings.billingPaymentStep") }]} />
          <Form layout="vertical" className="space-y-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.subscription")}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Form.Item label={t("page.settings.plan")} required className="mb-0">
                  <Select value={planDraft} onChange={(value) => setPlanDraft(value)} options={[...Object.entries(billing.data?.catalog || {}).map(([id, plan]: [string, any]) => ({ value: id, label: plan.name || id })), ...(!billing.data?.catalog ? [{ value: "starter", label: "Starter" }] : [])]} />
                </Form.Item>
                <Form.Item label={t("page.settings.billingEmail")} required className="mb-0">
                  <Input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="billing@example.com" />
                </Form.Item>
              </div>
              <Button className="mt-4" type="primary" loading={updateBilling.isPending} onClick={() => updateBilling.mutate()}>{t("page.settings.applyPlan")}</Button>
              {updateBilling.error ? <ErrorLine message={(updateBilling.error as Error).message} /> : null}
              {billing.isError ? <ErrorLine message={(billing.error as Error).message} /> : null}
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.overagePolicy")}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Form.Item label={t("page.settings.overagePolicy")} required className="mb-0">
                  <Select value={overageDraft.mode} onChange={(value) => setOverageDraft({ ...overageDraft, mode: value })} options={["approval_required", "block", "allow"].map((mode) => ({ value: mode, label: t(`page.settings.overageMode.${mode}`) }))} />
                </Form.Item>
                <Form.Item label={t("page.settings.gracePercent")} className="mb-0">
                  <Input type="number" value={overageDraft.grace_percent} onChange={(e) => setOverageDraft({ ...overageDraft, grace_percent: e.target.value })} />
                </Form.Item>
                <Form.Item label={t("page.settings.approvalThresholdPercent")} className="mb-0">
                  <Input type="number" value={overageDraft.approval_threshold_percent} onChange={(e) => setOverageDraft({ ...overageDraft, approval_threshold_percent: e.target.value })} />
                </Form.Item>
                <Form.Item label={t("page.settings.invoiceDueDays")} className="mb-0">
                  <Input type="number" value={overageDraft.invoice_due_days} onChange={(e) => setOverageDraft({ ...overageDraft, invoice_due_days: e.target.value })} />
                </Form.Item>
                <Form.Item label={t("page.settings.suspendAfterDays")} className="mb-0 md:col-span-2">
                  <Input type="number" value={overageDraft.suspend_after_days} onChange={(e) => setOverageDraft({ ...overageDraft, suspend_after_days: e.target.value })} />
                </Form.Item>
              </div>
              <Button className="mt-4" loading={updateOveragePolicy.isPending} onClick={() => updateOveragePolicy.mutate()}>{t("page.settings.saveOveragePolicy")}</Button>
              {updateOveragePolicy.error ? <ErrorLine message={(updateOveragePolicy.error as Error).message} /> : null}
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text)]">{t("page.settings.recordPayment")}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("page.settings.paymentDrawerDesc")}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Form.Item label={t("page.settings.pickInvoice")} required className="mb-0 md:col-span-2">
                  <Select value={paymentDraft.invoice_id || undefined} placeholder={t("page.settings.pickInvoice")} onChange={(id) => {
                    const row = (invoices.data?.items || []).find((x: any) => x.id === id);
                    setPaymentDraft({ ...paymentDraft, invoice_id: id, amount_usd: row ? String(row.total_due_usd || "") : paymentDraft.amount_usd });
                  }} options={(invoices.data?.items || []).map((row: any) => ({ value: row.id, label: `${row.period} · ${row.id}` }))} />
                </Form.Item>
                <Form.Item label={t("page.settings.paymentAmount")} required className="mb-0">
                  <Input type="number" value={paymentDraft.amount_usd} onChange={(e) => setPaymentDraft({ ...paymentDraft, amount_usd: e.target.value })} />
                </Form.Item>
                <Form.Item label={t("page.settings.paymentMethod")} className="mb-0">
                  <Select value={paymentDraft.method} onChange={(value) => setPaymentDraft({ ...paymentDraft, method: value })} options={["manual", "bank_transfer", "stripe"].map((method) => ({ value: method, label: t(`page.settings.paymentMethodValue.${method}`) }))} />
                </Form.Item>
                <Form.Item label={t("page.settings.paymentRef")} className="mb-0 md:col-span-2">
                  <Input value={paymentDraft.external_ref} onChange={(e) => setPaymentDraft({ ...paymentDraft, external_ref: e.target.value })} placeholder={t("page.settings.paymentRef")} />
                </Form.Item>
              </div>
              <Space className="mt-4">
                <Button type="primary" loading={recordPayment.isPending} disabled={!paymentDraft.invoice_id || Number(paymentDraft.amount_usd) <= 0} onClick={() => recordPayment.mutate()}>{t("page.settings.savePayment")}</Button>
                <Button onClick={() => setBillingDrawerOpen(false)}>{t("common.cancel")}</Button>
              </Space>
              {recordPayment.error ? <ErrorLine message={(recordPayment.error as Error).message} /> : null}
            </div>
          </Form>
        </div>
      </Drawer>
    </Card>
  );
}
