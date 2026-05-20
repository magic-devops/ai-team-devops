import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { inputClass, secondaryBtn } from "./ui";

export function usePagedRows<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => rows.slice((safePage - 1) * pageSize, safePage * pageSize), [rows, pageSize, safePage]);
  return { page: safePage, setPage, totalPages, pageRows, pageSize };
}

export function ManagementToolbar(props: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="relative min-w-[16rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        <input
          className={`${inputClass} pl-9`}
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder={props.placeholder}
        />
      </div>
      {props.children}
    </div>
  );
}

export function ManagementPager(props: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-strong)]">
      <span>{t("page.projects.pageSummary", { page: props.page, totalPages: props.totalPages, total: props.total, pageSize: props.pageSize })}</span>
      <div className="flex gap-2">
        <button type="button" className={secondaryBtn} disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("common.prev")}
        </button>
        <button type="button" className={secondaryBtn} disabled={props.page >= props.totalPages} onClick={() => props.onPage(props.page + 1)}>
          {t("common.next")}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="min-w-full text-left text-sm">{children}</table>
    </div>
  );
}

export const thClass = "whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]";
export const tdClass = "border-b border-[var(--border)] px-3 py-2 align-middle last:border-b-0";
