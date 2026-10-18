import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { currentEventHash, safeEventReturn } from "@/lib/eventReceipts";
export function EventReceiptReturn({
  projectId,
  disabled = false,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const params = new URLSearchParams(currentEventHash().split("?")[1]);
  const href = safeEventReturn(params.get("event_return") || "", projectId);
  if (!href) return null;
  return (
    <Button
      size="small"
      href={disabled ? undefined : href}
      disabled={disabled}
      style={{ marginBottom: 8 }}
    >
      {t("eventReceipts.back")}
    </Button>
  );
}
