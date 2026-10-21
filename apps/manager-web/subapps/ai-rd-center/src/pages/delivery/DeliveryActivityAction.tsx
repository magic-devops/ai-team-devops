import { useTranslation } from "react-i18next";
import { externalWorkOrderActionLabel } from "@/i18n/external-work-orders";

export function DeliveryActivityAction({ action }: { action: string }) {
  const { t, i18n } = useTranslation();
  return (
    <strong>
      {externalWorkOrderActionLabel(i18n.language, action) || t(`delivery.actions.${action}`, {
        defaultValue: t(`deliveryProject.actions.${action}`, {
          defaultValue: action,
        }),
      })}
    </strong>
  );
}
