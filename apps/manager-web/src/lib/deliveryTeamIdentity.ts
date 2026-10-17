import type { DeliveryMember } from "./delivery";

export type IdentityText = (key: string) => string;
export function memberIdentityLabel(member: DeliveryMember, text: IdentityText): string {
  return `${member.name} · ${text(`kinds.${member.kind}`)} · ${member.id}`;
}
export function ownerIdentityLabel(members: DeliveryMember[], id: string, text: IdentityText): string {
  if (!id) return text("unassigned");
  const member = members.find((item) => item.id === id);
  if (!member) return `${text("missingOwner")} · ${id}`;
  return `${memberIdentityLabel(member, text)}${member.active && member.kind !== "tool" ? "" : ` · ${text("reassign")}`}`;
}
export function ownerIdentityOptions(members: DeliveryMember[], currentId: string, text: IdentityText) {
  const options = [
    { value: "", label: text("unassigned"), disabled: false },
    ...members.filter((member) => member.active && member.kind !== "tool").map((member) => ({ value: member.id, label: memberIdentityLabel(member, text), disabled: false })),
  ];
  if (currentId && !options.some((option) => option.value === currentId))
    options.push({ value: currentId, label: ownerIdentityLabel(members, currentId, text), disabled: true });
  return options;
}
export function filterTeamMembers(members: DeliveryMember[], filters: { teamKind: string; teamState: string; teamSearch: string }) {
  const search = filters.teamSearch.trim().toLocaleLowerCase();
  return members.filter((member) =>
    (filters.teamKind === "all" || member.kind === filters.teamKind) &&
    (filters.teamState === "all" || member.active === (filters.teamState === "active")) &&
    (!search || `${member.id} ${member.name} ${member.role} ${member.tool}`.toLocaleLowerCase().includes(search)));
}
