type Point = { day: number; remaining: number };

/** Sparse observations only connect across consecutive recorded days. */
export function splitBurndownObservations(points: Point[]): Point[][] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const sorted = [...byDay.values()].sort((a, b) => a.day - b.day);
  const segments: Point[][] = [];
  for (const point of sorted) {
    const segment = segments.at(-1);
    if (segment && point.day === segment.at(-1)!.day + 1) segment.push(point);
    else segments.push([point]);
  }
  return segments;
}
export function burndownChartObservations(
  points: Point[],
): [number, number | "-"][] {
  const segments = splitBurndownObservations(points);
  return segments.flatMap((segment, index) => [
    ...(index
      ? [[segments[index - 1].at(-1)!.day + 1, "-"] as [number, "-"]]
      : []),
    ...segment.map((point): [number, number] => [point.day, point.remaining]),
  ]);
}
