import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Spin } from "antd";
import { useTranslation } from "react-i18next";

export function NeedLogin() {
  const { t } = useTranslation();
  const loginHref = `/login.html?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;
  return (
    <Alert
      type="warning"
      showIcon
      message={t("auth.dashboardNeedLogin")}
      description={(
      <a href={loginHref} className="font-semibold text-brand-700 underline dark:text-brand-300">
        {t("auth.openLogin")}
      </a>
      )}
    />
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center py-8">
      <Spin tip={label ?? t("common.loading")} />
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return <Alert className="mb-3" type="error" showIcon message={message} />;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-6">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={message} />
    </div>
  );
}

export function RefreshButton({ onClick, pending }: { onClick: () => void; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    <Button size="small" icon={<ReloadOutlined spin={pending} />} onClick={onClick} disabled={pending}>
      {t("common.refresh")}
    </Button>
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
    <Input.Search
      allowClear
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t("common.search")}
      className="min-w-56"
    />
  );
}
