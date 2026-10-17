import { Alert, Button, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchDelivery, type DeliveryMember } from "@/lib/delivery";
import { getProjectId, getToken } from "@/lib/authStorage";
import { ownerIdentityLabel, ownerIdentityOptions } from "@/lib/deliveryTeamIdentity";
import "./delivery-member-identity.css";

export function useMemberIdentity() {
  const { t } = useTranslation();
  return (members: DeliveryMember[], id: string) => ownerIdentityLabel(members, id, (key) => t(`deliveryTeam.${key}`));
}
export function OwnerSelect({ members, value = "", onChange, disabled, loading, label, placeholder, keepCurrent = false }: {
  members: DeliveryMember[]; value?: string; onChange?: (id: string) => void; disabled?: boolean; loading?: boolean; label?: string; placeholder?: string; keepCurrent?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeam.${key}`);
  const options = ownerIdentityOptions(members, keepCurrent && value === "__clear__" ? "" : value, tr);
  if (keepCurrent) {
    options[0] = { value: "", label: tr("keepOwner"), disabled: false };
    options.push({ value: "__clear__", label: tr("clearOwner"), disabled: false });
  }
  return <Select className="delivery-owner-select" aria-label={label || tr("owner")} value={value} disabled={disabled} loading={loading} onChange={onChange} options={options} showSearch optionFilterProp="label" placeholder={placeholder} popupMatchSelectWidth />;
}
export function ProjectOwnerSelect(props: Omit<Parameters<typeof OwnerSelect>[0], "members">) {
  const { t } = useTranslation();
  const projectId = getProjectId() || "";
  const query = useQuery({ queryKey: ["delivery-owner-roster", projectId], queryFn: ({ signal }) => fetchDelivery(projectId, signal), enabled: Boolean(projectId && getToken()), gcTime: 0, retry: false });
  return <div className="delivery-project-owner">
    <OwnerSelect {...props} members={query.data?.members || []} disabled={props.disabled || !query.data || query.isError} loading={query.isFetching} />
    {query.isError && <Alert type="error" title={t("deliveryTeam.rosterFailed")} action={<Button size="small" onClick={() => void query.refetch()}>{t("deliveryTeam.retry")}</Button>} />}
  </div>;
}
