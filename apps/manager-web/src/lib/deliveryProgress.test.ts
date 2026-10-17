import { describe, expect, it, vi } from "vitest";
import { parseDeliveryRoute } from "./deliveryProjectInbox";
import * as progressModule from "./deliveryProgress";
import {
  defaultProgressRange,
  parseProgressRoute,
  progressHash,
  progressRangeProblem,
  progressSeries,
  currentProgressTaskTarget,
  preserveProgressRoute,
  fetchDeliveryProgress,
  fetchProgressObservation,
  fetchProgressBaseline,
} from "./deliveryProgress";
import { request } from "./http";
vi.mock("./http", () => ({ request: vi.fn() }));

describe("durable progress navigation and series", () => {
  it("captures date input values before React's queued state update can restore the controlled DOM value", () => {
    type Dates = { startsOn: string; endsOn: string };
    const handler = (
      progressModule as unknown as {
        progressDateChange?: (
          set: (updater: (current: Dates) => Dates) => void,
          field: keyof Dates,
          event: { target: { value: string } },
        ) => void;
      }
    ).progressDateChange;
    expect(typeof handler).toBe("function");
    for (const field of ["startsOn", "endsOn"] as const) {
      let queued: ((current: Dates) => Dates) | undefined;
      const event = { target: { value: "2026-10-15" } };
      handler!(
        (updater) => {
          queued = updater;
        },
        field,
        event,
      );
      event.target.value = "2026-09-18";
      expect(
        queued!({ startsOn: "2026-09-18", endsOn: "2026-10-17" })[field],
      ).toBe("2026-10-15");
    }
  });
  it("registers the progress page and round trips exact scope, dates, baseline and historical observation", () => {
    const route = {
      startsOn: "2026-10-01",
      endsOn: "2026-10-17",
      scope: "milestone" as const,
      scopeId: "M & 中文",
      baselineId: "B?&1",
      observationId: "O/last",
    };
    const hash = progressHash(route);
    expect(parseDeliveryRoute(hash).view).toBe("progress");
    expect(parseProgressRoute(hash, new Date("2026-10-17T23:59:00Z"))).toEqual(
      route,
    );
  });
  it("uses UTC dates and rejects invalid, reversed or excessive calendar windows without normalizing bad input", () => {
    expect(defaultProgressRange(new Date("2026-10-17T23:59:59-10:00"))).toEqual(
      { startsOn: "2026-09-19", endsOn: "2026-10-18" },
    );
    expect(progressRangeProblem("2026-02-30", "2026-03-01")).toBe(
      "invalidDates",
    );
    expect(progressRangeProblem("2026-10-02", "2026-10-01")).toBe("dateOrder");
    expect(progressRangeProblem("2024-01-01", "2025-01-01")).toBe("rangeLimit");
    expect(progressRangeProblem("2024-01-01", "2024-12-31")).toBeNull();
    expect(
      parseProgressRoute(
        "#/dev-flow?view=progress&progress_scope=bad&starts_on=bad",
      ).startsOn,
    ).toBe("bad");
  });
  it("keeps every missing and future day null, distinguishes baseline and current remaining and retains exact observation IDs", () => {
    const metrics = {
      remaining: 5,
      status_counts: {
        pending: 1,
        in_progress: 1,
        blocked: 1,
        awaiting_review: 1,
        recorded_completed: 1,
        verified_completed: 2,
      },
    };
    const points = progressSeries([
      {
        date: "2026-10-01",
        observation_id: "first",
        metrics,
        baseline_remaining: 3,
      },
      {
        date: "2026-10-02",
        observation_id: null,
        metrics: null,
        baseline_remaining: null,
      },
      {
        date: "2026-10-03",
        observation_id: "last",
        metrics: { ...metrics, remaining: 4, verified_completed: 3 },
        baseline_remaining: 2,
      },
      {
        date: "2026-10-04",
        observation_id: null,
        metrics: null,
        baseline_remaining: null,
      },
    ] as Parameters<typeof progressSeries>[0]);
    expect(points.remaining).toEqual([5, null, 4, null]);
    expect(points.baselineRemaining).toEqual([3, null, 2, null]);
    expect(points.states.awaiting_review).toEqual([1, null, 1, null]);
    expect(points.observations).toEqual(["first", null, "last", null]);
  });
  it("opens only actual current task identities and leaves deleted historical tasks read only", () => {
    const tasks = [{ id: "T & exact", req_id: "REQ/1" }];
    expect(currentProgressTaskTarget("T & exact", tasks)).toEqual({
      view: "progress",
      requirement_id: "REQ/1",
      detail: "tasks",
      task_id: "T & exact",
    });
    expect(currentProgressTaskTarget("deleted", tasks)).toBeNull();
    expect(
      currentProgressTaskTarget("legacy", [{ id: "legacy", req_id: "" }])
        ?.requirement_id,
    ).toBe("");
    const historical =
      "#/dev-flow?view=progress&progress_scope=sprint&scope_id=S1&baseline_id=B1&observation_id=O1";
    const current = preserveProgressRoute(
      "#/dev-flow?view=progress&requirement=new-req&detail=tasks&task=present",
      historical,
    );
    expect(parseProgressRoute(current)).toMatchObject({
      scope: "sprint",
      scopeId: "S1",
      baselineId: "B1",
      observationId: "",
    });
    expect(parseProgressRoute(historical).observationId).toBe("O1");
    expect(
      currentProgressTaskTarget("present", [
        { id: "present", req_id: "new-req" },
      ])?.requirement_id,
    ).toBe("new-req");
  });
  it("sends explicit project scope, exact URL encoded resource IDs and abort signals on all three reads", async () => {
    const signal = new AbortController().signal;
    const query = {
      startsOn: "2026-10-01",
      endsOn: "2026-10-17",
      scope: "sprint" as const,
      scopeId: "S &1",
      baselineId: "B?",
      observationId: "",
    };
    await fetchDeliveryProgress("p-one", query, signal);
    await fetchProgressObservation("p-one", "O/&?", query, signal);
    await fetchProgressBaseline("p-one", "B/&?", signal);
    const calls = vi.mocked(request).mock.calls.slice(-3);
    for (const call of calls)
      expect(call[1]).toEqual({ signal, headers: { "X-Project-Id": "p-one" } });
    const params = new URLSearchParams(calls[0][0].split("?")[1]);
    expect(params.get("scope_id")).toBe("S &1");
    expect(params.get("baseline_id")).toBe("B?");
    expect(calls[1][0]).toContain("observations/O%2F%26%3F?");
    expect(calls[2][0]).toBe("/api/v1/delivery/progress/baselines/B%2F%26%3F");
  });
});
