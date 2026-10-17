import { describe, expect, it } from "vitest";
import { parseSchedulingRoute, schedulingHash, preserveSchedulingRoute } from "./deliveryScheduling";

describe("stable team detail navigation", () => {
  it("keeps the inspected member separate from capacity filters", () => {
    const hash = "#/dev-flow?view=team&team_view=members&member_id=user%3Acalendar&team_member=agent%3Abuilder&team_kind=agent&team_state=inactive&team_q=Builder";
    const route = parseSchedulingRoute(hash) as ReturnType<typeof parseSchedulingRoute> & { teamMemberId: string; teamKind: string; teamState: string; teamSearch: string };
    expect(route.memberId).toBe("user:calendar");
    expect(route.teamMemberId).toBe("agent:builder");
    expect(route.teamKind).toBe("agent");
    expect(route.teamState).toBe("inactive");
    expect(route.teamSearch).toBe("Builder");
    const params = new URLSearchParams(schedulingHash(route, hash).split("?")[1]);
    expect(params.get("team_member")).toBe("agent:builder");
    expect(params.get("member_id")).toBe("user:calendar");
  });
  it("removes only the inspected member when closing and preserves team filters across views", () => {
    const source = "#/dev-flow?view=team&member_id=user%3Aone&team_member=agent%3Aone&team_kind=agent";
    const route = { ...parseSchedulingRoute(source), teamMemberId: "" };
    const closed = schedulingHash(route, source);
    expect(new URLSearchParams(closed.split("?")[1]).has("team_member")).toBe(false);
    expect(new URLSearchParams(closed.split("?")[1]).get("member_id")).toBe("user:one");
    expect(preserveSchedulingRoute("#/dev-flow?view=timeline", source)).toContain("team_member=agent%3Aone");
  });
});
