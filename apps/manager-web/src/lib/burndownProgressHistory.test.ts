import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SprintBurndownChart } from "../pages/shared/SprintBurndownChart";
import { burndownChartObservations } from "./burndownHistory";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("sprint observations preserve missing days", () => {
  const data = {
    ideal: [
      { day: 0, remaining: 5 },
      { day: 4, remaining: 0 },
    ],
    actual: [
      { day: 0, remaining: 5 },
      { day: 2, remaining: 4 },
      { day: 3, remaining: 3 },
    ],
    stats: { remaining: 1, total_tasks: 5 },
    current_metrics: { remaining: 3, tasks_total: 5 },
    remaining_basis: "verified_completion",
  };
  it("does not draw an actual SVG line across unobserved days", () => {
    const html = renderToStaticMarkup(
      createElement(SprintBurndownChart, { data }),
    );
    const lines = [
      ...html.matchAll(
        /<polyline[^>]*stroke="var\(--brand\)"[^>]*points="([^"]*)"/g,
      ),
    ].map((line) => line[1]);
    expect(lines).toEqual(["50,20 75,40"]);
  });
  it("uses the new unverified task metric instead of legacy recorded completion for remaining", () => {
    const html = renderToStaticMarkup(
      createElement(SprintBurndownChart, { data }),
    );
    expect(html).toContain("delivery.burndownVerified");
    expect(html).toContain("burndownRemaining: 3 / 5");
  });
  it("inserts empty values in sparse ECharts data without generating a daily history", () => {
    expect(burndownChartObservations(data.actual)).toEqual([
      [0, 5],
      [1, "-"],
      [2, 4],
      [3, 3],
    ]);
    expect(
      burndownChartObservations([
        { day: 10000, remaining: 2 },
        { day: 0, remaining: 5 },
      ]),
    ).toEqual([
      [0, 5],
      [1, "-"],
      [10000, 2],
    ]);
  });
});
