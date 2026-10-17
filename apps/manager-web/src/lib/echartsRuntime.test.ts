import { describe, expect, it, vi } from "vitest";
import * as panel from "../components/charts/EChartsPanel";

describe("Vite CommonJS chart runtime interop", () => {
  it("resolves the actual default-only namespace produced for the installed CommonJS ECharts module", () => {
    const init = vi.fn();
    const runtime = { init };
    // The inspected local Vite output exports default require_echarts(), without named init.
    const resolver = (
      panel as unknown as {
        resolveEChartsRuntime?: (module: unknown) => { init: typeof init };
      }
    ).resolveEChartsRuntime;
    expect(typeof resolver).toBe("function");
    resolver!({ default: runtime }).init("element");
    expect(init).toHaveBeenCalledWith("element");
    expect(init.mock.contexts[0]).toBe(runtime);
  });
  it("also supports named ESM init and rejects malformed runtimes with a clear diagnostic", () => {
    const init = vi.fn();
    const resolver = (
      panel as unknown as {
        resolveEChartsRuntime?: (module: unknown) => { init: typeof init };
      }
    ).resolveEChartsRuntime;
    expect(typeof resolver).toBe("function");
    resolver!({ init }).init("element");
    expect(init).toHaveBeenCalledWith("element");
    expect(() => resolver!({ default: {} })).toThrow(
      "ECharts runtime does not export init",
    );
  });
});
