import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ownerIdentityLabel, ownerIdentityOptions, filterTeamMembers } from "./deliveryTeamIdentity";
import { teamIdentityTranslations } from "../i18n/delivery-team";
import { DeliveryTeamMembers } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryTeamMembers";
import { parseSchedulingRoute } from "./deliveryScheduling";
import type { DeliveryMember, DeliveryDisplayContext } from "./delivery";
let remoteMembers: DeliveryMember[] = [];
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
  const search = String(queryKey[3] || ""), kind = queryKey[4], active = queryKey[5];
  const selected = queryKey[0] === "delivery-members-page" ? remoteMembers.filter((member) => (!search || `${member.id} ${member.name}`.includes(search)) && (kind === "all" || member.kind === kind) && (active === "all" || member.active === (active === "active"))) : queryKey[0] === "delivery-member-exact" ? remoteMembers.filter((member) => member.id === queryKey[3]) : [];
  return { data: { project_id: "project", query_generation: 3, items: selected.map((data) => ({ id: data.id, data })), total: selected.length, next_cursor: null }, isPending: false, isError: false };
} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-US" } }) }));
const members: DeliveryMember[] = [
  { id: "user:one", name: "Alex", kind: "human", active: true, role: "QA", tool: "" },
  { id: "agent:two", name: "Alex", kind: "agent", active: true, role: "Developer", tool: "Codex" },
  { id: "user:inactive", name: "Past owner", kind: "human", active: false, role: "", tool: "" },
  { id: "tool:three", name: "Build", kind: "tool", active: true, role: "CI", tool: "" },
];
const text = (key: string) => key;
describe("responsibility follows identity", () => {
  it("distinguishes duplicate names and never offers tools or inactive owners for assignment", () => {
    const options = ownerIdentityOptions(members, "user:inactive", text);
    expect(options.filter((item) => !item.disabled).map((item) => item.value)).toEqual(["", "user:one", "agent:two"]);
    expect(options[1].label).not.toBe(options[2].label);
    expect(options[1].label).toContain("user:one");
    expect(options.at(-1)).toMatchObject({ value: "user:inactive", disabled: true });
    expect(options.at(-1)?.label).toContain("reassign");
  });
  it("does not replace a missing owner with a same-name identity", () => {
    expect(ownerIdentityLabel(members, "user:gone", text)).toBe("missingOwner · user:gone");
    expect(ownerIdentityOptions(members, "user:gone", text).at(-1)).toMatchObject({ value: "user:gone", disabled: true });
    const renamed = members.map((item) => item.id === "user:one" ? { ...item, name: "New name" } : item);
    expect(ownerIdentityLabel(renamed, "user:one", text)).toContain("New name");
    expect(ownerIdentityOptions(renamed, "user:one", text)[1].value).toBe("user:one");
  });
  it("filters by ID, type and actual activation independently of role or tool labels", () => {
    expect(filterTeamMembers(members, { teamKind: "agent", teamState: "active", teamSearch: "agent:two" }).map((item) => item.id)).toEqual(["agent:two"]);
    expect(filterTeamMembers(members, { teamKind: "all", teamState: "inactive", teamSearch: "" }).map((item) => item.id)).toEqual(["user:inactive"]);
  });
});
describe("team roster states", () => {
  const workspace = { project: { id: "project" }, query_generation: 3, members, referenceTotals: { members: members.length, milestones: 0, activeResources: 0 }, permissions: { write: true, configure: false, approve: false } } as unknown as DeliveryDisplayContext;
  function render(extra = {}, serverMembers = members) {
    remoteMembers = serverMembers;
    vi.stubGlobal("location", { hash: "#/dev-flow?view=team" });
    return renderToStaticMarkup(createElement(DeliveryTeamMembers, { workspace, sessionId: "test", onSaved: vi.fn(), calendarFailed: true, route: parseSchedulingRoute("#/dev-flow?view=team"), onRoute: vi.fn(), onEdit: vi.fn(), onCalendar: vi.fn(), onRetryCalendar: vi.fn(), onTask: vi.fn(), ...extra }));
  }
  it("keeps the roster readable when calendars fail, with stable IDs and permission explanation", () => {
    const html = render();
    expect(html).toContain("user:one");
    expect(html).toContain("agent:two");
    expect(html).toContain("deliveryTeam.calendarUnavailable");
    expect(html).toContain("deliveryTeam.readOnly");
    expect(html).not.toContain("can_execute");
  });
  it("distinguishes no registered members from no filter matches", () => {
    expect(render({ workspace: { ...workspace, members: [], referenceTotals: { ...workspace.referenceTotals, members: 0 } } }, [])).toContain("deliveryTeam.emptyHint");
    expect(render({ route: { ...parseSchedulingRoute("#/dev-flow?view=team"), teamSearch: "missing" } })).toContain("deliveryTeam.noMatchesHint");
  });
  it("keeps the registry flow separate from the legacy team card grid", () => {
    const html = render();
    const rootClasses = html.match(/^<section class="([^"]+)"/)?.[1].split(/\s+/) || [];
    expect(rootClasses).toContain("delivery-team-registry");
    expect(rootClasses).not.toContain("delivery-team");
    const css = readFileSync(resolve(__dirname, "../../subapps/ai-rd-center/src/pages/delivery/delivery-team.css"), "utf8");
    expect(css).toMatch(/\.delivery-team-registry\s*\{[^}]*display:\s*block/);
    expect(css).not.toMatch(/\.delivery-team\s*\{/);
    expect(html).toContain('class="delivery-schedule-members"');
  });
  it("keeps the same text contract in all supported languages", () => {
    for (const translation of Object.values(teamIdentityTranslations)) {
      expect(Object.keys(translation).sort()).toEqual(Object.keys(teamIdentityTranslations["zh-CN"]).sort());
      expect(translation.roleHint.length).toBeGreaterThan(10);
    }
  });
});
