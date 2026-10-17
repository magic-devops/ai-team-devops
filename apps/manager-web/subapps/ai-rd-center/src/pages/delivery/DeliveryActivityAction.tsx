import { useTranslation } from "react-i18next";

export function DeliveryActivityAction({ action }: { action: string }) {
  const { t } = useTranslation();
  return (
    <strong>
      {t(`delivery.actions.${action}`, {
        defaultValue: t(`deliveryProject.actions.${action}`, {
          defaultValue: action,
        }),
      })}
    </strong>
  );
}
