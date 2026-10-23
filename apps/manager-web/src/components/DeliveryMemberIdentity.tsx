import { Select } from "antd";
import { useTranslation } from "react-i18next";
import { type DeliveryMember } from "@/lib/delivery";
import { DeliveryReferenceSelect } from "./DeliveryReferenceSelect";
import {
  ownerIdentityLabel,
  ownerIdentityOptions,
} from "@/lib/deliveryTeamIdentity";
import "./delivery-member-identity.css";

export function useMemberIdentity() {
  const { t } = useTranslation();
  return (members: DeliveryMember[], id: string) =>
    ownerIdentityLabel(members, id, (key) => t(`deliveryTeam.${key}`));
}
export function OwnerSelect({
  members,
  value = "",
  onChange,
  disabled,
  loading,
  label,
  placeholder,
  keepCurrent = false,
  emptyLabel,
}: {
  members: DeliveryMember[];
  value?: string;
  onChange?: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  placeholder?: string;
  keepCurrent?: boolean;
  queryGeneration?: number | null;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeam.${key}`);
  const options = ownerIdentityOptions(
    members,
    keepCurrent && value === "__clear__" ? "" : value,
    tr,
  );
  if (keepCurrent) {
    options[0] = { value: "", label: tr("keepOwner"), disabled: false };
    options.push({
      value: "__clear__",
      label: tr("clearOwner"),
      disabled: false,
    });
  }
  else if (emptyLabel) options[0] = { value: "", label: emptyLabel, disabled: false };
  return (
    <Select
      className="delivery-owner-select"
      aria-label={label || tr("owner")}
      value={value}
      disabled={disabled}
      loading={loading}
      onChange={onChange}
      options={options}
      showSearch
      optionFilterProp="label"
      placeholder={placeholder}
      popupMatchSelectWidth
    />
  );
}
export function ProjectOwnerSelect(
  props: Omit<Parameters<typeof OwnerSelect>[0], "members"> & {
    members?: DeliveryMember[];
    purpose?: "assignment" | "filter";
  },
) {
  const { t } = useTranslation();
  const options = ownerIdentityOptions(
    props.members || [],
    props.value || "",
    (key) => t(`deliveryTeam.${key}`),
  );
  if (props.keepCurrent) {
    options[0] = {
      value: "",
      label: t("deliveryTeam.keepOwner"),
      disabled: false,
    };
    options.push({
      value: "__clear__",
      label: t("deliveryTeam.clearOwner"),
      disabled: false,
    });
  }
  else if (props.emptyLabel) options[0] = { value: "", label: props.emptyLabel, disabled: false };
  return (
    <DeliveryReferenceSelect
      key={props.purpose || "assignment"}
      kind="member"
      queryGeneration={props.queryGeneration}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
      label={props.label}
      options={options}
      filter={(data) => (props.purpose === "filter" ? typeof data.active === "boolean" : data.active === true) && (data.kind === "human" || data.kind === "agent")}
      formatLabel={(item) => `${item.label} · ${t(`deliveryTeam.kinds.${item.data.kind}`)} · ${item.id}${item.data.active === false ? ` · ${t("deliveryTeam.inactive")}` : ""}`}
    />
  );
}
