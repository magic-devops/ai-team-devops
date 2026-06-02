import type { ReactNode } from "react";
import { Database, Network, Search, ShieldCheck, Terminal, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";

function SettingLink({ href, title, body, icon, external = false }: { href: string; title: string; body: string; icon: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className="group flex min-h-32 flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">{icon}</span>
      <span>
        <span className="mt-3 block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{body}</span>
      </span>
    </a>
  );
}

export function SettingsWorkspacePanel() {
  const { t } = useTranslation();

  return (
    <Card title={t("page.settings.workspaceCard")}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SettingLink href="#/organization" icon={<UsersRound className="h-5 w-5" />} title={t("page.settings.orgTitle")} body={t("page.settings.orgDesc")} />
        <SettingLink href="#/intelligence" icon={<Database className="h-5 w-5" />} title={t("page.settings.dbTitle")} body={t("page.settings.dbDesc")} />
        <SettingLink href="#/vibe" icon={<Terminal className="h-5 w-5" />} title={t("page.settings.vibeTitle")} body={t("page.settings.vibeDesc")} />
        <SettingLink href="#/orchestration" icon={<Network className="h-5 w-5" />} title={t("page.settings.orchestrationTitle")} body={t("page.settings.orchestrationDesc")} />
        <SettingLink href="#/search" icon={<Search className="h-5 w-5" />} title={t("page.settings.searchTitle")} body={t("page.settings.searchDesc")} />
        <SettingLink href="/login.html" icon={<ShieldCheck className="h-5 w-5" />} title={t("page.settings.loginTitle")} body={t("page.settings.loginDesc")} external />
      </div>
    </Card>
  );
}
